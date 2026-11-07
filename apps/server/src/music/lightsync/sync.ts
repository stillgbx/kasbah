import type { Logger } from 'pino'
import { DEFAULT_LIGHTSYNC_SETTINGS, lightSyncSettingsSchema, type LightSyncSettings, type LightSyncSettingsPatch } from '@kasbah/shared'
import type { Clock } from '../../core/clock'
import type { ChannelColor, LightStream, LightStreamer, SavedLights } from '../../core/lightStreamBridge'
import { HOP_S } from './analyze'
import type { Decoding } from './decode'
import { createEffect, type Effect, type EffectParams } from './effects'
import { FALLBACK_PALETTE, staticPalette, toRgb } from './palette'
import type { LightSyncSettingsByRoom, LightSyncSettingsStore } from './settingsFile'

// Lights of a room in rhythm with what Kasbah plays on a speaker of that room. Switched on per
// speaker; a Hue bridge streams one area at a time, so one speaker is synced at a time (switching
// on another one hands the stream over). While the switch is on, the stream opens when the speaker
// plays one of our tracks; when the sound stops the lights fade out, and after a pause of a few
// seconds the stream closes and the lights are switched off (they are free again for the Hue app; a
// new stream opens in under a second thanks to the handshake retransmission of `openStream`). The
// switch itself stays on for the next track, until it is switched off or the server restarts: the
// lights then get back the state they had before the first stream.
//
// Settings (effect, colours, energy, brightness) are per ROOM and persisted; a change applies to the
// running stream without a jolt (same effect reconfigured, or a new effect if its kind changed).
//
// Alignment: the features are indexed by position in the track, read at the speaker's position,
// extrapolated between two state reports on a local clock. The local clock is only reset on a
// jump (seek, track change, resume): the reports of a Sonos come in whole seconds.
//
// A player with no place in the house (a browser playing the music itself) gets its room CHOSEN
// (`setRoom`): that room's lights and settings, as if it stood there.

const TICK_MS = 20
/** Idle check while the switch is on but nothing plays: cheap, and quick enough to start. */
const IDLE_MS = 250
/** Pause (or stop) after which the stream is handed back and the lights switched off. */
const PAUSE_CLOSE_MS = 5000
/** No more sound: the lights fade to black over this time (within the pause above). */
const FADE_OUT_MS = 3000
/** The lights answer ~100 ms after the frame (bridge then Zigbee): read the features that much ahead. */
const LEAD_S = 0.1
/** Report ↔ local clock gap beyond which it is a jump, not jitter. */
const REBASE_S = 1.2
/** Position beyond the analysed span at which decoding restarts there (a seek forward). */
const SEEK_AHEAD_S = 8
/** After a failed open or a stream the bridge ended: wait before trying again. */
const RETRY_MS = 10_000
/** Decoding that failed or fell behind: restarted after 2 s, then twice as long each time, up to 30 s. */
const DECODE_RETRY_MS = 2000
const DECODE_RETRY_MAX_MS = 30_000

export type LightSyncReason = 'no_hue' | 'no_room' | 'no_area'
/** Why the lights do not follow while the switch is on: the stream to the bridge, or the sound analysis. */
export type LightSyncProblem = 'stream' | 'decode'

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
  /** Switched on but not following: what is being retried. */
  problem?: LightSyncProblem
  /** The last error behind  (bridge reason, DTLS or ffmpeg message), for the tooltip. */
  problemDetail?: string
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
  /** The rooms of the house, for a player whose room is chosen. */
  rooms(): { id: string; name: string }[]
  /** Light device ids of a room. */
  lightsOfRoom(roomId: string): string[]
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
  /** 1 while the sound plays, down to 0 when it stops (fade out). */
  fade: number
  lastTick: number
  /** Decoding restarts for the current track since it last worked, and when the next one may happen. */
  decodeFailures: number
  decodeRetryAt: number
  /** The analysis does not cover where the speaker is (failed or far behind): the lights are not following. */
  behind: boolean
  behindDetail?: string
}

export class LightSync {
  private readonly enabled = new Set<string>()
  /** Room chosen for a player with no place in the house, by player id (in memory, like the switch). */
  private readonly chosenRooms = new Map<string, string>()
  private active: Active | null = null
  private opening = false
  private retryAt = 0
  /** The stream to the bridge failed or was ended, and is being retried. */
  private streamTrouble = false
  private streamError: string | undefined
  private timer: unknown = null
  /** The lights before the first stream since the switch went on, to put back when it goes off. */
  private saved: { deviceId: string; streamer: LightStreamer; lights: SavedLights } | null = null
  /** Closing the stream and switching the lights off after a pause: done before anything else touches them. */
  private settling: Promise<void> = Promise.resolve()
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

  /** The player's room: the chosen one, else its place in the house. */
  private roomOf(deviceId: string): { id: string; name: string } | null {
    const chosen = this.chosenRooms.get(deviceId)
    if (chosen !== undefined) return this.deps.rooms().find((r) => r.id === chosen) ?? null
    return this.deps.room(deviceId)
  }

