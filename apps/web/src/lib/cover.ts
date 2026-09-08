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
