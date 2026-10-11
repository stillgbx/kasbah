import { z } from 'zod'
import { commandSchema } from '../devices/command'
import { deviceIdSchema } from '../devices/descriptor'
import { DEVICE_KINDS } from '../devices/kinds'
import { SCENE_RECALL_MODES, sceneIdSchema } from '../scenes/scene'
import { daysSchema, deviceClassSchema, hhmmSchema, isoDateSchema, predicateSchema } from './predicate'

// Une automatisation est une règle PLATE : un déclencheur (« Quand »), des bloqueurs (« Sauf si »),
// des actions (« Alors »). Pas de graphe, pas de branche : les exemples réels de la maison y tiennent
// tous, et l'éditeur reste un formulaire faisable au doigt.
//
// Elle vit dans un fichier PAR MAISON (`<maison>.automations.json`, voir le serveur), elle est
// exécutée par le serveur (l'écran dort), et elle ne connaît que le contrat : aucun plugin n'a
// rien à implémenter pour qu'on automatise ses appareils.

export const SUN_EVENTS = ['dawn', 'sunrise', 'sunset', 'dusk'] as const
export type SunEvent = (typeof SUN_EVENTS)[number]

/**
 * Déclencheur HORAIRE : une heure fixe, ou un passage du soleil décalé (« 15 min avant le
 * crépuscule »). Les bornes `notBefore` / `notAfter` se lisent le MÊME jour et ramènent l'heure
 * calculée dedans : « au coucher, mais jamais après 22:00 ».
 */
export const timeTriggerSchema = z.object({
  type: z.literal('time'),
  at: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('clock'), time: hhmmSchema }),
    z.object({
      kind: z.literal('sun'), event: z.enum(SUN_EVENTS),
      /** Minutes, négatif = avant. */
      offsetMin: z.number().int().min(-720).max(720).optional(),
      notBefore: hhmmSchema.optional(),
      notAfter: hhmmSchema.optional(),
    }),
  ]),
  /** Absent = tous les jours. */
  days: daysSchema.optional(),
  /** Absent = toute l'année. Bornes comprises. */
  dateRange: z.object({ from: isoDateSchema, to: isoDateSchema }).optional(),
})
export type TimeTrigger = z.infer<typeof timeTriggerSchema>

/**
 * Déclencheur d'ÉTAT : un prédicat qui DEVIENT vrai (front montant). `forMin` exige qu'il le reste
 * tant de minutes (« la production dépasse la consommation depuis 10 min »). Une contrainte horaire
 * n'a rien à faire ici — elle ne serait réévaluée qu'au prochain changement d'appareil : elle va dans
 * `unless`.
 */
export const stateTriggerSchema = z.object({
  type: z.literal('state'),
  when: predicateSchema,
  forMin: z.number().int().positive().max(1440).optional(),
})
export type StateTrigger = z.infer<typeof stateTriggerSchema>

// Itération 2, décrits ici pour que la forme leur fasse de la place (NON implémentés) :
//   { type: 'forecast', deviceId, field: 'precipProbability' | 'windKmh', op, value, horizonH }
//   { type: 'event', deviceId, event: DEVICE_EVENT_KINDS }   — sonnette, mouvement, personne
export const triggerSchema = z.discriminatedUnion('type', [timeTriggerSchema, stateTriggerSchema])
export type Trigger = z.infer<typeof triggerSchema>

/**
 * CIBLE d'une commande : des appareils nommés, ou une SÉLECTION résolue au moment d'agir (« tous les
 * volets du rez-de-chaussée ») — une lampe ajoutée demain y entre sans rien réécrire. Aucune pièce,
 * aucun niveau, aucune zone = toute la maison. `exceptRoomsWith` écarte les appareils dont la pièce
 * contient un appareil ACTIF de ce kind : « toutes les lumières, sauf là où la TV est allumée ».
 */
export const targetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('devices'), deviceIds: z.array(deviceIdSchema).min(1).max(50) }),
  z.object({
    type: z.literal('selector'),
    kind: z.enum(DEVICE_KINDS),
    deviceClass: deviceClassSchema.optional(),
    roomIds: z.array(z.string().min(1)).optional(),
    levelIds: z.array(z.string().min(1)).optional(),
    zoneIds: z.array(z.string().min(1)).optional(),
    exceptRoomsWith: z.object({ kind: z.enum(DEVICE_KINDS), deviceClass: deviceClassSchema.optional() }).optional(),
  }),
])
export type Target = z.infer<typeof targetSchema>

