import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import { sleep } from '../../core/clock'
import type { FetchLike } from '../../core/sse'
import { TlsPin } from '../../core/tls-pin'
import { DEFAULT_APP_ID, DEFAULT_DISCOVERY_URL, DEFAULT_USER_AGENT, IrobotAuth, createSessionFile, type SessionStore } from './auth'
import { discoverRobots, type DiscoveredRobot } from './discovery'
import { PLUGIN_ID, toActivity, toDescriptor, toRobotCommands, toStatePatch, readMissionStatus } from './mapping'
import { connectRobot, type RobotConnection, type RobotShadow } from './mqtt'

// iRobot plugin (Roomba) — the robot is driven LOCALLY, the cloud is only used once.
//
// The robot hosts its own MQTT broker (TLS, port 8883) and pushes its state there continuously: no
// polling, no quota, nothing leaving the network once the account is linked. What forces us
// through the cloud is just this broker's PASSWORD: Roombas used to hand it to anyone who asked
// on the network, the `stingray` firmware in the device set no longer does (`cap.pw: 0`, verified
// over 115 attempts). So it is obtained once through the account, and doesn't change (`auth.ts`).
//
// TWO SOURCES FOR ONE ROBOT, and both are needed:
//   - the ACCOUNT says which robots exist and their password — but not where they are;
//   - the UDP BROADCAST says which robots are on the network and at what address — but nothing to
//     connect to them.
// A robot of the account that can't be found on the network stays in the inventory, unavailable:
// losing its name because it is switched off would make its entry vanish from the house.
//
// PHASE 1: the `vacuum` contract as it exists (activity, battery, bin full, error, and the four
// actions). The Combo says much more — mop, tank, room maps, lifetime counters — and none of it is
// in the contract yet; the `/raw` route shows it in the meantime.

/**
 * Budget for stopping before a `dock`, in two steps — and the three numbers are MEASURED on the
 * robot, not chosen. They must fit within `KASBAH_COMMAND_TIMEOUT_MS` (10 s by default), hence their
 * deliberately short sum: 4 + 3 = 7 s at worst.
 *
 * `STOP_WAIT_MS`: the time left to the robot to leave `phase: "run"` after a `pause`. Measured at
 * 1 s on 09/19; 4 s leaves some margin without eating the budget.
 *
 * `DOCK_GRACE_MS`: the time needed AFTERWARDS. This delay is the session's lesson — the robot
 * announces `phase: "stop"` well before it accepts a `dock`, and a `dock` sent in that interval is
 * swallowed WITHOUT ERROR and never replayed (robot stayed paused for 2 min 30, verified).
 * Measurements: ~1 s is not enough, 3 s is enough, 8 s is enough. We keep 3 s, the smallest
 * verified.
 */
const STOP_WAIT_MS = 4_000
const DOCK_GRACE_MS = 3_000
/** Rate at which the shadow is re-read while waiting: the robot pushes it continuously. */
const SETTLE_POLL_MS = 250

export const irobotConfigSchema = z.object({
  /** The robots' LOCAL passwords. The account password is NEVER written there. */
  IROBOT_SESSION_FILE: z.string().trim().default(stateFile('irobot-session.json')),
  /** Country code sent to endpoint discovery: it picks the Gigya data center. */
  IROBOT_COUNTRY: z.string().trim().min(2).max(2).default('FR'),
  /** In configuration like the Renault keys: the vendor may change them without notice. */
  IROBOT_DISCOVERY_URL: z.string().url().default(DEFAULT_DISCOVERY_URL),
  IROBOT_APP_ID: z.string().trim().min(1).default(DEFAULT_APP_ID),
  IROBOT_USER_AGENT: z.string().trim().min(1).default(DEFAULT_USER_AGENT),
  /**
   * Network scan rate. It only serves to find a robot that comes back, switches on or changes
   * address: the state arrives on its own over MQTT. So two minutes is plenty.
   */
  IROBOT_SCAN_MS: z.coerce.number().int().min(15_000).max(3_600_000).default(120_000),
  /** Listening time of a scan. A robot answers within a few tens of milliseconds. */
  IROBOT_SCAN_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(4_000),
  /**
   * Robot address, probed directly on top of the broadcast. Only needed when the robot sits on
   * another subnet than the server (IoT network): a broadcast does not cross a router.
   */
  IROBOT_HOST: z.string().trim().transform((s) => (s === '' ? undefined : s)).optional(),
})
export type IrobotConfig = z.infer<typeof irobotConfigSchema>

/** What the Settings card displays. Never carries a password. */
export interface IrobotStatus {
  linked: boolean
  linkedAt: number | null
  robots: { blid: string; name: string | null; sku: string | null; ip: string | null; connected: boolean }[]
  sessionFile: string | null
  lastError: string | null
}

export interface IrobotPluginDeps {
  /** Injected by tests: the account-linking requests. */
  fetchImpl?: FetchLike
  sessionStore?: SessionStore
  /** Injected by tests: replaces the UDP broadcast. */
  discoverImpl?: typeof discoverRobots
  /** Injected by tests: replaces opening the MQTT link. */
  connectImpl?: typeof connectRobot
}

