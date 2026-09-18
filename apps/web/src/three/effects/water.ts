import type { MeshStandardMaterial } from 'three'

// L'eau d'une piscine qui ne fait plus semblant. Deux gestes, sur les deux matériaux du bassin
// (`builders/materials.ts`) :
//  - la SURFACE ondule : deux trains d'ondes croisés inclinent la normale, donc le point brillant du
//    soleil et le reflet du ciel se déplacent. Rien ne bouge en géométrie — c'est la normale qui
//    ment, pas les sommets ;
//  - le FOND reçoit des CAUSTIQUES : le réseau clair que la surface concentre sur le carrelage.
//    C'est lui qui fait « vraie eau » ; sans lui, une surface qui scintille sur un fond mort.
//
// Le principe des caustiques (replier une interférence sur ses crêtes) est celui des shaders d'eau
// de Shadertoy, mais les lignes sont écrites ici : les shaders y sont publiés en CC BY-NC-SA par
// défaut, on n'en recopie pas le code.
//
// Ce que ça coûte : quelques dizaines d'instructions sur les PIXELS DE LA PISCINE, c'est-à-dire rien.
// Le vrai coût est ailleurs — une eau animée oblige la boucle de rendu à tourner, donc toute la
// scène à se redessiner (`core/renderLoop.ts`). C'est `HouseScene.syncWater` qui décide quand.

/** Le rôle du matériau patché : la lame d'eau, ou les parois et le fond vus de l'intérieur. */
export type WaterRole = 'surface' | 'basin'

/** Le temps de l'animation, en secondes. PARTAGÉ : crêtes et caustiques doivent battre ensemble. */
export type WaterTime = { value: number }

/** Ce qui reste réglable après coup : 0 = eau figée (le style « maquette », la qualité basse). */
export type WaterStrength = { value: number }

/** Échelle du réseau de caustiques : ~1,4 m de période pour les plus grosses mailles. */
const CAUSTIC_SCALE = 2.2

const COMMON = /* glsl */`
varying vec3 vWaterPos;
uniform float uWaterTime;
uniform float uWaterStrength;
`

const FUNCTIONS = /* glsl */`
// La PENTE de la houle (son gradient), pas sa hauteur : c'est elle qui incline la normale.
// Trois ondes directionnelles, de la longue lame au clapot court.
vec2 kasbahWaveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d0 = vec2(0.92, 0.39), d1 = vec2(-0.45, 0.89), d2 = vec2(0.30, -0.95);
  g += d0 * (cos(dot(p, d0) * 2.7 + t * 1.6) * 2.7 * 0.030);
  g += d1 * (cos(dot(p, d1) * 4.1 - t * 2.1) * 4.1 * 0.016);
  g += d2 * (cos(dot(p, d2) * 7.9 + t * 3.4) * 7.9 * 0.005);
  return g;
}

// Le réseau de caustiques : l'interférence de deux ondes repliée sur ses CRÊTES (1 - |w|, puis une
// puissance qui n'en garde que le fil clair), sur trois échelles qui dérivent chacune à sa vitesse.
float kasbahCaustic(vec2 p, float t) {
  float sum = 0.0, tot = 0.0, amp = 1.0, f = 1.0;
  for (int i = 0; i < 3; i++) {
    vec2 q = p * f + vec2(0.11, -0.17) * t;
    float w = sin(q.x + sin(q.y * 1.3 + t * 0.7)) + sin(q.y * 1.1 - sin(q.x * 0.8 - t * 0.6));
    sum += amp * (1.0 - abs(w) * 0.5);
    tot += amp;
    f *= 2.3;
    amp *= 0.5;
  }
  return pow(clamp(sum / tot, 0.0, 1.0), 6.0);
}
`

/**
 * La surface : la houle incline la normale. Le vecteur de pente est dans le repère MONDE (le plan
 * d'eau est horizontal), `normal` dans celui de la CAMÉRA — d'où le passage par `viewMatrix`.
 */
const SURFACE = /* glsl */`
  vec2 waveG = kasbahWaveGrad(vWaterPos.xz, uWaterTime) * uWaterStrength;
  normal = normalize(normal + (viewMatrix * vec4(-waveG.x, 0.0, -waveG.y, 0.0)).xyz);
`

/**
 * Le fond : le réseau clair, en lumière AJOUTÉE (il traverse donc la chaîne d'image comme le reste).
 * Il se concentre là où la surface le projette — le fond en reçoit tout, les parois presque rien,
 * d'où le poids par l'horizontalité de la normale, ramenée au monde (transposée = inverse, la
 * rotation de `viewMatrix` étant orthonormée).
 */
const BASIN = /* glsl */`
  vec3 nWater = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float floorness = smoothstep(0.15, 0.70, abs(nWater.y));
  float caustic = kasbahCaustic(vWaterPos.xz * ${CAUSTIC_SCALE.toFixed(1)}, uWaterTime);
  totalEmissiveRadiance += diffuseColor.rgb * (caustic * floorness * uWaterStrength * 0.75);
`

/**
 * Rend un matériau d'eau VIVANT. Le patch survit aux changements de style : `applyLook` mute les
 * mêmes matériaux (il ne les recrée pas), et une recompilation repasse par `onBeforeCompile`.
 * La force revient en retour : c'est le seul réglage qui bouge ensuite, image après image.
 */
export function makeWaterAlive(mat: MeshStandardMaterial, role: WaterRole, time: WaterTime): WaterStrength {
  const strength: WaterStrength = { value: 0 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = time
    shader.uniforms.uWaterStrength = strength
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWaterPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}${FUNCTIONS}`)
      // après l'émissive : la normale y est posée (cartes comprises) et `lights_fragment_begin`,
      // qui la lira, n'est pas encore passé.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${role === 'surface' ? SURFACE : BASIN}`)
  }
  // Sans clé propre, three réutiliserait le programme d'un matériau standard aux mêmes réglages —
  // et l'eau serait rendue par un shader qui n'a pas reçu le patch.
  mat.customProgramCacheKey = () => `kasbah-water-${role}`
  mat.needsUpdate = true
  return strength
}
