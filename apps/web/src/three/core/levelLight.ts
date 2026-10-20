import { Material, ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'
import { applyHeightMist } from './heightMist'
import { applyLevelFade } from './levelFade'
import { applyRoomFocus } from './roomFocus'

// An indoor lamp only lights ITS level, in the shader, in a single pass.
//
// A `PointLight` ignores geometry: left alone, the living room ceiling light lights the entrance
// airlock below through the slab. This file adds, to the point-light loop of
// every lit material, a HEIGHT test: the lamp and the pixel are sorted into a slice
// by the levels' elevations, and the lamp only counts if it is the same slice.
//
// What it replaces: rendering in PASSES (the material under the global lighting, then each lit
// level redrawn alone with its lamps). It cost one more frame per lit level, and above all
// — the set of lights changing from one pass to the next — it forced three to re-evaluate the
// program of EVERY material at every pass: 14 ms of CPU per frame on the real house, measured
// on 2026-09-24 (see `doc/1_architecture/1_5_scene-3d.md`).
//
// GARDEN lamps are not tested: they cast a shadow (`castShadow`), and it is the shadow
// that stops them at the wall. Three sorts shadow-casting lights AT THE HEAD of the list
// (`shadowCastingAndTexturingLightsFirst`), hence the test `UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS`.
// A garden lamp that is off casts no shadow: it falls into the test, but it lights nothing.
//
// A material marked `userData.noLamps` (the terrain, the zones, the roof, the water) receives no
// indoor lamp: the garden ground is at the height of the ground floor, a living room lamp would
// stain it through the facade.

/** Slices at most: one level more than bounds. */
const MAX_BOUNDS = 8

/** WORLD heights of the levels, except the lowest, ascending. Shared by all materials. */
export const levelLightUniforms = {
  kasbahLevelY: { value: new Float32Array(MAX_BOUNDS) },
  kasbahLevelCount: { value: 0 },
}

/** Sets the slice bounds (world elevations of the levels, in any order). */
export function setLevelHeights(heights: readonly number[]): void {
  const sorted = [...heights].sort((a, b) => a - b).slice(1, MAX_BOUNDS + 1)
  levelLightUniforms.kasbahLevelY.value.fill(0).set(sorted)
  levelLightUniforms.kasbahLevelCount.value = sorted.length
}

const PARS = /* glsl */ `
uniform float kasbahLevelY[ ${MAX_BOUNDS} ];
uniform int kasbahLevelCount;
uniform float kasbahLamps;
int kasbahBand( float y ) {
  int b = 0;
  for ( int i = 0; i < ${MAX_BOUNDS}; i ++ ) if ( i < kasbahLevelCount && y >= kasbahLevelY[ i ] ) b = i + 1;
  return b;
}
// from a VIEW position to the WORLD height: row y of the inverse of the view matrix
float kasbahWorldY( vec3 p ) { return dot( viewMatrix[ 1 ].xyz, p - viewMatrix[ 3 ].xyz ); }
// The top of a slab sits EXACTLY on the bound: the pixel is raised by 5 mm to fall
// into the level the slab carries, its underside staying in the level below (it is its ceiling).
bool kasbahLampReaches( vec3 lightPos, vec3 fragPos ) {
  if ( kasbahLamps < 0.5 ) return false;
  return kasbahBand( kasbahWorldY( lightPos ) ) == kasbahBand( kasbahWorldY( fragPos ) + 0.005 );
}
`

const POINT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );'
const POINT_DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );'

/** The point-light loop, tested: a masked or switched-off lamp computes nothing. */
const LIGHTS_BEGIN = (() => {
  const src = ShaderChunk.lights_fragment_begin
  const start = src.indexOf('#if ( NUM_POINT_LIGHTS > 0 )')
  const end = src.indexOf('#pragma unroll_loop_end', start)
  const block = src.slice(start, end)
  if (start < 0 || !block.includes(POINT_INFO) || !block.includes(POINT_DIRECT)) throw new Error('levelLight: lights_fragment_begin changed')
  const patched = block
    .replace(POINT_INFO, `${POINT_INFO}
		#if ( UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS )
		directLight.visible = directLight.visible && kasbahLampReaches( pointLight.position, geometryPosition );
		#endif`)
    .replace(POINT_DIRECT, `if ( directLight.visible ) ${POINT_DIRECT}`)
  return src.slice(0, start) + patched + src.slice(end)
})()

/** Applies the mask to a shader being compiled. No effect on an unlit material. */
export function applyLevelLight(shader: WebGLProgramParametersWithUniforms, material: Material): void {
  if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) return
  shader.uniforms.kasbahLevelY = levelLightUniforms.kasbahLevelY
  shader.uniforms.kasbahLevelCount = levelLightUniforms.kasbahLevelCount
  shader.uniforms.kasbahLamps = { value: material.userData.noLamps ? 0 : 1 }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>\n${PARS}`)
    .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
}

// Set on the PROTOTYPE: every lit material of the scene receives it, including those that the
// markers create on the fly, without any constructor having to think about it. A material that sets its
// own `onBeforeCompile` (the water) calls `applyLevelLight` itself. The low mist
// (`heightMist.ts`), the opacity and the level fade (`levelFade.ts`) and the highlighting of a
// room (`roomFocus.ts`) go through the same hook, for the same reason.
Material.prototype.onBeforeCompile = function (this: Material, shader: WebGLProgramParametersWithUniforms) {
  applyLevelLight(shader, this)
  applyHeightMist(shader, this)
  applyLevelFade(shader, this)
  applyRoomFocus(shader, this)
}
