import type { BufferGeometry, Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Chargement des carrosseries 3D. Même contrat que `TextureLoad` (screenArt) : un type de fonction
// que la scène injecte, pour qu'un marqueur reste testable sans réseau — les tests tournent sous
// happy-dom, où aucun fichier ne se charge.
//
// Ce qui revient est une GÉOMÉTRIE, pas une scène : les .glb livrés ne portent qu'un maillage et un
// matériau blanc neutre, et c'est la scène qui applique la couleur (celle réglée par l'utilisateur,
// ou la sienne, qui suit le thème). Le matériau du fichier est donc jeté.

export type ModelLoad = (url: string, onLoad: (geometry: BufferGeometry) => void, onError: () => void) => void

/**
 * Une géométrie par URL, partagée par tous les marqueurs : deux Tesla dans la scène, un seul
 * téléchargement. La promesse est mise en cache dès le départ, pas à l'arrivée, pour que deux
 * marqueurs créés dans la même image ne lancent pas deux requêtes.
 */
const cache = new Map<string, Promise<BufferGeometry>>()

/**
 * Le glTF est Y-up par spécification, la maison est Z-up : un quart de tour sur X remet la voiture
 * d'aplomb. Les modèles sont exportés nez vers +Y dans Blender, ce qui retombe après cette
 * rotation sur la convention de la scène (`yaw` 0 = face à +y) — aucun demi-tour à prévoir.
 * Appliqué UNE FOIS à la géométrie mise en cache, pas à chaque marqueur.
 */
function toHouseAxes(geometry: BufferGeometry): BufferGeometry {
  geometry.rotateX(Math.PI / 2)
  return geometry
}

function fetchGeometry(url: string): Promise<BufferGeometry> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        let found: BufferGeometry | undefined
        gltf.scene.traverse((o) => {
          if (!found && (o as Mesh).isMesh) found = (o as Mesh).geometry as BufferGeometry
        })
        if (!found) reject(new Error(`aucun maillage dans ${url}`))
        else resolve(toHouseAxes(found))
      },
      undefined,
      () => reject(new Error(`chargement impossible : ${url}`)),
    )
  })
}

export const loadModel: ModelLoad = (url, onLoad, onError) => {
  let pending = cache.get(url)
  if (!pending) {
    pending = fetchGeometry(url)
    cache.set(url, pending)
    // Un échec ne se met pas en cache : une coupure réseau ne doit pas condamner la carrosserie
    // jusqu'au prochain rechargement de la page.
    pending.catch(() => cache.delete(url))
  }
  pending.then(onLoad).catch(() => onError())
}
