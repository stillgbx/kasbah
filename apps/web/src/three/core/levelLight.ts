import { Material, ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'
import { applyHeightMist } from './heightMist'
import { applyLevelFade } from './levelFade'

// Une lampe d'intérieur n'éclaire que SON niveau, dans le shader, en une seule passe.
//
// Une `PointLight` ignore la géométrie : sans rien faire, le plafonnier du salon éclaire le sas
// d'entrée en dessous à travers la dalle. Ce fichier ajoute, à la boucle des lumières ponctuelles de
// chaque matière éclairée, un test de HAUTEUR : la lampe et le pixel sont rangés dans une tranche
// par les élévations des niveaux, et la lampe ne compte que si c'est la même tranche.
//
// Ce qui le remplace : un rendu en PASSES (la matière sous l'éclairage global, puis chaque niveau
// allumé redessiné seul avec ses lampes). Il coûtait une image de plus par niveau allumé, et surtout
// — l'ensemble des lumières changeant d'une passe à l'autre — il obligeait three à réévaluer le
// programme de CHAQUE matière à chaque passe : 14 ms de CPU par image sur la maison réelle, mesuré
// le 2026-09-24 (voir `doc/1_architecture/1_5_scene-3d.md`).
//
// Les lampes de JARDIN ne sont pas testées : elles portent une ombre (`castShadow`), c'est l'ombre
// qui les arrête au mur. Three range les lumières qui portent une ombre EN TÊTE de la liste
// (`shadowCastingAndTexturingLightsFirst`), d'où le test `UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS`.
// Une lampe de jardin éteinte ne porte pas d'ombre : elle tombe dans le test, mais elle n'éclaire rien.
//
// Une matière marquée `userData.noLamps` (le terrain, les zones, le toit, l'eau) ne reçoit aucune
// lampe d'intérieur : le sol du jardin est à la hauteur du rez-de-chaussée, une lampe du salon le
// tacherait à travers la façade.

/** Tranches au plus : un niveau de plus que de bornes. */
const MAX_BOUNDS = 8

/** Hauteurs MONDE des niveaux, sauf le plus bas, croissantes. Partagées par toutes les matières. */
export const levelLightUniforms = {
  kasbahLevelY: { value: new Float32Array(MAX_BOUNDS) },
  kasbahLevelCount: { value: 0 },
}

/** Pose les bornes des tranches (élévations monde des niveaux, dans n'importe quel ordre). */
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
// d'une position VUE à la hauteur MONDE : la ligne y de l'inverse de la matrice de vue
float kasbahWorldY( vec3 p ) { return dot( viewMatrix[ 1 ].xyz, p - viewMatrix[ 3 ].xyz ); }
// Le dessus d'une dalle est posé EXACTEMENT sur la borne : le pixel est relevé de 5 mm pour tomber
// dans le niveau qu'elle porte, son dessous restant au niveau d'en dessous (c'est son plafond).
bool kasbahLampReaches( vec3 lightPos, vec3 fragPos ) {
  if ( kasbahLamps < 0.5 ) return false;
  return kasbahBand( kasbahWorldY( lightPos ) ) == kasbahBand( kasbahWorldY( fragPos ) + 0.005 );
}
`

const POINT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );'
const POINT_DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );'

/** La boucle des lumières ponctuelles, testée : une lampe masquée ou éteinte ne calcule rien. */
const LIGHTS_BEGIN = (() => {
  const src = ShaderChunk.lights_fragment_begin
  const start = src.indexOf('#if ( NUM_POINT_LIGHTS > 0 )')
  const end = src.indexOf('#pragma unroll_loop_end', start)
  const block = src.slice(start, end)
  if (start < 0 || !block.includes(POINT_INFO) || !block.includes(POINT_DIRECT)) throw new Error('levelLight: lights_fragment_begin a changé')
  const patched = block
    .replace(POINT_INFO, `${POINT_INFO}
		#if ( UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS )
		directLight.visible = directLight.visible && kasbahLampReaches( pointLight.position, geometryPosition );
		#endif`)
    .replace(POINT_DIRECT, `if ( directLight.visible ) ${POINT_DIRECT}`)
  return src.slice(0, start) + patched + src.slice(end)
})()

/** Applique le masque à un shader en cours de compilation. Sans effet sur une matière non éclairée. */
export function applyLevelLight(shader: WebGLProgramParametersWithUniforms, material: Material): void {
  if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) return
  shader.uniforms.kasbahLevelY = levelLightUniforms.kasbahLevelY
  shader.uniforms.kasbahLevelCount = levelLightUniforms.kasbahLevelCount
  shader.uniforms.kasbahLamps = { value: material.userData.noLamps ? 0 : 1 }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>\n${PARS}`)
    .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
}

// Posé sur le PROTOTYPE : toute matière éclairée de la scène le reçoit, y compris celles que les
// marqueurs créent à la volée, sans qu'aucun constructeur ait à y penser. Une matière qui pose son
// propre `onBeforeCompile` (l'eau) appelle `applyLevelLight` elle-même. La brume basse
// (`heightMist.ts`) et le fondu des étages (`levelFade.ts`) passent par le même crochet, pour la
// même raison.
Material.prototype.onBeforeCompile = function (this: Material, shader: WebGLProgramParametersWithUniforms) {
  applyLevelLight(shader, this)
  applyHeightMist(shader, this)
  applyLevelFade(shader, this)
}
