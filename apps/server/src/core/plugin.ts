import type { Command, DeviceConsumption, DeviceDescriptor, DeviceEventKind, DeviceJournal, DeviceReleaseNotes, PluginHealth, PluginScene, SceneActivation, SceneRecall, SceneUpdate, SiteMap, StatePatch, WeatherForecast } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { Clock } from './clock'

// Contrat d'un plugin d'appareils. Un plugin ne connaît ni HTTP ni WebSocket : il découvre des
// descripteurs, pousse des patchs d'état via le contexte et exécute des commandes.

export const PLUGIN_ERROR_CODES = [
  'DEVICE_UNAVAILABLE', 'UNSUPPORTED_COMMAND', 'UPSTREAM_ERROR', 'RATE_LIMITED', 'NEEDS_PAIRING', 'TIMEOUT', 'NOT_IMPLEMENTED',
  // batterie trop faible pour ce que la commande demande (Tesla `low_soc` : pas de clim sous 20 %)
  'LOW_BATTERY',
] as const
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number]

export class PluginError extends Error {
  constructor(readonly code: PluginErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PluginError'
  }
}

export interface PluginContext {
  pluginId: string
  /** Sortie de `configSchema.parse(process.env)`. */
  config: Record<string, unknown>
  logger: Logger
  clock: Clock
  /** Annulé par stop() : à passer aux fetch/pollers. */
  signal: AbortSignal
  /** Patch d'état ; `available: true` est ajouté implicitement sauf mention contraire. */
  emitState(externalId: string, patch: StatePatch): void
  setAvailable(externalId: string | '*', available: boolean): void
  /** Remplace l'ensemble des appareils du plugin (découverte tardive, ajout/suppression). */
  emitDevices(descriptors: DeviceDescriptor[]): void
  /** Remplace l'ensemble des scènes du plugin. */
  emitScenes(scenes: PluginScene[]): void
  emitSceneState(externalId: string, active: SceneActivation): void
  /** Événement transitoire (sonnette, mouvement) : poussé aux clients, pas d'état conservé. */
  emitEvent(externalId: string, event: DeviceEventKind): void
  /** Sous-items retenus pour cette maison, par id de `DevicePlugin.parts` (défauts déjà appliqués). */
  parts: Record<string, boolean>
  /**
   * Où EST la maison (`house.origin`), pour ce qui dépend du lieu : la météo au-dessus du toit. Un
   * plugin ne va jamais chercher la maison lui-même, comme pour `parts` — c'est l'hôte qui lui donne
   * la seule source de vérité, celle dont la scène 3D tire déjà son soleil.
   */
  site: PluginSite
}

export interface PluginSite {
  lat: number
  lon: number
  /** Altitude (m), 0 si la maison ne la dit pas. */
  alt: number
}

/** Prévisions telles qu'un plugin les rend : l'hôte y ajoute le `deviceId` (voir `weatherForecastSchema`). */
export type PluginForecast = Omit<WeatherForecast, 'deviceId'>
/** Journal tel qu'un plugin le rend : l'hôte y ajoute le `deviceId` (voir `deviceJournalSchema`). */
export type PluginJournal = Omit<DeviceJournal, 'deviceId'>
/** Carte d'un terrain telle qu'un plugin la rend : l'hôte y ajoute le `deviceId` (voir `siteMapSchema`). */
export type PluginSiteMap = Omit<SiteMap, 'deviceId'>
/** Notes de version telles qu'un plugin les rend : l'hôte y ajoute le `deviceId` (voir `deviceReleaseNotesSchema`). */
export type PluginReleaseNotes = Omit<DeviceReleaseNotes, 'deviceId'>
/** Consommation telle qu'un plugin la rend : l'hôte y ajoute le `deviceId` (voir `deviceConsumptionSchema`). */
export type PluginConsumption = Omit<DeviceConsumption, 'deviceId'>

/**
 * Sous-item activable d'un plugin : une part de ce qu'il fournit, qu'on peut vouloir ou non sans
 * renoncer au reste (les kinds de la simulation). Déclaré en STATIQUE, sans config ni init : les
 * Réglages les affichent même quand le plugin est éteint. Le choix vit dans `house.json`.
 */
