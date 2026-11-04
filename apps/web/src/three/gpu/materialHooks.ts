import { Material } from 'three'
import { NodeMaterial, type Node, type NodeBuilder } from 'three/webgpu'
import {
  Break, Discard, Fn, If, Loop, abs, cameraPosition, clamp, diffuseColor, dot, exp, float, fract, int, length, max, min, mix,
  positionView, positionWorld, renderGroup, screenCoordinate, screenSize, select, smoothstep, uniform, uniformArray, vec2, vec3, vec4,
} from 'three/tsl'
import { sharedUniform } from './shared'
import { levelFadeUniforms } from '../core/levelFade'
import { heightMistUniforms } from '../core/heightMist'
import { DIM, FEATHER_M, ROOM_FOCUS_MAX, roomFocusUniforms } from '../core/roomFocus'
import { basinThroughWater } from './water'

// The three effects that `core/levelLight.ts` hangs on EVERY material through
// `Material.prototype.onBeforeCompile`, in TSL, hung the same way on `NodeMaterial.prototype`:
// the level fade (`levelFade.ts`), the room highlight (`roomFocus.ts`), the low mist (`heightMist.ts`).
// They read the same uniform objects as the GLSL: the scene sets them once for both renderers.
//
// Same reach as the GLSL hook: the materials that have fog (the scene's, not the effect chain's
// full-screen passes, which set `fragmentNode`). One difference: the level fade does not reach the
// shadow map (the GLSL dithers `MeshDepthMaterial` too): the shadow of a fading level stays whole
// until the level is gone.

type Vec4 = Node<'vec4'>

/** A TSL uniform that follows a GLSL uniform object `{ value }` (shared: see `shared.ts`). */
const follow = (u: { value: number }) => sharedUniform(u.value).onRenderUpdate(() => u.value)

// —— level fade and own opacity ——————————————————————————————————————————————

const fadeY = follow(levelFadeUniforms.kasbahFadeY)
const fadeVisibility = follow(levelFadeUniforms.kasbahFadeVisibility)
/**
 * The material's own opacity, re-read for EACH object drawn: materials with the same settings share
 * one generated shader (the cache key ignores `userData`), a value captured when building it would be
 * the first material's.
 */
const ownOpacity = uniform(1).onObjectUpdate(({ material }) => (material?.userData as { kasbahOpacity?: { value: number } } | undefined)?.kasbahOpacity?.value ?? 1)

const setupDiffuseColor = NodeMaterial.prototype.setupDiffuseColor
NodeMaterial.prototype.setupDiffuseColor = function (this: NodeMaterial, builder: NodeBuilder) {
  setupDiffuseColor.call(this, builder)
  if (!this.fog) return
  const a = ownOpacity.mul(select(fadeVisibility.lessThan(1).and(positionWorld.y.greaterThan(fadeY)), fadeVisibility, float(1)))
  if (this.transparent) { diffuseColor.a.mulAssign(a); return }
  // interleaved gradient noise (Jimenez 2014), as in the GLSL: an opaque material loses a share of its
  // pixels. Counted from the BOTTOM like `gl_FragCoord`, so both renderers drop the same pixels.
  const pixel = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y))
  const noise = fract(fract(dot(pixel, vec2(0.06711056, 0.00583715))).mul(52.9829189))
  If(a.lessThan(1).and(noise.greaterThanEqual(a)), () => { Discard() })
}

// —— room highlight ———————————————————————————————————————————————————————

const focus = follow(roomFocusUniforms.kasbahFocus)
const focusCount = sharedUniform(0, 'int').onRenderUpdate(() => roomFocusUniforms.kasbahFocusCount.value)
const focusPoly = uniformArray(roomFocusUniforms.kasbahFocusPoly.value, 'vec2').setGroup(renderGroup)
const focusY = sharedUniform(roomFocusUniforms.kasbahFocusY.value)

