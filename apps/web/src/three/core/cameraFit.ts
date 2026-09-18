import type { Box3} from 'three';
import { Spherical, Vector3 } from 'three'

// Cadrage caméra pur (testable) : distance pour englober la sphère d'une boîte, pose sphérique.

export interface CameraPose {
  position: Vector3
  target: Vector3
  /** Zoom visé, en projection orthographique seulement : là-bas c'est lui qui cadre, pas la distance. */
  zoom?: number
}

export interface FitOptions {
  /** Azimut (rad) autour de l'axe Y monde ; 0 = depuis +Z (sud), π/2 = depuis +X (est). */
  azimuth: number
  /** Angle polaire (rad) depuis la verticale ; π/2 = à l'horizontale. */
  polar: number
  padding?: number
  minDistance?: number
}

/** Distance caméra pour qu'une sphère de rayon r tienne dans les deux champs (vertical et horizontal). */
export function fitDistance(radius: number, fovDeg: number, aspect: number, padding = 1.15): number {
  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const fov = Math.min(vFov, hFov)
  return (radius / Math.sin(fov / 2)) * padding
}

export function fitBox(box: Box3, fovDeg: number, aspect: number, opts: FitOptions): CameraPose {
  const target = box.getCenter(new Vector3())
  const radius = boxRadius(box)
  const distance = Math.max(opts.minDistance ?? 1.5, fitDistance(radius, fovDeg, aspect, opts.padding))
  const spherical = new Spherical(distance, opts.polar, opts.azimuth)
  const position = new Vector3().setFromSpherical(spherical).add(target)
  return { position, target }
}

/** Azimut / polaire courants d'une caméra par rapport à sa cible. */
export function sphericalOf(position: Vector3, target: Vector3): { azimuth: number; polar: number; distance: number } {
  const s = new Spherical().setFromVector3(position.clone().sub(target))
  return { azimuth: s.theta, polar: s.phi, distance: s.radius }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Projection de la vue 3D. Trois valeurs, deux caméras :
 *  - `perspective` : la vue par défaut, celle qui donne de la profondeur ;
 *  - `ortho` : caméra orthographique, les parallèles le restent, mais on tourne librement ;
 *  - `iso` : la même caméra, angles VERROUILLÉS sur l'isométrie (45° d'azimut, `ISO_POLAR` de
 *    plongée) — on ne tourne plus que par quarts de tour.
 */
export const SCENE_PROJECTIONS = ['perspective', 'ortho', 'iso'] as const
export type SceneProjection = (typeof SCENE_PROJECTIONS)[number]

/**
 * Hauteur de monde (m) que couvre le tronc orthographique à zoom 1. Rien d'autre n'en dépend : le
 * cadrage, la molette et l'échelle des pilules passent tous par le zoom, qui s'y rapporte.
 */
export const ORTHO_BASE_M = 20

/** Plongée de l'isométrie : atan(√2) depuis la verticale, l'angle qui met les trois axes à égalité. */
export const ISO_POLAR = Math.atan(Math.SQRT2)

/** Rayon de la sphère qui englobe une boîte — l'unité de cadrage, commune aux deux projections. */
export function boxRadius(box: Box3): number {
  return Math.max(0.5, box.getSize(new Vector3()).length() / 2)
}

/** Hauteur de monde (m) couverte par le champ vertical à `distance`. */
export function visibleHeight(distance: number, fovDeg: number): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360)
}

/** L'inverse : la distance à laquelle le champ vertical couvre `height` mètres. */
export function distanceForHeight(height: number, fovDeg: number): number {
  return height / (2 * Math.tan((fovDeg * Math.PI) / 360))
}

/**
 * Zoom d'une caméra orthographique pour qu'une sphère de rayon `r` tienne dans les deux champs.
 * Le tronc de base fait `baseHeight` mètres de haut à zoom 1 ; le zoom est ce qui le resserre.
 */
export function fitZoom(radius: number, aspect: number, baseHeight: number, padding = 1.15): number {
  const needed = Math.max(1e-3, 2 * radius * padding)
  return (baseHeight * Math.min(1, aspect)) / needed
}

/** L'azimut isométrique le plus proche : quatre coins, de quart de tour en quart de tour. */
export function snapIsoAzimuth(azimuth: number, origin: number): number {
  const quarter = Math.PI / 2
  return origin + Math.round((azimuth - origin) / quarter) * quarter
}
