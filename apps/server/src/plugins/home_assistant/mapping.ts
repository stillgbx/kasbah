import { createHash } from 'node:crypto'
import {
  CLIMATE_MODES, COVER_CLASSES, type Capability, type ClimateMode, type Command, type CoverClass, type DeviceDescriptor,
  type DeviceKind, type SensorClass, type StatePatch,
} from '@kasbah/shared'

// PURE mapping between Home Assistant entities and Kasbah's device contract.
// Home Assistant stays the only one in command: a Kasbah command becomes a `call_service`,
// and the state comes back through the `state_changed` events — never a local echo.

export interface HaState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}
export interface HaEntityEntry {
  entity_id: string
  /** Integration that provides the entity (`hue`, `overkiz`, `cast`…). */
  platform?: string | null
  area_id?: string | null
  device_id?: string | null
  disabled_by?: string | null
  hidden_by?: string | null
  entity_category?: string | null
}
export interface HaDeviceEntry {
  id: string
  area_id?: string | null
  manufacturer?: string | null
  model?: string | null
}
export interface HaAreaEntry {
  area_id: string
  name: string
}

export interface SelectOptions {
  pluginId: string
  domains: readonly string[]
  sensorClasses: readonly string[]
  /** Suffix of a "slow speed" twin cover (`_low_speed` at Somfy): it becomes the quiet mode. */
  slowSuffix: string
}

/** A translatable entity: the Kasbah device and what it takes to drive it. */
export interface Tracked {
  externalId: string
  entityId: string
  /** "Slow speed" twin of a cover, driven when the quiet mode is on. */
  slowEntityId?: string
  kind: DeviceKind
  /** HA integration (`platform` of the entity registry), `''` if unknown. */
  integration: string
  descriptor: DeviceDescriptor
}

/** Route of the covers relayed by the server (`entity_picture` carries an HA token, and HA is on the LAN). */
export const ART_ROUTE = '/api/plugins/home_assistant/art'

const SUPPORTED_KINDS: Record<string, DeviceKind> = {
  light: 'light', cover: 'cover', climate: 'climate', sensor: 'sensor', media_player: 'media_player',
}

/**
 * HA integration → Kasbah plugin that drives the same devices natively. With that plugin on, the
 * entity is a duplicate: left out unless chosen explicitly.
 */
export const NATIVE_PLUGIN: Readonly<Record<string, string>> = {
  hue: 'hue',
  overkiz: 'tahoma',
  somfy: 'tahoma',
  cast: 'google_cast',
  sonos: 'sonos',
  nest: 'nest',
  roomba: 'irobot',
  husqvarna_automower: 'automower',
  enphase_envoy: 'enphase',
  melcloud: 'melcloud',
  tuya: 'tuya',
  tesla_fleet: 'tesla',
  teslemetry: 'tesla',
  tessie: 'tesla',
  renault: 'renault',
  open_meteo: 'open_meteo',
}

/** The Kasbah plugin already providing this entity, if it is on. */
export function duplicateOf(t: Pick<Tracked, 'integration'>, enabledPlugins: readonly string[]): string | undefined {
  const native = NATIVE_PLUGIN[t.integration]
  return native && enabledPlugins.includes(native) ? native : undefined
}

/** Shown in Kasbah: the explicit choice, otherwise everything except the duplicates. */
export function isShown(t: Tracked, choices: Readonly<Record<string, boolean>>, enabledPlugins: readonly string[]): boolean {
  return choices[t.entityId] ?? duplicateOf(t, enabledPlugins) === undefined
}

export const UNAVAILABLE = new Set(['unavailable', 'unknown'])

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'))
const features = (s: HaState) => num(s.attributes.supported_features) ?? 0

// ---------------------------------------------------------------- candidates + descriptors

