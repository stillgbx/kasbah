import { describe, expect, it } from 'vitest'
import './textures/prebake' // cuit les matières à l'import, hors du délai du premier test
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
import { createCostGuard, detectQuality } from './core/post'
import { parseCssColor } from './core/theme'
import { defaultLook, defaultSceneTheme, RENDER_STYLES, rolesOf, styleById } from './styles'
import { applyLook } from './builders/materials'
import { dayFactor, fogDistance, resolveAmbience, sunDirection, weatherEffects, type AmbienceMode } from './core/ambience'
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

/** La cadence que `HouseScene` demande pour l'eau (`WATER_HZ`) — répétée ici, le test la vérifie. */
const WATER_HZ_TEST = 10

/** Tous les maillages d'un objet, à plat. */
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
    // portrait : le champ horizontal est le plus étroit → distance plus grande
    const portrait = fitBox(box, 45, 3 / 4, { azimuth: 0, polar: Math.PI / 4, padding: 1 })
    expect(portrait.position.distanceTo(portrait.target)).toBeGreaterThan(dist)
  })
})

describe('render loop', () => {
  /**
   * Une onde de lecteur dure 5,75 s et une respiration de batterie 2,6 s : les animer à la cadence de
   * l'écran redessinait TOUTE la scène soixante fois par seconde pour une fraction de pixel. Une
   * maison où une enceinte joue ne doit pas charger le navigateur en permanence.
   */
  it('une animation décorative ne redessine pas à la cadence de l’écran', () => {
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
    loop.addAnimation({ step: () => true })          // une onde qui ne s'arrête jamais
    for (let i = 0; i < 12; i++) tick()              // ~192 ms d'images à 60 Hz
    expect(loop.running).toBe(true)                  // la boucle reste vivante…
    expect(renders).toBeLessThanOrEqual(5)           // …mais elle dessine à ~20 Hz, pas à 60
    expect(renders).toBeGreaterThanOrEqual(2)
    loop.dispose()
  })

  it('l’image où une tween finit est dessinée, même quand le décor n’est pas encore dû', () => {
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
    loop.addAnimation({ hz: 1, step: () => true })                     // un décor lent (1 Hz)
    tick(1000)                                                          // il vient d'être servi
    const before = renders
    loop.addTween(createTween({ durationMs: 10, now, onUpdate: () => {}, onDone: () => { done = true } }))
    tick(16)                                                            // la tween finit ici, le décor n'est pas dû
    expect(done).toBe(true)
    expect(renders).toBe(before + 1)                                    // l'état final est à l'écran
    loop.dispose()
  })

  it('une animation qui demande 10 Hz dessine deux fois moins qu’une qui en demande 20', () => {
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
    const fast = run(undefined)                      // 20 Hz par défaut
    const slow = run(WATER_HZ_TEST)                  // l'eau : 10 Hz
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
    expect(loop.running).toBe(false)                 // rien ne bouge → arrêt
    controlsBusy = true
    loop.invalidate(); tick(); tick()
    expect(renders).toBe(3)
    expect(loop.running).toBe(true)                  // amortissement en cours
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
    expect(nodes.levels.size).toBe(3)                        // rdc, étage, et le toit (niveau sans pièce qui porte les panneaux)
    expect(nodes.levels.get('rdc')!.floors.size).toBe(3)
    expect(nodes.levels.get('rdc')!.panes.length).toBeGreaterThan(0)
    expect(nodes.zones.size).toBe(4)
    expect(nodes.roof).not.toBeNull()
    expect(nodes.root.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(nodes.levels.get('etage')!.group.position.z).toBeCloseTo(3.05)
    expect(countTriangles(nodes.root)).toBeGreaterThan(100)
  })
  it('les murs vont du sol au plafond, cloisons comprises, et le sol infini est sous la parcelle', () => {
    const level = geometry.levels[0]!
    const interior = wallMesh('walls:interior', level).geometry
    interior.computeBoundingBox()
    expect(interior.boundingBox!.max.z).toBeCloseTo(level.height)
    const nodes = buildHouse(geometry, createMaterials(defaultSceneTheme(), defaultLook()))
    expect(nodes.ground.position.z).toBeLessThan(geometry.terrain.z)
  })
  it('habille chaque surface d’une matière répétée à l’échelle du mètre, avec sa normale et sa rugosité', () => {
    const tex = createSurfaceTextures(['tile', 'water', 'plaster'])
    for (const t of Object.values(tex)) {
      expect((t.map.image as { width: number }).width).toBeGreaterThanOrEqual(256)
      expect(t.map.repeat.x).toBeGreaterThan(0)
      expect(t.map.repeat.x).toBeLessThanOrEqual(1)   // un motif d'au moins un mètre
    }
    const px = (t: SurfaceTexture, u: number, v: number) => {
      const img = t.map.image as { data: Uint8Array; width: number }
      return img.data[(Math.floor(v * img.width) * img.width + Math.floor(u * img.width)) * 4]!
    }
    // les carreaux : le joint (le plus sombre de la rangée) tranche sur le carreau (son centre)
    const row = Array.from({ length: 512 }, (_, x) => px(tex.tile!, (x + 0.5) / 512, 0.125))
    expect(Math.min(...row)).toBeLessThan(px(tex.tile!, 0.125, 0.125) - 40)
    // une matière presque plane a sa normale vers le haut : le canal bleu au maximum
    expect((tex.plaster!.normalMap.image as { data: Uint8Array }).data[2]!).toBeGreaterThan(200)
    const mats = createMaterials(defaultSceneTheme(), defaultLook(), tex)
    expect(mats.floors.tile.map).toBe(tex.tile!.map)
    expect(mats.zones.pool.map).toBe(tex.water!.map)
    expect(mats.wall.normalMap).toBe(tex.plaster!.normalMap)
    // la même carte packée sert de rugosité ET de métallicité : three lit le canal qu'il lui faut
    expect(mats.wall.roughnessMap).toBe(tex.plaster!.roughnessMap)
    expect(mats.wall.metalnessMap).toBe(tex.plaster!.roughnessMap)
  })
})

describe('caméra et niveaux', () => {
  const scene = new HouseScene(document.createElement('canvas'), { headless: true })
  scene.load(parseHouse(demo))
  /** La caméra active est d'une espèce ou de l'autre selon la projection ; ici on la sait perspective. */
  const persp = () => scene.camera as PerspectiveCamera

  it('cadre la partie libre du canvas quand un panneau couvre le bord droit', () => {
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

describe('projection de la vue', () => {
  it('cadre la même hauteur de monde des deux côtés de la bascule', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    scene.resize(1000, 500)
    const before = scene.camera.position.clone()
    const distance = before.distanceTo(new Vector3())

    scene.setOptions({ projection: 'ortho' })
    const ortho = scene.camera as OrthographicCamera
    expect(ortho.isOrthographicCamera).toBe(true)
    // la pose ne bouge pas : seul le tronc change
    expect(scene.camera.position.distanceTo(before)).toBeCloseTo(0)
    // et le zoom montre la hauteur de monde que le champ de vision montrait à cette distance
    expect(ORTHO_BASE_M / ortho.zoom).toBeCloseTo(visibleHeight(distance, 38), 3)
    // le tronc suit le rapport de l'écran, comme `aspect` en perspective
    expect((ortho.right - ortho.left) / (ortho.top - ortho.bottom)).toBeCloseTo(2)

    scene.setOptions({ projection: 'perspective' })
    expect((scene.camera as PerspectiveCamera).isPerspectiveCamera).toBe(true)
    expect(scene.camera.position.distanceTo(before)).toBeCloseTo(0, 2)
  })

  it('l’isométrie verrouille la plongée et tourne par quarts de tour', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    scene.resize(1000, 500)
    const shown = () => visibleHeight(scene.camera.position.length(), (scene.camera as PerspectiveCamera).fov)
    const before = shown()
    scene.setOptions({ projection: 'iso' })
    // une perspective à champ ÉTROIT, reculée d'autant : la maison garde sa taille à l'écran
    expect((scene.camera as PerspectiveCamera).isPerspectiveCamera).toBe(true)
    expect((scene.camera as PerspectiveCamera).fov).toBe(ISO_FOV_DEG)
    expect(shown()).toBeCloseTo(before, 3)
    // headless : pas de contrôles, donc pas d'animation — la pose est posée d'un coup
    const poseOf = () => sphericalOf(scene.camera.position, new Vector3())
    expect(poseOf().polar).toBeCloseTo(ISO_POLAR, 5)
    const quarters = [poseOf().azimuth]
    for (let i = 0; i < 3; i++) { scene.orbitBy(Math.PI / 6); quarters.push(poseOf().azimuth) }
    // l'amplitude demandée ne compte pas : chaque appui fait un quart de tour, et la plongée tient
    // (l'écart est ramené dans ]-π, π] : `Spherical` repart de -π après un tour complet)
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    for (let i = 1; i < quarters.length; i++) expect(wrap(quarters[i]! - quarters[i - 1]!)).toBeCloseTo(Math.PI / 2, 5)
    expect(poseOf().polar).toBeCloseTo(ISO_POLAR, 5)
    // retour en perspective : le champ de base, la même hauteur montrée
    const inIso = shown()
    scene.setOptions({ projection: 'perspective' })
    expect((scene.camera as PerspectiveCamera).fov).toBe(38)
    expect(shown()).toBeCloseTo(inIso, 3)
  })

  it('ramène un azimut quelconque sur le coin isométrique le plus proche', () => {
    const origin = -Math.PI / 4
    expect(snapIsoAzimuth(origin + 0.2, origin)).toBeCloseTo(origin, 5)
    expect(snapIsoAzimuth(origin + 1.4, origin)).toBeCloseTo(origin + Math.PI / 2, 5)
    expect(snapIsoAzimuth(origin - 1.4, origin)).toBeCloseTo(origin - Math.PI / 2, 5)
  })
})


describe("pochette sur l'écran d'un lecteur 3D", () => {
  /** Sommet dont l'UV est (u, v) : (0,1) = haut gauche de l'image, (1,1) = haut droit. */
  const corner = (g: ReturnType<typeof screenArtGeometry>, u: number, v: number) => {
    const uv = g.getAttribute('uv') as BufferAttribute
    const pos = g.getAttribute('position') as BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      if (uv.getX(i) === u && uv.getY(i) === v) return new Vector3().fromBufferAttribute(pos, i)
    }
    throw new Error(`aucun sommet en uv ${u},${v}`)
  }

  it("regarde vers +y, le haut de l'image en haut, et sans miroir pour qui est devant", () => {
    const g = screenArtGeometry(1, 1)
    const normal = g.getAttribute('normal') as BufferAttribute
    const n = new Vector3().fromBufferAttribute(normal, 0)
    expect(n.x).toBeCloseTo(0)
    expect(n.y).toBeCloseTo(1)
    expect(n.z).toBeCloseTo(0)
    // haut de l'image vers +z (le repère local d'une boîte d'écran est Z-up)
    expect(corner(g, 0, 1).z).toBeCloseTo(0.5)
    expect(corner(g, 0, 0).z).toBeCloseTo(-0.5)
    // quelqu'un placé devant (en +y, regardant vers -y) a sa droite en -x : le haut DROIT de l'image y est
    expect(corner(g, 1, 1).x).toBeCloseTo(-0.5)
    expect(corner(g, 0, 1).x).toBeCloseTo(0.5)
  })

  it("remplit l'écran en rognant, jamais en déformant (comme object-fit: cover)", () => {
    // pochette carrée sur une dalle 16:9 : on montre la bande centrale, 56 % de la hauteur
    const square = coverCrop(1, 16 / 9)
    expect(square.repeat[0]).toBe(1)
    expect(square.repeat[1]).toBeCloseTo(0.5625)
    expect(square.offset[1]).toBeCloseTo(0.21875)
    // image plus large que l'écran : ce sont les côtés qui sont rognés
    const wide = coverCrop(2, 16 / 9)
    expect(wide.repeat[1]).toBe(1)
    expect(wide.repeat[0]).toBeCloseTo(0.8889)
    expect(wide.offset[0]).toBeCloseTo(0.0556)
    // même format : rien à rogner
    expect(coverCrop(16 / 9, 16 / 9)).toEqual({ repeat: [1, 1], offset: [0, 0] })
    // format inconnu : supposée carrée — surtout pas étirée pour remplir
    expect(coverCrop(0, 16 / 9)).toEqual(coverCrop(1, 16 / 9))
  })

  it('charge, remplace et libère la texture, et ignore une réponse périmée', () => {
    const loads: { url: string; done: (t: Texture) => void; fail: () => void }[] = []
    const disposed: string[] = []
    // une pochette est carrée : 600 × 600, comme celles que servent les catalogues
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
    art.set('/art?a')                                     // même image : une seule requête
    expect(loads).toHaveLength(1)
    loads[0]!.done(fakeTexture('a'))
    expect(art.mesh.visible).toBe(true)
    expect(ready).toBe(1)
    // le cadrage vit dans les UNIFORMES : un shader écrit à la main ignore `texture.repeat`, et
    // l'image sortait étirée quand le calcul n'atterrissait que sur la texture
    const uniforms = art.mesh.material.uniforms
    expect(uniforms.uCrop!.value.y).toBeCloseTo(0.5625)     // pochette carrée sur une dalle 16:9
    expect(uniforms.uCropOffset!.value.y).toBeCloseTo(0.21875)
    expect(uniforms.uCrop!.value.x).toBe(1)

    // le morceau change : l'ancienne texture est libérée quand la nouvelle arrive
    art.set('/art?b')
    loads[1]!.done(fakeTexture('b'))
    expect(disposed).toEqual(['a'])

    // réponse d'une image qu'on n'attend plus (zapping) : jetée, l'écran garde la sienne
    art.set('/art?c')
    art.set('/art?b')
    loads[2]!.done(fakeTexture('c'))
    expect(disposed).toEqual(['a', 'c'])
    expect(art.mesh.visible).toBe(true)

    // plus rien ne joue : écran nu, texture libérée
    art.set(undefined)
    expect(art.mesh.visible).toBe(false)
    expect(disposed).toEqual(['a', 'c', 'b'])
  })

  it("garde l'écran nu quand l'image est illisible", () => {
    const loads: { fail: () => void }[] = []
    const art = new ScreenArt({ width: 1, height: 0.56, offsetY: 0.03, load: (_url, _done, fail) => loads.push({ fail }) })
    art.set('/art?boom')
    loads[0]!.fail()
    expect(art.mesh.visible).toBe(false)
    art.dispose()
  })
})

describe('marqueurs 3D', () => {
  // Un marqueur a besoin d'un contexte de scène ; on garde les animations sous la main pour les
  // dérouler jusqu'au bout (les ouvrants tweenent leur course sur 400 ms).
  const animations: Animation[] = []
  const marker = (device: PlacedHouseDevice, descriptor: DeviceDescriptor) => {
    animations.length = 0
    return createMarker(device, {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow, descriptor,
      addAnimation: (a) => { animations.push(a); return () => {} },
      invalidate: () => {}, onTap: () => {}, label: descriptor.name,
    }, () => true)
  }
  /** Déroule les tweens en cours : une seule étape très tard suffit à les terminer. */
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
   * Un volet fermé doit BARRER la lumière : son maillage porte `castShadow` et vit sur la couche
   * commune. Sa lampe aussi — le shader la cantonne à son niveau (`core/levelLight.ts`) ; seuls les
   * DÉCORS translucides ont leur couche, pour sortir du relevé d'occlusion.
   */
  it('un appareil porte son ombre ; seuls ses décors ont leur couche', () => {
    const shutter = marker(device({ size: { width: 2, height: 1.2 } }), cover('shutter'))
    for (const mesh of meshes(shutter.object)) {
      expect(mesh.castShadow).toBe(true)
      expect(mesh.layers.mask).toBe(1)               // couche commune : la passe globale la voit
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
   * Une lampe de JARDIN, elle, doit éclairer la façade sans traverser le mur. Aucune couche ne sait
   * faire ça : il lui faut une vraie ombre portée — et seulement tant qu'elle est allumée.
   */
  it('une lampe de jardin éclaire partout, mais porte son ombre', () => {
    const lamp = createMarker(device(), {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow,
      outdoor: true,
      descriptor: { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Borne', capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
      addAnimation: () => () => {}, invalidate: () => {}, onTap: () => {}, label: 'Borne',
    }, () => true)
    const light = (() => { let f: { layers: { mask: number }; castShadow: boolean } | null = null; lamp.object.traverse((o) => { if ((o as { isLight?: boolean }).isLight) f = o as never }); return f! })()
    expect(light.layers.mask).toBe(1)                // couche commune, comme toute lampe
    expect(light.castShadow).toBe(false)             // éteinte : pas six rendus de profondeur pour rien
    lamp.update({ kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100 } as DeviceState)
    expect(light.castShadow).toBe(true)
    const sprites: number[] = []
    lamp.object.traverse((o) => { if ((o as { isSprite?: boolean }).isSprite) sprites.push(o.layers.mask) })
    expect(sprites).toEqual([1 << SITE_DECOR_LAYER])  // son halo est un décor du jardin
  })

  it('un plafonnier pose une tache de lumière au sol, de sa couleur, sans lumière de plus', () => {
    const make = (d: PlacedHouseDevice, outdoor = false) => createMarker(d, {
      materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow,
      ...(outdoor ? { outdoor } : {}),
      descriptor: { id: 'p:l', pluginId: 'p', externalId: 'l', kind: 'light', name: 'Plafonnier', capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
      addAnimation: () => () => {}, invalidate: () => {}, onTap: () => {}, label: 'Plafonnier',
    }, () => true)
    const lamp = make(device({ position: [3, 2, 2.5], mount: 'ceiling' }))
    lamp.object.position.set(3, 2, 2.5)
    const pool = lamp.object.getObjectByName('lamp-pool') as Mesh
    expect(pool.visible).toBe(false)                                   // éteinte : pas de tache
    lamp.update({ kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100, colorTempMirek: 153 } as DeviceState)
    expect(pool.visible).toBe(true)
    const m = pool.material as MeshBasicMaterial
    expect(m.opacity).toBeGreaterThan(0)
    expect(m.color.b).toBeGreaterThan(m.color.r * 0.9)                   // 6500 K : un blanc froid, pas le chaud par défaut
    pool.onBeforeRender(null as never, null as never, null as never, null as never, null as never, null as never)
    expect(pool.position.z).toBeCloseTo(0.004 - 2.5, 5)                 // posée sur le sol du niveau
    expect(pool.layers.mask).toBe(1 << DECOR_LAYER)
    let lights = 0
    lamp.object.traverse((o) => { if ((o as { isLight?: boolean }).isLight) lights++ })
    expect(lights).toBe(1)
    expect(make(device({ position: [3, 2, 0.8] })).object.getObjectByName('lamp-pool')).toBeUndefined()
    expect(make(device({ position: [3, 2, 2.5], mount: 'ceiling' }), true).object.getObjectByName('lamp-pool')).toBeUndefined()
  })

  it('une lumière liée à un ventilateur pose un hub et trois pales, pas une sphère seule', () => {
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
    // hub + globe + 3 pales
    expect(meshCount).toBe(5)
  })

  it('les pales tournent quand le ventilateur lié est allumé, et s\'arrêtent sinon', () => {
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

  it('les pales suivent la vitesse et le sens, et le flux d\'air dit frais (bas, bleu) ou chaud (haut, rouge)', () => {
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
    expect(steps).toHaveLength(1)                       // changer de vitesse ne relance pas une 2e animation
    const fast = turn()
    expect(slow).toBeLessThan(0)                        // été : horaire vu d'en haut
    expect(Math.abs(fast)).toBeGreaterThan(Math.abs(slow) * 2)
    fan(6, 'reverse')
    expect(turn()).toBeCloseTo(-fast)

    // couleur des anneaux, et sens vertical : un anneau large est en bas de la colonne
    const rings = () => air.children as Mesh<BufferGeometry, ShaderMaterial>[]
    const sample = () => {
      const c = rings()[0]!.material.uniforms.uColor!.value as { r: number; b: number }
      // tout le flux reste SOUS le plan des pales, quel que soit le sens
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
    expect(ring.position.z).toBeLessThan(z0)          // été : l'air descend
    fan(6, 'reverse')
    const low = widest(), zl = low.position.z
    steps[0]!.step(0, 0.05)
    expect(low.position.z).toBeGreaterThan(zl)        // hiver : il monte
    lamp.setCompanionFan({ kind: 'fan', updatedAt: 1, available: true, on: false } as DeviceState)
    expect(air.visible).toBe(false)
    expect(steps).toHaveLength(0)
  })

  // La carrosserie 3D arrive APRÈS le marqueur (le .glb se télécharge). Ce qui se vérifie ici, c'est
  // que la substitution ne déplace rien : la silhouette générique est dessinée aux cotes du modèle
  // attendu, et la vraie carrosserie prend exactement sa place.
  describe('carrosserie 3D d un véhicule', () => {
    const tesla = { id: 'tesla:5YJ', pluginId: 'tesla', externalId: '5YJ', kind: 'vehicle', name: 'Model S', capabilities: [], meta: {} } as unknown as DeviceDescriptor
    /** Faux .glb : une boîte aux cotes du catalogue, déjà passée dans le repère de la maison. */
    const fakeShell = () => new BoxGeometry(2.32, 4.98, 1.52).translate(0, 0, 0.76)
    const vehicleMarker = (extra: Partial<PlacedHouseDevice>, load?: (url: string, ok: (g: BufferGeometry) => void, ko: () => void) => void) =>
      createMarker({ id: 'vehicle.s', position: [0, 0, 0], ...extra }, {
        materials: createMaterials(defaultSceneTheme(), defaultLook()), theme: defaultSceneTheme(), glow: defaultLook().glow, descriptor: tesla,
        addAnimation: () => () => {}, invalidate: () => {}, onTap: () => {}, label: 'Model S',
        ...(load ? { loadModel: load } : {}),
      }, () => true)

    it('dessine la silhouette aux cotes du modèle attendu, puis lui substitue la carrosserie sans rien déplacer', () => {
      let deliver: ((g: BufferGeometry) => void) | undefined
      const marker = vehicleMarker({}, (url, ok) => { expect(url).toContain('models/tesla/model-s.glb'); deliver = ok })

      const before = new Box3().setFromObject(marker.object)
      expect(meshes(marker.object).length).toBe(2)          // caisse + habitacle
      expect(marker.pickables.length).toBe(2)

      deliver!(fakeShell())
      const after = new Box3().setFromObject(marker.object)
      expect(meshes(marker.object).length).toBe(1)          // la silhouette a cédé la place
      expect(marker.pickables.length).toBe(1)               // et cessé d'être cliquable
      expect(after.min.distanceTo(before.min)).toBeLessThan(0.02)
      expect(after.max.distanceTo(before.max)).toBeLessThan(0.02)
    })

    it('garde la silhouette quand la carrosserie ne se charge pas', () => {
      const marker = vehicleMarker({}, (_url, _ok, ko) => ko())
      expect(meshes(marker.object).length).toBe(2)
      expect(marker.pickables.length).toBe(2)
    })

    it("ne charge rien quand l'utilisateur a demandé la silhouette générique", () => {
      let asked = false
      const marker = vehicleMarker({ model3d: 'none' }, () => { asked = true })
      expect(asked).toBe(false)
      expect(meshes(marker.object).length).toBe(2)
    })
  })

  it("un store rentre son avancée en se repliant, sans décoller du mur", () => {
    const m = marker(device({ size: { width: 4, height: 3 } }), cover('awning'))
    const box = meshes(m.object)[0]!
    // déployé (position 0 = « baissé ») : l'avancée déclarée, centrée sur le point posé
    m.update(coverState(0)); settle()
    expect(box.scale.y).toBeCloseTo(1)
    expect(box.position.y).toBeCloseTo(0)
    // replié (position 100 = « remonté ») : il ne reste que le coffre, et le bord CÔTÉ MUR n'a pas bougé
    m.update(coverState(100)); settle()
    expect(box.scale.y * 3).toBeCloseTo(0.3)
    expect(box.position.y - (box.scale.y * 3) / 2).toBeCloseTo(-1.5)
    // position inconnue : AU REPOS, comme partout ailleurs — un store au repos est rentré
    m.update(coverState(undefined)); settle()
    expect(box.scale.y * 3).toBeCloseTo(0.3)
  })

  it("un ouvrant reconstruit se POSE dans sa position, sans rejouer sa course", () => {
    // toute écriture dans la maison reconstruit les marqueurs : un volet fermé rouvrait puis se
    // refermait à chaque placement enregistré, le temps du tween
    const m = marker(device({ size: { width: 4, height: 3 } }), cover('awning'))
    const box = meshes(m.object)[0]!
    m.update(coverState(100))                       // premier état, SANS dérouler les animations
    expect(box.scale.y * 3).toBeCloseTo(0.3)        // déjà replié : rien ne s'est joué à l'écran
    m.update(coverState(0))                         // une vraie course, elle, s'anime
    expect(box.scale.y * 3).toBeCloseTo(0.3)
    settle()
    expect(box.scale.y).toBeCloseTo(1)
  })

  it('un portail ouvre ses battants, un ou deux selon le JSON', () => {
    const two = marker(device({ size: { width: 4, height: 1.5 } }), cover('gate'))
    const hinges = () => meshes(two.object).map((x) => x.parent!)
    expect(hinges()).toHaveLength(2)
    two.update(coverState(0)); settle()          // fermé : les deux battants dans le plan du portail
    expect(hinges()[0]!.rotation.z).toBeCloseTo(0)
    expect(hinges()[1]!.rotation.z).toBeCloseTo(0)
    two.update(coverState(100)); settle()        // ouvert : un quart de tour, chacun de son côté
    expect(hinges()[0]!.rotation.z).toBeCloseTo(Math.PI / 2)
    expect(hinges()[1]!.rotation.z).toBeCloseTo(-Math.PI / 2)
    // position inconnue : au repos, donc clos — un portail muet ne se dessine pas ouvert
    two.update(coverState(undefined)); settle()
    expect(hinges()[0]!.rotation.z).toBeCloseTo(0)
    // un seul battant : un seul panneau, de toute la largeur
    const one = marker(device({ size: { width: 4, height: 1.5 }, leaves: 1 }), cover('gate'))
    expect(meshes(one.object)).toHaveLength(1)
  })

  /**
   * Le TABLIER d'un volet lié à une ouverture : il épouse la baie, et ses vantaux ne font que le
   * découper — la course reste verticale, c'est elle que l'état publie.
   */
  describe('tablier de volet', () => {
    const rect = (extra: Partial<OpeningRect> = {}): OpeningRect => ({
      openingId: 'win', roomId: 'salon', levelId: 'rdc', type: 'window', host: 'wall',
      origin: [2, 0, 1], u: [1, 0], normal: [0, -1], width: 2, height: 1.2, depth: 0.3, leaves: 1, ...extra,
    })
    /** Même contexte que `marker`, plus l'ouverture que l'ouvrant habille (et le jeu de matériaux, qu'on inspecte). */
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

    it("est d'un seul tenant par défaut, et se refend au nombre de vantaux", () => {
      const one = meshes(dressed(device({ position: [3, 0, 1.5] })).m.object)
      expect(one).toHaveLength(1)
      expect(width(one[0]!)).toBeCloseTo(2 * 0.98)      // il coulisse DANS l'embrasure, pas dessus

      const two = meshes(dressed(device({ position: [3, 0, 1.5], leaves: 2 })).m.object)
      expect(two).toHaveLength(2)
      expect(width(two[0]!)).toBeCloseTo(width(two[1]!))
      // le jeu entre les deux panneaux : 2 cm, le même trait que les vantaux d'une porte
      expect(two[1]!.position.x - two[0]!.position.x - width(two[0]!)).toBeCloseTo(0.02)
      // les deux couvrent la baie, jeu compris, et restent centrés sur elle (origine 2, largeur 2)
      expect((two[0]!.position.x + two[1]!.position.x) / 2 + 3).toBeCloseTo(3)
    })

    it('descend ses deux vantaux ensemble', () => {
      const { m } = dressed(device({ position: [3, 0, 1.5], leaves: 2 }))
      m.update(coverState(0)); settle()                 // fermé : toute la hauteur de la baie
      for (const slat of meshes(m.object)) {
        expect(slat.scale.z).toBeCloseTo(1.2)
        expect(slat.visible).toBe(true)
      }
      m.update(coverState(100)); settle()               // ouvert : le tablier est rentré, on ne le voit plus
      for (const slat of meshes(m.object)) expect(slat.visible).toBe(false)
    })

    it('garde le matériau de la scène, sauf matière ou couleur voulue', () => {
      const plain = dressed(device({ position: [3, 0, 1.5] }))
      expect(meshes(plain.m.object)[0]!.material).toBe(plain.materials.slat)

      const painted = dressed(device({ position: [3, 0, 1.5], leaves: 2, coverMaterial: 'metal', coverColor: '#ffffff' }))
      const mats = meshes(painted.m.object).map((x) => x.material as MeshStandardMaterial)
      expect(mats[0]).not.toBe(painted.materials.slat)
      expect(mats[1]).toBe(mats[0])                     // les deux vantaux d'un même volet partagent leur matériau
      expect(mats[0]!.color.getHexString()).toBe('ffffff')
      expect(mats[0]!.metalness).toBeCloseTo(0.85)      // le métal réfléchit, le bois non
      expect(mats[0]!.roughness).toBeCloseTo(0.3)
    })

    it('devient translucide en VERRE, et cesse alors de porter son ombre', () => {
      // une porte de garage vitrée : le verre ne vitre pas la baie ici, il rend le panneau translucide
      const { m } = dressed(device({ position: [3, 0, 1.5], coverMaterial: 'glass' }))
      const slat = meshes(m.object)[0]!
      const mat = slat.material as MeshStandardMaterial
      expect(mat.transparent).toBe(true)
      expect(mat.opacity).toBeCloseTo(0.45)
      expect(slat.castShadow).toBe(false)
    })

    it("montre la teinte qu'on survole sans tacher les autres volets", () => {
      const { m, materials } = dressed(device({ position: [3, 0, 1.5] }))
      const shared = materials.slat.color.getHexString()
      m.previewColor('#ff0000')
      expect(materials.slat.color.getHexString()).toBe(shared)   // le matériau partagé n'a pas bougé
      expect((meshes(m.object)[0]!.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000')
      m.previewColor(null)                                       // choix abandonné : la teinte d'avant revient
      expect((meshes(m.object)[0]!.material as MeshStandardMaterial).color.getHexString()).toBe(shared)
    })
  })

  it("le cône d'un module montre où regarde son verre, châssis négatif compris", () => {
    const sensor = { id: 'p:s', pluginId: 'p', externalId: 's', kind: 'sensor', name: 'Onduleur', capabilities: ['measure'], meta: { sensor: { unit: 'W', deviceClass: 'power', precision: 0 } } } as unknown as DeviceDescriptor
    const panel = { arrayId: 'pv', row: 0, col: 0, width: 1.13, height: 1.76, peakW: 500, maxOutputW: 480, tilt: 35 }
    const cone = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => meshes(m.object).find((x) => x.geometry instanceof ShapeGeometry)
    const tilted = marker(device({ yaw: 90, meta: { panel } }), sensor)
    // le verre penche VERS +y local (l'azimut) : tourner autour de +x le pencherait vers −y, d'où le moins
    expect(meshes(tilted.object)[0]!.rotation.x).toBeCloseTo(-(35 * Math.PI) / 180)
    tilted.setMoving(true, 0)
    // le verre regarde dans l'azimut du champ : le cône le suit, sans détour
    expect(cone(tilted)!.rotation.z).toBeCloseTo(yawToRad(90))
    // châssis négatif : le verre bascule en arrière, le cône fait demi-tour
    const back = marker(device({ yaw: 90, meta: { panel: { ...panel, tilt: -20 } } }), sensor)
    back.setMoving(true, 0)
    expect(cone(back)!.rotation.z).toBeCloseTo(yawToRad(90) + Math.PI)
    // posé à plat, un module ne regarde NULLE PART : pas de cône plutôt qu'une flèche inventée
    const flat = marker(device({ yaw: 90, meta: { panel: { ...panel, tilt: 0 } } }), sensor)
    flat.setMoving(true, 0)
    expect(cone(flat)).toBeUndefined()
  })

  it("un module se teinte de sa part de crête, et son trait de bord la chiffre", () => {
    const sensor = { id: 'p:s', pluginId: 'p', externalId: 's', kind: 'sensor', name: 'Onduleur', capabilities: ['measure'], meta: { sensor: { unit: 'W', deviceClass: 'power', precision: 0 } } } as unknown as DeviceDescriptor
    const panel = { arrayId: 'pv', row: 0, col: 0, width: 1.13, height: 1.76, peakW: 500, maxOutputW: 480, tilt: 35 }
    const glassOf = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => meshes(m.object)[0]!
    // le trait est le dernier enfant de la dalle (piste, puis jauge)
    const gaugeOf = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => glassOf(m).children[1] as Mesh
    const lit = (m: { object: { traverse(cb: (x: unknown) => void): void } }) => {
      const e = (glassOf(m).material as MeshStandardMaterial).emissive
      return e.r + e.g + e.b
    }
    const m = marker(device({ meta: { panel } }), sensor)
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 0 } as DeviceState)
    expect(lit(m)).toBe(0)                                        // au repos : bleu nuit, éteint
    expect(gaugeOf(m).visible).toBe(false)
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 250 } as DeviceState)
    const half = lit(m)
    expect(half).toBeGreaterThan(0)
    expect(gaugeOf(m).scale.y).toBeCloseTo(0.5)
    // ancré sur le bord BAS (+y local, là où le verre penche) : à mi-hauteur, son centre remonte
    expect(gaugeOf(m).position.y).toBeCloseTo((1.76 * 0.88) / 4)
    // la crête est celle du CHAMP : le même onduleur sous un module de 250 Wc est déjà à fond
    const small = marker(device({ meta: { panel: { ...panel, peakW: 250, maxOutputW: 0 } } }), sensor)
    small.update({ kind: 'sensor', updatedAt: 0, available: true, value: 250 } as DeviceState)
    expect(lit(small)).toBeGreaterThan(half)
    expect(gaugeOf(small).scale.y).toBeCloseTo(1)
    expect(gaugeOf(small).position.y).toBeCloseTo(0)
    // un onduleur muet ne vaut pas sa dernière valeur : le verre s'éteint, le trait disparaît
    m.update({ kind: 'sensor', updatedAt: 0, available: false, value: 250 } as DeviceState)
    expect(lit(m)).toBe(0)
    expect(gaugeOf(m).visible).toBe(false)
  })

  it("les deux repères de la jauge d'un module restent visibles, plafond par-dessus record", () => {
    const sensor = { id: 'p:s', pluginId: 'p', externalId: 's', kind: 'sensor', name: 'Onduleur', capabilities: ['measure'], meta: { sensor: { unit: 'W', deviceClass: 'power', precision: 0 } } } as unknown as DeviceDescriptor
    const panel = { arrayId: 'pv', row: 0, col: 0, width: 1.13, height: 1.76, peakW: 500, maxOutputW: 480, tilt: 35 }
    const h = 1.76 * 0.88
    const m = marker(device({ meta: { panel } }), sensor)
    const slab = meshes(m.object)[0]!
    const [record, output] = [slab.children[2] as Mesh, slab.children[3] as Mesh]
    // un onduleur qui ne publie pas de record : le plafond du champ est seul sur la jauge
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 300 } as DeviceState)
    expect([output.visible, record.visible]).toEqual([true, false])
    expect(output.position.y).toBeCloseTo((h / 2) * (1 - 2 * 0.96))
    expect(output.renderOrder).toBeGreaterThan(record.renderOrder)   // à valeur égale, il le cache
    // le record vient de l'appareil, et survit à son silence : la nuit ne l'efface pas
    m.update({ kind: 'sensor', updatedAt: 0, available: true, value: 300, maxValue: 431 } as DeviceState)
    expect(record.visible).toBe(true)
    expect(record.position.y).toBeCloseTo((h / 2) * (1 - 2 * (431 / 500)))
    m.update({ kind: 'sensor', updatedAt: 0, available: false, value: 300, maxValue: 431 } as DeviceState)
    expect(record.visible).toBe(true)
    // un plafond plus haut que la crête du module (un IQ8P sous un 450 Wc) ne disparaît pas :
    // c'est l'ÉCHELLE qui s'ouvre, et le repère se pose alors au bout de la jauge
    const over = marker(device({ meta: { panel: { ...panel, peakW: 450, maxOutputW: 480 } } }), sensor)
    over.update({ kind: 'sensor', updatedAt: 0, available: true, value: 200 } as DeviceState)
    const mark = meshes(over.object)[0]!.children[3] as Mesh
    expect(mark.visible).toBe(true)
    expect(mark.position.y).toBeCloseTo(-h / 2)
  })

  it("un coffret de batterie souffle sa couleur : vert en charge, bleu en décharge, rouge s'il se tait", () => {
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
    // au repos (sous le seuil des compteurs) : rien ne souffle, et la boucle n'est pas réveillée
    m.update(energy({ batteryW: 3, batterySoc: 74 }))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations.length).toBe(0)
    expect(pillOn(m)).toBe('0')
    // charge : vert. La pilule s'allume aussi — une batterie ne produit jamais rien, et « actif »
    // pour elle, c'est déplacer de l'énergie
    m.update(energy({ batteryW: 1200 }))
    expect(matOf(m).emissive.getHex()).toBe(theme.success.getHex())
    expect(animations.length).toBe(1)
    expect(pillOn(m)).toBe('1')
    // décharge : bleu, et le souffle en cours continue — seule la couleur change
    m.update(energy({ batteryW: -246 }))
    expect(matOf(m).emissive.getHex()).toBe(theme.info.getHex())
    expect(animations.length).toBe(1)
    // plus de réponse : rouge. C'est la seule panne que le contrat porte pour un `energy`
    m.update(energy({ batteryW: -246, available: false }))
    expect(matOf(m).emissive.getHex()).toBe(theme.error.getHex())

    // le souffle monte et redescend en cosinus, sans jamais s'éteindre ni saturer
    const at = (ms: number) => { animations[0]!.step(ms, 0); return matOf(m).emissiveIntensity }
    expect(at(1000)).toBeCloseTo(0.06)
    expect(at(1000 + 1300)).toBeCloseTo(0.6)
    expect(at(1000 + 2600)).toBeCloseTo(0.06)

    // retour au repos : le coffret s'éteint franchement et rend la main (le rendu est à la demande)
    m.update(energy({ batteryW: 0 }))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations[0]!.step(4000, 0)).toBe(false)

    // la passerelle de l'installation porte les mêmes chiffres, mais ce n'est pas une batterie
    const gateway = marker(device(), site)
    gateway.update(energy({ batteryW: -246 }))
    expect(matOf(gateway).emissive.getHex()).toBe(0x000000)
    expect(animations.length).toBe(0)
  })

  it('une borne de recharge souffle en vert seulement quand elle charge', () => {
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
    // branchée, pas en charge : rien ne souffle — le rendu reste à la demande
    m.update(charger('connected'))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations.length).toBe(0)
    expect(pillOn(m)).toBe('0')
    // en charge : vert, même à 0 W — Enphase n'a pas encore montré le champ des watts
    m.update(charger('charging'))
    expect(matOf(m).emissive.getHex()).toBe(theme.success.getHex())
    expect(animations.length).toBe(1)
    expect(pillOn(m)).toBe('1')
    const at = (ms: number) => { animations[0]!.step(ms, 0); return matOf(m).emissiveIntensity }
    expect(at(1000)).toBeCloseTo(0.06)
    expect(at(1000 + 1300)).toBeCloseTo(0.6)
    expect(at(1000 + 2600)).toBeCloseTo(0.06)
    // retour au repos : le coffret s'éteint et rend la main
    m.update(charger('connected'))
    expect(matOf(m).emissiveIntensity).toBe(0)
    expect(animations[0]!.step(4000, 0)).toBe(false)
    expect(pillOn(m)).toBe('0')
  })

  it("la jauge d'un coffret de batterie monte avec sa charge, sur ses deux faces", () => {
    const stored = { id: 'p:b', pluginId: 'p', externalId: 'b', kind: 'energy', name: 'Batterie', capabilities: ['storage'], meta: {} } as unknown as DeviceDescriptor
    const site = { ...stored, id: 'p:site', capabilities: ['production', 'consumption', 'grid', 'storage'] } as unknown as DeviceDescriptor
    const energy = (extra: Record<string, unknown>) =>
      ({ kind: 'energy', updatedAt: 0, available: true, productionW: 0, consumptionW: 0, gridW: 0, ...extra }) as DeviceState
    const h = 1 * 0.86                                          // le trait fait 86 % de la hauteur du coffret
    const m = marker(device(), stored)
    const box = meshes(m.object)[0]!
    // une piste et un trait PAR grande face : le coffret se lit de devant comme de derrière
    expect(box.children).toHaveLength(4)
    const [frontTrack, frontFill, , backFill] = box.children as Mesh[]
    expect(frontTrack!.position.y).toBeCloseTo(0.078)           // posé sur la tôle, 3 mm devant
    expect(backFill!.position.y).toBeCloseTo(-0.078)
    for (const f of [frontFill!, backFill!]) {
      // le trait monte vers le HAUT du coffret, quelle que soit la face qui le porte
      expect(new Vector3(0, 1, 0).applyEuler(f.rotation).z).toBeCloseTo(1)
    }
    // et chaque face regarde vers le dehors du coffret
    expect(new Vector3(0, 0, 1).applyEuler(frontFill!.rotation).y).toBeCloseTo(1)
    expect(new Vector3(0, 0, 1).applyEuler(backFill!.rotation).y).toBeCloseTo(-1)

    m.update(energy({ batterySoc: 50 }))
    for (const f of [frontFill!, backFill!]) {
      expect(f.visible).toBe(true)
      expect(f.scale.y).toBeCloseTo(0.5)
      expect(f.position.z).toBeCloseTo(-h / 4)                  // ancré sur le bord BAS : son centre descend
    }
    m.update(energy({ batterySoc: 100 }))
    expect(frontFill!.scale.y).toBeCloseTo(1)
    expect(frontFill!.position.z).toBeCloseTo(0)
    // à plat : la piste reste, le trait s'efface — un coffret vide le DIT
    m.update(energy({ batterySoc: 0 }))
    expect([frontTrack!.visible, frontFill!.visible]).toEqual([true, false])
    // muet : le dernier niveau connu tient. Une charge ne s'évapore pas avec la liaison, et le
    // souffle rouge dit déjà que le chiffre est gelé
    m.update(energy({ batterySoc: 62, available: false }))
    expect(frontFill!.visible).toBe(true)
    expect(frontFill!.scale.y).toBeCloseTo(0.62)
    // charge inconnue : rien, pas même la piste — une jauge vide se lirait comme une batterie à plat
    m.update(energy({}))
    expect([frontTrack!.visible, frontFill!.visible]).toEqual([false, false])
    // la passerelle de l'installation n'est pas un coffret : elle n'a aucune jauge à porter
    expect(meshes(marker(device(), site).object)[0]!.children).toHaveLength(0)
  })

  it('un thermostat est une pastille couchée contre son mur, tournée du yaw', () => {
    const desc = { id: 'p:t', pluginId: 'p', externalId: 't', kind: 'climate', name: 'Thermostat', capabilities: [], meta: {} } as unknown as DeviceDescriptor
    const m = marker(device({ yaw: 90 }), desc)
    const puck = meshes(m.object)[0]!
    expect(puck.geometry).toBeInstanceOf(CylinderGeometry)
    // l'axe du cylindre reste horizontal (pas de bascule en Z-up) : ses disques sont verticaux
    expect(puck.rotation.x).toBe(0)
    expect(puck.rotation.z).toBeCloseTo(Math.PI / 2)
    const params = (puck.geometry as CylinderGeometry).parameters
    expect(params.radiusTop).toBeLessThan(0.1)
  })

  /**
   * Le MÊME kind porte deux objets qui n'ont rien à voir : le thermostat ci-dessus, et le module
   * d'une pompe à chaleur. Dessiner la seconde en pastille faisait passer toute une installation de
   * chauffage pour un boîtier de salon posé dans la chaufferie.
   */
  it('une pompe à chaleur est un BLOC au sol, pas une pastille de thermostat', () => {
    const desc = {
      id: 'p:hp', pluginId: 'p', externalId: 'hp', kind: 'climate', name: 'Chauffage', capabilities: [],
      meta: { climate: { modes: ['heat'], deviceClass: 'heat_pump' } },
    } as unknown as DeviceDescriptor
    const box = meshes(marker(device({ yaw: 90 }), desc).object)[0]!
    expect(box.geometry).toBeInstanceOf(BoxGeometry)
    // 60 × 36 × 120 cm : une machine qui monte du sol, comme un coffret de batterie
    const p = (box.geometry as BoxGeometry).parameters
    expect([p.width, p.height, p.depth]).toEqual([0.6, 0.36, 1.2])
    expect(p.depth).toBeGreaterThan(1)                   // bien plus haute que large : elle se voit
    expect(box.rotation.z).toBeCloseTo(Math.PI / 2)      // elle suit son yaw, comme le reste du mobilier
  })

  it("une station de traitement d'eau est un caisson mural aux cotes du constructeur, tourné du yaw", () => {
    const desc = { id: 'p:w', pluginId: 'p', externalId: 'w', kind: 'water', name: 'Station', capabilities: [], meta: {} } as unknown as DeviceDescriptor
    const m = marker(device({ yaw: 90 }), desc)
    const box = meshes(m.object)[0]!
    // 59 × 59 × 17 cm (COMAP Proteo 2) : large et PLAT, l'épaisseur est l'axe y, celui du mur
    // (les paramètres de three sont x, y, z : `height` est l'axe y, donc l'épaisseur en repère Z-up)
    const p = (box.geometry as BoxGeometry).parameters
    expect([p.width, p.height, p.depth]).toEqual([0.59, 0.17, 0.59])
    expect(box.rotation.z).toBeCloseTo(Math.PI / 2)      // il se pose contre son mur, comme le thermostat
  })

  it("une enceinte prend la silhouette demandée : cylindre, galet, barre ou bloc orientable", () => {
    const speaker = {
      id: 'p:s', pluginId: 'p', externalId: 's', kind: 'media_player', name: 'Enceinte', capabilities: [],
      meta: { mediaPlayer: { deviceClass: 'speaker' } },
    } as unknown as DeviceDescriptor
    // défaut (champ absent) : cylindre debout, sans yaw
    const tube = meshes(marker(device({ yaw: 90 }), speaker).object)[0]!
    expect(tube.geometry).toBeInstanceOf(CylinderGeometry)
    const tubeP = (tube.geometry as CylinderGeometry).parameters
    expect([tubeP.radiusTop, tubeP.height]).toEqual([0.13, 0.32])
    expect(tube.rotation.x).toBeCloseTo(Math.PI / 2)     // axe Y → Z-up
    expect(tube.rotation.z).toBe(0)                      // un tube n'a pas de face

    // galet : cylindre court, toujours sans yaw
    const pebble = meshes(marker(device({ speakerShape: 'pebble', yaw: 90 }), speaker).object)[0]!
    expect(pebble.geometry).toBeInstanceOf(CylinderGeometry)
    const pebbleP = (pebble.geometry as CylinderGeometry).parameters
    expect([pebbleP.radiusTop, pebbleP.height]).toEqual([0.14, 0.1])
    expect(pebble.rotation.z).toBe(0)

    // barre : boîte allongée, yaw appliqué
    const bar = meshes(marker(device({ speakerShape: 'bar', yaw: 90 }), speaker).object)[0]!
    expect(bar.geometry).toBeInstanceOf(BoxGeometry)
    const barP = (bar.geometry as BoxGeometry).parameters
    expect([barP.width, barP.height, barP.depth]).toEqual([0.55, 0.08, 0.07])
    expect(bar.rotation.z).toBeCloseTo(Math.PI / 2)

    // bloc-réveil : petit rectangle, yaw appliqué (face avant)
    const block = meshes(marker(device({ speakerShape: 'block', yaw: 90 }), speaker).object)[0]!
    expect(block.geometry).toBeInstanceOf(BoxGeometry)
    const blockP = (block.geometry as BoxGeometry).parameters
    expect([blockP.width, blockP.height, blockP.depth]).toEqual([0.14, 0.08, 0.1])
    expect(block.rotation.z).toBeCloseTo(Math.PI / 2)
  })

  it("une mangeoire ou une fontaine est une tour un peu plus haute que large, pas une boule", () => {
    for (const kind of ['pet_feeder', 'pet_fountain'] as const) {
      const desc = {
        id: `p:${kind}`, pluginId: 'p', externalId: kind, kind, name: kind, capabilities: [], meta: {},
      } as unknown as DeviceDescriptor
      const box = meshes(marker(device(), desc).object)[0]!
      expect(box.geometry).toBeInstanceOf(BoxGeometry)
      const p = (box.geometry as BoxGeometry).parameters
      expect([p.width, p.height, p.depth]).toEqual([0.12, 0.12, 0.2])
      expect(p.depth).toBeGreaterThan(p.width)            // plus haute que large (Z-up)
      expect(box.position.z).toBeCloseTo(0.1)             // posée au sol, pas à moitié enterrée
    }
  })
})

describe('tap sur un mur', () => {
  // Le rayon traversait les murs : un tap sur la cloison de la chambre1 tombait sur le sol de la
  // chambre2, derrière elle. Étage : chambre1 x∈[0 ; 4,9], cloison, chambre2 x∈[5,1 ; 10].
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

  it('la face vue d’une cloison donne la pièce de devant, pas celle de derrière', () => {
    aim([2, 2.5, 4.8], [5, 2.5, 4])
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
    aim([8, 2.5, 4.8], [5, 2.5, 4])
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre2' })
  })

  it('une façade vue du jardin donne la pièce qu’elle ferme', () => {
    aim([1, -6, 4.3], [1, 3, 4.1])            // x = 1 : à côté de la fenêtre de la chambre1
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
  })
})

describe('tap sur le toit', () => {
  // Le toit est déclaré comme un NIVEAU (il porte panneaux et caméra) mais n'a ni pièce ni sol :
  // sans lui, le rayon traversait jusqu'à la pièce cachée dessous et le toit disparaissait.
  const scene = new HouseScene(document.createElement('canvas'), { headless: true })
  scene.load(parseHouse(demo))
  scene.resize(600, 600)
  // au-dessus de la chambre1 (2,5 ; 2,5), regard presque vertical
  const lookDown = () => {
    scene.camera.position.set(2.5, 40, -2.4)
    scene.camera.lookAt(2.5, 5, -2.5)
    scene.camera.updateMatrixWorld(true)
    scene.scene.updateMatrixWorld(true)   // sans rendu (headless), les matrices monde ne sont pas à jour
  }

  it('emmène au niveau que le toit porte', () => {
    lookDown()
    scene.focusLevel(null)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'level', levelId: 'toit' })
  })

  it('laisse toucher la pièce quand le toit est masqué', () => {
    lookDown()
    scene.focusLevel('etage')
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
  })
})

/**
 * Une porte de garage LIÉE à son ouverture : c'est l'appareil qui porte le panneau, à ses cotes et à
 * ses couleurs. Le bâti cesse d'en dessiner un — sinon la porte remontée laisse un vantail fixe
 * derrière elle.
 */
describe('ouverture habillée par un ouvrant', () => {
  /** La maison de démo, dont la porte de la terrasse devient un garage que le volet de la cuisine ferme. */
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

  it("laisse son panneau à l'appareil, même quand le descripteur arrive après la maison", () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(garaged())
    // le KIND vient du descripteur : tant qu'il manque, le bâti dessine son vantail comme avant
    const before = leafTriangles(scene)
    expect(before).toBeGreaterThan(0)
    scene.setDescriptors({ 'mock:cover-kitchen': shutter })
    expect(leafTriangles(scene)).toBeLessThan(before)
    // et le volet, lui, est bien là : c'est lui qu'on voit maintenant dans la baie
    expect(meshesOf(scene.markers.get('cover.cuisine')!.object).length).toBeGreaterThan(0)
  })
})

