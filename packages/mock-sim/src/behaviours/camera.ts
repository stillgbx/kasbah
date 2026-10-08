import type { CameraClass, Capability } from '@kasbah/shared'
import type { SimDevice } from '../types'
import { descriptor, inWindow } from './common'

export interface CameraOptions {
  name: string
  deviceClass: CameraClass
  /**
   * Heures locales où la sonnette SONNE, une fois par jour chacune (le facteur, un livreur). Une
   * sonnette qui sonnerait au hasard prendrait la main sur l'écran pendant qu'on regarde autre
   * chose : la démo garde des passages rares et prévisibles. Ignoré hors sonnette.
   */
  rings?: number[]
}

/**
 * Caméra sans flux : la simulation n'a pas de vidéo à servir, donc elle ne déclare pas
 * `live_stream` (et la vue dit « pas de flux » au lieu d'attendre une image). Ce qu'elle montre,
 * c'est la NATURE de l'appareil — caméra, sonnette, écran — et, pour une sonnette, le coup de
 * sonnette, qui est un événement et non un état.
 */
export function camera(externalId: string, o: CameraOptions): SimDevice<'camera'> {
  const caps: Capability[] = o.deviceClass === 'doorbell' ? ['chime'] : []
  const rings = o.deviceClass === 'doorbell' ? o.rings ?? [] : []
  const rungOn = new Map<number, number>()
  const dev: SimDevice<'camera'> = {
    descriptor: descriptor(externalId, 'camera', o.name, caps, {
      manufacturer: 'Mock', model: o.deviceClass === 'doorbell' ? 'Video doorbell' : o.deviceClass === 'display' ? 'Smart display' : 'Outdoor camera',
      camera: { deviceClass: o.deviceClass },
    }),
    state: { kind: 'camera', updatedAt: 0, available: true },
    tick(ctx) {
      const day = Math.floor(ctx.simTime / 86_400_000)
      for (const h of rings) {
        // fenêtre d'une minute : un pas de simulation tombe forcément dedans (pas maximal 60 s)
        if (inWindow(ctx.hour, h, h + 1 / 60) && rungOn.get(h) !== day) {
          rungOn.set(h, day)
          ctx.emitEvent?.('chime')
        }
      }
    },
  }
  return dev
}
