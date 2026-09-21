import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PetPumpMode, PluginHealth } from '@kasbah/shared'
import { stateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { DEFAULT_APP_VERSION, DEFAULT_PASSPORT_URL, PetkitAuth, createSessionFile, type SessionStore } from './auth'
import { BleRelay, type BleTarget } from './ble'
import { PetkitClient, petkitDay } from './client'
import { PLUGIN_ID, toDescriptor, toDevices, toDrinkPatch, toFeederPatch, toFountainPatch, toIdentity, type PetkitDevice } from './mapping'
import { familyListSchema } from './types'

// Plugin PetKit (mangeoires et fontaines pour animaux) — API privée de l'application mobile.
//
// Il n'existe aucune voie officielle, et rien en local : les mangeoires ne parlent qu'au cloud du
// fabricant, et les fontaines n'ont même pas de Wi-Fi (voir `ble.ts`). Trois conséquences qui
// structurent tout le fichier :
//
//  1. **Connexion par CODE, pas par mot de passe** (`auth.ts`). Une session perdue ne se reprend
//     pas toute seule : il faut l'utilisateur et sa boîte aux lettres. On la prolonge donc tôt, et
//     on annonce franchement `needs_pairing` quand elle est perdue.
//  2. **Compte DÉDIÉ obligatoire.** Une nouvelle connexion invalide la précédente : sur le compte
//     principal, le serveur et le téléphone se déconnecteraient mutuellement en boucle. La carte
//     des Réglages l'affiche AVANT le formulaire — après, ce serait lu une fois le mal fait.
//  3. **Deux cadences, pas une.** Les mangeoires se lisent comme n'importe quel appareil cloud ;
//     une fontaine exige d'ouvrir une liaison Bluetooth par relais, qui peut coûter deux minutes
//     et immobilise la mangeoire voisine pendant ce temps. D'où un sondage séparé, plus lent, et
//     un `syncedAt` publié pour que l'interface montre l'âge du relevé au lieu de faire croire au
//     temps réel.
//
// CE QUE LE PLUGIN NE FAIT PAS, volontairement : le plan de repas (il s'édite dans l'appli du
// fabricant ; une ration servie ici s'y ajoute sans le toucher), les vidéos et la détection
// d'animal (aucun de nos appareils n'a de caméra), les litières et purificateurs (aucun ici).

export const petkitConfigSchema = z.object({
  /** Où demander la liste des passerelles régionales. En configuration : le fabricant la déplace. */
  PETKIT_PASSPORT_URL: z.string().url().default(DEFAULT_PASSPORT_URL),
  /** Passerelle forcée ; vide = déduite de la région. */
  PETKIT_GATEWAY: z.string().trim().default(''),
  /** Région du compte (code ISO) : c'est elle qui choisit la passerelle et elle seule accepte la session. */
  PETKIT_REGION: z.string().trim().min(2).max(3).default('FR'),
  PETKIT_TIMEZONE: z.string().trim().min(1).default('Europe/Paris'),
  /** Version d'application annoncée ; PetKit l'exige et pourrait se mettre à la vérifier. */
  PETKIT_APP_VERSION: z.string().trim().min(1).default(DEFAULT_APP_VERSION),
  /** Où garder le jeton de session. Aucun mot de passe, aucun code n'y est jamais écrit. */
  PETKIT_SESSION_FILE: z.string().trim().default(stateFile('petkit-session.json')),
  /** Cadence de lecture : une gamelle et une fontaine sont des grandeurs lentes. */
  PETKIT_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
})
export type PetkitConfig = z.infer<typeof petkitConfigSchema>

/** Ce que la carte des Réglages affiche. Ne porte ni jeton, ni code, ni adresse complète. */
export interface PetkitStatus {
  linked: boolean
  account: string | null
  gateway: string
  /** Échéance de la session (ms epoch) : l'UI peut prévenir AVANT qu'un code soit redemandé. */
  expiresAt: number | null
  devices: { externalId: string; name: string; type: string; kind: string }[]
  pollMs: number
  lastError: string | null
}

export interface PetkitPluginDeps {
  fetchImpl?: FetchLike
  sessionStore?: SessionStore
}

export function createPetkitPlugin(deps: PetkitPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: PetkitConfig | null = null
  let auth: PetkitAuth | null = null
  let client: PetkitClient | null = null
  let relay: BleRelay | null = null
  let devices: PetkitDevice[] = []
  let lastError: string | null = null
  let pollers: { stop(): void }[] = []
  /** Dernier corps brut par appareil, pour `GET /raw` — c'est lui qui remplacera les suppositions. */
  let raw = new Map<string, unknown>()
  /**
   * Dernier régime CONNU de chaque fontaine. Nécessaire parce qu'une trame de pompe porte marche
   * ET régime : pour n'en changer qu'un, il faut savoir où en est l'autre.
   */
  let lastFountainMode = new Map<string, PetPumpMode>()

  const log = () => ctx!.logger
  const byExternalId = (id: string) => devices.find((d) => d.externalId === id)

  function status(): PetkitStatus {
    return {
      linked: auth?.linked ?? false,
      account: auth?.account ?? null,
      gateway: auth?.gateway ?? '',
      expiresAt: auth?.expiresAt ?? null,
      devices: devices.map((d) => ({ externalId: d.externalId, name: d.name, type: d.type, kind: d.kind })),
      pollMs: config!.PETKIT_POLL_MS,
      lastError,
    }
  }

  /**
   * Relit l'inventaire et republie les descripteurs. Un compte non lié n'est pas une erreur ici.
   *
   * DEUX appels, pas un : PetKit n'expose aucune vue « tout le compte ». On demande d'abord les
   * familles, puis l'inventaire de chacune — avec le jour et l'identifiant de groupe, faute de quoi
   * la requête est refusée.
   */
  async function refreshRoster(signal?: AbortSignal): Promise<void> {
    if (!auth?.linked) { devices = []; ctx?.emitDevices([]); return }
    const families = familyListSchema.safeParse(await client!.families(signal))
    const groupIds = families.success
      ? [...new Set(families.data.map((f) => String(f.groupId ?? f.id ?? '')).filter(Boolean))]
      : []
    raw.set('families', families.success ? families.data : null)
    const day = petkitDay(ctx!.clock.now())
    const next: PetkitDevice[] = []
    for (const groupId of groupIds) {
      const body = await client!.roster(groupId, day, signal)
      raw.set(`roster:${groupId}`, body)
      next.push(...toDevices(body, groupId))
    }
    // On REPREND le nom et l'adresse Bluetooth déjà appris : le roster ne les porte pas, et les
    // reconstruire à neuf à chaque tour les effacerait — une fontaine sans `mac` redevient
    // injoignable, et son nom retombe sur « Eversweet Max 400000002 » entre deux sondages.
    const known = new Map(devices.map((d) => [d.externalId, d]))
    for (const d of next) {
      const before = known.get(d.externalId)
      if (before) { d.name = before.name; d.mac = before.mac; d.factor = before.factor; d.userId = before.userId }
    }
    const changed = next.length !== devices.length || next.some((d, i) => d.externalId !== devices[i]?.externalId)
    devices = next
    if (changed) ctx?.emitDevices(devices.map(toDescriptor))
  }

  /**
   * Un tour de lecture de TOUS les appareils, par leur détail.
   *
   * C'est aussi là que se découvre leur IDENTITÉ : le roster ne rend que `id` et `type` — ni nom
   * ni adresse Bluetooth (vérifié le 21/09). Le nom choisi par l'utilisateur (« Distributeur 1 »,
   * « Fontaine 1 ») et le `mac` sans lequel aucun relais n'est possible ne vivent que dans le détail.
   * On les récolte ici, et les descripteurs sont republiés dès qu'ils changent.
   *
   * Pour une fontaine, ce tour rend la dernière synchro connue du cloud, sans relais : c'est peu
   * cher et ça date de `syncTime`. Le rafraîchissement par relais est un tour à part.
   */
  async function pollDevices(signal?: AbortSignal): Promise<void> {
    if (!auth?.linked) return
    let identityChanged = false
    for (const d of devices) {
      try {
        const body = await client!.deviceDetail(d.type, d.deviceId, signal)
        raw.set(d.externalId, body)
        identityChanged = adoptIdentity(d, body) || identityChanged
        if (d.kind === 'pet_feeder') {
          ctx?.emitState(d.externalId, toFeederPatch(body, d.type, ctx!.clock.now()))
        } else {
          const patch = toFountainPatch(body, ctx!.clock.now())
          if (patch.mode) lastFountainMode.set(d.externalId, patch.mode)
          ctx?.emitState(d.externalId, patch)
          // Les passages du jour vivent dans un relevé À PART : une fontaine ne les met pas dans
          // son état. C'est un appel de plus, et le seul moyen de dire « venu boire 6 fois ».
          // Le relevé exige le propriétaire, qu'on n'apprend qu'au premier détail : au tout
          // premier tour il manque encore, et les passages arriveront au tour suivant.
          if (d.userId) {
            const rec = await client!.workRecord({ type: d.type, deviceId: d.deviceId, userId: d.userId }, petkitDay(ctx!.clock.now()), signal)
            ctx?.emitState(d.externalId, toDrinkPatch(rec))
          }
        }
        lastError = null
      } catch (err) {
        // Un appareil muet ne doit pas emporter les autres : on le marque indisponible et on
        // continue la boucle. Ses dernières valeurs restent affichées, grisées.
        ctx?.setAvailable(d.externalId, false)
        lastError = (err as Error).message
        log().warn({ err, device: d.externalId }, 'PetKit device read failed')
        if (err instanceof PluginError && err.code === 'NEEDS_PAIRING') return
      }
    }
    if (identityChanged) ctx?.emitDevices(devices.map(toDescriptor))
  }

  /** Reprend le nom et l'adresse Bluetooth d'un détail. Rend vrai si quelque chose a changé. */
  function adoptIdentity(d: PetkitDevice, body: unknown): boolean {
    const id = toIdentity(body)
    let changed = false
    if (id.name && id.name !== d.name) { d.name = id.name; changed = true }
    if (id.mac && id.mac !== d.mac) { d.mac = id.mac; changed = true }
    // Le FACTEUR décide des rations proposées, donc du descripteur : le retenir ici évite de le
    // redemander, et un changement republie la carte avec les bonnes valeurs.
    if (id.factor !== null && id.factor !== d.factor) { d.factor = id.factor; changed = true }
    if (id.userId && id.userId !== d.userId) d.userId = id.userId
    return changed
  }

  /**
   * PAS de tour de resynchronisation des fontaines, et c'est une décision mesurée le 21/09.
   *
   * On a essayé : ouvrir un relais Bluetooth (5 s, pas les 2 min redoutées) puis envoyer les deux
   * trames de demande de données que fait l'application. Les trames sont ACCEPTÉES et `syncTime`
   * **ne bouge pas**. Forcer une synchronisation n'est donc pas à notre portée — alors que la
   * fontaine, elle, se synchronise très bien toute seule (06:35 puis 08:57 observés).
   *
   * Un tour périodique aurait donc coûté une session radio toutes les dix minutes, mobilisé la
   * mangeoire voisine à chaque fois — et une note tierce avertit que rouvrir un relais plus souvent
   * que toutes les 7 minutes FIGE certains appareils — pour ne rien rafraîchir du tout.
   *
   * Le relais reste utilisé pour les COMMANDES, où il est indispensable. Et la carte montre l'âge
   * du relevé (`syncedAt`) plutôt que de faire croire au temps réel.
   */

  /**
   * Ce qu'il faut pour ouvrir un relais : l'adresse Bluetooth (qui vient du DÉTAIL) et le code
   * numérique du modèle (qui vient du ROSTER). Il manque l'un ou l'autre tant que l'appareil n'a
   * pas été lu une fois — et il n'y a alors rien à tenter.
   */
  function bleTarget(d: PetkitDevice): BleTarget | null {
    return d.mac && d.typeId ? { bleId: d.deviceId, type: d.typeId, mac: d.mac, groupId: d.groupId } : null
  }

  return {
    id: PLUGIN_ID,
    configSchema: petkitConfigSchema,

    async init(c: PluginContext) {
      ctx = c
      config = petkitConfigSchema.parse(c.config)
      // Remise à zéro EXPLICITE de tout ce qui décide « déjà publié » : un plugin est une fermeture
      // qui survit à `stop()`, et sans cela un redémarrage republierait un inventaire fantôme
      // (leçon du plugin Automower).
      devices = []
      raw = new Map()
      lastFountainMode = new Map()
      lastError = null
      pollers = []
      auth = new PetkitAuth({
        passportUrl: config.PETKIT_PASSPORT_URL,
        gateway: config.PETKIT_GATEWAY || null,
        region: config.PETKIT_REGION,
        timezone: config.PETKIT_TIMEZONE,
        appVersion: config.PETKIT_APP_VERSION,
        fetchImpl: deps.fetchImpl ?? ((input, init) => fetch(input as string, init as RequestInit)),
        store: deps.sessionStore ?? (config.PETKIT_SESSION_FILE ? createSessionFile(config.PETKIT_SESSION_FILE, c.logger) : null),
        logger: c.logger,
        now: () => c.clock.now(),
      })
      client = new PetkitClient({ auth, fetchImpl: deps.fetchImpl ?? ((input, init) => fetch(input as string, init as RequestInit)), logger: c.logger })
      relay = new BleRelay({ client, clock: c.clock, logger: c.logger, signal: c.signal })
      await auth.restore()
    },

    async discover(): Promise<DeviceDescriptor[]> {
      try { await refreshRoster(ctx?.signal) } catch (err) { lastError = (err as Error).message }
      return devices.map(toDescriptor)
    },

    async start() {
      if (!auth?.linked) { log().info('PetKit account not linked, waiting for pairing from Settings'); return }
      pollers = [
        createPoller({
          name: 'petkit-devices', intervalMs: config!.PETKIT_POLL_MS, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
          fn: async () => { await refreshRoster(ctx!.signal); await pollDevices(ctx!.signal) },
        }),
      ]
    },

    async execute(externalId: string, command: Command) {
      const d = byExternalId(externalId)
      if (!d) throw new PluginError('DEVICE_UNAVAILABLE', `unknown PetKit device ${externalId}`)
      switch (command.type) {
        case 'pet_feeder.feed': {
          // On refuse ici plutôt que de laisser le fabricant arrondir en silence : une ration hors
          // liste servirait autre chose que ce que l'utilisateur a demandé, sans rien dire.
          const meta = toDescriptor(d).meta.petFeeder
          if (meta && !meta.portions.includes(command.amount)) {
            throw new PluginError('UNSUPPORTED_COMMAND', `${d.type} only accepts ${meta.portions.join(', ')} ${meta.unit}`)
          }
          // La commande part dans l'unité BRUTE de l'API : l'utilisateur a demandé 0,3 tasse, la
          // machine attend 30. Le facteur vient d'elle (`settings.factor`), jamais d'une constante.
          const raw = Math.round(command.amount * (d.factor ?? 1))
          await client!.manualFeed(d.type, d.deviceId, raw, petkitDay(ctx!.clock.now()), ctx!.signal)
          // On ne publie PAS « servi » depuis la commande : l'accusé dit « reçu », pas « tombé ».
          // C'est la relecture qui fait foi (même prudence que sur le Roomba).
          await pollDevices(ctx!.signal)
          return
        }
        case 'pet_feeder.call_pet':
          await client!.callPet(d.type, d.deviceId, ctx!.signal)
          return
        case 'pet_fountain.set_power':
        case 'pet_fountain.set_mode': {
          const target = bleTarget(d)
          if (!target) throw new PluginError('DEVICE_UNAVAILABLE', 'fountain has no Bluetooth address')
          // Marche et régime voyagent dans la MÊME trame : changer l'un oblige à redire l'autre.
          // On part donc de l'état connu et on n'en modifie qu'un champ — sinon éteindre la pompe
          // la ferait aussi repasser en continu, à l'insu de tout le monde.
          const current = lastFountainMode.get(d.externalId) ?? 'continuous'
          const pump = command.type === 'pet_fountain.set_power'
            ? { on: command.on, mode: current }
            : { on: true, mode: command.mode }
          await relay!.withConnection(target, async () => {
            await relay!.setPump(target, pump)
            // Relecture DANS la même session : rouvrir un relais coûterait deux minutes de plus, et
            // la fontaine vient justement d'être jointe.
            const body = await client!.deviceDetail(d.type, d.deviceId, ctx!.signal)
            raw.set(d.externalId, body)
            const patch = toFountainPatch(body, ctx!.clock.now())
            if (patch.mode) lastFountainMode.set(d.externalId, patch.mode)
            ctx!.emitState(d.externalId, patch)
          })
          return
        }
        default:
          throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on ${externalId}`)
      }
    },

    async stop() {
      for (const p of pollers) p.stop()
      pollers = []
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /**
       * Relevé BRUT du dernier sondage. C'est par lui que les suppositions de `types.ts` seront
       * remplacées par du réel : les schémas de ce plugin ont été écrits AVANT toute capture.
       */
      app.get('/raw', async () => Object.fromEntries(raw))

      /**
       * Étape 1 de l'appairage : demander un code. Il arrive par courriel et vaut dix minutes —
       * c'est le fabricant qui le dit.
       */
      app.post<{ Body: { email?: string } }>('/login/code', async (req, reply) => {
        const body = z.object({ email: z.string().trim().email() }).safeParse(req.body)
        if (!body.success) return reply.code(400).send(apiError('BAD_REQUEST', 'a valid email is required'))
        try {
          await auth!.requestCode(body.data.email, ctx?.signal)
          return { sent: true }
        } catch (err) {
          lastError = (err as Error).message
          return reply.code(502).send(apiError(codeOf(err), lastError))
        }
      })

      /**
       * Étape 2 : échanger le code contre une session. Ni le code ni aucun mot de passe ne sont
       * gardés ; ce qui survit est le jeton, dans le fichier de session.
       */
      app.post<{ Body: { email?: string; code?: string } }>('/login', async (req, reply) => {
        const body = z.object({ email: z.string().trim().email(), code: z.string().trim().min(4).max(12) }).safeParse(req.body)
        if (!body.success) return reply.code(400).send(apiError('BAD_REQUEST', 'email and code are required'))
        try {
          await auth!.loginWithCode(body.data.email, body.data.code, ctx?.signal)
          await refreshRoster(ctx?.signal)
          await pollDevices(ctx?.signal)
          log().info({ devices: devices.length }, 'PetKit account linked')
          return status()
        } catch (err) {
          lastError = (err as Error).message
          const http = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(http).send(apiError(codeOf(err), lastError))
        }
      })

      /** Délier : le jeton est effacé. Rien d'autre n'a jamais été gardé. */
      app.post('/logout', async () => {
        await auth!.unlink()
        devices = []
        ctx?.emitDevices([])
        return status()
      })
    },

    health(): PluginHealth {
      const keys = Object.keys(petkitConfigSchema.shape)
      if (!auth?.linked) return { status: 'needs_pairing', detail: 'no PetKit account linked', keys }
      if (lastError) return { status: 'degraded', detail: lastError, deviceCount: devices.length, keys }
      return { status: 'ok', deviceCount: devices.length, keys }
    },
  }
}

/**
 * Enveloppe d'erreur ATTENDUE par le client (`apiErrorSchema` : `{ error: { code, message } }`).
 * Renvoyer `{ error: '<texte>' }`, comme le font encore les routes de MELCloud et de Renault, fait
 * échouer l'analyse côté tablette : le message du fabricant est perdu et l'utilisateur ne voit
 * qu'un « HTTP 502 » qui n'oriente vers rien. Vécu le 21/09 au premier appairage.
 */
const apiError = (code: string, message: string) => ({ error: { code, message } })
const codeOf = (err: unknown): string => (err instanceof PluginError ? err.code : 'UPSTREAM_ERROR')
