import type { CommandInput, DeviceDescriptor, DeviceState, StateFor } from '@kasbah/shared'
import { coverWords, toClosure } from './cover'
import { formatPercent, formatPower, formatSensor, formatTemp } from './format'

// Lecture « métier » d'un état : actif ?, bascule rapide possible ?, libellé court traduit.

/**
 * Le lecteur diffuse quelque chose : une lecture, ou une appli à l'écran dont on ne sait rien de plus
 * (`on`, Netflix natif) — l'écran est bien occupé. Sert à l'interrupteur, au point pulsant, à la teinte de
 * l'icône et à l'onde de la scène 3D ; le compteur « en lecture » de l'en-tête, lui, ne compte que `playing`.
 */
export function isMediaActive(s: StateFor<'media_player'>): boolean {
  return s.playback === 'playing' || s.playback === 'on'
}

/** Vrai si l'appareil est « actif » : lampe allumée, volet ouvert, lecture en cours, robot au travail… */
export function isDeviceOn(s: DeviceState): boolean {
  if (!s.available) return false
  switch (s.kind) {
    case 'light': return s.on
    // position inconnue (RTS sans retour) : ni actif ni inactif, on ne teinte pas l'icône
    case 'cover': return s.position !== undefined && s.position > 0
    case 'media_player': return isMediaActive(s)
    case 'climate': return s.mode !== 'off'
    case 'vacuum': return s.activity === 'cleaning'
    case 'mower': return s.activity === 'mowing'
    case 'ev_charger': return s.status === 'charging'
    case 'vehicle': return s.charging
    case 'energy': return s.productionW > 0
    case 'sensor': return false
    case 'camera': return false
  }
}

/**
 * Valeur AFFICHÉE par l'interrupteur, qui n'est pas toujours « l'appareil est actif ».
 * Pour un ouvrant, la convention de l'interface est la fermeture (coché = fermé), alignée sur celle
 * du curseur — voir `cover.ts`. `isDeviceOn` reste inchangé : il sert à la teinte de l'icône, au
 * comptage des appareils actifs d'une pièce et aux marqueurs 3D, où un volet OUVERT est l'actif.
 *
 * `aimed` : position VISÉE quand le store en tient une. L'interrupteur bascule alors tout de suite,
 * comme le curseur — sinon il resterait dans son ancien état pendant les ~20 s de course avant de
 * sauter à la fin, alors que le geste a bien été pris en compte.
 */
export function toggleChecked(s: DeviceState, aimed?: number): boolean {
  if (s.kind === 'cover') return s.available && shownClosed(s, aimed)
  return isDeviceOn(s)
}

/**
 * L'ouvrant est-il montré COMME FERMÉ (interrupteur coché) ? Position inconnue = non coché : on ne
 * peut pas affirmer « fermé », et l'interrupteur reste manœuvrable dans ce sens — c'est aussi la
 * bascule utile, puisque `toggleCommand` en tire la commande inverse.
 */
function shownClosed(s: StateFor<'cover'>, aimed?: number): boolean {
  const shown = aimed ?? s.position
  return shown !== undefined && shown <= 0
}

/**
 * L'appareil est-il OCCUPÉ à exécuter ce qu'on lui a demandé ? À ne pas confondre avec « une
 * requête est en vol » : un fabricant acquitte en quelques dizaines de millisecondes, et un
 * indicateur qui ne dure que ça n'est pas lisible. Pour un ouvrant, la commande n'est que le
 * début — l'occupation court jusqu'à la fin de la course.
 *
 * `aiming` : une position est visée mais le moteur n'a pas encore signalé qu'il démarre (le store
 * tient cette cible, voir `stores/devices.ts`).
 */
export function isDeviceBusy(s: DeviceState, aiming = false): boolean {
  if (s.kind === 'cover') return aiming || s.motion !== 'stopped'
  return false
}

/**
 * Point pulsant des listes : quelque chose est EN COURS chez l'appareil — un ouvrant qui bouge, un
 * lecteur qui joue. Distinct de `isDeviceBusy`, qui remplace l'interrupteur du panneau par un
 * spinner : une lecture n'empêche pas d'agir, elle ne doit pas cacher la bascule.
 */
export function isDevicePulsing(s: DeviceState, aiming = false): boolean {
  return isDeviceBusy(s, aiming) || (s.kind === 'media_player' && isMediaActive(s))
}

