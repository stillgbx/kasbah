// Convention d'AFFICHAGE des ouvrants, isolée ici parce qu'elle est inverse du contrat.
//
// Le contrat (`packages/shared`) mesure une OUVERTURE : `position` 0 = fermé, 100 = ouvert. C'est
// ce que voient le JSON, le protocole, les plugins et `isDeviceOn` (« un volet ouvert est actif »).
// L'interface, elle, montre une FERMETURE : 0 % = ouvert, 100 % = fermé — plus intuitif pour un
// volet, et c'est aussi la convention du fabricant (`core:ClosureState` chez Overkiz).
//
// Le contrat n'a PAS été inversé : `position` sert à `isDeviceOn`, au comptage « volets ouverts »
// du résumé, à la teinte des marqueurs 3D et à tous les plugins. Inverser le modèle aurait
// propagé le changement partout ; inverser l'affichage le confine à ces deux fonctions.

/** Position du contrat (ouverture) → pourcentage affiché (fermeture). */
export function toClosure(position: number): number {
  return 100 - position
}

/** Pourcentage affiché (fermeture) → position du contrat (ouverture). */
export function fromClosure(closure: number): number {
  return 100 - closure
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

/** Un portail, une porte de garage donnent sur la rue : un geste d'ensemble ne les OUVRE jamais. */
const PASSAGE = new Set<string>(['gate', 'garage'])

export function isPassageCover(descriptor: Coverish | undefined): boolean {
  return PASSAGE.has(descriptor?.meta.cover?.deviceClass ?? '')
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
 * Clé i18n du mot qui décrit le REPOS de cet ouvrant : « Fermé » pour ce qui se tient debout,
 * « Remonté » pour un store. Sert à MONTRER l'état supposé quand la position est inconnue — le mot
 * seul serait une affirmation, il est donc toujours accompagné de son « (supposé) ».
 */
export function coverRestKey(descriptor: Coverish): string {
  return `cover.${coverWords(descriptor)}.${isFlatCover(descriptor) ? 'open' : 'closed'}`
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

