import type { DeviceDescriptor, StatePatch } from '@kasbah/shared'
import { DEVICE_TYPES, listedDeviceSchema, type DeviceLink, type SystemReading, type ZoneReading } from './types'

// Mappage MELCloud — PUR : aucune entrée/sortie, tout est testable sur la réponse capturée.
//
// Écrit APRÈS la capture du vrai compte (`__fixtures__/melcloud.ts`), jamais d'après la
// documentation du fabricant — l'erreur que ce projet a déjà commise trois fois (TaHoma, Renault,
// COMAP). Quatre pièges viennent directement de cette capture et sont traités ici :
//
//  1. `RoomTemperatureZone2` vaut **-39** quand la zone n'a pas de sonde d'ambiance. MELCloud rend
//     une sentinelle, pas un `null` : le champ qui DIT la vérité est `Zone2InRoomMode`.
//  2. `ErrorCode` vaut **8000** quand tout va bien. Seul `HasError` se lit.
//  3. Les bornes de consigne ne sont pas les mêmes d'une zone à l'autre : ambiante pour une zone
//     pilotée sur la pièce, eau de départ (30-60 °C) pour une zone en loi d'eau.
//  4. `CanCool: false` : ne jamais proposer « Refroidir » à cette machine.

/** Au-delà, on est dans une structure qu'on ne comprend plus : mieux vaut s'arrêter que boucler. */
const MAX_DEPTH = 12

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Les appareils d'un compte, cherchés par leur FORME et non par leur chemin.
 *
 * MELCloud range les appareils à des profondeurs qui dépendent de l'installation : directement sous
 * `Structure.Devices` (le cas de la maison de référence), ou sous une zone (`Structure.Areas[]`), ou
 * sous un étage, ou sous une zone d'un étage. Plutôt que de parier sur un chemin qu'une autre
 * installation démentirait, on descend l'arbre et on retient tout nœud qui porte un `DeviceID`.
 *
 * Un nœud reconnu comme appareil n'est PAS parcouru plus loin : son sous-objet `Device` porte des
 * identifiants qui feraient compter la même machine deux fois.
 */
export function toDeviceLinks(payload: unknown): DeviceLink[] {
  const out = new Map<string, DeviceLink>()
  walk(payload, null, out, 0)
  return [...out.values()]
}

function walk(node: unknown, buildingName: string | null, out: Map<string, DeviceLink>, depth: number): void {
  if (depth > MAX_DEPTH) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, buildingName, out, depth + 1)
    return
  }
  if (!isRecord(node)) return

  // un bâtiment : son nom habille les appareils qu'il contient
  const here = isRecord(node.Structure) && typeof node.Name === 'string' ? node.Name : buildingName

  if ('DeviceID' in node) {
    // valider APPAREIL PAR APPAREIL : une machine à la forme inattendue ne doit pas priver la
    // maison des autres (`3_2_ecrire-un-plugin.md`)
    const parsed = listedDeviceSchema.safeParse(node)
    if (parsed.success) {
      const link = toLink(parsed.data, here)
      if (!out.has(link.deviceId)) out.set(link.deviceId, link)
    }
    return
  }

  for (const child of Object.values(node)) walk(child, here, out, depth + 1)
}

/**
 * Plage plausible pour une température lue chez ce fabricant. Sert à ne PAS publier la sentinelle
 * `-39` d'une sonde absente : une maison n'est jamais à -39 °C, et une eau de chauffage non plus.
 */
function plausible(t: number | null): t is number {
  return t !== null && t > -30 && t < 100
}

/** Un appareil listé → ce qu'il faut pour l'adresser, le nommer, et le lire. */
function toLink(d: { DeviceID: number | string; BuildingID?: number | string | undefined; DeviceName?: unknown; Device?: unknown }, buildingName: string | null): DeviceLink {
  const deviceId = String(d.DeviceID)
  const inner = isRecord(d.Device) ? d.Device : undefined
  // l'enveloppe ET le sous-objet portent des champs utiles, et aucun ne se suffit : les bornes de
  // consigne sont dans l'enveloppe, l'état de la machine dans `Device`, qui gagne en cas de conflit
  const fields: Record<string, unknown> = { ...(d as Record<string, unknown>), ...(inner ?? {}) }
  const raw = pickNumber(d as Record<string, unknown>, 'DeviceType') ?? (inner ? pickNumber(inner, 'DeviceType') : undefined)
  const deviceType = raw ?? null
  return {
    deviceId,
    buildingId: String(d.BuildingID ?? (inner ? (inner.BuildingID ?? '') : '')),
    buildingName,
    name: typeof d.DeviceName === 'string' && d.DeviceName.trim() !== '' ? d.DeviceName.trim() : `MELCloud ${deviceId}`,
    family: deviceType !== null ? (DEVICE_TYPES[deviceType] ?? null) : null,
    deviceType,
    fields,
  }
}

