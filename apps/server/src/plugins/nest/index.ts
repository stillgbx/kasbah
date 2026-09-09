import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { describeError, sendError } from '../../http/errors'
import { NestClient } from './client'
import {
  deviceNameToExternalId, isCamera, isThermostat, thermostatAvailable, toClimatePatch, toDescriptor, toThermostatCommands,
  toThermostatDescriptor,
} from './mapping'
import type { SdmDevice } from './types'

// Plugin Google Nest (caméras, sonnettes, écrans à caméra, thermostats) via l'API cloud Smart
// Device Management. Il n'y a PAS d'API locale : rien à découvrir sur le LAN, tout passe par le
// compte Google.
//
// Mise en route, en deux temps comme Hue et TaHoma :
//  1. côté Google (une fois, par l'utilisateur, hors de Kasbah) : projet Device Access + client
//     OAuth → NEST_PROJECT_ID, NEST_CLIENT_ID, NEST_CLIENT_SECRET dans .env ;
//  2. côté Kasbah : sans NEST_REFRESH_TOKEN le plugin est en `needs_pairing` et propose la liaison
//     du compte (GET /auth/url → consentement Google → GET /auth/callback). Le jeton obtenu est
//     adopté EN MÉMOIRE et rendu à l'utilisateur pour qu'il le colle dans .env : le serveur n'écrit
//     jamais .env.
//
// Les caméras n'ont ni commande (l'API ne sait pas les éteindre) ni état au-delà de leur présence ;
// leur vidéo et leurs événements viendront plus tard (transcodage RTSP, Pub/Sub). Le thermostat,
// lui, a un état et deux commandes ; comme l'API ne pousse rien sans Pub/Sub, la liste des
// appareils est relue à cadence lente (NEST_POLL_MS, une minute par défaut : Google borne les
// appels à quelques-uns par minute), ce qui suit aussi les ajouts et retraits d'appareils.

/**
 * Clé optionnelle dont la valeur VIDE vaut « absente » : `.env.example` liste les clés à remplir, et
 * une ligne `NEST_REFRESH_TOKEN=` laissée vide en attendant la liaison ne doit pas désactiver le
 * plugin (c'est ce qui arrivait avec `min(1)` : config invalide → `disabled`, sans rien dire d'utile).
 */
const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const nestConfigSchema = z.object({
  /** Id (UUID) du projet Device Access — pas le projet Google Cloud. */
  NEST_PROJECT_ID: optionalKey,
  NEST_CLIENT_ID: optionalKey,
  NEST_CLIENT_SECRET: optionalKey,
  NEST_REFRESH_TOKEN: optionalKey,
  /** Doit être déclarée telle quelle dans le client OAuth Google (« URI de redirection autorisés »). */
  NEST_REDIRECT_URI: z.string().url().default('http://localhost:8787/api/plugins/nest/auth/callback'),
  /** Cadence de relecture de la liste des appareils (état du thermostat, ajouts / retraits). */
  NEST_POLL_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
})
export type NestConfig = z.infer<typeof nestConfigSchema>

export interface NestPluginDeps {
  /** Injection pour les tests (fetch simulé). */
  fetchImpl?: FetchLike
  /** Injection pour les tests : délai d'abandon d'une requête. */
  requestTimeoutMs?: number
  /** Injection pour les tests : le `state` anti-CSRF de la liaison OAuth. */
  randomState?: () => string
}

