import type { DeviceDescriptor, DeviceKind } from '@kasbah/shared'

// Jeu d'icônes « trait » (24×24, stroke 1.8, arrondi) propre au langage visuel de l'app. Les
// chemins sont dessinés au trait (fill none) : voir components/ui/StrokeIcon.vue.

export const ICONS = {
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z',
  shutter: 'M4 3h16v18H4zM4 8h16M4 13h16M4 18h16',
  speaker: 'M6 3h12v18H6zM12 8.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 15.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  /** Renommer : crayon posé sur une ligne. */
  pencil: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l2 2',
  /** Rotation d'un quart de tour, sens horaire / antihoraire (orientation d'un écran). */
  rotateRight: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  rotateLeft: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5',
  /** Téléviseur (ou boîtier branché dessus) : écran sur pied. */
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  /** Médias (catégorie) : le glyphe cast — un écran et le flux qui y arrive. */
  cast: 'M3 8V5.5h18v13h-8M3 11.5a7 7 0 0 1 7 7M3 15.5a3 3 0 0 1 3 3M3.4 18.5m-.5 0a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0',
  /** Note de musique — vue YouTube Music (non officiel). */
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  /** Écran connecté (Nest Hub) : tablette posée, un trait pour le pied. */
  tablet: 'M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5zM9 20.5h6',
  thermostat: 'M12 3a2 2 0 0 1 2 2v9.2a4 4 0 1 1-4 0V5a2 2 0 0 1 2-2zM12 9v8',
  vacuum: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3',
  mower: 'M3 13h9l3-6h4v6h2M5 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17h8',
  heatpump: 'M3 6h18v12H3zM3 10h18M7 14h2M12 14h5',
  /**
   * Chauffage (rubrique du rail) : un RADIATEUR — corps, quatre ailettes verticales, deux pieds.
   * `heatpump` y servait et ne se lisait pas à 18 px : un rectangle barré d'un trait ressemble à
   * n'importe quel boîtier. Les ailettes sont VERTICALES et les pieds dépassent, pour ne pas se
   * confondre avec `shutter`, qui est le seul autre cadre à lignes du rail et les a horizontales.
   */
  radiator: 'M4.5 5.5h15v10h-15zM8.5 5.5v10M12 5.5v10M15.5 5.5v10M7 15.5v3M17 15.5v3',
  filtration: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11zM9 14a3 3 0 0 0 3 3',
  battery: 'M3 8h15v8H3zM18 10h3v4h-3M6 11h5v2H6',
  solar: 'M3 4h18l2 12H1zM8 4l-1 12M16 4l1 12M2 10h20M12 16v4M8 20h8',
  charger: 'M5 3h10v18H5zM15 8h2v6a2 2 0 0 0 4 0V9M11 7l-3 5h4l-2 5',
  vehicle: 'M3 13l2-5h14l2 5v5H3zM3 13h18M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  sensor: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3M12 18v3M3 12h3M18 12h3',
  home: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
  pin: 'M12 21c4-4.3 6-7.4 6-10.3A6 6 0 1 0 6 10.7C6 13.6 8 16.7 12 21z M12 10.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  gear: 'M9.8 4.9L10.2 2h3.6l.4 2.9 1.3.6 2.4-1.9 2.5 2.5-1.9 2.4.6 1.3 2.9.4v3.6l-2.9.4-.6 1.3 1.9 2.4-2.5 2.5-2.4-1.9-1.3.6-.4 2.9h-3.6l-.4-2.9-1.3-.6-2.4 1.9-2.5-2.5 1.9-2.4-.6-1.3L2 13.8v-3.6l2.9-.4.6-1.3L3.6 6.1l2.5-2.5 2.4 1.9zM12 12m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  auto: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 3v18M12 3a9 9 0 0 1 0 18',
  /* Apparence « Automatique » : un soleil posé sur l'horizon, pour la distinguer de `auto` (le
     disque mi-clair mi-sombre, qui dit « comme la tablette ») et de `sun` (l'apparence claire). */
  sunHorizon: 'M3 18h18M8 18a4 4 0 0 1 8 0M12 5v2.5M5.2 9.2l1.8 1.8M18.8 9.2l-1.8 1.8',
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  leave: 'M14 3h5v18h-5M10 17l5-5-5-5M15 12H3',
  night: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  movie: 'M3 6h18v12H3zM3 10h18M7 6v4M12 6v4M17 6v4',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  list: 'M4 6h16M4 12h16M4 18h16',
  play: 'M7 5l12 7-12 7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  move: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sparkle: 'M11 3l1.7 4.3L17 9l-4.3 1.7L11 15l-1.7-4.3L5 9l4.3-1.7zM17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13M10 11v6M14 11v6',

  // variantes d'état (voir deviceIcons.ts) et classes de capteur
  lightOn: 'M9 18h6M10 21h4M12 6a4.5 4.5 0 0 0-3 7.9c.5.5.8 1.1.8 2.1h4.4c0-1 .3-1.6.8-2.1A4.5 4.5 0 0 0 12 6zM12 1.5v1.6M4.6 5.1l1.2 1.2M19.4 5.1l-1.2 1.2M1.8 12.6h1.6M20.6 12.6h1.6',
  shutterOpen: 'M4 3h16v18H4zM4 6.5h16M4 10h16',
  speakerOn: 'M4 3h11v18H4zM9.5 8m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M9.5 15m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M18 9.5a5 5 0 0 1 0 5M20.8 7.5a8 8 0 0 1 0 9',
  devices: 'M3 5h11v9H3zM6 18h5M8.5 14v4M16 9h5v11h-5z',
  droplet: 'M12 3.5c3 3.7 5.5 6.6 5.5 9.4a5.5 5.5 0 0 1-11 0c0-2.8 2.5-5.7 5.5-9.4z',
  flask: 'M9 3h6M10 3v6.5L5.6 18a2 2 0 0 0 1.7 3h9.4a2 2 0 0 0 1.7-3L14 9.5V3M8 15h8',
  gauge: 'M4 17.5a8.5 8.5 0 1 1 16 0M12 14l3.5-3.5',
  waves: 'M3 9c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0 3 1.6 4.5 0M3 15c1.5-1.6 3-1.6 4.5 0s3 1.6 4.5 0 3-1.6 4.5 0 3 1.6 4.5 0',

  // contrôles d'appareil
  minus: 'M5 12h14',
  stop: 'M6 6h12v12H6z',
  skipPrev: 'M18 5v14L8 12zM6 5v14',
  skipNext: 'M6 5v14l10-7zM18 5v14',
  volume: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM15.8 9.5a4 4 0 0 1 0 5M18.6 7a7.5 7.5 0 0 1 0 10',
  volumeOff: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM16 9.5l5 5M21 9.5l-5 5',
  collapseUp: 'M4 4h16M12 20V9M8 13l4-4 4 4',
  collapseDown: 'M4 20h16M12 4v11M8 11l4 4 4-4',
  boltOff: 'M13 2L4 14h7l-1 8 9-12h-7zM3 3l18 18',
  homeBolt: 'M3 11l9-7 9 7v9H3zM12.6 10.2L10 14.4h2.3l-.7 3.4 3.4-4.4h-2.3z',
  grid: 'M12 3v18M6.5 21L12 5l5.5 16M7.8 15h8.4M9.2 10.5h5.6M9 3h6',
  parking: 'M5 3h14v18H5zM10 17V8h3a2.5 2.5 0 0 1 0 5h-3',
  crosshair: 'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M12 2v3M12 19v3M2 12h3M19 12h3M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  plug: 'M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3',
  plugOff: 'M9 3v6M15 3v5M6 9h12v3a6 6 0 0 1-9 5.2M12 18v3M3 3l18 18',
  lock: 'M6 10h12v11H6zM8.5 10V7a3.5 3.5 0 0 1 7 0v3M12 14v3',
  lockOpen: 'M6 10h12v11H6zM8.5 10V7a3.5 3.5 0 0 1 6.8-1.2M12 14v3',
  linkOff: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M3 3l18 18',
  wrench: 'M20.5 6.5a4.5 4.5 0 0 1-5.9 5.9L6.4 20.6a2 2 0 0 1-2.8-2.8l8.2-8.2a4.5 4.5 0 0 1 5.9-5.9l-3 3 2.8 2.8z',
  /** Recherche : la loupe. */
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M16 16l4.5 4.5',
  /** Une pièce, vue en plan : quatre murs et une ouverture. */
  room: 'M4 4h16v16H4zM4 10h5M15 4v6',
  /** Un niveau : des plans empilés. */
  layers: 'M12 3l9 4.5-9 4.5-9-4.5zM3 12.5l9 4.5 9-4.5M3 17l9 4.5 9-4.5',

  // états et alias Vuetify (voir plugins/icons.ts)
  check: 'M5 12.5l5 5L19 6.5',
  checkCircle: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8.5 12.5l2.5 2.5 4.5-5',
  alert: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7.5v5M12 16h.01',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v5M12 8h.01',
  minusCircle: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 12h8',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  arrowUp: 'M12 20V4M6 10l6-6 6 6',
  arrowDown: 'M12 4v16M6 14l6 6 6-6',
  unfold: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  eyedropper: 'M19.5 6.5a2.8 2.8 0 0 0-4-4l-2.3 2.3-1-1-1.5 1.5 6 6 1.5-1.5-1-1zM13.2 8.8L5 17v2h2l8.2-8.2',
  // « favori / mémorisé » : une pipette ou une coche ne se lisent pas à 16 px (essais rejetés)
  star: 'M12 3.5L14.1 9.4 20.4 9.6 15.4 13.4 17.2 19.4 12 15.9 6.8 19.4 8.6 13.4 3.6 9.6 9.9 9.4z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  // caméra de surveillance : corps incliné, objectif, bras de fixation au mur
  camera: 'M3.5 7.5l12.5-4 1.5 4.7-12.5 4zM5 12.2l.8 2.3M5.8 14.5h7.7M9.7 14.5V20M6 20h7.4M17.5 8.2l3.5-1.1',
  // sonnette : boîtier vertical, œil de caméra en haut, bouton en bas
  doorbell: 'M8 2.5h8v19H8zM12 8m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0M12 16.5m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0',
  // météo : un nuage commun à toute la famille, et ce qui en tombe ou ce qui l'accompagne
  cloud: 'M7 19h10.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.6 12.6 4 4 0 0 0 7 19z',
  cloudSun: 'M8 2.5V4M2.5 8H4M4.6 4.6l1 1M11.4 4.6l-1 1M5.4 9.6A3 3 0 0 1 10.6 7M9 20h9a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 7.8 14.6 3 3 0 0 0 9 20z',
  cloudMoon: 'M14 2.5a4 4 0 0 0 5.6 5.1 4.5 4.5 0 0 1-6.9-2.2M9 20h9a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 7.8 14.6 3 3 0 0 0 9 20z',
  drizzle: 'M7 15h10.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.6 8.6 4 4 0 0 0 7 15zM8 18v1.5M12 18v1.5M16 18v1.5M10 21v1.5M14 21v1.5',
  rain: 'M7 15h10.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.6 8.6 4 4 0 0 0 7 15zM8.5 18l-1 3.5M12.5 18l-1 3.5M16.5 18l-1 3.5',
  snow: 'M7 15h10.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.6 8.6 4 4 0 0 0 7 15zM8 18.5h.01M12 18.5h.01M16 18.5h.01M10 21.5h.01M14 21.5h.01',
  fog: 'M7 13h10.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.6 6.6 4 4 0 0 0 7 13zM5 17h14M7 21h10',
  thunder: 'M7 14h10.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.6 7.6 4 4 0 0 0 7 14zM13 15l-2.5 4h3L11 23',
  wind: 'M3 8h11a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h9a2 2 0 1 1-2 2',
} as const
export type IconName = keyof typeof ICONS