export function createIrobotPlugin(deps: IrobotPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: IrobotConfig | null = null
  let auth: IrobotAuth | null = null
  let lastError: string | null = null
  let scanner: { stop(): void } | null = null

  /** What the network found at the last scan, by BLID. */
  const onNetwork = new Map<string, DiscoveredRobot>()
  /** The open MQTT links, by BLID. */
  const links = new Map<string, RobotConnection>()
  /** Certificate pin of each link, by BLID: what tells the health that a certificate changed. */
  const pins = new Map<string, TlsPin>()
  /**
   * Fingerprint of the descriptors already published. Reset in `init`: the host restarts a plugin
   * WITHOUT re-instantiating it, and a surviving fingerprint would suggest published devices that
   * the registry has just emptied (pitfall from the wiki, paid for by Automower).
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
      return toDescriptor({ blid: stored.blid, name: found?.name ?? stored.name, sku: found?.sku ?? stored.sku, cap: found?.cap }, shadow)
    })
  }

  /** Republishes the inventory only if it changed: a renamed robot must go through, not the rest. */
  function publishDevices(): void {
    const list = descriptors()
    const fingerprint = JSON.stringify(list)
    if (fingerprint === publishedFingerprint) return
    publishedFingerprint = fingerprint
    ctx?.emitDevices(list)
  }

  function onShadow(blid: string, shadow: RobotShadow): void {
    ctx?.emitState(blid, toStatePatch(shadow))
    // the robot states its name in its shadow: it is the authority once connected
    publishDevices()
  }

  /** Opens the link of a robot found on the network whose password the account knows. */
  function openLink(robot: DiscoveredRobot): void {
    if (links.has(robot.blid)) return
    const password = auth?.passwordFor(robot.blid)
    if (!password) return // robot from another account, or account not linked: nothing to try
    const pin = new TlsPin(auth!.pinFor(robot.blid), (fp) => auth?.setPin(robot.blid, fp), { device: `iRobot ${robot.blid}`, logger: ctx?.logger })
    pins.set(robot.blid, pin)
    const link = connect_({
      blid: robot.blid,
      password,
      ip: robot.ip,
      pin,
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
   * One scan. It serves three purposes: finding a robot that has just switched on, following an
   * address changed by DHCP, and marking unavailable the one that no longer answers.
   */
  async function scanOnce(): Promise<void> {
    const found = await discover_({ timeoutMs: config!.IROBOT_SCAN_TIMEOUT_MS, host: config!.IROBOT_HOST, signal: ctx?.signal, logger: ctx?.logger })
    for (const robot of found) {
      const previous = onNetwork.get(robot.blid)
      // address changed: the link points to the old one, we rebuild it — but never at the expense of
      // a working link, since any host can answer the broadcast. The new address is tried once that
      // link drops, and its certificate must match the pin.
      if (previous && previous.ip !== robot.ip) {
        if (links.get(robot.blid)?.connected) continue
        await links.get(robot.blid)?.close()
        links.delete(robot.blid)
      }
      onNetwork.set(robot.blid, robot)
      openLink(robot)
    }
    for (const stored of auth?.robots ?? []) {
      if (!found.some((r) => r.blid === stored.blid)) ctx?.setAvailable(stored.blid, false)
    }
    publishDevices()
  }

  /**
   * Lets the robot stop FOR GOOD before the next action. Two waits, and both are needed:
   *
   *  1. that its shadow stops saying "cleaning" — the shadow is the authority, not a clock;
   *  2. then `DOCK_GRACE_MS`, because it announces its stop BEFORE it is able to honor it.
   *
   * Without the second, the following `dock` is accepted and lost, silently (verified on 09/19:
   * robot stayed paused two and a half minutes, `lastCommand: "dock"` duly recorded). Past the
   * first wait's delay we carry on anyway: better an action that fails outright than a plugin
   * hanging on a robot that no longer answers.
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
      pins.clear()
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
      // the account is the authority for the LIST; the network only locates it
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
        // a `dock` following a `pause` only takes effect if the robot has registered the stop
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
       * Link the account. The password only lives for the duration of this request: not kept, not
       * logged, not sent back. What comes out of it is each robot's LOCAL password, and after
       * that nothing leaves the network anymore.
       */
      app.post<{ Body: { email?: string; password?: string } }>('/login', async (req, reply) => {
        const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'email and password are required' })
        // routes are mounted even with the plugin off, but `init` only runs if it's on:
        // without it there is no client to talk to, and a 409 is better than a 500
        if (!auth) return reply.code(409).send({ error: 'enable the iRobot plugin before linking the account' })
        try {
          const robots = await auth!.login(body.data.email, body.data.password, ctx?.signal)
          // linking again is what accepts a robot whose certificate changed
          for (const pin of pins.values()) pin.clear()
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

      /** Unlink: the local passwords are erased and the links closed. */
      app.post('/logout', async (_req, reply) => {
        if (!auth) return reply.code(409).send({ error: 'enable the iRobot plugin before unlinking the account' })
        await closeLinks()
        await auth.forget()
        pins.clear()
        onNetwork.clear()
        publishDevices()
        return status()
      })

      /**
       * Raw reading: each robot's full shadow, as it pushes it. This is how fixtures are captured
       * and how we'll decide what deserves to enter the contract (mop, tank, room maps) — 80 keys
       * of which phase 1 publishes only four.
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
      const changed = auth.robots.filter((r) => pins.get(r.blid)?.changed).map((r) => onNetwork.get(r.blid)?.name ?? r.name ?? r.blid)
      if (changed.length > 0) {
        return { status: 'error', detail: `Le certificat de ${changed.join(', ')} a changé : connexion refusée. Relier de nouveau le compte iRobot accepte le nouveau certificat.` }
      }
      const total = auth.robots.length
      const up = [...links.values()].filter((l) => l.connected).length
      if (up === 0) return { status: 'degraded', detail: `no robot reachable on the network (${total} known)` }
      if (up < total) return { status: 'degraded', detail: `${up}/${total} robots reachable` }
      return { status: 'ok', detail: `${up} robot${up > 1 ? 's' : ''} connected locally` }
    },
  }
}