/**
 * Un ouvrant lié à une ouverture n'occupe pas un point : il HABILLE une baie. Son tablier y était
 * déjà dessiné, mais sa pilule restait sur la `position` du JSON — posée une fois par l'auto-placement,
 * puis figée pendant qu'on affinait la baie au doigt.
 */
describe('ouvrant lié à une ouverture', () => {
  it('épouse le rectangle de sa baie, pilule comprise', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    const marker = scene.markers.get('cover.baie')!
    // la baie du salon : mur y = 0 à partir de x = 3,2 ; à 1,5 m du coin, large de 2,4 → centre 5,9
    expect(marker.object.position.x).toBeCloseTo(5.9)
    // la `position` du JSON, elle, est restée à 4,2 : 1,7 m à côté de ce qui est dessiné
    const written = demo.devices.find((d) => d.id === 'cover.baie')!.position as [number, number, number]
    expect(written[0]).toBeCloseTo(4.2)
    // et en hauteur : le milieu de la baie (allège 0,2 + 2,15 / 2), non le 1,3 du fichier
    expect(marker.object.position.z).toBeCloseTo(0.2 + 2.15 / 2)
    // le tablier, lui, n'a pas bougé d'un pouce : il était déjà sur la baie
    const slat = meshesOf(marker.object)[0]!
    expect(marker.object.position.x + slat.position.x).toBeCloseTo(5.9)
  })
})

