import type { Box3} from 'three';
import { Spherical, Vector3 } from 'three'

// Cadrage caméra pur (testable) : distance pour englober la sphère d'une boîte, pose sphérique.

export interface CameraPose { position: Vector3; target: Vector3 }

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
  const radius = Math.max(0.5, box.getSize(new Vector3()).length() / 2)
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
