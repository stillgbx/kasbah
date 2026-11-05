import type { Logger } from 'pino'
import { DEFAULT_LIGHTSYNC_SETTINGS, lightSyncSettingsSchema, type LightSyncSettings, type LightSyncSettingsPatch } from '@kasbah/shared'
import type { Clock } from '../../core/clock'
import type { LightStream, LightStreamer } from '../../core/lightStreamBridge'
import { HOP_S } from './analyze'
import type { Decoding } from './decode'
import { createEffect, type Effect, type EffectParams } from './effects'
import { FALLBACK_PALETTE, staticPalette, toRgb } from './palette'
import type { LightSyncSettingsByRoom, LightSyncSettingsStore } from './settingsFile'

// Lights of a room in rhythm with what Kasbah plays on a speaker of that room. Switched on per
// speaker; a Hue bridge streams one area at a time, so one speaker is synced at a time (switching
// on another one hands the stream over). While the switch is on, the stream opens when the speaker
// plays one of our tracks and closes after a pause of a few seconds; the switch itself stays on
// for the next track, until it is switched off or the server restarts.
//
// Settings (effect, colours, energy, brightness) are per ROOM and persisted; a change applies to the
// running stream without a jolt (same effect reconfigured, or a new effect if its kind changed).
//
// Alignment: the features are indexed by position in the track, read at the speaker's position,
// extrapolated between two state reports on a local clock. The local clock is only reset on a
// jump (seek, track change, resume): the reports of a Sonos come in whole seconds.

const TICK_MS = 20
/** Idle check while the switch is on but nothing plays: cheap, and quick enough to start. */
const IDLE_MS = 250
/** Pause (or stop) after which the stream is handed back. */
const PAUSE_CLOSE_MS = 5000
/** The lights answer ~100 ms after the frame (bridge then Zigbee): read the features that much ahead. */
const LEAD_S = 0.1
/** Report ↔ local clock gap beyond which it is a jump, not jitter. */
const REBASE_S = 1.2
/** Position beyond the analysed span at which decoding restarts there (a seek forward). */
const SEEK_AHEAD_S = 8
/** After a failed open or a stream the bridge ended: wait before trying again. */
const RETRY_MS = 10_000

export type LightSyncReason = 'no_hue' | 'no_room' | 'no_area'

export interface LightSyncStatus {
  deviceId: string
  /** The room of this speaker can be synced; otherwise `reason` says why. */
  available: boolean
  reason?: LightSyncReason
  /** House room of the speaker (its settings are the room's). */
  room?: { id: string; name: string }
  /** Name of the entertainment area that will be used. */
  area?: string
  /** The switch. */
  on: boolean
  /** Lights being driven right now. */
  active: boolean
  /** The room's settings (defaults until changed); absent without a room. */
  settings?: LightSyncSettings
  /** The colours in use, sRGB hex: the cover's once known for the playing track. */
  palette?: string[]
}

export interface PlayerReading {
  playback?: string
  positionS?: number
  updatedAt?: number
}

export interface LightSyncDeps {
  /** What the speaker plays from us (proxy session), if anything, with the track's cover URL. */
  session(deviceId: string): { sid: string; sourceUrl: string; artUrl?: string } | undefined
  playerState(deviceId: string): PlayerReading | undefined
  /** House room of the speaker; null = in no room. */
  room(deviceId: string): { id: string; name: string } | null
  /** Light device ids of the speaker's room; null = the speaker is in no room. */
  roomLights(deviceId: string): string[] | null
  streamer(): LightStreamer | null
  decode(sourceUrl: string, startS: number): Decoding
  /** Swatches (hex) of a light scene, if it still exists. */
  sceneColors(sceneId: string): readonly string[] | undefined
  /** Dominant colours of a cover ([] if unavailable). */
  coverColors(url: string): Promise<string[]>
  settingsStore: LightSyncSettingsStore
  clock: Clock
  logger: Logger
}

interface Active {
  deviceId: string
  roomId: string
  stream: LightStream
  effect: Effect
  effectKind: LightSyncSettings['effect']
  /** Colours in use (hex). */
  palette: readonly string[]
  sid: string | null
  decoding: Decoding | null
  /** Local clock of the track position: `pos` at `at`. Null = to be taken from the next report. */
  base: { pos: number; at: number } | null
  pausedSince: number | null
  lastTick: number
}

export class LightSync {
  private readonly enabled = new Set<string>()
  private active: Active | null = null
  private opening = false
  private retryAt = 0
  private timer: unknown = null
  private settings: LightSyncSettingsByRoom = {}
  /** Cover colours of the playing track, by cover URL, once known. */
  private readonly covers = new Map<string, string[]>()
  readonly ready: Promise<void>

