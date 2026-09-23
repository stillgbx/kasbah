import type { CommandInput, DeviceDescriptor, DeviceState, StateFor } from '@kasbah/shared'
import { isDeviceOn, isMediaActive } from '@kasbah/shared'
import { coverRestKey, coverWords, toClosure } from './cover'
import { isEnergySite } from './energy'
import { formatFeedAmount, formatMilliliters, formatPercent, formatPower, formatSensor, formatTemp, waterAlertState, waterLowestPct } from './format'

// Lecture « métier » d'un état : actif ?, bascule rapide possible ?, libellé court traduit.
// `isDeviceOn` / `isMediaActive` vivent dans `@kasbah/shared` (le serveur s'en sert aussi) : ré-exportés ici.
export { isDeviceOn, isMediaActive }

/**
 * Valeur AFFICHÉE par l'interrupteur, qui n'est pas toujours « l'appareil est actif ».
 * Pour un ouvrant, la convention de l'interface est la fermeture (coché = fermé), alignée sur celle
 * du curseur — voir `cover.ts`. `isDeviceOn` répond à une autre question : il sert à la teinte de
 * l'icône, au comptage des appareils actifs d'une pièce et aux marqueurs 3D, où ce qui se remarque
 * est un volet OUVERT — mais un store DÉPLOYÉ (`coverActivity`).
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
    case 'fan': return { type: 'fan.set', on: !s.on }
    default: return null
  }
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/** Heure du jour seule (« 19:00 ») : un repas de ce soir n'a pas besoin de porter sa date. */
function timeOfDay(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
}

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
      // Position inconnue : on montre l'état qu'on SUPPOSE (le repos, `coverAtRest`) plutôt qu'un
      // « Inconnu » muet — c'est déjà lui qui décide des gestes d'ensemble et du dessin de la scène.
      // Le « (supposé) » est ce qui empêche le mot de devenir une affirmation.
      return s.motion !== 'stopped' ? t(`cover.${w}.${s.motion}`)
        : s.position === undefined ? t('cover.assumed', { state: t(coverRestKey(descriptor)) })
        : s.position <= 0 ? t(`cover.${w}.closed`)
        : s.position >= 100 ? t(`cover.${w}.open`)
        : formatPercent(toClosure(s.position), locale)
    }
    // `on` : l'appli est à l'écran sans rien dire de plus — c'est elle qu'on nomme (« À l'écran · Netflix »).
    // En lecture sans titre (appli native d'une TV : Prime Video), on la nomme aussi : « Lecture · Prime Video ».
    case 'media_player': return s.playback === 'playing' ? `${t('media.playing')}${s.nowPlaying?.title || s.nowPlaying?.source ? ` · ${s.nowPlaying?.title || s.nowPlaying?.source}` : ''}`
      : s.playback === 'on' && s.nowPlaying?.source ? `${t('media.on')} · ${s.nowPlaying.source}`
      : t(`media.${s.playback}`)
    case 'climate': return `${formatTemp(s.currentTempC, locale)} → ${formatTemp(s.targetTempC, locale)}`
    case 'vacuum': return `${t(`vacuum.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'mower': return `${t(`mower.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    // une installation publie le SITE et une batterie par unité : le site se lit en production,
    // une batterie en charge, et « 0 W » pour une batterie pleine ne dirait rien
    case 'energy': return isEnergySite(descriptor) ? formatPower(s.productionW, locale) : batteryStatus(s, t, locale)
    case 'ev_charger': return s.status === 'charging' ? formatPower(s.powerW, locale) : t(`charger.status.${s.status}`)
    case 'vehicle': return `${formatPercent(s.soc, locale)} · ${Math.round(s.rangeKm)} km`
    // rien d'autre à dire d'une caméra que sa présence : l'API ne publie ni marche/arrêt ni activité
    case 'camera': return t('camera.online')
    case 'weather': return t(`weather.conditions.${s.condition}`)
    case 'water': return waterAlertLabel(s, t)
    // Ordre de priorité : la panne, puis ce qui demande un geste (remplir la trémie), puis ce qui
    // se passe, puis le chiffre du jour. Un seul fait à la fois — c'est une ligne, pas un tableau.
    case 'pet_feeder': {
      if (s.errorMessage) return s.errorMessage
      if (s.feeding) return t('pets.feeding')
      if (s.foodLow) return t('pets.foodLow')
      // Ce que ni la grande valeur (le servi) ni la première ligne de la carte (la trémie) ne
      // disent : QUAND tombe le prochain repas. C'est ce que l'appli du fabricant met en avant sur
      // sa vignette, et le seul renseignement qui parle de l'avenir.
      if (s.nextMealAt !== undefined) return t('pets.nextMeal', { time: timeOfDay(s.nextMealAt, locale) })
      return t('pets.noMealLeft')
    }
    case 'pet_fountain': {
      if (s.errorMessage) return s.errorMessage
      if (s.waterLow) return t('pets.waterLow')
      if (!s.on) return t('pets.pumpStopped')
      return s.mode ? t(`pets.mode.${s.mode}`) : t('common.on')
    }
    case 'fan': {
      if (!s.on) return t('common.off')
      const parts = [t('common.on')]
      if (s.speed !== undefined) parts.push(t('fan.speedN', { n: s.speed }))
      return parts.join(' · ')
    }
  }
}

