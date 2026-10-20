import type { Material, Object3D} from 'three';
import { Mesh, Sprite, Texture } from 'three'

/** Frees the geometries, materials and textures of a subtree (shared materials are excluded via `keep`). */
export function disposeObject3D(root: Object3D, keep: ReadonlySet<Material> = new Set()): void {
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Sprite) {
      o.geometry?.dispose()
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (!m || keep.has(m)) continue
        for (const v of Object.values(m)) if (v instanceof Texture) v.dispose()
        m.dispose()
      }
    }
  })
  root.removeFromParent()
}
