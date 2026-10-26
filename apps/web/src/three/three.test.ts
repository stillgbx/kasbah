import { describe, expect, it } from 'vitest'
import './textures/prebake' // bakes the materials at import, outside the first test's timeout
import { BackSide, Box3, BoxGeometry, type OrthographicCamera, type PerspectiveCamera, type BufferGeometry, CylinderGeometry, type Material, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial, type Object3D, type ShaderMaterial, ShaderLib, ShapeGeometry, Vector3, type BufferAttribute, type Texture } from 'three'
import { computeHouseGeometry, localToGeo, openingGaps, parseHouse, type DeviceDescriptor, type DeviceState, type OpeningRect, type PlacedHouseDevice } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { buildHouse, buildLevel, countTriangles } from './builders/buildHouse'
import { buildDetails, buildRoofDetails, isGlazed } from './builders/details'
import { alignedToLongestEdge, extrudePolygon } from './builders/shapes'
import { createSurfaceTextures, type SurfaceTexture } from './textures/procedural'
import { createMaterials } from './builders/materials'
import { fitBox, fitDistance, ISO_FOV_DEG, ISO_POLAR, ORTHO_BASE_M, snapIsoAzimuth, sphericalOf, visibleHeight } from './core/cameraFit'
import { boundsToWorldBox, houseToWorld } from './core/coords'
import { createRenderLoop } from './core/renderLoop'
import { createCostGuard, detectQuality, lacksResources } from './core/post'
import { parseCssColor } from './core/theme'
import { defaultLook, defaultSceneTheme, RENDER_STYLES, rolesOf, styleById } from './styles'
import { applyLook } from './builders/materials'
import { dayFactor, fogDistance, fogRange, resolveAmbience, sunDirection, weatherEffects, type AmbienceMode } from './core/ambience'
import { DECOR_LAYER, SITE_DECOR_LAYER } from './core/layers'
import { levelLightUniforms, setLevelHeights } from './core/levelLight'
import { heightMistUniforms, mistAmount } from './core/heightMist'
import { levelFadeUniforms, materialOpacity } from './core/levelFade'
import { roomFocusUniforms } from './core/roomFocus'
import { sunPosition } from './core/sun'
import { createTween } from './core/tween'
import { ScreenArt, coverCrop, screenArtGeometry } from './markers/screenArt'
import { createMarker } from './markers/createMarker'
import type { DeviceMarker } from './markers/DeviceMarker'
import { yawToRad } from '../lib/orientation'
import { HouseScene } from './HouseScene'
import type { Animation } from './core/renderLoop'
import { Precipitation } from './effects/precipitation'
import { createWaterUniforms, makeWaterAlive, setWaterWind, WAVES } from './effects/water'

/** The rate `HouseScene` requests for the water (`WATER_HZ`) — repeated here, the test checks it. */
const WATER_HZ_TEST = 10

/** All the meshes of an object, flattened. */
const meshesOf = (o: Object3D): Mesh[] => {
  const out: Mesh[] = []
  o.traverse((x) => { if (x instanceof Mesh) out.push(x) })
  return out
}

describe('coords', () => {
  it('maps Z-up house frame to Y-up world', () => {
    expect(houseToWorld([1, 2, 3]).toArray()).toEqual([1, 3, -2])
    const box = boundsToWorldBox({ min: [0, 0, 0], max: [10, 8, 3] })
    expect(box.min.toArray()).toEqual([0, 0, -8])
    expect(box.max.x).toBe(10)
    expect(box.max.y).toBe(3)
    expect(box.max.z).toBeCloseTo(0)
  })
})

describe('theme parser', () => {
  it('accepts triplets, rgb() and hex', () => {
    expect(parseCssColor('33,33,33', '#000').r).toBeCloseTo(33 / 255)
    expect(parseCssColor('255 0 0', '#000').g).toBe(0)
    expect(parseCssColor('rgb(0, 128, 255)', '#000').b).toBe(1)
    expect(parseCssColor('#00ff00', '#000').g).toBe(1)
    expect(parseCssColor('', '#ff0000').r).toBe(1)
  })
})

describe('camera fit', () => {
  it('fits a box: the box sphere is inside both fovs', () => {
    const box = new Box3(new Vector3(-5, 0, -5), new Vector3(5, 3, 5))
    const pose = fitBox(box, 45, 4 / 3, { azimuth: 0, polar: Math.PI / 4, padding: 1 })
    const dist = pose.position.distanceTo(pose.target)
    expect(dist).toBeCloseTo(fitDistance(box.getSize(new Vector3()).length() / 2, 45, 4 / 3, 1))
    // portrait: the horizontal field is the narrowest → greater distance
    const portrait = fitBox(box, 45, 3 / 4, { azimuth: 0, polar: Math.PI / 4, padding: 1 })
    expect(portrait.position.distanceTo(portrait.target)).toBeGreaterThan(dist)
  })
})

describe('render loop', () => {
  /**
   * A player's wave lasts 5.75 s and a battery's breath 2.6 s: animating them at the screen's
   * refresh rate redrew the WHOLE scene sixty times per second for a fraction of a pixel. A
   * house where a speaker is playing must not load the browser permanently.
   */
  it('a decorative animation does not redraw at the screen refresh rate', () => {
    const frames: ((now: number) => void)[] = []
    let renders = 0, now = 0
    const loop = createRenderLoop({
      render: () => { renders++ },
      updateControls: () => false,
      requestFrame: (cb) => { frames.push(cb); return frames.length },
      cancelFrame: () => {},
      now: () => now,
    })
    const tick = () => { const cb = frames.shift(); if (cb) { now += 16; cb(now) } }
    loop.addAnimation({ step: () => true })          // a wave that never stops
    for (let i = 0; i < 12; i++) tick()              // ~192 ms of frames at 60 Hz
    expect(loop.running).toBe(true)                  // the loop stays alive…
    expect(renders).toBeLessThanOrEqual(5)           // …but it draws at ~20 Hz, not at 60
    expect(renders).toBeGreaterThanOrEqual(2)
    loop.dispose()
  })

  it('the frame where a tween ends is drawn, even when the decor is not yet due', () => {
    const frames: ((now: number) => void)[] = []
    let renders = 0, now = 0, done = false
    const loop = createRenderLoop({
      render: () => { renders++ },
      updateControls: () => false,
      requestFrame: (cb) => { frames.push(cb); return frames.length },
      cancelFrame: () => {},
      now: () => now,
    })
    const tick = (ms: number) => { const cb = frames.shift(); if (cb) { now += ms; cb(now) } }
    loop.addAnimation({ hz: 1, step: () => true })                     // a slow decor (1 Hz)
    tick(1000)                                                          // it has just been served
    const before = renders
    loop.addTween(createTween({ durationMs: 10, now, onUpdate: () => {}, onDone: () => { done = true } }))
    tick(16)                                                            // the tween ends here, the decor is not due
    expect(done).toBe(true)
    expect(renders).toBe(before + 1)                                    // the final state is on screen
    loop.dispose()
  })

  it('an animation that requests 10 Hz draws half as often as one that requests 20', () => {
    const run = (hz: number | undefined) => {
      const frames: ((now: number) => void)[] = []
      let renders = 0, now = 0
      const loop = createRenderLoop({
        render: () => { renders++ },
        updateControls: () => false,
        requestFrame: (cb) => { frames.push(cb); return frames.length },
        cancelFrame: () => {},
        now: () => now,
      })
      loop.addAnimation(hz === undefined ? { step: () => true } : { hz, step: () => true })
      for (let i = 0; i < 30; i++) { const cb = frames.shift(); if (cb) { now += 16; cb(now) } }
      loop.dispose()
      return renders
    }
    const fast = run(undefined)                      // 20 Hz by default
    const slow = run(WATER_HZ_TEST)                  // the water: 10 Hz
    expect(slow).toBeLessThan(fast)
    expect(slow).toBeGreaterThanOrEqual(fast / 2 - 1)
  })

  it('renders on invalidate and stops when nothing moves; tweens keep it alive', () => {
    const frames: ((now: number) => void)[] = []
    let renders = 0, controlsBusy = false, now = 0
    const loop = createRenderLoop({
      render: () => { renders++ },
      updateControls: () => controlsBusy,
      requestFrame: (cb) => { frames.push(cb); return frames.length },
      cancelFrame: () => {},
      now: () => now,
    })
    const tick = () => { const cb = frames.shift(); if (cb) { now += 16; cb(now) } }
    expect(loop.running).toBe(false)
    loop.invalidate()
    expect(loop.running).toBe(true)
    tick()
    expect(renders).toBe(1)
    expect(loop.running).toBe(false)                 // nothing moves → stop
    controlsBusy = true
    loop.invalidate(); tick(); tick()
    expect(renders).toBe(3)
    expect(loop.running).toBe(true)                  // damping in progress
    controlsBusy = false
    tick()
    expect(loop.running).toBe(false)
    let k = 0
    loop.addTween(createTween({ durationMs: 32, now, onUpdate: (v) => { k = v } }))
    tick(); expect(loop.running).toBe(true)
    tick(); expect(k).toBe(1)
    expect(loop.running).toBe(false)
    loop.dispose()
  })
})

describe('builders', () => {
  const house = parseHouse(demo)
  const geometry = computeHouseGeometry(house)
  const wallMesh = (name: string, level = geometry.levels[0]!) =>
    buildLevel(level, createMaterials(defaultSceneTheme(), defaultLook())).walls.find((m) => m.name === name)!
  it('merges wall prisms into one geometry per kind with the right extents', () => {
    const g = wallMesh('walls:exterior').geometry
    g.computeBoundingBox()
    expect(g.boundingBox!.min.x).toBeCloseTo(-0.3)
    expect(g.boundingBox!.max.x).toBeCloseTo(10.3)
    expect(g.boundingBox!.min.z).toBeCloseTo(0)
    expect(g.boundingBox!.max.z).toBeCloseTo(2.6)
  })
  it('builds the whole house with levels, floors, panes, zones and roof', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const nodes = buildHouse(geometry, mats)
    expect(nodes.levels.size).toBe(3)                        // ground floor, upper floor, and the roof (a level without rooms that carries the panels)
    expect(nodes.levels.get('rdc')!.floors.size).toBe(3)
    expect(nodes.levels.get('rdc')!.panes.length).toBeGreaterThan(0)
    expect(nodes.zones.size).toBe(4)
    expect(nodes.roof).not.toBeNull()
    expect(nodes.root.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(nodes.levels.get('etage')!.group.position.z).toBeCloseTo(3.05)
    expect(countTriangles(nodes.root)).toBeGreaterThan(100)
  })
  it('the walls go from floor to ceiling, partitions included, and the infinite ground is under the plot', () => {
    const level = geometry.levels[0]!
    const interior = wallMesh('walls:interior', level).geometry
    interior.computeBoundingBox()
    expect(interior.boundingBox!.max.z).toBeCloseTo(level.height)
    const nodes = buildHouse(geometry, createMaterials(defaultSceneTheme(), defaultLook()))
    expect(nodes.ground.position.z).toBeLessThan(geometry.terrain.z)
  })
  it('dresses each surface with a material repeated at the meter scale, with its normal and its roughness', () => {
    const tex = createSurfaceTextures(['tile', 'water', 'plaster'])
    for (const t of Object.values(tex)) {
      expect((t.map.image as { width: number }).width).toBeGreaterThanOrEqual(256)
      expect(t.map.repeat.x).toBeGreaterThan(0)
      expect(t.map.repeat.x).toBeLessThanOrEqual(1)   // a pattern of at least one meter
    }
    const px = (t: SurfaceTexture, u: number, v: number) => {
      const img = t.map.image as { data: Uint8Array; width: number }
      return img.data[(Math.floor(v * img.width) * img.width + Math.floor(u * img.width)) * 4]!
    }
    // the tiles: the joint (the darkest of the row) stands out against the tile (its center)
    const row = Array.from({ length: 512 }, (_, x) => px(tex.tile!, (x + 0.5) / 512, 0.125))
    expect(Math.min(...row)).toBeLessThan(px(tex.tile!, 0.125, 0.125) - 40)
    // an almost flat material has its normal pointing up: the blue channel at its maximum
    expect((tex.plaster!.normalMap.image as { data: Uint8Array }).data[2]!).toBeGreaterThan(200)
    const mats = createMaterials(defaultSceneTheme(), defaultLook(), tex)
    expect(mats.floors.tile.map).toBe(tex.tile!.map)
    expect(mats.zones.pool.map).toBe(tex.water!.map)
    expect(mats.wall.normalMap).toBe(tex.plaster!.normalMap)
    // the same packed map serves as roughness AND metalness: three reads the channel it needs
    expect(mats.wall.roughnessMap).toBe(tex.plaster!.roughnessMap)
    expect(mats.wall.metalnessMap).toBe(tex.plaster!.roughnessMap)
  })
})

describe('camera and levels', () => {
  const scene = new HouseScene(document.createElement('canvas'), { headless: true })
  scene.load(parseHouse(demo))
  /** The active camera is of one kind or the other depending on the projection; here we know it is perspective. */
  const persp = () => scene.camera as PerspectiveCamera

  it('frames the free part of the canvas when a panel covers the right edge', () => {
    scene.resize(1000, 500)
    expect(persp().aspect).toBeCloseTo(2)
    scene.setViewInset(400)
    expect(persp().aspect).toBeCloseTo(600 / 500)
    expect(scene.camera.view?.enabled).toBe(true)
    scene.setViewInset(0)
    expect(persp().aspect).toBeCloseTo(2)
    expect(scene.camera.view?.enabled ?? false).toBe(false)
  })
})

describe('view projection', () => {
  it('frames the same world height on both sides of the switch', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    scene.resize(1000, 500)
    const before = scene.camera.position.clone()
    const distance = before.distanceTo(new Vector3())

    scene.setOptions({ projection: 'ortho' })
    const ortho = scene.camera as OrthographicCamera
    expect(ortho.isOrthographicCamera).toBe(true)
    // the pose does not move: only the frustum changes
    expect(scene.camera.position.distanceTo(before)).toBeCloseTo(0)
    // and the zoom shows the world height that the field of view showed at that distance
    expect(ORTHO_BASE_M / ortho.zoom).toBeCloseTo(visibleHeight(distance, 38), 3)
    // the frustum follows the screen's aspect ratio, like `aspect` in perspective
    expect((ortho.right - ortho.left) / (ortho.top - ortho.bottom)).toBeCloseTo(2)

    scene.setOptions({ projection: 'perspective' })
    expect((scene.camera as PerspectiveCamera).isPerspectiveCamera).toBe(true)
    expect(scene.camera.position.distanceTo(before)).toBeCloseTo(0, 2)
  })

  it('the isometric view locks the tilt and rotates by quarter turns', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    scene.resize(1000, 500)
    const shown = () => visibleHeight(scene.camera.position.length(), (scene.camera as PerspectiveCamera).fov)
    const before = shown()
    scene.setOptions({ projection: 'iso' })
    // a NARROW-field perspective, moved back accordingly: the house keeps its size on screen
    expect((scene.camera as PerspectiveCamera).isPerspectiveCamera).toBe(true)
    expect((scene.camera as PerspectiveCamera).fov).toBe(ISO_FOV_DEG)
    expect(shown()).toBeCloseTo(before, 3)
    // headless: no controls, hence no animation — the pose is set in one go
    const poseOf = () => sphericalOf(scene.camera.position, new Vector3())
    expect(poseOf().polar).toBeCloseTo(ISO_POLAR, 5)
    const quarters = [poseOf().azimuth]
    for (let i = 0; i < 3; i++) { scene.orbitBy(Math.PI / 6); quarters.push(poseOf().azimuth) }
    // the requested amplitude does not count: each press makes a quarter turn, and the tilt holds
    // (the gap is brought back into ]-π, π]: `Spherical` restarts from -π after a full turn)
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    for (let i = 1; i < quarters.length; i++) expect(wrap(quarters[i]! - quarters[i - 1]!)).toBeCloseTo(Math.PI / 2, 5)
    expect(poseOf().polar).toBeCloseTo(ISO_POLAR, 5)
    // back to perspective: the base field, the same height shown
    const inIso = shown()
    scene.setOptions({ projection: 'perspective' })
    expect((scene.camera as PerspectiveCamera).fov).toBe(38)
    expect(shown()).toBeCloseTo(inIso, 3)
  })

  it('brings any azimuth back to the nearest isometric corner', () => {
    const origin = -Math.PI / 4
    expect(snapIsoAzimuth(origin + 0.2, origin)).toBeCloseTo(origin, 5)
    expect(snapIsoAzimuth(origin + 1.4, origin)).toBeCloseTo(origin + Math.PI / 2, 5)
    expect(snapIsoAzimuth(origin - 1.4, origin)).toBeCloseTo(origin - Math.PI / 2, 5)
  })
})


