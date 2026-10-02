// Mise à jour logicielle d'un véhicule : ce que la vue calcule elle-même, sans rien supposer du
// fabricant. Le contrat dit où en est la mise à jour (`softwareUpdate`) ; ici, on passe d'une heure
// choisie (« 02:00 ») au délai que la commande attend, et d'une date à un libellé lisible.

/**
 * Secondes d'ici la prochaine occurrence de `hhmm` (heure locale) : aujourd'hui si elle n'est pas
 * passée, sinon demain. Jamais 0 — « maintenant » est un autre geste —, jamais plus de 24 h, ce
 * que la commande `vehicle.schedule_update` accepte.
 */
export function delayUntil(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(':').map(Number)
  const at = new Date(now)
  at.setHours(h ?? 0, m ?? 0, 0, 0)
  if (at.getTime() <= now) at.setDate(at.getDate() + 1)
  // arrondi au-DESSUS : un délai arrondi au plus proche tombait à 01:59:59, et la confirmation disait « 01:59 »
  return Math.ceil((at.getTime() - now) / 1000)
}

/** Où tombe `at` par rapport à `now` : aujourd'hui, demain, ou plus loin (la date est alors dite). */
export function dayOf(at: number, now: number): 'today' | 'tomorrow' | 'later' {
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
  const diff = Math.round((day(at) - day(now)) / 86_400_000)
  return diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : 'later'
}
