import type { Color, Texture, Vector2, Vector3 } from 'three'
import type { Node } from 'three/webgpu'
import {
  abs, cameraProjectionMatrix, cos, cross, float, floor, fract, instanceIndex, length, max, mix, modelViewMatrix, normalize,
  positionGeometry, select, sin, smoothstep, varying, vec2, vec3, vec4,
} from 'three/tsl'
import { sharedTexture, sharedUniform } from './shared'
import {
  LAPS, RAIN_MIN_SCREEN, RAIN_STREAK_M, RAIN_WIDTH_M, SNOW_MIN_SCREEN, SNOW_SIZE_M, SNOW_SWAY_M, SNOW_SWAY_X, SNOW_SWAY_Y, TOP_FADE_M,
} from '../effects/precipitation'

// `effects/precipitation.ts` in TSL: the same placement from the instance number, the same uniform
// objects (the CPU moves only the offset and the clock), the same cover map.

type F = Node<'float'>

const follow = (u: { value: number }) => sharedUniform(u.value).onRenderUpdate(() => u.value)
const hash = (n: F): F => fract(sin(n).mul(43758.5453123))
/** GLSL's `mod`: WGSL's `%` truncates, a negative lap would land elsewhere. */
const fmod = (a: F, b: F | number): F => a.sub(floor(a.div(b)).mul(b))

export function precipitationPass(u: Record<string, { value: unknown }>, snow: boolean): { vertex: Node<'vec4'>; colour: Node<'vec4'> } {
  const boxMin = sharedUniform(u.uBoxMin!.value as Vector3)
  const boxSize = sharedUniform(u.uBoxSize!.value as Vector3)
  const offset = sharedUniform(u.uOffset!.value as Vector3)
  const velocity = sharedUniform(u.uVelocity!.value as Vector3)
  const screen = sharedUniform(u.uScreen!.value as Vector2)
  const time = follow(u.uTime as { value: number })

  const id = float(instanceIndex)
  const seed = vec3(hash(id.mul(0.137).add(1)), hash(id.mul(0.731).add(2)), hash(id.mul(0.419).add(3)))
  // the fall: height in the volume, and the lap, which gives each fall its own spot
  const z0 = seed.z.mul(boxSize.z).sub(offset.z)
  const lap = floor(z0.div(boxSize.z))
  const z = z0.sub(lap.mul(boxSize.z))
  const l = fmod(lap, LAPS)
  const spot = fract(seed.xy.add(vec2(hash(id.mul(0.37).add(l.mul(17.13))), hash(id.mul(0.59).add(l.mul(9.71)))))).mul(boxSize.xy)
  let xy = vec2(fmod(spot.x.add(offset.x), boxSize.x), fmod(spot.y.add(offset.y), boxSize.y)).add(boxMin.xy)
  if (snow) {
    const phase = seed.x.mul(40).add(seed.y.mul(13))
    xy = xy.add(vec2(sin(time.mul(SNOW_SWAY_X).add(phase)), cos(time.mul(SNOW_SWAY_Y).add(phase))).mul(SNOW_SWAY_M))
  }
  const head = vec3(xy, z)
  const h = modelViewMatrix.mul(vec4(head, 1)).xyz
  // metres per image height at this particle's distance
  const metres = screen.x.mul(mix(float(1), h.z.negate(), screen.y))
  let p: Node<'vec3'>
  let quad: Node<'vec2'>
  if (snow) {
    const size = max(float(SNOW_SIZE_M), metres.mul(SNOW_MIN_SCREEN))
    quad = vec2(positionGeometry.x.mul(2).sub(1), positionGeometry.y)
    p = h.add(vec3(quad.mul(size.mul(0.5)), 0))
  } else {
    // the streak: from the head back along the velocity, widened across the line of sight
    const t = modelViewMatrix.mul(vec4(head.sub(normalize(velocity).mul(RAIN_STREAK_M)), 1)).xyz
    const c = cross(t.sub(h), h)
    const len = length(c)
    const side = select(len.greaterThan(1e-6), c.div(len), vec3(1, 0, 0))
    const width = max(float(RAIN_WIDTH_M), metres.mul(RAIN_MIN_SCREEN))
    quad = positionGeometry.xy
    p = mix(h, t, positionGeometry.x).add(side.mul(positionGeometry.y.mul(width).mul(0.5)))
  }
  const fade = varying(smoothstep(boxSize.z, boxSize.z.sub(TOP_FADE_M), z))
  const q = varying(quad)
  const a = snow ? smoothstep(1, 0, length(q)) : abs(q.y).oneMinus().mul(mix(float(1), float(0.2), q.x))
  const colour = vec4(sharedUniform(u.uColor!.value as Color), follow(u.uOpacity as { value: number }).mul(a).mul(fade))
  // under a roof or a level: out of the clip volume, the particle is not drawn
  const cover = sharedTexture(u.uCover!.value as Texture).sample(xy.sub(boxMin.xy).div(boxSize.xy)).level(float(0)).r.mul(boxSize.z)
  const vertex = select(z.lessThan(cover), vec4(2, 2, 2, 1), cameraProjectionMatrix.mul(vec4(p, 1)))
  return { vertex, colour }
}
