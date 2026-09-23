import { z } from 'zod'
import { WEATHER_CONDITIONS } from '../devices/kinds'
import { deviceEntrySchema } from './ws'
import { pluginSceneEntrySchema } from '../scenes/scene'
import { automationEntrySchema, automationRunSchema } from '../automations/automation'

export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof apiErrorSchema>

export const devicesResponseSchema = z.object({ devices: z.array(deviceEntrySchema) })
export type DevicesResponse = z.infer<typeof devicesResponseSchema>

export const scenesResponseSchema = z.object({ scenes: z.array(pluginSceneEntrySchema) })
export type ScenesResponse = z.infer<typeof scenesResponseSchema>

/** `GET /api/automations`. */
export const automationsResponseSchema = z.object({ automations: z.array(automationEntrySchema) })
export type AutomationsResponse = z.infer<typeof automationsResponseSchema>
/** `PUT` et `PATCH /api/automations/:id` : l'automatisation écrite et son statut recalculé. */
export const automationResponseSchema = z.object({ automation: automationEntrySchema })
/** `POST /api/automations/:id/run` : le compte rendu, même en échec partiel. */
export const automationRunResponseSchema = z.object({ run: automationRunSchema })

export const PLUGIN_HEALTH_STATUSES = ['ok', 'degraded', 'needs_pairing', 'error', 'not_implemented', 'disabled'] as const
export const pluginHealthSchema = z.object({
  status: z.enum(PLUGIN_HEALTH_STATUSES),
  detail: z.string().optional(),
  deviceCount: z.number().int().optional(),
  /** Noms des variables d'environnement lues par le plugin (jamais leurs valeurs). */
  keys: z.array(z.string()).optional(),
  /**
   * Consommation d'un quota, quand l'API du fabricant est FACTURÉE ou bornée et que le plugin se
   * rationne (Tesla : les lectures du jour). `labelKey` est une clé i18n de l'app web — même
   * convention que `PluginPart.labelKey`, le serveur ne connaît pas la langue de la tablette.
   * Absent = ce plugin ne compte rien, et l'UI n'a rien à montrer.
   */
  quota: z.object({
    used: z.number().min(0),
    limit: z.number().positive(),
    labelKey: z.string(),
    /** `usd` : `used` et `limit` sont des DOLLARS, à formater comme une somme. Absent = un décompte. */
    unit: z.literal('usd').optional(),
    /** Début de la période comptée (ms epoch), quand elle en a une : l'UI peut la dater. */
    since: z.number().optional(),
  }).optional(),
})
export type PluginHealth = z.infer<typeof pluginHealthSchema>

/** Sous-item d'un plugin (un kind simulé par `mock`…) : ce que l'UI affiche et bascule. */
export const pluginPartSchema = z.object({
  id: z.string(),
  /** Clé i18n du libellé (`kinds.light`…) : le serveur ne connaît pas la langue de la tablette. */
  labelKey: z.string(),
  enabled: z.boolean(),
})
export type PluginPartInfo = z.infer<typeof pluginPartSchema>

/** Un plugin tel que le voit l'écran Réglages : ce qu'il est, ce qu'on en a choisi, comment il va. */
export const pluginInfoSchema = z.object({
  id: z.string(),
  /** Un squelette déclaré mais pas encore écrit ne s'active pas (interrupteur grisé). */
  implemented: z.boolean(),
  enabled: z.boolean(),
  /** N'a de sens que pour un plugin à scènes ; absent sinon. */
  autoDynamicForNewScenes: z.boolean().optional(),
  parts: z.array(pluginPartSchema),
  health: pluginHealthSchema,
})
export type PluginInfo = z.infer<typeof pluginInfoSchema>

export const pluginsResponseSchema = z.object({ plugins: z.array(pluginInfoSchema) })
export type PluginsResponse = z.infer<typeof pluginsResponseSchema>

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  uptimeS: z.number(),
  clients: z.number().int(),
  plugins: z.record(z.string(), pluginHealthSchema),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const commandResponseSchema = z.object({ ok: z.literal(true) })

/** Historique horaire d'un appareil énergie (moyennes par heure, ordre chronologique). */
export const energyHistoryPointSchema = z.object({
  /** Début de l'heure (ms epoch). */
  t: z.number(),
  productionW: z.number(),
  consumptionW: z.number(),
  gridW: z.number(),
  samples: z.number().int(),
})
export const energyHistorySchema = z.object({ deviceId: z.string(), points: z.array(energyHistoryPointSchema) })
export type EnergyHistoryPoint = z.infer<typeof energyHistoryPointSchema>
export type EnergyHistory = z.infer<typeof energyHistorySchema>

/**
 * Prévisions d'un appareil `weather`, servies À LA DEMANDE (`GET /api/devices/:id/forecast`) et non
 * poussées : plusieurs Ko qui changent à chaque sondage n'ont rien à faire sur le WebSocket d'une
 * tablette qui n'a pas la vue Météo ouverte — même arbitrage que l'historique énergie. Deux
 * granularités, chacune bornée : l'horaire pour la journée qui vient, le quotidien pour la semaine.
 * Les pourcentages sont sur 100, comme dans l'état.
 */
