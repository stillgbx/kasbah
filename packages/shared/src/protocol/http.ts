import { z } from 'zod'
import { WEATHER_CONDITIONS } from '../devices/kinds'
import { deviceEntrySchema } from './ws'
import { pluginSceneEntrySchema } from '../scenes/scene'
import { automationEntrySchema, automationRunSchema } from '../automations/automation'
import { shoppingListSchema } from '../shopping/shopping'

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

/** Toutes les routes `/api/shopping` : la liste entière après l'opération. */
export const shoppingResponseSchema = z.object({ shopping: shoppingListSchema })

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
   * convention que `PluginPart.labelKey`, le serveur ne connaît pas la langue de l'interface.
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
  /** Clé i18n du libellé (`kinds.light`…) : le serveur ne connaît pas la langue de l'interface. */
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

/**
 * Une PROPRIÉTÉ que l'application sait montrer : une maison, un appartement. Un serveur lancé sans
 * maison (`KASBAH_HOUSE_FILE` absent) propose les démonstrations, en lecture seule (`demo`), et les
 * propriétés créées ou dupliquées sur ce poste ; une installation réelle n'en a qu'une, et la liste
 * ne compte alors qu'elle — le sélecteur ne s'affiche pas.
 */
export const PROPERTY_KINDS = ['house', 'apartment'] as const
export type PropertyKind = (typeof PROPERTY_KINDS)[number]
export const propertySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(PROPERTY_KINDS),
  /** Propriété de démonstration : elle se regarde, elle ne se modifie pas (on la duplique). */
  demo: z.boolean().optional(),
})
export type PropertySummary = z.infer<typeof propertySummarySchema>
/** `GET /api/properties` : les propriétés et celle qui est montrée. `switchable` = on peut en changer. */
export const propertiesResponseSchema = z.object({
  activeId: z.string().min(1),
  switchable: z.boolean(),
  properties: z.array(propertySummarySchema),
  /** Le serveur sait créer et dupliquer une propriété (`POST /api/properties`, `…/duplicate`). */
  canCreate: z.boolean().optional(),
  /** Le mode montré : les démonstrations, ou les propriétés réelles du poste. Absent = maison imposée. */
  mode: z.enum(['demo', 'real']).optional(),
  /** Il existe au moins une propriété réelle : le mode « réel » peut se choisir. */
  realAvailable: z.boolean().optional(),
})
export type PropertiesResponse = z.infer<typeof propertiesResponseSchema>

const propertyNameSchema = z.string().trim().min(1).max(60)
/** `POST /api/properties` : la maison d'une installation neuve (voir `newHouseJson`). */
export const newPropertyBodySchema = z.object({
  name: propertyNameSchema,
  kind: z.enum(PROPERTY_KINDS),
  origin: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    heading: z.number().min(-360).max(360),
    alt: z.number().min(-500).max(9000).optional(),
  }),
  terrain: z.object({ width: z.number().min(5).max(2000), depth: z.number().min(5).max(2000) }).optional(),
  levelName: propertyNameSchema,
  roomName: propertyNameSchema,
})
export type NewPropertyBody = z.infer<typeof newPropertyBodySchema>
/** `POST /api/properties/:id/duplicate` : la copie modifiable d'une propriété, sous un autre nom. */
export const duplicatePropertyBodySchema = z.object({ name: propertyNameSchema })
export const propertyCreatedSchema = z.object({ id: z.string().min(1) })
/** Les deux modes d'un serveur sans maison imposée : démonstrations (lecture seule) ou propriétés réelles. */
export const PROPERTY_MODES = ['demo', 'real'] as const
export type PropertyMode = (typeof PROPERTY_MODES)[number]
/** `POST /api/properties/mode` : passer en démo ou en réel (le serveur rouvre la propriété retenue du mode). */
export const propertyModeBodySchema = z.object({ mode: z.enum(PROPERTY_MODES) })
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
 * poussées : plusieurs Ko qui changent à chaque sondage n'ont rien à faire sur le WebSocket d'un
 * écran qui n'a pas la vue Météo ouverte — même arbitrage que l'historique énergie. Deux
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

/**
 * Notes de version d'un véhicule qui déclare la capacité `release_notes`, servies à la demande
 * (`GET /api/devices/:id/release-notes`). C'est du CONTENU, pas un état : il change une fois par
 * version, le plugin le garde en cache et ne le relit que quand une version change. Le texte est
 * celui du fabricant, dans SA langue (Tesla répond en anglais) : rien n'est traduit ici.
 */
export const releaseNoteSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  /** Illustration pour le thème sombre, et sa variante claire. URL signées qui EXPIRENT : absentes une fois périmées. */
  imageUrl: z.string().optional(),
  lightImageUrl: z.string().optional(),
})
export const releaseNotesVersionSchema = z.object({
  version: z.string(),
  notes: z.array(releaseNoteSchema),
})
export const deviceReleaseNotesSchema = z.object({
  deviceId: z.string(),
  /**
   * Langue des textes SERVIS (`fr`, `en`) : celle demandée (`?lang=`) quand le fabricant la publie,
   * sinon l'anglais. Absente = inconnue (le fabricant ne la dit pas).
   */
  lang: z.string().optional(),
  /** Version installée, d'après la dernière lecture des notes. */
  installedVersion: z.string().optional(),
  /** La mise à jour en attente et ce qu'elle apporte ; absente = rien en attente, ou notes pas encore lues. */
  pending: releaseNotesVersionSchema.optional(),
  /** Versions installées, de la plus récente à la plus ancienne (le plugin les garde au fil des mises à jour). */
  history: z.array(releaseNotesVersionSchema),
  /** Dernière lecture chez le fabricant (ms epoch) ; absente = jamais lues. */
  fetchedAt: z.number().optional(),
})
export type ReleaseNote = z.infer<typeof releaseNoteSchema>
export type ReleaseNotesVersion = z.infer<typeof releaseNotesVersionSchema>
export type DeviceReleaseNotes = z.infer<typeof deviceReleaseNotesSchema>
/** Langue de repli des notes de version : celle que tous les fabricants publient. */
export const RELEASE_NOTES_FALLBACK_LANG = 'en'
/** `fr-FR`, `FR`, `fr` → `fr` ; tout ce qui n'est pas une langue sur deux lettres → la langue de repli. */
export function releaseNotesLang(lang: string | undefined): string {
  const l = lang?.trim().slice(0, 2).toLowerCase()
  return l && /^[a-z]{2}$/.test(l) ? l : RELEASE_NOTES_FALLBACK_LANG
}
