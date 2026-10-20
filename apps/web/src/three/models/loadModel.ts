import type { BufferGeometry, Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Loading of the 3D car bodies. Same contract as `TextureLoad` (screenArt): a function type
// that the scene injects, so that a marker stays testable without a network — the tests run under
// happy-dom, where no file loads.
//
// What comes back is a GEOMETRY, not a scene: the shipped .glb files carry only a mesh and a
// neutral white material, and the scene applies the color (the one set by the user,
// or its own, which follows the theme). The file's material is therefore thrown away.

export type ModelLoad = (url: string, onLoad: (geometry: BufferGeometry) => void, onError: () => void) => void

/**
 * One geometry per URL, shared by all markers: two Teslas in the scene, a single
 * download. The promise is cached from the start, not on arrival, so that two
 * markers created in the same frame do not fire two requests.
 */
const cache = new Map<string, Promise<BufferGeometry>>()

/**
 * glTF is Y-up by specification, the house is Z-up: a quarter turn about X sets the car
 * upright. The models are exported nose toward +Y in Blender, which after this
 * rotation lands on the scene's convention (`yaw` 0 = facing +y) — no half turn needed.
 * Applied ONCE to the cached geometry, not on every marker.
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
        if (!found) reject(new Error(`no mesh in ${url}`))
        else resolve(toHouseAxes(found))
      },
      undefined,
      () => reject(new Error(`cannot load: ${url}`)),
    )
  })
}

export const loadModel: ModelLoad = (url, onLoad, onError) => {
  let pending = cache.get(url)
  if (!pending) {
    pending = fetchGeometry(url)
    cache.set(url, pending)
    // A failure is not cached: a network outage must not doom the car body
    // until the next page reload.
    pending.catch(() => cache.delete(url))
  }
  pending.then(onLoad).catch(() => onError())
}