describe("cover art on a 3D player's screen", () => {
  /** Vertex whose UV is (u, v): (0,1) = top left of the image, (1,1) = top right. */
  const corner = (g: ReturnType<typeof screenArtGeometry>, u: number, v: number) => {
    const uv = g.getAttribute('uv') as BufferAttribute
    const pos = g.getAttribute('position') as BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      if (uv.getX(i) === u && uv.getY(i) === v) return new Vector3().fromBufferAttribute(pos, i)
    }
    throw new Error(`no vertex at uv ${u},${v}`)
  }

  it("faces +y, the top of the image at the top, and not mirrored for whoever is in front", () => {
    const g = screenArtGeometry(1, 1)
    const normal = g.getAttribute('normal') as BufferAttribute
    const n = new Vector3().fromBufferAttribute(normal, 0)
    expect(n.x).toBeCloseTo(0)
    expect(n.y).toBeCloseTo(1)
    expect(n.z).toBeCloseTo(0)
    // top of the image toward +z (the local frame of a screen box is Z-up)
    expect(corner(g, 0, 1).z).toBeCloseTo(0.5)
    expect(corner(g, 0, 0).z).toBeCloseTo(-0.5)
    // someone standing in front (at +y, looking toward -y) has their right at -x: the top RIGHT of the image is there
    expect(corner(g, 1, 1).x).toBeCloseTo(-0.5)
    expect(corner(g, 0, 1).x).toBeCloseTo(0.5)
  })

  it("fills the screen by cropping, never by distorting (like object-fit: cover)", () => {
    // square cover on a 16:9 panel: we show the central band, 56 % of the height
    const square = coverCrop(1, 16 / 9)
    expect(square.repeat[0]).toBe(1)
    expect(square.repeat[1]).toBeCloseTo(0.5625)
    expect(square.offset[1]).toBeCloseTo(0.21875)
    // image wider than the screen: it is the sides that are cropped
    const wide = coverCrop(2, 16 / 9)
    expect(wide.repeat[1]).toBe(1)
    expect(wide.repeat[0]).toBeCloseTo(0.8889)
    expect(wide.offset[0]).toBeCloseTo(0.0556)
    // same aspect ratio: nothing to crop
    expect(coverCrop(16 / 9, 16 / 9)).toEqual({ repeat: [1, 1], offset: [0, 0] })
    // unknown aspect ratio: assumed square — above all not stretched to fill
    expect(coverCrop(0, 16 / 9)).toEqual(coverCrop(1, 16 / 9))
  })

  it('loads, replaces and frees the texture, and ignores a stale response', () => {
    const loads: { url: string; done: (t: Texture) => void; fail: () => void }[] = []
    const disposed: string[] = []
    // a cover is square: 600 × 600, like those the catalogs serve
    const fakeTexture = (url: string) => ({
      colorSpace: '', image: { width: 600, height: 600 },
      repeat: { set: () => {} }, offset: { set: () => {} },
      dispose: () => disposed.push(url),
    } as unknown as Texture)
    let ready = 0
    const art = new ScreenArt({
      width: 1, height: 0.56, offsetY: 0.03, onReady: () => ready++,
      load: (url, done, fail) => loads.push({ url, done, fail }),
    })
    expect(art.mesh.visible).toBe(false)
    expect(art.mesh.position.y).toBeCloseTo(0.03)

    art.set('/art?a')
    art.set('/art?a')                                     // same image: a single request
    expect(loads).toHaveLength(1)
    loads[0]!.done(fakeTexture('a'))
    expect(art.mesh.visible).toBe(true)
    expect(ready).toBe(1)
    // the framing lives in the UNIFORMS: a hand-written shader ignores `texture.repeat`, and
    // the image came out stretched when the computation only landed on the texture
    const uniforms = art.mesh.material.uniforms
    expect(uniforms.uCrop!.value.y).toBeCloseTo(0.5625)     // square cover on a 16:9 panel
    expect(uniforms.uCropOffset!.value.y).toBeCloseTo(0.21875)
    expect(uniforms.uCrop!.value.x).toBe(1)

    // the track changes: the old texture is freed when the new one arrives
    art.set('/art?b')
    loads[1]!.done(fakeTexture('b'))
    expect(disposed).toEqual(['a'])

    // response for an image no longer expected (channel switching): discarded, the screen keeps its own
    art.set('/art?c')
    art.set('/art?b')
    loads[2]!.done(fakeTexture('c'))
    expect(disposed).toEqual(['a', 'c'])
    expect(art.mesh.visible).toBe(true)

    // nothing plays anymore: bare screen, texture freed
    art.set(undefined)
    expect(art.mesh.visible).toBe(false)
    expect(disposed).toEqual(['a', 'c', 'b'])
  })

  it("keeps the screen bare when the image is unreadable", () => {
    const loads: { fail: () => void }[] = []
    const art = new ScreenArt({ width: 1, height: 0.56, offsetY: 0.03, load: (_url, _done, fail) => loads.push({ fail }) })
    art.set('/art?boom')
    loads[0]!.fail()
    expect(art.mesh.visible).toBe(false)
    art.dispose()
  })
})

