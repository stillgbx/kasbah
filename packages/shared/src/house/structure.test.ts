import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse, safeParseHouse } from './validate'
import { applyHouseEditToJson } from './edit'
import { rectRoomAt, roomAgainstWall } from './shape'
import { PlacementError } from './place'
import type { Vec2 } from './geometry/vec2'

// Structure dans une séance d'édition : pièces et niveaux qui naissent ou disparaissent, nom et type.

type Room = { id: string; levelId: string; name: string; kind?: string; polygon: Vec2[]; walls?: { segment: number; kind?: string }[] }
type Level = { id: string; name: string; elevation: number; height?: number; roomOrder?: string[] }
type Device = { id: string; roomId?: string; levelId?: string; openingId?: string; position?: number[] }
type Doc = { rooms: Room[]; levels: Level[]; devices: Device[]; roof?: { levelId?: string }; meta?: { survey?: unknown } }
const as = (d: unknown) => d as Doc
const room = (d: unknown, id: string) => as(d).rooms.find((r) => r.id === id)
const level = (d: unknown, id: string) => as(d).levels.find((l) => l.id === id)

describe('une pièce qui naît', () => {
  it('contre le mur sud du salon : même ligne de relevé, une cloison mitoyenne, maison valide', () => {
    const shape = roomAgainstWall(demo as never, 'salon', 0)
    expect(shape).toEqual([[1000, 0], [310, 0], [310, -300], [1000, -300]])   // 310 : la cloison salon | entrée
    const { doc, blocking } = applyHouseEditToJson(demo, {
      newRooms: [{ id: 'bureau', levelId: 'rdc' }],
      shapes: { bureau: shape },
      rooms: { bureau: { name: 'Bureau' } },
    })
    expect(blocking).toEqual([])
    const bureau = room(doc, 'bureau')!
    expect(bureau.name).toBe('Bureau')
    expect(bureau.kind).toBeUndefined()                    // « pièce » : le défaut n'est pas écrit
    expect(Math.max(...bureau.polygon.map((p) => p[1]))).toBeCloseTo(-0.1, 4)   // cloison = deux murs intérieurs de 10 cm
    expect(Math.min(...room(doc, 'salon')!.polygon.map((p) => p[1]))).toBeCloseTo(0.1, 4)
    expect(room(doc, 'salon')!.walls?.some((w) => w.segment === 0 && w.kind === 'interior')).toBe(true)
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('au tap : un carré de 4 m centré au décimètre près', () => {
    expect(rectRoomAt(demo as never, 'rdc', [14.03, 2.96])).toEqual([[1200, 100], [1600, 100], [1600, 500], [1200, 500]])
  })

  it('qui chevauche une voisine bloque la séance', () => {
    const { blocking } = applyHouseEditToJson(demo, { newRooms: [{ id: 'x', levelId: 'rdc' }], shapes: { x: [[500, 100], [700, 100], [700, 300], [500, 300]] } })
    expect(blocking.some((b) => b.includes('chevauchent'))).toBe(true)
  })

  it('sans cotes, ou sur un niveau inconnu, est refusée', () => {
    expect(() => applyHouseEditToJson(demo, { newRooms: [{ id: 'x', levelId: 'rdc' }] })).toThrow(PlacementError)
    expect(() => applyHouseEditToJson(demo, { newRooms: [{ id: 'x', levelId: 'nope' }], shapes: { x: [[0, 0], [1, 0], [1, 1]] } })).toThrow(PlacementError)
    expect(() => applyHouseEditToJson(demo, { newRooms: [{ id: 'salon', levelId: 'rdc' }], shapes: { salon: [[0, 0], [1, 0], [1, 1]] } })).toThrow(PlacementError)
  })

  it('née puis retirée dans la même séance : rien ne change', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, {
      newRooms: [{ id: 'x', levelId: 'rdc' }], shapes: { x: [[1200, 0], [1500, 0], [1500, 300], [1200, 300]] },
      rooms: { x: { name: 'X' } }, removeRooms: ['x'],
    })
    expect(blocking).toEqual([])
    expect(room(doc, 'x')).toBeUndefined()
  })
})

