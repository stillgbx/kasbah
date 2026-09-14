import type { DeviceState, PlacedHouseDevice } from '@kasbah/shared'
import { panelOf } from '@kasbah/shared'
import type { DeviceMarker, MarkerContext } from './DeviceMarker'
import { CoverMarker, GenericMarker, LightMarker, MowerMarker, PanelMarker, VehicleMarker } from './markers'

export function createMarker(device: PlacedHouseDevice, ctx: MarkerContext, atHome: (state: DeviceState) => boolean): DeviceMarker {
  // un module d'un champ de panneaux est un `sensor` comme un autre : sa forme vient de son champ, pas de son kind
  const panel = panelOf(device)
  if (panel) return new PanelMarker(device, ctx, panel)
  const kind = ctx.descriptor?.kind ?? device.kind
  switch (kind) {
    case 'light': return new LightMarker(device, ctx)
    case 'cover': return new CoverMarker(device, ctx)
    case 'vehicle': return new VehicleMarker(device, ctx, atHome)
    case 'mower': return new MowerMarker(device, ctx)
    default: return new GenericMarker(device, ctx)
  }
}
