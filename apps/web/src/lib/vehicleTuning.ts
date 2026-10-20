import type { DeviceDescriptor, HouseDevice, VehicleFinish } from '@kasbah/shared'
import { modelsFor } from '../three/models/catalog'

// What remains to be set by hand on a vehicle. Two surfaces ask the question — the card of
// the Vehicles view, to only offer "Adjust" to those who have something to adjust, and the selected
// device's panel, which shows the section or nothing — hence these rules written only once.

/**
 * The capacity is only asked of those who need it: a vehicle that SAYS its charging power
 * (`charge_power` capability) has nothing to get estimated, and a field that serves no purpose is a field
 * too many.
 */
export const needsCapacity = (descriptor: DeviceDescriptor): boolean => !descriptor.capabilities.includes('charge_power')

/**
 * The color to paint on the bodywork, in order of what is authoritative:
 *  1. the one the user has SET — a wrap, a repaint or a simple taste contradict
 *     the factory, and it is the user who looks at the scene;
 *  2. the one the plugin was able to DEDUCE from the reading (`meta.vehicle.color`);
 *  3. nothing — and the scene then applies its vehicle color, which follows the theme.
 *
 * Clearing the manual setting therefore falls back on what we know of the vehicle, not on the scene's
 * gray: that is the whole point of keeping both.
 */
export const bodyColorOf = (
  descriptor: DeviceDescriptor | undefined,
  houseDevice: Pick<HouseDevice, 'bodyColor'> | undefined,
): string | undefined => houseDevice?.bodyColor ?? descriptor?.meta.vehicle?.color

/** Same rule as the color, for the finish. Default: that of the scene's material, so nothing changes. */
export const bodyFinishOf = (
  descriptor: DeviceDescriptor | undefined,
  houseDevice: Pick<HouseDevice, 'bodyFinish'> | undefined,
): VehicleFinish => houseDevice?.bodyFinish ?? descriptor?.meta.vehicle?.finish ?? SCENE_FINISH

/**
 * What each finish is worth for a PBR material. These values only make sense with the vehicles'
 * environment map: without reflection, the metallic share renders nothing and the three
 * look alike.
 */
/** The finish the scene's vehicle material ALREADY carries: sticking to it means being able to share it. */
export const SCENE_FINISH: VehicleFinish = 'metallic'

export const FINISH_MATERIAL: Record<VehicleFinish, { metalness: number; roughness: number }> = {
  // non-metallic lacquer: glossy, but it is the varnish that shines, not the powder
  solid: { metalness: 0.15, roughness: 0.3 },
  metallic: { metalness: 0.55, roughness: 0.28 },
  // matte: it DIFFUSES, so no sharp sky on it — that is where the difference shows the most
  matte: { metalness: 0.25, roughness: 0.85 },
}

/**
 * Offset and rotation only concern a car placed by its GPS: the one PLACED by
 * hand in the house already holds its place and heading from the JSON. With no setting to offer, the
 * section — and the button that unfolds it — disappear.
 *
 * The 3D bodywork, for its part, is chosen for ANY vehicle for which the plugin delivers one, placed by
 * hand or not: it is an appearance choice, unrelated to how the car finds its
 * place.
 */
export const tunableVehicle = (descriptor: DeviceDescriptor, houseDevice: HouseDevice | undefined): boolean =>
  houseDevice?.position === undefined || needsCapacity(descriptor) || modelsFor(descriptor.pluginId, descriptor.meta.manufacturer).length > 0
