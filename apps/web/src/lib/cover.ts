import { coverWords, isFlatCover } from '@kasbah/shared'

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

// Règles partagées avec le serveur (automatisations) : elles vivent dans `@kasbah/shared`, ce
// fichier les ré-exporte pour que les appelants de l'interface n'aient rien à changer.
export { coverActivity, coverAtRest, coverWords, isFlatCover, type CoverWords } from '@kasbah/shared'

type Coverish = { meta: { cover?: { deviceClass: string } } }

/** Position du contrat (ouverture) → pourcentage affiché (fermeture). */
export function toClosure(position: number): number {
  return 100 - position
}

/** Pourcentage affiché (fermeture) → position du contrat (ouverture). */
export function fromClosure(closure: number): number {
  return 100 - closure
}

/** Un portail, une porte de garage donnent sur la rue : un geste d'ensemble ne les OUVRE jamais. */
const PASSAGE = new Set<string>(['gate', 'garage'])

export function isPassageCover(descriptor: Coverish | undefined): boolean {
  return PASSAGE.has(descriptor?.meta.cover?.deviceClass ?? '')
}

/**
 * Ouvrant qui ATTEND une ouverture : un volet, un store intérieur, un rideau, une fenêtre motorisée
 * n'ont aucun sens sans la fenêtre ou la porte qu'ils habillent. Tant qu'aucune ouverture ne leur est
 * affectée, ils sont à poser — c'est le cas de tous ceux que la découverte d'un plugin vient
 * d'apporter, quand la maison a été dessinée avant qu'on active ce plugin.
 *
 * Un store BANNE en est exclu, bien qu'il se manœuvre comme un store intérieur : il se déploie
 * au-dessus d'une terrasse, pas dans une baie. Il PEUT être affecté à une ouverture si l'installation
 * le veut (`canTakeOpening` l'accepte), mais son absence d'ouverture n'est pas un travail en retard.
 */
const EXPECTS_OPENING = new Set<string>(['shutter', 'blind', 'curtain', 'window'])

export function expectsOpening(descriptor: Coverish | undefined): boolean {
  return EXPECTS_OPENING.has(descriptor?.meta.cover?.deviceClass ?? '')
}

/**
 * Ouvrant qu'on a le DROIT d'affecter à une ouverture — tout sauf un PORTAIL. Plus large
 * qu'`expectsOpening` à dessein : un store banne posé au-dessus d'une baie est un cas réel, on ne
 * l'interdit pas ; on ne le réclame simplement pas.
 *
 * Une porte de GARAGE en fait partie, bien qu'elle donne sur la rue : quand le garage est relevé,
 * elle EST le panneau d'une ouverture de la façade — la lier lui donne les cotes de la baie, et le
 * bâti cesse alors d'y dessiner son propre vantail (`dressedOpenings`). Un portail, lui, se tient
 * dans le jardin : aucun mur ne le porte.
 */
export function canTakeOpening(descriptor: Coverish | undefined): boolean {
  return !!descriptor && descriptor.meta.cover?.deviceClass !== 'gate'
}

/**
 * Clé i18n du mot qui décrit le REPOS de cet ouvrant : « Fermé » pour ce qui se tient debout,
 * « Remonté » pour un store. Sert à MONTRER l'état supposé quand la position est inconnue — le mot
 * seul serait une affirmation, il est donc toujours accompagné de son « (supposé) ».
 */
export function coverRestKey(descriptor: Coverish): string {
  return `cover.${coverWords(descriptor)}.${isFlatCover(descriptor) ? 'open' : 'closed'}`
}
