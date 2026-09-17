import { describe, expect, it } from 'vitest'
import { DEVICE_GET, LIST_DEVICES } from './__fixtures__/melcloud'
import { lastSeenAt, toDescriptors, toDeviceLinks, toStatePatch, toSystem, toZones, unitAvailable } from './mapping'

// Deux familles de cas, et la différence compte.
//
// `__fixtures__/melcloud.ts` est la CAPTURE du vrai compte : c'est elle qui fait foi, et le dernier
// bloc de ce fichier la rejoue telle quelle.
//
// Les charges utiles ci-dessous, elles, sont FABRIQUÉES, et restent volontairement hors de
// `__fixtures__/` pour qu'on ne les confonde jamais avec du capturé. Elles ne servent qu'à une
// chose que la capture ne peut pas prouver à elle seule : que le parcours trouve les appareils SANS
// rien supposer de leur chemin. La vraie maison range le sien sous `Structure.Devices`, mais une
// installation à étages ou à zones le range deux niveaux plus bas, et personne ici n'a une telle
// installation sous la main pour le vérifier.

/** Une machine posée directement sous la structure du bâtiment. */
const AT_ROOT = {
  ID: 1, Name: 'Maison', Structure: {
    Devices: [{ DeviceID: 111, BuildingID: 1, DeviceName: 'Ecodan Nord', Device: { DeviceType: 1 } }],
    Areas: [], Floors: [],
  },
}

/** La même, rangée sous une zone d'un étage — deux niveaux plus bas. */
const IN_FLOOR_AREA = {
  ID: 2, Name: 'Annexe', Structure: {
    Devices: [], Areas: [],
    Floors: [{ ID: 9, Name: 'RDC', Areas: [{ ID: 8, Devices: [{ DeviceID: 222, BuildingID: 2, DeviceName: 'Ecodan Sud', Device: { DeviceType: 1 } }] }], Devices: [] }],
  },
}

describe('MELCloud — inventaire', () => {
  it('trouve les appareils quel que soit leur rangement dans la structure', () => {
    const links = toDeviceLinks([AT_ROOT, IN_FLOOR_AREA])
    expect(links.map((l) => l.deviceId)).toEqual(['111', '222'])
    expect(links.map((l) => l.buildingName)).toEqual(['Maison', 'Annexe'])
  })

  it('reconnaît une Ecodan comme une machine air-eau', () => {
    const [link] = toDeviceLinks([AT_ROOT])
    expect(link).toMatchObject({ deviceId: '111', buildingId: '1', name: 'Ecodan Nord', family: 'atw', deviceType: 1 })
  })

  it('ne compte pas deux fois une machine dont le sous-objet répète son identifiant', () => {
    const repeated = {
      ID: 3, Name: 'Maison', Structure: {
        Devices: [{ DeviceID: 333, BuildingID: 3, DeviceName: 'Ecodan', Device: { DeviceID: 333, DeviceType: 1 } }],
      },
    }
    expect(toDeviceLinks([repeated]).map((l) => l.deviceId)).toEqual(['333'])
  })

  it('garde les autres machines quand l’une d’elles a une forme inattendue', () => {
    const mixed = {
      ID: 4, Name: 'Maison', Structure: {
        Devices: [
          { DeviceID: { oops: true }, DeviceName: 'machine illisible' },
          { DeviceID: 444, BuildingID: 4, DeviceName: 'Ecodan Est', Device: { DeviceType: 1 } },
        ],
      },
    }
    expect(toDeviceLinks([mixed]).map((l) => l.deviceId)).toEqual(['444'])
  })

  it('accepte un type d’appareil posé à la racine plutôt que dans le sous-objet', () => {
    const flat = { ID: 5, Name: 'Maison', Structure: { Devices: [{ DeviceID: 555, BuildingID: 5, DeviceType: 1 }] } }
    expect(toDeviceLinks([flat])[0]).toMatchObject({ family: 'atw', name: 'MELCloud 555' })
  })

  it('rend une liste vide sur une réponse vide ou inattendue, sans lever', () => {
    expect(toDeviceLinks([])).toEqual([])
    expect(toDeviceLinks(null)).toEqual([])
    expect(toDeviceLinks({ unexpected: 'shape' })).toEqual([])
  })
})

