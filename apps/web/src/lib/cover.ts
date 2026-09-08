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

export function coverWords(descriptor: { meta: { cover?: { deviceClass: string } } }): CoverWords {
  return UP_DOWN.has(descriptor.meta.cover?.deviceClass ?? '') ? 'upDown' : 'openClose'
}

