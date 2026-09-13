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
  /** Puissance crête du module (Wc) : l'échelle à laquelle sa dalle et sa ligne se colorent. */
  peakW: number
  /** Puissance de sortie max de l'onduleur du champ (W, 0 = inconnue) : le plafond de sa jauge. */
  maxOutputW: number
  /**
   * Inclinaison RÉELLE du verre (degrés) : la pente du support plus l'angle du châssis, car c'est
   * l'angle que la scène doit dessiner. Positive, le verre penche vers +y local — l'azimut du champ,
   * là où on l'a tourné pour prendre le soleil.
   */
  tilt: number
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Id d'appareil maison d'un emplacement : `<champ>.r<rangée>c<colonne>`. */
export function panelDeviceId(arrayId: string, row: number, col: number): string {
  return `${arrayId}.r${row}c${col}`
}

/**
 * Un appareil par emplacement du champ, centré sur son module. Repère local du champ : colonnes le
 * long de +x, rangées le long de +y, tourné de `yaw` autour de l'origine — et `yaw` est l'AZIMUT,
 * la direction vers laquelle les modules regardent. Les rangées s'en vont donc vers le soleil, et
 * DESCENDENT la pente du support en chemin : l'origine est le coin haut du champ.
 *
 * Deux angles, et un seul déplace quoi que ce soit : `slope`, la pente du support, parce que c'est le
 * toit qui s'incline sous le champ. `tilt` ne déplace rien — il redresse chaque module sur place, sur
 * son châssis — et ne compte que dans l'inclinaison dessinée (`meta.panel.tilt`). Sans cette
 * séparation, incliner les modules d'un toit PLAT les faisait monter en escalier.
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
      const flat = ly * ct                                   // ce que la rangée avance vu du ciel
      const position: Vec3 = [
        array.origin[0] + lx * cy - flat * sy,
        array.origin[1] + lx * sy + flat * cy,
        array.origin[2] - ly * st,                           // …et ce qu'elle descend en chemin
      ]
      // le verre regarde la somme des deux : la pente qu'il épouse, plus le châssis qui le redresse
      const panel: PanelPlacement = { arrayId: array.id, row, col, width, height, peakW, maxOutputW: array.maxOutputW, tilt: Math.min(90, array.slope + array.tilt) }
      out.push({
        id: panelDeviceId(array.id, row, col),
        ...(deviceId ? { deviceId } : {}),
        // Un emplacement LIÉ n'a pas de nom propre : il prend celui de son onduleur (le descripteur
        // du fabricant). Sans onduleur, le marqueur tombait sur l'identifiant interne (« pv.r4c1 ») :
        // il porte sa PLACE dans la grille, donnée par l'appelant, seul à savoir la traduire.
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
 * La maison avec les modules de ses champs ajoutés à `devices` (la maison d'origine si elle n'a aucun
 * champ). `nameSlot` nomme les emplacements SANS onduleur : l'app y met leur place dans la grille,
 * traduite ; sans lui ils n'ont pas de nom et tombent sur leur identifiant.
 */
export function withPanelArrays(house: House, nameSlot?: (row: number, col: number) => string): House {
  if (house.arrays.length === 0) return house
  return { ...house, devices: [...house.devices, ...house.arrays.flatMap((a) => panelArrayDevices(a, nameSlot))] }
}

/** Le module derrière un appareil dérivé d'un champ, sinon `undefined`. */
export function panelOf(device: HouseDevice): PanelPlacement | undefined {
  const p = device.meta?.panel
  return p && typeof p === 'object' && 'arrayId' in p ? (p as PanelPlacement) : undefined
}
