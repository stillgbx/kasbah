import { type Capability, type Command, type CoverClass, type DeviceDescriptor, type StatePatch } from '@kasbah/shared'
import type { OverkizAction, OverkizDevice, OverkizState, OverkizValue } from './types'

// Traductions PURES : ressources Overkiz ↔ descripteurs / patchs d'état / corps de commande.
// Deux conventions à ne pas confondre :
//  - Overkiz mesure une FERMETURE (`core:ClosureState`, `core:DeploymentState`) : 0 = ouvert /
//    rentré, 100 = fermé / déployé.
//  - Kasbah mesure une OUVERTURE (`position`) : 0 = fermé, 100 = ouvert.
// D'où le `100 - v` systématique dans les deux sens.

/**
 * uiClass de la box → nature de l'ouvrant. Le reste du parc (passerelle, capteurs, chauffage,
 * sirène…) est ignoré : ce plugin ne couvre que les ouvrants. La classe voyage dans
 * `meta.cover.deviceClass` et décide du vocabulaire de l'interface — un store se remonte, il ne
 * s'ouvre pas (voir `../../../../../packages/shared/src/devices/kinds.ts`).
 */
export const COVER_UI_CLASSES: Record<string, CoverClass> = {
  RollerShutter: 'shutter',
  Shutter: 'shutter',
  SwingingShutter: 'shutter',
  Awning: 'awning',
  Pergola: 'awning',
  ExteriorVenetianBlind: 'blind',
  VenetianBlind: 'blind',
  ExteriorScreen: 'blind',
  Screen: 'blind',
  Curtain: 'curtain',
  Gate: 'gate',
  GarageDoor: 'garage',
  Window: 'window',
}

/** Première commande présente parmi `names`, dans l'ordre de préférence. */
function pick(available: Set<string>, names: readonly string[]): string | undefined {
  return names.find((n) => available.has(n))
}

/**
 * Les commandes de mouvement, résolues d'après ce que la box déclare. Les noms varient par
 * famille : `open`/`close` (volets io), `up`/`down` (stores RTS), `undeploy`/`deploy` (stores
 * bannes et écrans — déployé = fermé, donc `close` déploie).
 */
export interface CoverCommands {
  open?: string
  close?: string
  stop?: string
  /** `setClosure` / `setDeployment`, paramètre exprimé en FERMETURE (0 = ouvert). */
  position?: string
  tilt?: string
}

export function coverCommands(device: OverkizDevice): CoverCommands {
  const names = new Set((device.definition?.commands ?? []).map((c) => c.commandName))
  const out: CoverCommands = {}
  const open = pick(names, ['open', 'up', 'undeploy'])
  const close = pick(names, ['close', 'down', 'deploy'])
  const stop = pick(names, ['stop'])
  const position = pick(names, ['setClosure', 'setDeployment'])
  const tilt = pick(names, ['setOrientation'])
  if (open) out.open = open
  if (close) out.close = close
  if (stop) out.stop = stop
  if (position) out.position = position
  if (tilt) out.tilt = tilt
  return out
}

/** États de fermeture courante, par ordre de préférence (`DeploymentState` : stores bannes). */
const CLOSURE_STATES = ['core:ClosureState', 'core:DeploymentState'] as const

/**
 * L'appareil renvoie-t-il une position réelle ? On lit les états LIVE et non
 * `definition.states` : l'API locale renvoie cette liste VIDE pour tous les appareils (vérifié sur
 * firmware 2026.3.3-7), alors que le tableau `states` porte une douzaine d'états pour un moteur
 * io-homecontrol et reste STRICTEMENT VIDE pour la radio RTS, unidirectionnelle. C'est donc lui
 * qui distingue les deux, sans avoir à énumérer des modèles ni à lire le préfixe du deviceURL.
 */
export function hasPositionFeedback(device: OverkizDevice): boolean {
  const present = new Set(device.states.map((st) => st.name))
  return CLOSURE_STATES.some((st) => present.has(st)) || present.has('core:OpenClosedState')
}

/** Nature de l'ouvrant, `undefined` si la box annonce une uiClass hors sujet. */
export function coverClass(device: OverkizDevice): CoverClass | undefined {
  return COVER_UI_CLASSES[device.definition?.uiClass ?? '']
}

/** Un ouvrant exploitable : uiClass connue ET au moins ouvrir et fermer. */
export function isCover(device: OverkizDevice): boolean {
  if (!coverClass(device)) return false
  const cmd = coverCommands(device)
  return !!cmd.open && !!cmd.close
}

/**
 * `deviceURL` → `externalId`. Un id d'appareil Kasbah est `<pluginId>:<externalId>` et
 * l'externalId sert de segment d'URL : ni `:`, ni `/`, ni `#`. `io://1234-5678-9012/12345678#2`
 * devient donc `io.1234-5678-9012.12345678.2`. Stable (la box ne renumérote pas), donc utilisable
 * dans `house.json`. La correspondance inverse vit dans le plugin (Map issue de la découverte).
 */
