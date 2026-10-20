import type { Box3} from 'three';
import { Spherical, Vector3 } from 'three'

// Pure camera framing (testable): distance to enclose a box's sphere, spherical pose.

export interface CameraPose {
  position: Vector3
  target: Vector3
  /** Target zoom, in orthographic projection only: there it is the zoom that frames, not the distance. */
  zoom?: number
}

export interface FitOptions {
  /** Azimuth (rad) around the world Y axis; 0 = from +Z (south), π/2 = from +X (east). */
  azimuth: number
  /** Polar angle (rad) from the vertical; π/2 = horizontal. */
  polar: number
  padding?: number
  minDistance?: number
}

/** Camera distance so that a sphere of radius r fits in both fields of view (vertical and horizontal). */
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

/** Current azimuth / polar angle of a camera relative to its target. */
export function sphericalOf(position: Vector3, target: Vector3): { azimuth: number; polar: number; distance: number } {
  const s = new Spherical().setFromVector3(position.clone().sub(target))
  return { azimuth: s.theta, polar: s.phi, distance: s.radius }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Projection of the 3D view. Three values, two cameras:
 *  - `perspective`: the default view, the one that gives depth;
 *  - `ortho`: orthographic camera, parallels stay parallel, but rotation is free;
 *  - `iso`: angles LOCKED to the isometric (45° azimuth, `ISO_POLAR` of tilt) — rotation is
 *    only by quarter turns — seen by the PERSPECTIVE camera with a narrow field
 *    (`ISO_FOV_DEG`). A true isometric, orthographic, read as distorted: nothing shrinks
 *    in the distance, and the eye takes the pool at the back as enlarged (a reversed perspective).
 */
export const SCENE_PROJECTIONS = ['perspective', 'ortho', 'iso'] as const
export type SceneProjection = (typeof SCENE_PROJECTIONS)[number]

/**
 * World height (m) covered by the orthographic frustum at zoom 1. Nothing else depends on it: the
 * framing, the mouse wheel and the scale of the pills all go through the zoom, which relates to it.
 */
export const ORTHO_BASE_M = 20

/** Vertical field of the isometric view: narrow enough to keep its lines, open enough for them to converge a little. */
export const ISO_FOV_DEG = 20

/** Tilt of the isometric view: atan(√2) from the vertical, the angle that puts the three axes on an equal footing. */
export const ISO_POLAR = Math.atan(Math.SQRT2)

/** Radius of the sphere enclosing a box — the framing unit, common to both projections. */
export function boxRadius(box: Box3): number {
  return Math.max(0.5, box.getSize(new Vector3()).length() / 2)
}

/** World height (m) covered by the vertical field at `distance`. */
export function visibleHeight(distance: number, fovDeg: number): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360)
}

/** The inverse: the distance at which the vertical field covers `height` meters. */
export function distanceForHeight(height: number, fovDeg: number): number {
  return height / (2 * Math.tan((fovDeg * Math.PI) / 360))
}

/**
 * Zoom of an orthographic camera so that a sphere of radius `r` fits in both fields.
 * The base frustum is `baseHeight` meters tall at zoom 1; the zoom is what tightens it.
 */
export function fitZoom(radius: number, aspect: number, baseHeight: number, padding = 1.15): number {
  const needed = Math.max(1e-3, 2 * radius * padding)
  return (baseHeight * Math.min(1, aspect)) / needed
}

/** The nearest isometric azimuth: four corners, quarter turn by quarter turn. */
export function snapIsoAzimuth(azimuth: number, origin: number): number {
  const quarter = Math.PI / 2
  return origin + Math.round((azimuth - origin) / quarter) * quarter
}
