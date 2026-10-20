import type { DeviceState, HouseDevice } from '@kasbah/shared'
import { isMediaActive } from './deviceState'

// A player's sound does not always come out of it: a TV plugged by HDMI ARC into a soundbar makes
// the bar play — which, seen by its own plugin, is at rest. The link is DECLARED in house.json, on
// the SOURCE device: `meta.audioOutput` = the HOUSE id of the device that plays its sound (the bar). The
// source, when it can say so (`state.audioOutput.terminal`, Sony TV), confirms or denies: set
// to its own speakers, the link does not apply; silent on that, we believe the declaration.
//
// Everything that "makes noise" in the UI (3D scene wave, pulsing dot, icon tint) goes
// through here; the published state, for its part, stays what each device says about itself.

export interface SoundRouting {
  /** Sink (plugin id) → source (plugin id) whose sound it is playing right now. */
  relays: Map<string, string>
  /** Active sources whose sound comes out elsewhere: no wave on them. */
  silenced: Set<string>
}

const NONE: SoundRouting = { relays: new Map(), silenced: new Set() }

export function soundRouting(devices: readonly HouseDevice[], states: Record<string, DeviceState>): SoundRouting {
  const byId = new Map(devices.map((d) => [d.id, d] as const))
  let out: SoundRouting | null = null
  for (const src of devices) {
    const sinkHouseId = src.meta?.audioOutput
    if (typeof sinkHouseId !== 'string' || !src.deviceId) continue
    const sink = byId.get(sinkHouseId)
    if (!sink?.deviceId) continue
    const s = states[src.deviceId]
    if (!s || s.kind !== 'media_player' || !s.available || !isMediaActive(s)) continue
    const terminal = s.audioOutput?.terminal
    if (terminal === 'internal') continue                        // the TV plays on its speakers: the link does not apply
    out ??= { relays: new Map(), silenced: new Set() }
    out.relays.set(sink.deviceId, src.deviceId)
    if (terminal !== 'both') out.silenced.add(src.deviceId)
  }
  return out ?? NONE
}

/**
 * The device MAKES NOISE: its own playback when the sound comes out of it, or the one it relays. A TV
 * that says it sends its sound elsewhere goes quiet here, whether a link is declared or not — the picture stays with it.
 */
export function emitsSound(id: string, state: DeviceState | undefined, routing: SoundRouting): boolean {
  if (routing.relays.has(id)) return true
  if (!state || state.kind !== 'media_player' || !state.available || !isMediaActive(state)) return false
  return state.audioOutput?.terminal !== 'external' && !routing.silenced.has(id)
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/** Status label of a device that relays: "Sound from TV Living room · Cs60". */
export function relayLabel(sourceName: string, source: DeviceState, t: Translate): string {
  const title = source.kind === 'media_player' ? source.nowPlaying?.title : undefined
  return `${t('media.relaying', { name: sourceName })}${title ? ` · ${title}` : ''}`
}