describe('3D markers', () => {
  // A marker needs a scene context; we keep the animations at hand to
  // run them to the end (the covers tween their travel over 400 ms).
  const animations: Animation[] = []
  const marker = (device: PlacedHouseDevice, descriptor: DeviceDescriptor) => {
    animations.length = 0
    return createMarker(device, {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow, descriptor,
      addAnimation: (a) => { animations.push(a); return () => {} },
      invalidate: () => {}, onTap: () => {}, label: descriptor.name,
    }, () => true)
  }
  /** Runs the pending tweens: a single step very late is enough to finish them. */
  const settle = () => { for (const a of animations) a.step(performance.now() + 10_000, 10) }
  const meshes = (o: { traverse(cb: (x: unknown) => void): void }) => {
    const out: Mesh[] = []
    o.traverse((x) => { if (x instanceof Mesh) out.push(x) })
    return out
  }
  const device = (extra: Partial<PlacedHouseDevice> = {}): PlacedHouseDevice => ({ id: 'x', position: [0, 0, 2], ...extra })
  const cover = (deviceClass: string): DeviceDescriptor =>
    ({ id: 'p:c', pluginId: 'p', externalId: 'c', kind: 'cover', name: deviceClass, capabilities: ['open_close'], meta: { cover: { deviceClass } } } as DeviceDescriptor)
  const coverState = (position: number | undefined): DeviceState =>
    ({ kind: 'cover', updatedAt: 0, available: true, motion: 'stopped', ...(position === undefined ? {} : { position }) } as DeviceState)

  /**
   * A closed shutter must BLOCK the light: its mesh carries `castShadow` and lives on the shared
   * layer. Its lamp too — the shader confines it to its level (`core/levelLight.ts`); only the
   * translucent DECORATIONS have their own layer, to leave the occlusion capture.
   */
  it('a device casts its shadow; only its decorations have their own layer', () => {
    const shutter = marker(device({ size: { width: 2, height: 1.2 } }), cover('shutter'))
    for (const mesh of meshes(shutter.object)) {
      expect(mesh.castShadow).toBe(true)
      expect(mesh.layers.mask).toBe(1)               // shared layer: the global pass sees it
    }
    const lamp = marker(device(), { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Lampe', capabilities: ['on_off'], meta: {} } as DeviceDescriptor)
    const parts: { light: number[]; sprite: number[] } = { light: [], sprite: [] }
    lamp.object.traverse((o) => {
      if ((o as { isLight?: boolean }).isLight) parts.light.push(o.layers.mask)
      if ((o as { isSprite?: boolean }).isSprite) parts.sprite.push(o.layers.mask)
    })
    expect(parts.light).toEqual([1])
    expect(parts.sprite).toEqual([1 << DECOR_LAYER])
  })

  /**
   * A GARDEN lamp, for its part, must light the facade without going through the wall. No layer knows how
   * to do that: it needs a real cast shadow — and only as long as it is on.
   */
  it('a garden lamp lights everywhere, but casts its shadow', () => {
    const lamp = createMarker(device(), {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow,
      outdoor: true,
      descriptor: { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Borne', capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
      addAnimation: () => () => {}, invalidate: () => {}, onTap: () => {}, label: 'Borne',
    }, () => true)
    const light = (() => { let f: { layers: { mask: number }; castShadow: boolean } | null = null; lamp.object.traverse((o) => { if ((o as { isLight?: boolean }).isLight) f = o as never }); return f! })()
    expect(light.layers.mask).toBe(1)                // shared layer, like every lamp
    expect(light.castShadow).toBe(false)             // off: not six depth renders for nothing
    lamp.update({ kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100 } as DeviceState)
    expect(light.castShadow).toBe(true)
    const sprites: number[] = []
    lamp.object.traverse((o) => { if ((o as { isSprite?: boolean }).isSprite) sprites.push(o.layers.mask) })
    expect(sprites).toEqual([1 << SITE_DECOR_LAYER])  // its halo is a garden decoration
  })

  it('a ceiling light lays a spot of light on the floor, in its color, without extra light', () => {
    const make = (d: PlacedHouseDevice, outdoor = false) => createMarker(d, {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow,
      ...(outdoor ? { outdoor } : {}),
      descriptor: { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Plafonnier', capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
      addAnimation: () => () => {}, invalidate: () => {}, onTap: () => {}, label: 'Plafonnier',
    }, () => true)
    const lamp = make(device({ position: [3, 2, 2.5], mount: 'ceiling' }))
    lamp.object.position.set(3, 2, 2.5)
    const pool = lamp.object.getObjectByName('lamp-pool') as Mesh
    expect(pool.visible).toBe(false)                                   // off: no spot
    lamp.update({ kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100, colorTempMirek: 153 } as DeviceState)
    expect(pool.visible).toBe(true)
    const m = pool.material as MeshBasicMaterial
    expect(m.opacity).toBeGreaterThan(0)
    expect(m.color.b).toBeGreaterThan(m.color.r * 0.9)                   // 6500 K: a cold white, not the warm default
    pool.onBeforeRender(null as never, null as never, null as never, null as never, null as never, null as never)
    expect(pool.position.z).toBeCloseTo(0.004 - 2.5, 5)                 // laid on the level's floor
    expect(pool.layers.mask).toBe(1 << DECOR_LAYER)
    let lights = 0
    lamp.object.traverse((o) => { if ((o as { isLight?: boolean }).isLight) lights++ })
    expect(lights).toBe(1)
    expect(make(device({ position: [3, 2, 0.8] })).object.getObjectByName('lamp-pool')).toBeUndefined()
    expect(make(device({ position: [3, 2, 2.5], mount: 'ceiling' }), true).object.getObjectByName('lamp-pool')).toBeUndefined()
  })

  it('a light tied to a fan lays a hub and three blades, not a sphere alone', () => {
    const lamp = createMarker(device(), {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow,
      linkedFan: true, linkedFanId: 'p:fan',
      descriptor: { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Plafonnier', capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
      addAnimation: () => () => {}, invalidate: () => {}, onTap: () => {}, label: 'Plafonnier',
    }, () => true)
    expect(lamp.object.getObjectByName('ceiling-fan')).toBeTruthy()
    expect(lamp.object.getObjectByName('ceiling-fan-blades')).toBeTruthy()
    let meshCount = 0
    lamp.object.getObjectByName('ceiling-fan')!.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) meshCount++ })
    // hub + globe + 3 blades
    expect(meshCount).toBe(5)
  })

  it('the blades turn when the linked fan is on, and stop otherwise', () => {
    const steps: { step: (now: number, dt: number) => boolean }[] = []
    const lamp = createMarker(device(), {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow,
      linkedFan: true, linkedFanId: 'p:fan',
      descriptor: { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Plafonnier', capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
      addAnimation: (a) => { steps.push(a); return () => { const i = steps.indexOf(a); if (i >= 0) steps.splice(i, 1) } },
      invalidate: () => {}, onTap: () => {}, label: 'Plafonnier',
    }, () => true)
    const blades = lamp.object.getObjectByName('ceiling-fan-blades')!
    const z0 = blades.rotation.z
    lamp.setCompanionFan({ kind: 'fan', updatedAt: 0, available: true, on: true, speed: 3 } as DeviceState)
    expect(steps).toHaveLength(1)
    steps[0]!.step(0, 0.5)
    expect(blades.rotation.z).not.toBe(z0)
    lamp.setCompanionFan({ kind: 'fan', updatedAt: 1, available: true, on: false, speed: 3 } as DeviceState)
    expect(steps).toHaveLength(0)
  })

  it('the blades follow the speed and the direction, and the airflow says cool (down, blue) or warm (up, red)', () => {
    const steps: { step: (now: number, dt: number) => boolean }[] = []
    const lamp = createMarker(device(), {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow,
      linkedFan: true, linkedFanId: 'p:fan', linkedFanSpeeds: [1, 2, 3, 4, 5, 6],
      descriptor: { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Plafonnier', capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
      addAnimation: (a) => { steps.push(a); return () => { const i = steps.indexOf(a); if (i >= 0) steps.splice(i, 1) } },
      invalidate: () => {}, onTap: () => {}, label: 'Plafonnier',
    }, () => true)
    const blades = lamp.object.getObjectByName('ceiling-fan-blades')!
    const air = lamp.object.getObjectByName('ceiling-fan-airflow')!
    const fan = (speed: number, direction: 'forward' | 'reverse') => lamp.setCompanionFan({ kind: 'fan', updatedAt: 0, available: true, on: true, speed, direction } as DeviceState)
    const turn = () => { const z0 = blades.rotation.z; steps[0]!.step(0, 0.1); return blades.rotation.z - z0 }
    expect(air.visible).toBe(false)

    fan(1, 'forward')
    const slow = turn()
    fan(6, 'forward')
    expect(steps).toHaveLength(1)                       // changing speed does not start a 2nd animation
    const fast = turn()
    expect(slow).toBeLessThan(0)                        // summer: clockwise seen from above
    expect(Math.abs(fast)).toBeGreaterThan(Math.abs(slow) * 2)
    fan(6, 'reverse')
    expect(turn()).toBeCloseTo(-fast)

    // ring color, and vertical direction: a wide ring is at the bottom of the column
    const rings = () => air.children as Mesh<BufferGeometry, ShaderMaterial>[]
    const sample = () => {
      const c = rings()[0]!.material.uniforms.uColor!.value as { r: number; b: number }
      // the whole flow stays BELOW the plane of the blades, whatever the direction
      for (const r of rings()) expect(r.position.z).toBeLessThan(0)
      return { r: c.r, b: c.b }
    }
    const widest = () => rings().reduce((a, r) => (r.scale.x > a.scale.x ? r : a))
    const narrowest = () => rings().reduce((a, r) => (r.scale.x < a.scale.x ? r : a))
    expect(widest().position.z).toBeLessThan(narrowest().position.z)
    expect(air.visible).toBe(true)
    const warm = sample()
    expect(warm.r).toBeGreaterThan(warm.b)
    fan(6, 'forward')
    steps[0]!.step(0, 0.05)
    const cool = sample()
    expect(cool.b).toBeGreaterThan(cool.r)
    const ring = narrowest(), z0 = ring.position.z
    steps[0]!.step(0, 0.05)
    expect(ring.position.z).toBeLessThan(z0)          // summer: the air goes down
    fan(6, 'reverse')
    const low = widest(), zl = low.position.z
    steps[0]!.step(0, 0.05)
    expect(low.position.z).toBeGreaterThan(zl)        // winter: it goes up
    lamp.setCompanionFan({ kind: 'fan', updatedAt: 1, available: true, on: false } as DeviceState)
    expect(air.visible).toBe(false)
    expect(steps).toHaveLength(0)
  })

  // The 3D car body arrives AFTER the marker (the .glb is downloaded). What is checked here is
  // that the substitution moves nothing: the generic silhouette is drawn at the dimensions of the expected
  // model, and the real car body takes exactly its place.
  describe('3D car body of a vehicle', () => {
    const tesla = { id: 'tesla:5YJ', pluginId: 'tesla', externalId: '5YJ', kind: 'vehicle', name: 'Model S', capabilities: [], meta: {} } as unknown as DeviceDescriptor
    /** Fake .glb: a box at the catalog dimensions, already converted to the house reference frame. */
    const fakeShell = () => new BoxGeometry(2.32, 4.98, 1.52).translate(0, 0, 0.76)
    const vehicleMarker = (extra: Partial<PlacedHouseDevice>, load?: (url: string, ok: (g: BufferGeometry) => void, ko: () => void) => void) =>
      createMarker({ id: 'vehicle.s', position: [0, 0, 0], ...extra }, {
        materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow, descriptor: tesla,
        addAnimation: () => () => {}, invalidate: () => {}, onTap: () => {}, label: 'Model S',
        ...(load ? { loadModel: load } : {}),
      }, () => true)

    it('draws the silhouette at the expected model\'s dimensions, then replaces it with the car body without moving anything', () => {
      let deliver: ((g: BufferGeometry) => void) | undefined
      const marker = vehicleMarker({}, (url, ok) => { expect(url).toContain('models/tesla/model-s.glb'); deliver = ok })

      const before = new Box3().setFromObject(marker.object)
      expect(meshes(marker.object).length).toBe(2)          // body + cabin
      expect(marker.pickables.length).toBe(2)

      deliver!(fakeShell())
      const after = new Box3().setFromObject(marker.object)
      expect(meshes(marker.object).length).toBe(1)          // the silhouette gave way
      expect(marker.pickables.length).toBe(1)               // and stopped being clickable
      expect(after.min.distanceTo(before.min)).toBeLessThan(0.02)
      expect(after.max.distanceTo(before.max)).toBeLessThan(0.02)
    })

    it('keeps the silhouette when the car body does not load', () => {
      const marker = vehicleMarker({}, (_url, _ok, ko) => ko())
      expect(meshes(marker.object).length).toBe(2)
      expect(marker.pickables.length).toBe(2)
    })

    it("loads nothing when the user asked for the generic silhouette", () => {
      let asked = false
      const marker = vehicleMarker({ model3d: 'none' }, () => { asked = true })
      expect(asked).toBe(false)
      expect(meshes(marker.object).length).toBe(2)
    })
  })

  it("an awning retracts its projection when folding up, without leaving the wall", () => {
    const m = marker(device({ size: { width: 4, height: 3 } }), cover('awning'))
    const box = meshes(m.object)[0]!
    // deployed (position 0 = "lowered"): the declared projection, centered on the placed point
    m.update(coverState(0)); settle()
    expect(box.scale.y).toBeCloseTo(1)
    expect(box.position.y).toBeCloseTo(0)
    // retracted (position 100 = "raised"): only the cassette remains, and the WALL-SIDE edge has not moved
    m.update(coverState(100)); settle()
    expect(box.scale.y * 3).toBeCloseTo(0.3)
    expect(box.position.y - (box.scale.y * 3) / 2).toBeCloseTo(-1.5)
    // unknown position: AT REST, as everywhere else — an awning at rest is retracted
    m.update(coverState(undefined)); settle()
    expect(box.scale.y * 3).toBeCloseTo(0.3)
  })

  it("a rebuilt cover is SET in its position, without replaying its travel", () => {
    // every write to the house rebuilds the markers: a closed shutter reopened then
    // closed again at every saved placement, for the duration of the tween
    const m = marker(device({ size: { width: 4, height: 3 } }), cover('awning'))
    const box = meshes(m.object)[0]!
    m.update(coverState(100))                       // first state, WITHOUT running the animations
    expect(box.scale.y * 3).toBeCloseTo(0.3)        // already retracted: nothing played on screen
    m.update(coverState(0))                         // a real travel, for its part, is animated
    expect(box.scale.y * 3).toBeCloseTo(0.3)
    settle()
    expect(box.scale.y).toBeCloseTo(1)
  })

  it('a gate opens its leaves, one or two according to the JSON', () => {
    const two = marker(device({ size: { width: 4, height: 1.5 } }), cover('gate'))
    const hinges = () => meshes(two.object).map((x) => x.parent!)
    expect(hinges()).toHaveLength(2)
    two.update(coverState(0)); settle()          // closed: both leaves in the gate's plane
    expect(hinges()[0]!.rotation.z).toBeCloseTo(0)
    expect(hinges()[1]!.rotation.z).toBeCloseTo(0)
    two.update(coverState(100)); settle()        // open: a quarter turn, each to its side
    expect(hinges()[0]!.rotation.z).toBeCloseTo(Math.PI / 2)
    expect(hinges()[1]!.rotation.z).toBeCloseTo(-Math.PI / 2)
    // unknown position: at rest, hence shut — a silent gate is not drawn open
    two.update(coverState(undefined)); settle()
    expect(hinges()[0]!.rotation.z).toBeCloseTo(0)
    // a single leaf: a single panel, the full width
    const one = marker(device({ size: { width: 4, height: 1.5 }, leaves: 1 }), cover('gate'))
    expect(meshes(one.object)).toHaveLength(1)
  })

  /**
   * The CURTAIN of a shutter linked to an opening: it fits the opening, and its leaves only
   * divide it — the travel stays vertical, it is what the state publishes.
   */
  describe('shutter curtain', () => {
    const rect = (extra: Partial<OpeningRect> = {}): OpeningRect => ({
      openingId: 'win', roomId: 'salon', levelId: 'rdc', type: 'window', host: 'wall',
      origin: [2, 0, 1], u: [1, 0], normal: [0, -1], width: 2, height: 1.2, depth: 0.3, leaves: 1, ...extra,
    })
    /** Same context as `marker`, plus the opening the cover dresses (and the material set, which we inspect). */
    const dressed = (device: PlacedHouseDevice, opening = rect()) => {
      animations.length = 0
      const materials = createMaterials(defaultSceneTheme(), defaultLook())
      const m = createMarker(device, {
        materials, theme: defaultSceneTheme(), glow: defaultLook().glow, descriptor: cover('shutter'), opening,
        addAnimation: (a) => { animations.push(a); return () => {} },
        invalidate: () => {}, onTap: () => {}, label: 'Volet',
      }, () => true)
      return { m, materials }
    }
    const width = (x: Mesh) => (x.geometry as BoxGeometry).parameters.width

    it("is in one piece by default, and splits by the number of leaves", () => {
      const one = meshes(dressed(device({ position: [3, 0, 1.5] })).m.object)
      expect(one).toHaveLength(1)
      expect(width(one[0]!)).toBeCloseTo(2 * 0.98)      // it slides INSIDE the reveal, not over it

      const two = meshes(dressed(device({ position: [3, 0, 1.5], leaves: 2 })).m.object)
      expect(two).toHaveLength(2)
      expect(width(two[0]!)).toBeCloseTo(width(two[1]!))
      // the gap between the two panels: 2 cm, the same line as the leaves of a door
      expect(two[1]!.position.x - two[0]!.position.x - width(two[0]!)).toBeCloseTo(0.02)
      // both cover the opening, gap included, and stay centered on it (origin 2, width 2)
      expect((two[0]!.position.x + two[1]!.position.x) / 2 + 3).toBeCloseTo(3)
    })

    it('lowers its two leaves together', () => {
      const { m } = dressed(device({ position: [3, 0, 1.5], leaves: 2 }))
      m.update(coverState(0)); settle()                 // closed: the full height of the opening
      for (const slat of meshes(m.object)) {
        expect(slat.scale.z).toBeCloseTo(1.2)
        expect(slat.visible).toBe(true)
      }
      m.update(coverState(100)); settle()               // open: the curtain is retracted, it can no longer be seen
      for (const slat of meshes(m.object)) expect(slat.visible).toBe(false)
    })

    it('keeps the scene\'s material, unless a material or color is requested', () => {
      const plain = dressed(device({ position: [3, 0, 1.5] }))
      expect(meshes(plain.m.object)[0]!.material).toBe(plain.materials.slat)

      const painted = dressed(device({ position: [3, 0, 1.5], leaves: 2, coverMaterial: 'metal', coverColor: '#ffffff' }))
      const mats = meshes(painted.m.object).map((x) => x.material as MeshStandardMaterial)
      expect(mats[0]).not.toBe(painted.materials.slat)
      expect(mats[1]).toBe(mats[0])                     // the two leaves of the same shutter share their material
      expect(mats[0]!.color.getHexString()).toBe('ffffff')
      expect(mats[0]!.metalness).toBeCloseTo(0.85)      // metal reflects, wood does not
      expect(mats[0]!.roughness).toBeCloseTo(0.3)
    })

    it('becomes translucent in GLASS, and then stops casting its shadow', () => {
      // a glazed garage door: here the glass does not glaze the opening, it makes the panel translucent
      const { m } = dressed(device({ position: [3, 0, 1.5], coverMaterial: 'glass' }))
      const slat = meshes(m.object)[0]!
      const mat = slat.material as MeshStandardMaterial
      expect(mat.transparent).toBe(true)
      expect(mat.opacity).toBeCloseTo(0.45)
      expect(slat.castShadow).toBe(false)
    })

    it("shows the hovered tint without staining the other shutters", () => {
      const { m, materials } = dressed(device({ position: [3, 0, 1.5] }))
      const shared = materials.slat.color.getHexString()
      m.previewColor('#ff0000')
      expect(materials.slat.color.getHexString()).toBe(shared)   // the shared material has not moved
      expect((meshes(m.object)[0]!.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000')
      m.previewColor(null)                                       // choice abandoned: the previous tint comes back
      expect((meshes(m.object)[0]!.material as MeshStandardMaterial).color.getHexString()).toBe(shared)
    })
  })

  it("a module's cone shows where its glass faces, negative rack included", () => {
    const sensor = { id: 'p:s', pluginId: 'p', externalId: 's', kind: 'sensor', name: 'Onduleur', capabilities: ['measure'], meta: { sensor: { unit: 'W', deviceClass: 'power', precision: 0 } } } as unknown as DeviceDescriptor
    const panel = { arrayId: 'pv', row: 0, col: 0, width: 1.13, height: 1.76, peakW: 500, maxOutputW: 480, tilt: 35 }
    const cone = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => meshes(m.object).find((x) => x.geometry instanceof ShapeGeometry)
    const tilted = marker(device({ yaw: 90, meta: { panel } }), sensor)
    // the glass leans TOWARD local +y (the azimuth): rotating around +x would lean it toward −y, hence the minus
    expect(meshes(tilted.object)[0]!.rotation.x).toBeCloseTo(-(35 * Math.PI) / 180)
    tilted.setMoving(true, 0)
    // the glass faces the array's azimuth: the cone follows it, without detour
    expect(cone(tilted)!.rotation.z).toBeCloseTo(yawToRad(90))
    // negative rack: the glass tilts backward, the cone turns around
    const back = marker(device({ yaw: 90, meta: { panel: { ...panel, tilt: -20 } } }), sensor)
    back.setMoving(true, 0)
    expect(cone(back)!.rotation.z).toBeCloseTo(yawToRad(90) + Math.PI)
    // laid flat, a module faces NOWHERE: no cone rather than an invented arrow
    const flat = marker(device({ yaw: 90, meta: { panel: { ...panel, tilt: 0 } } }), sensor)
    flat.setMoving(true, 0)
    expect(cone(flat)).toBeUndefined()
  })

  it("a module tints itself by its share of peak, and its edge bar puts a figure on it", () => {
    const sensor = { id: 'p:s', pluginId: 'p', externalId: 's', kind: 'sensor', name: 'Onduleur', capabilities: ['measure'], meta: { sensor: { unit: 'W', deviceClass: 'power', precision: 0 } } } as unknown as DeviceDescriptor
    const panel = { arrayId: 'pv', row: 0, col: 0, width: 1.13, height: 1.76, peakW: 500, maxOutputW: 480, tilt: 35 }
    const glassOf = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => meshes(m.object)[0]!
    // the bar is the last child of the slab (track, then gauge)
    const gaugeOf = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => glassOf(m).children[1] as Mesh
    const lit = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => {
      const e = (glassOf(m).material as MeshStandardMaterial).emissive
      return e.r + e.g + e.b
    }
    const m = marker(device({ meta: { panel } }), sensor)
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 0 } as DeviceState)
    expect(lit(m)).toBe(0)                                        // at rest: midnight blue, off
    expect(gaugeOf(m).visible).toBe(false)
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 250 } as DeviceState)
    const half = lit(m)
    expect(half).toBeGreaterThan(0)
    expect(gaugeOf(m).scale.y).toBeCloseTo(0.5)
    // anchored on the BOTTOM edge (local +y, where the glass leans): at half height, its center moves up
    expect(gaugeOf(m).position.y).toBeCloseTo((1.76 * 0.88) / 4)
    // the peak is the ARRAY's: the same inverter under a 250 Wp module is already at full
    const small = marker(device({ meta: { panel: { ...panel, peakW: 250, maxOutputW: 0 } } }), sensor)
    small.update({ kind: 'sensor', updatedAt: 0, available: true, value: 250 } as DeviceState)
    expect(lit(small)).toBeGreaterThan(half)
    expect(gaugeOf(small).scale.y).toBeCloseTo(1)
    expect(gaugeOf(small).position.y).toBeCloseTo(0)
    // a silent inverter is not worth its last value: the glass goes out, the bar disappears
    m.update({ kind: 'sensor', updatedAt: 0, available: false, value: 250 } as DeviceState)
    expect(lit(m)).toBe(0)
    expect(gaugeOf(m).visible).toBe(false)
  })

  it("the two markers of a module's gauge stay visible, ceiling over record", () => {
    const sensor = { id: 'p:s', pluginId: 'p', externalId: 's', kind: 'sensor', name: 'Onduleur', capabilities: ['measure'], meta: { sensor: { unit: 'W', deviceClass: 'power', precision: 0 } } } as unknown as DeviceDescriptor
    const panel = { arrayId: 'pv', row: 0, col: 0, width: 1.13, height: 1.76, peakW: 500, maxOutputW: 480, tilt: 35 }
    const h = 1.76 * 0.88
    const m = marker(device({ meta: { panel } }), sensor)
    const slab = meshes(m.object)[0]!
    const [record, output] = [slab.children[2] as Mesh, slab.children[3] as Mesh]
    // an inverter that publishes no record: the array's ceiling is alone on the gauge
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 300 } as DeviceState)
    expect([output.visible, record.visible]).toEqual([true, false])
    expect(output.position.y).toBeCloseTo((h / 2) * (1 - 2 * 0.96))
    expect(output.renderOrder).toBeGreaterThan(record.renderOrder)   // at equal value, it hides it
    // the record comes from the device, and survives its silence: the night does not erase it
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 300, maxValue: 431 } as DeviceState)
    expect(record.visible).toBe(true)
    expect(record.position.y).toBeCloseTo((h / 2) * (1 - 2 * (431 / 500)))
    m.update({ kind: 'sensor', updatedAt: 0, available: false, value: 300, maxValue: 431 } as DeviceState)
    expect(record.visible).toBe(true)
    // a ceiling higher than the module's peak (an IQ8P under a 450 Wp) does not disappear:
    // it is the SCALE that opens up, and the marker then sits at the end of the gauge
    const over = marker(device({ meta: { panel: { ...panel, peakW: 450, maxOutputW: 480 } } }), sensor)
    over.update({ kind: 'sensor', updatedAt: 0, available: true, value: 200 } as DeviceState)
    const mark = meshes(over.object)[0]!.children[3] as Mesh
    expect(mark.visible).toBe(true)
    expect(mark.position.y).toBeCloseTo(-h / 2)
  })

  it("a battery cabinet breathes its color: green while charging, blue while discharging, red if it goes silent", () => {
    const theme = defaultSceneTheme()
    const stored = { id: 'p:b', pluginId: 'p', externalId: 'b', kind: 'energy', name: 'Batterie', capabilities: ['storage'], meta: {} } as unknown as DeviceDescriptor
    const site = { ...stored, id: 'p:site', capabilities: ['production', 'consumption', 'grid', 'storage'] } as unknown as DeviceDescriptor
    const energy = (extra: Record<string, unknown>) =>
      ({ kind: 'energy', updatedAt: 0, available: true, productionW: 0, consumptionW: 0, gridW: 0, ...extra }) as DeviceState
    const matOf = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => meshes(m.object)[0]!.material as MeshStandardMaterial
    const pillOn = (m: DeviceMarker) => {
      const css = m.object.children.find((c) => 'element' in c) as unknown as { element: HTMLElement }
      return (css.element.firstElementChild as HTMLElement).dataset.on
    }

    const m = marker(device(), stored)
    // at rest (below the meters' threshold): nothing breathes, and the loop is not woken up
    m.update(energy({ batteryW: 3, batterySoc: 74 }))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations.length).toBe(0)
    expect(pillOn(m)).toBe('0')
    // charging: green. The pill lights up too — a battery never produces anything, and "active"
    // for it means moving energy
    m.update(energy({ batteryW: 1200 }))
    expect(matOf(m).emissive.getHex()).toBe(theme.success.getHex())
    expect(animations.length).toBe(1)
    expect(pillOn(m)).toBe('1')
    // discharging: blue, and the ongoing breath continues — only the color changes
    m.update(energy({ batteryW: -246 }))
    expect(matOf(m).emissive.getHex()).toBe(theme.info.getHex())
    expect(animations.length).toBe(1)
    // no more response: red. It is the only failure the contract carries for an `energy`
    m.update(energy({ batteryW: -246, available: false }))
    expect(matOf(m).emissive.getHex()).toBe(theme.error.getHex())

    // the breath rises and falls in a cosine, without ever going out or saturating
    const at = (ms: number) => { animations[0]!.step(ms, 0); return matOf(m).emissiveIntensity }
    expect(at(1000)).toBeCloseTo(0.06)
    expect(at(1000 + 1300)).toBeCloseTo(0.6)
    expect(at(1000 + 2600)).toBeCloseTo(0.06)

    // back to rest: the cabinet goes out cleanly and hands control back (rendering is on demand)
    m.update(energy({ batteryW: 0 }))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations[0]!.step(4000, 0)).toBe(false)

    // the installation's gateway carries the same figures, but it is not a battery
    const gateway = marker(device(), site)
    gateway.update(energy({ batteryW: -246 }))
    expect(matOf(gateway).emissive.getHex()).toBe(0x000000)
    expect(animations.length).toBe(0)
  })

  it('a charger breathes green only while it is charging', () => {
    const theme = defaultSceneTheme()
    const desc = { id: 'p:c', pluginId: 'p', externalId: 'c', kind: 'ev_charger', name: 'Borne', capabilities: [], meta: {} } as unknown as DeviceDescriptor
    const charger = (status: 'disconnected' | 'connected' | 'charging' | 'error') =>
      ({ kind: 'ev_charger', updatedAt: 0, available: true, status, powerW: 0 } as DeviceState)
    const matOf = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => meshes(m.object)[0]!.material as MeshStandardMaterial
    const pillOn = (m: DeviceMarker) => {
      const css = m.object.children.find((c) => 'element' in c) as unknown as { element: HTMLElement }
      return (css.element.firstElementChild as HTMLElement).dataset.on
    }

    const m = marker(device(), desc)
    // plugged in, not charging: nothing breathes — rendering stays on demand
    m.update(charger('connected'))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations.length).toBe(0)
    expect(pillOn(m)).toBe('0')
    // charging: green, even at 0 W — Enphase has not shown the watts field yet
    m.update(charger('charging'))
    expect(matOf(m).emissive.getHex()).toBe(theme.success.getHex())
    expect(animations.length).toBe(1)
    expect(pillOn(m)).toBe('1')
    const at = (ms: number) => { animations[0]!.step(ms, 0); return matOf(m).emissiveIntensity }
    expect(at(1000)).toBeCloseTo(0.06)
    expect(at(1000 + 1300)).toBeCloseTo(0.6)
    expect(at(1000 + 2600)).toBeCloseTo(0.06)
    // back to rest: the cabinet goes out and hands control back
    m.update(charger('connected'))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations[0]!.step(4000, 0)).toBe(false)
    expect(pillOn(m)).toBe('0')
  })

  /** Thermostat and heat pump breathe warm while they heat; a heat pump zone also when its machine does. */
  it('a heating device breathes warm while it heats', () => {
    const theme = defaultSceneTheme()
    const climate = (deviceClass: 'thermostat' | 'heat_pump') =>
      ({ id: `p:${deviceClass}`, pluginId: 'p', externalId: deviceClass, kind: 'climate', name: 'Chauffage', capabilities: ['current_temp'], meta: { climate: { modes: ['heat', 'off'], deviceClass } } }) as unknown as DeviceDescriptor
    const state = (extra: Record<string, unknown>) =>
      ({ kind: 'climate', updatedAt: 0, available: true, mode: 'heat', targetTempC: 19.5, currentTempC: 17, ...extra }) as DeviceState
    const matOf = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => meshes(m.object)[0]!.material as MeshStandardMaterial

    const thermostat = marker(device(), climate('thermostat'))
    thermostat.update(state({ action: 'idle' }))
    expect(matOf(thermostat).emissiveIntensity).toBe(0)
    expect(animations.length).toBe(0)
    thermostat.update(state({ action: 'heating' }))
    expect(matOf(thermostat).emissive.getHex()).toBe(theme.warning.getHex())
    expect(animations.length).toBe(1)
    thermostat.update(state({ action: 'idle' }))
    expect(matOf(thermostat).emissiveIntensity).toBe(0)
    expect(animations[0]!.step(4000, 0)).toBe(false)

    // a cascade zone: no action known, but the machine heats — the block drawn IS the machine
    const zone = marker(device(), climate('heat_pump'))
    zone.update(state({ unitHeating: true }))
    expect(matOf(zone).emissive.getHex()).toBe(theme.warning.getHex())
    // unreachable: it says nothing
    zone.update(state({ unitHeating: true, available: false }))
    expect(matOf(zone).emissiveIntensity).toBe(0)
  })

  it("a battery cabinet's gauge rises with its charge, on both its faces", () => {
    const stored = { id: 'p:b', pluginId: 'p', externalId: 'b', kind: 'energy', name: 'Batterie', capabilities: ['storage'], meta: {} } as unknown as DeviceDescriptor
    const site = { ...stored, id: 'p:site', capabilities: ['production', 'consumption', 'grid', 'storage'] } as unknown as DeviceDescriptor
    const energy = (extra: Record<string, unknown>) =>
      ({ kind: 'energy', updatedAt: 0, available: true, productionW: 0, consumptionW: 0, gridW: 0, ...extra }) as DeviceState
    const h = 1 * 0.86                                          // the bar is 86 % of the cabinet's height
    const m = marker(device(), stored)
    const box = meshes(m.object)[0]!
    // a track and a bar PER large face: the cabinet reads from the front as from the back
    expect(box.children).toHaveLength(4)
    const [frontTrack, frontFill, , backFill] = box.children as Mesh[]
    expect(frontTrack!.position.y).toBeCloseTo(0.078)           // laid on the sheet metal, 3 mm in front
    expect(backFill!.position.y).toBeCloseTo(-0.078)
    for (const f of [frontFill!, backFill!]) {
      // the bar rises toward the TOP of the cabinet, whichever face carries it
      expect(new Vector3(0, 1, 0).applyEuler(f.rotation).z).toBeCloseTo(1)
    }
    // and each face looks out of the cabinet
    expect(new Vector3(0, 0, 1).applyEuler(frontFill!.rotation).y).toBeCloseTo(1)
    expect(new Vector3(0, 0, 1).applyEuler(backFill!.rotation).y).toBeCloseTo(-1)

    m.update(energy({ batterySoc: 50 }))
    for (const f of [frontFill!, backFill!]) {
      expect(f.visible).toBe(true)
      expect(f.scale.y).toBeCloseTo(0.5)
      expect(f.position.z).toBeCloseTo(-h / 4)                  // anchored on the BOTTOM edge: its center goes down
    }
    m.update(energy({ batterySoc: 100 }))
    expect(frontFill!.scale.y).toBeCloseTo(1)
    expect(frontFill!.position.z).toBeCloseTo(0)
    // flat: the track stays, the bar fades out — an empty cabinet SAYS so
    m.update(energy({ batterySoc: 0 }))
    expect([frontTrack!.visible, frontFill!.visible]).toEqual([true, false])
    // silent: the last known level holds. A charge does not evaporate with the link, and the
    // red breath already says the figure is frozen
    m.update(energy({ batterySoc: 62, available: false }))
    expect(frontFill!.visible).toBe(true)
    expect(frontFill!.scale.y).toBeCloseTo(0.62)
    // unknown charge: nothing, not even the track — an empty gauge would read as a flat battery
    m.update(energy({}))
    expect([frontTrack!.visible, frontFill!.visible]).toEqual([false, false])
    // the installation's gateway is not a cabinet: it has no gauge to carry
    expect(meshes(marker(device(), site).object)[0]!.children).toHaveLength(0)
  })

  it('a thermostat is a disc lying against its wall, rotated by the yaw', () => {
    const desc = { id: 'p:t', pluginId: 'p', externalId: 't', kind: 'climate', name: 'Thermostat', capabilities: [], meta: {} } as unknown as DeviceDescriptor
    const m = marker(device({ yaw: 90 }), desc)
    const puck = meshes(m.object)[0]!
    expect(puck.geometry).toBeInstanceOf(CylinderGeometry)
    // the cylinder axis stays horizontal (no Z-up tilt): its discs are vertical
    expect(puck.rotation.x).toBe(0)
    expect(puck.rotation.z).toBeCloseTo(Math.PI / 2)
    const params = (puck.geometry as CylinderGeometry).parameters
    expect(params.radiusTop).toBeLessThan(0.1)
  })

  /**
   * The SAME kind carries two objects that have nothing to do with each other: the thermostat above, and the module
   * of a heat pump. Drawing the latter as a disc made a whole heating installation
   * look like a living room box placed in the boiler room.
   */
  it('a heat pump is a BLOCK on the floor, not a thermostat disc', () => {
    const desc = {
      id: 'p:hp', pluginId: 'p', externalId: 'hp', kind: 'climate', name: 'Chauffage', capabilities: [],
      meta: { climate: { modes: ['heat'], deviceClass: 'heat_pump' } },
    } as unknown as DeviceDescriptor
    const box = meshes(marker(device({ yaw: 90 }), desc).object)[0]!
    expect(box.geometry).toBeInstanceOf(BoxGeometry)
    // 60 × 36 × 120 cm: a machine rising from the floor, like a battery cabinet
    const p = (box.geometry as BoxGeometry).parameters
    expect([p.width, p.height, p.depth]).toEqual([0.6, 0.36, 1.2])
    expect(p.depth).toBeGreaterThan(1)                   // much taller than wide: it shows
    expect(box.rotation.z).toBeCloseTo(Math.PI / 2)      // it follows its yaw, like the rest of the furniture
  })

  it("a water treatment station is a wall housing at the vendor's dimensions, rotated by the yaw", () => {
    const desc = { id: 'p:w', pluginId: 'p', externalId: 'w', kind: 'water', name: 'Station', capabilities: [], meta: {} } as unknown as DeviceDescriptor
    const m = marker(device({ yaw: 90 }), desc)
    const box = meshes(m.object)[0]!
    // 59 × 59 × 17 cm (COMAP Proteo 2): wide and FLAT, the thickness is the y axis, the wall's
    // (three's parameters are x, y, z: `height` is the y axis, hence the thickness in the Z-up frame)
    const p = (box.geometry as BoxGeometry).parameters
    expect([p.width, p.height, p.depth]).toEqual([0.59, 0.17, 0.59])
    expect(box.rotation.z).toBeCloseTo(Math.PI / 2)      // it sits against its wall, like the thermostat
  })

  it("a speaker takes the requested silhouette: cylinder, puck, bar or orientable block", () => {
    const speaker = {
      id: 'p:s', pluginId: 'p', externalId: 's', kind: 'media_player', name: 'Enceinte', capabilities: [],
      meta: { mediaPlayer: { deviceClass: 'speaker' } },
    } as unknown as DeviceDescriptor
    // default (field absent): upright cylinder, without yaw
    const tube = meshes(marker(device({ yaw: 90 }), speaker).object)[0]!
    expect(tube.geometry).toBeInstanceOf(CylinderGeometry)
    const tubeP = (tube.geometry as CylinderGeometry).parameters
    expect([tubeP.radiusTop, tubeP.height]).toEqual([0.13, 0.32])
    expect(tube.rotation.x).toBeCloseTo(Math.PI / 2)     // Y axis → Z-up
    expect(tube.rotation.z).toBe(0)                      // a tube has no face

    // puck: short cylinder, still without yaw
    const pebble = meshes(marker(device({ speakerShape: 'pebble', yaw: 90 }), speaker).object)[0]!
    expect(pebble.geometry).toBeInstanceOf(CylinderGeometry)
    const pebbleP = (pebble.geometry as CylinderGeometry).parameters
    expect([pebbleP.radiusTop, pebbleP.height]).toEqual([0.14, 0.1])
    expect(pebble.rotation.z).toBe(0)

    // bar: elongated box, yaw applied
    const bar = meshes(marker(device({ speakerShape: 'bar', yaw: 90 }), speaker).object)[0]!
    expect(bar.geometry).toBeInstanceOf(BoxGeometry)
    const barP = (bar.geometry as BoxGeometry).parameters
    expect([barP.width, barP.height, barP.depth]).toEqual([0.55, 0.08, 0.07])
    expect(bar.rotation.z).toBeCloseTo(Math.PI / 2)

    // clock block: small rectangle, yaw applied (front face)
    const block = meshes(marker(device({ speakerShape: 'block', yaw: 90 }), speaker).object)[0]!
    expect(block.geometry).toBeInstanceOf(BoxGeometry)
    const blockP = (block.geometry as BoxGeometry).parameters
    expect([blockP.width, blockP.height, blockP.depth]).toEqual([0.14, 0.08, 0.1])
    expect(block.rotation.z).toBeCloseTo(Math.PI / 2)
  })

  it("a feeder or a fountain is a tower a little taller than wide, not a ball", () => {
    for (const kind of ['pet_feeder', 'pet_fountain'] as const) {
      const desc = {
        id: `p:${kind}`, pluginId: 'p', externalId: kind, kind, name: kind, capabilities: [], meta: {},
      } as unknown as DeviceDescriptor
      const box = meshes(marker(device(), desc).object)[0]!
      expect(box.geometry).toBeInstanceOf(BoxGeometry)
      const p = (box.geometry as BoxGeometry).parameters
      expect([p.width, p.height, p.depth]).toEqual([0.12, 0.12, 0.2])
      expect(p.depth).toBeGreaterThan(p.width)            // taller than wide (Z-up)
      expect(box.position.z).toBeCloseTo(0.1)             // standing on the floor, not half buried
    }
  })
})

