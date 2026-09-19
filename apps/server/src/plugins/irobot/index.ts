import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import { sleep } from '../../core/clock'
import type { FetchLike } from '../../core/sse'
import { DEFAULT_APP_ID, DEFAULT_DISCOVERY_URL, DEFAULT_USER_AGENT, IrobotAuth, createSessionFile, type SessionStore } from './auth'
import { discoverRobots, type DiscoveredRobot } from './discovery'
import { PLUGIN_ID, toActivity, toDescriptor, toRobotCommands, toStatePatch, readMissionStatus } from './mapping'
import { connectRobot, type RobotConnection, type RobotShadow } from './mqtt'

// Plugin iRobot (Roomba) — le robot se pilote EN LOCAL, le cloud ne sert qu'une fois.
//
// Le robot héberge son propre courtier MQTT (TLS, port 8883) et y pousse son état en continu : pas
// de sondage, pas de quota, rien qui sorte du réseau une fois le compte relié. Ce qui oblige à
// passer par le cloud, c'est le seul MOT DE PASSE de ce courtier : les Roomba le rendaient jadis à
// qui le demandait sur le réseau, le firmware `stingray` du parc ne le fait plus (`cap.pw: 0`,
// vérifié par 115 tentatives). Il s'obtient donc une fois par le compte, et ne bouge plus (`auth.ts`).
//
// DEUX SOURCES POUR UN MÊME ROBOT, et il faut les deux :
//   - le COMPTE dit quels robots existent et leur mot de passe — mais pas où ils sont ;
//   - la DIFFUSION UDP dit quels robots sont sur le réseau et à quelle adresse — mais rien pour
//     s'y connecter.
// Un robot du compte introuvable sur le réseau reste dans l'inventaire, indisponible : perdre son
// nom parce qu'il est éteint ferait disparaître son entrée de la maison.
//
// PHASE 1 : le contrat `vacuum` tel qu'il existe (activité, batterie, bac plein, erreur, et les
// quatre gestes). Le Combo dit bien plus — serpillière, réservoir, cartes de pièces, compteurs de
// vie — et rien de cela n'entre encore au contrat ; la route `/raw` le montre en attendant.

/**
 * Budget de l'arrêt avant un `dock`, en deux temps — et les trois nombres sont MESURÉS sur le robot,
 * pas choisis. Ils doivent tenir dans `KASBAH_COMMAND_TIMEOUT_MS` (10 s par défaut), d'où leur
 * somme volontairement courte : 4 + 3 = 7 s au pire.
 *
 * `STOP_WAIT_MS` : le temps laissé au robot pour quitter `phase: "run"` après un `pause`. Mesuré à
 * 1 s le 19/09 ; 4 s laissent de la marge sans manger le budget.
 *
 * `DOCK_GRACE_MS` : le temps qu'il faut ENSUITE. Ce délai est la leçon de la séance — le robot
 * annonce `phase: "stop"` bien avant d'accepter un `dock`, et un `dock` envoyé dans cet intervalle
 * est avalé SANS ERREUR et jamais rejoué (robot resté en pause 2 min 30, vérifié). Mesures :
 * ~1 s ne suffit pas, 3 s suffisent, 8 s suffisent. On retient 3 s, le plus petit vérifié.
 */
const STOP_WAIT_MS = 4_000
const DOCK_GRACE_MS = 3_000
/** Cadence de relecture de l'ombre pendant l'attente : le robot la pousse en continu. */
const SETTLE_POLL_MS = 250