/**
 * Une voiture n'a pas de place écrite dans la maison : c'est son GPS qui la pose, corrigé du
 * décalage que l'utilisateur a mesuré à l'œil, et orientée par ce qu'on sait d'elle.
 */
describe('véhicule placé par son GPS', () => {
  const VEHICLE = 'mock:vehicle-r5'
  const descriptor = {
    id: VEHICLE, pluginId: 'mock', externalId: 'r5', kind: 'vehicle', name: 'R5',
    capabilities: ['soc', 'range', 'location'], meta: {},
  } as DeviceDescriptor

  /** La maison de démo, mais la R5 n'y est plus PLACÉE : son GPS fait foi. */
  function unplaced(gpsOffset?: [number, number], yawOffset?: number) {
    const doc = JSON.parse(JSON.stringify(demo)) as typeof demo
    const car = doc.devices.find((d) => d.deviceId === VEHICLE) as Record<string, unknown>
    delete car.position; delete car.yaw; delete car.zoneId
    if (gpsOffset) car.gpsOffset = gpsOffset
    if (yawOffset !== undefined) car.yawOffset = yawOffset
    return parseHouse(doc)
  }

  /** L'état du véhicule, posé au point LOCAL demandé (le GPS est calculé à l'envers). */
  const stateAt = (house: ReturnType<typeof parseHouse>, xy: [number, number], headingDeg?: number): DeviceState => {
    const g = localToGeo(house.origin, [xy[0], xy[1], 0])
    return {
      kind: 'vehicle', updatedAt: 1, available: true, soc: 55, rangeKm: 200, pluggedIn: false, charging: false,
      location: { lat: g.lat, lon: g.lon, at: 1 }, ...(headingDeg === undefined ? {} : { headingDeg }),
    } as DeviceState
  }

  /** Le corps de la voiture tourne dans son propre groupe : c'est LUI qui porte l'orientation. */
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

  it('se pose à son relevé, décalé de la correction du JSON', () => {
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

  it('suit le cap du fabricant quand il le donne, ramené dans le repère de la maison', () => {
    const house = unplaced()                       // demo : origin.heading = 15
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [-3.5, -6], 90) })
    expect(bodyYaw(scene)).toBeCloseTo(yawToRad(15 - 90), 4)
  })

  it('sans cap, prend l’axe de la pièce qui l’entoure — le garage range la voiture dans son sens', () => {
    const house = unplaced()
    const scene = sceneWith(house)
    // (6 ; 2) tombe dans le salon (rdc, allongé selon x) ET dans la chambre 2 (étage) : le bas gagne
    scene.updateStates({ [VEHICLE]: stateAt(house, [6, 2]) })
    expect(Math.abs(bodyYaw(scene))).toBeCloseTo(Math.PI / 2, 4)
    // dehors, rien à quoi s'aligner : le marqueur garde son défaut
    scene.updateStates({ [VEHICLE]: stateAt(house, [-3.5, -6]) })
    expect(bodyYaw(scene)).toBe(0)
  })

  /**
   * Ni un cap mesuré ni l'axe d'un garage ne disent de quel côté la voiture s'est garée : la
   * correction du JSON s'AJOUTE au cap déduit, elle ne le remplace pas.
   */
  it('ajoute la correction du JSON au cap déduit, quelle qu en soit la source', () => {
    const plain = unplaced()
    const turned = unplaced(undefined, 30)
    const base = sceneWith(plain)
    const corrected = sceneWith(turned)
    for (const xy of [[-3.5, -6], [6, 2]] as [number, number][]) {                    // dehors (rien) puis dans le salon (axe)
      for (const heading of [undefined, 90]) {                           // sans cap, puis avec le cap du fabricant
        base.updateStates({ [VEHICLE]: stateAt(plain, xy, heading) })
        corrected.updateStates({ [VEHICLE]: stateAt(turned, xy, heading) })
        expect(bodyYaw(corrected) - bodyYaw(base)).toBeCloseTo(yawToRad(30), 4)
      }
    }
  })
})