/** Every entity Kasbah can translate; which ones are shown is decided apart (`isShown`). */
export function candidatesOf(
  states: readonly HaState[], entities: readonly HaEntityEntry[], devices: readonly HaDeviceEntry[],
  areas: readonly HaAreaEntry[], opts: SelectOptions,
): Tracked[] {
  const entityById = new Map(entities.map((e) => [e.entity_id, e]))
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]))
  const stateById = new Map(states.map((s) => [s.entity_id, s]))

  const keep = (s: HaState): boolean => {
    const domain = domainOf(s.entity_id)
    if (!opts.domains.includes(domain) || !SUPPORTED_KINDS[domain]) return false
    const reg = entityById.get(s.entity_id)
    if (reg?.disabled_by || reg?.hidden_by || reg?.entity_category) return false
    if (domain === 'sensor') {
      const dc = str(s.attributes.device_class)
      if (!dc || !opts.sensorClasses.includes(dc)) return false
    }
    return true
  }

  const out: Tracked[] = []
  for (const s of states) {
    if (!keep(s)) continue
    const domain = domainOf(s.entity_id)
    // a "slow speed" twin whose main cover exists is absorbed by it
    if (domain === 'cover' && opts.slowSuffix && s.entity_id.endsWith(opts.slowSuffix)
      && stateById.has(s.entity_id.slice(0, -opts.slowSuffix.length))) continue
    const slow = domain === 'cover' && opts.slowSuffix ? `${s.entity_id}${opts.slowSuffix}` : undefined
    const slowEntityId = slow && stateById.has(slow) ? slow : undefined

    const reg = entityById.get(s.entity_id)
    const device = reg?.device_id ? deviceById.get(reg.device_id) : undefined
    const areaId = reg?.area_id ?? device?.area_id ?? undefined
    const room = areaId ? areaName.get(areaId) : undefined
    const kind = SUPPORTED_KINDS[domain]!
    out.push({
      externalId: s.entity_id, entityId: s.entity_id, kind, integration: reg?.platform ?? '',
      ...(slowEntityId ? { slowEntityId } : {}),
      descriptor: toDescriptor(opts.pluginId, kind, s, {
        ...(room ? { room } : {}),
        ...(device?.manufacturer ? { manufacturer: device.manufacturer } : {}),
        ...(device?.model ? { model: device.model } : {}),
        quiet: !!slowEntityId,
      }),
    })
  }
  return out
}

interface DescribeExtra { room?: string; manufacturer?: string; model?: string; quiet: boolean }

export function toDescriptor(pluginId: string, kind: DeviceKind, s: HaState, extra: DescribeExtra): DeviceDescriptor {
  const name = str(s.attributes.friendly_name) ?? s.entity_id
  const meta: DeviceDescriptor['meta'] = {
    ...(extra.room ? { room: extra.room } : {}),
    ...(extra.manufacturer ? { manufacturer: extra.manufacturer } : {}),
    ...(extra.model ? { model: extra.model } : {}),
  }
  let capabilities: Capability[] = []
  switch (kind) {
    case 'light': {
      const modes = Array.isArray(s.attributes.supported_color_modes) ? (s.attributes.supported_color_modes as string[]) : []
      capabilities = ['on_off']
      if (modes.some((m) => m !== 'onoff')) capabilities.push('brightness')
      if (modes.includes('color_temp')) {
        capabilities.push('color_temp')
        const minK = num(s.attributes.min_color_temp_kelvin), maxK = num(s.attributes.max_color_temp_kelvin)
        if (minK && maxK) meta.colorTempMirek = [Math.round(1e6 / maxK), Math.round(1e6 / minK)]
      }
      if (modes.some((m) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m))) capabilities.push('color')
      break
    }
    case 'cover': {
      const f = features(s)
      if (f & 3) capabilities.push('open_close')
      if (f & 4) capabilities.push('position')
      if (f & 8) capabilities.push('stop')
      if (f & 128) capabilities.push('tilt')
      if (extra.quiet) capabilities.push('quiet')
      const dc = str(s.attributes.device_class)
      meta.cover = { deviceClass: dc && (COVER_CLASSES as readonly string[]).includes(dc) ? dc as CoverClass : 'shutter' }
      if (Array.isArray(s.attributes.entity_id)) meta.isGroup = true
      break
    }
    case 'climate': {
      const modes = toClimateModes(s.attributes.hvac_modes)
      if (modes.length > 1) capabilities.push('hvac_mode')
      if (features(s) & 1) capabilities.push('target_temp')
      if (num(s.attributes.current_temperature) !== undefined) capabilities.push('current_temp')
      if (num(s.attributes.current_humidity) !== undefined) capabilities.push('humidity')
      if (modes.length) meta.climate = { modes }
      const lo = num(s.attributes.min_temp), hi = num(s.attributes.max_temp)
      if (lo !== undefined && hi !== undefined) meta.targetTempC = [lo, hi]
      break
    }
    case 'sensor': {
      capabilities = ['measure']
      const dc = str(s.attributes.device_class)
      const deviceClass: SensorClass = dc === 'temperature' || dc === 'humidity' || dc === 'power' || dc === 'energy'
        || dc === 'pressure' || dc === 'illuminance' || dc === 'battery' ? dc : 'generic'
      meta.sensor = { unit: str(s.attributes.unit_of_measurement) ?? '', deviceClass, precision: 1 }
      break
    }
    case 'media_player': {
      const f = features(s)
      if (f & (1 | 4096 | 16384)) capabilities.push('playback', 'now_playing')
      if (f & 4) capabilities.push('volume')
      if (f & 8) capabilities.push('mute')
      if (f & (16 | 32)) capabilities.push('track_skip')
      meta.mediaPlayer = { deviceClass: s.attributes.device_class === 'tv' ? 'tv' : 'speaker' }
      break
    }
    default:
      break
  }
  return { id: `${pluginId}:${s.entity_id}`, pluginId, externalId: s.entity_id, kind, name, capabilities, meta }
}