export const irobotConfigSchema = z.object({
  /** Mots de passe LOCAUX des robots. Le mot de passe du compte n'y est JAMAIS écrit. */
  IROBOT_SESSION_FILE: z.string().trim().default(stateFile('irobot-session.json')),
  /** Code pays envoyé à la découverte d'endpoints : il choisit le centre Gigya. */
  IROBOT_COUNTRY: z.string().trim().min(2).max(2).default('FR'),
  /** En configuration comme les clés Renault : le fabricant peut les changer sans prévenir. */
  IROBOT_DISCOVERY_URL: z.string().url().default(DEFAULT_DISCOVERY_URL),
  IROBOT_APP_ID: z.string().trim().min(1).default(DEFAULT_APP_ID),
  IROBOT_USER_AGENT: z.string().trim().min(1).default(DEFAULT_USER_AGENT),
  /**
   * Cadence du balayage réseau. Il ne sert qu'à retrouver un robot qui rentre, s'allume ou change
   * d'adresse : l'état, lui, arrive tout seul par MQTT. Deux minutes suffisent donc largement.
   */
  IROBOT_SCAN_MS: z.coerce.number().int().min(15_000).max(3_600_000).default(120_000),
  /** Durée d'écoute d'un balayage. Un robot répond en quelques dizaines de millisecondes. */
  IROBOT_SCAN_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(4_000),
})
export type IrobotConfig = z.infer<typeof irobotConfigSchema>

/** Ce que la carte des Réglages affiche. Ne porte jamais un mot de passe. */
export interface IrobotStatus {
  linked: boolean
  linkedAt: number | null
  robots: { blid: string; name: string | null; sku: string | null; ip: string | null; connected: boolean }[]
  sessionFile: string | null
  lastError: string | null
}

export interface IrobotPluginDeps {
  /** Injecté par les tests : les requêtes de liaison du compte. */
  fetchImpl?: FetchLike
  sessionStore?: SessionStore
  /** Injecté par les tests : remplace la diffusion UDP. */
  discoverImpl?: typeof discoverRobots
  /** Injecté par les tests : remplace l'ouverture du lien MQTT. */
  connectImpl?: typeof connectRobot
}

