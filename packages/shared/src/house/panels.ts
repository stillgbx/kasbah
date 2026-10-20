import type { House, HouseDevice, PanelArray, Vec3 } from './schema'

// Panel arrays → derived devices. A module is a device of the house like any other
// (selectable, linked to its microinverter, colored by its power), but its position is never
// written: it is computed from its array. The JSON stays at one object per array.

/** What a derived module keeps from its array (carried by `HouseDevice.meta.panel`). */
export interface PanelPlacement {
  arrayId: string
  row: number
  col: number
  width: number
  height: number
  /** Peak power of the module (Wp): the scale on which its slab and its line are colored. */
  peakW: number
  /** Maximum output power of the array's inverter (W, 0 = unknown): the ceiling of its gauge. */
  maxOutputW: number
  /**
   * REAL tilt of the glass (degrees): the slope of the support plus the angle of the frame, because it is
   * the angle the scene must draw. Positive, the glass leans toward local +y — the azimuth of the array,
   * where it was rotated to catch the sun.
   */
  tilt: number
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** House device id of a slot: `<array>.r<row>c<column>`. */
export function panelDeviceId(arrayId: string, row: number, col: number): string {
  return `${arrayId}.r${row}c${col}`
}

/**
 * One device per slot of the array, centered on its module. Local frame of the array: columns
 * along +x, rows along +y, rotated by `yaw` around the origin — and `yaw` is the AZIMUTH,
 * the direction the modules face. The rows therefore go toward the sun, and
 * DESCEND the slope of the support on the way: the origin is the top corner of the array.
 *
 * Two angles, and only one moves anything: `slope`, the slope of the support, because it is the
 * roof that tilts under the array. `tilt` moves nothing — it tilts each module in place, on
 * its frame — and only counts in the drawn tilt (`meta.panel.tilt`). Without this
 * separation, tilting the modules of a FLAT roof made them climb like stairs.
 */
export function panelArrayDevices(array: PanelArray, nameSlot?: (row: number, col: number) => string): HouseDevice[] {
  const { width, height, peakW } = array.panel
  const cy = Math.cos(rad(array.yaw)), sy = Math.sin(rad(array.yaw))
  const ct = Math.cos(rad(array.slope)), st = Math.sin(rad(array.slope))
  const out: HouseDevice[] = []
  for (let row = 0; row < array.rows; row++) {
    for (let col = 0; col < array.cols; col++) {
      const deviceId = array.panels[row * array.cols + col] ?? null
      const lx = (col + 0.5) * (width + array.gap)
      const ly = (row + 0.5) * (height + array.gap)
      const flat = ly * ct                                   // what the row advances seen from the sky
      const position: Vec3 = [
        array.origin[0] + lx * cy - flat * sy,
        array.origin[1] + lx * sy + flat * cy,
        array.origin[2] - ly * st,                           // …and what it descends on the way
      ]
      // the glass faces the sum of the two: the slope it hugs, plus the frame that tilts it
      const panel: PanelPlacement = { arrayId: array.id, row, col, width, height, peakW, maxOutputW: array.maxOutputW, tilt: Math.min(90, array.slope + array.tilt) }
      out.push({
        id: panelDeviceId(array.id, row, col),
        ...(deviceId ? { deviceId } : {}),
        // A LINKED slot has no name of its own: it takes that of its inverter (the vendor's descriptor).
        // Without an inverter, the marker fell back on the internal identifier ("pv.r4c1"):
        // it carries its PLACE in the grid, given by the caller, the only one able to translate it.
        ...(!deviceId && nameSlot ? { name: nameSlot(row, col) } : {}),
        kind: 'sensor',
        position,
        levelId: array.levelId,
        mount: 'free',
        yaw: array.yaw,
        meta: { panel },
      })
    }
  }
  return out
}

/**
 * The house with the modules of its arrays added to `devices` (the original house if it has no
 * array). `nameSlot` names the slots WITHOUT an inverter: the app puts their place in the grid there,
 * translated; without it they have no name and fall back on their identifier.
 */
export function withPanelArrays(house: House, nameSlot?: (row: number, col: number) => string): House {
  if (house.arrays.length === 0) return house
  return { ...house, devices: [...house.devices, ...house.arrays.flatMap((a) => panelArrayDevices(a, nameSlot))] }
}

/** The module behind a device derived from an array, otherwise `undefined`. */
export function panelOf(device: HouseDevice): PanelPlacement | undefined {
  const p = device.meta?.panel
  return p && typeof p === 'object' && 'arrayId' in p ? (p as PanelPlacement) : undefined
}
