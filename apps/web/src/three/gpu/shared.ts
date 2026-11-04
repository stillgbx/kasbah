import { renderGroup, texture, uniform } from 'three/tsl'

// THE UNIFORMS OF OUR HOOKS LIVE IN `renderGroup`. On a plain material (a `MeshStandardMaterial`
// three converts to nodes), `WebGPURenderer` only re-sends the SHARED uniforms at each render; those of
// the default object group go back to the GPU when the object or its material changes
// (`NodeMaterialObserver.needsRefresh`). A room highlight set or released, a level fading, the swell's
// time stayed at the value of the last rebuild until the camera moved (seen on 2026-11-04). Three's own
// lights do the same (`PointLightNode`).

/** `uniform`, re-sent at every render. */
export const sharedUniform = ((...args: Parameters<typeof uniform>) => uniform(...args).setGroup(renderGroup)) as typeof uniform

/** `texture`, re-bound at every render (the caustics map, a screen's image that changes). */
export const sharedTexture = ((...args: Parameters<typeof texture>) => texture(...args).setGroup(renderGroup)) as typeof texture
