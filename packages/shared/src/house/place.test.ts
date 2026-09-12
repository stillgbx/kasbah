import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import { PlacementError, placeDeviceInJson, putArrayInJson, removeArrayFromJson, removeDeviceFromJson, setPluginInJson, setRoomOrderInJson } from './place'

const devices = (doc: Record<string, unknown>) => doc.devices as Record<string, unknown>[]

describe('removeDeviceFromJson', () => {
  it('drops the entry and leaves the rest of the house untouched', () => {
    const out = removeDeviceFromJson(demo, 'light.salon')
    expect(devices(out).find((x) => x.id === 'light.salon')).toBeUndefined()
    expect(devices(out)).toHaveLength(demo.devices.length - 1)
    expect(out.rooms).toBe(demo.rooms)
    expect(() => parseHouse(out)).not.toThrow()
    expect(() => removeDeviceFromJson(demo, 'nope')).toThrow(PlacementError)
  })
})

describe('removeDeviceFromJson et les champs de panneaux', () => {
  const arrays = (doc: Record<string, unknown>) => doc.arrays as Record<string, unknown>[]

  it('emporte les champs qui nomment cet appareil, et laisse les autres', () => {
    const owned = putArrayInJson(demo, 'pv-sud', { siteId: 'mock:energy-site' })
    const out = removeDeviceFromJson(owned, 'energy.site')                     // deviceId: mock:energy-site
    expect(arrays(out).map((a) => a.id)).toEqual(['pv-nord'])                  // le champ sans siteId reste
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('ne touche pas aux champs quand l appareil retire n en porte aucun', () => {
    const out = removeDeviceFromJson(demo, 'light.salon')
    expect(out.arrays).toBe(demo.arrays)
  })
})

describe('placeDeviceInJson', () => {
  it('moves an existing device and keeps the rest of its entry', () => {
    const out = placeDeviceInJson(demo, 'light.salon', { position: [5, 3, 0.75], mount: 'free' })
    const d = devices(out).find((x) => x.id === 'light.salon')!
    expect(d).toMatchObject({ name: 'Plafonnier salon', deviceId: 'mock:light-living', roomId: 'salon', position: [5, 3, 0.75], mount: 'free' })
    expect(devices(out)).toHaveLength(demo.devices.length)
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('re-anchors to another room of the level and follows its levelId', () => {
    const out = placeDeviceInJson(demo, 'light.salon', { position: [6.6, 6.5, 2.4], roomId: 'cuisine' })
    const d = devices(out).find((x) => x.id === 'light.salon')!
    expect(d.roomId).toBe('cuisine')
    expect(d.levelId).toBe('rdc')
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('writes the orientation when given, and leaves it alone otherwise', () => {
    const turned = placeDeviceInJson(demo, 'light.salon', { position: [5, 3, 0.75], yaw: 270 })
    expect(devices(turned).find((x) => x.id === 'light.salon')).toMatchObject({ position: [5, 3, 0.75], yaw: 270 })
    // un placement sans yaw ne touche pas à l'orientation déjà écrite
    const moved = placeDeviceInJson(turned, 'light.salon', { position: [5.5, 3, 0.75] })
    expect(devices(moved).find((x) => x.id === 'light.salon')).toMatchObject({ position: [5.5, 3, 0.75], yaw: 270 })
    const created = placeDeviceInJson(demo, 'auto.hue-xyz', { position: [1, 1, 1.2], roomId: 'salon', deviceId: 'hue:xyz', yaw: 90 })
    expect(devices(created).at(-1)).toEqual({ id: 'auto.hue-xyz', deviceId: 'hue:xyz', position: [1, 1, 1.2], roomId: 'salon', yaw: 90 })
    expect(() => parseHouse(created)).not.toThrow()
  })

  it('writes the drawn size when given (a gate has no opening to measure it)', () => {
    const sized = placeDeviceInJson(demo, 'light.salon', { position: [5, 3, 0.75], size: { width: 3.5, height: 1.5 } })
    expect(devices(sized).find((x) => x.id === 'light.salon')).toMatchObject({ size: { width: 3.5, height: 1.5 } })
    // un placement sans taille ne touche pas à celle déjà écrite
    const moved = placeDeviceInJson(sized, 'light.salon', { position: [5.5, 3, 0.75] })
    expect(devices(moved).find((x) => x.id === 'light.salon')).toMatchObject({ size: { width: 3.5, height: 1.5 } })
    expect(() => parseHouse(moved)).not.toThrow()
    const created = placeDeviceInJson(demo, 'auto.tahoma-portail', { position: [1, 1, 1], roomId: 'salon', deviceId: 'tahoma:portail', size: { width: 3, height: 1.6 }, leaves: 2 })
    expect(devices(created).at(-1)).toMatchObject({ size: { width: 3, height: 1.6 }, leaves: 2 })
    expect(() => parseHouse(created)).not.toThrow()
    // les battants s'écrivent seuls, et un placement sans eux n'y touche pas
    const oneLeaf = placeDeviceInJson(sized, 'light.salon', { position: [5, 3, 0.75], leaves: 1 })
    expect(devices(oneLeaf).find((x) => x.id === 'light.salon')).toMatchObject({ leaves: 1 })
    expect(devices(placeDeviceInJson(oneLeaf, 'light.salon', { position: [5, 3, 0.8] })).find((x) => x.id === 'light.salon')).toMatchObject({ leaves: 1 })
  })

  it('anchors on a level alone when the device is dropped outside any room', () => {
    // création hors pièce (appareil découvert tard, posé dans un couloir non relevé)
    const created = placeDeviceInJson(demo, 'auto.google_cast-tv', { position: [3, 3, 1.2], levelId: 'rdc', deviceId: 'google_cast:tv' })
    expect(devices(created).at(-1)).toEqual({ id: 'auto.google_cast-tv', deviceId: 'google_cast:tv', position: [3, 3, 1.2], levelId: 'rdc' })
    expect(() => parseHouse(created)).not.toThrow()
    // un appareil de pièce qui sort dans le couloir : la pièce tombe, le niveau reste
    const out = placeDeviceInJson(demo, 'light.salon', { position: [9, 9, 2.4], levelId: 'rdc' })
    expect(devices(out).find((x) => x.id === 'light.salon')).toMatchObject({ levelId: 'rdc' })
    expect(devices(out).find((x) => x.id === 'light.salon')!.roomId).toBeUndefined()
    // la pièce l'emporte sur le niveau quand les deux sont donnés
    const both = placeDeviceInJson(demo, 'light.salon', { position: [6.6, 6.5, 2.4], roomId: 'cuisine', levelId: 'etage' })
    expect(devices(both).find((x) => x.id === 'light.salon')).toMatchObject({ roomId: 'cuisine', levelId: 'rdc' })
    expect(() => placeDeviceInJson(demo, 'light.salon', { position: [0, 0, 0], levelId: 'nope' })).toThrow(PlacementError)
  })

  it('creates a minimal entry for a device absent from the JSON', () => {
    const out = placeDeviceInJson(demo, 'auto.hue-abc', { position: [1, 1, 2.4], roomId: 'salon', mount: 'ceiling', deviceId: 'hue:abc' })
    expect(devices(out).at(-1)).toEqual({ id: 'auto.hue-abc', deviceId: 'hue:abc', position: [1, 1, 2.4], roomId: 'salon', mount: 'ceiling' })
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('refuses to create without deviceId and rejects unknown rooms', () => {
    expect(() => placeDeviceInJson(demo, 'nope', { position: [0, 0, 0] })).toThrow(PlacementError)
    expect(() => placeDeviceInJson(demo, 'light.salon', { position: [0, 0, 0], roomId: 'veranda' })).toThrow(PlacementError)
  })

  it('does not mutate the input document', () => {
    const before = JSON.stringify(demo)
    placeDeviceInJson(demo, 'light.salon', { position: [0, 0, 0] })
    expect(JSON.stringify(demo)).toBe(before)
  })
})

describe('setRoomOrderInJson', () => {
  const levels = (doc: Record<string, unknown>) => doc.levels as Record<string, unknown>[]

  it('writes the order on the level and keeps the rest of it', () => {
    const out = setRoomOrderInJson(demo, 'etage', ['sdb', 'chambre1'])
    const l = levels(out).find((x) => x.id === 'etage')!
    expect(l.roomOrder).toEqual(['sdb', 'chambre1'])
    expect(l.name).toBe(demo.levels.find((x) => x.id === 'etage')!.name)
    expect(levels(out).find((x) => x.id === 'rdc')!.roomOrder).toBeUndefined()
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('rejects an unknown level, a room of another level and duplicates', () => {
    expect(() => setRoomOrderInJson(demo, 'cave', ['sdb'])).toThrow(PlacementError)
    expect(() => setRoomOrderInJson(demo, 'etage', ['salon'])).toThrow(PlacementError)
    expect(() => setRoomOrderInJson(demo, 'etage', ['sdb', 'sdb'])).toThrow(PlacementError)
  })

  it('does not mutate the input document', () => {
    const before = JSON.stringify(demo)
    setRoomOrderInJson(demo, 'etage', ['sdb'])
    expect(JSON.stringify(demo)).toBe(before)
  })
})

describe('setPluginInJson', () => {
  const plugins = (doc: Record<string, unknown>) => doc.plugins as Record<string, Record<string, unknown>>

  it('writes the default section in full before applying the patch', () => {
    // sans ca, activer un fabricant dans une maison muette eteindrait la simulation, que seul le
    // defaut du schema gardait allumee
    const out = setPluginInJson(demo, 'hue', { enabled: true })
    expect(plugins(out).hue).toEqual({ enabled: true })
    expect(plugins(out).mock).toMatchObject({ enabled: true })
    expect(parseHouse(out).plugins.mock!.enabled).toBe(true)
  })

  it('merges sub-items key by key and leaves the other plugins alone', () => {
    const one = setPluginInJson(demo, 'mock', { parts: { energy: false } })
    const two = setPluginInJson(one, 'mock', { parts: { cover: false } })
    expect(plugins(two).mock!.parts).toEqual({ energy: false, cover: false })
    expect(plugins(two).mock!.enabled).toBe(true)
    expect(() => parseHouse(two)).not.toThrow()
  })

  it('does not mutate the input document', () => {
    const before = JSON.stringify(demo)
    setPluginInJson(demo, 'hue', { enabled: true })
    expect(JSON.stringify(demo)).toBe(before)
  })
})

describe('putArrayInJson', () => {
  const arrays = (doc: Record<string, unknown>) => doc.arrays as Record<string, unknown>[]
  const first = (doc: Record<string, unknown>) => arrays(doc).find((a) => a.id === 'pv-sud')!

  it('creates a field on a known level and keeps only what it was given', () => {
    const out = putArrayInJson(demo, 'pv-est', { levelId: 'toit', origin: [3, 4, 0], rows: 2, cols: 5, slope: 35, panels: ['mock:p1', null] })
    const made = arrays(out).find((a) => a.id === 'pv-est')!
    expect(made).toEqual({ id: 'pv-est', levelId: 'toit', origin: [3, 4, 0], rows: 2, cols: 5, slope: 35, panels: ['mock:p1'] })
    expect(arrays(out)).toHaveLength(demo.arrays.length + 1)
    expect(() => putArrayInJson(demo, 'pv-est', { levelId: 'grenier', origin: [0, 0, 0] })).toThrow(PlacementError)
    expect(() => putArrayInJson(demo, 'pv-est', { rows: 2 })).toThrow(PlacementError)          // ni niveau ni origine
    expect(() => putArrayInJson(demo, 'pv-est', { levelId: 'toit', rows: 2 })).toThrow(PlacementError)
  })

  it('updates a field in place and leaves its other settings alone', () => {
    const out = putArrayInJson(demo, 'pv-sud', { yaw: 90 })
    expect(first(out)).toMatchObject({ yaw: 90, slope: 35, rows: 2, cols: 5, name: 'Champ sud' })
    expect(first(out).panels).toEqual(demo.arrays[0]!.panels)
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('fits the inverters to the grid when it shrinks, and drops the empty tail', () => {
    // sans ca, reduire 2 x 5 en 2 x 3 laisserait dix onduleurs pour six emplacements : la validation
    // refuserait le champ en plein geste
    const out = putArrayInJson(demo, 'pv-sud', { rows: 2, cols: 3 })
    expect(first(out).panels).toHaveLength(6)
    expect(() => parseHouse(out)).not.toThrow()
    const tail = putArrayInJson(demo, 'pv-sud', { panels: ['mock:panel-s01', null, null] })
    expect(tail.arrays as unknown[]).toBeDefined()
    expect(first(tail).panels).toEqual(['mock:panel-s01'])
  })

  it('does not mutate the input document', () => {
    const before = JSON.stringify(demo)
    putArrayInJson(demo, 'pv-sud', { yaw: 90 })
    removeArrayFromJson(demo, 'pv-sud')
    expect(JSON.stringify(demo)).toBe(before)
  })
})

describe('removeArrayFromJson', () => {
  it('drops the field and frees its inverters', () => {
    const out = removeArrayFromJson(demo, 'pv-sud')
    expect((out.arrays as Record<string, unknown>[]).map((a) => a.id)).toEqual(['pv-nord'])
    expect(() => parseHouse(out)).not.toThrow()
    expect(() => removeArrayFromJson(demo, 'nope')).toThrow(PlacementError)
  })
})