  constructor(private readonly deps: LightSyncDeps) {
    this.ready = deps.settingsStore.load().then((s) => { this.settings = { ...s, ...this.settings } }, (err) => {
      deps.logger.warn({ err }, 'lightsync: settings not loaded, defaults used')
    })
  }

  private settingsOf(roomId: string): LightSyncSettings {
    return this.settings[roomId] ?? DEFAULT_LIGHTSYNC_SETTINGS
  }

  /**
   * The colours for these settings and what the speaker plays: the cover's once known; until then
   * `previous` (the last track's cover keeps playing rather than a jump to the default).
   */
  private paletteFor(settings: LightSyncSettings, deviceId: string, previous?: readonly string[]): readonly string[] {
    const fixed = staticPalette(settings.palette, (id) => this.deps.sceneColors(id))
    if (fixed) return fixed
    const art = this.deps.session(deviceId)?.artUrl
    return (art && this.covers.get(art)) || previous || FALLBACK_PALETTE
  }

  private paramsFor(settings: LightSyncSettings, palette: readonly string[]): EffectParams {
    return { palette: toRgb(palette.length ? palette : FALLBACK_PALETTE), energy: settings.energy, brightness: settings.brightness }
  }

  status(deviceId: string): LightSyncStatus {
    const on = this.enabled.has(deviceId)
    const active = this.active?.deviceId === deviceId
    const room = this.deps.room(deviceId) ?? undefined
    const settings = room ? this.settingsOf(room.id) : undefined
    const extra = room && settings
      ? { room, settings, palette: [...(this.active?.deviceId === deviceId ? this.active.palette : this.paletteFor(settings, deviceId))] }
      : {}
    const streamer = this.deps.streamer()
    if (!streamer) return { deviceId, available: false, reason: 'no_hue', on, active, ...extra }
    const lights = this.deps.roomLights(deviceId)
    if (!lights || !room) return { deviceId, available: false, reason: 'no_room', on, active, ...extra }
    const area = streamer.areaFor(lights)
    if (!area) return { deviceId, available: false, reason: 'no_area', on, active, ...extra }
    return { deviceId, available: true, area: area.name, on, active, ...extra }
  }

  /** Switches the sync of a speaker; switching one on switches the others off (one stream per bridge). */
  async set(deviceId: string, on: boolean): Promise<LightSyncStatus> {
    if (on) {
      const s = this.status(deviceId)
      if (!s.available) return s
      for (const other of [...this.enabled]) if (other !== deviceId) this.enabled.delete(other)
      if (this.active && this.active.deviceId !== deviceId) await this.teardown()
      this.enabled.add(deviceId)
      this.retryAt = 0
      this.schedule(0)
    } else {
      this.enabled.delete(deviceId)
      if (this.active?.deviceId === deviceId) await this.teardown()
    }
    return this.status(deviceId)
  }

  /**
   * Changes the settings of the speaker's room (any field, each one whole), saves them, and applies
   * them to the running stream. Null if the speaker is in no room; throws if the result is invalid.
   */
  async setSettings(deviceId: string, patch: LightSyncSettingsPatch): Promise<LightSyncStatus | null> {
    const room = this.deps.room(deviceId)
    if (!room) return null
    await this.ready
    const next = lightSyncSettingsSchema.parse({ ...this.settingsOf(room.id), ...patch })
    this.settings = { ...this.settings, [room.id]: next }
    await this.deps.settingsStore.save(this.settings)
    const a = this.active
    if (a && a.roomId === room.id) this.applySettings(a)
    return this.status(deviceId)
  }

