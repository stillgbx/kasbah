import type { CameraClass, Capability, ClimateMode, Command, DeviceDescriptor, DeviceEventKind, StatePatch, StreamProtocol } from '@kasbah/shared'
import { readTrait, sdmEventSchema, type SdmDevice } from './types'

// Traductions PURES : appareils SDM → descripteurs Kasbah, patchs d'état, commandes, URL
// d'autorisation. Ce plugin couvre les caméras (caméras, sonnettes, écrans à caméra) et les
// thermostats ; le reste de l'API est ignoré et compté.

/** Type SDM → nature de la caméra. Un type absent de cette table n'est pas une caméra. */
export const CAMERA_TYPES: Record<string, CameraClass> = {
  'sdm.devices.types.CAMERA': 'camera',
  'sdm.devices.types.DOORBELL': 'doorbell',
  'sdm.devices.types.DISPLAY': 'display',
}
export const THERMOSTAT_TYPE = 'sdm.devices.types.THERMOSTAT'

/**
 * Nom de repli par nature quand l'appareil n'a pas de nom (voir `toDescriptor`), en PRÉFIXE :
 * « Caméra Garage », comme on nomme les appareils dans cette maison (« Volet Salon », « Plafonnier
 * Cuisine »). En français, faute de mieux : le nom d'un descripteur est une seule chaîne, et le
 * traduire selon la langue d'affichage demanderait au client de reconnaître un nom de repli dans
 * les six endroits où il lit `descriptor.name` — trop pour ce que ça rapporte, l'utilisateur a tranché.
 */
const CLASS_LABEL: Record<CameraClass, string> = { camera: 'Caméra', doorbell: 'Sonnette', display: 'Écran' }
const THERMOSTAT_LABEL = 'Thermostat'

const PROTOCOLS: Record<string, StreamProtocol> = { WEB_RTC: 'webrtc', RTSP: 'rtsp' }

export function isCamera(device: SdmDevice): boolean {
  return device.type !== undefined && device.type in CAMERA_TYPES
}

export function isThermostat(device: SdmDevice): boolean {
  return device.type === THERMOSTAT_TYPE
}

/** `enterprises/<projet>/devices/<id>` → `<id>` (opaque, stable, sans `:` ni espace). */
export function deviceNameToExternalId(name: string): string {
  const i = name.lastIndexOf('/')
  return i < 0 ? name : name.slice(i + 1)
}

/** Nom de la pièce Google Home qui contient l'appareil (première relation parent nommée). */
export function roomOf(device: SdmDevice): string | undefined {
  const named = device.parentRelations.find((r) => r.displayName && r.displayName.trim())
  return named?.displayName?.trim()
}

/** `Info.customName` s'il est renseigné, sinon « <type> <pièce> » (voir `CLASS_LABEL`). */
function nameOf(device: SdmDevice, label: string): string {
  const custom = readTrait(device, 'Info')?.customName
  return (typeof custom === 'string' && custom.trim()) || [label, roomOf(device)].filter(Boolean).join(' ')
}

function baseMeta(device: SdmDevice) {
  const room = roomOf(device)
  return {
    manufacturer: 'Google Nest',
    model: device.type?.replace('sdm.devices.types.', '') ?? 'unknown',
    ...(room ? { room } : {}),
  }
}

// ---- caméras ----------------------------------------------------------------------------------