export function deviceUrlToExternalId(deviceURL: string): string {
  return deviceURL.replace('://', '.').replaceAll('/', '.').replaceAll('#', '.')
}

/** `states` (setup ou événement) indexés par nom qualifié. */
export function readStates(states: OverkizState[]): Map<string, OverkizValue> {
  const out = new Map<string, OverkizValue>()
  for (const s of states) out.set(s.name, s.value ?? null)
  return out
}

/** Nombre 0–100 quelle que soit la représentation (`30`, `"30"`) ; rien pour tout le reste. */
function pct(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return undefined
  return Math.min(100, Math.max(0, Math.round(n)))
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export function toDescriptor(device: OverkizDevice): DeviceDescriptor {
  const externalId = deviceUrlToExternalId(device.deviceURL)
  const cmd = coverCommands(device)
  const cls = coverClass(device)
  const capabilities: Capability[] = ['open_close']
  // `position` n'est déclarée que si la box sait VISER une position : sans elle, l'UI n'affiche
  // pas de curseur (un volet RTS ne saurait pas l'honorer).
  if (cmd.position) capabilities.push('position')
  if (cmd.tilt) capabilities.push('tilt')
  if (cmd.stop) capabilities.push('stop')
  return {
    id: `tahoma:${externalId}`,
    pluginId: 'tahoma',
    externalId,
    kind: 'cover',
    name: device.label ?? device.definition?.uiClass ?? externalId,
    capabilities,
    meta: {
      manufacturer: 'Somfy',
      ...(device.controllableName ? { model: device.controllableName } : {}),
      ...(cls ? { cover: { deviceClass: cls } } : {}),
    },
  }
}

/**
 * Patch d'état à partir des états de la box. `previous` sert à deviner le sens du mouvement
 * quand la box signale `core:MovingState` sans donner de cible.
 */
export function toCoverPatch(states: Map<string, OverkizValue>, previous?: number): StatePatch<'cover'> {
  const patch: StatePatch<'cover'> = {}

  let closure: number | undefined
  for (const key of CLOSURE_STATES) {
    const v = pct(states.get(key))
    if (v !== undefined) { closure = v; break }
  }
  const openClosed = states.get('core:OpenClosedState')
  const position = closure !== undefined ? 100 - closure
    : openClosed === 'open' ? 100
    : openClosed === 'closed' ? 0
    : undefined
  if (position !== undefined) patch.position = position

  const tilt = pct(states.get('core:SlateOrientationState'))
  if (tilt !== undefined) patch.tilt = tilt

  // `core:MovingState` dit SI ça bouge, jamais dans quel sens : le sens vient de la cible
  // annoncée (`core:TargetClosureState`) ou, à défaut, de la position précédente.
  const moving = bool(states.get('core:MovingState'))
  if (moving === false) patch.motion = 'stopped'
  else if (moving === true) {
    const targetClosure = pct(states.get('core:TargetClosureState'))
    const target = targetClosure !== undefined ? 100 - targetClosure : undefined
    const from = target !== undefined ? position ?? previous : previous
    const to = target ?? position
    if (from !== undefined && to !== undefined && from !== to) patch.motion = to > from ? 'opening' : 'closing'
    else if (target !== undefined || position !== undefined) patch.motion = 'stopped'
  }
  return patch
}

/** `core:StatusState` ('available' / 'unavailable') ou les drapeaux du setup. */
export function toAvailability(device: OverkizDevice, states: Map<string, OverkizValue>): boolean {
  const status = states.get('core:StatusState')
  if (status === 'unavailable') return false
  if (status === 'available') return device.enabled !== false
  return device.available !== false && device.enabled !== false
}

/** Traduit une commande Kasbah en action Overkiz. `undefined` = la box ne sait pas la faire. */
export function toAction(deviceURL: string, cmd: Command, commands: CoverCommands): OverkizAction | undefined {
  const one = (name: string, parameters: (string | number)[] = []): OverkizAction =>
    ({ deviceURL, commands: [{ name, parameters }] })
  switch (cmd.type) {
    case 'cover.open': return commands.open ? one(commands.open) : undefined
    case 'cover.close': return commands.close ? one(commands.close) : undefined
    case 'cover.stop': return commands.stop ? one(commands.stop) : undefined
    case 'cover.set_position': return commands.position ? one(commands.position, [100 - cmd.position]) : undefined
    case 'cover.set_tilt': return commands.tilt ? one(commands.tilt, [cmd.tilt]) : undefined
    default: return undefined
  }
}

/** Position déduite d'une commande tout-ou-rien, pour les appareils sans retour (RTS). */
export function assumedPosition(cmd: Command): number | undefined {
  if (cmd.type === 'cover.open') return 100
  if (cmd.type === 'cover.close') return 0
  return undefined
}

