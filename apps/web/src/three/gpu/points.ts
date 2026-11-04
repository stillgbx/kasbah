import { InstancedBufferAttribute, Sprite, type BufferAttribute, type Camera, type Object3D, type PerspectiveCamera, type Points, type PointsMaterial } from 'three'
import { SpriteNodeMaterial, type Node } from 'three/webgpu'
import { float, instancedBufferAttribute, materialColor, min, mix, modelViewMatrix, select, smoothstep, uniform, vec4 } from 'three/tsl'
import { FAR_ALPHA, FAR_SHADE, FAR_SIZE } from '../relief/reliefEditor'

// WebGPU draws a `Points` one pixel wide, whatever its `size` (a WebGPU point has no size). Three's
// way to draw sized points is a `Sprite` instanced `count` times, positioned by a buffer attribute.
// Rather than giving every effect a second construction, each `Points` of the scene gets here a TWIN:
// a sprite, child of the `Points` (same transform, same visibility), whose instance attributes share
// the `Points`' ARRAYS — positions moved every frame (rain, sparkles) included — and are sent to the
// GPU again when the originals change. Its own attributes, not the originals read twice: the same
// buffer used per vertex by the `Points` and per instance by the sprite drew, now and then, one
// distorted flake over half the image. The `Points` stays for picking (the relief handles), its
// material made invisible.
//
// A plain `SpriteNodeMaterial` sized in metres, not `PointsNodeMaterial` in sprite mode: its pixel
// sizing reads `viewportSize`, wrong inside the effect chain's passes — one point covered half the image.
//
// The relief handles' depth fade (`reliefEditor.ts`, `fadeWithDepth`) is redone on the twin from the
// range the editor keeps up to date (`userData.reliefDepth`).

interface Twin {
  sprite: Sprite
  material: PointsMaterial
  version: number
  source: { position: BufferAttribute; color: BufferAttribute | undefined }
  copy: { position: InstancedBufferAttribute; color: InstancedBufferAttribute | undefined }
  /** The originals' versions last sent. */
  sent: { position: number; color: number }
}

const twins = new WeakMap<Points, Twin>()

type ReliefDepth = { near: { value: number }; far: { value: number } }

/** Largest attenuated point, in CSS pixels. */
const MAX_POINT_PX = 64

/**
 * What the sizes depend on, re-read at each render: the camera's vertical scale and the canvas height
 * in CSS pixels. Read in the projection matrix (`1 / tan(fov/2)` in perspective, `2 / height` in
 * orthographic), which also carries the zoom.
 */
const view = { tanHalf: 0.36, perspective: 1, orthoPerPx: 0.01, heightPx: 1000 }
const tanHalf = uniform(0.36).onRenderUpdate(() => view.tanHalf)
const isPerspective = uniform(1).onRenderUpdate(() => view.perspective)
const orthoPerPx = uniform(0.01).onRenderUpdate(() => view.orthoPerPx)
const heightPx = uniform(1000).onRenderUpdate(() => view.heightPx)

/** Called before each frame: the camera and the canvas the twins are sized for. */
export function setPointView(camera: Camera, heightCssPx: number): void {
  view.heightPx = Math.max(1, heightCssPx)
  const scaleY = camera.projectionMatrix.elements[5]!
  view.perspective = (camera as PerspectiveCamera).isPerspectiveCamera ? 1 : 0
  if (view.perspective) view.tanHalf = 1 / scaleY
  else view.orthoPerPx = 2 / scaleY / view.heightPx
}

/** An instance attribute over the same numbers as `a`. */
const instanced = (a: BufferAttribute) => new InstancedBufferAttribute(a.array, a.itemSize, a.normalized)