/**
 * Le relevé d'un véhicule est bon à quelques mètres près : assez pour dire « il est rentré », pas
 * pour le poser dans son garage. Une PLACE de stationnement le range exactement, quand il est au
 * repos à côté d'elle — et lui donne son sens, que ni son GPS ni un garage ne disent.
 */
describe('places de stationnement', () => {
  const VEHICLE = 'mock:vehicle-r5'
  const descriptor = {
    id: VEHICLE, pluginId: 'mock', externalId: 'r5', kind: 'vehicle', name: 'R5',
    capabilities: ['soc', 'range', 'location'], meta: {},
  } as DeviceDescriptor

  /** La maison de démo, R5 dé-placée (son GPS fait foi), avec les places données. */
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

  it('range la voiture au repos sur la place proche, et lui donne le cap de la place', () => {
    const house = withParkings([BAY])
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [-2, -7]) })       // à 1,5 m du centre : dans la place
    const marker = scene.markers.get('vehicle.r5')!
    expect(marker.object.position.x).toBeCloseTo(-3.5, 2)
    expect(marker.object.position.y).toBeCloseTo(-6, 2)
    expect(bodyYaw(scene)).toBeCloseTo(yawToRad(40), 4)
  })

  it('laisse où elle est la voiture trop loin, et celle qui ROULE', () => {
    const house = withParkings([BAY])
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [6, 2]) })         // sur le terrain, loin de la place
    expect(scene.markers.get('vehicle.r5')!.object.position.x).toBeCloseTo(6, 2)
    // au même point qu'au test précédent, mais en mouvement : le relevé reprend la main
    scene.updateStates({ [VEHICLE]: stateAt(house, [-2, -7], { speedKmh: 30, gear: 'D' }) })
    expect(scene.markers.get('vehicle.r5')!.object.position.x).toBeCloseTo(-2, 2)
  })

  it('dessine le marquage au sol, en édition comme hors édition', () => {
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
   * La place ne suit pas le geste sans que rien ne bouge d'autre : `updateParkings` est le chemin
   * court (pas de `load`, donc pas de caméra recentrée) et il refait la place de la voiture.
   */
  it('la voiture suit la place qu on déplace', () => {
    const house = withParkings([BAY])
    const scene = sceneWith(house)
    scene.updateStates({ [VEHICLE]: stateAt(house, [-2, -7]) })
    scene.updateParkings(withParkings([{ ...BAY, center: [-1, -8] }]))
    const marker = scene.markers.get('vehicle.r5')!
    expect(marker.object.position.x).toBeCloseTo(-1, 2)
    expect(marker.object.position.y).toBeCloseTo(-8, 2)
  })

  /**
   * Une place sous le 1er étage : vue « etage », la voiture ne perce ni en pilule ni au tap — le
   * plancher de la chambre gagne contre le mesh du garage.
   */
  it('sous un étage focalisé, la voiture garée ne se voit ni ne se touche', () => {
    const bay = { id: 'park.sous-ch1', accepts: 'vehicle', center: [2, 2], size: [2.5, 5], yaw: 0, levelId: 'rdc' }
    const house = withParkings([bay])
    const scene = sceneWith(house)
    scene.resize(600, 600)
    scene.updateStates({ [VEHICLE]: stateAt(house, [2, 2]) })
    const marker = scene.markers.get('vehicle.r5')!
    // parentée au niveau de la place, pas au jardin
    expect(marker.object.parent?.name).toBe('markers')
    scene.focusLevel('etage')
    expect(marker.visibleInScene).toBe(false)
    // regard vertical sur la chambre 1 (2,5 ; 2,5) — le sol d'étage est devant la voiture
    scene.camera.position.set(2.5, 40, -2.4)
    scene.camera.lookAt(2.5, 5, -2.5)
    scene.camera.updateMatrixWorld(true)
    scene.scene.updateMatrixWorld(true)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'room', roomId: 'chambre1' })
  })
})

/**
 * Une tondeuse Husqvarna publie sa position en GPS, pas dans le repère de la maison : elle se pose
 * comme une voiture (projetée sur le terrain), mais son marqueur SUIT ensuite chaque relevé sans
 * être reconstruit — en tonte, il en arrive toutes les quelques secondes.
 */
/**
 * Les incidents du journal d'un robot se posent sur le terrain quand le panneau les montre : une
 * épingle par point DANS le terrain, rien pour un point au large, et tout s'en va avec `null`.
 */
describe('incidents du journal posés sur le terrain', () => {
  const MOWER = 'automower:c7233734'
  const house = parseHouse(demo)
  const geo = (xy: [number, number]) => { const g = localToGeo(house.origin, [xy[0], xy[1], 0]); return { lat: g.lat, lon: g.lon } }

  it('une épingle par point du terrain, pas pour un point au large ; `null` retire tout ; le cadrage ne plante pas', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    const pins = () => (scene as unknown as { journal: { group: { children: unknown[] } } | null }).journal?.group.children.length ?? 0
    scene.setJournalPoints(MOWER, [
      { at: 1, ...geo([12, 16]), severity: 'error' },
      { at: 2, ...geo([14, 17]), severity: 'fatal' },
      { at: 3, ...geo([900, 900]), severity: 'warning' },
    ])
    expect(pins()).toBe(2)
    // l'épingle active grossit et montre son étiquette ; les autres non ; `null` éteint tout
    const journal = () => (scene as unknown as { journal: { points: { at: number; head: { scale: { x: number } }; label: { visible: boolean } | null }[] } }).journal
    scene.focusJournalPoint(2, false)
    expect(journal().points.find((p) => p.at === 2)!.head.scale.x).toBeCloseTo(1.6)
    expect(journal().points.find((p) => p.at === 2)!.label?.visible).toBe(true)
    expect(journal().points.find((p) => p.at === 1)!.head.scale.x).toBe(1)
    expect(journal().points.find((p) => p.at === 1)!.label?.visible).toBe(false)
    scene.setActiveJournalPoint(null)
    expect(journal().points.find((p) => p.at === 2)!.label?.visible).toBe(false)
    scene.focusJournalPoint(999, false)
    // le rendu 2D pose les étiquettes dans le DOM : refermer le journal doit les en retirer
    const el = journal().points[0]!.label as unknown as { element: HTMLElement } | null
    if (el) document.body.appendChild(el.element)
    scene.setJournalPoints(null, [])
    expect(pins()).toBe(0)
    expect(el?.element.isConnected ?? false).toBe(false)
    scene.dispose()
  })
})

