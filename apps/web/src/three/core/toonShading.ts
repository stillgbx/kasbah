import { ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'
import type { ShadingLook } from '../styles/types'

// DRAWN SHADING (cel-shading): what makes a lit volume read as an illustration and not a
// photograph. Two things, on every lit material, through the same hook as `levelLight.ts`:
//  - the share of the sun a face receives (`dotNL`) falls in flat BANDS instead of a gradient;
//  - the edge of a cast shadow becomes hard: the soft filtering of the shadow map is pushed to 0 or 1.
// The sky and the environment are left alone: on the flat faces of a house they are already flat.
//
// Driven by a uniform: 0 bands = the physical gradient, the image is rendered identically, and
// changing style recompiles nothing. WebGL only for now: the WebGPU renderer keeps its gradient.

export const toonUniforms = {
  /** Steps of the sun's light, 0 = continuous. */
  kasbahToonBands: { value: 0 },
}

/** Sets the style's shading (absent = physical). */
export function setToonShading(look: ShadingLook | undefined): void {
  toonUniforms.kasbahToonBands.value = look?.bands ?? 0
}

// `dotNL` is ROUNDED to the nearest step: on average a face receives as much sun as before, where
// rounding up lit every face a step too high and burned the pale roofs out under the bloom.
// A narrow ramp (0.1 band) rather than a hard step: the edge stays clean without stair-stepping.
const PARS = /* glsl */ `
uniform float kasbahToonBands;
float kasbahToon( float x ) {
  if ( kasbahToonBands <= 0.0 ) return x;
  float v = x * kasbahToonBands + 0.5;
  return ( floor( v ) - 1.0 + smoothstep( 0.0, 0.1, fract( v ) ) ) / kasbahToonBands;
}
// getShadow returns mix( 1, shadow, intensity ): the hard edge is taken on the shadow alone
float kasbahToonShadow( float s, float intensity ) {
  if ( kasbahToonBands <= 0.0 || intensity <= 0.0 ) return s;
  float lo = 1.0 - intensity;
  return mix( lo, 1.0, smoothstep( 0.4, 0.6, ( s - lo ) / intensity ) );
}
`

const IRRADIANCE = 'vec3 irradiance = dotNL * directLight.color;'
const SHADOW_CALL = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )'

/** The lighting chunks with the banded irradiance; checked once, at load: a three upgrade that moves them must fail loudly. */
const CHUNKS = (['lights_physical_pars_fragment', 'lights_lambert_pars_fragment'] as const).map((name) => {
  const src = ShaderChunk[name]
  if (!src.includes(IRRADIANCE)) throw new Error(`toonShading: ${name} changed`)
  return { include: `#include <${name}>`, patched: src.replace(IRRADIANCE, 'vec3 irradiance = kasbahToon( dotNL ) * directLight.color;') }
})
if (!ShaderChunk.lights_fragment_begin.includes(SHADOW_CALL)) throw new Error('toonShading: lights_fragment_begin changed')

/**
 * Adds the bands to a shader being compiled. Runs AFTER `applyLevelLight`, which has already
 * expanded `lights_fragment_begin` in place: the sun's shadow call is found in that text.
 */
export function applyToonShading(shader: WebGLProgramParametersWithUniforms): void {
  const chunk = CHUNKS.find((c) => shader.fragmentShader.includes(c.include))
  if (!chunk) return
  shader.uniforms.kasbahToonBands = toonUniforms.kasbahToonBands
  shader.fragmentShader = shader.fragmentShader
    .replace(chunk.include, `${PARS}\n${chunk.patched}`)
    .replace(SHADOW_CALL, `kasbahToonShadow( ${SHADOW_CALL}, directionalLightShadow.shadowIntensity )`)
}
