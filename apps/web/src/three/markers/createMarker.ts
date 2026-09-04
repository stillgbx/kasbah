import type { DeviceState, HouseDevice } from '@kasbah/shared'
import type { DeviceMarker, MarkerContext } from './DeviceMarker'
import { CoverMarker, GenericMarker, LightMarker, MowerMarker, VehicleMarker } from './markers'

export function createMarker(device: HouseDevice, ctx: MarkerContext, atHome: (state: DeviceState) => boolean): DeviceMarker {
  const kind = ctx.descriptor?.kind ?? device.kind
  switch (kind) {
    case 'light': return new LightMarker(device, ctx)
    case 'cover': return new CoverMarker(device, ctx)
    case 'vehicle': return new VehicleMarker(device, ctx, atHome)
    case 'mower': return new MowerMarker(device, ctx)
    default: return new GenericMarker(device, ctx)
  }
}