export function createNestPlugin(deps: NestPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: NestConfig | null = null
  let client: NestClient | null = null
  /** Appareils retenus (caméras et thermostats), par externalId, dans leur dernière forme reçue. */
  let entries = new Map<string, SdmDevice>()
  let descriptors: DeviceDescriptor[] = []
  /** Appareils de l'API qui ne sont ni caméra ni thermostat : ignorés mais comptés. */
  let ignored = 0
  /** Dernière réponse brute de la liste, pour relever une fixture réelle. */
  let lastRaw: unknown = undefined
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  /** `state` émis par /auth/url et attendus au retour : une liaison ne s'accepte que si on l'a lancée. */
  const pendingStates = new Set<string>()
  const randomState = deps.randomState ?? (() => randomBytes(16).toString('hex'))

  const ready = (): NestClient => {
    if (!client) throw new PluginError('NEEDS_PAIRING', 'Google Device Access is not configured (NEST_PROJECT_ID, NEST_CLIENT_ID, NEST_CLIENT_SECRET)')
    if (!client.linked) throw new PluginError('NEEDS_PAIRING', 'no Google account linked: open /api/plugins/nest/auth/url')
    return client
  }

  /** Relit la liste des appareils et reconstruit les descripteurs. Vrai si l'inventaire a changé. */
  async function refresh(): Promise<boolean> {
    const { raw, devices } = await ready().listDevices(ctx!.signal)
    lastRaw = raw
    const next = new Map<string, SdmDevice>()
    const nextDescriptors: DeviceDescriptor[] = []
    ignored = 0
    for (const device of devices) {
      if (isCamera(device)) nextDescriptors.push(toDescriptor(device))
      else if (isThermostat(device)) nextDescriptors.push(toThermostatDescriptor(device))
      else { ignored += 1; continue }
      next.set(deviceNameToExternalId(device.name), device)
    }
    const changed = next.size !== entries.size || [...next.keys()].some((id) => !entries.has(id))
    entries = next
    descriptors = nextDescriptors
    lastError = null
    return changed
  }

  /** Publie l'état d'UN appareil : présence pour une caméra, état complet pour un thermostat. */
  function emitOne(externalId: string, device: SdmDevice): void {
    if (isThermostat(device)) {
      const patch = toClimatePatch(device)
      if (patch) ctx!.emitState(externalId, patch)
      ctx!.setAvailable(externalId, thermostatAvailable(device))
    } else {
      ctx!.emitState(externalId, {})                    // même vide, le patch marque l'appareil disponible
    }
  }

  function emitAll(): void {
    for (const [externalId, device] of entries) emitOne(externalId, device)
  }

  /** Une passe de relecture : inventaire (republié s'il change) puis états. */
  async function tick(): Promise<void> {
    try {
      if (await refresh()) ctx!.emitDevices(descriptors)
      emitAll()
    } catch (err) {
      lastError = (err as Error).message
      throw err                                         // le poller journalise et applique son backoff
    }
  }

  function startPolling(): void {
    if (poller || !config) return
    poller = createPoller({
      name: 'nest-devices', intervalMs: config.NEST_POLL_MS, fn: tick,
      clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
    })
  }

  return {
    id: 'nest',
    configSchema: nestConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as NestConfig                    // déjà validé/transformé par l'hôte
      if (!config.NEST_PROJECT_ID || !config.NEST_CLIENT_ID || !config.NEST_CLIENT_SECRET) return
      client = new NestClient({
        projectId: config.NEST_PROJECT_ID, clientId: config.NEST_CLIENT_ID, clientSecret: config.NEST_CLIENT_SECRET,
        redirectUri: config.NEST_REDIRECT_URI, clock: c.clock, logger: c.logger,
        ...(config.NEST_REFRESH_TOKEN ? { refreshToken: config.NEST_REFRESH_TOKEN } : {}),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.requestTimeoutMs !== undefined ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      })
    },

    async discover(): Promise<DeviceDescriptor[]> {
      if (!client?.linked) return []
      try {
        await refresh()
        return descriptors
      } catch (err) {
        lastError = (err as Error).message
        throw err
      }
    },

    async start() {
      if (!client?.linked) return
      emitAll()                                          // `discover` vient de remplir les entrées
      startPolling()                                     // le premier tick relit la liste tout de suite : c'est le prix d'un poller simple
    },

    async execute(externalId: string, command: Command) {
      const c = ready()
      const device = entries.get(externalId)
      if (!device) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Nest device ${externalId}`)
      if (!isThermostat(device)) throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on a Nest camera`)
      const commands = toThermostatCommands(device, command)
      if (!commands) {
        const patch = toClimatePatch(device)
        throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} refused by the thermostat in mode "${patch?.mode ?? 'unknown'}"`)
      }
      for (const cmd of commands) await c.executeCommand(externalId, cmd.command, cmd.params, ctx!.signal)
      // Google a accusé ; on relit l'appareil pour publier ce qu'il a RETENU (arrondis, mode
      // effectif) plutôt que ce qu'on a demandé — un sondage à la minute laisserait l'UI en retard.
      const fresh = await c.getDevice(externalId, ctx!.signal)
      entries.set(externalId, fresh)
      emitOne(externalId, fresh)
    },

    async stop() {
      poller?.stop()
      poller = null
      client = null
    },

    registerRoutes(app: FastifyInstance) {
      // Lien à ouvrir dans un navigateur pour lier le compte Google au projet Device Access.
      app.get('/auth/url', async (_req, reply) => {
        if (!client) return sendError(reply, 409, 'NEEDS_PAIRING', 'set NEST_PROJECT_ID, NEST_CLIENT_ID and NEST_CLIENT_SECRET first')
        const state = randomState()
        pendingStates.add(state)
        return { url: client.authorizationUrl(state), redirectUri: config!.NEST_REDIRECT_URI }
      })

      // Retour de Google après consentement : le code s'échange contre le jeton de rafraîchissement.
      app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/callback', async (req, reply) => {
        if (!client) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not configured')
        const { code, state, error } = req.query
        if (error) return sendError(reply, 400, 'OAUTH_DENIED', `Google returned "${error}"`)
        if (!state || !pendingStates.has(state)) return sendError(reply, 400, 'INVALID_STATE', 'unknown or missing state: start again from /auth/url')
        if (!code) return sendError(reply, 400, 'INVALID_BODY', 'missing code')
        pendingStates.delete(state)
        try {
          const { refreshToken } = await client.exchangeCode(code, ctx!.signal)
          await refresh()
          ctx!.emitDevices(descriptors)
          emitAll()
          startPolling()                                 // le plugin avait démarré sans compte : le sondage part maintenant
          return reply.type('text/html; charset=utf-8').send(linkedPage(refreshToken, descriptors.length, ignored))
        } catch (err) {
          lastError = (err as Error).message
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
      })

      // Dernière liste brute reçue de Google : sert à relever une fixture réelle (voir __fixtures__).
      app.get('/devices/raw', async (_req, reply) => {
        if (lastRaw === undefined) return sendError(reply, 404, 'NOT_FOUND', 'no device list received yet')
        return lastRaw
      })
    },

    health(): PluginHealth {
      if (!client) return { status: 'error', detail: 'set NEST_PROJECT_ID, NEST_CLIENT_ID and NEST_CLIENT_SECRET (Google Device Access project + OAuth client)' }
      if (!client.linked) return { status: 'needs_pairing', detail: 'link the Google account: GET /api/plugins/nest/auth/url (or the button in Settings)' }
      if (lastError) return { status: 'error', detail: lastError }
      const cameras = descriptors.filter((d) => d.kind === 'camera').length
      const thermostats = descriptors.length - cameras
      return {
        status: 'ok',
        detail: `${cameras} camera(s)${thermostats ? `, ${thermostats} thermostat(s)` : ''}${ignored ? `, ${ignored} other device(s) ignored` : ''}`,
      }
    },
  }
}

/** Page de fin de liaison : le jeton à coller dans .env, rien d'autre (le serveur n'écrit pas .env). */
function linkedPage(refreshToken: string, devices: number, ignored: number): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><meta charset="utf-8"><title>Kasbah · Google Nest</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222}code{display:block;padding:.8rem;background:#f3f3f3;border-radius:.5rem;word-break:break-all;user-select:all}</style>
<h1>Compte Google lié</h1>
<p>${devices} appareil(s) partagé(s) avec Kasbah${ignored ? `, ${ignored} autre(s) appareil(s) ignoré(s)` : ''}. Le plugin fonctionne dès maintenant, en mémoire.</p>
<p>Pour conserver la liaison après un redémarrage, ajoutez cette ligne dans <strong>apps/server/.env</strong> :</p>
<code>NEST_REFRESH_TOKEN=${esc(refreshToken)}</code>
<p>Vous pouvez fermer cet onglet.</p>`
}