  async stop(): Promise<void> {
    this.enabled.clear()
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer)
    this.timer = null
    await this.teardown()
  }

  /** The room's current settings onto the running effect: same kind reconfigured, another kind replaced. */
  private applySettings(a: Active): void {
    const settings = this.settingsOf(a.roomId)
    const wasCover = a.palette !== FALLBACK_PALETTE && settings.palette.source === 'cover'
    a.palette = this.paletteFor(settings, a.deviceId, wasCover ? a.palette : undefined)
    const params = this.paramsFor(settings, a.palette)
    if (settings.effect !== a.effectKind) {
      a.effect = createEffect(settings.effect, a.stream.area.channels, params)
      a.effectKind = settings.effect
    } else a.effect.configure(params)
    if (settings.palette.source === 'cover') this.fetchCover(a)
  }

  /** Cover colours of the playing track: asked once per cover, applied when they arrive if still relevant. */
  private fetchCover(a: Active): void {
    const art = this.deps.session(a.deviceId)?.artUrl
    if (!art || this.covers.has(art)) return
    void this.deps.coverColors(art).then((colors) => {
      if (colors.length === 0) return
      this.covers.set(art, colors)
      if (this.covers.size > 50) this.covers.delete(this.covers.keys().next().value!)
      if (this.active === a && this.settingsOf(a.roomId).palette.source === 'cover' && this.deps.session(a.deviceId)?.artUrl === art) this.applySettings(a)
    })
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer)
    this.timer = this.deps.clock.setTimeout(() => { this.timer = null; this.tick() }, ms)
  }

  private tick(): void {
    const deviceId = [...this.enabled][0]
    if (!deviceId) return
    const now = this.deps.clock.now()
    const session = this.deps.session(deviceId)
    const st = this.deps.playerState(deviceId)
    const playing = !!session && st?.playback === 'playing'

    if (!this.active) {
      if (playing && !this.opening && now >= this.retryAt) void this.open(deviceId)
      this.schedule(IDLE_MS)
      return
    }

    const a = this.active
    const dtS = Math.min(0.2, Math.max(0, (now - a.lastTick) / 1000))
    a.lastTick = now
    if (!playing) {
      a.base = null
      a.pausedSince ??= now
      if (now - a.pausedSince >= PAUSE_CLOSE_MS) {
        void this.teardown()
        this.schedule(IDLE_MS)
        return
      }
      a.stream.send(a.effect.next(undefined, dtS))
      this.schedule(TICK_MS)
      return
    }
    a.pausedSince = null
    const pos = this.position(a, st!, now)
    if (session!.sid !== a.sid) {
      this.restartDecoding(a, session!, pos)
      // a new track: a new cover, for the cover palette
      if (this.settingsOf(a.roomId).palette.source === 'cover') this.applySettings(a)
    } else if (a.decoding) {
      const f = a.decoding.features
      // a jump back before what was analysed, or far beyond what decoding has reached: decode from there
      if (pos < f.startS - HOP_S || (pos > f.endS + SEEK_AHEAD_S && !(a.decoding.done && f.endS > f.startS))) this.restartDecoding(a, session!, pos)
    }
    a.stream.send(a.effect.next(a.decoding?.features.at(pos + LEAD_S), dtS))
    this.schedule(TICK_MS)
  }

  /** The speaker's position now, on the local clock, reset only on a jump. */
  private position(a: Active, st: PlayerReading, now: number): number {
    const reported = (st.positionS ?? 0) + (typeof st.updatedAt === 'number' ? Math.max(0, (now - st.updatedAt) / 1000) : 0)
    const predicted = a.base ? a.base.pos + (now - a.base.at) / 1000 : null
    if (predicted === null || Math.abs(reported - predicted) > REBASE_S) {
      a.base = { pos: reported, at: now }
      return reported
    }
    return predicted
  }

  private restartDecoding(a: Active, session: { sid: string; sourceUrl: string }, pos: number): void {
    a.decoding?.stop()
    if (a.sid !== session.sid) a.base = null
    a.sid = session.sid
    a.decoding = this.deps.decode(session.sourceUrl, Math.max(0, pos - 1))
  }

  private async open(deviceId: string): Promise<void> {
    const streamer = this.deps.streamer()
    const lights = this.deps.roomLights(deviceId)
    const room = this.deps.room(deviceId)
    const area = streamer && lights ? streamer.areaFor(lights) : undefined
    if (!streamer || !area || !room) return
    this.opening = true
    try {
      await this.ready
      const stream = await streamer.open(area.id)
      // switched off (or handed to another speaker) while the handshake was running
      if (!this.enabled.has(deviceId) || this.active) { await stream.close(); return }
      const now = this.deps.clock.now()
      const settings = this.settingsOf(room.id)
      const palette = this.paletteFor(settings, deviceId)
      const a: Active = {
        deviceId, roomId: room.id, stream,
        effect: createEffect(settings.effect, stream.area.channels, this.paramsFor(settings, palette)), effectKind: settings.effect, palette,
        sid: null, decoding: null, base: null, pausedSince: null, lastTick: now,
      }
      this.active = a
      if (settings.palette.source === 'cover') this.fetchCover(a)
      stream.onEnded((reason) => {
        if (this.active !== a) return
        this.deps.logger.warn({ deviceId, reason }, 'lightsync: stream ended')
        a.decoding?.stop()
        this.active = null
        this.retryAt = this.deps.clock.now() + RETRY_MS
      })
      this.deps.logger.info({ deviceId, area: area.name, effect: settings.effect }, 'lightsync: streaming')
      this.schedule(0)
    } catch (err) {
      this.deps.logger.warn({ err, deviceId }, 'lightsync: could not open the stream')
      this.retryAt = this.deps.clock.now() + RETRY_MS
    } finally {
      this.opening = false
    }
  }

  private async teardown(): Promise<void> {
    const a = this.active
    if (!a) return
    this.active = null
    a.decoding?.stop()
    await a.stream.close().catch((err) => this.deps.logger.debug({ err }, 'lightsync: closing the stream failed'))
    this.deps.logger.info({ deviceId: a.deviceId }, 'lightsync: stopped')
  }
}
