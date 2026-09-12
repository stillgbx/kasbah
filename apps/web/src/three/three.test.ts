import { describe, expect, it } from 'vitest'
import { Box3, CylinderGeometry, Mesh, Vector3, type BufferAttribute, type Texture } from 'three'
import { computeHouseGeometry, parseHouse, type DeviceDescriptor, type DeviceState, type HouseDevice } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { buildHouse, buildWallsGeometry, countTriangles } from './builders/buildHouse'
import { createMaterials } from './builders/materials'
import { fitBox, fitDistance } from './core/cameraFit'
import { boundsToWorldBox, houseToWorld } from './core/coords'
import { createRenderLoop } from './core/renderLoop'
import { defaultSceneTheme, parseCssColor } from './core/theme'
import { createTween } from './core/tween'
import { ScreenArt, coverCrop, screenArtGeometry } from './markers/screenArt'
import { createMarker } from './markers/createMarker'
import { HouseScene } from './HouseScene'
import type { Animation } from './core/renderLoop'

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
    const mats = createMaterials(defaultSceneTheme())
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
  const marker = (device: HouseDevice, descriptor: DeviceDescriptor) => {
    animations.length = 0
    return createMarker(device, {
      materials: createMaterials(defaultSceneTheme()), theme: defaultSceneTheme(), descriptor,
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
  const device = (extra: Partial<HouseDevice> = {}): HouseDevice => ({ id: 'x', position: [0, 0, 2], ...extra })
  const cover = (deviceClass: string): DeviceDescriptor =>
    ({ id: 'p:c', pluginId: 'p', externalId: 'c', kind: 'cover', name: deviceClass, capabilities: ['open_close'], meta: { cover: { deviceClass } } } as DeviceDescriptor)
  const coverState = (position: number | undefined): DeviceState =>
    ({ kind: 'cover', updatedAt: 0, available: true, motion: 'stopped', ...(position === undefined ? {} : { position }) } as DeviceState)

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
