import type { DeviceDescriptor } from './descriptor'
import type { DeviceState, StateFor } from './state'

// Lecture « métier » d'un état : l'appareil est-il ACTIF ? Règles pures, partagées depuis que le
// serveur en a besoin lui aussi (automatisations : « une lumière est allumée dans la pièce », « la
// TV marche »). Elles vivaient dans `apps/web/src/lib/deviceState.ts` et `cover.ts`, qui les
// ré-exportent : le comportement est celui de l'interface, à l'identique.

/**
 * Le lecteur diffuse quelque chose : une lecture, ou une appli à l'écran dont on ne sait rien de plus
 * (`on`, Netflix natif) — l'écran est bien occupé. Sert à l'interrupteur, au point pulsant, à la teinte de
 * l'icône et à l'onde de la scène 3D ; le compteur « en diffusion » de l'en-tête, lui, ne compte que `playing`.
 */
export function isMediaActive(s: StateFor<'media_player'>): boolean {
  return s.playback === 'playing' || s.playback === 'on'
}

/**
 * Vocabulaire d'un ouvrant. La commande est la même (`cover.open` / `cover.close`), les mots ne le
 * sont pas : un volet s'OUVRE et se FERME, un store se REMONTE et se BAISSE. Le choix vient de
 * `meta.cover.deviceClass`, posé par le plugin d'après ce que le fabricant déclare — jamais d'une
 * heuristique sur le nom de l'appareil.
 *
 * La valeur sert de préfixe i18n : `cover.openClose.*` ou `cover.upDown.*`.
 */
export type CoverWords = 'openClose' | 'upDown'

/** Un store banne, un BSO ou un écran se manœuvrent verticalement ; le reste s'ouvre. */
const UP_DOWN = new Set<string>(['awning', 'blind'])

type Coverish = { meta: { cover?: { deviceClass: string } } }

export function coverWords(descriptor: Coverish): CoverWords {
  return UP_DOWN.has(descriptor.meta.cover?.deviceClass ?? '') ? 'upDown' : 'openClose'
}

/**
 * Ouvrant qui se déploie À PLAT : un store banne, un BSO s'avancent au-dessus d'une terrasse, là où
 * un volet, un portail se tiennent debout dans leur passage. Même liste que le vocabulaire (« se
 * baisse » plutôt que « se ferme ») : une seule source, pour que la forme dessinée, les mots dits et
 * l'état mis en valeur ne se contredisent jamais.
 */
export function isFlatCover(descriptor: Coverish | undefined): boolean {
  return !!descriptor && coverWords(descriptor) === 'upDown'
}

/**
 * L'ouvrant est-il AU REPOS ? C'est l'état où il ne demande rien à personne : **fermé** pour ce qui
 * se tient debout (volet, portail), **remonté** pour un store — un store au repos est rentré, pas
 * déployé (c'est déployé qu'il craint le vent, voir `coverActivity`).
 *
 * **Une position inconnue est SUPPOSÉE au repos.** Une radio unidirectionnelle ne dit jamais où elle
 * en est, et le doute doit pencher du côté sûr : sans cette supposition, un portail muet suffisait à
 * faire croire que la maison n'était pas sécurisée, et l'appui suivant l'aurait ouvert. Ce n'est pas
 * une AFFIRMATION — les libellés continuent de dire « Inconnu » — c'est une décision par défaut.
 */
export function coverAtRest(descriptor: Coverish | undefined, position: number | undefined): boolean {
  if (position === undefined) return true
  return isFlatCover(descriptor) ? position >= 100 : position <= 0
}

/**
 * Part de l'ouvrant qui SE REMARQUE, de 0 (rien à signaler) à 1. C'est l'inverse d'une nature à
 * l'autre, et c'est voulu : d'un volet on retient qu'il est OUVERT, d'un store qu'il est DÉPLOYÉ —
 * c'est déployé qu'il craint le vent, et replié qu'il n'y a rien à surveiller.
 *
 * Sert à tout ce qui met un ouvrant en valeur : teinte de l'icône, jauge de la vue Ouvrants, pilule
 * du marqueur 3D. Position inconnue = 0 : on n'affirme rien d'un moteur qui n'a rien dit.
 */
export function coverActivity(descriptor: Coverish | undefined, position: number | undefined): number {
  if (position === undefined) return 0
  return isFlatCover(descriptor) ? 1 - position / 100 : position / 100
}

/**
 * Vrai si l'appareil est « actif » : lampe allumée, volet ouvert, lecture en cours, robot au travail…
 *
 * `descriptor` : seul un OUVRANT en a besoin, et seulement pour sa nature — un volet se remarque
 * ouvert, un store déployé (voir `coverActivity`). Sans descripteur, c'est la règle du volet.
 */
export function isDeviceOn(s: DeviceState, descriptor?: DeviceDescriptor): boolean {
  if (!s.available) return false
  switch (s.kind) {
    case 'light': return s.on
    // position inconnue (RTS sans retour) : ni actif ni inactif, on ne teinte pas l'icône
    case 'cover': return coverActivity(descriptor, s.position) > 0
    case 'media_player': return isMediaActive(s)
    case 'climate': return s.mode !== 'off'
    case 'vacuum': return s.activity === 'cleaning'
    case 'mower': return s.activity === 'mowing'
    case 'ev_charger': return s.status === 'charging'
    case 'vehicle': return s.charging
    case 'energy': return s.productionW > 0
    case 'sensor': return false
    case 'camera': return false
    case 'weather': return false
    case 'water': return false
    // une ration EN TRAIN de tomber : le seul moment où une mangeoire fait quelque chose
    case 'pet_feeder': return s.feeding === true
    case 'pet_fountain': return s.on
    case 'fan': return s.on
  }
}

/**
 * Nature déclarée d'un appareil, quel que soit son kind (volet ou store, TV ou enceinte, sonnette,
 * pompe à chaleur…) : ce qu'une automatisation filtre quand elle vise « tous les volets » plutôt
 * que « tous les ouvrants ». Les défauts du CONTRAT s'appliquent : un lecteur muet sur sa nature
 * est une enceinte, un climat un thermostat. Absent = le kind n'a pas de nature.
 */
export function deviceClassOf(descriptor: DeviceDescriptor): string | undefined {
  const m = descriptor.meta
  switch (descriptor.kind) {
    case 'cover': return m.cover?.deviceClass
    case 'media_player': return m.mediaPlayer?.deviceClass ?? 'speaker'
    case 'camera': return m.camera?.deviceClass
    case 'sensor': return m.sensor?.deviceClass
    case 'climate': return m.climate?.deviceClass ?? 'thermostat'
    default: return undefined
  }
}