const KIND_ICON: Record<DeviceKind, IconName> = {
  light: 'light', cover: 'shutter', media_player: 'speaker', climate: 'heatpump', vacuum: 'vacuum', mower: 'mower',
  sensor: 'sensor', energy: 'solar', ev_charger: 'charger', vehicle: 'vehicle', camera: 'camera', weather: 'cloud', water: 'droplet',
}

export function kindIcon(kind: DeviceKind | undefined, descriptor?: DeviceDescriptor): IconName {
  if (!kind) return 'sensor'
  if (kind === 'camera' && descriptor?.meta.camera?.deviceClass === 'doorbell') return 'doorbell'
  if (kind === 'media_player' && descriptor?.meta.mediaPlayer?.deviceClass === 'tv') return 'tv'
  if (kind === 'media_player' && descriptor?.meta.mediaPlayer?.deviceClass === 'display') return 'tablet'
  if (kind === 'sensor' && descriptor?.meta.sensor?.deviceClass === 'temperature') return 'thermostat'
  if (kind === 'sensor' && (descriptor?.meta.sensor?.deviceClass === 'pressure' || descriptor?.meta.sensor?.deviceClass === 'flow')) return 'filtration'
  if (kind === 'energy' && descriptor?.capabilities.includes('storage') && !descriptor.capabilities.includes('production')) return 'battery'
  return KIND_ICON[kind]
}

/** Élément SVG autonome (pour les marqueurs DOM de la scène, hors Vue). */
export function iconSvg(name: IconName, size = 16, strokeWidth = 2): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', String(strokeWidth))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICONS[name])
  svg.appendChild(path)
  return svg
}