export function createIrobotPlugin(deps: IrobotPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: IrobotConfig | null = null
  let auth: IrobotAuth | null = null
  let lastError: string | null = null
  let scanner: { stop(): void } | null = null

  /** Ce que le réseau a trouvé au dernier balayage, par BLID. */
  const onNetwork = new Map<string, DiscoveredRobot>()
  /** Les liens MQTT ouverts, par BLID. */
  const links = new Map<string, RobotConnection>()
  /**
   * Empreinte des descripteurs déjà publiés. Remise à zéro dans `init` : l'hôte redémarre un plugin
   * SANS le réinstancier, et une empreinte survivante ferait croire à des appareils publiés que le
   * registre vient justement de vider (piège du wiki, payé par Automower).
   */
  let publishedFingerprint: string | null = null

  const log = () => ctx!.logger
  const discover_ = deps.discoverImpl ?? discoverRobots
  const connect_ = deps.connectImpl ?? connectRobot

  function descriptors(): DeviceDescriptor[] {
    if (!auth) return []
    return auth.robots.map((stored) => {
      const found = onNetwork.get(stored.blid)
      const shadow = links.get(stored.blid)?.shadow()
      return toDescriptor({ blid: stored.blid, name: found?.name ?? stored.name, sku: found?.sku ?? stored.sku }, shadow)
    })
  }

  /** Republie l'inventaire seulement s'il a changé : un robot renommé doit passer, pas le reste. */
  function publishDevices(): void {
    const list = descriptors()
    const fingerprint = JSON.stringify(list)
    if (fingerprint === publishedFingerprint) return
    publishedFingerprint = fingerprint
    ctx?.emitDevices(list)
  }

  function onShadow(blid: string, shadow: RobotShadow): void {
    ctx?.emitState(blid, toStatePatch(shadow))
    // le robot dit son nom dans son ombre : c'est lui qui fait foi une fois connecté
    publishDevices()
  }

  /** Ouvre le lien d'un robot trouvé sur le réseau et dont le compte connaît le mot de passe. */
  function openLink(robot: DiscoveredRobot): void {
    if (links.has(robot.blid)) return
    const password = auth?.passwordFor(robot.blid)
    if (!password) return // robot d'un autre compte, ou compte non relié : rien à tenter
    const link = connect_({
      blid: robot.blid,
      password,
      ip: robot.ip,
      logger: ctx?.logger,
      signal: ctx?.signal,
      onShadow: (shadow) => onShadow(robot.blid, shadow),
      onConnected: () => {
        log().info({ blid: robot.blid, name: robot.name }, 'iRobot link up')
        ctx?.setAvailable(robot.blid, true)
      },
      onDisconnected: () => {
        ctx?.setAvailable(robot.blid, false)
      },
    })
    links.set(robot.blid, link)
  }

  /**
   * Un balayage. Il sert à trois choses : trouver un robot qui vient de s'allumer, suivre une
   * adresse changée par le DHCP, et marquer indisponible celui qui ne répond plus.
   */
  async function scanOnce(): Promise<void> {
    const found = await discover_({ timeoutMs: config!.IROBOT_SCAN_TIMEOUT_MS, signal: ctx?.signal, logger: ctx?.logger })
    for (const robot of found) {
      const previous = onNetwork.get(robot.blid)
      onNetwork.set(robot.blid, robot)
      // adresse changée : le lien pointe sur l'ancienne, on le refait
      if (previous && previous.ip !== robot.ip) {
        await links.get(robot.blid)?.close()
        links.delete(robot.blid)
      }
      openLink(robot)
    }
    for (const stored of auth?.robots ?? []) {
      if (!found.some((r) => r.blid === stored.blid)) ctx?.setAvailable(stored.blid, false)
    }
    publishDevices()
  }

  /**
   * Laisse le robot s'arrêter POUR DE BON avant le geste suivant. Deux attentes, et il faut les deux :
   *
   *  1. que son ombre cesse de dire « nettoie » — c'est elle qui fait foi, pas une horloge ;
   *  2. puis `DOCK_GRACE_MS`, parce qu'il annonce son arrêt AVANT d'être en état de l'honorer.
   *
   * Sans la seconde, le `dock` qui suit est accepté et perdu, en silence (vérifié le 19/09 : robot
   * resté en pause deux minutes et demie, `lastCommand: "dock"` bien enregistré). Passé le délai de
   * la première attente on continue quand même : mieux vaut un geste qui échoue franchement qu'un
   * plugin suspendu à un robot qui ne répond plus.
   */
  async function settle(link: RobotConnection): Promise<void> {
    const until = ctx!.clock.now() + STOP_WAIT_MS
    while (ctx!.clock.now() < until && !ctx!.signal.aborted) {
      if (toActivity(readMissionStatus(link.shadow())) !== 'cleaning') break
      await sleep(ctx!.clock, SETTLE_POLL_MS, ctx!.signal)
    }
    await sleep(ctx!.clock, DOCK_GRACE_MS, ctx!.signal)
  }

  function status(): IrobotStatus {
    return {
      linked: auth?.linked ?? false,
      linkedAt: auth?.linkedAt ?? null,
      robots: (auth?.robots ?? []).map((r) => ({
        blid: r.blid,
        name: onNetwork.get(r.blid)?.name ?? r.name,
        sku: onNetwork.get(r.blid)?.sku ?? r.sku,
        ip: onNetwork.get(r.blid)?.ip ?? null,
        connected: links.get(r.blid)?.connected ?? false,
      })),
      sessionFile: config?.IROBOT_SESSION_FILE ?? null,
      lastError,
    }
  }

  async function closeLinks(): Promise<void> {
    await Promise.all([...links.values()].map((l) => l.close()))
    links.clear()
  }

  return {
    id: PLUGIN_ID,
    configSchema: irobotConfigSchema,

    async init(context: PluginContext): Promise<void> {
      ctx = context
      config = context.config as IrobotConfig
      publishedFingerprint = null
      lastError = null
      onNetwork.clear()
      links.clear()
      const store = deps.sessionStore ?? createSessionFile(config.IROBOT_SESSION_FILE, context.logger)
      auth = new IrobotAuth({
        discoveryUrl: config.IROBOT_DISCOVERY_URL,
        appId: config.IROBOT_APP_ID,
        country: config.IROBOT_COUNTRY,
        userAgent: config.IROBOT_USER_AGENT,
        fetchImpl: deps.fetchImpl ?? ((input, init) => fetch(input as string, init as RequestInit)),
        store,
        logger: context.logger,
      })
      await auth.restore()
    },

    async discover(): Promise<DeviceDescriptor[]> {
      // le compte fait foi pour la LISTE ; le réseau ne fait que la localiser
      if (!auth?.linked) return []
      try { await scanOnce() }
      catch (err) { log().warn({ err }, 'iRobot network scan failed') }
      publishedFingerprint = JSON.stringify(descriptors())
      return descriptors()
    },

    async start(): Promise<void> {
      if (!auth?.linked) {
        log().info('iRobot account not linked yet: POST /api/plugins/irobot/login')
        return
      }
      scanner = createPoller({
        name: 'irobot-scan',
        intervalMs: config!.IROBOT_SCAN_MS,
        fn: scanOnce,
        clock: ctx!.clock,
        signal: ctx!.signal,
        logger: ctx!.logger,
      })
    },

    async execute(externalId: string, command: Command): Promise<void> {
      const link = links.get(externalId)
      if (!link) throw new PluginError('DEVICE_UNAVAILABLE', `iRobot ${externalId} is not reachable on the network`)
      const activity = toActivity(readMissionStatus(link.shadow()))
      const verbs = toRobotCommands(command.type, activity)
      if (!verbs) throw new PluginError('UNSUPPORTED_COMMAND', `iRobot cannot do ${command.type}`)
      for (const [i, verb] of verbs.entries()) {
        // un `dock` qui suit un `pause` ne porte que si le robot a enregistré l'arrêt
        if (i > 0) await settle(link)
        await link.command(verb)
      }
    },

    async stop(): Promise<void> {
      scanner?.stop()
      scanner = null
      await closeLinks()
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /**
       * Relier le compte. Le mot de passe ne vit que le temps de cette requête : ni gardé, ni
       * journalisé, ni renvoyé. Ce qui en sort est le mot de passe LOCAL de chaque robot, et
       * ensuite plus rien ne sort du réseau.
       */
      app.post<{ Body: { email?: string; password?: string } }>('/login', async (req, reply) => {
        const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'email and password are required' })
        // les routes sont montées même plugin éteint, mais `init` ne tourne que s'il est allumé :
        // sans lui il n'y a pas de client à qui parler, et un 409 vaut mieux qu'un 500
        if (!auth) return reply.code(409).send({ error: 'enable the iRobot plugin before linking the account' })
        try {
          const robots = await auth!.login(body.data.email, body.data.password, ctx?.signal)
          lastError = null
          log().info({ robots: robots.length }, 'iRobot account linked')
          await scanOnce()
          return status()
        } catch (err) {
          lastError = (err as Error).message
          const code = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(code).send({ error: lastError })
        }
      })

      /** Délier : les mots de passe locaux sont effacés et les liens fermés. */
      app.post('/logout', async (_req, reply) => {
        if (!auth) return reply.code(409).send({ error: 'enable the iRobot plugin before unlinking the account' })
        await closeLinks()
        await auth.forget()
        onNetwork.clear()
        publishDevices()
        return status()
      })

      /**
       * Relevé brut : l'ombre complète de chaque robot, telle qu'il la pousse. C'est par là qu'on
       * capture les fixtures et qu'on décidera ce qui mérite d'entrer au contrat (serpillière,
       * réservoir, cartes de pièces) — 80 clés dont la phase 1 n'en publie que quatre.
       */
      app.get('/raw', async (_req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no iRobot account linked' })
        return {
          network: [...onNetwork.values()],
          robots: auth.robots.map((r) => ({
            blid: r.blid,
            connected: links.get(r.blid)?.connected ?? false,
            shadow: links.get(r.blid)?.shadow() ?? null,
          })),
        }
      })
    },

    health(): PluginHealth {
      if (!auth?.linked) {
        return { status: 'needs_pairing', detail: 'link the iRobot account from Settings to fetch each robot local password' }
      }
      const total = auth.robots.length
      const up = [...links.values()].filter((l) => l.connected).length
      if (up === 0) return { status: 'degraded', detail: `no robot reachable on the network (${total} known)` }
      if (up < total) return { status: 'degraded', detail: `${up}/${total} robots reachable` }
      return { status: 'ok', detail: `${up} robot${up > 1 ? 's' : ''} connected locally` }
    },
  }
}
