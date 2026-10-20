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

// PetKit plugin (pet feeders and fountains) — the mobile app's private API.
//
// There is no official route, and nothing local: the feeders only talk to the vendor's cloud, and
// the fountains don't even have Wi-Fi (see `ble.ts`). Three consequences that shape the whole
// file:
//
//  1. **Sign-in by CODE, not by password** (`auth.ts`). A lost session doesn't come back on its
//     own: it takes the user and their mailbox. So we extend it early, and plainly announce
//     `needs_pairing` when it is lost.
//  2. **DEDICATED account required.** A new sign-in invalidates the previous one: on the main
//     account, the server and the phone would keep signing each other out. The Settings card shows
//     this BEFORE the form — after it, it would be read once the damage is done.
//  3. **Two rates, not one.** Feeders are read like any cloud device; a fountain requires opening a
//     Bluetooth link through a relay, which can cost two minutes and ties up the nearby feeder
//     meanwhile. Hence a separate, slower poll, and a published `syncedAt` so the interface shows
//     the reading's age instead of passing it off as real time.
//
// WHAT THE PLUGIN DELIBERATELY DOES NOT DO: the meal plan (it is edited in the vendor's app; a
// portion served from here is added to it without touching it), videos and animal detection
// (none of our devices has a camera), litter boxes and purifiers (none here).

export const petkitConfigSchema = z.object({
  /** Where to request the list of regional gateways. In configuration: the vendor moves it. */
  PETKIT_PASSPORT_URL: z.string().url().default(DEFAULT_PASSPORT_URL),
  /** Forced gateway; empty = derived from the region. */
  PETKIT_GATEWAY: z.string().trim().default(''),
  /** The account's region (ISO code): it picks the gateway, and only that gateway accepts the session. */
  PETKIT_REGION: z.string().trim().min(2).max(3).default('FR'),
  PETKIT_TIMEZONE: z.string().trim().min(1).default('Europe/Paris'),
  /** Announced app version; PetKit requires it and might start checking it. */
  PETKIT_APP_VERSION: z.string().trim().min(1).default(DEFAULT_APP_VERSION),
  /** Where to keep the session token. No password, no code is ever written there. */
  PETKIT_SESSION_FILE: z.string().trim().default(stateFile('petkit-session.json')),
  /** Read rate: a bowl and a fountain are slow-moving quantities. */
  PETKIT_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
})
export type PetkitConfig = z.infer<typeof petkitConfigSchema>

/** What the Settings card displays. Carries no token, no code, no full address. */
export interface PetkitStatus {
  linked: boolean
  account: string | null
  gateway: string
  /** Session expiry (epoch ms): the UI can warn BEFORE a code is asked for again. */
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
  /** Last raw body per device, for `GET /raw` — it's what will replace the assumptions. */
  let raw = new Map<string, unknown>()
  /**
   * Last KNOWN mode of each fountain. Needed because a pump frame carries on/off AND mode: to
   * change only one, you need to know where the other stands.
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
   * Re-reads the inventory and republishes the descriptors. An unlinked account is not an error
   * here.
   *
   * TWO calls, not one: PetKit exposes no "whole account" view. We first ask for the families,
   * then the inventory of each — with the day and the group identifier, otherwise the request is
   * refused.
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
    // We CARRY OVER the name and Bluetooth address already learned: the roster doesn't carry them,
    // and rebuilding from scratch on every round would erase them — a fountain without `mac`
    // becomes unreachable again, and its name falls back to "Eversweet Max 400000002" between polls.
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
   * One reading round over ALL devices, through their detail.
   *
   * It's also where their IDENTITY is discovered: the roster only returns `id` and `type` — neither
   * name nor Bluetooth address (verified on 09/21). The name chosen by the user ("Distributeur 1",
   * "Fontaine 1") and the `mac` without which no relay is possible only live in the detail. We
   * collect them here, and the descriptors are republished as soon as they change.
   *
   * For a fountain, this round returns the cloud's last known sync, without relay: it's cheap and
   * dates from `syncTime`. Refreshing through a relay is a separate round.
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
          // The day's visits live in a SEPARATE log: a fountain doesn't put them in its state.
          // It's one more call, and the only way to say "came to drink 6 times". The log requires
          // the owner, which we only learn at the first detail: on the very first round it's still
          // missing, and the visits will arrive on the next round.
          if (d.userId) {
            const rec = await client!.workRecord({ type: d.type, deviceId: d.deviceId, userId: d.userId }, petkitDay(ctx!.clock.now()), signal)
            ctx?.emitState(d.externalId, toDrinkPatch(rec))
          }
        }
        lastError = null
      } catch (err) {
        // A silent device must not take the others down with it: we mark it unavailable and carry
        // on with the loop. Its last values stay displayed, grayed out.
        ctx?.setAvailable(d.externalId, false)
        lastError = (err as Error).message
        log().warn({ err, device: d.externalId }, 'PetKit device read failed')
        if (err instanceof PluginError && err.code === 'NEEDS_PAIRING') return
      }
    }
    if (identityChanged) ctx?.emitDevices(devices.map(toDescriptor))
  }

  /** Picks up the name and Bluetooth address from a detail. Returns true if something changed. */
  function adoptIdentity(d: PetkitDevice, body: unknown): boolean {
    const id = toIdentity(body)
    let changed = false
    if (id.name && id.name !== d.name) { d.name = id.name; changed = true }
    if (id.mac && id.mac !== d.mac) { d.mac = id.mac; changed = true }
    // The FACTOR decides the offered portions, hence the descriptor: keeping it here avoids asking
    // for it again, and a change republishes the card with the right values.
    if (id.factor !== null && id.factor !== d.factor) { d.factor = id.factor; changed = true }
    if (id.userId && id.userId !== d.userId) d.userId = id.userId
    return changed
  }