describe('tap on a wall', () => {
  // The ray went through walls: a tap on chambre1's partition landed on the floor of
  // chambre2, behind it. Upper floor: chambre1 x∈[0; 4.9], partition, chambre2 x∈[5.1; 10].
  const scene = new HouseScene(document.createElement('canvas'), { headless: true })
  scene.load(parseHouse(demo))
  scene.resize(600, 600)
  scene.focusLevel('etage')
  const aim = (from: [number, number, number], to: [number, number, number]) => {
    scene.camera.position.copy(houseToWorld(from))
    scene.camera.lookAt(houseToWorld(to))
    scene.camera.updateMatrixWorld(true)
    scene.scene.updateMatrixWorld(true)
  }

  it('the visible face of a partition gives the room in front, not the one behind', () => {
    aim([2, 2.5, 4.8], [5, 2.5, 4])
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
    aim([8, 2.5, 4.8], [5, 2.5, 4])
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre2' })
  })

  it('a facade seen from the garden gives the room it closes', () => {
    aim([1, -6, 4.3], [1, 3, 4.1])            // x = 1: next to chambre1's window
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
  })
})

describe('tap on the roof', () => {
  // The roof is declared as a LEVEL (it carries panels and a camera) but has neither room nor floor:
  // without it, the ray went through to the hidden room below and the roof disappeared.
  const scene = new HouseScene(document.createElement('canvas'), { headless: true })
  scene.load(parseHouse(demo))
  scene.resize(600, 600)
  // above chambre1 (2.5; 2.5), almost vertical gaze
  const lookDown = () => {
    scene.camera.position.set(2.5, 40, -2.4)
    scene.camera.lookAt(2.5, 5, -2.5)
    scene.camera.updateMatrixWorld(true)
    scene.scene.updateMatrixWorld(true)   // without a render (headless), the world matrices are not up to date
  }

  it('leads to the level the roof carries', () => {
    lookDown()
    scene.focusLevel(null)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'level', levelId: 'toit' })
  })

  it('lets the room be touched when the roof is hidden', () => {
    lookDown()
    scene.focusLevel('etage')
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
  })
})

/**
 * A garage door LINKED to its opening: it is the device that carries the panel, at its dimensions and in
 * its colors. The structure stops drawing one — otherwise the raised door leaves a fixed leaf
 * behind it.
 */
describe('opening dressed by a cover', () => {
  /** The demo house, whose terrace door becomes a garage that the kitchen shutter closes. */
  const garaged = () => {
    const doc = JSON.parse(JSON.stringify(demo)) as typeof demo
    const cuisine = doc.rooms.find((r) => r.id === 'cuisine')!
    const porte = cuisine.openings.find((o) => o.id === 'porte-terrasse') as Record<string, unknown>
    porte.type = 'garage'
    const cover = doc.devices.find((d) => d.id === 'cover.cuisine') as Record<string, unknown>
    cover.openingId = 'porte-terrasse'
    return parseHouse(doc)
  }
  const leafTriangles = (scene: HouseScene) => {
    let n = 0
    scene.scene.traverse((o) => { if (o instanceof Mesh && o.name === 'details:doors') n += countTriangles(o) })
    return n
  }
  const shutter = {
    id: 'mock:cover-kitchen', pluginId: 'mock', externalId: 'k', kind: 'cover', name: 'Volet cuisine',
    capabilities: ['open_close'], meta: { cover: { deviceClass: 'garage' } },
  } as DeviceDescriptor

  it("leaves its panel to the device, even when the descriptor arrives after the house", () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(garaged())
    // the KIND comes from the descriptor: as long as it is missing, the structure draws its leaf as before
    const before = leafTriangles(scene)
    expect(before).toBeGreaterThan(0)
    scene.setDescriptors({ 'mock:cover-kitchen': shutter })
    expect(leafTriangles(scene)).toBeLessThan(before)
    // and the shutter, for its part, is indeed there: it is what we now see in the opening
    expect(meshesOf(scene.markers.get('cover.cuisine')!.object).length).toBeGreaterThan(0)
  })
})

/**
 * A cover linked to an opening does not occupy a point: it DRESSES an opening. Its curtain was
 * already drawn there, but its pill stayed on the JSON's `position` — set once by the auto-placement,
 * then frozen while the opening was refined by finger.
 */
describe('cover linked to an opening', () => {
  it('fits its opening\'s rectangle, pill included', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    const marker = scene.markers.get('cover.baie')!
    // the living room opening: wall y = 0 from x = 3.2; 1.5 m from the corner, 2.4 wide → center 5.9
    expect(marker.object.position.x).toBeCloseTo(5.9)
    // the JSON's `position`, for its part, stayed at 4.2: 1.7 m away from what is drawn
    const written = demo.devices.find((d) => d.id === 'cover.baie')!.position as [number, number, number]
    expect(written[0]).toBeCloseTo(4.2)
    // and in height: the middle of the opening (sill 0.2 + 2.15 / 2), not the file's 1.3
    expect(marker.object.position.z).toBeCloseTo(0.2 + 2.15 / 2)
    // the curtain, for its part, has not moved an inch: it was already on the opening
    const slat = meshesOf(marker.object)[0]!
    expect(marker.object.position.x + slat.position.x).toBeCloseTo(5.9)
  })
})

/**
 * A car has no place written in the house: it is its GPS that places it, corrected by the
 * offset the user measured by eye, and oriented by what is known about it.
 */
describe('vehicle placed by its GPS', () => {
  const VEHICLE = 'mock:vehicle-r5'
  const descriptor = {
    id: VEHICLE, pluginId: 'mock', externalId: 'r5', kind: 'vehicle', name: 'R5',
    capabilities: ['soc', 'range', 'location'], meta: {},
  } as DeviceDescriptor

  /** The demo house, but the R5 is no longer PLACED there: its GPS is authoritative. */
  function unplaced(gpsOffset?: [number, number], yawOffset?: number) {
    const doc = JSON.parse(JSON.stringify(demo)) as typeof demo
    const car = doc.devices.find((d) => d.deviceId === VEHICLE) as Record<string, unknown>
    delete car.position; delete car.yaw; delete car.zoneId
    if (gpsOffset) car.gpsOffset = gpsOffset
    if (yawOffset !== undefined) car.yawOffset = yawOffset
    return parseHouse(doc)
  }

  /** The vehicle's state, set at the requested LOCAL point (the GPS is computed in reverse). */
  const stateAt = (house: ReturnType<typeof parseHouse>, xy: [number, number], headingDeg?: number): DeviceState => {
    const g = localToGeo(house.origin, [xy[0], xy[1], 0])
    return {
      kind: 'vehicle', updatedAt: 1, available: true, soc: 55, rangeKm: 200, pluggedIn: false, charging: false,
      location: { lat: g.lat, lon: g.lon, at: 1 }, ...(headingDeg === undefined ? {} : { headingDeg }),
    } as DeviceState
  }

  /** The car body turns in its own group: it is THIS group that carries the orientation. */
  const bodyYaw = (scene: HouseScene): number => {
    let body: Mesh | null = null
    scene.markers.get('vehicle.r5')!.object.traverse((x) => { if (!body && x instanceof Mesh) body = x as Mesh })
    return (body! as Mesh).parent!.rotation.z
  }

  const sceneWith = (house: ReturnType<typeof parseHouse>) => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setDescriptors({ [VEHICLE]: descriptor })
    return scene
  }

  it('sits at its reading, offset by the JSON correction', () => {
    const plain = unplaced()
    const scene = sceneWith(plain)
    scene.updateStates({ [VEHICLE]: stateAt(plain, [-3.5, -6]) })
    const marker = scene.markers.get('vehicle.r5')!
    expect(marker.object.position.x).toBeCloseTo(-3.5, 2)
    expect(marker.object.position.y).toBeCloseTo(-6, 2)

    const shifted = unplaced([3, -2])
    scene.updateDevices(shifted)
    const moved = scene.markers.get('vehicle.r5')!
    expect(moved.object.position.x).toBeCloseTo(-0.5, 2)
    expect(moved.object.position.y).toBeCloseTo(-8, 2)
  })

  it('follows the vendor\'s heading when it gives one, brought into the house reference frame', () => {
    const house = unplaced()                       // demo: origin.heading = 15
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [-3.5, -6], 90) })
    expect(bodyYaw(scene)).toBeCloseTo(yawToRad(15 - 90), 4)
  })

  it('without a heading, takes the axis of the surrounding room — the garage parks the car along its length', () => {
    const house = unplaced()
    const scene = sceneWith(house)
    // (6; 2) falls in the living room (ground floor, elongated along x) AND in chambre 2 (upper floor): the lower one wins
    scene.updateStates({ [VEHICLE]: stateAt(house, [6, 2]) })
    expect(Math.abs(bodyYaw(scene))).toBeCloseTo(Math.PI / 2, 4)
    // outside, nothing to align with: the marker keeps its default
    scene.updateStates({ [VEHICLE]: stateAt(house, [-3.5, -6]) })
    expect(bodyYaw(scene)).toBe(0)
  })

  /**
   * Neither a measured heading nor a garage's axis says which way round the car was parked: the
   * JSON correction is ADDED to the derived heading, it does not replace it.
   */
  it('adds the JSON correction to the derived heading, whatever its source', () => {
    const plain = unplaced()
    const turned = unplaced(undefined, 30)
    const base = sceneWith(plain)
    const corrected = sceneWith(turned)
    for (const xy of [[-3.5, -6], [6, 2]] as [number, number][]) {                    // outside (nothing) then in the living room (axis)
      for (const heading of [undefined, 90]) {                           // without a heading, then with the vendor's heading
        base.updateStates({ [VEHICLE]: stateAt(plain, xy, heading) })
        corrected.updateStates({ [VEHICLE]: stateAt(turned, xy, heading) })
        expect(bodyYaw(corrected) - bodyYaw(base)).toBeCloseTo(yawToRad(30), 4)
      }
    }
  })
})

/**
 * A vehicle's reading is good to within a few meters: enough to say "it is home", not
 * to place it in its garage. A parking SPACE parks it exactly, when it is at
 * rest next to it — and gives it its direction, which neither its GPS nor a garage says.
 */
describe('parking spaces', () => {
  const VEHICLE = 'mock:vehicle-r5'
  const descriptor = {
    id: VEHICLE, pluginId: 'mock', externalId: 'r5', kind: 'vehicle', name: 'R5',
    capabilities: ['soc', 'range', 'location'], meta: {},
  } as DeviceDescriptor

  /** The demo house, R5 unplaced (its GPS is authoritative), with the given spaces. */
  function withParkings(parkings: Record<string, unknown>[]) {
    const doc = JSON.parse(JSON.stringify(demo)) as typeof demo
    const car = doc.devices.find((d) => d.deviceId === VEHICLE) as Record<string, unknown>
    delete car.position; delete car.yaw; delete car.zoneId
    ;(doc.site as Record<string, unknown>).parkings = parkings
    return parseHouse(doc)
  }

  const stateAt = (house: ReturnType<typeof parseHouse>, xy: [number, number], over: Record<string, unknown> = {}): DeviceState => {
    const g = localToGeo(house.origin, [xy[0], xy[1], 0])
    return {
      kind: 'vehicle', updatedAt: 1, available: true, soc: 55, rangeKm: 200, pluggedIn: false, charging: false,
      location: { lat: g.lat, lon: g.lon, at: 1 }, ...over,
    } as DeviceState
  }

  const bodyYaw = (scene: HouseScene, key = 'vehicle.r5'): number => {
    let body: Mesh | null = null
    scene.markers.get(key)!.object.traverse((x) => { if (!body && x instanceof Mesh) body = x as Mesh })
    return (body! as Mesh).parent!.rotation.z
  }

  const sceneWith = (house: ReturnType<typeof parseHouse>) => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setDescriptors({ [VEHICLE]: descriptor })
    return scene
  }

  const BAY = { id: 'park.garage', accepts: 'vehicle', center: [-3.5, -6], size: [2.5, 5], yaw: 40 }

  it('parks the car at rest on the nearby space, and gives it the space\'s heading', () => {
    const house = withParkings([BAY])
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [-2, -7]) })       // 1.5 m from the center: in the space
    const marker = scene.markers.get('vehicle.r5')!
    expect(marker.object.position.x).toBeCloseTo(-3.5, 2)
    expect(marker.object.position.y).toBeCloseTo(-6, 2)
    expect(bodyYaw(scene)).toBeCloseTo(yawToRad(40), 4)
  })

  it('leaves the car that is too far, and the one that is MOVING, where they are', () => {
    const house = withParkings([BAY])
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [6, 2]) })         // on the terrain, far from the space
    expect(scene.markers.get('vehicle.r5')!.object.position.x).toBeCloseTo(6, 2)
    // at the same point as in the previous test, but moving: the reading takes over again
    scene.updateStates({ [VEHICLE]: stateAt(house, [-2, -7], { speedKmh: 30, gear: 'D' }) })
    expect(scene.markers.get('vehicle.r5')!.object.position.x).toBeCloseTo(-2, 2)
  })

  it('draws the ground marking, in edit mode as outside it', () => {
    const scene = sceneWith(withParkings([BAY]))
    const find = (): Object3D | undefined => {
      let found: Object3D | undefined
      scene.scene.traverse((o) => { if (!found && o.name === 'parking:park.garage') found = o })
      return found
    }
    expect(find()).toBeDefined()
    scene.setEditingParkings(true)
    expect(find()).toBeDefined()
  })

  /**
   * The space does not follow the gesture without anything else moving: `updateParkings` is the short
   * path (no `load`, hence no recentered camera) and it redoes the car's placement.
   */
  it('the car follows the space being moved', () => {
    const house = withParkings([BAY])
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [-2, -7]) })
    scene.updateParkings(withParkings([{ ...BAY, center: [-1, -8] }]))
    const marker = scene.markers.get('vehicle.r5')!
    expect(marker.object.position.x).toBeCloseTo(-1, 2)
    expect(marker.object.position.y).toBeCloseTo(-8, 2)
  })

  /**
   * A space under the upper floor: in the "etage" view, the car pokes through neither as a pill nor on tap — the
   * bedroom floor wins against the garage mesh.
   */
  it('under a focused upper floor, the parked car can be neither seen nor touched', () => {
    const bay = { id: 'park.sous-ch1', accepts: 'vehicle', center: [2, 2], size: [2.5, 5], yaw: 0, levelId: 'rdc' }
    const house = withParkings([bay])
    const scene = sceneWith(house)
    scene.resize(600, 600)
    scene.updateStates({ [VEHICLE]: stateAt(house, [2, 2]) })
    const marker = scene.markers.get('vehicle.r5')!
    // parented to the space's level, not to the garden
    expect(marker.object.parent?.name).toBe('markers')
    scene.focusLevel('etage')
    expect(marker.visibleInScene).toBe(false)
    // vertical gaze on chambre 1 (2.5; 2.5) — the upper floor's floor is in front of the car
    scene.camera.position.set(2.5, 40, -2.4)
    scene.camera.lookAt(2.5, 5, -2.5)
    scene.camera.updateMatrixWorld(true)
    scene.scene.updateMatrixWorld(true)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
  })
})

