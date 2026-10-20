import { Color, type Material, type WebGLProgramParametersWithUniforms } from 'three'
import { dayFactor, duskFactor, type SceneAmbience } from './ambience'

// The LOW MIST: the one that lies in the valley at dawn and at night. A HEIGHT fog —
// its density decreases with altitude — and not three's `Fog`, which depends only on distance and
// would drown the house seen from above as much as the horizon.
//
// The density is INTEGRATED along the view ray (exponential profile, closed form): a ray that
// plunges onto the house crosses the layer only over its last meters, a ray that skims the distant
// terrain crosses it over its whole length. That is what keeps the house sharp and drowns the distance.
//
// Applied only to OUTDOOR materials (`userData.noLamps`: terrain, zones, water, roof), after
// `fog_fragment`, through the same hook as `levelLight.ts`. A room's floors are at the height of the
// garden: without this filter, the dollhouse filled up with mist. The infinite ground under the plot
// does not get any either: it must stay the background color, with no visible edge.
// Driven by uniforms: density 0 in broad daylight, and changing the hour recompiles nothing. The weather
// fog (`scene.fog`, `ambience.ts`) stays separate and adds to it.

export const heightMistUniforms = {
  /** Density (1/m) at ground level; 0 = no mist, the image is rendered identically. */
  kasbahMistDensity: { value: 0 },
  /** Color of the layer, linear. */
  kasbahMistColor: { value: new Color(0, 0, 0) },
  /** WORLD altitude of the ground (terrain) where the layer is densest. */
  kasbahMistBase: { value: 0 },
  /** Characteristic thickness (m): the density is divided by e every `falloff` meters. */
  kasbahMistFalloff: { value: 1.2 },
}

/** Ground density of the mist at its strongest (1/m), and its share at night (dawn is its hour). */
const MIST_DENSITY = 0.15
const MIST_NIGHT = 0.6

/**
 * How much mist, from 0 to 1: at night a moderate layer, at dawn (grazing sun in the EAST) its
 * strongest, in the evening and by day none. The wind disperses it.
 */
export function mistAmount(a: SceneAmbience): number {
  const dawn = a.sunAzimuthDeg < 180 ? duskFactor(a) : 0
  const k = Math.max(MIST_NIGHT * (1 - dayFactor(a)), dawn)
  const wind = Math.min(1, Math.max(0, ((a.windKmh ?? 0) - 10) / 30))
  return k * (1 - wind)
}

/** Sets the ambience's mist: its density, its color, and the terrain altitude. */
export function setHeightMist(a: SceneAmbience, color: Color, baseY: number): void {
  heightMistUniforms.kasbahMistDensity.value = MIST_DENSITY * mistAmount(a)
  heightMistUniforms.kasbahMistColor.value.copy(color)
  heightMistUniforms.kasbahMistBase.value = baseY
}

const VERTEX_PARS = 'varying vec3 kasbahMistView;'
const FRAGMENT_PARS = /* glsl */ `
varying vec3 kasbahMistView;
uniform float kasbahMistDensity;
uniform vec3 kasbahMistColor;
uniform float kasbahMistBase;
uniform float kasbahMistFalloff;
`
// Optical depth of the camera → pixel ray in a medium of density d·exp(−(y − base)/H):
// d·L·H·(e(yc) − e(yf)) / (yf − yc), and d·L·e(y) when the ray is flat.
const FRAGMENT = /* glsl */ `
  if ( kasbahMistDensity > 0.0 ) {
    // from VIEW space to WORLD height: row y of the inverse of the view matrix
    float kasbahYf = max( dot( viewMatrix[ 1 ].xyz, kasbahMistView - viewMatrix[ 3 ].xyz ), kasbahMistBase );
    float kasbahYc = max( cameraPosition.y, kasbahMistBase );
    float kasbahEf = exp( - ( kasbahYf - kasbahMistBase ) / kasbahMistFalloff );
    float kasbahEc = exp( - ( kasbahYc - kasbahMistBase ) / kasbahMistFalloff );
    float kasbahDy = kasbahYf - kasbahYc;
    float kasbahE = abs( kasbahDy ) < 1e-3 ? kasbahEf : kasbahMistFalloff * ( kasbahEc - kasbahEf ) / kasbahDy;
    float kasbahMist = 1.0 - exp( - kasbahMistDensity * length( kasbahMistView ) * kasbahE );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, kasbahMistColor, kasbahMist );
  }
`

/** Adds the mist to a shader being compiled: an outdoor material, and a shader that has fog. */
export function applyHeightMist(shader: WebGLProgramParametersWithUniforms, material: Material): void {
  if (!material.userData.noLamps) return
  if (!shader.fragmentShader.includes('#include <fog_fragment>') || !shader.vertexShader.includes('#include <fog_vertex>')) return
  Object.assign(shader.uniforms, heightMistUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', `#include <fog_pars_vertex>\n${VERTEX_PARS}`)
    .replace('#include <fog_vertex>', '#include <fog_vertex>\n  kasbahMistView = mvPosition.xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FRAGMENT_PARS}`)
    .replace('#include <fog_fragment>', `#include <fog_fragment>\n${FRAGMENT}`)
}
