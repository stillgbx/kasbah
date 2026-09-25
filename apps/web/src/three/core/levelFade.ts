import type { Material, WebGLProgramParametersWithUniforms } from 'three'

// L'OPACITÉ, sur toute matière, sans en faire une matière transparente.
//
// `transparent: true` n'est pas un simple réglage dans three : la matière change de file (tri de
// l'arrière vers l'avant, mélange des couleurs), de programme (define `OPAQUE`), et une maison à 50 %
// laisse voir ses cloisons à travers ses façades. Ici, chaque matière porte en plus une opacité À
// NOUS, lue par le shader comme un uniform :
//   - une matière OPAQUE reste opaque : sous 1, une part de ses pixels est écartée (trame de bruit
//     entrelacé, stable à l'écran) — elle garde sa file, sa profondeur, et aucun tri ne se trompe ;
//   - une matière déjà TRANSPARENTE (verre, halo) voit son alpha multiplié : un vrai fondu.
// Le choix se fait dans le shader (`#ifdef OPAQUE`, posé par three) : le même crochet sert les deux.
//
// Cette opacité est distincte de `material.opacity` et de l'alpha des textures : une carrosserie
// dont l'image a un canal alpha, une lame de volet vitrée à 0,45 ne sont pas tramées pour autant.
//
// Deux usages aujourd'hui : l'opacité d'une matière (`materialOpacity`), et le FONDU de l'étage qui
// s'envole (`HouseScene.liftTo`) — tout ce qui est au-dessus d'une hauteur s'efface ensemble. Au
// repos, tout vaut 1 : rien n'est écarté, l'image est rendue à l'identique, et changer une opacité
// ne recompile jamais rien.

export const levelFadeUniforms = {
  /** Hauteur MONDE au-dessus de laquelle le fondu s'applique (le dessus du niveau qui reste). */
  kasbahFadeY: { value: 1e9 },
  /** Part visible au-dessus de cette hauteur : 1 = tout, 0 = rien. */
  kasbahFadeVisibility: { value: 1 },
}

/** Pose le fondu des étages ; `visibility` 1 le lève. */
export function setLevelFade(cutY: number, visibility: number): void {
  levelFadeUniforms.kasbahFadeY.value = cutY
  levelFadeUniforms.kasbahFadeVisibility.value = visibility
}

/**
 * L'opacité propre d'une matière (1 = pleine), à modifier par `.value` : c'est l'uniform même que
 * lit son shader. Un clone de la matière en reçoit une à lui (les `userData` sont recopiés).
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
// Bruit en gradient entrelacé (Jimenez 2014) : une trame sans motif visible, à coût quasi nul.
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

/** Ajoute l'opacité à un shader en cours de compilation (toute matière de three qui a un brouillard). */
export function applyLevelFade(shader: WebGLProgramParametersWithUniforms, material: Material): void {
  if (!shader.fragmentShader.includes('#include <alphatest_fragment>') || !shader.vertexShader.includes('#include <fog_vertex>')) return
  Object.assign(shader.uniforms, levelFadeUniforms)
  shader.uniforms.kasbahOpacity = materialOpacity(material)
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 kasbahFadeView;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\n  kasbahFadeView = mvPosition.xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
    .replace('#include <alphatest_fragment>', `${FRAGMENT}\n#include <alphatest_fragment>`)
}
