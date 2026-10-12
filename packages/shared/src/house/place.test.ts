import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import { NEUTRAL_TUNING } from './schema'
import { addGardenItemToJson, addOpeningToJson, gardenItemPatchSchema, patchGardenItemInJson, removeGardenItemFromJson, patchOpeningInJson, PlacementError, placeDeviceInJson, putArrayInJson, removeArrayFromJson, removeDeviceFromJson, removeOpeningFromJson, setPluginInJson, setRenderTuningInJson, setRoomOrderInJson } from './place'

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

  it('écrit le décalage GPS d un véhicule, et [0, 0] l efface', () => {
    // un véhicule n'a pas de position : son entrée se crée par son deviceId, comme au renommage
    const entry = (doc: Record<string, unknown>) => devices(doc).find((x) => x.id === 'vehicle.model-s')
    const created = placeDeviceInJson(demo, 'vehicle.model-s', { deviceId: 'tesla:5YJ', gpsOffset: [2.5, -1] })
    expect(entry(created)).toEqual({ id: 'vehicle.model-s', deviceId: 'tesla:5YJ', gpsOffset: [2.5, -1] })
    expect(() => parseHouse(created)).not.toThrow()
    const cleared = placeDeviceInJson(created, 'vehicle.model-s', { gpsOffset: [0, 0] })
    expect(entry(cleared)).toEqual({ id: 'vehicle.model-s', deviceId: 'tesla:5YJ' })
    // un placement muet sur le décalage n'y touche pas
    const renamed = placeDeviceInJson(created, 'vehicle.model-s', { name: 'Voiture 1' })
    expect(entry(renamed)).toMatchObject({ gpsOffset: [2.5, -1], name: 'Voiture 1' })
  })

  it('écrit le décalage de la carte d une tondeuse, à part de son décalage GPS, et [0, 0] l efface', () => {
    const entry = (doc: Record<string, unknown>) => devices(doc).find((x) => x.id === 'mower.robot')
    const created = placeDeviceInJson(demo, 'mower.robot', { deviceId: 'automower:abc', mapOffset: [-3, 1.5] })
    expect(entry(created)).toEqual({ id: 'mower.robot', deviceId: 'automower:abc', mapOffset: [-3, 1.5] })
    expect(() => parseHouse(created)).not.toThrow()
    const both = placeDeviceInJson(created, 'mower.robot', { gpsOffset: [1, 0] })
    expect(entry(both)).toMatchObject({ gpsOffset: [1, 0], mapOffset: [-3, 1.5] })
    const cleared = placeDeviceInJson(both, 'mower.robot', { mapOffset: [0, 0] })
    expect(entry(cleared)).toEqual({ id: 'mower.robot', deviceId: 'automower:abc', gpsOffset: [1, 0] })
  })

  it('écrit la rotation d un véhicule, et 0 l efface', () => {
    const entry = (doc: Record<string, unknown>) => devices(doc).find((x) => x.id === 'vehicle.model-s')
    const created = placeDeviceInJson(demo, 'vehicle.model-s', { deviceId: 'tesla:5YJ', yawOffset: 180 })
    expect(entry(created)).toEqual({ id: 'vehicle.model-s', deviceId: 'tesla:5YJ', yawOffset: 180 })
    expect(() => parseHouse(created)).not.toThrow()
    const cleared = placeDeviceInJson(created, 'vehicle.model-s', { yawOffset: 0 })
    expect(entry(cleared)).toEqual({ id: 'vehicle.model-s', deviceId: 'tesla:5YJ' })
  })

  it('écrit la carrosserie et la couleur d un véhicule, et la chaîne vide les efface', () => {
    const entry = (doc: Record<string, unknown>) => devices(doc).find((x) => x.id === 'vehicle.model-s')
    const created = placeDeviceInJson(demo, 'vehicle.model-s', { deviceId: 'tesla:5YJ', model3d: 'tesla/model-s', bodyColor: '#b31b1b' })
    expect(entry(created)).toEqual({ id: 'vehicle.model-s', deviceId: 'tesla:5YJ', model3d: 'tesla/model-s', bodyColor: '#b31b1b' })
    expect(() => parseHouse(created)).not.toThrow()

    // 'none' est un CHOIX (la silhouette générique), pas une absence de choix : il s'écrit.
    const generic = placeDeviceInJson(created, 'vehicle.model-s', { model3d: 'none' })
    expect(entry(generic)).toMatchObject({ model3d: 'none', bodyColor: '#b31b1b' })

    const cleared = placeDeviceInJson(generic, 'vehicle.model-s', { model3d: '', bodyColor: '' })
    expect(entry(cleared)).toEqual({ id: 'vehicle.model-s', deviceId: 'tesla:5YJ' })
  })

  it("écrit les vantaux, la matière et la couleur d'un ouvrant, et la chaîne vide les efface", () => {
    // Ce que le fabricant ne dit pas d'un volet : combien de vantaux, en quoi, de quelle couleur.
    const entry = (doc: Record<string, unknown>) => devices(doc).find((x) => x.id === 'cover.baie')
    const dressed = placeDeviceInJson(demo, 'cover.baie', { leaves: 2, coverMaterial: 'wood', coverColor: '#f2efe6' })
    expect(entry(dressed)).toMatchObject({ leaves: 2, coverMaterial: 'wood', coverColor: '#f2efe6' })
    expect(() => parseHouse(dressed)).not.toThrow()
    // la place et l'ouverture liée ne bougent pas : on n'a réglé que ce qui est DESSINÉ
    expect(entry(dressed)).toMatchObject({ position: entry(demo as Record<string, unknown>)!.position, openingId: 'baie' })

    const bare = placeDeviceInJson(dressed, 'cover.baie', { coverMaterial: '', coverColor: '' })
    expect(entry(bare)).not.toHaveProperty('coverMaterial')
    expect(entry(bare)).not.toHaveProperty('coverColor')
    expect(entry(bare)).toMatchObject({ leaves: 2 })      // les vantaux, eux, n'ont pas d'« automatique »
    expect(() => parseHouse(bare)).not.toThrow()
  })

  it("écrit la silhouette d'une enceinte, et la chaîne vide la ramène au cylindre", () => {
    const entry = (doc: Record<string, unknown>) => devices(doc).find((x) => x.id === 'speaker.salon')
    expect(entry(demo as Record<string, unknown>)).not.toHaveProperty('speakerShape')
    const bar = placeDeviceInJson(demo, 'speaker.salon', { speakerShape: 'bar' })
    expect(entry(bar)).toMatchObject({ speakerShape: 'bar' })
    expect(() => parseHouse(bar)).not.toThrow()
    // la place ne bouge pas : on n'a réglé que la silhouette
    expect(entry(bar)!.position).toEqual(entry(demo as Record<string, unknown>)!.position)

    const pebble = placeDeviceInJson(bar, 'speaker.salon', { speakerShape: 'pebble' })
    expect(entry(pebble)).toMatchObject({ speakerShape: 'pebble' })

    const block = placeDeviceInJson(pebble, 'speaker.salon', { speakerShape: 'block' })
    expect(entry(block)).toMatchObject({ speakerShape: 'block' })
    expect(() => parseHouse(block)).not.toThrow()

    const cleared = placeDeviceInJson(block, 'speaker.salon', { speakerShape: '' })
    expect(entry(cleared)).not.toHaveProperty('speakerShape')
    expect(() => parseHouse(cleared)).not.toThrow()
  })

  it("recale sur sa baie l'ouvrant qui l'habille, quand elle bouge et quand on la lie", () => {
    const place = (doc: Record<string, unknown>, id: string) => devices(doc).find((x) => x.id === id)!.position
    // le fichier de démo porte la même dérive que la vraie maison : le volet est posé 1,7 m à côté
    expect(place(demo as unknown as Record<string, unknown>, 'cover.baie')).toEqual([4.2, 0.05, 1.3])

    // la baie du salon glisse de 50 cm le long de son mur (y = 0, de x = 3,2 à 10) : le volet suit,
    // au centre de la baie — 3,2 + 2 + 2,4 / 2 — et à mi-hauteur (allège 0,2 + 2,15 / 2)
    const moved = patchOpeningInJson(demo, 'salon', 'baie', { offset: 2 })
    expect(place(moved, 'cover.baie')).toEqual([6.4, 0, 1.275])
    expect(() => parseHouse(moved)).not.toThrow()
    // les autres ouvrants n'ont pas bougé : seule la baie touchée compte
    expect(place(moved, 'cover.cuisine')).toEqual([9.95, 5.8, 1.6])

    // LIER un ouvrant lui donne aussi la place de sa baie, dans la même écriture
    const linked = placeDeviceInJson(demo, 'cover.terrasse', { openingId: 'fen-salon-est' })
    // fenêtre du mur est du salon (segment 1, de [10, 0] à [10, 5]), à 1,5 m du coin, large de 1,2
    expect(place(linked, 'cover.terrasse')).toEqual([10, 2.1, 1.55])
    expect(() => parseHouse(linked)).not.toThrow()
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

  it('ecrit la puissance de sortie max des onduleurs du champ, et 0 quand on ne la sait pas', () => {
    const out = putArrayInJson(demo, 'pv-sud', { maxOutputW: 480 })
    expect(first(out).maxOutputW).toBe(480)
    expect(parseHouse(out).arrays[0]!.maxOutputW).toBe(480)
    // un champ qui n'en dit rien : pas de plafond invente (la vue Energie ne marque alors rien)
    expect(parseHouse(demo).arrays[0]!.maxOutputW).toBe(0)
  })

  it('patche le MODULE champ par champ : coucher un panneau ne perd pas sa puissance crete', () => {
    const wp = putArrayInJson(demo, 'pv-sud', { panel: { width: 1.13, height: 1.76, peakW: 500 } })
    const laid = putArrayInJson(wp, 'pv-sud', { panel: { width: 1.76, height: 1.13 } })
    // sans la fusion, `panel` etait remplace en entier et la crete retombait sur la valeur par defaut
    expect(first(laid).panel).toEqual({ width: 1.76, height: 1.13, peakW: 500 })
    expect(parseHouse(laid).arrays[0]!.panel.peakW).toBe(500)
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

describe('addOpeningToJson', () => {
  const openingsOf = (doc: Record<string, unknown>, roomId: string) =>
    ((doc.rooms as Record<string, unknown>[]).find((r) => r.id === roomId)!.openings as Record<string, unknown>[])

  it('pose l ouverture dans sa piece et laisse les autres tranquilles', () => {
    const out = addOpeningToJson(demo, 'salon', { id: 'window-1', type: 'window', segment: 3, offset: 1, width: 1.2, height: 1.2, sill: 0.9 })
    expect(openingsOf(out, 'salon').map((o) => o.id)).toEqual(['baie', 'fen-salon-est', 'puits-salon', 'window-1'])
    expect(openingsOf(out, 'cuisine')).toEqual(openingsOf(demo as unknown as Record<string, unknown>, 'cuisine'))
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('n ecrit l allege que si elle dit quelque chose — sauf pour une fenetre, ou 0 est un choix', () => {
    const door = addOpeningToJson(demo, 'salon', { id: 'door-1', type: 'door', segment: 3, offset: 1, width: 0.9, height: 2.1, sill: 0 })
    expect(openingsOf(door, 'salon').at(-1)).not.toHaveProperty('sill')
    const flat = addOpeningToJson(demo, 'salon', { id: 'window-1', type: 'window', segment: 3, offset: 1, width: 1.2, height: 2.1, sill: 0 })
    expect(openingsOf(flat, 'salon').at(-1)).toMatchObject({ sill: 0 })
  })

  it('refuse un id deja pris, meme dans une AUTRE piece (un ouvrant le nommerait sans savoir ou)', () => {
    expect(() => addOpeningToJson(demo, 'salon', { id: 'fen-cuisine', type: 'window', segment: 3, offset: 1, width: 1, height: 1 })).toThrow(PlacementError)
    expect(() => addOpeningToJson(demo, 'nope', { id: 'x', type: 'window', segment: 0, offset: 1, width: 1, height: 1 })).toThrow(PlacementError)
  })

  it('does not mutate the input document', () => {
    const before = JSON.stringify(demo)
    addOpeningToJson(demo, 'salon', { id: 'window-1', type: 'window', segment: 3, offset: 1, width: 1.2, height: 1.2, sill: 0.9 })
    removeOpeningFromJson(demo, 'salon', 'baie')
    expect(JSON.stringify(demo)).toBe(before)
  })
})

describe('removeOpeningFromJson', () => {
  it('libere l ouvrant qui l habillait, dans la meme ecriture', () => {
    const out = removeOpeningFromJson(demo, 'salon', 'baie')                    // cover.baie y est posé
    const room = (out.rooms as Record<string, unknown>[]).find((r) => r.id === 'salon')!
    expect((room.openings as Record<string, unknown>[]).map((o) => o.id)).toEqual(['fen-salon-est', 'puits-salon'])
    expect(devices(out).find((d) => d.id === 'cover.baie')).not.toHaveProperty('openingId')
    expect(devices(out).find((d) => d.id === 'cover.cuisine')).toMatchObject({ openingId: 'fen-cuisine' })
    // sans cette libération, la maison entière serait refusée : l'ouvrant nommerait une ouverture disparue
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('ne touche pas aux appareils quand rien n etait pose dessus', () => {
    const out = removeOpeningFromJson(demo, 'salon', 'fen-salon-est')
    expect(out.devices).toBe(demo.devices)
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('refuse une piece inconnue ou une ouverture qui n y est pas', () => {
    expect(() => removeOpeningFromJson(demo, 'nope', 'baie')).toThrow(PlacementError)
    expect(() => removeOpeningFromJson(demo, 'cuisine', 'baie')).toThrow(PlacementError)
  })
})

describe('setRenderTuningInJson', () => {
  const render = (doc: Record<string, unknown>) => doc.render as { tuning?: Record<string, number> } | undefined

  it('écrit le réglage et le relit tel quel', () => {
    const out = setRenderTuningInJson(demo, { ...NEUTRAL_TUNING, bloomThreshold: 1.45, toneMapping: 'agx' })
    expect(render(out)!.tuning!.bloomThreshold).toBe(1.45)
    expect(parseHouse(out).render!.tuning!.toneMapping).toBe('agx')
  })

  it('efface la section quand le réglage est neutre : une maison sans retouche n’en porte pas', () => {
    const tuned = setRenderTuningInJson(demo, { ...NEUTRAL_TUNING, exposure: 0.8 })
    const back = setRenderTuningInJson(tuned, NEUTRAL_TUNING)
    expect(back.render).toBeUndefined()
    expect(parseHouse(back).render).toBeUndefined()
  })

  it('ne modifie pas le document d’entrée', () => {
    const before = JSON.stringify(demo)
    setRenderTuningInJson(demo, { ...NEUTRAL_TUNING, vignette: 1.5 })
    expect(JSON.stringify(demo)).toBe(before)
  })
})

describe('éléments du jardin', () => {
  const garden = (doc: Record<string, unknown>) => (doc.site as Record<string, unknown>).garden as Record<string, unknown>[]
  const base = addGardenItemToJson(demo, { id: 'oak-1', kind: 'broadleaf', center: [3, -4], height: 8 })

  it('ajoute un élément valide, sans écrire un cap nul', () => {
    expect(garden(base)).toEqual([{ id: 'oak-1', kind: 'broadleaf', center: [3, -4], height: 8 }])
    expect(parseHouse(base).site.garden[0]!.kind).toBe('broadleaf')
  })

  it('refuse un id déjà pris', () => {
    expect(() => addGardenItemToJson(base, { id: 'oak-1', kind: 'rock', center: [0, 0], height: 1 })).toThrow(PlacementError)
  })

  it('règle seulement les champs donnés, et un cap nul efface le cap', () => {
    const turned = patchGardenItemInJson(base, 'oak-1', { yaw: 45, height: 10 })
    expect(garden(turned)[0]).toMatchObject({ yaw: 45, height: 10, center: [3, -4] })
    expect(garden(patchGardenItemInJson(turned, 'oak-1', { yaw: 0 }))[0]).not.toHaveProperty('yaw')
    expect(() => patchGardenItemInJson(base, 'nope', { height: 2 })).toThrow(PlacementError)
  })

  it('pose une espèce, et la chaîne vide la retire', () => {
    const cherry = patchGardenItemInJson(base, 'oak-1', { species: 'cherry' })
    expect(parseHouse(cherry).site.garden[0]!.species).toBe('cherry')
    expect(garden(patchGardenItemInJson(cherry, 'oak-1', { species: '' }))[0]).not.toHaveProperty('species')
  })

  it('une haie porte sa longueur, sa largeur et son espacement, posés puis réglés, dans les bornes', () => {
    const hedge = addGardenItemToJson(demo, { id: 'hedge-1', kind: 'hedge', center: [0, 0], height: 1.8, length: 4 })
    expect(parseHouse(hedge).site.garden[0]).toMatchObject({ kind: 'hedge', length: 4 })
    expect(garden(patchGardenItemInJson(hedge, 'hedge-1', { length: 7.5 }))[0]!.length).toBe(7.5)
    expect(() => parseHouse(patchGardenItemInJson(hedge, 'hedge-1', { length: 0.1 }))).toThrow()
    expect(garden(patchGardenItemInJson(hedge, 'hedge-1', { width: 1.2 }))[0]!.width).toBe(1.2)
    expect(() => parseHouse(patchGardenItemInJson(hedge, 'hedge-1', { width: 9 }))).toThrow()
    const spaced = patchGardenItemInJson(hedge, 'hedge-1', { spacing: 1.5 })
    expect(garden(spaced)[0]!.spacing).toBe(1.5)
    expect(garden(patchGardenItemInJson(spaced, 'hedge-1', { spacing: null }))[0]).not.toHaveProperty('spacing')   // retour à l'automatique
    expect(gardenItemPatchSchema.parse({ spacing: null })).toEqual({ spacing: null })
    expect(() => parseHouse(patchGardenItemInJson(hedge, 'hedge-1', { spacing: 0.05 }))).toThrow()
  })

  it('retire un élément', () => {
    expect(garden(removeGardenItemFromJson(base, 'oak-1'))).toEqual([])
    expect(() => removeGardenItemFromJson(base, 'nope')).toThrow(PlacementError)
  })

  it('rejette une maison où un élément reprend l\'id d\'une pièce', () => {
    const roomId = (demo.rooms[0] as { id: string }).id
    expect(() => parseHouse(addGardenItemToJson(demo, { id: roomId, kind: 'rock', center: [0, 0], height: 1 }))).toThrow()
  })
})
