import { Color, type Material, type WebGLProgramParametersWithUniforms } from 'three'
import { dayFactor, duskFactor, type SceneAmbience } from './ambience'

// La BRUME BASSE : celle qui couche dans la vallée à l'aube et la nuit. Un brouillard de HAUTEUR —
// sa densité décroît avec l'altitude — et non le `Fog` de three, qui ne dépend que de la distance et
// noierait la maison vue d'en haut autant que l'horizon.
//
// La densité est INTÉGRÉE le long du rayon de vue (profil exponentiel, forme fermée) : un rayon qui
// plonge sur la maison ne traverse la nappe que sur ses derniers mètres, un rayon qui rase le terrain
// lointain la traverse sur toute sa longueur. C'est ce qui garde la maison nette et noie le lointain.
//
// Posée sur les seules matières du DEHORS (`userData.noLamps` : terrain, zones, eau, toit), derrière
// `fog_fragment`, par le même crochet que `levelLight.ts`. Les sols d'une pièce sont à la hauteur du
// jardin : sans ce tri, la maison de poupée se remplissait de brume. Le sol infini sous la parcelle
// n'en reçoit pas non plus : il doit rester de la couleur du fond, sans bord visible.
// Réglée par uniforms : densité 0 en plein jour, et changer d'heure ne recompile rien. Le brouillard
// météo (`scene.fog`, `ambience.ts`) reste à part et s'y ajoute.

export const heightMistUniforms = {
  /** Densité (1/m) au niveau du sol ; 0 = pas de brume, l'image est rendue à l'identique. */
  kasbahMistDensity: { value: 0 },
  /** Couleur de la nappe, linéaire. */
  kasbahMistColor: { value: new Color(0, 0, 0) },
  /** Altitude MONDE du sol (terrain) où la nappe est la plus dense. */
  kasbahMistBase: { value: 0 },
  /** Épaisseur caractéristique (m) : la densité est divisée par e tous les `falloff` mètres. */
  kasbahMistFalloff: { value: 1.2 },
}

/** Densité au sol de la brume à son plus fort (1/m), et sa part la nuit (l'aube est son heure). */
const MIST_DENSITY = 0.15
const MIST_NIGHT = 0.6

/**
 * Combien de brume, de 0 à 1 : la nuit une nappe modérée, à l'aube (soleil rasant à l'EST) son plus
 * fort, le soir et le jour rien. Le vent la disperse.
 */
export function mistAmount(a: SceneAmbience): number {
  const dawn = a.sunAzimuthDeg < 180 ? duskFactor(a) : 0
  const k = Math.max(MIST_NIGHT * (1 - dayFactor(a)), dawn)
  const wind = Math.min(1, Math.max(0, ((a.windKmh ?? 0) - 10) / 30))
  return k * (1 - wind)
}

/** Pose la brume de l'ambiance : sa densité, sa couleur, et l'altitude du terrain. */
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
// Épaisseur optique du rayon caméra → pixel dans un milieu de densité d·exp(−(y − base)/H) :
// d·L·H·(e(yc) − e(yf)) / (yf − yc), et d·L·e(y) quand le rayon est à plat.
const FRAGMENT = /* glsl */ `
  if ( kasbahMistDensity > 0.0 ) {
    // du repère VUE à la hauteur MONDE : la ligne y de l'inverse de la matrice de vue
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

/** Ajoute la brume à un shader en cours de compilation : une matière du dehors, et un shader qui a un brouillard. */
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
