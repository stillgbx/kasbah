import { PANEL_PEAK_W, panelDeviceId, type DeviceDescriptor, type DeviceEntry, type PanelArray } from '@kasbah/shared'

// An installation publishes SEVERAL `energy` devices: the site, which measures production,
// consumption and grid, and one battery per storage unit. Taking "the first `energy`
// found" therefore gave a battery as soon as there was one, and the Energy view displayed 0 W of
// production with a charge at 100 %. What distinguishes the site is that it measures the GRID.

/**
 * Dead zone around zero: below it, nothing flows — a wire of the flow diagram must not
 * flicker, nor a battery cabinet pulse in the scene. The threshold is LOW, and it is a
 * measurement, not a reading comfort. Two readings on the real gateway set it:
 *
 *   - the clamps measure FINELY: `prod 25 − grid 5 + battery 1089 = cons 1109` closes to the watt.
 *     A "−5 W" can therefore be 5 W of real injection, and nothing requires a big threshold;
 *   - but they do not always agree: over eight consecutive readings, the balance leaves a remainder
 *     of 0 to 11 W. To which was added a production at −7 W at night (the inverters' standby read
 *     backwards), now brought back to 0 by the plugin itself.
 *
 * 10 W is therefore set at the level of this DISAGREEMENT between meters, not below it: lower, it is the
 * disagreement itself that we would draw as a flow. And it is still under an LED bulb, so
 * nothing the household would call a load is masked — 17 W of draw, measured, are displayed.
 * What remains is a dead zone around zero, just wide enough that "draw" and
 * "injection" do not swap from one reading to the next. Do NOT set this threshold on the Enphase
 * app (0.1 kW): it rounds, it does not measure.
 */
export const IDLE_W = 10

/** An installation's site: it alone declares `grid`. A battery only has `storage`. */
export function isEnergySite(descriptor: DeviceDescriptor): boolean {
  return descriptor.kind === 'energy' && descriptor.capabilities.includes('grid')
}

/**
 * The site among the known devices. Falls back to the first `energy` found if none declares the
 * grid: a gateway without a meter is better than nothing at all.
 */
export function findEnergySite(list: readonly DeviceEntry[]): DeviceEntry | undefined {
  return list.find((e) => isEnergySite(e.descriptor)) ?? list.find((e) => e.descriptor.kind === 'energy')
}

/** The storage units: `energy` devices that do not measure the grid. */
export function findBatteries(list: readonly DeviceEntry[]): DeviceEntry[] {
  return list.filter((e) => e.descriptor.kind === 'energy' && !isEnergySite(e.descriptor))
}

// --- Inverters of an installation, arranged by array ---------------------------------------------
// A micro-inverter is published as a power SENSOR (one per module): it is `house.arrays`
// that says which one is placed where. The Energy view therefore redraws them as a GRID, rows and columns of the
// array — the same view as the 3D scene, in text: a cell matches a module of the roof, in the same
// place. A flat list of twenty serial numbers says nothing about the real roof.

/** A cell of the array: its place (counted from 1), and the inverter found there — or nobody. */
export interface InverterCell {
  /** Identifier of the PLACE (`panelDeviceId`): stable even when the cell is empty. */
  key: string
  id: string | null
  /** Name published by the plugin ("Onduleur 09158"), empty for a cell without an inverter. */
  name: string
  /** End of the serial number, as in the settings panel's grid; otherwise the place ("2-5"). */
  label: string
  row: number
  col: number
  watts: number
  available: boolean
}

/**
 * The inverters of an array, as a grid. `index` = rank of the array in the received list, `null` for the
 * group of orphans (a single column: they have no place to show).
 */
export interface InverterGroup {
  id: string
  name: string | null
  index: number | null
  rows: number
  cols: number
  /** `rows × cols` cells, row by row: the array's grid, gaps included. */
  cells: InverterCell[]
  totalW: number
  /** Peak of one of the array's modules (Wp), as declared. */
  peakW: number
  /**
   * Scale of the array's gauges: the greater of module peak and inverter output power (the
   * view widens it to the records of the period it shows). Without it, a marker higher
   * than the glass's peak disappeared without a word: an IQ8P at 480 W under a
   * 450 Wp module, and the ceiling was nowhere.
   */
  scaleW: number
  /**
   * Max output power of the array's inverters (W, 0 = unknown): the ceiling of what a cell
   * can display. Marked with a tick on the gauge — without it, a gauge that stops at three
   * quarters in fine weather reads as a defect while it is the inverter that is maxed out.
   */
  maxOutputW: number
}

