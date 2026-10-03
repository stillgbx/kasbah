import type { HouseEditPatch, AutomationBody, GardenItemPatch, NewGardenItem, AutomationEntry, AutomationRun, Relief, SceneTuning, Vec2, CommandInput, DeviceConsumption, DeviceEntry, DevicePlacement, EnergyHistory, HealthResponse, House, NewOpening, NewParking, OpeningPatch, PanelArrayPatch, ParkingPatch, PluginInfo, PluginSceneEntry, PluginSettingsPatch, SceneRecallInput, SceneUpdate, ServerMessage, WeatherForecast, DeviceJournal, DeviceReleaseNotes, StateFor } from '@kasbah/shared'

// Abstraction du canal serveur. Deux implémentations : HTTP + WebSocket (réel) et simulation
// in-process (tests, démo statique sans serveur). Les commandes passent TOUJOURS par une requête
// (codes d'erreur, timeout, fonctionne pendant une reconnexion) ; le WS ne fait que pousser.

export type ConnectionStatus = 'connecting' | 'online' | 'stale' | 'offline'

export interface TransportHandlers {
  onMessage(msg: ServerMessage): void
  onStatus(status: ConnectionStatus): void
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

/** Un lieu où lire la météo hors de la maison (recherche et favoris de la vue Météo). */
export interface WeatherPlace {
  /** Identifiant GeoNames : deux homonymes restent deux favoris. */
  id: string
  name: string
  /** Région et pays, pour départager deux homonymes (« Bourgogne, France »). */
  region?: string
  countryCode?: string
  lat: number
  lon: number
}
/** La météo d'un lieu quelconque, au format de l'appareil de la maison. */
export interface WeatherElsewhere {
  state: StateFor<'weather'>
  forecast: Omit<WeatherForecast, 'deviceId'>
  /** Fuseau IANA du lieu : ses heures s'y affichent. */
  timezone?: string
  attribution: string
}
/** Une vigilance Météo-France (au moins jaune), en cours ou à venir. */
export interface WeatherAlert {
  /** Phénomène : `thunderstorm`, `wind`, `rain_flood`… ; `other` pour un inconnu. */
  type: string
  level: 'yellow' | 'orange' | 'red'
  onset: number
  expires: number
}
/** La vigilance du département d'un lieu ; `area: null` hors de la métropole (rien à lire). */
export interface WeatherAlerts {
  area: string | null
  /** En cours d'abord, la plus forte en tête. Vide = vert. */
  warnings: WeatherAlert[]
  attribution: string
  web: string
}

/**
 * Appairage de la passerelle Enphase, tel que l'UI le voit. Le jeton n'y figure jamais : seul le
 * serveur le détient, et `tokenFile` dit où il le garde — `null` si rien n'est gardé, et l'UI
 * prévient alors que l'appairage ne survivra pas à un redémarrage.
 */
export interface EnphaseTokenStatus {
  paired: boolean
  host: string
  serial?: string
  software?: string
  stage: 'ok' | 'expiring' | 'expired' | 'none'
  daysLeft?: number
  expiresAt?: number
  role?: string
  username?: string
  source?: 'config' | 'cache' | 'minted'
  renewUnderDays: number
  tokenFile: string | null
  /** Session Enlighten : indispensable à la borne, distincte du jeton local de la passerelle. */
  cloudLinked: boolean
  cloudFile: string | null
  siteId?: string
}

export type EnphasePairing = { token: string } | { user: string; password: string; force?: boolean }

/**
 * Mise en route du plugin Tesla, telle que l'UI la voit. Ni secret ni clé privée : la clé PUBLIQUE
 * y est, parce que c'est l'utilisateur qui doit la poser sur son domaine.
 */
export interface TeslaStatus {
  configured: boolean
  domain: string | null
  region: 'eu' | 'na'
  redirectUri: string
  publicKeyPem: string | null
  publicKeyUrl: string | null
  registered?: boolean
  linked: boolean
  vehicles: { vin: string; name: string; sleepState: 'online' | 'asleep' | 'offline' }[]
  budget: { used: number; limit: number }
  pollMs: number
  restMs: number
  tokenFile: string | null
  lastError: string | null
}

/**
 * Mise en route du plugin Renault, telle que l'UI la voit. Le mot de passe n'y figure JAMAIS : il
 * ne fait que traverser `renaultLogin`, et ce qui en reste côté serveur est un jeton de session.
 */
export interface RenaultStatus {
  linked: boolean
  country: string
  accountId: string | null
  accounts: { accountId: string; accountType: string | null }[]
  vehicles: { vin: string; name: string }[]
  pollMs: number
  ratePerHour: number
  rateWaitS: number
  sessionFile: string | null
  lastError: string | null
  /**
   * Ce qu'est devenu le dernier réveil de charge. Sans lui, un réveil refusé ne se voit nulle part
   * sauf dans la console du serveur — c'est ce qui a laissé passer une journée entière de surplus
   * solaire le 2026-09-19. `null` : aucun réveil tenté depuis le démarrage.
   */
  lastWake: { at: number; result: 'sent' | 'deferred' | 'failed'; detail: string | null } | null
}

/**
 * Mise en route du plugin MELCloud, telle que l'UI la voit. Même règle que Renault : le mot de
 * passe n'y figure JAMAIS, il ne fait que traverser `melcloudLogin` et ce qui en reste côté serveur
 * est une clé de session.
 *
 * `devices` sont les MACHINES vues sur le compte ; `zoneCount` compte ce que la maison reçoit, une
 * zone de chauffage par appareil. Les deux nombres diffèrent, et c'est normal : une machine porte
 * une ou deux zones, et plusieurs pompes à chaleur en cascade n'apparaissent que comme une seule
 * machine (l'installation de référence : trois Zubadan, un appareil, deux zones).
 */
/**
 * État de la liaison PetKit. Pas de mot de passe dans cette interface, et ce n'est pas un oubli :
 * le fabricant connecte par CODE envoyé par courriel. `expiresAt` est donc une information utile à
 * l'écran — une session perdue ne se reprend pas toute seule, il faudra un nouveau code.
 */
export interface PetkitStatus {
  linked: boolean
  account: string | null
  gateway: string
  expiresAt: number | null
  devices: { externalId: string; name: string; type: string; kind: string }[]
  pollMs: number
  lastError: string | null
}

export interface MelcloudStatus {
  linked: boolean
  accountName: string | null
  devices: { deviceId: string; name: string; family: string | null; buildingName: string | null }[]
  /** Appareils publiés à la maison : une ZONE de chauffage chacun, jamais une machine. */
  zoneCount: number
  pollMs: number
  sessionFile: string | null
  lastError: string | null
}

/**
 * Mise en route du plugin iRobot, telle que l'UI la voit. Aucun mot de passe n'y figure : ni celui
 * du compte (il ne fait que traverser `irobotLogin`), ni celui, local, de chaque robot.
 *
 * `ip` et `connected` disent ce que le compte ne sait pas : où le robot est sur le réseau, et si le
 * lien MQTT est ouvert. Un robot du compte éteint reste listé, sans adresse et non connecté.
 */
export interface IrobotStatus {
  linked: boolean
  linkedAt: number | null
  robots: { blid: string; name: string | null; sku: string | null; ip: string | null; connected: boolean }[]
  sessionFile: string | null
  lastError: string | null
}

/**
 * Mise en route YouTube Music (non officiel). Le cookie n'y figure jamais — il ne fait que
 * traverser `ytmusicPutCookie`.
 */
export interface YtmusicStatus {
  linked: boolean
  cookieExpired: boolean
  poTokenOk: boolean
  unofficial: true
  cookieFile: string | null
  poTokenUrl: string
  lastError: string | null
  browsers: string[]
}

/** Un agenda de la maison (plugin `agenda`) ; son adresse iCal reste sur le serveur. */
export interface AgendaCalendar { id: string; name: string; color: string; fetchedAt: number | null; error: string | null }
/**
 * Une occurrence d'événement. Journée entière : dates locales `YYYY-MM-DD`, fin exclue ; sinon des
 * instants en ms.
 */
export type AgendaEvent = { id: string; calendarId: string; title: string; location?: string; description?: string }
  & ({ allDay: true; start: string; end: string } | { allDay: false; start: number; end: number })
/** Un mix Mixcloud (plugin `mixcloud`) ; `key` (`/user/slug/`) est son id pour le lecteur commun. */
export interface MixcloudMix {
  key: string
  name: string
  user: { username: string; name: string }
  artUrl: string | null
  durationS: number | null
  createdAt: string | null
  tags: string[]
  /** Les genres du mix (tags `/genres/<slug>/` de Mixcloud), dans l'ordre des tags. */
  genres: { slug: string; name: string }[]
  /** Position retenue par le serveur (s), si ce mix a été écouté en partie d'ici. */
  resumeS?: number
}
export interface MixcloudUser { username: string; name: string; artUrl: string | null }
export interface MixcloudStatus { username: string | null; user: MixcloudUser | null; lastError: string | null }
export type MixcloudList = 'feed' | 'favorites' | 'listens' | 'uploads'
/** Une rangée de l'accueil Mixcloud, recomposé par le serveur à partir des écoutes publiques du compte. */
export type MixcloudHomeSection =
  | { kind: 'users'; id: 'topCreators'; users: MixcloudUser[] }
  | { kind: 'mixes'; id: 'following' | 'listenAgain'; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'moreFrom'; user: MixcloudUser; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'popular'; genre: { slug: string; name: string }; items: MixcloudMix[] }
export interface MixcloudPage { items: MixcloudMix[]; next: string | null }

/** Une webradio de l'annuaire radio-browser (plugin `radio`). */
export interface RadioStation {
  id: string
  name: string
  url: string
  favicon?: string
  country?: string
  countryCode?: string
  tags: string[]
  codec?: string
  bitrateKbps?: number
}

export interface YtmusicTrack {
  videoId: string
  title: string
  artists: string[]
  artUrl: string | null
  durationS: number | null
  album?: string | null
  year?: string | null
  explicit?: boolean
}

export interface YtmusicPlaylist {
  id: string
  title: string
  artUrl: string | null
  trackCount: number | null
}

export interface YtmusicArtist {
  id: string
  name: string
  artUrl: string | null
  subscribers?: string | null
}

export interface YtmusicAlbum {
  id: string
  title: string
  artUrl: string | null
  artists: string[]
  year?: string | null
  /** Déduit du sous-titre InnerTube — pas un champ API dédié. */
  releaseType?: 'album' | 'single' | 'ep' | 'compilation' | null
  explicit?: boolean
}

/** Un lecteur en train de jouer un flux du proxy Kasbah (`GET /sessions`). */
/** Ce que le proxy sert à l'enceinte, et ce qu'il a reçu de YouTube pour le produire. */
export interface MusicStreamQuality {
  mime: string
  /** null quand on relaie le flux source sans le connaître (débit variable). */
  bitrateKbps: number | null
  /** null quand le proxy ne réencode pas : c'est la source qui décide, on ne l'inspecte pas. */
  sampleRateHz: number | null
  channels: number | null
  /** Taille annoncée à l'enceinte ; null si la durée est inconnue (flux sans taille). */
  lengthBytes: number | null
  source: { ext: string | null; formatId: string | null; abrKbps: number | null } | null
}

export interface MusicSession {
  deviceId: string
  /** La source de la piste (`ytmusic`, `mixcloud`…) et son id chez elle. */
  source: string
  id: string
  sid: string
  /** Durée du titre (yt-dlp ou catalogue) ; le lecteur la connaît aussi par la taille du « fichier ». */
  durationS: number | null
  /** Ce que le catalogue disait du titre : l'UI le préfère à ce que l'enceinte publie (parfois l'URL du flux). */
  title: string | null
  artist: string | null
  artUrl: string | null
  /** Absent d'un serveur plus ancien que l'affichage de la qualité. */
  quality?: MusicStreamQuality | null
  /** La file de ce lecteur (précédent / suivant, répétition) ; null ou absent sans file. */
  queue?: { length: number; index: number; repeat: MusicRepeat } | null
}

/** La dernière écoute d'un lecteur qui ne joue plus rien de nous (serveur redémarré, arrêt) : de quoi la reprendre. */
export interface MusicLastPlayed {
  deviceId: string
  track: MusicTrack
  /** Position atteinte (s). */
  positionS: number
  durationS: number | null
  queue: { length: number; index: number; repeat: MusicRepeat }
  at: number
}

/** Un genre ou une ambiance : son nom (dans la langue demandée), sa couleur, et de quoi ouvrir sa page. */
export interface YtmusicExploreCategory {
  title: string
  params: string
  /** `#rrggbb`, la pastille chez YouTube Music. */
  color: string | null
}
/** « Pour vous » (personnalisé, parfois vide), « Humeurs et moments », « Genres » — titres localisés par YouTube. */
export interface YtmusicExplore {
  forYou: { title: string; categories: YtmusicExploreCategory[] }
  moods: { title: string; categories: YtmusicExploreCategory[] }
  genres: { title: string; categories: YtmusicExploreCategory[] }
}
/** Une rangée de la page d'une catégorie : titres, playlists officielles, albums. */
export interface YtmusicExploreShelf {
  title: string
  tracks: YtmusicTrack[]
  playlists: YtmusicPlaylist[]
  albums: YtmusicAlbum[]
}

/** Répétition du TITRE en cours : `once` le rejoue une fois puis la file reprend, `loop` sans fin. */
export type MusicRepeat = 'off' | 'once' | 'loop'

/** Une piste telle que la file la garde (ce que `/api/music/play` accepte) : sa source et son id chez elle. */
export interface MusicTrack {
  source: string
  id: string
  title?: string
  artist?: string
  artUrl?: string
  durationS?: number
  explicit?: boolean
  /** Partir de là (s) : la reprise d'un mix long. */
  startS?: number
}

/** La file d'un lecteur : `items[index]` joue. */
export interface MusicQueue {
  items: MusicTrack[]
  index: number
  repeat: MusicRepeat
}

export interface YtmusicSearchResult {
  artists: YtmusicArtist[]
  albums: YtmusicAlbum[]
  singles: YtmusicAlbum[]
  compilations: YtmusicAlbum[]
  tracks: YtmusicTrack[]
}

/**
 * L'état d'une MACHINE de chauffage, servi par son plugin et non par le registre d'appareils : ce
 * sont une douzaine de mesures qu'on ne consulte que sur la page Chauffage, et qui n'avaient pas à
 * devenir autant de capteurs dans la maison et dans la scène 3D.
 */
export interface MelcloudUnit {
  deviceId: string
  name: string
  power: boolean
  /** Ce que le fabricant prétend — il se dit hors ligne en parlant. Gardé pour le diagnostic seul. */
  offline: boolean
  /** La dernière remontée est-elle trop vieille ? C'est CE champ qui dit « injoignable ». */
  stale: boolean
  outdoorTempC: number | null
  flowTempC: number | null
  returnTempC: number | null
  condensingTempC: number | null
  demandPercent: number | null
  defrosting: boolean
  boosterHeater: boolean
  immersionHeater: boolean
  pumps: boolean[]
  valve3Way: boolean
  /** `code` vaut 8000 quand tout va bien : c'est `hasError` qui tranche, jamais le code. */
  error: { hasError: boolean; code: number | null; message: string | null }
  /** Ms epoch : le serveur a déjà ramené les deux bases de temps du fabricant au même instant. */
  lastSeen: number | null
  wifi: string | null
  /** Faux = la machine n'a pas de compteur : la page omet la consommation au lieu d'afficher des zéros. */
  energyMeter: boolean
}

/**
 * Une heure d'historique de fonctionnement. Les compteurs sont des NOMBRES D'ÉCHANTILLONS, pas des
 * minutes : `n` donne l'échelle, et une heure mal sondée se lit pour ce qu'elle est au lieu de
 * passer pour une heure sans chauffage.
 */
export interface HeatingPoint {
  t: number
  n: number
  heating: number
  defrost: number
  booster: number
  outdoorC: number | null
  flowC: number | null
  returnC: number | null
}

/** Maximum de luminosité d'un pas (heure pleine, jour ou mois local), en lux. */
export interface LightPoint { t: number; maxLux: number }
/** Historique de luminosité d'un volet solaire, tenu par le serveur au fil des trames de la box. */
export interface LightHistory { hourly: LightPoint[]; daily: LightPoint[]; monthly: LightPoint[] }

export interface Transport {
  getHouse(): Promise<House>
  getDevices(): Promise<DeviceEntry[]>
  getHealth(): Promise<HealthResponse>
  getHistory(deviceId: string, hours?: number): Promise<EnergyHistory>
  /** Prévisions d'un appareil `weather`, à la demande (le serveur rend la dernière lecture de son plugin). */
  getForecast(deviceId: string): Promise<WeatherForecast>
  /** Lieux dont le nom répond à la recherche (géocodage Open-Meteo), noms dans la langue donnée. */
  searchPlaces(query: string, lang: string): Promise<WeatherPlace[]>
  /** Météo actuelle et prévisions d'une autre position que la maison. */
  getWeatherAt(lat: number, lon: number): Promise<WeatherElsewhere>
  /** Vigilance météo d'une position (Météo-France par MeteoAlarm, métropole seule). */
  getWeatherAlerts(lat: number, lon: number): Promise<WeatherAlerts>
  /** Journal d'un appareil qui déclare la capacité `journal` (erreurs, avertissements consignés), du plus récent au plus ancien. */
  getJournal(deviceId: string): Promise<DeviceJournal>
  /**
   * Notes de version d'un véhicule qui déclare `release_notes`, dans `lang` si le fabricant la publie,
   * sinon en anglais (`lang` de la réponse) : le serveur rend le cache de son plugin, sans appel au fabricant.
   */
  getReleaseNotes(deviceId: string, lang: string): Promise<DeviceReleaseNotes>
  /** Historique de consommation (litres par pas, jamais un cumul) d'un appareil `water`, en trois séries : heure, jour, mois. */
  getConsumption(deviceId: string): Promise<DeviceConsumption>
  sendCommand(deviceId: string, command: CommandInput): Promise<void>
  getScenes(): Promise<PluginSceneEntry[]>
  /** Rappelle une scène du fabricant (fixe ou palette animée). */
  recallScene(sceneId: string, recall: SceneRecallInput): Promise<void>
  /** Écrit une préférence de scène chez le fabricant (source de vérité unique). */
  updateScene(sceneId: string, update: SceneUpdate): Promise<void>
  /** Crée une ambiance pour un groupe, en recopiant une ambiance présente ailleurs. */
  createScene(fromSceneId: string, groupName: string): Promise<void>
  /** Supprime une ambiance chez le fabricant (destructif). */
  deleteScene(sceneId: string): Promise<void>
  /** Automatisations de la maison et leur statut (le WebSocket pousse ensuite chaque changement). */
  getAutomations(): Promise<AutomationEntry[]>
  /** Crée ou remplace une automatisation ; rend son statut recalculé par le serveur. */
  putAutomation(id: string, body: AutomationBody): Promise<AutomationEntry>
  setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationEntry>
  deleteAutomation(id: string): Promise<void>
  /** Exécute les actions tout de suite (ni déclencheur ni « sauf si ») ; rend le compte rendu. */
  runAutomation(id: string): Promise<AutomationRun>
  /** Inventaire des plugins : tous ceux que le serveur connaît, actifs ou non. */
  getPlugins(): Promise<PluginInfo[]>
  /** Écrit un choix (activation, sous-item, ambiances) dans la maison ; rend l'inventaire à jour. */
  setPluginSettings(pluginId: string, patch: PluginSettingsPatch): Promise<PluginInfo[]>
  pairHue(): Promise<{ appKey: string; hint: string }>
  /** URL de consentement Google à ouvrir dans un navigateur pour lier le compte Nest. */
  nestAuthUrl(): Promise<{ url: string; redirectUri: string }>
  /** État de l'appairage de la passerelle Enphase. Ne porte jamais le jeton lui-même. */
  enphaseTokenStatus(): Promise<EnphaseTokenStatus>
  /**
   * Appaire la passerelle Enphase : un jeton déjà obtenu, ou les identifiants du compte qui servent
   * une fois à en frapper un et ne sont pas conservés. `force` remplace un jeton encore valable.
   */
  pairEnphase(body: EnphasePairing): Promise<EnphaseTokenStatus>
  /** Où en est la mise en route Tesla (clé publique à poser, domaine enregistré, compte lié). */
  teslaStatus(): Promise<TeslaStatus>
  /** Enregistre le domaine auprès de Tesla, une fois la clé publique posée dessus. */
  teslaRegister(): Promise<TeslaStatus>
  /** URL de consentement Tesla à ouvrir dans un navigateur pour lier le compte. */
  teslaAuthUrl(): Promise<{ url: string; redirectUri: string }>
  /** Nouvelle paire de clés (l'ancienne clé publique cesse de valoir : à reposer sur le domaine). */
  teslaRotateKey(): Promise<TeslaStatus>
  /** Où en est la liaison du compte MY Renault (compte Kamereon retenu, véhicules). */
  renaultStatus(): Promise<RenaultStatus>
  /**
   * Relie le compte MY Renault. Gigya n'offre pas d'OAuth : le mot de passe traverse le serveur une
   * fois et n'y est ni gardé ni journalisé — seul le jeton de session Gigya survit.
   */
  renaultLogin(body: { email: string; password: string }): Promise<RenaultStatus>
  /** Délie le compte : le jeton de session est effacé. */
  renaultLogout(): Promise<RenaultStatus>
  /** Où en est la liaison du compte MELCloud (machines vues sur le compte). */
  melcloudStatus(): Promise<MelcloudStatus>
  /**
   * Relie le compte MELCloud. Le fabricant n'offre pas d'OAuth : le mot de passe traverse le
   * serveur une fois et n'y est ni gardé ni journalisé — seule la clé de session survit.
   */
  melcloudLogin(body: { email: string; password: string }): Promise<MelcloudStatus>
  /** Délie le compte : la clé de session est effacée. */
  melcloudLogout(): Promise<MelcloudStatus>
  /** Où en est la liaison du compte PetKit. */
  petkitStatus(): Promise<PetkitStatus>
  /** Étape 1 : demander à PetKit d'envoyer un code à cette adresse. Il vaut dix minutes. */
  petkitRequestCode(body: { email: string }): Promise<{ sent: boolean }>
  /** Étape 2 : échanger le code contre une session. Aucun mot de passe n'entre jamais ici. */
  petkitLogin(body: { email: string; code: string }): Promise<PetkitStatus>
  /** Délie le compte : le jeton de session est effacé. */
  petkitLogout(): Promise<PetkitStatus>
  /** L'état des machines de chauffage (dernière lecture du sondage, jamais un nouvel appel au fabricant). */
  melcloudSystem(): Promise<{ units: MelcloudUnit[]; pollMs: number }>
  /** L'historique de fonctionnement, construit par le serveur au fil des sondages. */
  melcloudHistory(): Promise<{ hourly: HeatingPoint[]; pollMs: number }>
  /** Historique de luminosité d'un capteur de volet solaire (TaHoma seulement). */
  lightHistory(deviceId: string): Promise<LightHistory>
  /** Où en est la liaison du compte iRobot (robots connus, et lesquels répondent sur le réseau). */
  irobotStatus(): Promise<IrobotStatus>
  /**
   * Relie le compte iRobot. Le mot de passe traverse le serveur une fois : il en ressort le mot de
   * passe LOCAL de chaque robot, et plus rien ne sort ensuite du réseau de la maison.
   */
  irobotLogin(body: { email: string; password: string }): Promise<IrobotStatus>
  /** Délie le compte : les mots de passe locaux sont effacés et les liens fermés. */
  irobotLogout(): Promise<IrobotStatus>
  /** Où en est la liaison YouTube Music (cookie présent, PO Token joignable). */
  ytmusicStatus(): Promise<YtmusicStatus>
  /** Colle le cookie du compte (corps JSON). Jamais journalisé. */
  ytmusicPutCookie(cookie: string): Promise<YtmusicStatus>
  /**
   * Importe les cookies YouTube via `yt-dlp --cookies-from-browser` sur la machine serveur
   * (navigateur déjà connecté à music.youtube.com sur cet hôte).
   */
  ytmusicImportCookieFromBrowser(browser: string): Promise<YtmusicStatus>
  /** Efface le cookie. */
  ytmusicClearCookie(): Promise<YtmusicStatus>
  ytmusicSearch(q: string): Promise<YtmusicSearchResult>
  ytmusicLiked(): Promise<{ tracks: YtmusicTrack[] }>
  ytmusicPlaylists(): Promise<{ playlists: YtmusicPlaylist[] }>
  ytmusicPlaylist(id: string): Promise<{ tracks: YtmusicTrack[] }>
  /** Titres d'un album, et son texte de présentation s'il en a un (dans la langue `hl`). */
  ytmusicAlbum(id: string, hl?: string): Promise<{ tracks: YtmusicTrack[]; description?: string | null }>
  /** Titres d'un artiste, et son texte de présentation s'il en a un (dans la langue `hl`). */
  ytmusicArtist(id: string, hl?: string): Promise<{ tracks: YtmusicTrack[]; description?: string | null }>
  /** Humeurs et genres ; `hl` = langue de l'app (les noms viennent de YouTube). */
  ytmusicExplore(hl?: string): Promise<YtmusicExplore>
  /** La page d'une catégorie, en rangées. */
  ytmusicExploreCategory(params: string, hl?: string): Promise<{ shelves: YtmusicExploreShelf[] }>
  /** Les nouveautés de YouTube Music (playlists phares, albums et singles récents), en rangées. */
  ytmusicExploreNew(hl?: string): Promise<{ shelves: YtmusicExploreShelf[] }>
  /** Deux pochettes par catégorie (clé = `params`), prises dans sa page : lent la première fois (~10 s), gardé 6 h. */
  ytmusicExploreCovers(hl?: string): Promise<{ covers: Record<string, string[]> }>
  /** Résout le flux et envoie `play_url` au lecteur (métadonnées optionnelles pour titre / pochette). */
  musicPlay(body: {
    source: string
    id: string
    deviceId: string
    title?: string
    artist?: string
    artUrl?: string
    durationS?: number
    /** Ce que dit le catalogue : l'enceinte ne le saura jamais, l'état le portera pour l'UI. */
    explicit?: boolean
  }): Promise<{ ok: true; streamUrl: string; sid: string }>
  /** Lecteurs qui jouent en ce moment un flux YouTube Music servi par Kasbah. */
  musicSessions(): Promise<{ sessions: MusicSession[] }>
  /** La dernière écoute des lecteurs qui ne jouent rien de nous en ce moment. */
  musicLast(): Promise<{ last: MusicLastPlayed[] }>
  /** Relancer la dernière écoute d'un lecteur (sa file comprise), à sa position ou à `positionS`. */
  musicResume(deviceId: string, positionS?: number): Promise<{ ok: true; streamUrl: string; sid: string; queue: MusicQueue }>
  /** Le titre en cours sur `fromDeviceId` repart sur `toDeviceId`, qui se place à la même position ; la source s'arrête. */
  musicTransfer(body: {
    fromDeviceId: string
    toDeviceId: string
    /** Source = ce navigateur : sa position et sa file, que le serveur reprend. */
    positionS?: number
    queue?: { tracks: MusicTrack[]; index: number; repeat: MusicRepeat }
  }): Promise<{
    ok: true; streamUrl: string; sid: string; positionS: number
    /** Cible = ce navigateur : la session à lire, et la file qu'il reprend (null sans file). */
    session?: MusicSession
    queue?: MusicQueue | null
  }>
  /** Lecture dans CE navigateur : le serveur résout le titre et rend le chemin du « fichier » à lire. */
  musicLocalPlay(body: MusicTrack & { clientId: string; next?: { source: string; id: string } }): Promise<{ ok: true; streamUrl: string; session: MusicSession }>
  /** Nouvelle file sur ce lecteur (l'ancienne est remplacée) : `tracks[startIndex]` joue, la suite enchaîne. */
  musicQueuePlay(body: { deviceId: string; tracks: MusicTrack[]; startIndex?: number }): Promise<{ ok: true; streamUrl: string; sid: string; queue: MusicQueue }>
  musicQueue(deviceId: string): Promise<MusicQueue>
  /** Ajouter sans interrompre ; rien ne joue sur ce lecteur ? Les titres partent tout de suite (`started`). */
  musicQueueAdd(body: { deviceId: string; tracks: MusicTrack[]; where: 'next' | 'end' }): Promise<{ ok: true; started: boolean; queue: MusicQueue }>
  musicQueueNext(deviceId: string): Promise<MusicQueue>
  /** Au début du titre s'il joue depuis quelques secondes, sinon le titre d'avant. */
  musicQueuePrevious(deviceId: string): Promise<MusicQueue>
  musicQueueJump(deviceId: string, index: number): Promise<MusicQueue>
  musicQueueRepeat(deviceId: string, mode: MusicRepeat): Promise<MusicQueue>
  musicQueueRemove(deviceId: string, index: number): Promise<MusicQueue>
  /** Position atteinte dans une piste lue par CE navigateur (la reprise d'un mix) ; jamais bloquant. */
  musicProgress(body: { source: string; id: string; positionS: number; durationS?: number; ended?: boolean }): Promise<void>
  /** Vider la file : le titre en cours continue, seul. */
  musicQueueClear(deviceId: string): Promise<MusicQueue>
  /** Les agendas de la maison (plugin `agenda`, adresses iCal secrètes). */
  agendaCalendars(): Promise<{ calendars: AgendaCalendar[] }>
  /** Ajout par l'adresse iCal : le serveur la lit tout de suite et refuse ce qui n'est pas un agenda. */
  agendaAddCalendar(body: { url: string; name?: string; color?: string }): Promise<{ calendars: AgendaCalendar[] }>
  agendaUpdateCalendar(id: string, patch: { name?: string; color?: string }): Promise<{ calendars: AgendaCalendar[] }>
  agendaRemoveCalendar(id: string): Promise<{ calendars: AgendaCalendar[] }>
  /** Nouvel ordre : TOUS les identifiants, chacun une fois. */
  agendaReorderCalendars(ids: string[]): Promise<{ calendars: AgendaCalendar[] }>
  /** Occurrences de tous les agendas sur `[from, to[` (ms, 62 jours au plus). */
  agendaEvents(from: number, to: number): Promise<{ events: AgendaEvent[] }>
  /** Le compte Mixcloud relié (un nom d'utilisateur : l'API publique ne demande rien d'autre). */
  mixcloudStatus(): Promise<MixcloudStatus>
  mixcloudSetAccount(username: string): Promise<MixcloudStatus>
  mixcloudClearAccount(): Promise<MixcloudStatus>
  /** Une liste du compte ; `next` = curseur rendu par la page précédente. `feed` = nouveautés des suivis. */
  mixcloudList(list: MixcloudList, next?: string): Promise<MixcloudPage>
  /** L'accueil : tes créateurs, tes suivis, réécouter, plus de tes créateurs, les populaires de tes genres. */
  mixcloudHome(): Promise<{ sections: MixcloudHomeSection[] }>
  mixcloudPlaylists(): Promise<{ playlists: { key: string; name: string }[] }>
  mixcloudPlaylist(key: string, next?: string): Promise<MixcloudPage>
  mixcloudFollowing(): Promise<{ users: MixcloudUser[] }>
  mixcloudUserMixes(username: string, next?: string): Promise<MixcloudPage>
  mixcloudSearch(q: string, next?: string): Promise<MixcloudPage>
  /** Repartir du début : oublier la position retenue d'un mix. */
  mixcloudForgetResume(key: string): Promise<void>
  /** Radios de l'annuaire dont le nom contient `q`, les plus écoutées d'abord. */
  radioSearch(q: string): Promise<{ stations: RadioStation[] }>
  /** Les plus écoutées d'un pays (défaut du serveur : `RADIO_COUNTRY`). */
  radioTop(country?: string): Promise<{ stations: RadioStation[] }>
  /** Les favorites de la maison, gardées par le serveur. */
  radioFavorites(): Promise<{ stations: RadioStation[] }>
  radioAddFavorite(station: RadioStation): Promise<{ stations: RadioStation[] }>
  radioRemoveFavorite(id: string): Promise<{ stations: RadioStation[] }>
  /** Ajoute aux favorites une radio que l'annuaire ne connaît pas (ou sous une adresse morte), par son flux. */
  radioAddCustom(body: { name: string; url: string }): Promise<{ stations: RadioStation[] }>
  /** Lance la radio en direct sur un lecteur (`play_url` marqué `live`). */
  radioPlay(body: { deviceId: string; stationId: string }): Promise<{ ok: true; station: RadioStation }>
  /** La dernière station lancée sur chaque lecteur (sa qualité : l'enceinte ne la dit pas). */
  radioPlaying(): Promise<{ playing: { deviceId: string; station: RadioStation }[] }>
  /**
   * Fait oublier un appareil au plugin qui le retenait (`meta.forgettable`), par convention
   * `DELETE /api/plugins/<plugin>/devices/<externalId>` : il quitte l'inventaire jusqu'à ce qu'il
   * se réannonce. Sert aux appareils découverts sur le réseau et disparus pour de bon.
   */
  forgetDevice(deviceId: string): Promise<void>
  /**
   * URL WebSocket du flux vidéo d'une caméra (`live_stream`), par convention
   * `/api/plugins/<plugin>/cameras/<externalId>/stream` ; `null` si ce transport n'en sert pas.
   */
  cameraStreamUrl(deviceId: string): string | null
  /**
   * Vignettes des caméras d'un plugin (`externalId` → date), et `watch` pour signaler qu'on regarde
   * la vue Caméras : c'est ce qui fait tenir les sessions de vignettes côté serveur.
   */
  cameraSnapshots(pluginId: string, watch: boolean): Promise<Record<string, { at?: number; live: boolean; inactive?: boolean; paused?: boolean }>>
  /** Arrête (`false`) ou reprend (`true`) la vignette d'une caméra sur la vue Caméras. */
  setCameraSnapshots(deviceId: string, enabled: boolean): Promise<void>
  /** URL de la vignette JPEG d'une caméra ; `at` sert à contourner le cache du navigateur. */
  cameraSnapshotUrl(deviceId: string, at: number): string | null
  /** (Re)place un appareil dans house.json ; renvoie la maison réécrite. */
  placeDevice(id: string, placement: DevicePlacement): Promise<House>
  /** Retire un appareil de house.json (il redevient non placé ou auto-placé) ; renvoie la maison réécrite. */
  removeDevice(id: string): Promise<House>
  /** Crée ou règle un champ de panneaux (`house.arrays`) ; renvoie la maison réécrite. */
  saveArray(id: string, patch: PanelArrayPatch): Promise<House>
  /** Retire un champ de panneaux : ses modules disparaissent, ses onduleurs redeviennent à placer. */
  removeArray(id: string): Promise<House>
  /** Règle une ouverture (cotes, place sur le mur) ; renvoie la maison réécrite. */
  saveOpening(roomId: string, openingId: string, patch: OpeningPatch): Promise<House>
  /** Ajoute une ouverture à une pièce (nature, mur et cotes décidés par l'UI) ; renvoie la maison réécrite. */
  addOpening(roomId: string, opening: NewOpening): Promise<House>
  /** Retire une ouverture ; l'ouvrant qui l'habillait est libéré. Renvoie la maison réécrite. */
  removeOpening(roomId: string, openingId: string): Promise<House>
  /** Ajoute une place de stationnement (ce qui s'y range, où, dans quel sens) ; renvoie la maison réécrite. */
  addParking(parking: NewParking): Promise<House>
  /** Règle une place (cotes, centre, cap) ; renvoie la maison réécrite. */
  saveParking(id: string, patch: ParkingPatch): Promise<House>
  /** Retire une place : l'engin qui s'y rangeait retourne à son point GPS. Renvoie la maison réécrite. */
  removeParking(id: string): Promise<House>
  /** Ajoute un élément au jardin (arbre, buisson, pierre) ; renvoie la maison réécrite. */
  addGardenItem(item: NewGardenItem): Promise<House>
  /** Règle un élément du jardin (famille, pied, hauteur, cap, forme) ; renvoie la maison réécrite. */
  saveGardenItem(id: string, patch: GardenItemPatch): Promise<House>
  /** Retire un élément du jardin ; renvoie la maison réécrite. */
  removeGardenItem(id: string): Promise<House>
  /** Écrit l'ordre d'affichage des pièces d'un niveau ; renvoie la maison réécrite. */
  setRoomOrder(levelId: string, roomIds: string[]): Promise<House>
  /** Enregistre le réglage de lumière de la scène 3D dans la maison ; renvoie la maison réécrite. */
  saveRenderTuning(tuning: SceneTuning): Promise<House>
  /** Enregistre le relief du terrain dans la maison (`null` = plat) ; renvoie la maison réécrite. */
  saveRelief(relief: Relief | null): Promise<House>
  /** Enregistre le contour du terrain ; renvoie la maison réécrite (relief agrandi s'il le faut). */
  saveTerrain(polygon: Vec2[]): Promise<House>
  /** Écrit d'un coup une séance d'édition (finitions, cotes des pièces) ; renvoie la maison réécrite. */
  saveEdit(patch: HouseEditPatch): Promise<House>
  /** Ouvre le canal de push ; retourne la fonction de fermeture. */
  connect(handlers: TransportHandlers): () => void
}