describe('tondeuse placée par son GPS', () => {
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

  it('non déclarée dans la maison, elle apparaît à son relevé ; un relevé suivant ne la reconstruit pas ; hors terrain, elle disparaît', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setDescriptors({ [MOWER]: descriptor })
    expect(scene.markers.get(MOWER)).toBeUndefined()
    scene.updateStates({ [MOWER]: stateAt([12, 16]) })
    const marker = scene.markers.get(MOWER)!
    expect(marker).toBeDefined()
    expect(marker.object.position.x).toBeCloseTo(12, 2)
    expect(marker.object.position.y).toBeCloseTo(16, 2)
    // un pas de plus dans le jardin : même marqueur, il suivra par animation
    scene.updateStates({ [MOWER]: stateAt([14, 17]) })
    expect(scene.markers.get(MOWER)).toBe(marker)
    // emportée hors du terrain (au bureau…) : plus rien à dessiner
    scene.updateStates({ [MOWER]: stateAt([900, 900]) })
    expect(scene.markers.get(MOWER)).toBeUndefined()
    scene.dispose()
  })
})

describe('une lampe n’éclaire que son niveau (une seule passe)', () => {
  const compile = (mat: Material) => {
    const lit = mat.type !== 'MeshBasicMaterial'
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: lit ? '#include <lights_pars_begin>\n#include <lights_fragment_begin>' : '#include <common>' }
    mat.onBeforeCompile(shader as never, null as never)
    return shader
  }

  /**
   * La scène se rendait en passes — une par niveau allumé — pour qu'une lampe du salon n'éclaire pas
   * le sas d'en dessous à travers la dalle. Mesuré le 2026-09-24 : 14 ms de CPU par image perdus à
   * réévaluer les programmes. Le masque est désormais dans la boucle des lumières de CHAQUE matière
   * éclairée, par le prototype : une matière créée à la volée par un marqueur le reçoit aussi.
   */
  it('toute matière éclairée reçoit le masque de hauteur, pas une matière non éclairée', () => {
    const lit = compile(new MeshStandardMaterial())
    expect(lit.fragmentShader).toContain('kasbahLampReaches( pointLight.position, geometryPosition )')
    expect(lit.fragmentShader).toContain('UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS')   // le jardin passe
    expect(lit.fragmentShader).toContain('if ( directLight.visible ) RE_Direct')              // masquée : rien à calculer
    expect(lit.uniforms.kasbahLevelY).toBe(levelLightUniforms.kasbahLevelY)                   // partagé, pas copié
    expect(lit.uniforms.kasbahLamps!.value).toBe(1)
    const basic = compile(new MeshBasicMaterial())
    expect(basic.fragmentShader).not.toContain('kasbah')
  })

  it('le terrain, les zones, le toit et l’eau ne reçoivent aucune lampe d’intérieur ; les murs, si', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    for (const m of [mats.terrain, mats.roof, mats.roofFlat, ...Object.values(mats.zones)]) expect(compile(m).uniforms.kasbahLamps!.value).toBe(0)
    for (const m of [mats.wall, mats.wallInterior, mats.floor, mats.device]) expect(compile(m).uniforms.kasbahLamps!.value).toBe(1)
  })

  it('les tranches sont les élévations des niveaux, sans la plus basse', () => {
    setLevelHeights([2.85, 0, 5.45])
    expect([...levelLightUniforms.kasbahLevelY.value.slice(0, 2)].map((v) => +v.toFixed(2))).toEqual([2.85, 5.45])
    expect(levelLightUniforms.kasbahLevelCount.value).toBe(2)
    setLevelHeights([0])
    expect(levelLightUniforms.kasbahLevelCount.value).toBe(0)
  })

  /**
   * Masquer l'étage retire son plancher de la carte d'ombre — à condition de la refaire. Sans
   * relevé, l'étage caché continuait d'assombrir le rez-de-chaussée qu'on explorait.
   */
  it('focaliser un niveau redemande un relevé des ombres', () => {
    let t = 1000
    const scene = new HouseScene(document.createElement('canvas'), { headless: true, now: () => t })
    const house = parseHouse(demo)
    scene.load(house)
    t = 1_000_000
    const dirty = () => (scene as unknown as { shadowsDirtyUntil: number }).shadowsDirtyUntil
    expect(dirty()).toBeLessThan(t)
    scene.focusLevel(house.levels[0]!.id)
    expect(dirty()).toBeGreaterThan(t)
    // …et ce relevé survit à une attente sans image (voile de chargement, shaders en compilation) :
    // la fenêtre en temps expire, les prochaines images dessinées le refont quand même
    t += 60_000
    expect(dirty()).toBeLessThan(t)
    expect((scene as unknown as { shadowFramesPending: number }).shadowFramesPending).toBeGreaterThan(0)
    scene.dispose()
  })

  /**
   * Three compile un programme par NOMBRE de lumières. Masquer un étage retirait ses lampes : la
   * première visite du rez-de-chaussée recompilait toutes les matières, 2,2 s d'image figée sur
   * l'iGPU. Des lampes éteintes tiennent la place des lampes masquées.
   */
  it('un étage masqué s’envole puis disparaît, et redescend se poser', () => {
    let t = 0
    const scene = new HouseScene(document.createElement('canvas'), { headless: true, now: () => t, requestFrame: () => 0, cancelFrame: () => {} })
    const house = parseHouse(demo)
    scene.load(house)
    // un renderer « présent » : c'est lui qui autorise l'animation ; la boucle, elle, ne dessine jamais
    ;(scene as unknown as { renderer: object }).renderer = {}
    const lifts = (scene as unknown as { lifts: Map<string, { tween: { step(now: number): boolean } | null }> }).lifts
    const [low, high] = [...house.levels].sort((a, b) => a.elevation - b.elevation)
    const group = scene.nodesOf(high!.id)!.group
    scene.focusLevel(low!.id)
    expect(group.visible).toBe(true)                                    // il part, il n'a pas disparu
    lifts.get(`level:${high!.id}`)!.tween!.step(t = 200)
    expect(group.position.z).toBeGreaterThan(high!.elevation)
    expect(group.position.z).toBeLessThan(high!.elevation + 8)
    // il s'efface en montant, au-dessus du haut du rez-de-chaussée — qui, lui, reste entier
    const fade = levelFadeUniforms.kasbahFadeVisibility.value
    expect(fade).toBeGreaterThan(0)
    expect(fade).toBeLessThan(1)
    // juste AU-DESSUS du dessus de ses murs : posé pile dessus, ces faces scintillaient
    expect(levelFadeUniforms.kasbahFadeY.value).toBeCloseTo(low!.elevation + scene.nodesOf(low!.id)!.height + 0.03, 6)
    for (const key of lifts.keys()) lifts.get(key)!.tween?.step(t = 500)
    expect(group.visible).toBe(false)
    expect(levelFadeUniforms.kasbahFadeVisibility.value).toBe(1)        // plus rien en vol : le fondu est levé
    scene.focusLevel(low!.id)                                           // même focus : rien ne repart
    expect(lifts.get(`level:${high!.id}`)!.tween).toBeNull()
    scene.focusLevel(null)
    expect(group.visible).toBe(true)
    for (const key of lifts.keys()) lifts.get(key)!.tween?.step(t = 1100)
    expect(group.position.z).toBeCloseTo(high!.elevation, 6)            // reposé exactement à sa place
    expect(group.visible).toBe(true)
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })

  it('les pilules d’un niveau apparaissent et s’effacent en fondu, au lieu de surgir', () => {
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
    scene.focusLevel(low!.id)                                           // vue d'ensemble → rez-de-chaussée
    expect(pill(lows[0]!).visible).toBe(true)
    expect(pill(lows[0]!).element.style.opacity).toBe('0.00')           // elles partent de rien…
    tween()!.step(t = 100)
    expect(pill(lows[0]!).element.style.opacity).toBe('0.00')           // …attendent que l'étage se dégage…
    tween()!.step(t = 450)
    expect(Number(pill(lows[0]!).element.style.opacity)).toBeGreaterThan(0.2)
    tween()!.step(t = 800)
    expect(pill(lows[0]!).element.style.opacity).toBe('')               // …et finissent pleines, sans style
    scene.focusLevel(high!.id)                                          // rez-de-chaussée → étage
    tween()!.step(t = 1025)
    expect(pill(lows[0]!).visible).toBe(true)                           // elle s'estompe, elle n'a pas disparu
    expect(Number(pill(lows[0]!).element.style.opacity)).toBeLessThan(0.8)
    tween()!.step(t = 1250)
    expect(Number(pill(highs[0]!).element.style.opacity)).toBeGreaterThan(0.2)
    tween()!.step(t = 1600)
    expect(pill(lows[0]!).visible).toBe(false)
    expect(pill(highs[0]!).element.style.opacity).toBe('')
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })

  it('le nombre de lumières ponctuelles ne change pas quand on focalise un niveau', () => {
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
    expect((scene as unknown as { lampPadding: { children: unknown[] } }).lampPadding.children.length).toBeGreaterThan(0)   // l'étage masqué avait des lampes
    expect(lights()).toBe(all)
    scene.focusLevel(null)
    expect(lights()).toBe(all)
    scene.dispose()
  })
})

