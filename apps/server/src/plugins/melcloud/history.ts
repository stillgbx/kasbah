import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SystemReading, ZoneReading } from './types'

// L'historique de FONCTIONNEMENT de la pompe à chaleur — quand elle a chauffé, combien de temps, à
// quelle température de départ, face à quel dehors.
//
// Il est construit ICI, au fil des sondages, et pas lu chez le fabricant : MELCloud sert bien un
// relevé d'énergie, mais cette installation n'a aucun compteur et le rend vide même sur un hiver
// entier (voir `__fixtures__/melcloud.ts`). Ce qu'on peut savoir, en revanche, c'est ce que chaque
// lecture montre — et une lecture toutes les deux minutes suffit à dire l'essentiel d'une grandeur
// aussi lente que du chauffage.
//
// Chaque point porte des COMPTES D'ÉCHANTILLONS, pas des minutes : c'est `n` qui donne l'échelle,
// et une heure mal sondée (serveur redémarré, cloud muet) se lit alors pour ce qu'elle est — une
// heure à trois échantillons — au lieu de se faire passer pour une heure creuse.

/** Une semaine d'heures. Au-delà, le fichier grossirait pour un usage que personne n'a demandé. */
export const HOURLY_POINTS_MAX = 168
const HOUR_MS = 3_600_000

export const heatingPointSchema = z.object({
  /** Début de l'heure (ms epoch). */
  t: z.number().int(),
  /** Échantillons pris dans cette heure : l'échelle de tous les compteurs qui suivent. */
  n: z.number().int().min(1),
  /** Échantillons où AU MOINS UNE zone chauffait (ni au repos, ni éteinte). */
  heating: z.number().int().min(0),
  /** Échantillons en dégivrage : la machine tourne et ne chauffe pas la maison. */
  defrost: z.number().int().min(0),
  /** Échantillons avec un appoint ÉLECTRIQUE en marche — ce qui coûte cher se voit là. */
  booster: z.number().int().min(0),
  outdoorC: z.number().nullable(),
  flowC: z.number().nullable(),
  returnC: z.number().nullable(),
})
export type HeatingPoint = z.infer<typeof heatingPointSchema>

export const melcloudHistorySchema = z.object({
  /** Du plus ancien au plus récent, un point par heure sondée. Une heure sans lecture est ABSENTE. */
  hourly: z.array(heatingPointSchema),
})
export type MelcloudHistoryState = z.infer<typeof melcloudHistorySchema>

interface Bucket {
  t: number
  n: number
  heating: number
  defrost: number
  booster: number
  outdoor: { sum: number; n: number }
  flow: { sum: number; n: number }
  ret: { sum: number; n: number }
}

const mean = (a: { sum: number; n: number }): number | null => (a.n ? Math.round((a.sum / a.n) * 10) / 10 : null)

/**
 * Accumulateur horaire. Sans état caché : `record` range l'échantillon dans son heure, `points`
 * rend ce qu'on a. La bascule d'heure est observable (`rolled`) pour que l'appelant sache quand il
 * vaut la peine d'écrire sur le disque — une fois par heure plutôt qu'à chaque sondage.
 */
export class HeatingHistory {
  private buckets: Bucket[] = []

  constructor(initial?: MelcloudHistoryState | null) {
    if (initial) this.buckets = initial.hourly.map(fromPoint)
  }

  /** @returns `true` quand cet échantillon a ouvert une nouvelle heure. */
  record(system: SystemReading, zones: ZoneReading[], at: number): boolean {
    const hour = Math.floor(at / HOUR_MS) * HOUR_MS
    let b = this.buckets[this.buckets.length - 1]
    let rolled = false
    if (!b || b.t !== hour) {
      // une machine qu'on ne suit plus n'apprend rien : ne pas ouvrir une heure pour elle
      if (system.stale) return false
      b = { t: hour, n: 0, heating: 0, defrost: 0, booster: 0, outdoor: { sum: 0, n: 0 }, flow: { sum: 0, n: 0 }, ret: { sum: 0, n: 0 } }
      this.buckets.push(b)
      rolled = true
      while (this.buckets.length > HOURLY_POINTS_MAX) this.buckets.shift()
    }
    if (system.stale) return rolled

    b.n++
    // `idle` est la clé : la machine est ALLUMÉE presque toute l'année, elle ne chauffe que par
    // moments. Compter `power` reviendrait à tracer une ligne plate de janvier à décembre.
    if (system.power && zones.some((z) => !z.idle)) b.heating++
    if (system.defrosting) b.defrost++
    if (system.boosterHeater || system.immersionHeater) b.booster++
    add(b.outdoor, system.outdoorTempC)
    add(b.flow, system.flowTempC)
    add(b.ret, system.returnTempC)
    return rolled
  }

  points(): HeatingPoint[] {
    return this.buckets.filter((b) => b.n > 0).map((b) => ({
      t: b.t,
      n: b.n,
      heating: b.heating,
      defrost: b.defrost,
      booster: b.booster,
      outdoorC: mean(b.outdoor),
      flowC: mean(b.flow),
      returnC: mean(b.ret),
    }))
  }

  toState(): MelcloudHistoryState {
    return { hourly: this.points() }
  }
}

function add(acc: { sum: number; n: number }, v: number | null): void {
  if (v !== null) { acc.sum += v; acc.n++ }
}

/**
 * Un point relu du disque redevient un seau. Les moyennes ont perdu leurs sommes : on les repose
 * comme UN échantillon de la valeur moyenne, ce qui garde la valeur juste et laisse la suite de
 * l'heure la corriger. Sans importance en pratique — on ne relit qu'au démarrage, donc au plus une
 * heure partielle.
 */
function fromPoint(p: HeatingPoint): Bucket {
  const one = (v: number | null) => (v === null ? { sum: 0, n: 0 } : { sum: v, n: 1 })
  return {
    t: p.t, n: p.n, heating: p.heating, defrost: p.defrost, booster: p.booster,
    outdoor: one(p.outdoorC), flow: one(p.flowC), ret: one(p.returnC),
  }
}

export interface HistoryStore {
  load(): Promise<MelcloudHistoryState | null>
  save(h: MelcloudHistoryState): Promise<void>
}

/** Écriture atomique (fichier temporaire puis renommage) ; une lecture illisible vaut « rien ». */
export function createHistoryFile(path: string, logger?: Logger): HistoryStore {
  return {
    async load() {
      try {
        const parsed = melcloudHistorySchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'MELCloud history file is unreadable (or from an older version), starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(h) {
      try {
        await mkdir(dirname(path), { recursive: true })
        const tmp = `${path}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(h, null, 2), 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger?.warn({ err, path }, 'could not write the MELCloud history file')
      }
    },
  }
}