function pickNumber(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function num(o: Record<string, unknown>, key: string): number | null {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function bool(o: Record<string, unknown>, key: string): boolean {
  return o[key] === true
}
function str(o: Record<string, unknown>, key: string): string | null {
  const v = o[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * Les zones d'une machine, telles qu'elle les pilote VRAIMENT.
 *
 * Le choix `room` / `flow` ne se devine pas d'après les valeurs : il se lit dans `Zone1InRoomMode` /
 * `Zone2InRoomMode`. Sur l'installation de référence, la zone 1 (la maison) est en ambiante à
 * 19,5 °C de consigne, et la zone 2 (l'échangeur) en loi d'eau à 45 °C de départ — deux couples de
 * champs différents, sous un même kind.
 *
 * Une zone en ambiante dont la mesure est aberrante retombe sur le départ : ce serait une sonde
 * débranchée, et publier -39 °C vaudrait moins que publier la température du circuit.
 */
export function toZones(fields: Record<string, unknown>): ZoneReading[] {
  const zones: ZoneReading[] = [zone(fields, 1)]
  if (bool(fields, 'HasZone2')) zones.push(zone(fields, 2))
  return zones
}

function zone(f: Record<string, unknown>, z: 1 | 2): ZoneReading {
  const roomMode = bool(f, `Zone${z}InRoomMode`)
  const room = num(f, `RoomTemperatureZone${z}`)
  const flow = num(f, `FlowTemperatureZone${z}`)
  const cooling = bool(f, `Zone${z}InCoolMode`)
  // l'ambiante ne l'emporte que si la zone est PILOTÉE dessus ET que la sonde répond quelque chose
  // de sensé — les deux conditions viennent de la capture, pas d'une précaution de principe
  const control: 'room' | 'flow' = roomMode && plausible(room) ? 'room' : 'flow'
  const current = control === 'room' ? room : flow
  const target = control === 'room'
    ? num(f, `SetTemperatureZone${z}`)
    : num(f, `Set${cooling ? 'Cool' : 'Heat'}FlowTemperatureZone${z}`)
  return {
    zone: z,
    control,
    currentTempC: plausible(current) ? current : null,
    targetTempC: plausible(target) ? target : null,
    idle: bool(f, `IdleZone${z}`),
    heating: bool(f, `Zone${z}InHeatMode`),
    cooling,
    bounds: control === 'room'
      ? pair(num(f, 'MinTemperature'), num(f, 'MaxTemperature'))
      : pair(num(f, 'MinSetTemperature'), num(f, 'MaxSetTemperature')),
    name: str(f, `Zone${z}Name`),
  }
}

function pair(min: number | null, max: number | null): [number, number] | null {
  return min !== null && max !== null && max > min ? [min, max] : null
}

/**
 * Au-delà de ce silence, la machine n'est plus suivie. Quinze fois la cadence de remontée observée
 * (une minute) : assez pour absorber un module Wi-Fi qui bafouille, assez court pour que la maison
 * ne montre pas des chiffres d'hier comme s'ils étaient d'aujourd'hui.
 */
export const DEFAULT_STALE_MS = 15 * 60_000

/**
 * Quand la machine a parlé pour la dernière fois, en ms epoch — et c'est ici que se résout le piège
 * des deux bases de temps :
 *
 *  - `LastTimeStamp` (dans `ListDevices`, celle qu'on sonde) est en heure **LOCALE**, écrite sans
 *    fuseau : `Date.parse` la lit donc juste, puisqu'il traite une date-heure sans fuseau comme
 *    locale ;
 *  - `LastCommunication` (dans `Device/Get`) est la MÊME instant en **UTC**, écrit sans fuseau lui
 *    aussi — vérifié sur la capture : 17:58:00 UTC contre 19:58:00 local. Le lire pareil décalerait
 *    l'affichage du fuseau tout entier. D'où le `Z` ajouté à la main.
 */
export function lastSeenAt(f: Record<string, unknown>): number | null {
  const local = str(f, 'LastTimeStamp')
  if (local) { const t = Date.parse(local); if (Number.isFinite(t)) return t }
  const utc = str(f, 'LastCommunication')
  if (utc) { const t = Date.parse(utc.endsWith('Z') ? utc : `${utc}Z`); if (Number.isFinite(t)) return t }
  return null
}

/**
 * La machine est-elle joignable ? **Pas `Offline`** — ce drapeau ment.
 *
 * Relevé sur la vraie installation : `Offline: true` alors que `LastTimeStamp` avançait à chaque
 * minute, que `NextCommunication` annonçait la remontée suivante dans soixante secondes, que
 * `WifiAdapterStatus` valait `NORMAL` et que `HasError` était faux. S'y fier faisait disparaître
 * les deux zones de la maison — grisées, avec des données parfaitement fraîches dessous.
 *
 * Ce qu'on mesure à la place est la seule chose vérifiable : la FRAÎCHEUR de la dernière remontée.
 * Sans horodatage du tout, on retombe faute de mieux sur ce que dit le fabricant.
 */
export function unitAvailable(f: Record<string, unknown>, now: number, maxAgeMs = DEFAULT_STALE_MS): boolean {
  const seen = lastSeenAt(f)
  if (seen === null) return !bool(f, 'Offline')
  return now - seen < maxAgeMs
}

/** `externalId` d'une zone : l'identifiant MELCloud suffixé. Stable, sans `:` ni espace. */
export const zoneExternalId = (deviceId: string, zone: 1 | 2): string => `${deviceId}-z${zone}`

/**
 * Les appareils publiés à la maison : UN `climate` par zone de chauffage.
 *
 * En lecture seule, la seule capacité déclarée est `current_temp`. `target_temp` et `hvac_mode`
 * annonceraient des commandes que `execute` refuse, et proposer un bouton qui échoue serait mentir
 * — le raisonnement qui a privé le kind `camera` de `on_off`. La CONSIGNE reste lisible, elle fait
 * partie de l'état : c'est le bouton qui manque, pas la valeur.
 */
export function toDescriptors(link: DeviceLink): DeviceDescriptor[] {
  const f = link.fields
  const modes = bool(f, 'CanCool')
    ? (['off', 'heat', 'cool', 'eco'] as const)
    : (['off', 'heat', 'eco'] as const)
  const model = str(f, 'ModelCode')
  return toZones(f).map((z) => {
    const externalId = zoneExternalId(link.deviceId, z.zone)
    return {
      id: `melcloud:${externalId}`,
      pluginId: 'melcloud',
      externalId,
      kind: 'climate' as const,
      name: z.name ?? (z.zone === 1 ? link.name : `${link.name} zone 2`),
      capabilities: ['current_temp' as const],
      meta: {
        manufacturer: 'Mitsubishi Electric',
        ...(model ? { model: `Ecodan ${model}` } : {}),
        ...(z.bounds ? { targetTempC: z.bounds } : {}),
        // une zone de pompe à chaleur n'est pas un thermostat : c'est une machine au sol, et la
        // maison 3D doit la dessiner comme telle
        climate: { modes: [...modes], control: z.control, deviceClass: 'heat_pump' as const },
      },
    }
  })
}

/**
 * L'état d'une zone. `action` distingue ce que beaucoup d'intégrations confondent : la machine est
 * ALLUMÉE (`mode: 'heat'`) presque toute l'année, mais elle ne CHAUFFE (`action: 'heating'`) que
 * quand la zone n'est pas au repos — sur la capture de septembre, les deux zones sont au repos
 * alors que `Power` est vrai.
 */
export function toStatePatch(fields: Record<string, unknown>, z: ZoneReading, now: number): StatePatch<'climate'> {
  const prohibited = bool(fields, `Prohibit${z.cooling ? 'Cooling' : 'Heating'}Zone${z.zone}`)
  const on = bool(fields, 'Power') && !prohibited
  return {
    available: unitAvailable(fields, now),
    mode: !on ? 'off' : bool(fields, 'HolidayMode') ? 'eco' : z.cooling ? 'cool' : 'heat',
    action: !on ? 'off' : z.idle ? 'idle' : z.cooling ? 'cooling' : 'heating',
    ...(z.currentTempC !== null ? { currentTempC: z.currentTempC } : {}),
    ...(z.targetTempC !== null ? { targetTempC: z.targetTempC } : {}),
  }
}

/** L'état de la machine, pour la vue Chauffage. Jamais publié comme appareil (voir `SystemReading`). */
export function toSystem(link: DeviceLink, now: number): SystemReading {
  const f = link.fields
  return {
    deviceId: link.deviceId,
    name: link.name,
    power: bool(f, 'Power'),
    offline: bool(f, 'Offline'),
    stale: !unitAvailable(f, now),
    outdoorTempC: num(f, 'OutdoorTemperature'),
    flowTempC: num(f, 'FlowTemperature'),
    returnTempC: num(f, 'ReturnTemperature'),
    condensingTempC: num(f, 'CondensingTemperature'),
    demandPercent: num(f, 'DemandPercentage'),
    defrosting: (num(f, 'DefrostMode') ?? 0) > 0,
    boosterHeater: bool(f, 'BoosterHeater1Status') || bool(f, 'BoosterHeater2Status') || bool(f, 'BoosterHeater2PlusStatus'),
    immersionHeater: bool(f, 'ImmersionHeaterStatus'),
    pumps: [1, 2, 3, 4].map((n) => bool(f, `WaterPump${n}Status`)),
    valve3Way: bool(f, 'ValveStatus3Way'),
    // `HasError` d'abord : `ErrorCode` vaut 8000 quand tout va bien, et le lire comme un booléen
    // déclarerait la maison en panne en permanence
    error: { hasError: bool(f, 'HasError'), code: num(f, 'ErrorCode'), message: str(f, 'ErrorMessage') },
    lastSeen: lastSeenAt(f),
    wifi: str(f, 'WifiAdapterStatus'),
    energyMeter: bool(f, 'HasEnergyConsumedMeter'),
  }
}
