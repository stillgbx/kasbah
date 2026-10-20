import type { CameraClass, Capability } from '@kasbah/shared'
import type { SimDevice } from '../types'
import { descriptor, inWindow } from './common'

export interface CameraOptions {
  name: string
  deviceClass: CameraClass
  /**
   * Local hours at which the doorbell RINGS, once a day each (the mail carrier, a delivery person).
   * A doorbell that rang at random would grab the screen while one is looking at something else:
   * the demo keeps rare, predictable visits. Ignored outside a doorbell.
   */
  rings?: number[]
}

/**
 * Camera without a stream: the simulation has no video to serve, so it does not declare
 * `live_stream` (and the view says "no stream" instead of waiting for an image). What it shows is
 * the NATURE of the device — camera, doorbell, display — and, for a doorbell, the ring, which is
 * an event and not a state.
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
        // one-minute window: a simulation step always falls inside it (max step 60 s)
        if (inWindow(ctx.hour, h, h + 1 / 60) && rungOn.get(h) !== day) {
          rungOn.set(h, day)
          ctx.emitEvent?.('chime')
        }
      }
    },
  }
  return dev
}