export interface PluginPart {
  /** Id stable, écrit dans `house.json` (`plugins.<id>.parts`). */
  readonly id: string
  /** Clé i18n du libellé côté web (`kinds.light`…) : le serveur ne connaît pas la langue. */
  readonly labelKey: string
  readonly enabledByDefault: boolean
}

export interface DevicePlugin {
  readonly id: string
  /** Sélectionne et valide ses propres clés d'environnement (ex. HUE_*). */
  readonly configSchema: z.ZodType<Record<string, unknown>>
  /** Squelette déclaré mais pas encore écrit : listé dans les Réglages, pas activable. */
  readonly implemented?: boolean
  /** Sous-items activables (voir `PluginPart`) ; aucun pour la plupart des plugins. */
  readonly parts?: readonly PluginPart[]
  init(ctx: PluginContext): Promise<void>
  discover(): Promise<DeviceDescriptor[]>
  start(): Promise<void>
  /** Résout à l'accusé de réception du fabricant ; lève PluginError sinon. */
  execute(externalId: string, command: Command): Promise<void>
  /** Rappelle une scène du fabricant (les scènes sont publiées par `ctx.emitScenes`). */
  recallScene?(externalId: string, recall: SceneRecall): Promise<void>
  /** Écrit une préférence de scène chez le fabricant (la nouvelle valeur revient par ses événements). */
  updateScene?(externalId: string, update: SceneUpdate): Promise<void>
  /** Crée une ambiance pour un groupe, en recopiant une ambiance existante (`externalId` source). */
  createScene?(fromExternalId: string, groupName: string): Promise<void>
  /** Supprime une ambiance CHEZ le fabricant (geste destructif, confirmé côté UI). */
  deleteScene?(externalId: string): Promise<void>
  /**
   * Prévisions d'un appareil `weather`, servies À LA DEMANDE (`GET /api/devices/:id/forecast`) et
   * jamais poussées — même arbitrage que l'historique énergie. Absent = ce plugin n'en a pas
   * (l'hôte répond `NOT_IMPLEMENTED`). Rendre la dernière réponse du sondage, pas refaire un appel.
   */
  forecast?(externalId: string): Promise<PluginForecast>
  /**
   * Journal d'un appareil qui déclare la capacité `journal`, servi À LA DEMANDE
   * (`GET /api/devices/:id/journal`). Même règle que les prévisions : rendre ce qu'on tient — une
   * lecture mise en cache, complétée par les événements du fabricant —, pas refaire un appel à
   * chaque affichage, surtout sur une API à quota.
   */
  journal?(externalId: string): Promise<PluginJournal>
  /**
   * Carte du terrain d'un appareil qui déclare la capacité `site_map`, servie À LA DEMANDE
   * (`GET /api/devices/:id/map`). Rendre la carte tenue en cache : elle ne change qu'avec un tracé
   * refait chez le fabricant, et chaque lecture coûte du quota.
   */
  siteMap?(externalId: string): Promise<PluginSiteMap>
  /**
   * Ce qu'un appareil a consommé, par pas de temps, servi À LA DEMANDE
   * (`GET /api/devices/:id/consumption`). Même règle que les prévisions et le journal : rendre un
   * historique tenu au fil des sondages, jamais refaire un relevé. Absent = ce plugin n'en tient pas
   * (l'hôte répond `NOT_IMPLEMENTED`).
   */
  consumption?(externalId: string): Promise<PluginConsumption>
  /**
   * Notes de version d'un véhicule qui déclare la capacité `release_notes`, servies À LA DEMANDE
   * (`GET /api/devices/:id/release-notes`). Rendre le cache tenu par le plugin, jamais refaire un
   * appel : les notes ne changent qu'avec une version. `lang` : la langue voulue (deux lettres) ;
   * le plugin rend l'anglais tant qu'il ne l'a pas, et dit dans `lang` ce qu'il sert.
   */
  releaseNotes?(externalId: string, lang: string): Promise<PluginReleaseNotes>
  stop(): Promise<void>
  /** Routes propres au plugin, montées sous /api/plugins/<id>/. */
  registerRoutes?(app: FastifyInstance): void
  health?(): PluginHealth
  /**
   * La santé des comptes d'un utilisateur connecté, pour un plugin qui en tient par utilisateur
   * (sources musicales) ; absent = la même pour tous, `health()`.
   */
  healthFor?(user: string): Promise<PluginHealth>
}

export type PluginFactory = () => DevicePlugin