describe('MELCloud — la capture du vrai compte', () => {
  it('trouve l’unique machine de l’installation réelle', () => {
    const links = toDeviceLinks(LIST_DEVICES)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ name: 'Chauffage', family: 'atw', deviceType: 1, buildingName: 'Maison' })
  })

  /**
   * Trois machines physiques (une cascade de Zubadan derrière un seul FTC) n'apparaissent PAS comme
   * trois appareils : MELCloud n'en montre qu'un. Le mappage ne doit donc jamais supposer qu'un
   * appareil vaut une machine — ce test est là pour que la supposition ne revienne pas par la
   * fenêtre le jour où quelqu'un lira « 3 PAC » quelque part.
   */
  it('ne voit qu’un appareil là où il y a trois machines', () => {
    expect(toDeviceLinks(LIST_DEVICES)).toHaveLength(1)
  })
})

/** Instant de référence : deux minutes après la dernière remontée de la capture (18:55 locale). */
const NOW = new Date('2026-09-17T18:57:00').getTime()

describe('MELCloud — les deux zones, lues sur la capture', () => {
  const link = toDeviceLinks(LIST_DEVICES)[0]!

  it('lit la zone 1 sur l’ambiante et la zone 2 sur l’eau de départ', () => {
    const [z1, z2] = toZones(link.fields)
    expect(z1).toMatchObject({ zone: 1, control: 'room', currentTempC: 23, targetTempC: 19.5, bounds: [0, 40] })
    expect(z2).toMatchObject({ zone: 2, control: 'flow', currentTempC: 20, targetTempC: 45, bounds: [30, 60] })
  })

  /**
   * LE piège de cette installation : la zone 2 n'a pas de sonde d'ambiance et MELCloud rend -39,
   * pas un `null`. Une lecture naïve publierait une pièce à -39 °C toute l'année.
   */
  it('ne publie jamais la sentinelle -39 de la sonde absente', () => {
    const z2 = toZones(link.fields)[1]!
    expect(link.fields.RoomTemperatureZone2).toBe(-39)   // ce que le fabricant envoie
    expect(z2.currentTempC).toBe(20)                      // ce qu'on en publie
  })

  it('retombe sur le départ si la sonde d’une zone en ambiante déraille', () => {
    const broken = { ...link.fields, RoomTemperatureZone1: -39 }
    expect(toZones(broken)[0]).toMatchObject({ control: 'flow', currentTempC: 20.5, targetTempC: 60 })
  })

  it('publie un climate par zone, en lecture seule et sans proposer le froid', () => {
    const [d1, d2] = toDescriptors(link)
    expect(d1).toMatchObject({ id: 'melcloud:111111-z1', kind: 'climate', name: 'Chauffage', capabilities: ['current_temp'] })
    expect(d2!.id).toBe('melcloud:111111-z2')
    // `CanCool: false` : « Refroidir » ne doit pas figurer dans les modes annoncés
    expect(d1!.meta.climate?.modes).not.toContain('cool')
    expect(d1!.meta.climate?.control).toBe('room')
    expect(d2!.meta.climate?.control).toBe('flow')
    expect(d2!.meta.targetTempC).toEqual([30, 60])
  })

  /** Allumée mais au repos : c'est l'état de septembre, et `mode` seul ne saurait pas le dire. */
  it('distingue « allumée » de « en train de chauffer »', () => {
    const zones = toZones(link.fields)
    for (const z of zones) {
      expect(toStatePatch(link.fields, z, NOW)).toMatchObject({ available: true, mode: 'heat', action: 'idle' })
    }
  })

  it('éteint les zones quand la machine est éteinte', () => {
    const off = { ...link.fields, Power: false }
    expect(toStatePatch(off, toZones(off)[0]!, NOW)).toMatchObject({ mode: 'off', action: 'off' })
  })
})

