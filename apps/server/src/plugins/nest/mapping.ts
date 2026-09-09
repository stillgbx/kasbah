import type { CameraClass, Capability, DeviceDescriptor, StreamProtocol } from '@kasbah/shared'
import { readTrait, type SdmDevice } from './types'

// Traductions PURES : appareils SDM → descripteurs Kasbah, et URL d'autorisation.
// Ce plugin ne couvre que les caméras (caméras, sonnettes, écrans à caméra) : les thermostats
// que la même API expose sont ignorés pour l'instant.

/** Type SDM → nature de la caméra. Un type absent de cette table n'est pas une caméra. */
export const CAMERA_TYPES: Record<string, CameraClass> = {
  'sdm.devices.types.CAMERA': 'camera',
  'sdm.devices.types.DOORBELL': 'doorbell',
  'sdm.devices.types.DISPLAY': 'display',
}

/**
 * Nom de repli par nature quand l'appareil n'a pas de nom (voir `toDescriptor`), en PRÉFIXE :
 * « Caméra Garage », comme on nomme les appareils dans cette maison (« Volet Salon », « Plafonnier
 * Cuisine »). En français, faute de mieux : le nom d'un descripteur est une seule chaîne, et le
 * traduire selon la langue d'affichage demanderait au client de reconnaître un nom de repli dans
 * les six endroits où il lit `descriptor.name` — trop pour ce que ça rapporte, l'utilisateur a tranché.
 */
const CLASS_LABEL: Record<CameraClass, string> = { camera: 'Caméra', doorbell: 'Sonnette', display: 'Écran' }

const PROTOCOLS: Record<string, StreamProtocol> = { WEB_RTC: 'webrtc', RTSP: 'rtsp' }

export function isCamera(device: SdmDevice): boolean {
  return device.type !== undefined && device.type in CAMERA_TYPES
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
  const custom = readTrait(device, 'Info')?.customName
  const room = roomOf(device)
  const name = (typeof custom === 'string' && custom.trim()) || [CLASS_LABEL[deviceClass], room].filter(Boolean).join(' ')
  const capabilities: Capability[] = []
  if (readTrait(device, 'CameraLiveStream')) capabilities.push('live_stream')
  if (readTrait(device, 'DoorbellChime')) capabilities.push('chime')
  const protocols = streamProtocols(device)
  return {
    id: `nest:${externalId}`,
    pluginId: 'nest',
    externalId,
    kind: 'camera',
    name,
    capabilities,
    meta: {
      manufacturer: 'Google Nest',
      model: device.type?.replace('sdm.devices.types.', '') ?? 'unknown',
      ...(room ? { room } : {}),
      camera: { deviceClass, ...(protocols.length ? { protocols } : {}) },
    },
  }
}

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