/** Rappel d'une ambiance de fabricant, mode ÉCRIT (pas le défaut de `sceneRecallSchema`). */
export const automationRecallSchema = z.object({
  mode: z.enum(SCENE_RECALL_MODES),
  brightness: z.number().min(0).max(100).optional(),
  transitionMs: z.number().int().min(0).optional(),
})

export const actionSchema = z.discriminatedUnion('type', [
  /**
   * Une commande du contrat, vérifiée appareil par appareil comme depuis l'interface. `forMin` :
   * « pendant N minutes » — au bout, la commande INVERSE part sur les appareils qui ont accusé
   * réception (`inverseCommand`) ; ignoré pour une commande qui n'en a pas.
   */
  z.object({ type: z.literal('command'), target: targetSchema, command: commandSchema, forMin: z.number().int().positive().max(1440).optional() }),
  z.object({ type: z.literal('recallScene'), sceneId: sceneIdSchema, recall: automationRecallSchema }),
  // Itération 2 : { type: 'system.run', name } (liste blanche du .env) ; { type: 'webhook', url }
])
export type AutomationAction = z.infer<typeof actionSchema>

export const AUTOMATION_ID_RE = /^[a-z0-9_.-]{1,64}$/i
export const automationIdSchema = z.string().regex(AUTOMATION_ID_RE, 'id : [a-z0-9_.-], 64 car. au plus')

export const automationSchema = z.object({
  id: automationIdSchema,
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  trigger: triggerSchema,
  /** « Sauf si » : l'automatisation ne fait RIEN si l'un d'eux est vrai. */
  unless: z.array(predicateSchema).max(20),
  actions: z.array(actionSchema).min(1).max(20),
  /** Posé par le serveur à chaque écriture. */
  updatedAt: z.number().int().optional(),
})
export type Automation = z.infer<typeof automationSchema>

/** Corps d'un `PUT /api/automations/:id` : l'id vient de l'URL, `updatedAt` du serveur. */
export const automationBodySchema = automationSchema.omit({ id: true, updatedAt: true })
export type AutomationBody = z.input<typeof automationBodySchema>

/** Corps d'un `PATCH` : écrit à la main (un `.partial()` réinjecterait les défauts de zod 4). */
export const automationPatchSchema = z.object({ enabled: z.boolean() })

/** Corps d'un `PUT /api/automation-order` : l'ordre de la liste, celui du fichier. */
export const automationOrderSchema = z.object({ ids: z.array(automationIdSchema).max(1000) })

/** Le fichier sur disque. */
export const automationsFileSchema = z.object({ schemaVersion: z.literal(1), automations: z.array(automationSchema) })
export type AutomationsFile = z.infer<typeof automationsFileSchema>

// ── Statut, calculé par le serveur et poussé à l'interface ────────────────────────────────────

export const AUTOMATION_HEALTHS = ['ok', 'incomplete', 'unavailable'] as const
export type AutomationHealth = (typeof AUTOMATION_HEALTHS)[number]

/** `skipped` : déclenchée, mais un « sauf si » tenait. */
export const RUN_OUTCOMES = ['ok', 'partial', 'failed', 'skipped'] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

export const automationRunSchema = z.object({
  at: z.number().int(),
  by: z.enum(['time', 'state', 'manual']),
  outcome: z.enum(RUN_OUTCOMES),
  errors: z.array(z.object({
    /** Rang de l'action dans la liste. */
    action: z.number().int().min(0),
    deviceId: deviceIdSchema.optional(),
    code: z.string(),
    message: z.string(),
  })),
})
export type AutomationRun = z.infer<typeof automationRunSchema>

export const MISSING_REF_KINDS = ['device', 'field', 'scene', 'room', 'level', 'zone', 'parking'] as const

export const automationStatusSchema = z.object({
  /** `incomplete` : une référence manque ; `unavailable` : un appareil référencé ne répond pas. */
  health: z.enum(AUTOMATION_HEALTHS),
  /** Ce qui n'existe pas EN CE MOMENT (plugin éteint, pièce supprimée, champ inconnu du kind…). */
  missing: z.array(z.object({ kind: z.enum(MISSING_REF_KINDS), id: z.string() })),
  unavailableDeviceIds: z.array(deviceIdSchema),
  lastRun: automationRunSchema.optional(),
  /** Déclencheur horaire actif : prochaine heure prévue. */
  nextRunAt: z.number().int().optional(),
  /** Déclencheur d'état avec `forMin` : la condition tient depuis. */
  pendingSince: z.number().int().optional(),
})
export type AutomationStatus = z.infer<typeof automationStatusSchema>

export const automationEntrySchema = z.object({ automation: automationSchema, status: automationStatusSchema })
export type AutomationEntry = z.infer<typeof automationEntrySchema>