/**
 * A Husqvarna mower publishes its position as GPS, not in the house reference frame: it is placed
 * like a car (projected onto the terrain), but its marker then FOLLOWS each reading without
 * being rebuilt — while mowing, one arrives every few seconds.
 */
/**
 * The incidents of a robot's log are laid on the terrain when the panel shows them: one
 * pin per point INSIDE the terrain, nothing for a point far out, and everything goes away with `null`.
 */
describe('log incidents laid on the terrain', () => {
  const MOWER = 'automower:c7233734'
  const house = parseHouse(demo)
  const geo = (xy: [number, number]) => { const g = localToGeo(house.origin, [xy[0], xy[1], 0]); return { lat: g.lat, lon: g.lon } }

  it('one pin per terrain point, none for a point far out; `null` removes everything; framing does not crash', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    const pins = () => (scene as unknown as { journal: { group: { children: unknown[] } } | null }).journal?.group.children.length ?? 0
    scene.setJournalPoints(MOWER, [
      { at: 1, ...geo([12, 16]), severity: 'error' },
      { at: 2, ...geo([14, 17]), severity: 'fatal' },
      { at: 3, ...geo([900, 900]), severity: 'warning' },
    ])
    expect(pins()).toBe(2)
    // the active pin grows and shows its label; the others do not; `null` turns everything off
    const journal = () => (scene as unknown as { journal: { points: { at: number; head: { scale: { x: number } }; label: { visible: boolean } | null }[] } }).journal
    scene.focusJournalPoint(2, false)
    expect(journal().points.find((p) => p.at === 2)!.head.scale.x).toBeCloseTo(1.6)
    expect(journal().points.find((p) => p.at === 2)!.label?.visible).toBe(true)
    expect(journal().points.find((p) => p.at === 1)!.head.scale.x).toBe(1)
    expect(journal().points.find((p) => p.at === 1)!.label?.visible).toBe(false)
    scene.setActiveJournalPoint(null)
    expect(journal().points.find((p) => p.at === 2)!.label?.visible).toBe(false)
    scene.focusJournalPoint(999, false)
    // the 2D renderer puts the labels in the DOM: closing the log must remove them from it
    const el = journal().points[0]!.label as unknown as { element: HTMLElement } | null
    if (el) document.body.appendChild(el.element)
    scene.setJournalPoints(null, [])
    expect(pins()).toBe(0)
    expect(el?.element.isConnected ?? false).toBe(false)
    scene.dispose()
  })
})

describe('mower placed by its GPS', () => {
  const MOWER = 'automower:c7233734'
  const descriptor = {
    id: MOWER, pluginId: 'automower', externalId: 'c7233734', kind: 'mower', name: 'Tondeuse',
    capabilities: ['mow', 'park', 'battery', 'schedule'], meta: {},
  } as DeviceDescriptor
  const house = parseHouse(demo)
  const stateAt = (xy: [number, number]): DeviceState => {
    const g = localToGeo(house.origin, [xy[0], xy[1], 0])
    return { kind: 'mower', updatedAt: 1, available: true, activity: 'mowing', battery: 80, location: { lat: g.lat, lon: g.lon, at: 1 } } as DeviceState
  }

  it('not declared in the house, it appears at its reading; a following reading does not rebuild it; off the terrain, it disappears', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setDescriptors({ [MOWER]: descriptor })
    expect(scene.markers.get(MOWER)).toBeUndefined()
    scene.updateStates({ [MOWER]: stateAt([12, 16]) })
    const marker = scene.markers.get(MOWER)!
    expect(marker).toBeDefined()
    expect(marker.object.position.x).toBeCloseTo(12, 2)
    expect(marker.object.position.y).toBeCloseTo(16, 2)
    // one more step in the garden: same marker, it will follow by animation
    scene.updateStates({ [MOWER]: stateAt([14, 17]) })
    expect(scene.markers.get(MOWER)).toBe(marker)
    // carried off the terrain (to the office…): nothing left to draw
    scene.updateStates({ [MOWER]: stateAt([900, 900]) })
    expect(scene.markers.get(MOWER)).toBeUndefined()
    scene.dispose()
  })
})

describe('a lamp only lights its level (a single pass)', () => {
  const compile = (mat: Material) => {
    const lit = mat.type !== 'MeshBasicMaterial'
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: lit ? '#include <lights_pars_begin>\n#include <lights_fragment_begin>' : '#include <common>' }
    mat.onBeforeCompile(shader as never, null as never)
    return shader
  }

  /**
   * The scene rendered in passes — one per lit level — so that a living room lamp would not light
   * the airlock below through the slab. Measured on 2026-09-24: 14 ms of CPU per frame lost
   * re-evaluating programs. The mask now lives in the light loop of EVERY lit material,
   * through the prototype: a material created on the fly by a marker receives it too.
   */
  it('every lit material receives the height mask, not an unlit material', () => {
    const lit = compile(new MeshStandardMaterial())
    expect(lit.fragmentShader).toContain('kasbahLampReaches( pointLight.position, geometryPosition )')
    expect(lit.fragmentShader).toContain('UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS')   // the garden passes
    expect(lit.fragmentShader).toContain('if ( directLight.visible ) RE_Direct')              // masked: nothing to compute
    expect(lit.uniforms.kasbahLevelY).toBe(levelLightUniforms.kasbahLevelY)                   // shared, not copied
    expect(lit.uniforms.kasbahLamps!.value).toBe(1)
    const basic = compile(new MeshBasicMaterial())
    expect(basic.fragmentShader).not.toContain('kasbah')
  })

  it('the terrain, the zones, the roof and the water receive no indoor lamp; the walls do', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    for (const m of [mats.terrain, mats.roof, mats.roofFlat, ...Object.values(mats.zones)]) expect(compile(m).uniforms.kasbahLamps!.value).toBe(0)
    for (const m of [mats.wall, mats.wallInterior, mats.floor, mats.device]) expect(compile(m).uniforms.kasbahLamps!.value).toBe(1)
  })

  it('the slices are the levels\' elevations, without the lowest', () => {
    setLevelHeights([2.85, 0, 5.45])
    expect([...levelLightUniforms.kasbahLevelY.value.slice(0, 2)].map((v) => +v.toFixed(2))).toEqual([2.85, 5.45])
    expect(levelLightUniforms.kasbahLevelCount.value).toBe(2)
    setLevelHeights([0])
    expect(levelLightUniforms.kasbahLevelCount.value).toBe(0)
  })

  /**
   * Hiding the upper floor removes its floor from the shadow map — provided the map is redone. Without
   * a recapture, the hidden upper floor kept darkening the ground floor being explored.
   */
  it('focusing a level requests a shadow recapture', () => {
    let t = 1000
    const scene = new HouseScene(document.createElement('canvas'), { headless: true, now: () => t })
    const house = parseHouse(demo)
    scene.load(house)
    t = 1_000_000
    const dirty = () => (scene as unknown as { shadowsDirtyUntil: number }).shadowsDirtyUntil
    expect(dirty()).toBeLessThan(t)
    scene.focusLevel(house.levels[0]!.id)
    expect(dirty()).toBeGreaterThan(t)
    // …and that recapture survives a wait without a frame (loading veil, shaders compiling):
    // the time window expires, the next frames drawn redo it anyway
    t += 60_000
    expect(dirty()).toBeLessThan(t)
    expect((scene as unknown as { shadowFramesPending: number }).shadowFramesPending).toBeGreaterThan(0)
    scene.dispose()
  })

  /**
   * Three compiles one program per NUMBER of lights. Hiding an upper floor removed its lamps: the
   * first visit to the ground floor recompiled every material, 2.2 s of frozen frame on
   * the iGPU. Lamps that are off stand in for the hidden lamps.
   */
  it('a hidden upper floor flies off then disappears, and comes back down to land', () => {
    let t = 0
    const scene = new HouseScene(document.createElement('canvas'), { headless: true, now: () => t, requestFrame: () => 0, cancelFrame: () => {} })
    const house = parseHouse(demo)
    scene.load(house)
    // a "present" renderer: it is what allows the animation; the loop, for its part, never draws
    ;(scene as unknown as { renderer: object }).renderer = {}
    const lifts = (scene as unknown as { lifts: Map<string, { tween: { step(now: number): boolean } | null }> }).lifts
    const [low, high] = [...house.levels].sort((a, b) => a.elevation - b.elevation)
    const group = scene.nodesOf(high!.id)!.group
    scene.focusLevel(low!.id)
    expect(group.visible).toBe(true)                                    // it is leaving, it has not disappeared
    lifts.get(`level:${high!.id}`)!.tween!.step(t = 200)
    expect(group.position.z).toBeGreaterThan(high!.elevation)
    expect(group.position.z).toBeLessThan(high!.elevation + 8)
    // it fades out while rising, above the top of the ground floor — which, for its part, stays whole
    const fade = levelFadeUniforms.kasbahFadeVisibility.value
    expect(fade).toBeGreaterThan(0)
    expect(fade).toBeLessThan(1)
    // just ABOVE the top of its walls: placed right on it, those faces flickered
    expect(levelFadeUniforms.kasbahFadeY.value).toBeCloseTo(low!.elevation + scene.nodesOf(low!.id)!.height + 0.03, 6)
    for (const key of lifts.keys()) lifts.get(key)!.tween?.step(t = 500)
    expect(group.visible).toBe(false)
    expect(levelFadeUniforms.kasbahFadeVisibility.value).toBe(1)        // nothing in flight anymore: the fade is lifted
    scene.focusLevel(low!.id)                                           // same focus: nothing starts again
    expect(lifts.get(`level:${high!.id}`)!.tween).toBeNull()
    scene.focusLevel(null)
    expect(group.visible).toBe(true)
    for (const key of lifts.keys()) lifts.get(key)!.tween?.step(t = 1100)
    expect(group.position.z).toBeCloseTo(high!.elevation, 6)            // set back down exactly in its place
    expect(group.visible).toBe(true)
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })

  it('a level\'s pills appear and fade out smoothly, instead of popping up', () => {
    let t = 0
    const scene = new HouseScene(document.createElement('canvas'), { headless: true, now: () => t, requestFrame: () => 0, cancelFrame: () => {} })
    const house = parseHouse(demo)
    scene.load(house)
    ;(scene as unknown as { renderer: object }).renderer = {}
    const [low, high] = [...house.levels].sort((a, b) => a.elevation - b.elevation)
    const on = (levelId: string) => [...scene.markers.values()].filter((m) => m.object.parent === scene.nodesOf(levelId)!.markers)
    const pill = (m: DeviceMarker) => (m as unknown as { css: { visible: boolean; element: HTMLElement } }).css
    const tween = () => (scene as unknown as { pillTween: { step(now: number): boolean } | null }).pillTween
    const lows = on(low!.id), highs = on(high!.id)
    expect(lows.length).toBeGreaterThan(0)
    expect(highs.length).toBeGreaterThan(0)
    scene.focusLevel(low!.id)                                           // overview → ground floor
    expect(pill(lows[0]!).visible).toBe(true)
    expect(pill(lows[0]!).element.style.opacity).toBe('0.00')           // they start from nothing…
    tween()!.step(t = 100)
    expect(pill(lows[0]!).element.style.opacity).toBe('0.00')           // …wait for the upper floor to clear…
    tween()!.step(t = 450)
    expect(Number(pill(lows[0]!).element.style.opacity)).toBeGreaterThan(0.2)
    tween()!.step(t = 800)
    expect(pill(lows[0]!).element.style.opacity).toBe('')               // …and end up full, without a style
    scene.focusLevel(high!.id)                                          // ground floor → upper floor
    tween()!.step(t = 1025)
    expect(pill(lows[0]!).visible).toBe(true)                           // it fades, it has not disappeared
    expect(Number(pill(lows[0]!).element.style.opacity)).toBeLessThan(0.8)
    tween()!.step(t = 1250)
    expect(Number(pill(highs[0]!).element.style.opacity)).toBeGreaterThan(0.2)
    tween()!.step(t = 1600)
    expect(pill(lows[0]!).visible).toBe(false)
    expect(pill(highs[0]!).element.style.opacity).toBe('')
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })

  it('the number of point lights does not change when a level is focused', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    const house = parseHouse(demo)
    const descriptors: Record<string, DeviceDescriptor> = {}
    for (const d of house.devices) if (d.deviceId) descriptors[d.deviceId] = { id: d.deviceId, pluginId: 'mock', externalId: d.deviceId, kind: 'light', name: d.deviceId, capabilities: ['on_off'], meta: {} } as DeviceDescriptor
    scene.setDescriptors(descriptors)
    scene.load(house)
    const lights = () => { let n = 0; scene.scene.traverseVisible((o) => { if ((o as { isPointLight?: boolean }).isPointLight) n++ }); return n }
    const all = lights()
    expect(all).toBeGreaterThan(0)
    const lowest = [...house.levels].sort((a, b) => a.elevation - b.elevation)[0]!
    scene.focusLevel(lowest.id)
    expect((scene as unknown as { lampPadding: { children: unknown[] } }).lampPadding.children.length).toBeGreaterThan(0)   // the hidden upper floor had lamps
    expect(lights()).toBe(all)
    scene.focusLevel(null)
    expect(lights()).toBe(all)
    scene.dispose()
  })
})

describe('preparing the house before showing it', () => {
  /**
   * The loading veil follows these stages and only leaves at the final `null`: a preparation that
   * did not finish would leave the house hidden. Without a renderer (tests), it stops after the materials.
   */
  it('publishes its stages and always ends with "ready"', async () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    const seen: (string | null)[] = []
    scene.on('prepare', (stage) => seen.push(stage))
    scene.load(parseHouse(demo))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seen[0]).toBe('materials')
    expect(seen.at(-1)).toBeNull()
    expect(scene.preparingHouse).toBe(false)
    scene.dispose()
  })

  /**
   * A style never seen (or left: three discards the programs nothing uses anymore) requires
   * new shaders. Compiled by the first frame, they froze the WHOLE main thread — 2.5 to
   * 5.5 s on the iGPU for "realistic", style selection included, which only painted afterward.
   */
  it('a style change compiles its shaders without drawing, then redraws', async () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true, requestFrame: () => 0, cancelFrame: () => {} })
    scene.load(parseHouse(demo))
    let ready = false
    let compiled = 0
    ;(scene as unknown as { renderer: object }).renderer = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      compile: () => { compiled++ },
      properties: { get: () => ({ currentProgram: { isReady: () => ready } }) },
    }
    ;(scene as unknown as { applySky(): void }).applySky = () => {}   // the sky wants a real renderer (PMREM)
    const holding = () => (scene as unknown as { compiling: boolean }).compiling
    scene.setAppearance({ style: styleById('realistic') })
    expect(compiled).toBe(1)
    expect(holding()).toBe(true)                       // the old frame stays, the main thread is free
    ready = true
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(holding()).toBe(false)
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })
})