  private lightsOf(deviceId: string): string[] | null {
    const chosen = this.chosenRooms.get(deviceId)
    if (chosen !== undefined) return this.roomOf(deviceId) ? this.deps.lightsOfRoom(chosen) : null
    return this.deps.roomLights(deviceId)
  }

  /** The rooms that can be chosen: those with an area to stream to, with its name. */
  roomChoices(): { id: string; name: string; area: string }[] {
    const streamer = this.deps.streamer()
    if (!streamer) return []
    return this.deps.rooms().flatMap((r) => {
      const area = streamer.areaFor(this.deps.lightsOfRoom(r.id))
      return area ? [{ ...r, area: area.name }] : []
    })
  }

  /**
   * Chooses the room of a player with no place in the house (null forgets it). A running stream to
   * another room's area is closed; the switch stays, and the next tick opens the new room's area.
   * Null if the room is unknown.
   */
  async setRoom(deviceId: string, roomId: string | null): Promise<LightSyncStatus | null> {
    if (roomId !== null && !this.deps.rooms().some((r) => r.id === roomId)) return null
    const before = this.roomOf(deviceId)?.id
    if (roomId === null) this.chosenRooms.delete(deviceId)
    else this.chosenRooms.set(deviceId, roomId)
    if (this.active?.deviceId === deviceId && before !== roomId) await this.teardown()
    if (this.saved?.deviceId === deviceId && before !== roomId) await this.restore()
    if (this.enabled.has(deviceId)) {
      if (!this.status(deviceId).available) this.enabled.delete(deviceId)
      else this.schedule(0)
    }
    return this.status(deviceId)
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
    const room = this.roomOf(deviceId) ?? undefined
    const settings = room ? this.settingsOf(room.id) : undefined
    const extra = room && settings
      ? { room, settings, palette: [...(this.active?.deviceId === deviceId ? this.active.palette : this.paletteFor(settings, deviceId))] }
      : {}
    const streamer = this.deps.streamer()
    if (!streamer) return { deviceId, available: false, reason: 'no_hue', on, active, ...extra }
    const lights = this.lightsOf(deviceId)
    if (!lights || !room) return { deviceId, available: false, reason: 'no_room', on, active, ...extra }
    const area = streamer.areaFor(lights)
    if (!area) return { deviceId, available: false, reason: 'no_area', on, active, ...extra }
    return { deviceId, available: true, area: area.name, on, active, ...extra, ...(on ? this.problemOf(deviceId) : {}) }
  }

  private problemOf(deviceId: string): { problem?: LightSyncProblem; problemDetail?: string } {
    const a = this.active
    if (a?.deviceId === deviceId) return a.behind ? { problem: 'decode', ...(a.behindDetail ? { problemDetail: a.behindDetail } : {}) } : {}
    return this.streamTrouble ? { problem: 'stream', ...(this.streamError ? { problemDetail: this.streamError } : {}) } : {}
  }

  /** Switches the sync of a speaker; switching one on switches the others off (one stream per bridge). */
  async set(deviceId: string, on: boolean): Promise<LightSyncStatus> {
    if (on) {
      const s = this.status(deviceId)
      if (!s.available) return s
      for (const other of [...this.enabled]) if (other !== deviceId) this.enabled.delete(other)
      if (this.active && this.active.deviceId !== deviceId) await this.teardown()
      if (this.saved && this.saved.deviceId !== deviceId) await this.restore()
      this.enabled.add(deviceId)
      // switching on again is also how the user says "try again now"
      this.retryAt = 0
      this.streamTrouble = false
      this.schedule(0)
    } else {
      this.enabled.delete(deviceId)
      if (this.active?.deviceId === deviceId) await this.teardown()
      if (this.saved?.deviceId === deviceId) await this.restore()
    }
    return this.status(deviceId)
  }

