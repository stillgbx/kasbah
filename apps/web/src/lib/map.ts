import type { StyleSpecification } from 'maplibre-gl'
import { geoDistance } from '@kasbah/shared'

// La carte du véhicule : ce qui se décide SANS le moteur de rendu (testable), le composant
// `VehicleMap.vue` ne faisant qu'appliquer. Assemblage entièrement libre, sans compte ni clé :
//   - moteur MapLibre GL JS (rendu vectoriel WebGL, zoom continu, inclinaison, bâtiments 3D) ;
//   - plan : OpenFreeMap (tuiles vectorielles OpenStreetMap, monde entier, gratuit, sans clé) ;
//   - satellite : orthophotos de l'IGN par la Géoplateforme (20 cm par pixel sur toute la France,
//     licence ouverte, sans clé). France seulement : hors de France, la vue satellite est vide et le
//     plan reste le repli naturel — aucun repli mondial pour l'instant (choix de l'utilisateur).
// Google Maps est écarté : depuis mars 2025 la clé exige une carte bancaire, même sans dépasser
// le gratuit.

export type MapMode = 'plan' | 'satellite'
export const MAP_MODES: readonly MapMode[] = ['plan', 'satellite']

/** Styles OpenFreeMap : `liberty` (clair, complet) et `dark`, suivant le thème de l'app. */
export function planStyleUrl(dark: boolean): string {
  return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`
}

/**
 * Orthophotos IGN en WMTS, grille Web Mercator (`PM`) : la même pyramide que le plan, donc les
 * niveaux de zoom coïncident. La couche `HR.ORTHOIMAGERY.ORTHOPHOTOS` est la haute résolution
 * (20 cm) ; le niveau 19 est le plus fin servi partout.
 */
export const IGN_ORTHO_TILE_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal'
  + '&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
export const IGN_ATTRIBUTION = '© IGN — Géoplateforme'
export const IGN_MAX_ZOOM = 19

/** Style « satellite » : une seule source raster, l'IGN. Pas d'étiquettes : la photo parle. */
export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      ign: { type: 'raster', tiles: [IGN_ORTHO_TILE_URL], tileSize: 256, maxzoom: IGN_MAX_ZOOM, attribution: IGN_ATTRIBUTION },
    },
    layers: [{ id: 'ign', type: 'raster', source: 'ign' }],
  }
}

export type LatLon = { lat: number; lon: number }
export type MapView =
  | { kind: 'center'; center: LatLon; zoom: number }
  | { kind: 'bounds'; sw: LatLon; ne: LatLon }
  | { kind: 'none' }

/** Zoom d'une voiture seule : le quartier, assez pour lire la rue. */
export const CAR_ZOOM = 16
/** Au-delà de cette distance, montrer la maison ET la voiture n'apprend plus rien : on cadre la voiture. */
export const BOTH_MAX_M = 3000

/**
 * Cadrage initial. Voiture proche de la maison (garée devant, dans le quartier) : les deux dans
 * le cadre, on voit où elle est PAR RAPPORT à chez soi. Loin : la voiture seule, au zoom du
 * quartier. Sans position de voiture : la maison, à défaut de mieux. Sans rien : rien.
 */
export function initialView(car: LatLon | undefined, home: LatLon | undefined): MapView {
  if (car && home && geoDistance(car, home) <= BOTH_MAX_M) {
    return {
      kind: 'bounds',
      sw: { lat: Math.min(car.lat, home.lat), lon: Math.min(car.lon, home.lon) },
      ne: { lat: Math.max(car.lat, home.lat), lon: Math.max(car.lon, home.lon) },
    }
  }
  if (car) return { kind: 'center', center: car, zoom: CAR_ZOOM }
  if (home) return { kind: 'center', center: home, zoom: CAR_ZOOM }
  return { kind: 'none' }
}

/**
 * Part consommée d'un quota, en pourcentage entier borné à 100 : ce que la jauge du bas de carte
 * remplit. Un quota dépassé (le plugin a compté plus que sa limite) reste plein, il ne déborde pas.
 */
export function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
}

/** Au-delà, la jauge passe en teinte d'alerte : le quota du jour touche à sa fin. */
export const QUOTA_TENSE_PCT = 80

/** Cap normalisé dans [0, 360[ ; Tesla donne 0 = nord, sens horaire, comme MapLibre. */
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360
}