describe('adjusting the openings', () => {
  const house = parseHouse(demo)
  const openingCount = computeHouseGeometry(house).levels.reduce((n, l) => n + l.openings.length, 0)
  const handles = (scene: HouseScene) => {
    let n = 0
    scene.scene.traverse((o) => { if (o.name.startsWith('opening:')) n++ })
    return n
  }

  /**
   * The handles live and die with the mode: outside edit mode, the scene must be exactly the one
   * from before, down to the triangle.
   */
  it('lays one handle per opening and leaves nothing behind on exit', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    const before = countTriangles(scene.scene)
    expect(handles(scene)).toBe(0)
    scene.setEditingOpenings(true)
    expect(handles(scene)).toBe(openingCount)
    expect(openingCount).toBeGreaterThan(0)
    expect(countTriangles(scene.scene)).toBeGreaterThan(before)
    scene.setEditingOpenings(false)
    expect(handles(scene)).toBe(0)
    expect(countTriangles(scene.scene)).toBe(before)
    scene.dispose()
  })

  /**
   * Handles, dimensions and origin marker are LEVEL decorations: `DECOR_LAYER` (outside the occlusion capture,
   * open to the raycaster), in the level's MARKERS group (hidden with it).
   */
  it('stores handles and dimensions in their level\'s decorations', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setEditingOpenings(true)
    scene.setSelectedOpening('fen-ch1')
    const decors: { name: string; inMarkers: boolean; layer: boolean }[] = []
    scene.scene.traverse((o) => {
      if (!o.name.startsWith('opening:') && o.name !== 'opening-cotes' && o.name !== 'origin-mark') return
      let inMarkers = false
      for (let n: Object3D | null = o.parent; n; n = n.parent) if (n.name === 'markers') { inMarkers = true; break }
      const mesh = o.children.find((c) => c instanceof Mesh)!
      decors.push({ name: o.name, inMarkers, layer: mesh.layers.mask === 1 << DECOR_LAYER })
    })
    expect(decors).toHaveLength(openingCount + 2)          // the handles, the outline, the origin marker
    expect(decors.filter((d) => !d.inMarkers)).toEqual([])
    expect(decors.filter((d) => !d.layer)).toEqual([])
    scene.dispose()
  })

  /**
   * PITFALL TO REMEMBER. The `Scene` runs with `matrixWorldAutoUpdate = false` (a single update
   * per frame, `render()`). A new object therefore keeps a world matrix at IDENTITY until the
   * next frame: the raycaster tests it at the world origin, and a tap on a handle
   * went through to the room's floor. Eleven handles out of eleven were stale, up to twelve
   * meters off. What must be touchable must enter the world with its matrix.
   */
  it('enters the world with a correct matrix, without waiting for a frame', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setEditingOpenings(true)
    const groups: Object3D[] = []
    scene.scene.traverse((o) => { if (o.name.startsWith('opening:')) groups.push(o) })
    expect(groups).toHaveLength(openingCount)
    const posOf = (o: Object3D) => new Vector3().setFromMatrixPosition(o.matrixWorld)
    const asBuilt = groups.map((g) => [posOf(g), ...g.children.map(posOf)])
    scene.scene.updateMatrixWorld(true)          // what the first frame would have done
    groups.forEach((g, i) => {
      const after = [posOf(g), ...g.children.map(posOf)]
      after.forEach((p, k) => expect(p.distanceTo(asBuilt[i]![k]!)).toBeLessThan(1e-9))
      expect(after[0]!.length()).toBeGreaterThan(0.2)   // and it is not the world origin
    })
    scene.dispose()
  })

  /** The end of the road: a tap on a handle is seen as such, and not as a tap on the floor. */
  it('can be picked where it is drawn', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.resize(1200, 800)
    scene.setEditingOpenings(true)
    let handle: Object3D | null = null
    scene.scene.traverse((o) => { if (!handle && o.name === 'opening:baie') handle = o })
    const target = new Vector3().setFromMatrixPosition(handle!.matrixWorld)
    // `focusOpening` sets the camera, but in headless there is no `OrbitControls` to ORIENT it
    // (it is `controls.update()` that does it): we make it look at the handle ourselves, and the
    // center of the image is then exactly on it.
    scene.focusOpening('baie', false)
    scene.camera.lookAt(target)
    scene.camera.updateMatrixWorld(true)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'opening', openingId: 'baie' })
    scene.dispose()
  })

  /**
   * Three states to tell apart: nothing, an opening, the one being adjusted. ALL carry a thin frame —
   * without it, the other openings became impossible to find (user feedback) —, and only one
   * carries the THICK frame. What turns off is a MATERIAL, never the object: `Object3D.visible` says
   * "my level is hidden", and it is what decides whether a handle is touchable.
   */
  it('rings every opening with a thin line, only one with a thick line, and keeps both touchable', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.resize(1200, 800)
    scene.setEditingOpenings(true)
    /** For each handle: [thin frame drawn?, thick frame drawn?]. */
    const rings = () => {
      const drawn: [boolean, boolean][] = []
      scene.scene.traverse((o) => {
        if (!o.name.startsWith('opening:')) return
        const [, thin, bold] = o.children as Mesh[]
        drawn.push([(thin!.material as MeshBasicMaterial).visible, (bold!.material as MeshBasicMaterial).visible])
      })
      return drawn
    }
    expect(rings().filter(([thin]) => thin)).toHaveLength(openingCount)   // all ringed, thinly
    expect(rings().filter(([, bold]) => bold)).toHaveLength(0)            // none is "this one"
    scene.setSelectedOpening('fen-ch1')
    expect(rings().filter(([, bold]) => bold)).toHaveLength(1)
    expect(rings().filter(([thin]) => thin)).toHaveLength(openingCount - 1)
    // the thick frame is the ONLY one to go through walls; the thin one stays subject to depth, otherwise
    // nineteen frames show through the roof
    const matOf = (id: string, child: number) => {
      let found: MeshBasicMaterial | null = null
      scene.scene.traverse((o) => { if (o.name === `opening:${id}`) found = (o.children[child] as Mesh).material as MeshBasicMaterial })
      return found!
    }
    expect(matOf('baie', 1).depthTest).toBe(true)          // the thin frame of a handle at rest
    expect(matOf('fen-ch1', 2).depthTest).toBe(false)      // the thick frame of the selected one
    // the NON-selected handle is still visible as an object (hence still pickable)
    let other: Object3D | null = null
    scene.scene.traverse((o) => { if (!other && o.name === 'opening:baie') other = o })
    expect((other! as Object3D).visible).toBe(true)
    const target = new Vector3().setFromMatrixPosition((other! as Object3D).matrixWorld)
    scene.focusOpening('baie', false)
    scene.camera.lookAt(target)
    scene.camera.updateMatrixWorld(true)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'opening', openingId: 'baie' })
    scene.dispose()
  })

  /**
   * The origin marker: the file's (0, 0, 0), its two axes and true north. It is born and dies
   * with edit mode, and it is placed at the origin of the REFERENCE FRAME — not at the center of the building.
   */
  it('places a marker at the file\'s origin, in edit mode only', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    const mark = () => {
      let found: Object3D | null = null
      scene.scene.traverse((o) => { if (!found && o.name === 'origin-mark') found = o })
      return found as Object3D | null
    }
    expect(mark()).toBeNull()
    scene.setEditingOpenings(true)
    const group = mark()!
    expect(group).not.toBeNull()
    expect(new Vector3().setFromMatrixPosition(group.matrixWorld).length()).toBeCloseTo(0, 6)
    // two axes and north: three arms, plus the ring
    const bars = group.children.filter((o) => o instanceof Mesh)
    expect(bars).toHaveLength(4)
    // north follows the heading of +y: at heading 0, it coincides with the y axis
    const letters: string[] = []
    group.traverse((o) => { const el = (o as unknown as { element?: HTMLElement }).element; if (el) letters.push(el.textContent ?? '') })
    expect(letters.sort()).toEqual(['N', 'x', 'y'])
    scene.setEditingOpenings(false)
    expect(mark()).toBeNull()
    scene.dispose()
  })

  /**
   * The real-time path: `rooms` carries `openings[]`, so adjusting a window went through a
   * full `load()` — the whole house rebuilt AND the camera recentered, at every finger
   * movement. Here: the meshes of the touched level only, and only the markers that fit an
   * opening that moved (a shutter cuts its slat to its window's rectangle).
   */
  it('only redoes the touched level: camera, markers and handles survive', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setEditingOpenings(true)
    const room = house.rooms.find((r) => r.openings.length > 0)!
    const opening = room.openings[0]!
    const other = house.levels.find((l) => l.id !== room.levelId && scene.nodesOf(l.id))!
    const bound = house.devices.find((d) => d.openingId === opening.id)
    const was = {
      camera: scene.camera.position.toArray(),
      touched: scene.nodesOf(room.levelId)!.group.uuid,
      untouched: scene.nodesOf(other.id)!.group.uuid,
      markers: new Map([...scene.markers].map(([k, m]) => [k, m.object.uuid])),
    }
    scene.updateOpenings({
      ...house,
      rooms: house.rooms.map((r) => (r.id === room.id
        ? { ...r, openings: r.openings.map((o) => (o.id === opening.id ? { ...o, offset: (o.offset ?? 0) + 0.3 } : o)) }
        : r)),
    })
    expect(scene.camera.position.toArray()).toEqual(was.camera)
    expect(scene.nodesOf(room.levelId)!.group.uuid).not.toBe(was.touched)
    expect(scene.nodesOf(other.id)!.group.uuid).toBe(was.untouched)
    expect(handles(scene)).toBe(openingCount)
    // only the cover of THIS opening is redone; the other markers are the same objects
    const rebuilt = [...scene.markers].filter(([k, m]) => was.markers.get(k) !== m.object.uuid).map(([k]) => k)
    expect(rebuilt).toEqual(bound ? [bound.id] : [])
    expect(scene.markers.size).toBe(was.markers.size)
    scene.dispose()
  })
})

describe('glazed and floor-standing opening kinds', () => {
  /** The demo house, whose large living room window becomes a BAY WINDOW and the terrace door a GLAZED DOOR. */
  const retyped = () => {
    const raw = JSON.parse(JSON.stringify(demo)) as typeof demo & { rooms: { id: string; openings: { id: string; type: string }[] }[] }
    for (const room of raw.rooms) {
      for (const o of room.openings ?? []) {
        if (o.id === 'baie') o.type = 'bay'
        if (o.id === 'porte-terrasse') o.type = 'glass-door'
      }
    }
    return parseHouse(raw)
  }
  const mats = () => createMaterials(defaultSceneTheme(), defaultLook())
  const rdcOf = (house: ReturnType<typeof parseHouse>) => computeHouseGeometry(house).levels.find((l) => l.levelId === 'rdc')!

  it('glazes a bay window and a glazed door, never a solid door nor a passage', () => {
    const before = buildLevel(rdcOf(parseHouse(demo)), mats())
    const after = buildLevel(rdcOf(retyped()), mats())
    const glazed = (nodes: typeof after) => new Set(nodes.panes.map((p) => p.userData.openingId as string))
    // the bay window was already a window: it keeps its glazing; the terrace door gains one
    expect(glazed(before).has('baie')).toBe(true)
    expect(glazed(before).has('porte-terrasse')).toBe(false)
    expect(glazed(after).has('baie')).toBe(true)
    expect(glazed(after).has('porte-terrasse')).toBe(true)
    // solid doors and passages still have nothing glazed
    expect(glazed(after).has('porte-entree')).toBe(false)
    expect(glazed(after).has('porte-salon')).toBe(false)
  })

  /**
   * A GLAZED door has no solid leaf: that would hide what defines it. Its leaf is
   * a frame around the glass, so it weighs on the joinery mesh, not on the doors mesh.
   */
  it('replaces the solid leaf of a glazed door with a leaf frame', () => {
    const mesh = (nodes: ReturnType<typeof buildLevel>, name: string) => nodes.walls.find((m) => m.name === name)
    const before = buildLevel(rdcOf(parseHouse(demo)), mats())
    const after = buildLevel(rdcOf(retyped()), mats())
    const doorsBefore = countTriangles(mesh(before, 'details:doors')!)
    const doorsAfter = countTriangles(mesh(after, 'details:doors')!)
    expect(doorsAfter).toBeLessThan(doorsBefore)          // one curtain fewer
    expect(countTriangles(mesh(after, 'details:frames')!)).toBeGreaterThan(countTriangles(mesh(before, 'details:frames')!))
  })

  /**
   * A bay window goes down to the floor: no window sill projecting from the facade (it would hang in
   * the void), but a bottom rail and a mullion per leaf — three meters of glass in one piece
   * look like nothing.
   */
  it('removes a bay window\'s sill and gives it its mullions', () => {
    const only = (house: ReturnType<typeof parseHouse>, id: string) => {
      const level = rdcOf(house)
      return buildLevel({ ...level, openings: level.openings.filter((o) => o.openingId === id), walls: [] }, mats())
    }
    const asWindow = only(parseHouse(demo), 'baie')
    const asBay = only(retyped(), 'baie')
    // without walls, only the sill remains in the rails: a bay window has none
    expect(asWindow.walls.some((m) => m.name === 'details:trim')).toBe(true)
    expect(asBay.walls.some((m) => m.name === 'details:trim')).toBe(false)
    // and it carries one more jamb than the window it replaces (2.4 m → two leaves)
    const frames = (n: typeof asBay) => countTriangles(n.walls.find((m) => m.name === 'details:frames')!)
    expect(frames(asBay)).toBeGreaterThan(frames(asWindow))
  })
})

describe('dimensions and name of the adjusted opening', () => {
  const notes = (scene: HouseScene) => {
    const found: { kind: string; text: string; position: [number, number, number] }[] = []
    scene.scene.traverse((o) => {
      const el = (o as unknown as { element?: HTMLElement }).element
      // the axis letters of the origin marker carry the same base class: here we only want
      // what annotates the adjusted opening
      if (el?.classList.contains('scene-note--name') || el?.classList.contains('scene-note--gap')) {
        found.push({ kind: el.className.includes('--name') ? 'name' : 'gap', text: el.textContent ?? '', position: o.position.toArray() as [number, number, number] })
      }
    })
    return found
  }

  /**
   * The two dimensions are the panel's, to the centimeter: same shared functions
   * (`openingGaps`, `openingLabel`), same format. A named window announces itself by its name, a
   * window without a name by its survey identifier.
   */
  it('annotates the name and the two distances to the ends of the wall, and annotates only the selection', () => {
    const raw = JSON.parse(JSON.stringify(demo)) as typeof demo & { rooms: { id: string; openings: { id: string; name?: string }[] }[] }
    for (const room of raw.rooms) for (const o of room.openings ?? []) if (o.id === 'fen-ch1') o.name = 'Fenêtre de Paul'
    const house = parseHouse(raw)
    const room = house.rooms.find((r) => r.id === 'chambre1')!
    const opening = room.openings.find((o) => o.id === 'fen-ch1')!
    const gaps = openingGaps(room, opening)
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    expect(notes(scene)).toHaveLength(0)              // outside edit mode, no label
    scene.setEditingOpenings(true)
    expect(notes(scene)).toHaveLength(0)              // in edit mode but without a selection, none either
    scene.setSelectedOpening('fen-ch1')
    const shown = notes(scene)
    expect(shown.filter((n) => n.kind === 'name').map((n) => n.text)).toEqual(['Fenêtre de Paul'])
    expect(shown.filter((n) => n.kind === 'gap').map((n) => n.text).sort())
      .toEqual([`${gaps.left.toFixed(2)} m`, `${gaps.right.toFixed(2)} m`].sort())
    // the name floats above the lintel, the dimensions at mid height and on either side
    const name = shown.find((n) => n.kind === 'name')!
    expect(name.position[2]).toBeGreaterThan(opening.height)
    // the dimensions are at the opening's mid height, a little above their line, and below its name
    const mid = opening.height / 2 + (opening.sill ?? 0.95)
    for (const gap of shown.filter((n) => n.kind === 'gap')) {
      expect(gap.position[2]).toBeGreaterThan(mid)
      expect(gap.position[2]).toBeLessThan(name.position[2])
    }
    scene.setSelectedOpening(null)
    expect(notes(scene)).toHaveLength(0)
    scene.dispose()
  })

  /**
   * A dimension line is only worth anything if its line materializes EXACTLY the announced interval: from the edge
   * of the opening to the corner of the wall. The line is a stretched unit box (`scale.x`), closed by two
   * ticks placed at its two ends, in the opening's frame — so x is the distance along the
   * wall from its left edge.
   */
  it('draws the two dimensions over exactly the interval they announce, ticks at both ends', () => {
    const house = parseHouse(demo)
    const room = house.rooms.find((r) => r.id === 'chambre1')!
    const opening = room.openings.find((o) => o.id === 'fen-ch1')!
    const gaps = openingGaps(room, opening)
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setEditingOpenings(true)
    scene.setSelectedOpening('fen-ch1')
    let cotes: Object3D | null = null
    scene.scene.traverse((o) => { if (!cotes && o.name === 'opening-cotes') cotes = o })
    const meshes = (cotes! as Object3D).children as Mesh[]
    expect(meshes).toHaveLength(6)                 // two dimensions: one line and two ticks each
    const [line, a, b, line2, a2, b2] = meshes
    // right side (seen from the room): from -right to 0; left side: from width to width + left
    expect(line!.scale.x).toBeCloseTo(gaps.right, 6)
    expect(a!.position.x).toBeCloseTo(-gaps.right, 6)
    expect(b!.position.x).toBeCloseTo(0, 6)
    expect(line2!.scale.x).toBeCloseTo(gaps.left, 6)
    expect(a2!.position.x).toBeCloseTo(opening.width, 6)
    expect(b2!.position.x).toBeCloseTo(opening.width + gaps.left, 6)
    // the line is in the middle of its interval, and the number ABOVE it (never on it)
    expect(line!.position.x).toBeCloseTo(-gaps.right / 2, 6)
    const gapNote = notes(scene).find((n) => n.kind === 'gap')!
    expect(gapNote.position[2]).toBeGreaterThan(line!.position.z)
    scene.dispose()
  })

  /** A ZERO dimension has no interval: the line fades out, the two ticks merge. */
  it('erases the line of a zero dimension and keeps its ticks', () => {
    const house = parseHouse(demo)
    const room = house.rooms.find((r) => r.id === 'chambre1')!
    const flush = {
      ...house,
      rooms: house.rooms.map((r) => (r.id === room.id
        ? { ...r, openings: r.openings.map((o) => (o.id === 'fen-ch1' ? { ...o, offset: 0 } : o)) }
        : r)),
    }
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(flush)
    scene.setEditingOpenings(true)
    scene.setSelectedOpening('fen-ch1')
    let cotes: Object3D | null = null
    scene.scene.traverse((o) => { if (!cotes && o.name === 'opening-cotes') cotes = o })
    const [line, a, b] = (cotes! as Object3D).children as Mesh[]
    expect(line!.visible).toBe(false)
    expect(a!.visible).toBe(true)
    expect(a!.position.x).toBeCloseTo(0, 6)
    expect(b!.position.x).toBeCloseTo(0, 6)
    scene.dispose()
  })

  it('follows the draft: the dimension changes with the sliding opening, and the other one with it', () => {
    const house = parseHouse(demo)
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setEditingOpenings(true)
    scene.setSelectedOpening('fen-ch1')
    const read = () => notes(scene).filter((n) => n.kind === 'gap').map((n) => n.text)
    const was = read()
    scene.updateOpenings({
      ...house,
      rooms: house.rooms.map((r) => (r.id === 'chambre1'
        ? { ...r, openings: r.openings.map((o) => (o.id === 'fen-ch1' ? { ...o, offset: (o.offset ?? 0) + 0.4 } : o)) }
        : r)),
    })
    const now = read()
    expect(now).not.toEqual(was)
    // and the OUTLINE follows: it lives in the level's markers, which survive its rebuild —
    // placed in the level's group, it ended up orphaned at the first finger movement
    let cotes: Object3D | null = null
    scene.scene.traverse((o) => { if (!cotes && o.name === 'opening-cotes') cotes = o })
    expect(cotes).not.toBeNull()
    expect((cotes! as Object3D).parent!.name).toBe('markers')
    expect(((cotes! as Object3D).children[0] as Mesh).scale.x).toBeCloseTo(parseFloat(now[0]!), 2)
    // what one gains, the other loses: the wall length does not change
    const sum = (xs: string[]) => xs.reduce((n, t) => n + parseFloat(t), 0)
    expect(sum(now)).toBeCloseTo(sum(was), 2)
    scene.dispose()
  })
})

