import { PANEL_PEAK_W, panelDeviceId, type DeviceDescriptor, type DeviceEntry, type PanelArray } from '@kasbah/shared'

// Une installation publie PLUSIEURS appareils `energy` : le site, qui mesure production,
// consommation et réseau, et une batterie par unité de stockage. Prendre « le premier `energy`
// trouvé » donnait donc une batterie dès qu'il y en avait une, et la vue Énergie affichait 0 W de
// production avec une charge à 100 %. Ce qui distingue le site, c'est qu'il mesure le RÉSEAU.

/** Le site d'une installation : lui seul déclare `grid`. Une batterie n'a que `storage`. */
export function isEnergySite(descriptor: DeviceDescriptor): boolean {
  return descriptor.kind === 'energy' && descriptor.capabilities.includes('grid')
}

/**
 * Le site parmi les appareils connus. Repli sur le premier `energy` venu si aucun ne déclare le
 * réseau : une passerelle sans compteur vaut mieux que rien du tout.
 */
export function findEnergySite(list: readonly DeviceEntry[]): DeviceEntry | undefined {
  return list.find((e) => isEnergySite(e.descriptor)) ?? list.find((e) => e.descriptor.kind === 'energy')
}

/** Les unités de stockage : des `energy` qui ne mesurent pas le réseau. */
export function findBatteries(list: readonly DeviceEntry[]): DeviceEntry[] {
  return list.filter((e) => e.descriptor.kind === 'energy' && !isEnergySite(e.descriptor))
}

// --- Onduleurs d'une installation, rangés par champ ---------------------------------------------
// Un micro-onduleur est publié comme un CAPTEUR de puissance (un par module) : c'est `house.arrays`
// qui dit lequel est posé où. La vue Énergie les redessine donc en GRILLE, rangées et colonnes du
// champ — la même vue que la scène 3D, en texte : une case correspond à un module du toit, au même
// endroit. Une liste à plat de vingt numéros de série ne dit rien du toit réel.

/** Une case du champ : sa place (comptée depuis 1), et l'onduleur qui s'y trouve — ou personne. */
export interface InverterCell {
  /** Identifiant de l'EMPLACEMENT (`panelDeviceId`) : stable même quand la case est vide. */
  key: string
  id: string | null
  /** Nom publié par le plugin (« Onduleur 09158 »), vide pour une case sans onduleur. */
  name: string
  /** Fin du numéro de série, comme dans la grille du panneau de réglage ; sinon la place (« 2-5 »). */
  label: string
  row: number
  col: number
  watts: number
  available: boolean
  /** Record de l'onduleur (W, 0 = il n'en publie pas) : sa plus haute valeur jamais rapportée. */
  maxW: number
}

/**
 * Les onduleurs d'un champ, en grille. `index` = rang du champ dans la liste reçue, `null` pour le
 * groupe des orphelins (une seule colonne : ils n'ont pas de place à montrer).
 */
export interface InverterGroup {
  id: string
  name: string | null
  index: number | null
  rows: number
  cols: number
  /** `rows × cols` cases, rangée par rangée : la grille du champ, trous compris. */
  cells: InverterCell[]
  totalW: number
  /** Crête d'un module du champ (Wc), telle que déclarée. */
  peakW: number
  /**
   * Échelle des jauges du champ : la plus grande des trois valeurs en jeu — crête du module,
   * puissance de sortie de l'onduleur, meilleur record de ses onduleurs. Sans ça, un repère plus
   * haut que la crête du verre disparaissait sans rien dire : un IQ8P à 480 W sous un module de
   * 450 Wc, et le plafond n'était nulle part.
   */
  scaleW: number
  /**
   * Puissance de sortie max des onduleurs du champ (W, 0 = inconnue) : le plafond de ce qu'une case
   * peut afficher. Marqué d'un repère sur la jauge — sans lui, une jauge qui s'arrête aux trois
   * quarts par beau temps se lit comme un défaut alors que c'est l'onduleur qui est au taquet.
   */
  maxOutputW: number
}

/** Les capteurs de puissance de l'installation : un par micro-onduleur (voir `freeInverters`). */
export function isInverter(descriptor: DeviceDescriptor, pluginId: string): boolean {
  return descriptor.kind === 'sensor' && descriptor.meta.sensor?.deviceClass === 'power' && descriptor.pluginId === pluginId
}

/**
 * Fin de l'identifiant du fabricant : de quoi reconnaître un onduleur dans une case. CINQ caractères,
 * la même longueur que celle des noms publiés par le plugin (« Onduleur 09158 ») — la grille de
 * réglage d'un champ et celle de la vue Énergie coupent le numéro de série au même endroit, et se
 * lisent donc l'une avec l'autre.
 */
const SHORT_SERIAL = 5
export function shortInverterId(deviceId: string): string {
  const ext = deviceId.split(':')[1] ?? deviceId
  // la FIN DES CHIFFRES quand il y en a (un numéro de série se retrouve par ses derniers chiffres) ;
  // à défaut la fin de l'identifiant, sans ponctuation
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
    // un onduleur muet (la nuit, ou en panne) ne vaut pas zéro : il ne dit rien, et la case le dit
    watts: state?.available ? state.value : 0,
    available: !!state?.available,
    // le record survit à l'indisponibilité : il ne décrit pas l'instant, et la nuit ne l'efface pas
    maxW: state?.maxValue ?? 0,
  }
}

/**
 * Les onduleurs groupés par champ, chaque groupe en grille `rows × cols` rangée par rangée — l'ordre
 * de `panels`, celui des modules dérivés (`panelArrayDevices`), donc celui de la scène 3D : la
 * rangée 1 est celle de l'origine du champ, la colonne 1 son premier module. Les emplacements vides
 * gardent leur case, sinon la grille ne ressemblerait plus au toit. Un champ dont AUCUN emplacement
 * n'est équipé ne fait pas de groupe ; les onduleurs qu'aucun champ ne porte se retrouvent dans un
 * dernier groupe anonyme (`index: null`), triés par nom — sinon ils disparaîtraient de la vue.
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
      // un identifiant écrit dans la maison dont le plugin ne publie rien : la case reste vide
      const entry = id ? byId.get(id) : undefined
      const cell = toCell(panelDeviceId(a.id, row - 1, col - 1), row, col, entry)
      if (entry) { bound++; totalW += cell.watts }
      cells.push(cell)
    }
    if (bound > 0) {
      const scaleW = Math.max(a.panel.peakW, a.maxOutputW, ...cells.map((c) => c.maxW))
      groups.push({ id: a.id, name: a.name ?? null, index, rows: a.rows, cols: a.cols, cells, totalW, peakW: a.panel.peakW, maxOutputW: a.maxOutputW, scaleW })
    }
  })
  const loose = inverters
    .filter((e) => !placed.has(e.descriptor.id))
    .sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name, undefined, { numeric: true }))
    .map((e, i) => toCell(e.descriptor.id, i + 1, 1, e))
  if (loose.length > 0) {
    // une seule colonne : sans champ, aucune place à dessiner. La crête par défaut, faute de module
    // déclaré, et aucun écrêtage — personne ne dit quels onduleurs sont derrière.
    groups.push({
      id: '', name: null, index: null, rows: loose.length, cols: 1, cells: loose, totalW: sumW(loose),
      peakW: PANEL_PEAK_W, maxOutputW: 0, scaleW: Math.max(PANEL_PEAK_W, ...loose.map((c) => c.maxW)),
    })
  }
  return groups
}

const sumW = (cells: readonly InverterCell[]) => cells.reduce((s, c) => s + c.watts, 0)