function buildMaterial(source: PointsMaterial, position: InstancedBufferAttribute, color: InstancedBufferAttribute | undefined): SpriteNodeMaterial {
  const m = new SpriteNodeMaterial()
  m.color.copy(source.color)
  m.opacity = source.opacity
  m.map = source.map
  m.alphaTest = source.alphaTest
  m.transparent = source.transparent
  m.blending = source.blending
  m.depthTest = source.depthTest
  m.depthWrite = source.depthWrite
  m.toneMapped = source.toneMapped
  m.fog = source.fog
  const center = instancedBufferAttribute(position) as unknown as Node<'vec3'>
  m.positionNode = center
  const viewZ = modelViewMatrix.mul(vec4(center, 1)).z.negate()
  // The sprite is sized in METRES; WebGL's rule (`points.glsl`) is in pixels: on screen, an attenuated
  // point is `size × half the height ÷ distance` px, a sprite `metres × half the height ÷ (distance ×
  // tan(fov/2))` px — so `size × tan(fov/2)` metres, whatever the distance. A point in pixels (not
  // attenuated, or any point in orthographic) is `px × metres per pixel at its distance`. The size is the
  // twin's own: a material that changes it is rebuilt (`version`).
  const size = float(source.size)
  const pxToMetres = (px: Node<'float'>) => select(isPerspective.greaterThan(0.5), px.mul(viewZ).mul(tanHalf).mul(2).div(heightPx), px.mul(orthoPerPx))
  // like WebGL, a point whose centre is behind the camera is not drawn, and none grows beyond a cap
  // (WebGL clamps `gl_PointSize`)
  const attenuated = min(size.mul(tanHalf), pxToMetres(float(MAX_POINT_PX)))
  let metres: Node<'float'> = source.sizeAttenuation ? select(isPerspective.greaterThan(0.5), attenuated, pxToMetres(size)) : pxToMetres(size)
  metres = select(isPerspective.greaterThan(0.5).and(viewZ.lessThan(0.05)), float(0), metres)
  // `vec4( materialColor )` keeps the alpha of the map (the snowflakes are cut out of theirs)
  const base = vec4(materialColor as unknown as Node<'vec4'>)
  let colour: Node<'vec4'> | null = color && source.vertexColors ? base.mul(vec4((instancedBufferAttribute(color) as unknown as Node<'vec3'>).xyz, 1)) : null
  const depth = (source.userData as { reliefDepth?: ReliefDepth }).reliefDepth
  if (depth) {
    const near = uniform(depth.near.value).onRenderUpdate(() => depth.near.value)
    const far = uniform(depth.far.value).onRenderUpdate(() => depth.far.value)
    const k = smoothstep(near, far, viewZ)
    metres = metres.mul(mix(float(1), float(FAR_SIZE), k))
    const c = colour ?? base
    colour = vec4(c.rgb.mul(mix(float(1), float(FAR_SHADE), k)), c.a.mul(mix(float(1), float(FAR_ALPHA), k)))
  }
  m.scaleNode = metres
  if (colour) m.colorNode = colour
  return m
}

/** Keeps a sized twin for every `Points` of the scene; called before each frame. */
export function syncPointTwins(root: Object3D): void {
  root.traverse((o) => {
    const points = o as Points
    if (!points.isPoints || o.userData.kasbahTwin) return
    const material = points.material as PointsMaterial
    const position = points.geometry.getAttribute('position') as BufferAttribute | undefined
    const color = points.geometry.getAttribute('color') as BufferAttribute | undefined
    let twin = twins.get(points)
    if (twin && (twin.material !== material || twin.version !== material.version || twin.source.position !== position || twin.source.color !== color
      || twin.copy.position.array !== position?.array || twin.copy.color?.array !== color?.array)) {
      twin.sprite.removeFromParent()
      ;(twin.sprite.material as SpriteNodeMaterial).dispose()
      twin = undefined
    }
    if (!position) return
    if (!twin) {
      const copy = { position: instanced(position), color: color ? instanced(color) : undefined }
      const sprite = new Sprite(buildMaterial(material, copy.position, copy.color))
      sprite.userData.kasbahTwin = true
      sprite.frustumCulled = false
      sprite.raycast = () => {}   // picking stays on the `Points`
      sprite.renderOrder = points.renderOrder
      points.add(sprite)
      // an invisible MATERIAL: the `Points` is no longer drawn, its picking and its child the twin stay
      material.visible = false
      twin = { sprite, material, version: material.version, source: { position, color }, copy, sent: { position: position.version, color: color?.version ?? 0 } }
      twins.set(points, twin)
    }
    // the effect moved its points: send the shared numbers again
    if (position.version !== twin.sent.position) { twin.copy.position.needsUpdate = true; twin.sent.position = position.version }
    if (color && twin.copy.color && color.version !== twin.sent.color) { twin.copy.color.needsUpdate = true; twin.sent.color = color.version }
    // what an effect animates without touching `version`
    const m = twin.sprite.material as SpriteNodeMaterial
    m.color.copy(material.color)
    m.opacity = material.opacity
    twin.sprite.count = Math.min(position.count, points.geometry.drawRange.count)
  })
}
