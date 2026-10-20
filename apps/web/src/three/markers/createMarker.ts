import type { DeviceState, PlacedHouseDevice } from '@kasbah/shared'
import { panelOf } from '@kasbah/shared'
import type { DeviceMarker, MarkerContext } from './DeviceMarker'
import { CoverMarker, GenericMarker, LightMarker, MowerMarker, PanelMarker, VehicleMarker } from './markers'

export function createMarker(device: PlacedHouseDevice, ctx: MarkerContext, atHome: (state: DeviceState) => boolean): DeviceMarker {
  // a module of a panel array is a `sensor` like any other: its shape comes from its array, not its kind
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