export const weatherHourlyPointSchema = z.object({
  /** Début de l'heure (ms epoch). */
  t: z.number(),
  condition: z.enum(WEATHER_CONDITIONS),
  tempC: z.number(),
  precipMm: z.number().min(0),
  precipProbability: z.number().min(0).max(100).optional(),
  windKmh: z.number().min(0),
  isDay: z.boolean(),
})
export const weatherDailyPointSchema = z.object({
  /** Minuit local du jour (ms epoch). */
  t: z.number(),
  condition: z.enum(WEATHER_CONDITIONS),
  minC: z.number(),
  maxC: z.number(),
  precipMm: z.number().min(0),
  precipProbability: z.number().min(0).max(100).optional(),
  uvIndexMax: z.number().min(0).optional(),
  sunrise: z.number().int(),
  sunset: z.number().int(),
})
export const weatherForecastSchema = z.object({
  deviceId: z.string(),
  /** Heure du run ou du sondage dont ces prévisions sortent (ms epoch). */
  issuedAt: z.number(),
  hourly: z.array(weatherHourlyPointSchema),
  daily: z.array(weatherDailyPointSchema),
})
export type WeatherHourlyPoint = z.infer<typeof weatherHourlyPointSchema>
export type WeatherDailyPoint = z.infer<typeof weatherDailyPointSchema>
export type WeatherForecast = z.infer<typeof weatherForecastSchema>

/**
 * Journal d'un appareil : ce qu'il a CONSIGNÉ lui-même — erreurs, avertissements —, daté et parfois
 * positionné. Servi à la demande (`GET /api/devices/:id/journal`) par un plugin qui déclare la
 * capacité `journal`, comme les prévisions d'un appareil météo : c'est un historique, pas un état.
 * Le premier robot à le publier est la tondeuse Husqvarna (`GET /mowers/{id}/messages`).
 */
export const JOURNAL_SEVERITIES = ['info', 'warning', 'error', 'fatal'] as const
export type JournalSeverity = (typeof JOURNAL_SEVERITIES)[number]
export const journalEntrySchema = z.object({
  /** Quand (ms epoch, vrai instant). */
  at: z.number(),
  severity: z.enum(JOURNAL_SEVERITIES),
  /** Code du fabricant, quand il en a un : c'est ce que le support demande. */
  code: z.number().int().optional(),
  /** Texte du fabricant, tel qu'il le publie (pas traduit). */
  message: z.string().min(1),
  /** Où c'est arrivé, quand l'appareil le sait — un GPS sans fix ne donne rien. */
  location: z.object({ lat: z.number(), lon: z.number() }).optional(),
})
export const deviceJournalSchema = z.object({
  deviceId: z.string(),
  /** Du plus récent au plus ancien. */
  entries: z.array(journalEntrySchema),
})
export type JournalEntry = z.infer<typeof journalEntrySchema>

/**
 * Ce qu'un appareil a CONSOMMÉ, par pas de temps — servi à la demande
 * (`GET /api/devices/:id/consumption`) comme les prévisions et le journal : c'est un historique,
 * pas un état, et il n'a rien à faire dans les messages poussés à chaque sondage.
 *
 * Trois séries, parce qu'un compteur d'eau se lit à trois échelles et qu'aucune ne se déduit des
 * autres : `hourly` dit à quelle heure on tire, `daily` couvre la semaine ET le mois (la même
 * série sert les deux vues, inutile de la stocker deux fois), `monthly` donne les douze mois.
 *
 * Chaque point porte ce qui a été consommé PENDANT son pas, jamais un cumul : un graphique
 * additionne des barres, il ne dérive pas un compteur. C'est au plugin de faire cette
 * soustraction, parce que lui seul sait quand son compteur est reparti de zéro.
 */
export const consumptionPointSchema = z.object({
  /** Début du pas (ms epoch) : heure pleine, minuit, ou premier jour du mois selon la série. */
  t: z.number().int(),
  /** Volume consommé pendant CE pas, en litres. */
  litres: z.number().min(0),
})
export const deviceConsumptionSchema = z.object({
  deviceId: z.string(),
  /** Du plus ancien au plus récent, un point par heure. Un pas jamais mesuré est absent, pas à zéro. */
  hourly: z.array(consumptionPointSchema),
  /** Un point par jour. */
  daily: z.array(consumptionPointSchema),
  /** Un point par mois. */
  monthly: z.array(consumptionPointSchema),
})
export type ConsumptionPoint = z.infer<typeof consumptionPointSchema>
export type DeviceConsumption = z.infer<typeof deviceConsumptionSchema>
export type DeviceJournal = z.infer<typeof deviceJournalSchema>
