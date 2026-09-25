import type { Material, WebGLProgramParametersWithUniforms } from 'three'
import { Vector2 } from 'three'
import type { Vec2 } from '@kasbah/shared'

// La PIÈCE qu'on regarde se détache : tout ce qui est hors d'elle s'assombrit et se désature. Un
// masque dans le shader et non de la transparence — la maison reste opaque, rien ne se trie, rien
// ne se recompile : le contour de la pièce (élargi d'un mur et d'une marge — la limite ne doit jamais
// tomber SUR une face, voir `HouseScene.highlightRoom`) et la tranche de hauteur de son niveau sont
// des uniforms partagés par toutes les matières.
// À `strength` 0 (aucune pièce), le test est sauté : l'image est rendue à l'identique.

/** Sommets au plus d'un contour de pièce ; au-delà, pas de mise en valeur (rare : une pièce en L en a 6). */
export const ROOM_FOCUS_MAX = 24
/** Ce que garde de sa lumière ce qui est hors de la pièce, et de sa couleur, à pleine force. */
const DIM = { light: 0.45, saturation: 0.35 }

export const roomFocusUniforms = {
  /** 0 = aucune pièce mise en valeur, 1 = pleine force (animé entre les deux). */
  kasbahFocus: { value: 0 },
  /** Contour de la pièce dans le plan MONDE (x, z) — le y de la maison est le −z du monde. */
  kasbahFocusPoly: { value: Array.from({ length: ROOM_FOCUS_MAX }, () => new Vector2()) },
  kasbahFocusCount: { value: 0 },
  /** Tranche de hauteur MONDE de la pièce (dessous de la dalle, haut des murs). */
  kasbahFocusY: { value: new Vector2(0, 0) },
}

/** Pose le contour (repère maison, x ; y) et la tranche de hauteur ; `false` si la pièce a trop de sommets. */
export function setRoomFocusShape(polygon: readonly Vec2[], y0: number, y1: number): boolean {
  if (polygon.length > ROOM_FOCUS_MAX) { roomFocusUniforms.kasbahFocusCount.value = 0; return false }
  polygon.forEach(([x, y], i) => roomFocusUniforms.kasbahFocusPoly.value[i]!.set(x, -y))
  roomFocusUniforms.kasbahFocusCount.value = polygon.length
  roomFocusUniforms.kasbahFocusY.value.set(y0, y1)
  return true
}

export function setRoomFocusStrength(k: number): void {
  roomFocusUniforms.kasbahFocus.value = roomFocusUniforms.kasbahFocusCount.value > 0 ? k : 0
}

const VERTEX_PARS = 'varying vec3 kasbahFocusView;'
const FRAGMENT_PARS = /* glsl */ `
varying vec3 kasbahFocusView;
uniform float kasbahFocus;
uniform vec2 kasbahFocusPoly[ ${ROOM_FOCUS_MAX} ];
uniform int kasbahFocusCount;
uniform vec2 kasbahFocusY;
bool kasbahInRoom( vec3 w ) {
  if ( w.y < kasbahFocusY.x || w.y > kasbahFocusY.y ) return false;
  bool inside = false;
  for ( int i = 0; i < ${ROOM_FOCUS_MAX}; i ++ ) {
    if ( i >= kasbahFocusCount ) break;
    vec2 a = kasbahFocusPoly[ i ];
    vec2 b = kasbahFocusPoly[ i == kasbahFocusCount - 1 ? 0 : i + 1 ];
    if ( ( a.y > w.z ) != ( b.y > w.z ) && w.x < ( b.x - a.x ) * ( w.z - a.y ) / ( b.y - a.y ) + a.x ) inside = ! inside;
  }
  return inside;
}
`
const FRAGMENT = /* glsl */ `
  if ( kasbahFocus > 0.0 ) {
    // du repère VUE au MONDE : l'inverse de la matrice de vue, colonne par colonne
    vec3 kasbahP = kasbahFocusView - viewMatrix[ 3 ].xyz;
    vec3 kasbahW = vec3( dot( viewMatrix[ 0 ].xyz, kasbahP ), dot( viewMatrix[ 1 ].xyz, kasbahP ), dot( viewMatrix[ 2 ].xyz, kasbahP ) );
    if ( ! kasbahInRoom( kasbahW ) ) {
      float kasbahL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      vec3 kasbahDim = mix( vec3( kasbahL ), gl_FragColor.rgb, ${DIM.saturation.toFixed(2)} ) * ${DIM.light.toFixed(2)};
      gl_FragColor.rgb = mix( gl_FragColor.rgb, kasbahDim, kasbahFocus );
    }
  }
`

/** Ajoute le masque à un shader en cours de compilation (toute matière de three qui a un brouillard). */
export function applyRoomFocus(shader: WebGLProgramParametersWithUniforms, _material: Material): void {
  if (!shader.fragmentShader.includes('#include <opaque_fragment>') || !shader.vertexShader.includes('#include <fog_vertex>')) return
  Object.assign(shader.uniforms, roomFocusUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', `#include <fog_pars_vertex>\n${VERTEX_PARS}`)
    .replace('#include <fog_vertex>', '#include <fog_vertex>\n  kasbahFocusView = mvPosition.xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
    .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${FRAGMENT}`)
}