describe('un niveau qui naît', () => {
  it('au-dessus : posé sur le dernier étage habité, le niveau du toit monte d\'autant', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { newLevels: [{ id: 'combles', name: 'Combles', side: 'above' }] })
    expect(blocking).toEqual([])
    expect(level(doc, 'combles')).toMatchObject({ elevation: 5.8, height: 2.6 })   // 3,05 + 2,5 + dalle 0,25
    expect(level(doc, 'toit')!.elevation).toBeCloseTo(8.4, 4)
    expect(as(doc).roof?.levelId).toBe('etage')             // vide : il ne prend pas encore le toit
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('deux étages de suite s\'empilent', () => {
    const { doc } = applyHouseEditToJson(demo, { newLevels: [{ id: 'a', name: 'A', side: 'above' }, { id: 'b', name: 'B', side: 'above' }] })
    expect(level(doc, 'b')!.elevation).toBeCloseTo(5.8 + 2.6 + 0.25, 4)
  })

  it('en dessous : un sous-sol sous le plus bas', () => {
    const { doc } = applyHouseEditToJson(demo, { newLevels: [{ id: 'ss', name: 'Sous-sol', side: 'below' }] })
    expect(level(doc, 'ss')!.elevation).toBeCloseTo(0.2 - 0.25 - 2.6, 4)
    expect(as(doc).levels[0]!.id).toBe('ss')
  })

  it('une pièce dessus : le toit passe sur lui (une fenêtre de toit restée dessous le signale)', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, {
      newLevels: [{ id: 'combles', name: 'Combles', side: 'above' }],
      newRooms: [{ id: 'grenier', levelId: 'combles' }],
      shapes: { grenier: rectRoomAt(demo as never, 'combles', [5, 4], 10, 8) },
    })
    expect(blocking).toEqual([])
    expect(as(doc).roof?.levelId).toBe('combles')
    const parsed = safeParseHouse(doc)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.issues.map((i) => i.message).join()).toContain('roof-window')
  })
})

describe('retirer', () => {
  it('une pièce : ses appareils restent connus sans place, la voisine regagne sa demi-cloison', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { removeRooms: ['salon'] })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon')).toBeUndefined()
    const light = as(doc).devices.find((d) => d.id === 'light.salon')!
    expect(light.position).toBeUndefined()
    expect(light.roomId).toBeUndefined()
    expect(as(doc).devices.find((d) => d.id === 'cover.baie')!.openingId).toBeUndefined()
    expect(as(doc).devices.find((d) => d.id === 'cover.cuisine')!.openingId).toBe('fen-cuisine')
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('une pièce : sa place dans l\'ordre d\'affichage part avec elle', () => {
    const ordered = { ...demo, levels: demo.levels.map((l) => (l.id === 'rdc' ? { ...l, roomOrder: ['salon', 'entree', 'cuisine'] } : l)) }
    const { doc } = applyHouseEditToJson(ordered, { removeRooms: ['salon'] })
    expect(level(doc, 'rdc')!.roomOrder).toEqual(['entree', 'cuisine'])
  })

  it('un niveau vide oui ; un niveau qui porte des pièces, ou des panneaux, non', () => {
    expect(level(applyHouseEditToJson({ ...demo, arrays: [] }, { removeLevels: ['toit'] }).doc, 'toit')).toBeUndefined()
    expect(applyHouseEditToJson(demo, { removeLevels: ['toit'] }).blocking).toEqual(['toit : niveau non vide'])
    const { doc, blocking } = applyHouseEditToJson(demo, { removeLevels: ['etage'] })
    expect(blocking).toEqual(['etage : niveau non vide'])
    expect(level(doc, 'etage')).toBeDefined()
  })

  it('l\'étage vidé puis retiré dans la séance : le toit redescend, le niveau part', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, {
      removeRooms: ['chambre1', 'chambre2', 'sdb', 'palier'], removeLevels: ['etage'],
    })
    expect(blocking).toEqual([])
    expect(level(doc, 'etage')).toBeUndefined()
    expect(as(doc).roof?.levelId).toBe('rdc')
  })
})

describe('nom et type', () => {
  it('renommer seul ne convertit pas la maison en relevé', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { rooms: { salon: { name: 'Séjour' } } })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon')!.name).toBe('Séjour')
    expect(as(doc).meta?.survey).toBeUndefined()
  })

  it('le salon devenu terrasse : sans mur, il laisse toute l\'épaisseur à ses voisines', () => {
    const { doc, blocking } = applyHouseEditToJson(demo, { rooms: { salon: { kind: 'terrace' } } })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon')!.kind).toBe('terrace')
    expect(room(doc, 'salon')!.walls?.filter((w) => w.kind === 'interior')).toEqual([])   // reste le passage ouvert
  })

  it('une pièce inconnue est refusée', () => {
    expect(() => applyHouseEditToJson(demo, { rooms: { nope: { name: 'X' } } })).toThrow(PlacementError)
  })
})
