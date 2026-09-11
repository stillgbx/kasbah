import type { House, HouseDevice, PanelArray, Vec3 } from './schema'

// Champs de panneaux → appareils dérivés. Un module est un appareil de la maison comme un autre
// (sélectionnable, lié à son micro-onduleur, coloré par sa puissance), mais sa position n'est jamais
// écrite : elle se calcule depuis son champ. Le JSON reste à un objet par champ.

/** Ce qu'un module dérivé retient de son champ (porté par `HouseDevice.meta.panel`). */
export interface PanelPlacement {
  arrayId: string
  row: number
  col: number
  width: number
  height: number
  /** Inclinaison (degrés) : le module monte vers son +y local. */
  tilt: number
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Id d'appareil maison d'un emplacement : `<champ>.r<rangée>c<colonne>`. */
export function panelDeviceId(arrayId: string, row: number, col: number): string {
  return `${arrayId}.r${row}c${col}`
}

/**
 * Un appareil par emplacement du champ, centré sur son module. Repère local du champ : colonnes le
 * long de +x, rangées le long de +y, tourné de `yaw` autour de l'origine ; avec `tilt`, la rangée `r`
 * est plus haute que la précédente (le champ épouse une pente ou des châssis inclinés).
 */
export function panelArrayDevices(array: PanelArray): HouseDevice[] {
  const { width, height } = array.panel
  const cy = Math.cos(rad(array.yaw)), sy = Math.sin(rad(array.yaw))
  const ct = Math.cos(rad(array.tilt)), st = Math.sin(rad(array.tilt))
  const out: HouseDevice[] = []
  for (let row = 0; row < array.rows; row++) {
    for (let col = 0; col < array.cols; col++) {
      const deviceId = array.panels[row * array.cols + col] ?? null
      const lx = (col + 0.5) * (width + array.gap)
      const ly = (row + 0.5) * (height + array.gap)
      const flat = ly * ct
      const position: Vec3 = [
        array.origin[0] + lx * cy - flat * sy,
        array.origin[1] + lx * sy + flat * cy,
        array.origin[2] + ly * st,
      ]
      const panel: PanelPlacement = { arrayId: array.id, row, col, width, height, tilt: array.tilt }
      out.push({
        id: panelDeviceId(array.id, row, col),
        ...(deviceId ? { deviceId } : {}),
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

/** La maison avec les modules de ses champs ajoutés à `devices` (la maison d'origine si elle n'a aucun champ). */
export function withPanelArrays(house: House): House {
  if (house.arrays.length === 0) return house
  return { ...house, devices: [...house.devices, ...house.arrays.flatMap(panelArrayDevices)] }
}

/** Le module derrière un appareil dérivé d'un champ, sinon `undefined`. */
export function panelOf(device: HouseDevice): PanelPlacement | undefined {
  const p = device.meta?.panel
  return p && typeof p === 'object' && 'arrayId' in p ? (p as PanelPlacement) : undefined
}