describe('MELCloud — l’état de la machine', () => {
  const link = toDeviceLinks(LIST_DEVICES)[0]!

  it('résume ce que la vue Chauffage a besoin de montrer', () => {
    expect(toSystem(link, NOW)).toMatchObject({
      name: 'Chauffage', power: true, offline: false,
      outdoorTempC: 22, flowTempC: 20.5, returnTempC: 20.5, condensingTempC: 40.57, demandPercent: 100,
      defrosting: false, boosterHeater: false, immersionHeater: false, valve3Way: false,
      pumps: [false, false, false, false],
    })
  })

  /** `ErrorCode` VAUT 8000 au repos : le lire comme un booléen mettrait la maison en panne à vie. */
  it('ne prend pas le code d’erreur 8000 pour une panne', () => {
    const s = toSystem(link, NOW)
    expect(s.error.code).toBe(8000)
    expect(s.error.hasError).toBe(false)
  })

  /** Sans compteur, la vue doit pouvoir OMETTRE la consommation plutôt qu'afficher des zéros. */
  it('dit que cette machine n’a pas de compteur d’énergie', () => {
    expect(toSystem(link, NOW).energyMeter).toBe(false)
  })
})

describe('MELCloud — les champs qui ne sont pas là où on les croit', () => {
  /**
   * `LastCommunication` n'existe QUE dans `Device/Get`. Le sondage lit `ListDevices`, qui porte
   * `LastTimeStamp` : lire le premier sur le second donnait un champ nul en permanence, sans la
   * moindre erreur pour le signaler. Exactement le genre de piège que seule une capture révèle.
   */
  it('date la dernière remontée avec le champ que ListDevices porte VRAIMENT', () => {
    const link = toDeviceLinks(LIST_DEVICES)[0]!
    expect(link.fields.LastCommunication).toBeUndefined()
    expect(toSystem(link, NOW).lastSeen).toBe(new Date('2026-09-17T18:55:00').getTime())
    expect(toSystem(link, NOW).wifi).toBe('NORMAL')
  })

  it('sait quand même lire une machine venue de la lecture détaillée', () => {
    const link = toDeviceLinks(LIST_DEVICES)[0]!
    const fromDetail = { ...link, fields: { ...DEVICE_GET } }
    // et l'UTC de cette route-là est ramené au même instant, pas décalé du fuseau
    expect(toSystem(fromDetail, NOW).lastSeen).toBe(Date.parse('2026-09-17T16:55:49.844Z'))
  })
})

describe('MELCloud — joignable ou pas : le drapeau du fabricant ment', () => {
  const link = toDeviceLinks(LIST_DEVICES)[0]!
  const seen = new Date('2026-09-17T18:55:00').getTime()

  /**
   * Relevé sur la VRAIE machine : `Offline: true` pendant que l'horodatage avançait chaque minute,
   * que la remontée suivante était annoncée dans soixante secondes, que le module Wi-Fi disait
   * `NORMAL` et qu'aucune erreur n'était signalée. S'y fier grisait les deux zones de la maison,
   * données fraîches à l'appui. C'est le bug que ce test empêche de revenir.
   */
  it('reste joignable quand MELCloud se dit hors ligne mais parle encore', () => {
    const lying = { ...link.fields, Offline: true }
    expect(unitAvailable(lying, seen + 60_000)).toBe(true)
    expect(toStatePatch(lying, toZones(lying)[0]!, seen + 60_000).available).toBe(true)
  })

  it('devient injoignable quand la machine se tait vraiment', () => {
    expect(unitAvailable(link.fields, seen + 60 * 60_000)).toBe(false)
    expect(toSystem(link, seen + 60 * 60_000).stale).toBe(true)
  })

  /** Sans le moindre horodatage, il ne reste que la parole du fabricant : on la prend faute de mieux. */
  it('retombe sur le drapeau du fabricant quand aucune date n’est donnée', () => {
    const { LastTimeStamp: _a, LastCommunication: _b, ...mute } = link.fields
    expect(unitAvailable({ ...mute, Offline: false }, seen)).toBe(true)
    expect(unitAvailable({ ...mute, Offline: true }, seen)).toBe(false)
  })

  /** Les deux routes n'écrivent pas leur heure dans la même base : 17:58 UTC EST 19:58 local. */
  it('ramène les deux horodatages du fabricant au même instant', () => {
    expect(lastSeenAt({ LastTimeStamp: '2026-09-17T19:58:00' }))
      .toBe(new Date('2026-09-17T19:58:00').getTime())
    expect(lastSeenAt({ LastCommunication: '2026-09-17T17:58:00.522' }))
      .toBe(Date.parse('2026-09-17T17:58:00.522Z'))
  })
})