/** HA modes → Kasbah modes (`heat_cool` = auto; `dry` has no equivalent). */
export function toClimateModes(raw: unknown): ClimateMode[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<ClimateMode>()
  for (const m of raw) {
    const k = m === 'heat_cool' ? 'auto' : m
    if ((CLIMATE_MODES as readonly string[]).includes(k)) out.add(k as ClimateMode)
  }
  return [...out]
}

// ---------------------------------------------------------------- states

const PLAYBACK: Record<string, 'playing' | 'paused' | 'idle' | 'on' | 'off'> = {
  playing: 'playing', buffering: 'playing', paused: 'paused', idle: 'idle', standby: 'idle', on: 'on', off: 'off',
}
const HVAC_ACTION: Record<string, 'heating' | 'cooling' | 'idle' | 'off'> = {
  heating: 'heating', preheating: 'heating', cooling: 'cooling', idle: 'idle', off: 'off', fan: 'idle', drying: 'idle',
}

/**
 * Relayed address of an `entity_picture`. `v` follows the image (HA's `cache` parameter, otherwise
 * the address without its token, which HA renews every few minutes): the browser refetches only
 * when the cover changes, and the token never leaves the server.
 */
export function artUrlOf(entityId: string, picture: string): string {
  const u = new URL(picture, 'http://ha.invalid')
  u.searchParams.delete('token')
  const v = u.searchParams.get('cache') ?? createHash('sha1').update(u.href).digest('hex').slice(0, 12)
  return `${ART_ROUTE}/${encodeURIComponent(entityId)}?v=${encodeURIComponent(v)}`
}

/** HA state → Kasbah patch. `null` on the optional fields that disappear ("unknown"). */
export function toPatch(kind: DeviceKind, s: HaState, quiet?: boolean): StatePatch {
  const a = s.attributes
  const available = !UNAVAILABLE.has(s.state)
  switch (kind) {
    case 'light': {
      const on = s.state === 'on'
      const b = num(a.brightness)
      const k = num(a.color_temp_kelvin)
      const xy = Array.isArray(a.xy_color) ? (a.xy_color as number[]) : undefined
      return {
        available, on,
        brightness: on && b !== undefined ? clampPct((b / 255) * 100) : null,
        colorTempMirek: on && k ? Math.round(1e6 / k) : null,
        color: on && xy && xy.length === 2 ? { x: xy[0]!, y: xy[1]! } : null,
      } as StatePatch
    }
    case 'cover': {
      const pos = num(a.current_position)
      const tilt = num(a.current_tilt_position)
      const motion = s.state === 'opening' ? 'opening' : s.state === 'closing' ? 'closing' : 'stopped'
      return {
        available, motion,
        position: pos !== undefined ? clampPct(pos) : s.state === 'closed' ? 0 : null,
        tilt: tilt !== undefined ? clampPct(tilt) : null,
        ...(quiet !== undefined ? { quiet } : {}),
      } as StatePatch
    }
    case 'climate': {
      const mode = s.state === 'heat_cool' ? 'auto' : s.state
      const current = num(a.current_temperature)
      const target = num(a.temperature)
      const action = str(a.hvac_action)
      const hum = num(a.current_humidity)
      return {
        available,
        ...((CLIMATE_MODES as readonly string[]).includes(mode) ? { mode } : {}),
        ...(current !== undefined ? { currentTempC: current } : {}),
        ...(target !== undefined ? { targetTempC: target } : {}),
        action: action && HVAC_ACTION[action] ? HVAC_ACTION[action] : null,
        humidity: hum !== undefined ? clampPct(hum) : null,
      } as StatePatch
    }
    case 'sensor': {
      const v = Number.parseFloat(s.state)
      return (Number.isFinite(v) ? { available, value: v } : { available: false }) as StatePatch
    }
    case 'media_player': {
      const title = str(a.media_title) ?? str(a.app_name) ?? str(a.source)
      const pic = str(a.entity_picture)
      const vol = num(a.volume_level)
      return {
        available,
        playback: PLAYBACK[s.state] ?? 'idle',
        ...(vol !== undefined ? { volume: clampPct(vol * 100) } : {}),
        ...(typeof a.is_volume_muted === 'boolean' ? { muted: a.is_volume_muted } : {}),
        nowPlaying: title && s.state !== 'off' ? {
          title,
          ...(str(a.media_artist) ? { artist: str(a.media_artist) } : {}),
          ...(str(a.media_album_name) ? { album: str(a.media_album_name) } : {}),
          ...(pic ? { artUrl: artUrlOf(s.entity_id, pic) } : {}),
          ...(num(a.media_duration) !== undefined ? { durationS: num(a.media_duration) } : {}),
          ...(num(a.media_position) !== undefined ? { positionS: num(a.media_position) } : {}),
          ...(str(a.source) ? { source: str(a.source) } : {}),
        } : null,
      } as StatePatch
    }
    default:
      return { available } as StatePatch
  }
}