  /**
   * NO fountain resync round, and it's a decision measured on 09/21.
   *
   * We tried: opening a Bluetooth relay (5 s, not the dreaded 2 min) then sending the two
   * data-request frames the app sends. The frames are ACCEPTED and `syncTime` **doesn't move**. So
   * forcing a sync is beyond our reach — whereas the fountain syncs itself very well on its own
   * (06:35 then 08:57 observed).
   *
   * A periodic round would therefore have cost a radio session every ten minutes, tied up the
   * nearby feeder each time — and a third-party note warns that reopening a relay more often than
   * every 7 minutes FREEZES some devices — to refresh nothing at all.
   *
   * The relay is still used for COMMANDS, where it is essential. And the card shows the reading's
   * age (`syncedAt`) rather than passing it off as real time.
   */

  /**
   * What it takes to open a relay: the Bluetooth address (which comes from the DETAIL) and the
   * numeric model code (which comes from the ROSTER). One or the other is missing until the device
   * has been read once — and then there's nothing to try.
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
      // EXPLICIT reset of everything that decides "already published": a plugin is a closure that
      // survives `stop()`, and without this a restart would republish a ghost inventory (lesson
      // from the Automower plugin).
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
          // We refuse here rather than let the vendor round silently: a portion outside the list
          // would serve something other than what the user asked for, without saying anything.
          const meta = toDescriptor(d).meta.petFeeder
          if (meta && !meta.portions.includes(command.amount)) {
            throw new PluginError('UNSUPPORTED_COMMAND', `${d.type} only accepts ${meta.portions.join(', ')} ${meta.unit}`)
          }
          // The command goes out in the API's RAW unit: the user asked for 0.3 cup, the machine
          // expects 30. The factor comes from it (`settings.factor`), never from a constant.
          const raw = Math.round(command.amount * (d.factor ?? 1))
          await client!.manualFeed(d.type, d.deviceId, raw, petkitDay(ctx!.clock.now()), ctx!.signal)
          // We do NOT publish "served" from the command: the acknowledgment says "received", not
          // "dropped". The re-read is the authority (same caution as with the Roomba).
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
          // On/off and mode travel in the SAME frame: changing one forces restating the other. So
          // we start from the known state and change only one field — otherwise switching the
          // pump off would also put it back to continuous, unbeknownst to everyone.
          const current = lastFountainMode.get(d.externalId) ?? 'continuous'
          const pump = command.type === 'pet_fountain.set_power'
            ? { on: command.on, mode: current }
            : { on: true, mode: command.mode }
          await relay!.withConnection(target, async () => {
            await relay!.setPump(target, pump)
            // Re-read IN the same session: reopening a relay would cost two more minutes, and the
            // fountain has just been reached.
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
       * RAW reading of the last poll. It's through it that the assumptions in `types.ts` will be
       * replaced with real data: this plugin's schemas were written BEFORE any capture.
       */
      app.get('/raw', async () => Object.fromEntries(raw))

      /**
       * Pairing step 1: request a code. It arrives by e-mail and is valid for ten minutes — the
       * vendor says so.
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
       * Step 2: exchange the code for a session. Neither the code nor any password is kept; what
       * survives is the token, in the session file.
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

      /** Unlink: the token is erased. Nothing else was ever kept. */
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
 * Error envelope EXPECTED by the client (`apiErrorSchema`: `{ error: { code, message } }`).
 * Returning `{ error: '<text>' }`, as the MELCloud and Renault routes still do, makes parsing fail
 * on the interface side: the vendor's message is lost and the user only sees an "HTTP 502" that
 * points nowhere. Experienced on 09/21 at the first pairing.
 */
const apiError = (code: string, message: string) => ({ error: { code, message } })
const codeOf = (err: unknown): string => (err instanceof PluginError ? err.code : 'UPSTREAM_ERROR')
