import type { Material, WebGLProgramParametersWithUniforms } from 'three'

// OPACITY, on any material, without making it a transparent material.
//
// `transparent: true` is not a simple setting in three: the material changes queue (sorting
// back to front, color blending), program (`OPAQUE` define), and a house at 50 %
// shows its partitions through its facades. Here, each material additionally carries an opacity of
// OUR OWN, read by the shader as a uniform:
//   - an OPAQUE material stays opaque: below 1, a share of its pixels is discarded (interleaved
//     noise pattern, stable on screen) — it keeps its queue, its depth, and no sort goes wrong;
//   - an already TRANSPARENT material (glass, halo) has its alpha multiplied: a true fade.
// The choice is made in the shader (`#ifdef OPAQUE`, set by three): the same hook serves both.
//
// This opacity is distinct from `material.opacity` and from texture alpha: a car body
// whose image has an alpha channel, a glazed shutter slat at 0.45 are not dithered for all that.
//
// Two uses today: a material's opacity (`materialOpacity`), and the FADE of the level that
// flies off (`HouseScene.liftTo`) — everything above a height fades out together. At
// rest, everything is 1: nothing is discarded, the image is rendered identically, and changing an opacity
// never recompiles anything.

export const levelFadeUniforms = {
  /** WORLD height above which the fade applies (the top of the level that stays). */
  kasbahFadeY: { value: 1e9 },
  /** Visible share above that height: 1 = all, 0 = nothing. */
  kasbahFadeVisibility: { value: 1 },
}

/** Sets the level fade; `visibility` 1 lifts it. */
export function setLevelFade(cutY: number, visibility: number): void {
  levelFadeUniforms.kasbahFadeY.value = cutY
  levelFadeUniforms.kasbahFadeVisibility.value = visibility
}

/**
 * A material's own opacity (1 = full), to modify through `.value`: it is the very uniform that
 * its shader reads. A clone of the material receives one of its own (the `userData` are copied).
 */
export function materialOpacity(material: Material): { value: number } {
  const u = material.userData as { kasbahOpacity?: { value: number } }
  return (u.kasbahOpacity ??= { value: 1 })
}

const FRAGMENT_PARS = /* glsl */ `
varying vec3 kasbahFadeView;
uniform float kasbahFadeY;
uniform float kasbahFadeVisibility;
uniform float kasbahOpacity;
`
// Interleaved gradient noise (Jimenez 2014): a pattern with no visible motif, at almost no cost.
const FRAGMENT = /* glsl */ `
  {
    float kasbahA = kasbahOpacity;
    if ( kasbahFadeVisibility < 1.0 && dot( viewMatrix[ 1 ].xyz, kasbahFadeView - viewMatrix[ 3 ].xyz ) > kasbahFadeY ) kasbahA *= kasbahFadeVisibility;
    #ifdef OPAQUE
    if ( kasbahA < 1.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) >= kasbahA ) discard;
    #else
    diffuseColor.a *= kasbahA;
    #endif
  }
`

/**
 * Adds the opacity to a shader being compiled (any three material that has fog).
 *
 * And to the DEPTH material of the shadow pass (`MeshDepthMaterial`, without fog): the level
 * that fades loses the same share of its pixels there, and the blur of the VSM map turns this pattern into a
 * shadow that pales with it instead of vanishing all at once at the end. The height computation only
 * depends on `viewMatrix`: the sun's stands in for the camera's there.
 */
export function applyLevelFade(shader: WebGLProgramParametersWithUniforms, material: Material): void {
  if (!shader.fragmentShader.includes('#include <alphatest_fragment>')) return
  const fog = shader.vertexShader.includes('#include <fog_vertex>')
  const depth = (material as Material & { isMeshDepthMaterial?: boolean }).isMeshDepthMaterial === true
  if (!fog && !(depth && shader.vertexShader.includes('#include <project_vertex>'))) return
  Object.assign(shader.uniforms, levelFadeUniforms)
  shader.uniforms.kasbahOpacity = materialOpacity(material)
  shader.vertexShader = fog
    ? shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 kasbahFadeView;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n  kasbahFadeView = mvPosition.xyz;')
    : shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 kasbahFadeView;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  kasbahFadeView = mvPosition.xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
    .replace('#include <alphatest_fragment>', `${FRAGMENT}\n#include <alphatest_fragment>`)
}
