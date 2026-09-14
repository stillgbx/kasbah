import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { StatePatch } from '@kasbah/shared'
import type { Logger } from 'pino'
import { z } from 'zod'

// Ce que le plugin Tesla garde entre deux démarrages, et qui n'est ni un secret ni un jeton :
//
//  1. Le DERNIER ÉTAT de chaque véhicule. Sans lui, un redémarrage du serveur repart d'une carte
//     vide (« Jamais lu », 0 %) jusqu'à la prochaine lecture — qui peut attendre des heures, le
//     temps que la voiture se réveille d'elle-même. Ce sont les dernières valeurs connues : elles
//     étaient déjà affichées comme telles (`readAt` les date), rien n'est inventé.
//
//  2. La CONSOMMATION du cycle de facturation. Tesla offre 10 $ par mois et par compte, et compte
//     en mois CALENDAIRE (« Billing cycles are monthly, starting on the first day »,
//     developer.tesla.com/docs/fleet-api/billing-and-limits). Le compteur doit donc survivre à un
//     redémarrage, sinon la jauge repart de zéro et ne veut plus rien dire.

/** Prix unitaires de la Fleet API, en dollars (relevé le 2026-09-13, tarifs en vigueur depuis 2025-01-01). */
export const PRICE_USD = {
  /** Lecture de données : 1 $ pour 500 (`vehicle_data` ; la LISTE des véhicules, elle, ne coûte rien). */
  data: 1 / 500,
  /** Réveil : 1 $ pour 50. Dix fois le prix d'une lecture, d'où le geste explicite dans l'UI. */
  wake: 1 / 50,
  /** Commande : 1 $ pour 1000. */
  command: 1 / 1000,
} as const
export type BillableKind = keyof typeof PRICE_USD

/** Crédit offert par Tesla, par compte et par mois : le quota que l'utilisateur veut ne pas dépasser. */
export const MONTHLY_CREDIT_USD = 10

/**
 * Ce qu'un appel COÛTE, d'après son chemin. `null` = rien à compter.
 *
 * **La LISTE des véhicules (`GET /api/1/vehicles`) ne coûte rien** : la documentation ne publie pas sa
 * catégorie tarifaire, mais la console du fabricant l'a tranché le 2026-09-14 — elle relevait 3
 * requêtes « Données » par jour là où le plugin en faisait 144 rien qu'en listant. Seules la lecture
 * complète, le réveil et les commandes sont facturés. Le chemin d'une lecture commence par celui de
 * la liste : c'est `vehicle_data` qu'il faut reconnaître, pas le préfixe.
 */
export function billableKind(path: string): BillableKind | null {
  if (path.includes('/wake_up')) return 'wake'
  if (path.includes('/command/')) return 'command'
  if (path.includes('/vehicle_data')) return 'data'
  return null
}

/**
 * Début du cycle, en millisecondes : le **1er du mois à 00:00 UTC**. La console du fabricant le dit
 * sans ambiguïté (« les cycles de facturation commencent le 1er de chaque mois ») : la date de
 * liaison du compte ne compte pour rien, et l'afficher laisserait croire à un cycle glissant.
 * DÉDUIT du mois, jamais gardé — un champ qui se recalcule ne peut pas mentir après un redémarrage.
 */
export function cycleStart(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)
}

/** Mois calendaire d'une date, en UTC (`2026-09`) : la clé du cycle de facturation. */
export function cycleKey(now: number): string {
  const d = new Date(now)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const cycleSchema = z.object({
  /** Mois du cycle (`2026-09`). Un mois différent = on repart de zéro. */
  month: z.string(),
  data: z.number().min(0).default(0),
  wakes: z.number().min(0).default(0),
  commands: z.number().min(0).default(0),
})
export type Cycle = z.infer<typeof cycleSchema>

export const teslaStateSchema = z.object({
  cycle: cycleSchema.optional(),
  /**
   * Dernier état connu par VIN. Schéma volontairement LARGE (`z.unknown()` par clé) : le contrat de
   * l'appareil peut gagner des champs, et un fichier écrit par une version précédente ne doit pas
   * faire échouer le démarrage. Le registre valide de toute façon ce qu'on lui émet.
   */
  vehicles: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
})
export type TeslaState = z.infer<typeof teslaStateSchema>

export const emptyState = (): TeslaState => ({ vehicles: {} })

/** Le cycle en cours, remis à zéro si le mois a changé. Ne mute rien : rend le cycle à utiliser. */
export function currentCycle(state: TeslaState, now: number): Cycle {
  const month = cycleKey(now)
  if (state.cycle?.month === month) return state.cycle
  return { month, data: 0, wakes: 0, commands: 0 }
}

/** Compte un appel facturable dans le cycle courant (en le faisant rouler si le mois a changé). */
export function countCall(state: TeslaState, kind: BillableKind, now: number): Cycle {
  const cycle = { ...currentCycle(state, now) }
  if (kind === 'data') cycle.data += 1
  else if (kind === 'wake') cycle.wakes += 1
  else cycle.commands += 1
  state.cycle = cycle
  return cycle
}

/** Dépense estimée du cycle, en dollars. Une ESTIMATION : seul le fabricant facture. */
export function cycleCostUsd(cycle: Cycle | undefined): number {
  if (!cycle) return 0
  const usd = cycle.data * PRICE_USD.data + cycle.wakes * PRICE_USD.wake + cycle.commands * PRICE_USD.command
  return Math.round(usd * 1000) / 1000
}

export interface TeslaStateStore {
  load(): Promise<TeslaState | null>
  save(state: TeslaState): Promise<void>
}

/**
 * Fichier JSON atomique (`.tmp` puis `rename`). Fichier absent ou illisible = état vide, jamais une
 * erreur fatale : le plugin doit démarrer même si le disque refuse — il relira la voiture, voilà tout.
 */
export function createStateFile(path: string, logger?: Logger): TeslaStateStore {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return null }
      const parsed = teslaStateSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger?.warn({ path }, 'unreadable Tesla state cache, starting fresh'); return null }
      return parsed.data
    },
    async save(state) {
      const tmp = `${path}.${process.pid}.tmp`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger?.warn({ err, path }, 'could not write Tesla state cache')
      }
    },
  }
}

/** Patch d'état d'un véhicule tel qu'on le garde (le contrat le valide à l'émission). */
export type StoredVehicleState = StatePatch<'vehicle'>