// ---------------------------------------------------------------- commands

export interface ServiceCall {
  domain: string
  service: string
  data: Record<string, unknown>
  entityId: string
}

export class UnsupportedCommand extends Error {}

/** Kasbah command → HA service call. `quiet`: the cover goes through its slow twin. */
export function toServiceCall(t: Tracked, cmd: Command, quiet: boolean, climateModes: readonly string[] = []): ServiceCall {
  const call = (domain: string, service: string, data: Record<string, unknown> = {}, entityId = t.entityId): ServiceCall =>
    ({ domain, service, data, entityId })
  const motor = quiet && t.slowEntityId ? t.slowEntityId : t.entityId
  switch (cmd.type) {
    case 'light.set': {
      if (cmd.on === false) return call('light', 'turn_off', cmd.transitionMs !== undefined ? { transition: cmd.transitionMs / 1000 } : {})
      const data: Record<string, unknown> = {}
      if (cmd.brightness !== undefined) data.brightness_pct = clampPct(cmd.brightness)
      if (cmd.colorTempMirek !== undefined) data.color_temp_kelvin = Math.round(1e6 / cmd.colorTempMirek)
      if (cmd.color !== undefined) data.xy_color = [cmd.color.x, cmd.color.y]
      if (cmd.transitionMs !== undefined) data.transition = cmd.transitionMs / 1000
      return call('light', 'turn_on', data)
    }
    case 'cover.open': return call('cover', 'open_cover', {}, motor)
    case 'cover.close': return call('cover', 'close_cover', {}, motor)
    case 'cover.stop': return call('cover', 'stop_cover', {}, motor)
    case 'cover.set_position': return call('cover', 'set_cover_position', { position: clampPct(cmd.position) }, motor)
    case 'cover.set_tilt': return call('cover', 'set_cover_tilt_position', { tilt_position: clampPct(cmd.tilt) })
    case 'climate.set_mode': {
      const mode = cmd.mode === 'auto' && !climateModes.includes('auto') && climateModes.includes('heat_cool') ? 'heat_cool' : cmd.mode
      return call('climate', 'set_hvac_mode', { hvac_mode: mode })
    }
    case 'climate.set_target_temp': return call('climate', 'set_temperature', { temperature: cmd.targetTempC })
    case 'media_player.play': return call('media_player', 'media_play')
    case 'media_player.pause': return call('media_player', 'media_pause')
    case 'media_player.stop': return call('media_player', 'media_stop')
    case 'media_player.next': return call('media_player', 'media_next_track')
    case 'media_player.previous': return call('media_player', 'media_previous_track')
    case 'media_player.set_volume': return call('media_player', 'volume_set', { volume_level: clampPct(cmd.volume) / 100 })
    case 'media_player.set_mute': return call('media_player', 'volume_mute', { is_volume_muted: cmd.muted })
    case 'media_player.seek': return call('media_player', 'media_seek', { seek_position: cmd.positionS })
    default:
      throw new UnsupportedCommand(`${cmd.type} is not handled by the Home Assistant plugin`)
  }
}