/** Mot d'alerte d'une station d'eau (voir `waterAlertState`) : le fait le plus digne d'attention, comme l'activité d'un robot. */
function waterAlertLabel(s: StateFor<'water'>, t: Translate): string {
  const a = waterAlertState(s)
  return a === 'ok' ? t('water.noAlert') : a === 'warning' ? t('water.warning') : a === 'defect' ? t('water.defect') : t('common.unknown')
}

/**
 * Ce qu'une batterie dit d'elle : sa charge, et le sens dans lequel elle travaille quand elle
 * travaille. Le contrat compte `batteryW` positif en CHARGE.
 */
function batteryStatus(s: StateFor<'energy'>, t: Translate, locale: string): string {
  const soc = s.batterySoc !== undefined ? formatPercent(s.batterySoc, locale) : t('common.unknown')
  if (!s.batteryW) return soc
  return `${soc} · ${t(s.batteryW > 0 ? 'energy.charging' : 'energy.discharging')} ${formatPower(Math.abs(s.batteryW), locale)}`
}

/** Grande valeur en tête du panneau appareil. */
export function headlineValue(descriptor: DeviceDescriptor, s: DeviceState, t: Translate, locale: string): string {
  switch (s.kind) {
    case 'light': return s.on ? (s.brightness !== undefined ? formatPercent(s.brightness, locale) : t('common.on')) : t('common.off')
    // Un ouvrant qui ne sait pas VISER une position ne sait pas non plus la mesurer : sur une radio
    // unidirectionnelle (RTS), le pourcentage n'est qu'une déduction de la dernière commande de
    // pleine course. Écrire « 100 % » d'un store arrêté à mi-hauteur est une précision inventée —
    // on ne dit que le mot, qui reste vrai. Les moteurs bidirectionnels gardent leur pourcentage.
    case 'cover': {
      // la grande valeur porte le mot supposé ; c'est la ligne d'état juste en dessous qui dit que
      // c'en est un (`CoverControl`), le « (supposé) » ne tiendrait pas en 32 px
      if (s.position === undefined) return t(coverRestKey(descriptor))
      if (!descriptor.capabilities.includes('position')) {
        const w = coverWords(descriptor)
        return t(`cover.${w}.${s.position <= 0 ? 'closed' : 'open'}`)
      }
      return formatPercent(toClosure(s.position), locale)
    }
    // titre vide = métadonnées pas encore reçues : l'état, plutôt qu'un vide ou un identifiant
    case 'media_player': return s.nowPlaying?.title || t(`media.${s.playback}`)
    case 'climate': return formatTemp(s.currentTempC, locale)
    case 'vacuum': return t(`vacuum.activities.${s.activity}`)
    case 'mower': return t(`mower.activities.${s.activity}`)
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    case 'energy': return isEnergySite(descriptor) ? formatPower(s.productionW, locale)
      : s.batterySoc !== undefined ? formatPercent(s.batterySoc, locale) : t('common.unknown')
    case 'ev_charger': return formatPower(s.powerW, locale)
    case 'vehicle': return formatPercent(s.soc, locale)
    case 'camera': return t(`camera.classes.${descriptor.meta.camera?.deviceClass ?? 'camera'}`)
    case 'weather': return formatTemp(s.tempC, locale)
    // La ligne du bas de la carte dit déjà l'alerte : la grande valeur répéterait le même mot. Sauf
    // si une alerte est active — le fait le plus urgent doit primer — elle dit plutôt le plus bas
    // des consommables (`waterLowestPct`), ce que rien d'autre à l'écran ne résume.
    case 'water': {
      const a = waterAlertState(s)
      if (a === 'warning' || a === 'defect') return waterAlertLabel(s, t)
      const p = waterLowestPct(s)
      return p !== undefined ? formatPercent(p, locale) : t('common.unknown')
    }
    // Même arbitrage que la station d'eau : une alerte prime sur le chiffre, parce qu'elle appelle
    // un geste ; sinon on montre ce que la journée a donné, qui n'est écrit nulle part ailleurs.
    // Contrairement à la station d'eau, l'alerte ne prend PAS la place du chiffre : c'est la ligne
    // de statut juste en dessous qui la porte, et l'écrire aux deux endroits l'affichait deux fois.
    case 'pet_feeder': {
      const u = descriptor.meta.petFeeder?.unit
      return s.servedToday !== undefined && u ? formatFeedAmount(s.servedToday, u, locale) : t('common.unknown')
    }
    case 'pet_fountain': {
      if (!s.on) return t('common.off')
      // Les PASSAGES du jour : c'est ce que l'appli du fabricant met en grand (« 6 fois »), et la
      // seule mesure de consommation qu'une Eversweet Max sache produire. Le volume pour les
      // modèles qui le mesurent ; sinon le filtre, seul chiffre qui appelle un geste.
      // Forme COMPACTE (« 6× ») et non « 6 passages » : la grande valeur est à 32 px dans une
      // réserve de 144, et le mot s'y coupait (« 0 passa… », mesuré). Le libellé entier vit sur la
      // ligne de la carte, où il a la place.
      if (s.drinksToday !== undefined) return `${s.drinksToday}×`
      if (s.todayMl !== undefined) return formatMilliliters(s.todayMl, locale)
      return s.filterPct !== undefined ? formatPercent(s.filterPct, locale) : t('common.on')
    }
    case 'fan': return s.on
      ? (s.speed !== undefined ? String(s.speed) : t('common.on'))
      : t('common.off')
  }
}