/** The installation's power sensors: one per micro-inverter (see `freeInverters`). */
export function isInverter(descriptor: DeviceDescriptor, pluginId: string): boolean {
  return descriptor.kind === 'sensor' && descriptor.meta.sensor?.deviceClass === 'power' && descriptor.pluginId === pluginId
}

/**
 * End of the vendor's identifier: enough to recognize an inverter in a cell. FIVE characters,
 * the same length as the names published by the plugin ("Onduleur 09158") — an array's
 * settings grid and that of the Energy view cut the serial number at the same place, and thus
 * read against each other.
 */
const SHORT_SERIAL = 5
export function shortInverterId(deviceId: string): string {
  const ext = deviceId.split(':')[1] ?? deviceId
  // the END OF THE DIGITS when there are some (a serial number is found by its last digits);
  // failing that the end of the identifier, without punctuation
  const digits = /\d+$/.exec(ext)?.[0]
  return (digits ?? ext.replace(/[^a-z0-9]/gi, '')).slice(-SHORT_SERIAL).toUpperCase()
}

function toCell(key: string, row: number, col: number, entry: DeviceEntry | undefined): InverterCell {
  const state = entry?.state.kind === 'sensor' ? entry.state : undefined
  return {
    key,
    id: entry?.descriptor.id ?? null,
    name: entry?.descriptor.name ?? '',
    label: entry ? shortInverterId(entry.descriptor.id) : `${row}-${col}`,
    row,
    col,
    // a mute inverter (at night, or broken) is not worth zero: it says nothing, and the cell says so
    watts: state?.available ? state.value : 0,
    available: !!state?.available,
  }
}

/**
 * The inverters grouped by array, each group as a `rows × cols` grid row by row — the order
 * of `panels`, that of the derived modules (`panelArrayDevices`), hence that of the 3D scene: row 1
 * is the one at the array's origin, column 1 its first module. Empty places
 * keep their cell, otherwise the grid would no longer look like the roof. An array with NO place
 * equipped makes no group; the inverters that no array carries end up in a
 * last anonymous group (`index: null`), sorted by name — otherwise they would vanish from the view.
 */
export function inverterGroups(arrays: readonly PanelArray[], inverters: readonly DeviceEntry[]): InverterGroup[] {
  const byId = new Map(inverters.map((e) => [e.descriptor.id, e]))
  const placed = new Set<string>()
  const groups: InverterGroup[] = []
  arrays.forEach((a, index) => {
    const cells: InverterCell[] = []
    let bound = 0
    let totalW = 0
    for (let i = 0; i < a.rows * a.cols; i++) {
      const row = Math.floor(i / a.cols) + 1, col = (i % a.cols) + 1
      const id = a.panels[i] ?? null
      if (id) placed.add(id)
      // an identifier written in the house for which the plugin publishes nothing: the cell stays empty
      const entry = id ? byId.get(id) : undefined
      const cell = toCell(panelDeviceId(a.id, row - 1, col - 1), row, col, entry)
      if (entry) { bound++; totalW += cell.watts }
      cells.push(cell)
    }
    if (bound > 0) {
      const scaleW = Math.max(a.panel.peakW, a.maxOutputW)
      groups.push({ id: a.id, name: a.name ?? null, index, rows: a.rows, cols: a.cols, cells, totalW, peakW: a.panel.peakW, maxOutputW: a.maxOutputW, scaleW })
    }
  })
  const loose = inverters
    .filter((e) => !placed.has(e.descriptor.id))
    .sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name, undefined, { numeric: true }))
    .map((e, i) => toCell(e.descriptor.id, i + 1, 1, e))
  if (loose.length > 0) {
    // a single column: without an array, no place to draw. The default peak, for lack of a declared
    // module, and no clipping — nobody says which inverters are behind.
    groups.push({
      id: '', name: null, index: null, rows: loose.length, cols: 1, cells: loose, totalW: sumW(loose),
      peakW: PANEL_PEAK_W, maxOutputW: 0, scaleW: PANEL_PEAK_W,
    })
  }
  return groups
}

const sumW = (cells: readonly InverterCell[]) => cells.reduce((s, c) => s + c.watts, 0)