describe('time of day at the house', () => {
  // The sun is computed, not guessed: the house is georeferenced and the clock does the
  // rest. Reference taken at Dijon (the demo house), at the summer solstice — the sun culminates there around
  // 66° (90 − 47.3 + 23.4) and passes due south shortly before noon UTC.
  const DIJON = { lat: 47.32, lon: 5.04 }

  it('places the sun above the house, at the right hour and the right azimuth', () => {
    const noon = sunPosition(new Date('2026-06-21T12:00:00Z'), DIJON.lat, DIJON.lon)
    expect(noon.altitudeDeg).toBeGreaterThan(60)
    expect(noon.altitudeDeg).toBeLessThan(68)
    expect(noon.azimuthDeg).toBeGreaterThan(170)          // due south, barely past
    expect(noon.azimuthDeg).toBeLessThan(210)
    const midnight = sunPosition(new Date('2026-12-21T00:00:00Z'), DIJON.lat, DIJON.lon)
    expect(midnight.altitudeDeg).toBeLessThan(-40)        // below the horizon, and well below
    // in the morning, the sun is in the EAST: it is the sign of the hour angle that decides it
    const morning = sunPosition(new Date('2026-06-21T05:00:00Z'), DIJON.lat, DIJON.lon)
    expect(morning.azimuthDeg).toBeGreaterThan(50)
    expect(morning.azimuthDeg).toBeLessThan(110)
  })

  it('goes from night to day WITHOUT a staircase step', () => {
    expect(dayFactor({ sunAltitudeDeg: -20, sunAzimuthDeg: 0, cloudiness: 0 })).toBe(0)
    expect(dayFactor({ sunAltitudeDeg: 20, sunAzimuthDeg: 0, cloudiness: 0 })).toBe(1)
    const dusk = dayFactor({ sunAltitudeDeg: 1, sunAzimuthDeg: 0, cloudiness: 0 })
    expect(dusk).toBeGreaterThan(0.1)
    expect(dusk).toBeLessThan(0.9)
  })

  it('NEVER renders a NaN ambience: an unknown mode falls back on the real sun', () => {
    // Happened: a hand-written setting gave a NaN exposure, and the whole image went black
    // without the slightest error in the console.
    const a = resolveAmbience({ mode: '"night"' as AmbienceMode, date: new Date('2026-06-21T12:00:00Z'), geo: DIJON })
    expect(Number.isFinite(a.sunAltitudeDeg)).toBe(true)
    expect(Number.isFinite(dayFactor(a))).toBe(true)
  })

  it('raises the source below the horizon without changing where it comes from', () => {
    const night = resolveAmbience({ mode: 'night' })
    expect(night.sunAltitudeDeg).toBeLessThan(0)
    const dir = sunDirection(night)
    expect(dir.y).toBeGreaterThan(0.2)                    // a buried light lights nothing
    // azimuth 215° (south-west): negative x (west), positive z (south, since the house's north is at −z)
    expect(dir.x).toBeLessThan(0)
    expect(dir.z).toBeGreaterThan(0)
  })

  it('subtracts the house heading: the top of the plan is not necessarily north', () => {
    const noon = { ...resolveAmbience({ mode: 'day' }), sunAltitudeDeg: 30, sunAzimuthDeg: 90 }   // sun in the EAST
    // house rotated by 90°: its +y faces east, so the sun is on the plan's +y, the world's −z
    const dir = sunDirection(noon, undefined, 90)
    expect(dir.x).toBeCloseTo(0)
    expect(dir.z).toBeLessThan(-0.5)
  })
})

describe('render styles', () => {
  const HOURS: AmbienceMode[] = ['day', 'dusk', 'night']
  const house = computeHouseGeometry(parseHouse(demo))

  it('every style renders finite values at any hour, and only cites materials from the catalog', () => {
    for (const style of RENDER_STYLES) {
      for (const mode of HOURS) {
        const look = style.look(resolveAmbience({ mode }))
        expect(Number.isFinite(look.post.exposure)).toBe(true)
        expect(look.post.exposure).toBeGreaterThan(0)
        expect(Number.isFinite(look.lighting.sunIntensity)).toBe(true)
        for (const v of [...look.sky.zenith, ...look.sky.horizon, ...look.sky.ground]) expect(Number.isFinite(v)).toBe(true)
        // the catalog is the only source of materials: an unknown role is not baked
        for (const role of rolesOf(look.surfaces)) expect(typeof role).toBe('string')
      }
    }
  })

  it('changing style hands other materials to the SAME materials objects (no geometry touched)', () => {
    const theme = defaultSceneTheme()
    const mats = createMaterials(theme, defaultLook())
    const nodes = buildHouse(house, mats)
    const wallMesh = nodes.levels.get('rdc')!.walls[0]!
    const before = { material: wallMesh.material, map: mats.wall.map }
    applyLook(mats, theme, styleById('cyberpunk').look(resolveAmbience({ mode: 'night' })))
    expect(wallMesh.material).toBe(before.material)       // the mesh still points to the same material
    expect(mats.wall.map).not.toBe(before.map)            // but the texture, for its part, has changed
    expect(mats.wall.metalness).toBeGreaterThan(0.5)      // cyberpunk has metal walls
  })
})

describe('render quality', () => {
  /**
   * An integrated GPU is no longer downgraded based on its name: the Radeon of a hybrid laptop sustains
   * "high" at 26-46 ms per frame with the real house (measured on 2026-09-27), and it is the safeguard
   * that judges. Only a software renderer starts out in "low".
   */
  it('a software renderer starts in low, any real GPU, integrated included, starts in high', () => {
    expect(detectQuality('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('low')
    expect(detectQuality('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('')).toBe('high')
  })

  it('no 3D at 2 GB or less announced, and the 3D stays when the browser does not say', () => {
    const nav = globalThis.navigator as Navigator & { deviceMemory?: number }
    const before = Object.getOwnPropertyDescriptor(nav, 'deviceMemory')
    const announce = (v: number | undefined) => Object.defineProperty(nav, 'deviceMemory', { value: v, configurable: true })
    try {
      announce(2); expect(lacksResources()).toBe(true)
      announce(0.5); expect(lacksResources()).toBe(true)
      announce(4); expect(lacksResources()).toBe(false)
      announce(undefined); expect(lacksResources()).toBe(false)
    } finally {
      if (before) Object.defineProperty(nav, 'deviceMemory', before)
      else delete nav.deviceMemory
    }
  })

  it('the safeguard ignores warm-up and isolated spikes, then steps down only once, on the median', () => {
    let over = 0
    const guard = createCostGuard(() => over++, 40, 8, 2)
    // two outrageously expensive warm-up frames: ignored
    guard.sample(500); guard.sample(500)
    // six observed frames, median 50 ms > 40: a single step down, then nothing more
    for (const ms of [30, 50, 50, 50, 50, 60]) guard.sample(ms)
    expect(over).toBe(1)
    for (let i = 0; i < 20; i++) guard.sample(500)
    expect(over).toBe(1)

    // two spikes (an uploaded texture, an environment map) on frames at 30 ms:
    // the average would say 87 ms, the median says 30 — the machine keeps up.
    let spiky = 0
    const calm = createCostGuard(() => spiky++, 40, 8, 2)
    for (const ms of [30, 30, 30, 30, 30, 30, 200, 200]) calm.sample(ms)
    expect(spiky).toBe(0)
  })
})

describe('architectural detail', () => {
  const house = computeHouseGeometry(parseHouse(demo))
  const rdc = house.levels.find((l) => l.levelId === 'rdc')!
  const mats = createMaterials(defaultSceneTheme(), defaultLook())
  const meshes = buildDetails(rdc, mats)
  const byName = (n: string) => meshes.find((m) => m.name === n)!

  it('makes at most four merged meshes: rails, surrounds, plinth, leaves', () => {
    expect(meshes.map((m) => m.name).sort()).toEqual(['details:doors', 'details:frames', 'details:plinth', 'details:trim'])
    expect(byName('details:trim').material).toBe(mats.trim)
    expect(byName('details:frames').material).toBe(mats.frame)
    expect(byName('details:plinth').material).toBe(mats.plinth)
    expect(byName('details:doors').material).toBe(mats.door)
    for (const m of meshes) expect(countTriangles(m)).toBeGreaterThan(0)
  })

  /**
   * An opening DRESSED by a cover: its leaf belongs to the device, which draws it and
   * opens it. The structure does not lay a second one — otherwise a raised garage door leaves the
   * fixed panel behind it, and the opening is never empty.
   */
  it("leaves its leaf to the cover that dresses the opening, and keeps the rest of the structure", () => {
    const dressed = buildDetails(rdc, mats, new Set(['porte-entree']))
    const doorsOf = (list: Mesh[]) => list.find((m) => m.name === 'details:doors')
    expect(countTriangles(doorsOf(dressed)!)).toBeLessThan(countTriangles(byName('details:doors')))
    // the fixed frame, the rails and the plinth stay on the wall: a shutter does not remove the frame
    for (const name of ['details:frames', 'details:trim', 'details:plinth']) {
      expect(countTriangles(dressed.find((m) => m.name === name)!)).toBe(countTriangles(byName(name)))
    }
    // all doors dressed: not a single leaf left to draw
    const all = new Set(rdc.openings.map((o) => o.openingId))
    expect(buildDetails(rdc, mats, all).map((m) => m.name)).not.toContain('details:doors')
  })

  it('the coping sticks out above the top of the walls by five millimeters, never more', () => {
    const g = byName('details:trim').geometry
    g.computeBoundingBox()
    const top = Math.max(...rdc.walls.map((w) => w.z1))
    expect(g.boundingBox!.max.z).toBeCloseTo(top + 0.005, 3)
  })

  it('the plinth stays flush with the finished floor and stops at baseboard height', () => {
    const g = byName('details:plinth').geometry
    g.computeBoundingBox()
    expect(g.boundingBox!.min.z).toBeCloseTo(0.002, 3)
    expect(g.boundingBox!.max.z).toBeCloseTo(0.28, 3)
  })

  it('frames within the wall thickness, sills on the FACADE side: nothing sticks out into the room', () => {
    // a level reduced to the single opening: each vertex is projected onto ITS outward normal
    const baie = rdc.openings.find((o) => o.openingId === 'baie')!
    const only = buildDetails({ ...rdc, walls: [], openings: [baie] }, mats)
    const along = (mesh: Mesh) => {
      const pos = mesh.geometry.getAttribute('position')
      return Array.from({ length: pos.count }, (_, i) =>
        (pos.getX(i) - baie.origin[0]) * baie.normal[0] + (pos.getY(i) - baie.origin[1]) * baie.normal[1])
    }
    const s = along(only.find((m) => m.name === 'details:trim')!)      // the sill alone, no wall hence no coping
    const f = along(only.find((m) => m.name === 'details:frames')!)
    expect(Math.min(...s)).toBeGreaterThan(baie.depth / 2)          // the sill is on the outer side…
    expect(Math.max(...s)).toBeGreaterThan(baie.depth)              // …and projects from the facade
    expect(Math.min(...f)).toBeGreaterThanOrEqual(-1e-6)            // the frame does not stick out on the room side
    expect(Math.max(...f)).toBeLessThanOrEqual(baie.depth + 1e-6)   // nor on the facade side
  })

  it('a passage has neither frame nor leaf', () => {
    const level = { ...rdc, walls: [], openings: rdc.openings.map((o) => ({ ...o, type: 'passage' as const })) }
    expect(buildDetails(level, mats)).toEqual([])
  })

  /** The same level, reduced to ONE opening on which we impose what we want to test. */
  const only = (o: Partial<OpeningRect>) => {
    const porte = rdc.openings.find((x) => x.type === 'door')!
    return buildDetails({ ...rdc, walls: [], openings: [{ ...porte, ...o }] }, mats)
  }

  it('two leaves split the panel of a solid door, and add mullions to a bay window', () => {
    const one = only({ leaves: 1 })
    const two = only({ leaves: 2 })
    // one more panel, hence one more box: the vertical line that makes a double door
    expect(countTriangles(two.find((m) => m.name === 'details:doors')!))
      .toBe(2 * countTriangles(one.find((m) => m.name === 'details:doors')!))
    // glazed, these are no longer panels but mullions, counted among the surrounds
    const bay1 = only({ type: 'bay', leaves: 1 }), bay3 = only({ type: 'bay', leaves: 3 })
    expect(countTriangles(bay3.find((m) => m.name === 'details:frames')!))
      .toBeGreaterThan(countTriangles(bay1.find((m) => m.name === 'details:frames')!))
  })

  it('the glass material glazes the opening: a solid door loses its opaque panel', () => {
    expect(only({}).some((m) => m.name.startsWith('details:doors'))).toBe(true)
    const glazed = only({ material: 'glass' })
    expect(isGlazed({ ...rdc.openings[0]!, type: 'door', material: 'glass' })).toBe(true)
    // the solid leaf gave way to a leaf frame, stored with the surrounds
    expect(glazed.some((m) => m.name.startsWith('details:doors'))).toBe(false)
    expect(glazed.some((m) => m.name.startsWith('details:frames'))).toBe(true)
  })

  it('a tinted joinery gets its own mesh; without a setting, nothing is duplicated', () => {
    expect(meshes.filter((m) => m.name.startsWith('details:frames'))).toHaveLength(1)
    const tinted = only({ color: '#c0c4c8' })
    const frame = tinted.find((m) => m.name.startsWith('details:frames'))!
    expect(frame.name).toBe('details:frames#|#c0c4c8')
    expect(frame.material).not.toBe(mats.frame)
    expect((frame.material as MeshStandardMaterial).color.getHexString()).toBe('c0c4c8')
    // two openings of the SAME tint share their material: one tint, one draw call
    expect(only({ color: '#c0c4c8' }).find((m) => m.name.startsWith('details:frames'))!.material).toBe(frame.material)
  })

  it('metal joinery reflects, wood does not, fabric even less', () => {
    const metal = only({ material: 'metal' }).find((m) => m.name.startsWith('details:frames'))!.material as MeshStandardMaterial
    const wood = only({ material: 'wood' }).find((m) => m.name.startsWith('details:frames'))!.material as MeshStandardMaterial
    expect(metal.metalness).toBeGreaterThan(0.5)
    expect(wood.metalness).toBe(0)
    expect(wood.color.getHexString()).toBe(mats.floors.wood.color.getHexString())
    // a CANVAS: no reflection, and more matte than wood — that is what tells it apart to the eye
    const fabric = only({ material: 'fabric' }).find((m) => m.name.startsWith('details:frames'))!.material as MeshStandardMaterial
    expect(fabric.metalness).toBe(0)
    expect(fabric.roughness).toBeGreaterThan(wood.roughness)
    expect(fabric.transparent).toBe(false)              // fabric does nothing to the geometry, for its part
  })

  it('the detail colors are derived from the palette: lighter rail, darker joinery and plinth', () => {
    const wall = mats.wall.color.getHSL({ h: 0, s: 0, l: 0 }).l
    expect(mats.trim.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(wall)
    expect(mats.frame.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(wall)
    expect(mats.plinth.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(wall)
  })
})

describe('roof and pool', () => {
  const geometry = computeHouseGeometry(parseHouse(demo))
  const mats = createMaterials(defaultSceneTheme(), defaultLook())

  it('a gable roof receives fascia boards under its eaves and its gables, never at the ridge', () => {
    const [fascia] = buildRoofDetails(geometry.roof!, mats)
    expect(fascia!.name).toBe('roof:fascia')
    expect(fascia!.material).toBe(mats.frame)
    fascia!.geometry.computeBoundingBox()
    expect(fascia!.geometry.boundingBox!.max.z).toBeLessThanOrEqual(geometry.roof!.zRidge + 1e-6) // the verges rise to the ridge, nothing above
    expect(fascia!.geometry.boundingBox!.min.z).toBeCloseTo(geometry.roof!.zBase - 0.18, 3)  // hanging below the eaves
  })

  it('a flat roof receives a parapet in the walls\' material, coped, and a slab that is not tiled', () => {
    const flat = { ...geometry.roof!, type: 'flat' as const, zRidge: geometry.roof!.zBase + 0.2, faces: [] }
    const meshes = buildRoofDetails(flat, mats)
    expect(meshes.map((m) => m.name)).toEqual(['roof:parapet', 'roof:parapet-cap'])
    expect(meshes[0]!.material).toBe(mats.wall)
    meshes[1]!.geometry.computeBoundingBox()
    expect(meshes[1]!.geometry.boundingBox!.max.z).toBeCloseTo(flat.zRidge + 0.35 + 0.005, 3)
    const nodes = buildHouse({ ...geometry, roof: flat }, mats)
    expect(nodes.roof!.material).toBe(mats.roofFlat)
    expect(mats.roofFlat.map).not.toBe(mats.roof.map)
  })

  it('nature\'s green slab does not survive the return to realistic', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    const flatMat = () => (scene as unknown as { materials: { roofFlat: MeshStandardMaterial; roof: MeshStandardMaterial } }).materials
    scene.setAppearance({ style: styleById('nature') })
    expect(flatMat().roofFlat.color.getHexString()).toBe('5f7a42')
    scene.setAppearance({ style: styleById('realistic') })
    expect(flatMat().roofFlat.color.equals(flatMat().roof.color)).toBe(true)   // the slope's color, not the grass
    scene.dispose()
  })

  it('a pool is a basin: coping, walls seen from inside, translucent water set back', () => {
    const nodes = buildHouse(geometry, mats)
    const water = nodes.zones.get('piscine')!
    expect(water.name).toBe('zone:piscine')
    expect((water.material as MeshStandardMaterial).transparent).toBe(true)
    water.geometry.computeBoundingBox()
    expect(water.geometry.boundingBox!.max.z).toBeCloseTo(geometry.terrain.z - 0.12, 3)
    const names = nodes.site.children.map((c) => c.name)
    expect(names).toContain('pool:coping:piscine')
    expect(names).toContain('pool:basin:piscine')
    const basin = nodes.site.children.find((c) => c.name === 'pool:basin:piscine') as Mesh
    expect(basin.material).toBe(mats.poolBasin)
    expect(mats.poolBasin.side).toBe(BackSide)
  })
})

describe('basin aligned on its edges', () => {
  it('the bottom tiles follow the sides of a rotated pool, not the world axes', () => {
    // an 8 × 4 rectangle rotated by 30°: in world UVs, its bounding box would be much larger than 32 m²
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    const rot = ([x, y]: [number, number]): [number, number] => [x * c - y * s, x * s + y * c]
    const poly = ([[-4, -2], [4, -2], [4, 2], [-4, 2]] as [number, number][]).map(rot)
    const g = alignedToLongestEdge(poly, (p) => extrudePolygon(p, -1.5, 0))
    const nrm = g.getAttribute('normal'), uv = g.getAttribute('uv')
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (let i = 0; i < nrm.count; i++) {
      if (nrm.getZ(i) > -0.999) continue                                  // the bottom only (normal pointing down)
      minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i))
      minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i))
    }
    expect((maxU - minU) * (maxV - minV)).toBeCloseTo(32, 1)
    g.computeBoundingBox()                                               // and the geometry has indeed returned to its place
    expect(g.boundingBox!.max.x).toBeCloseTo(4 * c + 2 * s, 3)
  })
})

describe('highlighting a room', () => {
  it('lays an unlit line and veil, without touching the floor color', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    const geometry = computeHouseGeometry(parseHouse(demo))
    const roomId = geometry.levels[0]!.floors[0]!.roomId
    const nodes = (scene as unknown as { nodes: { levels: Map<string, { group: { children: Mesh[] }; floors: Map<string, Mesh> }> } }).nodes
    const level = nodes.levels.get(geometry.levels[0]!.levelId)!
    const floor = level.floors.get(roomId)!
    const before = (floor.userData.material as MeshStandardMaterial).color.getHex()
    scene.highlightRoom(roomId)
    const marks = level.group.children.filter((c) => c.name === 'highlight')
    expect(marks).toHaveLength(2)
    for (const m of marks) expect((m.material as MeshBasicMaterial).isMeshBasicMaterial).toBe(true)
    expect((floor.userData.material as MeshStandardMaterial).color.getHex()).toBe(before)
    scene.highlightRoom(null)
    expect(level.group.children.filter((c) => c.name === 'highlight')).toHaveLength(0)
    scene.dispose()
  })

  it('the rest of the house fades behind the room, through a mask and not through transparency', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    const house = parseHouse(demo)
    scene.load(house)
    const floor = computeHouseGeometry(house).levels[0]!.floors[0]!
    scene.highlightRoom(floor.roomId)
    const u = roomFocusUniforms
    expect(u.kasbahFocus.value).toBe(1)
    expect(u.kasbahFocusCount.value).toBe(floor.polygon.length)
    // the house's y is the world's −z; the outline is widened by a wall: it contains its own
    const [x, y] = floor.polygon[0]!
    const p = u.kasbahFocusPoly.value[0]!
    expect(Math.abs(p.x - x)).toBeLessThan(0.5)
    expect(Math.abs(p.y + y)).toBeLessThan(0.5)
    scene.highlightRoom(null)
    expect(u.kasbahFocus.value).toBe(0)
    // injected into every material, after the lighting (`opaque_fragment`)
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
    mats.wall.onBeforeCompile(shader as never, null as never)
    expect(shader.fragmentShader.indexOf('kasbahRoomDistance( kasbahW )')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'))
    expect(shader.uniforms.kasbahFocus).toBe(u.kasbahFocus)
    scene.dispose()
  })
})

describe('lit windows', () => {
  it('a room\'s glass lights up with its lamps, at night only, without touching the neighbors', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    scene.setAppearance({ ambience: resolveAmbience({ mode: 'night' }) })
    const nodes = (scene as unknown as { nodes: { levels: Map<string, { panes: Mesh[] }> } }).nodes
    const panes = [...nodes.levels.values()].flatMap((l) => l.panes)
    const of = (roomId: string) => panes.find((p) => p.userData.roomId === roomId)!
    const glass = (p: Mesh) => p.material as MeshStandardMaterial
    const base = (p: Mesh) => p.userData.baseMaterial as MeshStandardMaterial
    const salon = of('salon'), cuisine = of('cuisine')
    expect(glass(salon)).not.toBe(glass(cuisine))                     // one glass per room
    scene.updateStates({ 'mock:light-living': { kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100 } as DeviceState })
    expect(glass(salon).emissive.r).toBeGreaterThan(base(salon).emissive.r + 0.3)
    expect(glass(salon).opacity).toBeGreaterThan(base(salon).opacity)
    expect(glass(cuisine).emissive.getHex()).toBe(base(cuisine).emissive.getHex())
    expect(glass(cuisine).opacity).toBe(base(cuisine).opacity)
    // the living room skylight is in a slab: it does not light up with the room
    const puits = panes.find((p) => p.userData.openingId === 'puits-salon')!
    expect(glass(puits)).toBe(base(salon))
    expect(glass(puits).opacity).toBeLessThan(glass(salon).opacity)
    scene.setAppearance({ ambience: resolveAmbience({ mode: 'day' }) })
    expect(glass(salon).emissive.getHex()).toBe(base(salon).emissive.getHex())
    expect(glass(salon).opacity).toBe(base(salon).opacity)
    scene.dispose()
  })
})

