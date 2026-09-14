import { describe, expect, it } from 'vitest'
import { Box3, CylinderGeometry, Mesh, type MeshStandardMaterial, ShapeGeometry, Vector3, type BufferAttribute, type Texture } from 'three'
import { computeHouseGeometry, localToGeo, parseHouse, type DeviceDescriptor, type DeviceState, type PlacedHouseDevice } from '@kasbah/shared'
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
import { yawToRad } from '../lib/orientation'
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
  const marker = (device: PlacedHouseDevice, descriptor: DeviceDescriptor) => {
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
  const device = (extra: Partial<PlacedHouseDevice> = {}): PlacedHouseDevice => ({ id: 'x', position: [0, 0, 2], ...extra })
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
