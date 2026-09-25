import type { Material, WebGLProgramParametersWithUniforms } from 'three'

// Le FONDU de l'étage qui s'envole (`HouseScene.liftTo`). Un vrai fondu demanderait des matières
// transparentes : three en fait un autre programme (`OPAQUE`), et la première transition
// recompilerait toute la maison. Ici, un fondu TRAMÉ : au-dessus d'une hauteur, une part des pixels
// est écartée selon une trame 4×4 (Bayer) — la part qui grandit à mesure que l'étage monte.
//
// Deux uniforms partagés par toutes les matières : le programme ne change jamais, et au repos
// (`visibility` = 1) aucun pixel n'est écarté — l'image est rendue à l'identique.

export const levelFadeUniforms = {
  /** Hauteur MONDE au-dessus de laquelle le fondu s'applique (le dessus du niveau qui reste). */
  kasbahFadeY: { value: 1e9 },
  /** Part visible au-dessus de cette hauteur : 1 = tout, 0 = rien. */
  kasbahFadeVisibility: { value: 1 },
}

/** Pose le fondu ; `visibility` 1 le lève. */
export function setLevelFade(cutY: number, visibility: number): void {
  levelFadeUniforms.kasbahFadeY.value = cutY
  levelFadeUniforms.kasbahFadeVisibility.value = visibility
}

const FRAGMENT_PARS = /* glsl */ `
varying vec3 kasbahFadeView;
uniform float kasbahFadeY;
uniform float kasbahFadeVisibility;
// trame de Bayer 4×4 : seize seuils répartis, pour que la part écartée se lise comme une densité
float kasbahBayer( vec2 p ) {
  vec2 q = mod( floor( p ), 4.0 );
  float i = q.x + q.y * 4.0;
  vec4 m = i < 4.0 ? vec4( 0.0, 8.0, 2.0, 10.0 ) : i < 8.0 ? vec4( 12.0, 4.0, 14.0, 6.0 ) : i < 12.0 ? vec4( 3.0, 11.0, 1.0, 9.0 ) : vec4( 15.0, 7.0, 13.0, 5.0 );
  float k = mod( i, 4.0 );
  float v = k < 1.0 ? m.x : k < 2.0 ? m.y : k < 3.0 ? m.z : m.w;
  return ( v + 0.5 ) / 16.0;
}
`
const FRAGMENT = /* glsl */ `
  if ( kasbahFadeVisibility < 1.0 && dot( viewMatrix[ 1 ].xyz, kasbahFadeView - viewMatrix[ 3 ].xyz ) > kasbahFadeY && kasbahBayer( gl_FragCoord.xy ) >= kasbahFadeVisibility ) discard;
`

/** Ajoute le fondu à un shader en cours de compilation (toute matière qui a un brouillard, donc toutes celles de three). */
export function applyLevelFade(shader: WebGLProgramParametersWithUniforms, _material: Material): void {
  if (!shader.fragmentShader.includes('#include <clipping_planes_fragment>') || !shader.vertexShader.includes('#include <fog_vertex>')) return
  Object.assign(shader.uniforms, levelFadeUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 kasbahFadeView;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\n  kasbahFadeView = mvPosition.xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT}`)
}