describe('weather in the scene', () => {
  it('translates a condition into what the surfaces keep of it', () => {
    expect(weatherEffects('rain')).toEqual({ wetness: 1, precipitation: { kind: 'rain', intensity: 0.8 } })
    expect(weatherEffects('thunderstorm')).toMatchObject({ wetness: 1, storm: true, precipitation: { kind: 'rain', intensity: 1 } })
    expect(weatherEffects('snow')).toEqual({ snow: 1, precipitation: { kind: 'snow', intensity: 0.8 } })
    expect(weatherEffects('fog')).not.toHaveProperty('precipitation')
    expect(weatherEffects('sleet')).toMatchObject({ snow: 0.5 })
    expect(weatherEffects('clear')).toEqual({})
    expect(weatherEffects(undefined)).toEqual({})
    expect(resolveAmbience({ mode: 'day', condition: 'thunderstorm', cloudiness: 0.9, visibilityM: 3000 })).toMatchObject({ cloudiness: 0.9, wetness: 1, storm: true, visibilityM: 3000 })
  })

  it('only sets a fog below 5 km, at the scale of the house', () => {
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0 })).toBeNull()
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 25_000 })).toBeNull()
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 2000 })).toBe(220)
    // the thickest fog veils the house, it does not make it disappear
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 60 })).toBe(123)
  })

  it('stretches the fog with the camera, so a farther framing keeps the same veil on the house', () => {
    const thick = { sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 60 }
    const veil = (d: number) => { const r = fogRange(thick, d)!; return (d - r.near) / (r.far - r.near) }
    expect(fogRange({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0 }, 120)).toBeNull()
    // the desktop's default framing, as before; closer, the same bounds
    expect(fogRange(thick, 55)).toEqual({ near: 123 * 0.35, far: 123 })
    expect(fogRange(thick, 20)).toEqual(fogRange(thick, 55))
    // a phone in portrait, the garden framing: the house is no farther into the fog than at 55 m
    expect(veil(115)).toBeCloseTo(veil(55))
    expect(veil(120)).toBeLessThan(0.2)
  })

  it('ignores the reported visibility when nothing is in the air (overcast at 100 % humidity)', () => {
    expect(resolveAmbience({ mode: 'day', condition: 'cloudy', cloudiness: 1, visibilityM: 60 })).not.toHaveProperty('visibilityM')
    expect(resolveAmbience({ mode: 'day', condition: 'fog', cloudiness: 1, visibilityM: 60 })).toMatchObject({ visibilityM: 60 })
    expect(resolveAmbience({ mode: 'day', visibilityM: 800 })).toMatchObject({ visibilityM: 800 })
  })

  it('rain darkens and smooths what is outdoors, snow whitens it, the inside does not change', () => {
    const theme = defaultSceneTheme()
    const look = defaultLook()
    const dry = createMaterials(theme, look)
    const wet = createMaterials(theme, look)
    applyLook(wet, theme, look, undefined, { wetness: 1, snow: 0 })
    expect(wet.terrain.roughness).toBeLessThan(dry.terrain.roughness)
    expect(wet.roof.roughness).toBeLessThan(dry.roof.roughness)
    expect(wet.terrain.color.r).toBeLessThan(dry.terrain.color.r)
    expect(wet.floor.roughness).toBe(dry.floor.roughness)              // indoors, it does not rain
    expect(wet.zones.pool.roughness).toBe(dry.zones.pool.roughness)    // the water is already water
    const snowy = createMaterials(theme, look)
    applyLook(snowy, theme, look, undefined, { wetness: 0, snow: 1 })
    const lum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b
    expect(lum(snowy.terrain.color)).toBeGreaterThan(lum(dry.terrain.color))
    expect(snowy.terrain.roughness).toBeGreaterThan(0.9)
    // bringing back fine weather restores the style's values
    applyLook(snowy, theme, look)
    expect(snowy.terrain.roughness).toBe(dry.terrain.roughness)
    expect(snowy.terrain.color.getHex()).toBe(dry.terrain.color.getHex())
  })

  it('a storm starts a lightning timer, which the end of the storm or disposal stops', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.setAppearance({ ambience: { ...resolveAmbience({ mode: 'day' }), storm: true } })
    expect((scene as unknown as { stormTimer: unknown }).stormTimer).not.toBeNull()
    scene.setAppearance({ ambience: resolveAmbience({ mode: 'day' }) })
    expect((scene as unknown as { stormTimer: unknown }).stormTimer).toBeNull()
    scene.setAppearance({ ambience: { ...resolveAmbience({ mode: 'day' }), storm: true } })
    scene.dispose()
    expect((scene as unknown as { stormTimer: unknown }).stormTimer).toBeNull()
  })
})

describe('precipitation (tier C)', () => {
  const box = { min: [0, 0] as const, max: [10, 8] as const, height: 14 }

  it('keeps every drop in the volume, makes it fall back to the top, and tilts it with the wind', () => {
    const rain = new Precipitation(box, { kind: 'rain', intensity: 1, windKmh: 36, windDirDeg: 270 })   // WEST wind: pushes toward +x
    expect(rain.count).toBe(2600)
    const pos = (rain.object as unknown as { geometry: { getAttribute(n: string): { array: Float32Array } } }).geometry.getAttribute('position').array
    // a drop's streak leans toward where it comes from: the tail is to the west (smaller x) and higher
    expect(pos[3]!).toBeLessThan(pos[0]!)
    expect(pos[5]!).toBeGreaterThan(pos[2]!)
    for (let f = 0; f < 60; f++) rain.step(0.05)                   // three seconds: everything has fallen back at least once
    for (let i = 0; i < rain.count; i++) {
      const x = pos[i * 6]!, y = pos[i * 6 + 1]!, z = pos[i * 6 + 2]!
      expect(x).toBeGreaterThanOrEqual(-3); expect(x).toBeLessThanOrEqual(13)
      expect(y).toBeGreaterThanOrEqual(-3); expect(y).toBeLessThanOrEqual(11)
      expect(z).toBeGreaterThanOrEqual(0); expect(z).toBeLessThanOrEqual(14)
    }
    rain.dispose()
    const snow = new Precipitation(box, { kind: 'snow', intensity: 0, windKmh: 0, windDirDeg: 0 })
    expect(snow.count).toBe(500)
    expect(snow.object.name).toBe('precipitation:snow')
    snow.dispose()
  })

  it('the scene sets the rain on its root and animates the loop, then removes it when it stops raining or in low quality', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    const priv = scene as unknown as { loop: { animationCount: number }; nodes: { root: { children: { name: string }[] } } }
    const falling = (): string[] => priv.nodes.root.children.filter((c) => c.name.startsWith('precipitation:')).map((c) => c.name)
    const rainy = { ...resolveAmbience({ mode: 'day' }), precipitation: { kind: 'rain' as const, intensity: 0.8 }, windKmh: 20, windDirDeg: 200 }
    scene.setAppearance({ ambience: rainy })
    expect(priv.loop.animationCount).toBe(1)
    expect(falling()).toEqual(['precipitation:rain'])
    // same rain a little stronger: adjusted, not rebuilt
    scene.setAppearance({ ambience: { ...rainy, precipitation: { kind: 'rain', intensity: 0.9 } } })
    expect(priv.loop.animationCount).toBe(1)
    // snow replaces rain
    scene.setAppearance({ ambience: { ...rainy, precipitation: { kind: 'snow', intensity: 0.8 } } })
    expect(falling()).toEqual(['precipitation:snow'])
    expect(priv.loop.animationCount).toBe(1)
    // low quality: nothing falls anymore; high: it starts again
    scene.setOptions({ quality: 'low' })
    expect(priv.loop.animationCount).toBe(0)
    expect(falling()).toEqual([])
    scene.setOptions({ quality: 'high' })
    expect(priv.loop.animationCount).toBe(1)
    scene.setAppearance({ ambience: resolveAmbience({ mode: 'day' }) })
    expect(priv.loop.animationCount).toBe(0)
    scene.dispose()
  })
})

/** Center (world) of the demo house's pool. */
const POOL_CENTER = new Vector3(18, 0, -4)

describe('low mist', () => {
  it('none by day or in the evening, moderate at night, strongest at dawn, dispersed by the wind', () => {
    const night = resolveAmbience({ mode: 'night' })
    const dusk = resolveAmbience({ mode: 'dusk' })                       // grazing sun in the WEST
    expect(mistAmount(resolveAmbience({ mode: 'day' }))).toBe(0)
    expect(mistAmount(night)).toBeGreaterThan(0.5)
    const dawn = mistAmount({ ...dusk, sunAzimuthDeg: 80 })
    expect(dawn).toBeGreaterThan(mistAmount(night))
    expect(mistAmount(dusk)).toBeLessThan(dawn)
    expect(mistAmount({ ...night, windKmh: 45 })).toBe(0)
  })

  it('is injected after three\'s fog, on outdoor materials only', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const inject = (mat: Material) => {
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
      mat.onBeforeCompile(shader as never, null as never)
      return shader
    }
    const terrain = inject(mats.terrain)
    expect(terrain.vertexShader).toContain('kasbahMistView = mvPosition.xyz;')
    expect(terrain.fragmentShader).toContain('kasbahMistDensity * length( kasbahMistView )')
    expect(terrain.uniforms.kasbahMistDensity).toBe(heightMistUniforms.kasbahMistDensity)   // shared: the hour recompiles nothing
    // a room's floor is at the height of the garden: without this filter, the dollhouse filled with mist
    expect(inject(mats.floor).fragmentShader).not.toContain('kasbahMist')
    // the opacity (and the level fade), for its part, is on ALL materials: it is the whole upper floor that fades
    expect(inject(mats.ground).fragmentShader).not.toContain('kasbahMist')
    const floor = inject(mats.floor)
    expect(floor.fragmentShader).toContain('#ifdef OPAQUE')
    expect(floor.fragmentShader.indexOf('kasbahA < 1.0')).toBeLessThan(floor.fragmentShader.indexOf('#include <alphatest_fragment>'))
    expect(floor.uniforms.kasbahFadeY).toBe(levelFadeUniforms.kasbahFadeY)
  })

  it('the shadow pass receives the fade: the shadow of the level flying off pales with it', () => {
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.depth.vertexShader, fragmentShader: ShaderLib.depth.fragmentShader }
    new MeshDepthMaterial().onBeforeCompile(shader as never, null as never)
    expect(shader.vertexShader).toContain('kasbahFadeView = mvPosition.xyz;')
    expect(shader.fragmentShader.indexOf('kasbahA < 1.0')).toBeLessThan(shader.fragmentShader.indexOf('#include <alphatest_fragment>'))
    expect(shader.uniforms.kasbahFadeVisibility).toBe(levelFadeUniforms.kasbahFadeVisibility)
  })

  it('every material has its opacity, adjustable without recompiling, and a clone its own', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
    mats.wall.onBeforeCompile(shader as never, null as never)
    const opacity = materialOpacity(mats.wall)
    expect(shader.uniforms.kasbahOpacity).toBe(opacity)                 // the VERY uniform: changing it is enough
    expect(opacity.value).toBe(1)                                        // opaque by default
    opacity.value = 0.4
    const clone = mats.wall.clone()
    expect(materialOpacity(clone)).not.toBe(opacity)
    expect(mats.wall.transparent).toBe(false)                           // the material stays in the opaque queue
  })
})

describe('living water', () => {
  it('injects its waves and its caustics at the points three leaves it', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const water = createWaterUniforms()
    const time = water.time
    const patch = (mat: MeshStandardMaterial, role: 'surface' | 'basin') => {
      const strength = makeWaterAlive(mat, role, water)
      const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
      mat.onBeforeCompile(shader as never, null as never)
      return { shader, strength }
    }
    const surface = patch(mats.zones.pool, 'surface')
    const basin = patch(mats.poolBasin, 'basin')
    // the time is SHARED, the strength is not: the bottom follows the daylight, the swell does not
    expect(surface.shader.uniforms.uWaterTime).toBe(time)
    expect(basin.shader.uniforms.uWaterTime).toBe(time)
    expect(basin.shader.uniforms.uWaterStrength).not.toBe(surface.shader.uniforms.uWaterStrength)
    // the injection points still exist in three's shader: it is THIS test that will say so the
    // day a version moves one (the patch would otherwise fail silently, frozen water)
    expect(surface.shader.vertexShader).toContain('vWaterPos = (modelMatrix')
    expect(surface.shader.fragmentShader).toContain('kasbahWaveGrad(kasbahToWind(vWaterPos.xz)')
    expect(surface.shader.fragmentShader).toContain('waterFresnel')
    // the bottom: caustics on the direct light, then absorption along the path through the water
    expect(basin.shader.uniforms.uWaterCaustics).toBe(water.caustics)
    expect(basin.shader.uniforms.uWaterRefracted).toBe(water.refracted)
    expect(basin.shader.vertexShader).toContain('vWaterDepth = waterDepth')
    expect(basin.shader.fragmentShader).toContain('reflectedLight.directDiffuse *= mix(1.0, caustic')
    expect(basin.shader.fragmentShader).toMatch(/outgoingLight = outgoingLight \* waterT[\s\S]*#include <opaque_fragment>/)
    expect(surface.shader.fragmentShader).not.toContain('waterT')
    // the wind is the same for the surface and for the bottom (which reads the map in its frame)
    expect(surface.shader.uniforms.uWaterWind).toBe(water.wind)
    expect(basin.shader.uniforms.uWaterWind).toBe(water.wind)
    expect(basin.shader.fragmentShader).toContain('kasbahToWind(causticAt)')
    // two distinct programs, and distinct from any standard material with the same settings
    expect(mats.zones.pool.customProgramCacheKey!()).not.toBe(mats.poolBasin.customProgramCacheKey!())
  })

  it('the swell heads downwind of the real wind, and its amplitude follows its strength', () => {
    // drawn in the wind frame, the waves advance (phase k·p − ωt) mostly toward +x
    const push = WAVES.reduce((acc, w) => ({ x: acc.x + w.a * w.kx, y: acc.y + w.a * w.ky }), { x: 0, y: 0 })
    expect(push.x).toBeGreaterThan(3 * Math.abs(push.y))
    const water = createWaterUniforms()
    // WEST wind (270°): pushes east, world +x
    setWaterWind(water, 10, 270)
    expect(water.wind.value.x).toBeCloseTo(1)
    expect(water.wind.value.y).toBeCloseTo(0)
    expect(water.wind.value.z).toBeCloseTo(1)                     // a 10 km/h breeze: the former swell
    // NORTH wind (0°): pushes south, world +z (north = −z)
    setWaterWind(water, 10, 0)
    expect(water.wind.value.x).toBeCloseTo(0)
    expect(water.wind.value.y).toBeCloseTo(1)
    setWaterWind(water, 0, 0)
    expect(water.wind.value.z).toBeCloseTo(0.15)                  // calm: almost flat
    setWaterWind(water, 80, 0)
    expect(water.wind.value.z).toBeCloseTo(1.5)                   // storm: capped
  })

  it('counts the wind from TRUE north: the house heading turns the swell', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    const house = parseHouse(demo)
    scene.load({ ...house, origin: { ...house.origin, heading: 90 } })   // plan +y = east
    scene.setAppearance({ ambience: { ...resolveAmbience({ mode: 'day' }), windKmh: 10, windDirDeg: 270 } })   // west wind
    // it pushes east, that is, the plan's +y: the world's −z
    const wind = (scene as unknown as { water: { wind: { value: Vector3 } } }).water.wind.value
    expect(wind.x).toBeCloseTo(0)
    expect(wind.y).toBeCloseTo(-1)
  })

  it('only runs the loop if the style, the quality AND the camera field want it', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.resize(1000, 600)
    scene.load(parseHouse(demo))
    // headless: no controls, so nobody turned the camera toward the house — we aim it
    // by hand at the demo house's pool, then go through `syncWater` again.
    const aim = (at: Vector3, quality: 'high' | 'medium') => { scene.camera.lookAt(at); scene.setOptions({ quality }) }
    aim(POOL_CENTER, 'high')
    expect(scene.debugStats().animations).toBe(1)
    scene.setOptions({ quality: 'low' })
    expect(scene.debugStats().animations).toBe(0)      // same rule as the rain
    scene.setOptions({ quality: 'high' })
    expect(scene.debugStats().animations).toBe(1)
    scene.setAppearance({ style: styleById('maquette') })
    expect(scene.debugStats().animations).toBe(0)      // a maquette has resin water
    scene.setAppearance({ style: styleById(null) })
    expect(scene.debugStats().animations).toBe(1)
    // and the garden no longer being looked at no longer costs anything
    aim(new Vector3(-40, 0, 40), 'medium')
    expect(scene.debugStats().animations).toBe(0)
  })
})