describe('préparer la maison avant de la montrer', () => {
  /**
   * Le voile de chargement suit ces étapes et ne part qu'au `null` final : une préparation qui ne
   * finirait pas laisserait la maison cachée. Sans renderer (tests), elle s'arrête après les matières.
   */
  it('publie ses étapes et finit toujours par « prête »', async () => {
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
   * Un style jamais vu (ou quitté : three jette les programmes que plus rien n'utilise) demande de
   * nouveaux shaders. Compilés par la première image, ils figeaient TOUT le fil principal — 2,5 à
   * 5,5 s sur l'iGPU pour « réaliste », sélection du style comprise, qui ne se peignait qu'après.
   */
  it('un changement de style compile ses shaders sans dessiner, puis redessine', async () => {
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
    ;(scene as unknown as { applySky(): void }).applySky = () => {}   // le ciel veut un vrai renderer (PMREM)
    const holding = () => (scene as unknown as { compiling: boolean }).compiling
    scene.setAppearance({ style: styleById('realistic') })
    expect(compiled).toBe(1)
    expect(holding()).toBe(true)                       // l'ancienne image reste, le fil principal est libre
    ready = true
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(holding()).toBe(false)
    ;(scene as unknown as { renderer: null }).renderer = null
    scene.dispose()
  })
})

describe('régler les ouvertures', () => {
  const house = parseHouse(demo)
  const openingCount = computeHouseGeometry(house).levels.reduce((n, l) => n + l.openings.length, 0)
  const handles = (scene: HouseScene) => {
    let n = 0
    scene.scene.traverse((o) => { if (o.name.startsWith('opening:')) n++ })
    return n
  }

  /**
   * Les poignées vivent et meurent avec le mode : hors édition, la scène doit être exactement celle
   * d'avant, au triangle près.
   */
  it('pose une poignée par ouverture et ne laisse rien en sortant', () => {
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
   * Poignées, cotes et repère sont des décors de NIVEAU : `DECOR_LAYER` (hors du relevé d'occlusion,
   * ouverte au lancer de rayon), dans le groupe des MARQUEURS du niveau (masqués avec lui).
   */
  it('range poignées et cotes dans les décors de leur niveau', () => {
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
    expect(decors).toHaveLength(openingCount + 2)          // les poignées, le tracé, le repère d'origine
    expect(decors.filter((d) => !d.inMarkers)).toEqual([])
    expect(decors.filter((d) => !d.layer)).toEqual([])
    scene.dispose()
  })

  /**
   * PIÈGE À MÉMORISER. La `Scene` tourne avec `matrixWorldAutoUpdate = false` (une seule mise à jour
   * par image, `render()`). Un objet neuf garde donc une matrice monde à l'IDENTITÉ jusqu'à la
   * prochaine image : le lancer de rayon le teste à l'origine du monde, et un tap sur une poignée
   * traversait jusqu'au sol de la pièce. Onze poignées sur onze étaient périmées, jusqu'à douze
   * mètres d'écart. Ce qui doit être touchable doit entrer dans le monde avec sa matrice.
   */
  it('entre dans le monde avec une matrice juste, sans attendre une image', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.setEditingOpenings(true)
    const groups: Object3D[] = []
    scene.scene.traverse((o) => { if (o.name.startsWith('opening:')) groups.push(o) })
    expect(groups).toHaveLength(openingCount)
    const posOf = (o: Object3D) => new Vector3().setFromMatrixPosition(o.matrixWorld)
    const asBuilt = groups.map((g) => [posOf(g), ...g.children.map(posOf)])
    scene.scene.updateMatrixWorld(true)          // ce que la première image aurait fait
    groups.forEach((g, i) => {
      const after = [posOf(g), ...g.children.map(posOf)]
      after.forEach((p, k) => expect(p.distanceTo(asBuilt[i]![k]!)).toBeLessThan(1e-9))
      expect(after[0]!.length()).toBeGreaterThan(0.2)   // et ce n'est pas l'origine du monde
    })
    scene.dispose()
  })

  /** Le bout du chemin : un tap sur une poignée est vu comme tel, et pas comme un tap sur le sol. */
  it('se laisse piquer là où elle est dessinée', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.resize(1200, 800)
    scene.setEditingOpenings(true)
    let handle: Object3D | null = null
    scene.scene.traverse((o) => { if (!handle && o.name === 'opening:baie') handle = o })
    const target = new Vector3().setFromMatrixPosition(handle!.matrixWorld)
    // `focusOpening` pose la caméra, mais en headless il n'y a pas d'`OrbitControls` pour l'ORIENTER
    // (c'est `controls.update()` qui le fait) : on la fait regarder la poignée nous-mêmes, et le
    // centre de l'image est alors exactement sur elle.
    scene.focusOpening('baie', false)
    scene.camera.lookAt(target)
    scene.camera.updateMatrixWorld(true)
    expect(scene.pick({ x: 0, y: 0 })).toEqual({ kind: 'opening', openingId: 'baie' })
    scene.dispose()
  })

  /**
   * Trois états à distinguer : rien, une ouverture, celle qu'on règle. TOUTES portent un cadre fin —
   * sans lui, les autres ouvertures devenaient introuvables (retour de l'utilisateur) —, et une seule
   * porte le cadre ÉPAIS. Ce qui s'éteint est un MATÉRIAU, jamais l'objet : `Object3D.visible` dit
   * « mon niveau est masqué », et c'est lui qui décide si une poignée est touchable.
   */
  it('cerne toutes les ouvertures d’un trait fin, une seule d’un trait épais, et garde les deux touchables', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    scene.resize(1200, 800)
    scene.setEditingOpenings(true)
    /** Pour chaque poignée : [cadre fin dessiné ?, cadre épais dessiné ?]. */
    const rings = () => {
      const drawn: [boolean, boolean][] = []
      scene.scene.traverse((o) => {
        if (!o.name.startsWith('opening:')) return
        const [, thin, bold] = o.children as Mesh[]
        drawn.push([(thin!.material as MeshBasicMaterial).visible, (bold!.material as MeshBasicMaterial).visible])
      })
      return drawn
    }
    expect(rings().filter(([thin]) => thin)).toHaveLength(openingCount)   // toutes cernées, finement
    expect(rings().filter(([, bold]) => bold)).toHaveLength(0)            // aucune n'est « celle-ci »
    scene.setSelectedOpening('fen-ch1')
    expect(rings().filter(([, bold]) => bold)).toHaveLength(1)
    expect(rings().filter(([thin]) => thin)).toHaveLength(openingCount - 1)
    // le cadre épais est le SEUL à traverser les murs ; le fin reste soumis à la profondeur, sinon
    // dix-neuf cadres transparaissent à travers le toit
    const matOf = (id: string, child: number) => {
      let found: MeshBasicMaterial | null = null
      scene.scene.traverse((o) => { if (o.name === `opening:${id}`) found = (o.children[child] as Mesh).material as MeshBasicMaterial })
      return found!
    }
    expect(matOf('baie', 1).depthTest).toBe(true)          // le cadre fin d'une poignée au repos
    expect(matOf('fen-ch1', 2).depthTest).toBe(false)      // le cadre épais de la sélectionnée
    // la poignée NON sélectionnée est toujours visible en tant qu'objet (donc toujours piquable)
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
   * Le repère d'origine : le (0, 0, 0) du fichier, ses deux axes et le nord vrai. Il naît et meurt
   * avec le mode édition, et il est posé à l'origine du REPÈRE — pas au centre du bâti.
   */
  it('pose un repère à l’origine du fichier, en mode édition seulement', () => {
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
    // deux axes et le nord : trois bras, plus l'anneau
    const bars = group.children.filter((o) => o instanceof Mesh)
    expect(bars).toHaveLength(4)
    // le nord suit le cap de +y : à cap 0, il est confondu avec l'axe des y
    const letters: string[] = []
    group.traverse((o) => { const el = (o as unknown as { element?: HTMLElement }).element; if (el) letters.push(el.textContent ?? '') })
    expect(letters.sort()).toEqual(['N', 'x', 'y'])
    scene.setEditingOpenings(false)
    expect(mark()).toBeNull()
    scene.dispose()
  })

  /**
   * Le chemin du temps réel : `rooms` porte `openings[]`, donc régler une fenêtre passait par un
   * `load()` complet — toute la maison reconstruite ET la caméra recentrée, à chaque mouvement de
   * doigt. Ici : les maillages du seul niveau touché, et les seuls marqueurs qui épousent une
   * ouverture qui a bougé (un volet taille sa lame sur le rectangle de sa fenêtre).
   */
  it('ne refait que le niveau touché : caméra, marqueurs et poignées survivent', () => {
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
    // seul l'ouvrant de CETTE ouverture est refait ; les autres marqueurs sont les mêmes objets
    const rebuilt = [...scene.markers].filter(([k, m]) => was.markers.get(k) !== m.object.uuid).map(([k]) => k)
    expect(rebuilt).toEqual(bound ? [bound.id] : [])
    expect(scene.markers.size).toBe(was.markers.size)
    scene.dispose()
  })
})

describe('natures d’ouverture vitrées et posées au sol', () => {
  /** La maison de démo, dont la grande fenêtre du salon devient une BAIE et la porte de la terrasse une PORTE VITRÉE. */
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

  it('vitre une baie et une porte vitrée, jamais une porte pleine ni un passage', () => {
    const before = buildLevel(rdcOf(parseHouse(demo)), mats())
    const after = buildLevel(rdcOf(retyped()), mats())
    const glazed = (nodes: typeof after) => new Set(nodes.panes.map((p) => p.userData.openingId as string))
    // la baie était déjà une fenêtre : elle garde son vitrage ; la porte de terrasse en gagne un
    expect(glazed(before).has('baie')).toBe(true)
    expect(glazed(before).has('porte-terrasse')).toBe(false)
    expect(glazed(after).has('baie')).toBe(true)
    expect(glazed(after).has('porte-terrasse')).toBe(true)
    // les portes pleines et les passages n'ont toujours rien de vitré
    expect(glazed(after).has('porte-entree')).toBe(false)
    expect(glazed(after).has('porte-salon')).toBe(false)
  })

  /**
   * Une porte VITRÉE n'a pas de vantail plein : ce serait cacher ce qui la définit. Son battant est
   * un cadre autour du verre, donc il pèse sur le maillage des menuiseries, pas sur celui des portes.
   */
  it('remplace le vantail plein d’une porte vitrée par un cadre de battant', () => {
    const mesh = (nodes: ReturnType<typeof buildLevel>, name: string) => nodes.walls.find((m) => m.name === name)
    const before = buildLevel(rdcOf(parseHouse(demo)), mats())
    const after = buildLevel(rdcOf(retyped()), mats())
    const doorsBefore = countTriangles(mesh(before, 'details:doors')!)
    const doorsAfter = countTriangles(mesh(after, 'details:doors')!)
    expect(doorsAfter).toBeLessThan(doorsBefore)          // un tablier de moins
    expect(countTriangles(mesh(after, 'details:frames')!)).toBeGreaterThan(countTriangles(mesh(before, 'details:frames')!))
  })

  /**
   * Une baie descend au sol : pas d'appui de fenêtre qui déborde de la façade (il pendrait dans le
   * vide), mais un rail bas et un refend par vantail — trois mètres de verre d'un seul tenant ne
   * ressemblent à rien.
   */
  it('retire l’appui d’une baie et lui donne ses refends', () => {
    const only = (house: ReturnType<typeof parseHouse>, id: string) => {
      const level = rdcOf(house)
      return buildLevel({ ...level, openings: level.openings.filter((o) => o.openingId === id), walls: [] }, mats())
    }
    const asWindow = only(parseHouse(demo), 'baie')
    const asBay = only(retyped(), 'baie')
    // sans murs, il ne reste dans les lisses que l'appui : une baie n'en a aucun
    expect(asWindow.walls.some((m) => m.name === 'details:trim')).toBe(true)
    expect(asBay.walls.some((m) => m.name === 'details:trim')).toBe(false)
    // et elle porte un montant de plus que la fenêtre qu'elle remplace (2,4 m → deux vantaux)
    const frames = (n: typeof asBay) => countTriangles(n.walls.find((m) => m.name === 'details:frames')!)
    expect(frames(asBay)).toBeGreaterThan(frames(asWindow))
  })
})

describe('cotes et nom de l’ouverture réglée', () => {
  const notes = (scene: HouseScene) => {
    const found: { kind: string; text: string; position: [number, number, number] }[] = []
    scene.scene.traverse((o) => {
      const el = (o as unknown as { element?: HTMLElement }).element
      // les lettres d'axe du repère d'origine portent la même classe de base : on ne veut ici que
      // ce qui annote l'ouverture réglée
      if (el?.classList.contains('scene-note--name') || el?.classList.contains('scene-note--gap')) {
        found.push({ kind: el.className.includes('--name') ? 'name' : 'gap', text: el.textContent ?? '', position: o.position.toArray() as [number, number, number] })
      }
    })
    return found
  }

  /**
   * Les deux cotes sont celles du panneau, au centimètre : mêmes fonctions partagées
   * (`openingGaps`, `openingLabel`), même format. Une fenêtre nommée s'annonce par son nom, une
   * fenêtre sans nom par son identifiant de relevé.
   */
  it('annote le nom et les deux distances aux bouts du mur, et n’annote que la sélection', () => {
    const raw = JSON.parse(JSON.stringify(demo)) as typeof demo & { rooms: { id: string; openings: { id: string; name?: string }[] }[] }
    for (const room of raw.rooms) for (const o of room.openings ?? []) if (o.id === 'fen-ch1') o.name = 'Fenêtre de Paul'
    const house = parseHouse(raw)
    const room = house.rooms.find((r) => r.id === 'chambre1')!
    const opening = room.openings.find((o) => o.id === 'fen-ch1')!
    const gaps = openingGaps(room, opening)
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    expect(notes(scene)).toHaveLength(0)              // hors édition, aucune étiquette
    scene.setEditingOpenings(true)
    expect(notes(scene)).toHaveLength(0)              // en édition mais sans sélection, non plus
    scene.setSelectedOpening('fen-ch1')
    const shown = notes(scene)
    expect(shown.filter((n) => n.kind === 'name').map((n) => n.text)).toEqual(['Fenêtre de Paul'])
    expect(shown.filter((n) => n.kind === 'gap').map((n) => n.text).sort())
      .toEqual([`${gaps.left.toFixed(2)} m`, `${gaps.right.toFixed(2)} m`].sort())
    // le nom flotte au-dessus du linteau, les cotes à mi-hauteur et de part et d'autre
    const name = shown.find((n) => n.kind === 'name')!
    expect(name.position[2]).toBeGreaterThan(opening.height)
    // les cotes sont à mi-hauteur de l'ouverture, un peu au-dessus de leur trait, et sous son nom
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
   * Une ligne de cote ne vaut que si son trait matérialise EXACTEMENT l'intervalle annoncé : du bord
   * de l'ouverture au coin du mur. Le trait est une boîte unitaire étirée (`scale.x`), fermée par deux
   * tirets posés à ses deux bouts, dans le repère de l'ouverture — donc x est la distance le long du
   * mur depuis son bord gauche.
   */
  it('trace les deux cotes sur exactement l’intervalle qu’elles annoncent, tirets aux deux bouts', () => {
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
    expect(meshes).toHaveLength(6)                 // deux cotes : un trait et deux tirets chacune
    const [line, a, b, line2, a2, b2] = meshes
    // côté droit (vu de la pièce) : de -right à 0 ; côté gauche : de width à width + left
    expect(line!.scale.x).toBeCloseTo(gaps.right, 6)
    expect(a!.position.x).toBeCloseTo(-gaps.right, 6)
    expect(b!.position.x).toBeCloseTo(0, 6)
    expect(line2!.scale.x).toBeCloseTo(gaps.left, 6)
    expect(a2!.position.x).toBeCloseTo(opening.width, 6)
    expect(b2!.position.x).toBeCloseTo(opening.width + gaps.left, 6)
    // le trait est au milieu de son intervalle, et le nombre AU-DESSUS de lui (jamais dessus)
    expect(line!.position.x).toBeCloseTo(-gaps.right / 2, 6)
    const gapNote = notes(scene).find((n) => n.kind === 'gap')!
    expect(gapNote.position[2]).toBeGreaterThan(line!.position.z)
    scene.dispose()
  })

  /** Une cote NULLE n'a pas d'intervalle : le trait s'efface, les deux tirets se confondent. */
  it('efface le trait d’une cote nulle et garde ses tirets', () => {
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

  it('suit le brouillon : la cote change avec l’ouverture qui glisse, et l’autre avec elle', () => {
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
    // et le TRACÉ suit : il vit dans les marqueurs du niveau, qui survivent à sa reconstruction —
    // posé dans le groupe du niveau, il se retrouvait orphelin au premier mouvement de doigt
    let cotes: Object3D | null = null
    scene.scene.traverse((o) => { if (!cotes && o.name === 'opening-cotes') cotes = o })
    expect(cotes).not.toBeNull()
    expect((cotes! as Object3D).parent!.name).toBe('markers')
    expect(((cotes! as Object3D).children[0] as Mesh).scale.x).toBeCloseTo(parseFloat(now[0]!), 2)
    // ce que l'une gagne, l'autre le perd : la longueur du mur ne change pas
    const sum = (xs: string[]) => xs.reduce((n, t) => n + parseFloat(t), 0)
    expect(sum(now)).toBeCloseTo(sum(was), 2)
    scene.dispose()
  })
})

describe('heure de la maison', () => {
  // Le soleil se calcule, il ne se devine pas : la maison est géoréférencée et l'horloge fait le
  // reste. Repère pris à Dijon (la maison de démo), au solstice d'été — le soleil y culmine autour
  // de 66° (90 − 47,3 + 23,4) et passe au sud peu avant midi UTC.
  const DIJON = { lat: 47.32, lon: 5.04 }

  it('place le soleil au-dessus de la maison, à l’heure et au bon azimut', () => {
    const noon = sunPosition(new Date('2026-06-21T12:00:00Z'), DIJON.lat, DIJON.lon)
    expect(noon.altitudeDeg).toBeGreaterThan(60)
    expect(noon.altitudeDeg).toBeLessThan(68)
    expect(noon.azimuthDeg).toBeGreaterThan(170)          // plein sud, à peine passé
    expect(noon.azimuthDeg).toBeLessThan(210)
    const midnight = sunPosition(new Date('2026-12-21T00:00:00Z'), DIJON.lat, DIJON.lon)
    expect(midnight.altitudeDeg).toBeLessThan(-40)        // sous l'horizon, et franchement
    // le matin, le soleil est à l'EST : c'est le signe de l'angle horaire qui le décide
    const morning = sunPosition(new Date('2026-06-21T05:00:00Z'), DIJON.lat, DIJON.lon)
    expect(morning.azimuthDeg).toBeGreaterThan(50)
    expect(morning.azimuthDeg).toBeLessThan(110)
  })

  it('passe de la nuit au jour SANS marche d’escalier', () => {
    expect(dayFactor({ sunAltitudeDeg: -20, sunAzimuthDeg: 0, cloudiness: 0 })).toBe(0)
    expect(dayFactor({ sunAltitudeDeg: 20, sunAzimuthDeg: 0, cloudiness: 0 })).toBe(1)
    const dusk = dayFactor({ sunAltitudeDeg: 1, sunAzimuthDeg: 0, cloudiness: 0 })
    expect(dusk).toBeGreaterThan(0.1)
    expect(dusk).toBeLessThan(0.9)
  })

  it('ne rend JAMAIS une ambiance NaN : un mode inconnu retombe sur le soleil réel', () => {
    // Vécu : un réglage écrit à la main donnait une exposition NaN, et toute l'image devenait noire
    // sans la moindre erreur en console.
    const a = resolveAmbience({ mode: '"night"' as AmbienceMode, date: new Date('2026-06-21T12:00:00Z'), geo: DIJON })
    expect(Number.isFinite(a.sunAltitudeDeg)).toBe(true)
    expect(Number.isFinite(dayFactor(a))).toBe(true)
  })

  it('relève la source sous l’horizon sans changer d’où elle vient', () => {
    const night = resolveAmbience({ mode: 'night' })
    expect(night.sunAltitudeDeg).toBeLessThan(0)
    const dir = sunDirection(night)
    expect(dir.y).toBeGreaterThan(0.2)                    // une lumière enterrée n'éclaire rien
    // azimut 215° (sud-ouest) : x négatif (ouest), z positif (sud, car le nord de la maison est en −z)
    expect(dir.x).toBeLessThan(0)
    expect(dir.z).toBeGreaterThan(0)
  })

  it('retranche le cap de la maison : le haut du plan n’est pas forcément le nord', () => {
    const noon = { ...resolveAmbience({ mode: 'day' }), sunAltitudeDeg: 30, sunAzimuthDeg: 90 }   // soleil à l'EST
    // maison tournée de 90° : son +y regarde l'est, donc le soleil est sur le +y du plan, −z du monde
    const dir = sunDirection(noon, undefined, 90)
    expect(dir.x).toBeCloseTo(0)
    expect(dir.z).toBeLessThan(-0.5)
  })
})

describe('styles de rendu', () => {
  const HOURS: AmbienceMode[] = ['day', 'dusk', 'night']
  const house = computeHouseGeometry(parseHouse(demo))

  it('chaque style rend des valeurs finies à toute heure, et ne cite que des matières du catalogue', () => {
    for (const style of RENDER_STYLES) {
      for (const mode of HOURS) {
        const look = style.look(resolveAmbience({ mode }))
        expect(Number.isFinite(look.post.exposure)).toBe(true)
        expect(look.post.exposure).toBeGreaterThan(0)
        expect(Number.isFinite(look.lighting.sunIntensity)).toBe(true)
        for (const v of [...look.sky.zenith, ...look.sky.horizon, ...look.sky.ground]) expect(Number.isFinite(v)).toBe(true)
        // le catalogue est la seule source de matières : un rôle inconnu ne se cuit pas
        for (const role of rolesOf(look.surfaces)) expect(typeof role).toBe('string')
      }
    }
  })

  it('changer de style repasse d’autres matières aux MÊMES matériaux (aucune géométrie touchée)', () => {
    const theme = defaultSceneTheme()
    const mats = createMaterials(theme, defaultLook())
    const nodes = buildHouse(house, mats)
    const wallMesh = nodes.levels.get('rdc')!.walls[0]!
    const before = { material: wallMesh.material, map: mats.wall.map }
    applyLook(mats, theme, styleById('cyberpunk').look(resolveAmbience({ mode: 'night' })))
    expect(wallMesh.material).toBe(before.material)       // le maillage pointe toujours le même matériau
    expect(mats.wall.map).not.toBe(before.map)            // mais la matière, elle, a changé
    expect(mats.wall.metalness).toBeGreaterThan(0.5)      // le cyberpunk a des murs de métal
  })
})

describe('qualité de rendu', () => {
  /**
   * Un GPU intégré n'est plus rétrogradé sur son nom : la Radeon d'un portable hybride tient
   * « high » à 26-46 ms par image avec la vraie maison (mesuré le 2026-09-27), et c'est le garde-fou
   * qui en juge. Seul un rendu logiciel part d'office en « low ».
   */
  it('un rendu logiciel part en low, tout vrai GPU, intégré compris, part en high', () => {
    expect(detectQuality('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('low')
    expect(detectQuality('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high')
    expect(detectQuality('')).toBe('high')
  })

  it('le garde-fou ignore la chauffe et les pointes isolées, puis ne descend qu une fois, sur la médiane', () => {
    let over = 0
    const guard = createCostGuard(() => over++, 40, 8, 2)
    // deux images de chauffe hors de prix : ignorées
    guard.sample(500); guard.sample(500)
    // six images observées, médiane 50 ms > 40 : une seule descente, puis plus rien
    for (const ms of [30, 50, 50, 50, 50, 60]) guard.sample(ms)
    expect(over).toBe(1)
    for (let i = 0; i < 20; i++) guard.sample(500)
    expect(over).toBe(1)

    // deux pointes (une texture envoyée, une carte d'environnement) sur des images à 30 ms :
    // la moyenne dirait 87 ms, la médiane dit 30 — la machine tient.
    let spiky = 0
    const calm = createCostGuard(() => spiky++, 40, 8, 2)
    for (const ms of [30, 30, 30, 30, 30, 30, 200, 200]) calm.sample(ms)
    expect(spiky).toBe(0)
  })
})

describe('détail architectural', () => {
  const house = computeHouseGeometry(parseHouse(demo))
  const rdc = house.levels.find((l) => l.levelId === 'rdc')!
  const mats = createMaterials(defaultSceneTheme(), defaultLook())
  const meshes = buildDetails(rdc, mats)
  const byName = (n: string) => meshes.find((m) => m.name === n)!

  it('fabrique au plus quatre maillages fusionnés : lisses, encadrements, soubassement, vantaux', () => {
    expect(meshes.map((m) => m.name).sort()).toEqual(['details:doors', 'details:frames', 'details:plinth', 'details:trim'])
    expect(byName('details:trim').material).toBe(mats.trim)
    expect(byName('details:frames').material).toBe(mats.frame)
    expect(byName('details:plinth').material).toBe(mats.plinth)
    expect(byName('details:doors').material).toBe(mats.door)
    for (const m of meshes) expect(countTriangles(m)).toBeGreaterThan(0)
  })

  /**
   * Une baie HABILLÉE par un ouvrant : son vantail appartient à l'appareil, qui le dessine et
   * l'ouvre. Le bâti n'en pose pas un second — sinon une porte de garage remontée laisse derrière
   * elle le panneau fixe, et la baie n'est jamais vide.
   */
  it("laisse son vantail à l'ouvrant qui habille la baie, et garde le reste du bâti", () => {
    const dressed = buildDetails(rdc, mats, new Set(['porte-entree']))
    const doorsOf = (list: Mesh[]) => list.find((m) => m.name === 'details:doors')
    expect(countTriangles(doorsOf(dressed)!)).toBeLessThan(countTriangles(byName('details:doors')))
    // le dormant, les lisses et le soubassement restent au mur : un volet ne retire pas le cadre
    for (const name of ['details:frames', 'details:trim', 'details:plinth']) {
      expect(countTriangles(dressed.find((m) => m.name === name)!)).toBe(countTriangles(byName(name)))
    }
    // toutes les portes habillées : plus un seul vantail à dessiner
    const all = new Set(rdc.openings.map((o) => o.openingId))
    expect(buildDetails(rdc, mats, all).map((m) => m.name)).not.toContain('details:doors')
  })

  it('le couronnement dépasse le haut des murs de cinq millimètres, jamais plus', () => {
    const g = byName('details:trim').geometry
    g.computeBoundingBox()
    const top = Math.max(...rdc.walls.map((w) => w.z1))
    expect(g.boundingBox!.max.z).toBeCloseTo(top + 0.005, 3)
  })

  it('le soubassement reste au ras du sol fini et s’arrête à hauteur de plinthe', () => {
    const g = byName('details:plinth').geometry
    g.computeBoundingBox()
    expect(g.boundingBox!.min.z).toBeCloseTo(0.002, 3)
    expect(g.boundingBox!.max.z).toBeCloseTo(0.28, 3)
  })

  it('cadres dans l’épaisseur du mur, appuis côté FAÇADE : rien ne dépasse dans la pièce', () => {
    // un niveau réduit à la seule baie : chaque sommet se projette sur SA normale extérieure
    const baie = rdc.openings.find((o) => o.openingId === 'baie')!
    const only = buildDetails({ ...rdc, walls: [], openings: [baie] }, mats)
    const along = (mesh: Mesh) => {
      const pos = mesh.geometry.getAttribute('position')
      return Array.from({ length: pos.count }, (_, i) =>
        (pos.getX(i) - baie.origin[0]) * baie.normal[0] + (pos.getY(i) - baie.origin[1]) * baie.normal[1])
    }
    const s = along(only.find((m) => m.name === 'details:trim')!)      // l'appui seul, sans mur donc sans couronnement
    const f = along(only.find((m) => m.name === 'details:frames')!)
    expect(Math.min(...s)).toBeGreaterThan(baie.depth / 2)          // l'appui est du côté extérieur…
    expect(Math.max(...s)).toBeGreaterThan(baie.depth)              // …et déborde de la façade
    expect(Math.min(...f)).toBeGreaterThanOrEqual(-1e-6)            // le cadre ne sort pas côté pièce
    expect(Math.max(...f)).toBeLessThanOrEqual(baie.depth + 1e-6)   // ni côté façade
  })

  it('un passage n’a ni cadre ni vantail', () => {
    const level = { ...rdc, walls: [], openings: rdc.openings.map((o) => ({ ...o, type: 'passage' as const })) }
    expect(buildDetails(level, mats)).toEqual([])
  })

  /** Le même niveau, réduit à UNE ouverture à laquelle on impose ce qu'on veut éprouver. */
  const only = (o: Partial<OpeningRect>) => {
    const porte = rdc.openings.find((x) => x.type === 'door')!
    return buildDetails({ ...rdc, walls: [], openings: [{ ...porte, ...o }] }, mats)
  }

  it('deux vantaux découpent le panneau d’une porte pleine, et refendent une baie vitrée', () => {
    const one = only({ leaves: 1 })
    const two = only({ leaves: 2 })
    // un panneau de plus, donc une boîte de plus : le trait vertical qui fait la porte à deux battants
    expect(countTriangles(two.find((m) => m.name === 'details:doors')!))
      .toBe(2 * countTriangles(one.find((m) => m.name === 'details:doors')!))
    // vitrée, ce ne sont plus des panneaux mais des refends, comptés dans les encadrements
    const bay1 = only({ type: 'bay', leaves: 1 }), bay3 = only({ type: 'bay', leaves: 3 })
    expect(countTriangles(bay3.find((m) => m.name === 'details:frames')!))
      .toBeGreaterThan(countTriangles(bay1.find((m) => m.name === 'details:frames')!))
  })

  it('la matière verre vitre l’ouverture : une porte pleine perd son panneau opaque', () => {
    expect(only({}).some((m) => m.name.startsWith('details:doors'))).toBe(true)
    const glazed = only({ material: 'glass' })
    expect(isGlazed({ ...rdc.openings[0]!, type: 'door', material: 'glass' })).toBe(true)
    // le vantail plein a laissé place à un cadre de battant, rangé avec les encadrements
    expect(glazed.some((m) => m.name.startsWith('details:doors'))).toBe(false)
    expect(glazed.some((m) => m.name.startsWith('details:frames'))).toBe(true)
  })

  it('une menuiserie teintée prend son propre maillage ; sans réglage, rien ne se dédouble', () => {
    expect(meshes.filter((m) => m.name.startsWith('details:frames'))).toHaveLength(1)
    const tinted = only({ color: '#c0c4c8' })
    const frame = tinted.find((m) => m.name.startsWith('details:frames'))!
    expect(frame.name).toBe('details:frames#|#c0c4c8')
    expect(frame.material).not.toBe(mats.frame)
    expect((frame.material as MeshStandardMaterial).color.getHexString()).toBe('c0c4c8')
    // deux ouvertures de la MÊME teinte partagent leur matériau : une teinte, un appel de dessin
    expect(only({ color: '#c0c4c8' }).find((m) => m.name.startsWith('details:frames'))!.material).toBe(frame.material)
  })

  it('le métal d’une menuiserie réfléchit, le bois non, le tissu encore moins', () => {
    const metal = only({ material: 'metal' }).find((m) => m.name.startsWith('details:frames'))!.material as MeshStandardMaterial
    const wood = only({ material: 'wood' }).find((m) => m.name.startsWith('details:frames'))!.material as MeshStandardMaterial
    expect(metal.metalness).toBeGreaterThan(0.5)
    expect(wood.metalness).toBe(0)
    expect(wood.color.getHexString()).toBe(mats.floors.wood.color.getHexString())
    // une TOILE : aucun reflet, et plus mate que le bois — c'est ce qui la distingue à l'œil
    const fabric = only({ material: 'fabric' }).find((m) => m.name.startsWith('details:frames'))!.material as MeshStandardMaterial
    expect(fabric.metalness).toBe(0)
    expect(fabric.roughness).toBeGreaterThan(wood.roughness)
    expect(fabric.transparent).toBe(false)              // le tissu ne fait rien à la géométrie, lui
  })

  it('les couleurs du détail se déduisent de la palette : lisse plus claire, menuiseries et soubassement plus sombres', () => {
    const wall = mats.wall.color.getHSL({ h: 0, s: 0, l: 0 }).l
    expect(mats.trim.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(wall)
    expect(mats.frame.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(wall)
    expect(mats.plinth.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(wall)
  })
})

describe('toit et piscine', () => {
  const geometry = computeHouseGeometry(parseHouse(demo))
  const mats = createMaterials(defaultSceneTheme(), defaultLook())

  it('un toit à deux pentes reçoit des planches de rive sous ses égouts et ses pignons, jamais au faîte', () => {
    const [fascia] = buildRoofDetails(geometry.roof!, mats)
    expect(fascia!.name).toBe('roof:fascia')
    expect(fascia!.material).toBe(mats.frame)
    fascia!.geometry.computeBoundingBox()
    expect(fascia!.geometry.boundingBox!.max.z).toBeLessThanOrEqual(geometry.roof!.zRidge + 1e-6) // les rives montent au faîte, rien au-dessus
    expect(fascia!.geometry.boundingBox!.min.z).toBeCloseTo(geometry.roof!.zBase - 0.18, 3)  // pendu sous l'égout
  })

  it('un toit plat reçoit un acrotère dans le matériau des murs, couronné, et une dalle qui n’est pas en tuiles', () => {
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

  it('la dalle végétalisée de nature ne survit pas au retour au réaliste', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    const flatMat = () => (scene as unknown as { materials: { roofFlat: MeshStandardMaterial; roof: MeshStandardMaterial } }).materials
    scene.setAppearance({ style: styleById('nature') })
    expect(flatMat().roofFlat.color.getHexString()).toBe('5f7a42')
    scene.setAppearance({ style: styleById('realistic') })
    expect(flatMat().roofFlat.color.equals(flatMat().roof.color)).toBe(true)   // la couleur du versant, pas l'herbe
    scene.dispose()
  })

  it('une piscine est un bassin : margelle, parois vues de l’intérieur, eau translucide en retrait', () => {
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

describe('bassin aligné sur ses bords', () => {
  it('les carreaux du fond suivent les côtés d’une piscine tournée, pas les axes du monde', () => {
    // un rectangle 8 × 4 tourné de 30° : en UV monde, sa boîte englobante serait bien plus grande que 32 m²
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    const rot = ([x, y]: [number, number]): [number, number] => [x * c - y * s, x * s + y * c]
    const poly = ([[-4, -2], [4, -2], [4, 2], [-4, 2]] as [number, number][]).map(rot)
    const g = alignedToLongestEdge(poly, (p) => extrudePolygon(p, -1.5, 0))
    const nrm = g.getAttribute('normal'), uv = g.getAttribute('uv')
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (let i = 0; i < nrm.count; i++) {
      if (nrm.getZ(i) > -0.999) continue                                  // le fond seulement (normale vers le bas)
      minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i))
      minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i))
    }
    expect((maxU - minU) * (maxV - minV)).toBeCloseTo(32, 1)
    g.computeBoundingBox()                                               // et la géométrie est bien revenue à sa place
    expect(g.boundingBox!.max.x).toBeCloseTo(4 * c + 2 * s, 3)
  })
})

describe('mise en évidence d’une pièce', () => {
  it('pose un trait et un voile non éclairés, sans toucher la couleur du sol', () => {
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

  it('le reste de la maison s’efface derrière la pièce, par un masque et non par transparence', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    const house = parseHouse(demo)
    scene.load(house)
    const floor = computeHouseGeometry(house).levels[0]!.floors[0]!
    scene.highlightRoom(floor.roomId)
    const u = roomFocusUniforms
    expect(u.kasbahFocus.value).toBe(1)
    expect(u.kasbahFocusCount.value).toBe(floor.polygon.length)
    // le y de la maison est le −z du monde ; le contour est élargi d'un mur : il contient le sien
    const [x, y] = floor.polygon[0]!
    const p = u.kasbahFocusPoly.value[0]!
    expect(Math.abs(p.x - x)).toBeLessThan(0.5)
    expect(Math.abs(p.y + y)).toBeLessThan(0.5)
    scene.highlightRoom(null)
    expect(u.kasbahFocus.value).toBe(0)
    // injecté sur toute matière, après la lumière (`opaque_fragment`)
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
    mats.wall.onBeforeCompile(shader as never, null as never)
    expect(shader.fragmentShader.indexOf('kasbahRoomDistance( kasbahW )')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'))
    expect(shader.uniforms.kasbahFocus).toBe(u.kasbahFocus)
    scene.dispose()
  })
})

describe('fenêtres éclairées', () => {
  it('le verre d’une pièce s’allume avec ses lampes, la nuit seulement, sans toucher aux voisines', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    scene.setAppearance({ ambience: resolveAmbience({ mode: 'night' }) })
    const nodes = (scene as unknown as { nodes: { levels: Map<string, { panes: Mesh[] }> } }).nodes
    const panes = [...nodes.levels.values()].flatMap((l) => l.panes)
    const of = (roomId: string) => panes.find((p) => p.userData.roomId === roomId)!
    const glass = (p: Mesh) => p.material as MeshStandardMaterial
    const base = (p: Mesh) => p.userData.baseMaterial as MeshStandardMaterial
    const salon = of('salon'), cuisine = of('cuisine')
    expect(glass(salon)).not.toBe(glass(cuisine))                     // un verre par pièce
    scene.updateStates({ 'mock:light-living': { kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100 } as DeviceState })
    expect(glass(salon).emissive.r).toBeGreaterThan(base(salon).emissive.r + 0.3)
    expect(glass(salon).opacity).toBeGreaterThan(base(salon).opacity)
    expect(glass(cuisine).emissive.getHex()).toBe(base(cuisine).emissive.getHex())
    expect(glass(cuisine).opacity).toBe(base(cuisine).opacity)
    // le puits de lumière du salon est dans une dalle : il ne s'allume pas avec la pièce
    const puits = panes.find((p) => p.userData.openingId === 'puits-salon')!
    expect(glass(puits)).toBe(base(salon))
    expect(glass(puits).opacity).toBeLessThan(glass(salon).opacity)
    scene.setAppearance({ ambience: resolveAmbience({ mode: 'day' }) })
    expect(glass(salon).emissive.getHex()).toBe(base(salon).emissive.getHex())
    expect(glass(salon).opacity).toBe(base(salon).opacity)
    scene.dispose()
  })
})

describe('météo dans la scène', () => {
  it('traduit une condition en ce que les surfaces en gardent', () => {
    expect(weatherEffects('rain')).toEqual({ wetness: 1, precipitation: { kind: 'rain', intensity: 0.8 } })
    expect(weatherEffects('thunderstorm')).toMatchObject({ wetness: 1, storm: true, precipitation: { kind: 'rain', intensity: 1 } })
    expect(weatherEffects('snow')).toEqual({ snow: 1, precipitation: { kind: 'snow', intensity: 0.8 } })
    expect(weatherEffects('fog')).not.toHaveProperty('precipitation')
    expect(weatherEffects('sleet')).toMatchObject({ snow: 0.5 })
    expect(weatherEffects('clear')).toEqual({})
    expect(weatherEffects(undefined)).toEqual({})
    expect(resolveAmbience({ mode: 'day', condition: 'thunderstorm', cloudiness: 0.9, visibilityM: 3000 })).toMatchObject({ cloudiness: 0.9, wetness: 1, storm: true, visibilityM: 3000 })
  })

  it('ne pose un brouillard qu’en dessous de 5 km, à l’échelle de la maison', () => {
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0 })).toBeNull()
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 25_000 })).toBeNull()
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 2000 })).toBe(220)
    // le brouillard le plus épais voile la maison, il ne la fait pas disparaître
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 60 })).toBe(123)
  })

  it('ignore la visibilité annoncée quand rien n’est en l’air (couvert à 100 % d’humidité)', () => {
    expect(resolveAmbience({ mode: 'day', condition: 'cloudy', cloudiness: 1, visibilityM: 60 })).not.toHaveProperty('visibilityM')
    expect(resolveAmbience({ mode: 'day', condition: 'fog', cloudiness: 1, visibilityM: 60 })).toMatchObject({ visibilityM: 60 })
    expect(resolveAmbience({ mode: 'day', visibilityM: 800 })).toMatchObject({ visibilityM: 800 })
  })

  it('la pluie fonce et lisse ce qui est dehors, la neige le blanchit, l’intérieur ne bouge pas', () => {
    const theme = defaultSceneTheme()
    const look = defaultLook()
    const dry = createMaterials(theme, look)
    const wet = createMaterials(theme, look)
    applyLook(wet, theme, look, undefined, { wetness: 1, snow: 0 })
    expect(wet.terrain.roughness).toBeLessThan(dry.terrain.roughness)
    expect(wet.roof.roughness).toBeLessThan(dry.roof.roughness)
    expect(wet.terrain.color.r).toBeLessThan(dry.terrain.color.r)
    expect(wet.floor.roughness).toBe(dry.floor.roughness)              // dedans, il ne pleut pas
    expect(wet.zones.pool.roughness).toBe(dry.zones.pool.roughness)    // l'eau est déjà de l'eau
    const snowy = createMaterials(theme, look)
    applyLook(snowy, theme, look, undefined, { wetness: 0, snow: 1 })
    const lum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b
    expect(lum(snowy.terrain.color)).toBeGreaterThan(lum(dry.terrain.color))
    expect(snowy.terrain.roughness).toBeGreaterThan(0.9)
    // remettre le beau temps rend les valeurs du style
    applyLook(snowy, theme, look)
    expect(snowy.terrain.roughness).toBe(dry.terrain.roughness)
    expect(snowy.terrain.color.getHex()).toBe(dry.terrain.color.getHex())
  })

  it('un orage allume une minuterie d’éclairs, que la fin de l’orage ou la destruction éteint', () => {
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

describe('précipitations (palier C)', () => {
  const box = { min: [0, 0] as const, max: [10, 8] as const, height: 14 }

  it('garde chaque goutte dans le volume, la fait retomber en haut, et l’incline avec le vent', () => {
    const rain = new Precipitation(box, { kind: 'rain', intensity: 1, windKmh: 36, windDirDeg: 270 })   // vent d'OUEST : pousse vers +x
    expect(rain.count).toBe(2600)
    const pos = (rain.object as unknown as { geometry: { getAttribute(n: string): { array: Float32Array } } }).geometry.getAttribute('position').array
    // le trait d'une goutte penche vers d'où elle vient : la queue est à l'ouest (x plus petit) et plus haut
    expect(pos[3]!).toBeLessThan(pos[0]!)
    expect(pos[5]!).toBeGreaterThan(pos[2]!)
    for (let f = 0; f < 60; f++) rain.step(0.05)                   // trois secondes : tout est retombé au moins une fois
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

  it('la scène pose la pluie sur sa racine et anime la boucle, puis la retire quand il ne pleut plus ou en qualité basse', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(parseHouse(demo))
    const priv = scene as unknown as { loop: { animationCount: number }; nodes: { root: { children: { name: string }[] } } }
    const falling = (): string[] => priv.nodes.root.children.filter((c) => c.name.startsWith('precipitation:')).map((c) => c.name)
    const rainy = { ...resolveAmbience({ mode: 'day' }), precipitation: { kind: 'rain' as const, intensity: 0.8 }, windKmh: 20, windDirDeg: 200 }
    scene.setAppearance({ ambience: rainy })
    expect(priv.loop.animationCount).toBe(1)
    expect(falling()).toEqual(['precipitation:rain'])
    // même pluie un peu plus forte : réglée, pas reconstruite
    scene.setAppearance({ ambience: { ...rainy, precipitation: { kind: 'rain', intensity: 0.9 } } })
    expect(priv.loop.animationCount).toBe(1)
    // la neige remplace la pluie
    scene.setAppearance({ ambience: { ...rainy, precipitation: { kind: 'snow', intensity: 0.8 } } })
    expect(falling()).toEqual(['precipitation:snow'])
    expect(priv.loop.animationCount).toBe(1)
    // qualité basse : plus rien ne tombe ; haute : ça reprend
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

/** Centre (monde) de la piscine de la maison de démonstration. */
const POOL_CENTER = new Vector3(18, 0, -4)

describe('brume basse', () => {
  it('rien le jour ni le soir, modérée la nuit, à son plus fort à l’aube, dispersée par le vent', () => {
    const night = resolveAmbience({ mode: 'night' })
    const dusk = resolveAmbience({ mode: 'dusk' })                       // soleil rasant à l'OUEST
    expect(mistAmount(resolveAmbience({ mode: 'day' }))).toBe(0)
    expect(mistAmount(night)).toBeGreaterThan(0.5)
    const dawn = mistAmount({ ...dusk, sunAzimuthDeg: 80 })
    expect(dawn).toBeGreaterThan(mistAmount(night))
    expect(mistAmount(dusk)).toBeLessThan(dawn)
    expect(mistAmount({ ...night, windKmh: 45 })).toBe(0)
  })

  it('s’injecte derrière le brouillard de three, sur les seules matières du dehors', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const inject = (mat: Material) => {
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
      mat.onBeforeCompile(shader as never, null as never)
      return shader
    }
    const terrain = inject(mats.terrain)
    expect(terrain.vertexShader).toContain('kasbahMistView = mvPosition.xyz;')
    expect(terrain.fragmentShader).toContain('kasbahMistDensity * length( kasbahMistView )')
    expect(terrain.uniforms.kasbahMistDensity).toBe(heightMistUniforms.kasbahMistDensity)   // partagée : l'heure ne recompile rien
    // un sol de pièce est à la hauteur du jardin : sans ce tri, la maison de poupée s'embrumait
    expect(inject(mats.floor).fragmentShader).not.toContain('kasbahMist')
    // l'opacité (et le fondu des étages), elle, est sur TOUTES les matières : c'est l'étage entier qui s'efface
    expect(inject(mats.ground).fragmentShader).not.toContain('kasbahMist')
    const floor = inject(mats.floor)
    expect(floor.fragmentShader).toContain('#ifdef OPAQUE')
    expect(floor.fragmentShader.indexOf('kasbahA < 1.0')).toBeLessThan(floor.fragmentShader.indexOf('#include <alphatest_fragment>'))
    expect(floor.uniforms.kasbahFadeY).toBe(levelFadeUniforms.kasbahFadeY)
  })

  it('la passe d’ombre reçoit le fondu : l’ombre de l’étage qui s’envole pâlit avec lui', () => {
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.depth.vertexShader, fragmentShader: ShaderLib.depth.fragmentShader }
    new MeshDepthMaterial().onBeforeCompile(shader as never, null as never)
    expect(shader.vertexShader).toContain('kasbahFadeView = mvPosition.xyz;')
    expect(shader.fragmentShader.indexOf('kasbahA < 1.0')).toBeLessThan(shader.fragmentShader.indexOf('#include <alphatest_fragment>'))
    expect(shader.uniforms.kasbahFadeVisibility).toBe(levelFadeUniforms.kasbahFadeVisibility)
  })

  it('chaque matière a son opacité, réglable sans recompiler, et un clone la sienne', () => {
    const mats = createMaterials(defaultSceneTheme(), defaultLook())
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
    mats.wall.onBeforeCompile(shader as never, null as never)
    const opacity = materialOpacity(mats.wall)
    expect(shader.uniforms.kasbahOpacity).toBe(opacity)                 // l'uniform MÊME : le changer suffit
    expect(opacity.value).toBe(1)                                        // opaque par défaut
    opacity.value = 0.4
    const clone = mats.wall.clone()
    expect(materialOpacity(clone)).not.toBe(opacity)
    expect(mats.wall.transparent).toBe(false)                           // la matière reste dans la file opaque
  })
})

describe('eau vivante', () => {
  it('injecte ses ondes et ses caustiques aux points que three lui laisse', () => {
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
    // le temps est PARTAGÉ, la force ne l'est pas : le fond suit le jour, la houle non
    expect(surface.shader.uniforms.uWaterTime).toBe(time)
    expect(basin.shader.uniforms.uWaterTime).toBe(time)
    expect(basin.shader.uniforms.uWaterStrength).not.toBe(surface.shader.uniforms.uWaterStrength)
    // les points d'injection existent encore dans le shader de three : c'est CE test qui le dit le
    // jour où une version en déplace un (le patch échouerait sinon en silence, eau figée)
    expect(surface.shader.vertexShader).toContain('vWaterPos = (modelMatrix')
    expect(surface.shader.fragmentShader).toContain('kasbahWaveGrad(kasbahToWind(vWaterPos.xz)')
    expect(surface.shader.fragmentShader).toContain('waterFresnel')
    // le fond : caustiques sur la lumière directe, puis absorption par le chemin dans l'eau
    expect(basin.shader.uniforms.uWaterCaustics).toBe(water.caustics)
    expect(basin.shader.uniforms.uWaterRefracted).toBe(water.refracted)
    expect(basin.shader.vertexShader).toContain('vWaterDepth = waterDepth')
    expect(basin.shader.fragmentShader).toContain('reflectedLight.directDiffuse *= mix(1.0, caustic')
    expect(basin.shader.fragmentShader).toMatch(/outgoingLight = outgoingLight \* waterT[\s\S]*#include <opaque_fragment>/)
    expect(surface.shader.fragmentShader).not.toContain('waterT')
    // le vent est le même pour la surface et pour le fond (qui lit la carte dans son repère)
    expect(surface.shader.uniforms.uWaterWind).toBe(water.wind)
    expect(basin.shader.uniforms.uWaterWind).toBe(water.wind)
    expect(basin.shader.fragmentShader).toContain('kasbahToWind(causticAt)')
    // deux programmes distincts, et distincts de tout matériau standard aux mêmes réglages
    expect(mats.zones.pool.customProgramCacheKey!()).not.toBe(mats.poolBasin.customProgramCacheKey!())
  })

  it('la houle part sous le vent réel, et son amplitude suit sa force', () => {
    // tirées dans le repère du vent, les ondes avancent (phase k·p − ωt) surtout vers +x
    const push = WAVES.reduce((acc, w) => ({ x: acc.x + w.a * w.kx, y: acc.y + w.a * w.ky }), { x: 0, y: 0 })
    expect(push.x).toBeGreaterThan(3 * Math.abs(push.y))
    const water = createWaterUniforms()
    // vent d'OUEST (270°) : pousse vers l'est, +x du monde
    setWaterWind(water, 10, 270)
    expect(water.wind.value.x).toBeCloseTo(1)
    expect(water.wind.value.y).toBeCloseTo(0)
    expect(water.wind.value.z).toBeCloseTo(1)                     // une brise de 10 km/h : la houle d'avant
    // vent du NORD (0°) : pousse vers le sud, +z du monde (nord = −z)
    setWaterWind(water, 10, 0)
    expect(water.wind.value.x).toBeCloseTo(0)
    expect(water.wind.value.y).toBeCloseTo(1)
    setWaterWind(water, 0, 0)
    expect(water.wind.value.z).toBeCloseTo(0.15)                  // calme : presque plate
    setWaterWind(water, 80, 0)
    expect(water.wind.value.z).toBeCloseTo(1.5)                   // tempête : plafonnée
  })

  it('compte le vent depuis le nord VRAI : le cap de la maison tourne la houle', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    const house = parseHouse(demo)
    scene.load({ ...house, origin: { ...house.origin, heading: 90 } })   // +y du plan = est
    scene.setAppearance({ ambience: { ...resolveAmbience({ mode: 'day' }), windKmh: 10, windDirDeg: 270 } })   // vent d'ouest
    // il pousse vers l'est, c'est-à-dire le +y du plan : −z du monde
    const wind = (scene as unknown as { water: { wind: { value: Vector3 } } }).water.wind.value
    expect(wind.x).toBeCloseTo(0)
    expect(wind.y).toBeCloseTo(-1)
  })

  it('ne fait tourner la boucle que si le style, la qualité ET le champ de la caméra le veulent', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.resize(1000, 600)
    scene.load(parseHouse(demo))
    // headless : pas de contrôles, donc personne n'a tourné la caméra vers la maison — on la vise
    // à la main sur la piscine de la maison de démonstration, puis on repasse par `syncWater`.
    const aim = (at: Vector3, quality: 'high' | 'medium') => { scene.camera.lookAt(at); scene.setOptions({ quality }) }
    aim(POOL_CENTER, 'high')
    expect(scene.debugStats().animations).toBe(1)
    scene.setOptions({ quality: 'low' })
    expect(scene.debugStats().animations).toBe(0)      // même règle que la pluie
    scene.setOptions({ quality: 'high' })
    expect(scene.debugStats().animations).toBe(1)
    scene.setAppearance({ style: styleById('maquette') })
    expect(scene.debugStats().animations).toBe(0)      // une maquette a de l'eau en résine
    scene.setAppearance({ style: styleById(null) })
    expect(scene.debugStats().animations).toBe(1)
    // et le jardin qu'on ne regarde plus ne coûte plus rien
    aim(new Vector3(-40, 0, 40), 'medium')
    expect(scene.debugStats().animations).toBe(0)
  })
})
