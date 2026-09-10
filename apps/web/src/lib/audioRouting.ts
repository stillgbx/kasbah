import type { DeviceState, HouseDevice } from '@kasbah/shared'
import { isMediaActive } from './deviceState'

// Le son d'un lecteur ne sort pas toujours de lui : une TV branchée en HDMI ARC sur une barre de son fait
// jouer la barre — qui, vue par son propre plugin, est au repos. Le lien est DÉCLARÉ dans house.json, sur
// l'appareil SOURCE : `meta.audioOutput` = l'id MAISON de l'appareil qui joue son son (la barre). La
// source, quand elle sait le dire (`state.audioOutput.terminal`, TV Sony), confirme ou infirme : réglée
// sur ses propres haut-parleurs, le lien ne joue pas ; muette là-dessus, on croit la déclaration.
//
// Tout ce qui « fait du bruit » dans l'UI (onde de la scène 3D, point pulsant, teinte de l'icône) passe
// par ici ; l'état publié, lui, reste ce que chaque appareil dit de lui-même.

export interface SoundRouting {
  /** Puits (id plugin) → source (id plugin) dont il joue le son en ce moment. */
  relays: Map<string, string>
  /** Sources actives dont le son sort ailleurs : pas d'onde chez elles. */
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
    if (terminal === 'internal') continue                        // la TV joue sur ses haut-parleurs : le lien ne sert pas
    out ??= { relays: new Map(), silenced: new Set() }
    out.relays.set(sink.deviceId, src.deviceId)
    if (terminal !== 'both') out.silenced.add(src.deviceId)
  }
  return out ?? NONE
}

/**
 * L'appareil FAIT DU BRUIT : sa propre lecture quand le son sort de lui, ou celle qu'il relaie. Une TV
 * qui dit envoyer son son ailleurs se tait ici, qu'un lien soit déclaré ou non — l'image reste chez elle.
 */
export function emitsSound(id: string, state: DeviceState | undefined, routing: SoundRouting): boolean {
  if (routing.relays.has(id)) return true
  if (!state || state.kind !== 'media_player' || !state.available || !isMediaActive(state)) return false
  return state.audioOutput?.terminal !== 'external' && !routing.silenced.has(id)
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/** Libellé d'état d'un appareil qui relaie : « Son de TV Salon · Cs60 ». */
export function relayLabel(sourceName: string, source: DeviceState, t: Translate): string {
  const title = source.kind === 'media_player' ? source.nowPlaying?.title : undefined
  return `${t('media.relaying', { name: sourceName })}${title ? ` · ${title}` : ''}`
}