  /**
   * Changes the settings of the speaker's room (any field, each one whole), saves them, and applies
   * them to the running stream. Null if the speaker is in no room; throws if the result is invalid.
   */
  async setSettings(deviceId: string, patch: LightSyncSettingsPatch): Promise<LightSyncStatus | null> {
    const room = this.roomOf(deviceId)
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
    await this.restore()
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
        const areaId = a.stream.area.id
        this.settling = this.teardown().then(() => this.switchOff(deviceId, areaId))
        this.schedule(IDLE_MS)
        return
      }
      a.fade = Math.max(0, a.fade - (dtS * 1000) / FADE_OUT_MS)
      this.send(a, a.effect.next(undefined, dtS))
      this.schedule(TICK_MS)
      return
    }
    a.pausedSince = null
    a.fade = 1
    const pos = this.position(a, st!, now)
    if (session!.sid !== a.sid) {
      a.decodeFailures = 0
      a.decodeRetryAt = 0
      a.behind = false
      this.restartDecoding(a, session!, pos)
      // a new track: a new cover, for the cover palette
      if (this.settingsOf(a.roomId).palette.source === 'cover') this.applySettings(a)
    } else if (a.decoding) {
      const d = a.decoding
      const f = d.features
      if (pos < f.startS - HOP_S) this.restartDecoding(a, session!, pos)          // a jump back before what was analysed
      else if (pos > f.endS + HOP_S && (d.failed || (!d.done && pos > f.endS + SEEK_AHEAD_S))) {
        // the analysis does not cover where the speaker is: it failed (source refused or cut), or it
        // fell far behind (a seek ahead, a slow source). Decode from there again, less and less often
        a.behind = true
        a.behindDetail = d.error ?? (d.failed ? 'the analysis stopped' : `analysis behind the speaker (${Math.round(f.endS)} s analysed, speaker at ${Math.round(pos)} s)`)
        if (now >= a.decodeRetryAt) {
          a.decodeFailures++
          a.decodeRetryAt = now + Math.min(DECODE_RETRY_MAX_MS, DECODE_RETRY_MS * 2 ** (a.decodeFailures - 1))
          this.deps.logger.warn({ deviceId, failures: a.decodeFailures, failed: d.failed, positionS: Math.round(pos), analysedToS: Math.round(f.endS) }, 'lightsync: sound analysis behind the speaker, restarting it')
          this.restartDecoding(a, session!, pos)
        }
      } else if (f.at(pos + LEAD_S)) { a.behind = false; a.decodeFailures = 0 }   // following again
    }
    this.send(a, a.effect.next(a.decoding?.features.at(pos + LEAD_S), dtS))
    this.schedule(TICK_MS)
  }

  private send(a: Active, colors: readonly ChannelColor[]): void {
    const f = a.fade
    a.stream.send(f >= 1 ? colors : colors.map((c) => ({ id: c.id, r: c.r * f, g: c.g * f, b: c.b * f })))
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
    const lights = this.lightsOf(deviceId)
    const room = this.roomOf(deviceId)
    const area = streamer && lights ? streamer.areaFor(lights) : undefined
    if (!streamer || !area || !room) return
    this.opening = true
    try {
      await this.ready
      await this.settling
      // another room chosen for this player since: its old area's lights go back first
      if (this.saved && this.saved.lights.areaId !== area.id) await this.restore()
      if (this.saved?.deviceId !== deviceId) {
        const lights = await streamer.saveLights(area.id)
        if (!this.enabled.has(deviceId)) return
        this.saved = { deviceId, streamer, lights }
      }
      const stream = await streamer.open(area.id)
      // switched off (or handed to another speaker) while the handshake was running
      if (!this.enabled.has(deviceId) || this.active) { await stream.close(); return }
      const now = this.deps.clock.now()
      const settings = this.settingsOf(room.id)
      const palette = this.paletteFor(settings, deviceId)
      const a: Active = {
        deviceId, roomId: room.id, stream,
        effect: createEffect(settings.effect, stream.area.channels, this.paramsFor(settings, palette)), effectKind: settings.effect, palette,
        sid: null, decoding: null, base: null, pausedSince: null, fade: 1, lastTick: now, decodeFailures: 0, decodeRetryAt: 0, behind: false,
      }
      this.active = a
      this.streamTrouble = false
      if (settings.palette.source === 'cover') this.fetchCover(a)
      stream.onEnded((reason) => {
        if (this.active !== a) return
        this.deps.logger.warn({ deviceId, reason }, 'lightsync: stream ended')
        a.decoding?.stop()
        this.active = null
        this.streamTrouble = true
        this.streamError = reason
        this.retryAt = this.deps.clock.now() + RETRY_MS
      })
      this.deps.logger.info({ deviceId, area: area.name, effect: settings.effect }, 'lightsync: streaming')
      this.schedule(0)
    } catch (err) {
      this.deps.logger.warn({ err, deviceId }, 'lightsync: could not open the stream')
      this.streamTrouble = true
      this.streamError = (err as Error).message
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
    // the lamps keep the last frame once the stream is closed: leave them black, not on a colour
    a.stream.send(a.stream.area.channels.map((c) => ({ id: c.id, r: 0, g: 0, b: 0 })))
    await a.stream.close().catch((err) => this.deps.logger.debug({ err }, 'lightsync: closing the stream failed'))
    this.deps.logger.info({ deviceId: a.deviceId }, 'lightsync: stopped')
  }

  /** After a pause: the lights faded to black, the stream is closed; they are switched off for real. */
  private async switchOff(deviceId: string, areaId: string): Promise<void> {
    await this.deps.streamer()?.switchOff(areaId).catch((err) => this.deps.logger.warn({ err, deviceId }, 'lightsync: switching the lights off failed'))
  }

  /** The switch went off: the lights as they were before the first stream. */
  private async restore(): Promise<void> {
    const s = this.saved
    if (!s) return
    this.saved = null
    await this.settling
    try {
      await s.streamer.restoreLights(s.lights)
      this.deps.logger.info({ deviceId: s.deviceId }, 'lightsync: lights put back')
    } catch (err) {
      this.deps.logger.warn({ err, deviceId: s.deviceId }, 'lightsync: putting the lights back failed')
    }
  }
}
