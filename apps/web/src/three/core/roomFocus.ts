import type { Material, WebGLProgramParametersWithUniforms } from 'three'
import { Vector2 } from 'three'
import type { Vec2 } from '@kasbah/shared'

// The ROOM being looked at stands out: everything outside it darkens and desaturates. A
// mask in the shader and not transparency — the house stays opaque, nothing is sorted, nothing
// recompiles: the room outline (widened by a wall and a margin — the boundary must never
// fall ON a face, see `HouseScene.highlightRoom`) and the height slice of its level are
// uniforms shared by all materials.
// At `strength` 0 (no room), the test is skipped: the image is rendered identically.

/** Maximum vertices of a room outline; beyond that, no highlight (rare: an L-shaped room has 6). */
export const ROOM_FOCUS_MAX = 24
/** What stays of its light, and of its color, for what is outside the room, at full strength. */
const DIM = { light: 0.45, saturation: 0.35 }
/**
 * Distance (m) from the room outline over which the fade rises from 0 to full strength. Until
 * 2026-09-26 the switch was sharp at the outline ("a bit abrupt"): it is now a gradient that
 * radiates around the room — the neighboring rooms fade little by little, the far end of the house
 * entirely. The outline no longer falls ON any sharp boundary: the grain that flickered there cannot come back.
 */
const FEATHER_M = 2

export const roomFocusUniforms = {
  /** 0 = no room highlighted, 1 = full strength (animated between the two). */
  kasbahFocus: { value: 0 },
  /** Room outline in the WORLD plane (x, z) — the house's y is the world's −z. */
  kasbahFocusPoly: { value: Array.from({ length: ROOM_FOCUS_MAX }, () => new Vector2()) },
  kasbahFocusCount: { value: 0 },
  /** WORLD height slice of the room (underside of the slab, top of the walls). */
  kasbahFocusY: { value: new Vector2(0, 0) },
}

/** Sets the outline (house reference frame, x; y) and the height slice; `false` if the room has too many vertices. */
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
// Distance to the room volume: 0 inside, otherwise the gap to the outline (plan) and to its slice (height).
float kasbahRoomDistance( vec3 w ) {
  bool inside = false;
  float d = 1e6;
  for ( int i = 0; i < ${ROOM_FOCUS_MAX}; i ++ ) {
    if ( i >= kasbahFocusCount ) break;
    vec2 a = kasbahFocusPoly[ i ];
    vec2 b = kasbahFocusPoly[ i == kasbahFocusCount - 1 ? 0 : i + 1 ];
    if ( ( a.y > w.z ) != ( b.y > w.z ) && w.x < ( b.x - a.x ) * ( w.z - a.y ) / ( b.y - a.y ) + a.x ) inside = ! inside;
    vec2 ab = b - a, ap = w.xz - a;
    d = min( d, length( ap - ab * clamp( dot( ap, ab ) / dot( ab, ab ), 0.0, 1.0 ) ) );
  }
  float dy = max( max( kasbahFocusY.x - w.y, w.y - kasbahFocusY.y ), 0.0 );
  return length( vec2( inside ? 0.0 : d, dy ) );
}
`
const FRAGMENT = /* glsl */ `
  if ( kasbahFocus > 0.0 ) {
    // from VIEW space to WORLD: the inverse of the view matrix, column by column
    vec3 kasbahP = kasbahFocusView - viewMatrix[ 3 ].xyz;
    vec3 kasbahW = vec3( dot( viewMatrix[ 0 ].xyz, kasbahP ), dot( viewMatrix[ 1 ].xyz, kasbahP ), dot( viewMatrix[ 2 ].xyz, kasbahP ) );
    float kasbahK = kasbahFocus * smoothstep( 0.0, ${FEATHER_M.toFixed(1)}, kasbahRoomDistance( kasbahW ) );
    float kasbahL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 kasbahDim = mix( vec3( kasbahL ), gl_FragColor.rgb, ${DIM.saturation.toFixed(2)} ) * ${DIM.light.toFixed(2)};
    gl_FragColor.rgb = mix( gl_FragColor.rgb, kasbahDim, kasbahK );
  }
`

/** Adds the mask to a shader being compiled (any three material that has fog). */
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
