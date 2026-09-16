import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'

// Ce que le plugin garde entre deux démarrages : le nombre de requêtes du MOIS. Le fabricant borne
// chaque clé d'application à 10 000 requêtes par mois (et une par seconde) ; sans mémoire, la jauge
// repartirait de zéro à chaque redémarrage et ne voudrait plus rien dire. Pas de jeton ici (il se
// redemande), pas d'état de robot (la première lecture arrive tout de suite au démarrage).

/** Quota mensuel d'une clé d'application, tel que le fabricant l'annonce. */
export const MONTHLY_REQUESTS = 10_000

export const usageSchema = z.object({
  /** Mois calendaire UTC (`2026-09`). */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  requests: z.number().int().min(0),
})
export type AutomowerUsage = z.infer<typeof usageSchema>

export interface UsageStore {
  load(): Promise<AutomowerUsage | null>
  save(u: AutomowerUsage): Promise<void>
}

export function monthKey(now: number): string {
  const d = new Date(now)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Début du mois, en ms : ce que l'UI écrit après « depuis le ». */
export function monthStart(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)
}

/** Le compte du mois COURANT : un fichier d'un autre mois repart de zéro. */
export function currentUsage(saved: AutomowerUsage | null, now: number): AutomowerUsage {
  const month = monthKey(now)
  return saved && saved.month === month ? saved : { month, requests: 0 }
}

/** Écriture atomique (fichier temporaire puis renommage) ; une lecture illisible vaut « rien ». */
export function createUsageFile(path: string, logger?: Logger): UsageStore {
  return {
    async load() {
      try {
        const parsed = usageSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'Automower usage file is unreadable, ignoring it'); return null }
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
