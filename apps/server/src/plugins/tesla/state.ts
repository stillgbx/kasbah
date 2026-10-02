import { readFile } from 'node:fs/promises'
import type { StatePatch } from '@kasbah/shared'
import { VEHICLE_FINISHES, releaseNoteSchema } from '@kasbah/shared'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'

// Ce que le plugin Tesla garde entre deux démarrages, et qui n'est ni un secret ni un jeton :
//
//  1. Le DERNIER ÉTAT de chaque véhicule. Sans lui, un redémarrage du serveur repart d'une carte
//     vide (« Jamais lu », 0 %) jusqu'à la prochaine lecture — qui peut attendre des heures, le
//     temps que la voiture se réveille d'elle-même. Ce sont les dernières valeurs connues : elles
//     étaient déjà affichées comme telles (`readAt` les date), rien n'est inventé.
//
//  2. La PEINTURE (`vehicle_config`) : teinte et aspect lus dans une lecture complète. Absente de
//     la liste des véhicules, elle disparaîtrait au redémarrage si la voiture dort — et la scène
//     3D retomberait sur la couleur de thème jusqu'au prochain réveil.
//
//  3. La CONSOMMATION du cycle de facturation. Tesla offre 10 $ par mois et par compte, et compte
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
  // les NOTES DE VERSION ne coûtent rien : la console du fabricant l'a tranché le 2026-10-02 — cinq
  // appels `release_notes` seuls, puis une lecture complète : « Données » n'a pris que 1
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

export const vehiclePaintSchema = z.object({
  color: z.string().optional(),
  finish: z.enum(VEHICLE_FINISHES).optional(),
})
export type VehiclePaint = z.infer<typeof vehiclePaintSchema>

const notesVersionSchema = z.object({ version: z.string(), notes: z.array(releaseNoteSchema) })

/**
 * Notes de version d'un véhicule, telles qu'on les a lues. Elles ne changent qu'avec une version :
 * relues quand `key` (version installée, version en attente) ne correspond plus, ou quand leurs
 * illustrations — des URL signées — approchent de leur échéance (`expiresAt`).
 *
 * `history` s'ALLONGE au fil des mises à jour : Tesla ne rend que les versions depuis la dernière
 * grosse mise à jour, Kasbah garde les précédentes. Leurs illustrations finissent par expirer ; le
 * texte, lui, reste.
 */
export const releaseNotesCacheSchema = z.object({
  key: z.string(),
  fetchedAt: z.number(),
  expiresAt: z.number().optional(),
  installedVersion: z.string().optional(),
  pending: notesVersionSchema.optional(),
  history: z.record(z.string(), z.array(releaseNoteSchema)).default({}),
  /** Tesla a rendu les MÊMES textes qu'en anglais pour cette langue : il ne la publie pas, on sert l'anglais. */
  ignored: z.boolean().optional(),
})
export type ReleaseNotesCache = z.infer<typeof releaseNotesCacheSchema>

export const teslaStateSchema = z.object({
  cycle: cycleSchema.optional(),
  /**
   * Dernier état connu par VIN. Schéma volontairement LARGE (`z.unknown()` par clé) : le contrat de
   * l'appareil peut gagner des champs, et un fichier écrit par une version précédente ne doit pas
   * faire échouer le démarrage. Le registre valide de toute façon ce qu'on lui émet.
   */
  vehicles: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** Peinture par VIN : survit au redémarrage quand la voiture dort (pas dans la liste Fleet). */
  paints: z.record(z.string(), vehiclePaintSchema).default({}),
  /**
   * Notes de version par VIN, puis par langue (`en`, `fr`…) : voir `releaseNotesCacheSchema`. Un
   * cache d'une autre forme est OUBLIÉ, jamais bloquant (`catch`) : ce n'est que du contenu qu'on
   * relit. Sans cela, un fichier écrit par une version précédente était rejeté EN ENTIER, compteur
   * du mois compris (vu le 2026-10-02 : tout le 1er octobre perdu).
   */
  releaseNotes: z.record(z.string(), z.record(z.string(), releaseNotesCacheSchema)).default({}).catch({}),
  /**
   * Langues dans lesquelles on a DEMANDÉ les notes (l'anglais, repli, est toujours lu en plus) :
   * le serveur ne connaît pas la langue de l'app, il apprend celles qu'on lui demande.
   */
  releaseNotesLangs: z.array(z.string()).default([]).catch([]),
})
export type TeslaState = z.infer<typeof teslaStateSchema>

export const emptyState = (): TeslaState => ({ vehicles: {}, paints: {}, releaseNotes: {}, releaseNotesLangs: [] })

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
      // `persist()` n'attend pas : la file de `writeFileAtomic` sépare deux écritures rapprochées
      try { await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`) }
      catch (err) { logger?.warn({ err, path }, 'could not write Tesla state cache') }
    },
  }
}

/** Patch d'état d'un véhicule tel qu'on le garde (le contrat le valide à l'émission). */
export type StoredVehicleState = StatePatch<'vehicle'>