/** Distance to the room volume: 0 inside, otherwise the gap to the outline (plan) and to its slice (height). */
const roomDistance = Fn(([w]: [Node<'vec3'>]) => {
  const inside = float(0).toVar()
  const d = float(1e6).toVar()
  Loop(ROOM_FOCUS_MAX, ({ i }) => {
    If(i.greaterThanEqual(focusCount), () => { Break() })
    const a = focusPoly.element(i) as unknown as Node<'vec2'>
    const b = focusPoly.element(select(i.equal(focusCount.sub(1)), int(0), i.add(1))) as unknown as Node<'vec2'>
    // the edge crosses the pixel's row (`( a.y > w.z ) != ( b.y > w.z )` in the GLSL)
    const crosses = select(a.y.greaterThan(w.z), float(1), float(0)).notEqual(select(b.y.greaterThan(w.z), float(1), float(0)))
      .and(w.x.lessThan(b.x.sub(a.x).mul(w.z.sub(a.y)).div(b.y.sub(a.y)).add(a.x)))
    If(crosses, () => { inside.assign(inside.oneMinus()) })
    const ab = b.sub(a), ap = w.xz.sub(a)
    d.assign(min(d, length(ap.sub(ab.mul(clamp(dot(ap, ab).div(dot(ab, ab)), 0, 1))))))
  })
  const dy = max(max(focusY.x.sub(w.y), w.y.sub(focusY.y)), 0)
  return length(vec2(select(inside.greaterThan(0.5), float(0), d), dy))
})

function roomFocus(out: Vec4): Vec4 {
  const result = vec4(out).toVar() as unknown as Vec4
  If(focus.greaterThan(0), () => {
    const k = focus.mul(smoothstep(0, FEATHER_M, roomDistance(positionWorld)))
    const lum = dot(result.rgb, vec3(0.2126, 0.7152, 0.0722))
    const dim = mix(vec3(lum), result.rgb, DIM.saturation).mul(DIM.light)
    result.assign(vec4(mix(result.rgb, dim, k), result.a))
  })
  return result
}

// —— low mist (outdoor materials) ———————————————————————————————————————————

const mistDensity = follow(heightMistUniforms.kasbahMistDensity)
const mistColor = sharedUniform(heightMistUniforms.kasbahMistColor.value)
const mistBase = follow(heightMistUniforms.kasbahMistBase)
const mistFalloff = follow(heightMistUniforms.kasbahMistFalloff)

/** Optical depth of the camera → pixel ray in a medium of density d·exp(−(y − base)/H), as in the GLSL. */
function heightMist(out: Vec4): Vec4 {
  const result = vec4(out).toVar() as unknown as Vec4
  If(mistDensity.greaterThan(0), () => {
    const yf = max(positionWorld.y, mistBase)
    const yc = max(cameraPosition.y, mistBase)
    const ef = exp(yf.sub(mistBase).negate().div(mistFalloff))
    const ec = exp(yc.sub(mistBase).negate().div(mistFalloff))
    const dy = yf.sub(yc)
    const e = select(abs(dy).lessThan(1e-3), ef, mistFalloff.mul(ec.sub(ef)).div(dy))
    const amount = exp(mistDensity.negate().mul(length(positionView)).mul(e)).oneMinus()
    result.assign(vec4(mix(result.rgb, mistColor, amount), result.a))
  })
  return result
}

// The highlight before the fog (the GLSL puts it after `opaque_fragment`), the mist after it.
const setupOutput = NodeMaterial.prototype.setupOutput
NodeMaterial.prototype.setupOutput = function (this: NodeMaterial, builder: NodeBuilder, outputNode: Node) {
  if (!this.fog || this.fragmentNode !== null) return setupOutput.call(this, builder, outputNode)
  // the pool's bottom seen through the water first: the GLSL does it before `opaque_fragment` too
  const out = setupOutput.call(this, builder, roomFocus(basinThroughWater(builder.material, outputNode as Vec4))) as Vec4
  return (builder.material.userData as { noLamps?: boolean }).noLamps ? heightMist(out) : out
}

// `noLamps` changes the generated code (the mist here, the indoor lamps in `levelLight.ts`): it must
// enter the shader cache key, or an outdoor material reuses the shader of an identical indoor one
// (seen on 2026-11-04: the mist on the roof but not on the lawn). WebGPU reads the key on the ORIGINAL
// material (`RenderObject.getMaterialCacheKey`), not on its node copy — hence `Material.prototype`,
// patched only when this module loads, that is in WebGPU.
const customProgramCacheKey = Material.prototype.customProgramCacheKey
Material.prototype.customProgramCacheKey = function (this: Material) {
  const u = this.userData as { noLamps?: boolean; kasbahGpu?: string }
  // a tagged material (`shaderMaterials.ts`, the points of `points.ts`) reads its own uniform objects: one shader each
  return customProgramCacheKey.call(this) + (u.noLamps ? '|kasbah-outdoor' : '') + (u.kasbahGpu ? `|${u.kasbahGpu}|${this.uuid}` : '')
}
