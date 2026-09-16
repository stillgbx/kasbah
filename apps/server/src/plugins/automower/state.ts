import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'

// Ce que le plugin garde entre deux démarrages : le nombre de requêtes de la FENÊTRE en cours. Le
// portail développeur du fabricant (relevé du 2026-09-16) borne chaque clé d'application à **21 000
// requêtes par fenêtre de sept jours**, calée sur la création de l'application (« Resets at
// 2026-09-23 17:00 » pour une application créée le 16 à 17 h) — et non 10 000 par mois comme la
// documentation tierce le disait. Il ne compte que les appels à l'API Automower Connect : les
// jetons demandés au serveur d'authentification n'y figurent pas (33 chez lui, 35 chez nous avant
// cette correction). Sans mémoire, la jauge repartirait de zéro à chaque redémarrage.

/** Quota d'une clé d'application par fenêtre, tel que le portail développeur l'affiche. */
export const WINDOW_REQUESTS = 21_000
/** La fenêtre du fabricant : sept jours, glissants par pas entiers depuis son ancrage. */
export const WINDOW_MS = 7 * 86_400_000

export const usageSchema = z.object({
  /** Début de la fenêtre courante (ms epoch). */
  windowStart: z.number().int(),
  requests: z.number().int().min(0),
})
export type AutomowerUsage = z.infer<typeof usageSchema>

export interface UsageStore {
  load(): Promise<AutomowerUsage | null>
  save(u: AutomowerUsage): Promise<void>
}

/**
 * Le début de la fenêtre qui contient `now`, sur la grille de sept jours ancrée sur `anchor` — un
 * instant de remise à zéro connu (passé ou futur, peu importe : la grille est périodique).
 */
export function windowStartOf(anchor: number, now: number): number {
  return anchor + Math.floor((now - anchor) / WINDOW_MS) * WINDOW_MS
}

/**
 * Le compte de la fenêtre COURANTE. Ancrage : l'instant configuré (`AUTOMOWER_QUOTA_RESET_AT`) s'il
 * y en a un, sinon le début de la fenêtre déjà connue, sinon maintenant — la première requête, qui
 * suit de peu la création de l'application. Une fenêtre écoulée repart de zéro sur la même grille.
 */
export function currentUsage(saved: AutomowerUsage | null, now: number, anchor?: number): AutomowerUsage {
  const start = windowStartOf(anchor ?? saved?.windowStart ?? now, now)
  return saved && saved.windowStart === start ? saved : { windowStart: start, requests: 0 }
}

/** Écriture atomique (fichier temporaire puis renommage) ; une lecture illisible vaut « rien ». */
export function createUsageFile(path: string, logger?: Logger): UsageStore {
  return {
    async load() {
      try {
        const parsed = usageSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'Automower usage file is unreadable (or from an older version), starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(u) {
      try {
        await mkdir(dirname(path), { recursive: true })
        const tmp = `${path}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(u, null, 2), 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger?.warn({ err, path }, 'could not write the Automower usage file')
      }
    },
  }
}
