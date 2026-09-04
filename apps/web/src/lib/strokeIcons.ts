import type { DeviceDescriptor, DeviceKind } from '@kasbah/shared'

// Jeu d'icônes « trait » (24×24, stroke 1.8, arrondi) propre au langage visuel de l'app. Les
// chemins sont dessinés au trait (fill none) : voir components/ui/StrokeIcon.vue.

export const ICONS = {
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z',
  shutter: 'M4 3h16v18H4zM4 8h16M4 13h16M4 18h16',
  speaker: 'M6 3h12v18H6zM12 8.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 15.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  thermostat: 'M12 3a2 2 0 0 1 2 2v9.2a4 4 0 1 1-4 0V5a2 2 0 0 1 2-2zM12 9v8',
  vacuum: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3',
  mower: 'M3 13h9l3-6h4v6h2M5 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17h8',
  heatpump: 'M3 6h18v12H3zM3 10h18M7 14h2M12 14h5',
  filtration: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11zM9 14a3 3 0 0 0 3 3',
  battery: 'M3 8h15v8H3zM18 10h3v4h-3M6 11h5v2H6',
  solar: 'M3 4h18l2 12H1zM8 4l-1 12M16 4l1 12M2 10h20M12 16v4M8 20h8',
  charger: 'M5 3h10v18H5zM15 8h2v6a2 2 0 0 0 4 0V9M11 7l-3 5h4l-2 5',
  vehicle: 'M3 13l2-5h14l2 5v5H3zM3 13h18M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  sensor: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3M12 18v3M3 12h3M18 12h3',
  home: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  gear: 'M9.8 4.9L10.2 2h3.6l.4 2.9 1.3.6 2.4-1.9 2.5 2.5-1.9 2.4.6 1.3 2.9.4v3.6l-2.9.4-.6 1.3 1.9 2.4-2.5 2.5-2.4-1.9-1.3.6-.4 2.9h-3.6l-.4-2.9-1.3-.6-2.4 1.9-2.5-2.5 1.9-2.4-.6-1.3L2 13.8v-3.6l2.9-.4.6-1.3L3.6 6.1l2.5-2.5 2.4 1.9zM12 12m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  auto: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 3v18M12 3a9 9 0 0 1 0 18',
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
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
} as const
export type IconName = keyof typeof ICONS

const KIND_ICON: Record<DeviceKind, IconName> = {
  light: 'light', cover: 'shutter', media_player: 'speaker', climate: 'heatpump', vacuum: 'vacuum', mower: 'mower',
  sensor: 'sensor', energy: 'solar', ev_charger: 'charger', vehicle: 'vehicle',
}

export function kindIcon(kind: DeviceKind | undefined, descriptor?: DeviceDescriptor): IconName {
  if (!kind) return 'sensor'
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