/** Protocoles de flux déclarés par `CameraLiveStream.supportedProtocols`, dans l'ordre de Google. */
export function streamProtocols(device: SdmDevice): StreamProtocol[] {
  const raw = readTrait(device, 'CameraLiveStream')?.supportedProtocols
  if (!Array.isArray(raw)) return []
  const out: StreamProtocol[] = []
  for (const p of raw) {
    const mapped = typeof p === 'string' ? PROTOCOLS[p] : undefined
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

/**
 * Descripteur d'une caméra. Le nom vient de `Info.customName` ; Google le laisse souvent VIDE (7
 * appareils sur 10 sur le compte réel — l'appli Google Home affiche alors « <pièce> <type> »), d'où
 * un repli « <type> <pièce> » ici, dans l'ordre des noms de cette maison. La
 * pièce part dans `meta.room` : c'est la clé de l'auto-placement dans la maison
 * (`packages/shared/src/house/autoplace.ts`), nommer la pièce de la maison comme celle de Google
 * Home suffit à faire apparaître la caméra dans la scène 3D.
 */
export function toDescriptor(device: SdmDevice): DeviceDescriptor {
  const deviceClass = CAMERA_TYPES[device.type ?? ''] ?? 'camera'
  const externalId = deviceNameToExternalId(device.name)
  const capabilities: Capability[] = []
  if (readTrait(device, 'CameraLiveStream')) capabilities.push('live_stream')
  if (readTrait(device, 'DoorbellChime')) capabilities.push('chime')
  const protocols = streamProtocols(device)
  return {
    id: `nest:${externalId}`,
    pluginId: 'nest',
    externalId,
    kind: 'camera',
    name: nameOf(device, CLASS_LABEL[deviceClass]),
    capabilities,
    meta: { ...baseMeta(device), camera: { deviceClass, ...(protocols.length ? { protocols } : {}) } },
  }
}

// ---- thermostats ------------------------------------------------------------------------------
// Traits lus : `ThermostatMode` (HEAT / COOL / HEATCOOL / OFF et la liste disponible), `ThermostatEco`
// (MANUAL_ECO / OFF, avec ses propres consignes), `ThermostatHvac` (ce que fait l'appareil À
// L'INSTANT), `ThermostatTemperatureSetpoint`, `Temperature`, `Humidity`, `Connectivity`.
// L'éco est un mode à part chez Google (il se superpose au mode HVAC) ; Kasbah n'a qu'un `mode`,
// donc éco actif → `eco`, et en sortir remet le mode HVAC sous-jacent.

const MODE_FROM_SDM: Record<string, ClimateMode> = { HEAT: 'heat', COOL: 'cool', HEATCOOL: 'auto', OFF: 'off' }
const MODE_TO_SDM: Partial<Record<ClimateMode, string>> = { heat: 'HEAT', cool: 'COOL', auto: 'HEATCOOL', off: 'OFF' }
/** Plage de consigne acceptée par Google (°C). */
export const SETPOINT_RANGE: [number, number] = [9, 32]
/** En mode HEATCOOL, Google exige un écart entre les deux consignes ; on garde au moins celui-ci. */
const RANGE_GAP_C = 2

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
/** Google publie des flottants bruts (24.23999) : au dixième, l'état ne bouge que quand ça compte. */
const round1 = (v: number) => Math.round(v * 10) / 10

/** Modes que le thermostat déclare, dans l'ordre de Google, éco en dernier s'il est proposé. */
export function thermostatModes(device: SdmDevice): ClimateMode[] {
  const raw = readTrait(device, 'ThermostatMode')?.availableModes
  const out: ClimateMode[] = []
  if (Array.isArray(raw)) for (const m of raw) { const k = typeof m === 'string' ? MODE_FROM_SDM[m] : undefined; if (k && !out.includes(k)) out.push(k) }
  const eco = readTrait(device, 'ThermostatEco')?.availableModes
  if (Array.isArray(eco) && eco.includes('MANUAL_ECO')) out.push('eco')
  return out
}

function ecoOn(device: SdmDevice): boolean {
  return readTrait(device, 'ThermostatEco')?.mode === 'MANUAL_ECO'
}

export function toThermostatDescriptor(device: SdmDevice): DeviceDescriptor {
  const externalId = deviceNameToExternalId(device.name)
  const capabilities: Capability[] = ['hvac_mode', 'target_temp', 'current_temp']
  if (readTrait(device, 'Humidity')) capabilities.push('humidity')
  return {
    id: `nest:${externalId}`,
    pluginId: 'nest',
    externalId,
    kind: 'climate',
    name: nameOf(device, THERMOSTAT_LABEL),
    capabilities,
    meta: { ...baseMeta(device), targetTempC: SETPOINT_RANGE, climate: { modes: thermostatModes(device) } },
  }
}

/** `Connectivity.status` : `OFFLINE` seul rend l'appareil indisponible (absent = on ne sait pas, donc disponible). */
export function thermostatAvailable(device: SdmDevice): boolean {
  return readTrait(device, 'Connectivity')?.status !== 'OFFLINE'
}

/**
 * État complet d'un thermostat, ou `undefined` sans température ambiante (le contrat l'exige).
 * La consigne suit le mode : celle de l'éco quand il est actif, sinon celle du mode HVAC ; en
 * HEATCOOL Kasbah ne montre que la consigne de chauffe. Un thermostat OFF garde sa dernière
 * consigne connue, sinon on répète l'ambiante plutôt que d'inventer une valeur.
 */
export function toClimatePatch(device: SdmDevice): StatePatch<'climate'> | undefined {
  const current = num(readTrait(device, 'Temperature')?.ambientTemperatureCelsius)
  if (current === undefined) return undefined
  const sdmMode = str(readTrait(device, 'ThermostatMode')?.mode) ?? 'OFF'
  const eco = readTrait(device, 'ThermostatEco')
  const mode: ClimateMode = ecoOn(device) ? 'eco' : MODE_FROM_SDM[sdmMode] ?? 'off'
  const hvac = str(readTrait(device, 'ThermostatHvac')?.status)
  const action = hvac === 'HEATING' ? 'heating' : hvac === 'COOLING' ? 'cooling' : mode === 'off' ? 'off' : 'idle'
  const setpoint = readTrait(device, 'ThermostatTemperatureSetpoint')
  const target = mode === 'eco'
    ? (sdmMode === 'COOL' ? num(eco?.coolCelsius) : num(eco?.heatCelsius))
    : sdmMode === 'COOL' ? num(setpoint?.coolCelsius) : num(setpoint?.heatCelsius) ?? num(setpoint?.coolCelsius)
  const humidity = num(readTrait(device, 'Humidity')?.ambientHumidityPercent)
  return {
    mode, action, currentTempC: round1(current), targetTempC: round1(target ?? current),
    ...(humidity !== undefined ? { humidity: Math.round(humidity) } : {}),
  }
}

export interface SdmCommand { command: string; params: Record<string, unknown> }

/**
 * Commande(s) SDM pour une commande Kasbah, ou `undefined` si l'appareil ne peut pas l'honorer
 * DANS SON ÉTAT COURANT — Google refuse une consigne en éco ou à l'arrêt, et un mode absent de la
 * liste déclarée. Sortir de l'éco pour un mode HVAC prend deux commandes : Google ne le fait pas seul.
 */
export function toThermostatCommands(device: SdmDevice, cmd: Command): SdmCommand[] | undefined {
  const modes = thermostatModes(device)
  const sdmMode = str(readTrait(device, 'ThermostatMode')?.mode) ?? 'OFF'
  switch (cmd.type) {
    case 'climate.set_mode': {
      if (!modes.includes(cmd.mode)) return undefined
      if (cmd.mode === 'eco') return [{ command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'MANUAL_ECO' } }]
      const target = MODE_TO_SDM[cmd.mode]
      if (!target) return undefined
      const out: SdmCommand[] = []
      if (ecoOn(device)) out.push({ command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'OFF' } })
      out.push({ command: 'sdm.devices.commands.ThermostatMode.SetMode', params: { mode: target } })
      return out
    }
    case 'climate.set_target_temp': {
      if (ecoOn(device) || sdmMode === 'OFF') return undefined
      const [lo, hi] = SETPOINT_RANGE
      const v = round1(Math.min(hi, Math.max(lo, cmd.targetTempC)))
      if (sdmMode === 'COOL') return [{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool', params: { coolCelsius: v } }]
      if (sdmMode === 'HEATCOOL') {
        const cool = num(readTrait(device, 'ThermostatTemperatureSetpoint')?.coolCelsius)
        return [{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange', params: { heatCelsius: v, coolCelsius: Math.max(cool ?? 0, v + RANGE_GAP_C) } }]
      }
      return [{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat', params: { heatCelsius: v } }]
    }
    default: return undefined
  }
}

// ---- OAuth ------------------------------------------------------------------------------------

/**
 * Portées OAuth demandées à la liaison du compte. `pubsub` ne sert pas encore (les événements —
 * sonnerie, mouvement — passeront par un abonnement Pub/Sub tiré avec le même compte), mais la
 * demander maintenant évite de refaire la liaison plus tard.
 */
export const OAUTH_SCOPES = ['https://www.googleapis.com/auth/sdm.service', 'https://www.googleapis.com/auth/pubsub']

/**
 * URL du « Partner Connections Manager » de Google : c'est là que l'utilisateur choisit les
 * appareils qu'il partage avec le projet Device Access, PUIS s'authentifie. `access_type=offline`
 * et `prompt=consent` sont indispensables pour recevoir un jeton de rafraîchissement.
 */
export function authorizationUrl(opts: { projectId: string; clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    redirect_uri: opts.redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    client_id: opts.clientId,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state: opts.state,
  })
  return `https://nestservices.google.com/partnerconnections/${encodeURIComponent(opts.projectId)}/auth?${q.toString()}`
}

/** Nom d'événement SDM → notre kind d'événement d'appareil. Les autres sont ignorés. */
const EVENT_KIND: Record<string, DeviceEventKind> = {
  'sdm.devices.events.DoorbellChime.Chime': 'chime',
  'sdm.devices.events.CameraMotion.Motion': 'motion',
  'sdm.devices.events.CameraPerson.Person': 'person',
  'sdm.devices.events.CameraSound.Sound': 'sound',
}

/**
 * Décode le corps base64 d'un message Pub/Sub SDM en (externalId, kinds d'événements). Rend `undefined`
 * si le corps est illisible ou ne porte aucun événement connu. Pur : aucune I/O.
 */
export function parseSdmEvent(dataBase64: string): { externalId: string; kinds: DeviceEventKind[] } | undefined {
  let json: unknown
  try { json = JSON.parse(Buffer.from(dataBase64, 'base64').toString('utf8')) } catch { return undefined }
  const r = sdmEventSchema.safeParse(json)
  const name = r.success ? r.data.resourceUpdate?.name : undefined
  if (!name) return undefined
  const events = (r.success && r.data.resourceUpdate?.events) || {}
  const kinds = [...new Set(Object.keys(events).map((k) => EVENT_KIND[k]).filter((v): v is DeviceEventKind => v !== undefined))]
  return kinds.length ? { externalId: deviceNameToExternalId(name), kinds } : undefined
}
