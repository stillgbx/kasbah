import { describe, expect, it } from 'vitest'
import { BackSide, Box3, BoxGeometry, type BufferGeometry, CylinderGeometry, Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D, ShapeGeometry, Vector3, type BufferAttribute, type Texture } from 'three'
import { computeHouseGeometry, localToGeo, openingGaps, parseHouse, type DeviceDescriptor, type DeviceState, type PlacedHouseDevice } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { buildHouse, buildLevel, buildWallsGeometry, countTriangles } from './builders/buildHouse'
import { buildDetails, buildRoofDetails } from './builders/details'
import { alignedToLongestEdge, extrudePolygon } from './builders/shapes'
import { createSurfaceTextures, type SurfaceTexture } from './textures/procedural'
import { createMaterials } from './builders/materials'
import { fitBox, fitDistance } from './core/cameraFit'
import { boundsToWorldBox, houseToWorld } from './core/coords'
import { createRenderLoop } from './core/renderLoop'
import { createCostGuard, detectQuality } from './core/post'
import { parseCssColor } from './core/theme'
import { defaultLook, defaultSceneTheme, RENDER_STYLES, rolesOf, styleById } from './styles'
import { applyLook } from './builders/materials'
import { dayFactor, fogDistance, resolveAmbience, sunDirection, weatherEffects, type AmbienceMode } from './core/ambience'
import { DECOR_LAYER, LAMP_LAYER, SITE_DECOR_LAYER } from './core/layers'
import { sunPosition } from './core/sun'
import { createTween } from './core/tween'
import { ScreenArt, coverCrop, screenArtGeometry } from './markers/screenArt'
import { createMarker } from './markers/createMarker'
import type { DeviceMarker } from './markers/DeviceMarker'
import { yawToRad } from '../lib/orientation'
import { HouseScene } from './HouseScene'
import type { Animation } from './core/renderLoop'
import { Precipitation } from './effects/precipitation'

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
  it('merges wall prisms into one geometry per kind with the right extents', () => {
    const level = geometry.levels[0]!
    const g = buildWallsGeometry(level.walls.filter((w) => w.kind === 'exterior'))!
    g.computeBoundingBox()
    expect(g.boundingBox!.min.x).toBeCloseTo(-0.3)
    expect(g.boundingBox!.max.x).toBeCloseTo(10.3)
    expect(g.boundingBox!.min.z).toBeCloseTo(0)
    expect(g.boundingBox!.max.z).toBeCloseTo(2.6)
    expect(buildWallsGeometry([])).toBeNull()
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
    const interior = buildWallsGeometry(level.walls.filter((w) => w.kind === 'interior'))!
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

  it('cadre la partie libre du canvas quand un panneau couvre le bord droit', () => {
    scene.resize(1000, 500)
    expect(scene.camera.aspect).toBeCloseTo(2)
    scene.setViewInset(400)
    expect(scene.camera.aspect).toBeCloseTo(600 / 500)
    expect(scene.camera.view?.enabled).toBe(true)
    scene.setViewInset(0)
    expect(scene.camera.aspect).toBeCloseTo(2)
    expect(scene.camera.view?.enabled ?? false).toBe(false)
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
   * Un volet fermé doit BARRER la lumière. Ce qui l'en empêchait n'était pas le maillage (il porte
   * `castShadow` depuis toujours) mais le rendu en passes : les marqueurs étaient masqués pendant la
   * passe qui refait la carte d'ombre, donc aucun appareil ne portait d'ombre. Ce qui doit sortir de
   * cette passe, ce sont les LAMPES (elles n'éclaireraient pas que leur groupe) et les DÉCORS
   * translucides (ils se mélangeraient deux fois) — par leur couche, jamais par leur visibilité.
   */
  it('un appareil porte son ombre ; ses lampes et ses décors sortent de la passe globale', () => {
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
    expect(parts.light).toEqual([1 << LAMP_LAYER])
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
    expect(light.layers.mask).toBe(1)                // couche commune : elle éclaire toutes les passes
    expect(light.castShadow).toBe(false)             // éteinte : pas six rendus de profondeur pour rien
    lamp.update({ kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100 } as DeviceState)
    expect(light.castShadow).toBe(true)
    const sprites: number[] = []
    lamp.object.traverse((o) => { if ((o as { isSprite?: boolean }).isSprite) sprites.push(o.layers.mask) })
    expect(sprites).toEqual([1 << SITE_DECOR_LAYER])  // son halo se dessine avec le jardin
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

describe('coût du rendu', () => {
  /**
   * Chaque passe de niveau REDESSINE tout le bâti : sur une maison de trente pièces, c'est le prix
   * d'une image entière. Un niveau ne la mérite que s'il a quelque chose de plus à montrer que la
   * passe globale — une lampe allumée, ou un décor. En plein jour, lampes éteintes, il n'y en a aucune.
   */
  it('un niveau sans lampe allumée ne coûte pas une passe de plus', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    // Sans descripteur, un appareil n'est qu'une forme neutre : c'est le KIND qui donne une vraie
    // lampe, avec sa lumière ponctuelle — et c'est elle qu'on compte ici.
    scene.setDescriptors({ 'mock:light-living': { id: 'mock:light-living', pluginId: 'mock', externalId: 'light-living', kind: 'light', name: 'Plafonnier salon', capabilities: ['on_off'], meta: {} } as DeviceDescriptor })
    scene.load(parseHouse(demo))
    expect(scene.debugStats().levelPasses).toBe(0)
    scene.updateStates({ 'mock:light-living': { kind: 'light', updatedAt: 0, available: true, on: true, brightness: 100 } as DeviceState })
    expect(scene.debugStats().levelPasses).toBe(1)
    scene.updateStates({ 'mock:light-living': { kind: 'light', updatedAt: 1, available: true, on: false } as DeviceState })
    expect(scene.debugStats().levelPasses).toBe(0)
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
   * d'avant, au triangle près. Et elles ne coûtent aucune passe de niveau (elles sont dessinées dans
   * la passe globale) — c'est ce qui rend le mode gratuit sur l'iGPU.
   */
  it('pose une poignée par ouverture, sans passe de plus, et ne laisse rien en sortant', () => {
    const scene = new HouseScene(document.createElement('canvas'), { headless: true })
    scene.load(house)
    const before = countTriangles(scene.scene)
    expect(handles(scene)).toBe(0)
    scene.setEditingOpenings(true)
    expect(handles(scene)).toBe(openingCount)
    expect(openingCount).toBeGreaterThan(0)
    expect(scene.debugStats().levelPasses).toBe(0)
    expect(countTriangles(scene.scene)).toBeGreaterThan(before)
    scene.setEditingOpenings(false)
    expect(handles(scene)).toBe(0)
    expect(countTriangles(scene.scene)).toBe(before)
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
        ? { ...r, openings: r.openings.map((o) => (o.id === opening.id ? { ...o, offset: o.offset + 0.3 } : o)) }
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
        ? { ...r, openings: r.openings.map((o) => (o.id === 'fen-ch1' ? { ...o, offset: o.offset + 0.4 } : o)) }
        : r)),
    })
    const now = read()
    expect(now).not.toEqual(was)
    // et le TRACÉ suit : il vit dans le groupe des étiquettes, qui survit à la reconstruction du
    // niveau — posé dans le groupe du niveau, il se retrouvait orphelin au premier mouvement de doigt
    let cotes: Object3D | null = null
    scene.scene.traverse((o) => { if (!cotes && o.name === 'opening-cotes') cotes = o })
    expect(cotes).not.toBeNull()
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
   * Mesuré sur un portable hybride : Chrome dessinait sur la Radeon intégrée, 93 ms de GPU par
   * image en « high », alors que ses seize cœurs disaient « high ». Le nom du GPU tranche.
   */
  it('un GPU intégré part en medium, un rendu logiciel en low, une carte dédiée reste high', () => {
    expect(detectQuality('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium')
    expect(detectQuality('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium')
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
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 400 })).toBeCloseTo(33.3, 1)
    expect(fogDistance({ sunAltitudeDeg: 30, sunAzimuthDeg: 0, cloudiness: 0, visibilityM: 50 })).toBe(18)
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