/**
 * Commande de bascule rapide (interrupteur des listes), ou null si l'appareil n'en a pas.
 *
 * `aimed` : position visée quand le store en tient une. Sans elle, un ouvrant en pleine fermeture
 * garde sa position réelle de départ, donc la bascule renverrait ENCORE « fermer » — impossible
 * d'inverser un mouvement en cours. On raisonne donc sur ce que l'interface montre.
 */
export function toggleCommand(s: DeviceState, aimed?: number): CommandInput | null {
  switch (s.kind) {
    case 'light': return { type: 'light.set', on: !s.on }
    case 'cover': return shownClosed(s, aimed) ? { type: 'cover.open' } : { type: 'cover.close' }
    // `on` : l'interrupteur est coché ; l'éteindre FERME l'appli à l'écran (rien d'autre n'est possible sans session)
    case 'media_player': return s.playback === 'playing' ? { type: 'media_player.pause' } : s.playback === 'on' ? { type: 'media_player.stop' } : { type: 'media_player.play' }
    case 'vacuum': return s.activity === 'cleaning' ? { type: 'vacuum.dock' } : { type: 'vacuum.start' }
    case 'mower': return s.activity === 'mowing' ? { type: 'mower.park', untilNextSchedule: true } : { type: 'mower.start', durationMin: 60 }
    default: return null
  }
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/** Libellé court d'état pour les listes et l'en-tête du panneau appareil. */
export function statusLabel(descriptor: DeviceDescriptor, s: DeviceState, t: Translate, locale: string): string {
  if (!s.available) return t('common.unavailable')
  switch (s.kind) {
    case 'light': return s.on ? `${t('common.on')}${s.brightness !== undefined ? ` · ${formatPercent(s.brightness, locale)}` : ''}` : t('common.off')
    // en mouvement, la position est en train d'être quittée : annoncer le mouvement évite un
    // « Ouvert » affiché à côté d'un curseur déjà posé sur la fermeture visée. Le vocabulaire
    // dépend de la nature de l'ouvrant : un store est « baissé », pas « fermé ».
    case 'cover': {
      const w = coverWords(descriptor)
      return s.motion !== 'stopped' ? t(`cover.${w}.${s.motion}`)
        : s.position === undefined ? t('common.unknown')
        : s.position <= 0 ? t(`cover.${w}.closed`)
        : s.position >= 100 ? t(`cover.${w}.open`)
        : formatPercent(toClosure(s.position), locale)
    }
    // `on` : l'appli est à l'écran sans rien dire de plus — c'est elle qu'on nomme (« À l'écran · Netflix »)
    case 'media_player': return s.playback === 'playing' ? `${t('media.playing')}${s.nowPlaying?.title ? ` · ${s.nowPlaying.title}` : ''}`
      : s.playback === 'on' && s.nowPlaying?.source ? `${t('media.on')} · ${s.nowPlaying.source}`
      : t(`media.${s.playback}`)
    case 'climate': return `${formatTemp(s.currentTempC, locale)} → ${formatTemp(s.targetTempC, locale)}`
    case 'vacuum': return `${t(`vacuum.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'mower': return `${t(`mower.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    case 'energy': return formatPower(s.productionW, locale)
    case 'ev_charger': return s.status === 'charging' ? formatPower(s.powerW, locale) : t(`charger.status.${s.status}`)
    case 'vehicle': return `${formatPercent(s.soc, locale)} · ${Math.round(s.rangeKm)} km`
    // rien d'autre à dire d'une caméra que sa présence : l'API ne publie ni marche/arrêt ni activité
    case 'camera': return t('camera.online')
  }
}

/** Grande valeur en tête du panneau appareil. */
export function headlineValue(descriptor: DeviceDescriptor, s: DeviceState, t: Translate, locale: string): string {
  switch (s.kind) {
    case 'light': return s.on ? (s.brightness !== undefined ? formatPercent(s.brightness, locale) : t('common.on')) : t('common.off')
    case 'cover': return s.position === undefined ? t('common.unknown') : formatPercent(toClosure(s.position), locale)
    // titre vide = métadonnées pas encore reçues : l'état, plutôt qu'un vide ou un identifiant
    case 'media_player': return s.nowPlaying?.title || t(`media.${s.playback}`)
    case 'climate': return formatTemp(s.currentTempC, locale)
    case 'vacuum': return t(`vacuum.activities.${s.activity}`)
    case 'mower': return t(`mower.activities.${s.activity}`)
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    case 'energy': return formatPower(s.productionW, locale)
    case 'ev_charger': return formatPower(s.powerW, locale)
    case 'vehicle': return formatPercent(s.soc, locale)
    case 'camera': return t(`camera.classes.${descriptor.meta.camera?.deviceClass ?? 'camera'}`)
  }
}
