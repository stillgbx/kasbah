import type { GeoOrigin, ShoppingAddBody, ShoppingItemPatch, ShoppingList, HouseEditPatch, AutomationBody, GardenItemPatch, NewGardenItem, AutomationEntry, AutomationRun, Relief, SceneTuning, Vec2, CommandInput, DeviceConsumption, DeviceEnergyDays, DeviceEntry, DevicePlacement, EnergyHistory, HealthResponse, House, NewOpening, NewParking, OpeningPatch, PanelArrayPatch, ParkingPatch, PluginInfo, PluginSceneEntry, PluginSettingsPatch, PropertiesResponse, PropertyMode, NewPropertyBody, SceneRecallInput, SceneUpdate, ServerMessage, WeatherForecast, DeviceJournal, DeviceReleaseNotes, SiteMap, StateFor } from '@kasbah/shared'

// Abstraction of the server channel. Two implementations: HTTP + WebSocket (real) and in-process
// simulation (tests, static demo without a server). Commands ALWAYS go through a request
// (error codes, timeout, works during a reconnection); the WS only pushes.

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

/** A place to read the weather outside the house (search and favorites of the Weather view). */
export interface WeatherPlace {
  /** GeoNames identifier: two namesakes remain two favorites. */
  id: string
  name: string
  /** Region and country, to tell two namesakes apart ("Burgundy, France"). */
  region?: string
  countryCode?: string
  lat: number
  lon: number
}
/** The weather of any place, in the format of the house's device. */
export interface WeatherElsewhere {
  state: StateFor<'weather'>
  forecast: Omit<WeatherForecast, 'deviceId'>
  /** IANA time zone of the place: its hours are displayed in it. */
  timezone?: string
  attribution: string
}
/** A Météo-France warning (at least yellow), ongoing or upcoming. */
export interface WeatherAlert {
  /** Phenomenon: `thunderstorm`, `wind`, `rain_flood`…; `other` for an unknown one. */
  type: string
  level: 'yellow' | 'orange' | 'red'
  onset: number
  expires: number
}
/** The warning for a place's département; `area: null` outside metropolitan France (nothing to read). */
export interface WeatherAlerts {
  area: string | null
  /** Ongoing first, the strongest at the top. Empty = green. */
  warnings: WeatherAlert[]
  attribution: string
  web: string
}

/**
 * Pairing of the Enphase gateway, as the UI sees it. The token never appears in it: only the
 * server holds it, and `tokenFile` says where it keeps it — `null` if nothing is kept, and the UI
 * then warns that the pairing will not survive a restart.
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
  /** Enlighten session: essential for the charger, distinct from the gateway's local token. */
  cloudLinked: boolean
  cloudFile: string | null
  siteId?: string
  /** The site's daily history: last synchronization with Enphase's, and how many days are kept. */
  history: {
    syncedAt: number | null; since: number | null; days: number; syncing: boolean; error: string | null
    /** The micro-inverters' days: last full synchronization, and the one in progress (days done / to do). */
    inverters?: { syncedAt: number | null; done: number | null; total: number | null; error: string | null }
    /** Every past day since commissioning, one letter each from `from`: `c` complete, `e` nothing at Enphase, `p` incomplete, `m` missing. */
    coverage?: { from: number; days: string } | null
  }
}

export type EnphasePairing = { token: string } | { user: string; password: string; force?: boolean }

/**
 * Setup of the Tesla plugin, as the UI sees it. No secret or private key: the PUBLIC key
 * is in it, because it is the user who must place it on their domain.
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
 * A mileage-capped service contract at Renault: the only trace of a lease that Kamereon
 * exposes, offered to the "Edit" panel to pre-fill — never written automatically.
 */
export interface RenaultContract {
  description: string
  /** `YYYY-MM-DD`, or `null` when Renault does not give it. */
  start: string | null
  end: string | null
  maxKm: number
}

/**
 * Setup of the Renault plugin, as the UI sees it. The password NEVER appears in it: it
 * only passes through `renaultLogin`, and what remains of it on the server side is a session token.
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
   * What became of the last charge wake-up. Without it, a refused wake-up shows up nowhere
   * except in the server console — which is what let a whole day of solar surplus go by
   * on 2026-09-19. `null`: no wake-up attempted since startup.
   */
  lastWake: { at: number; result: 'sent' | 'deferred' | 'failed'; detail: string | null } | null
}

/**
 * Setup of the MELCloud plugin, as the UI sees it. Same rule as Renault: the
 * password NEVER appears in it, it only passes through `melcloudLogin` and what remains of it on the server
 * side is a session key.
 *
 * `devices` are the MACHINES seen on the account; `zoneCount` counts what the house receives, one
 * heating zone per device. The two numbers differ, and that is normal: a machine carries one
 * or two zones, and several heat pumps in cascade appear as a single
 * machine (the reference installation: three Zubadan, one device, two zones).
 */
/**
 * State of the PetKit link. No password in this interface, and that is not an oversight:
 * the vendor connects by CODE sent by email. `expiresAt` is thus useful information for
 * the screen — a lost session does not resume by itself, a new code will be needed.
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
  /** Devices published to the house: one heating ZONE each, never a machine. */
  zoneCount: number
  pollMs: number
  sessionFile: string | null
  lastError: string | null
}

/**
 * Setup of the iRobot plugin, as the UI sees it. No password appears in it: neither that
 * of the account (it only passes through `irobotLogin`), nor the local one of each robot.
 *
 * `ip` and `connected` say what the account does not know: where the robot is on the network, and whether the
 * MQTT link is open. A switched-off robot of the account stays listed, with no address and not connected.
 */
export interface IrobotStatus {
  linked: boolean
  linkedAt: number | null
  robots: { blid: string; name: string | null; sku: string | null; ip: string | null; connected: boolean }[]
  sessionFile: string | null
  lastError: string | null
}

/**
 * YouTube Music setup (unofficial). The cookie never appears in it — it only passes through
 * `ytmusicPutCookie`.
 */
export interface YtmusicStatus {
  linked: boolean
  cookieExpired: boolean
  poTokenOk: boolean
  unofficial: true
  cookieFile: string | null
  poTokenUrl: string
  lastError: string | null
  /** Browsers of the server machine for the import; none for a logged-in user. */
  browsers: string[]
  /** The account at stake: the logged-in user, or `null` for the house's. */
  user: string | null
  /** Logged-in user without a cookie: public catalog only, no likes or playlists. */
  anonymous: boolean
}

/** An account of the MCP server (`mcp-users.json`): the name only, the hashed password stays on the server. */
export interface McpUser { name: string }

/** A commit of the server's repository; `date` ISO 8601. */
export interface SystemCommit { sha: string; subject: string; date: string }

/**
 * Server version (`/api/system/version`): the loaded commit, those waiting on `origin/main`
 * (`null` if git did not answer, `error` says why), and whether a supervisor can update.
 */
export interface SystemVersion { supervised: boolean; running: SystemCommit | null; available: SystemCommit[] | null; error: string | null }

export type UpdateStep = 'fetch' | 'deps' | 'build' | 'restart' | 'rollback'

/** Progress of an update, written by the supervisor (`scripts/supervisor.mjs`). */
export interface UpdateStatus {
  state: 'running' | 'done' | 'failed'
  step: UpdateStep | null
  steps: UpdateStep[]
  failedStep: UpdateStep | null
  from: string | null
  to: string | null
  startedAt: number
  finishedAt: number | null
  error: string | null
  rolledBack: boolean
  supervisorChanged: boolean
  log: string[]
}

/**
 * The Claude plan (`claude` plugin) of the current account (`null` = the house, on the local network):
 * never the token, only whether there is one and whether the house has one as a fallback.
 */
export interface ClaudeAccount { user: string | null; savedAt: number | null; house: boolean }

/**
 * The voice of spoken replies (`transcription` plugin) of the current account (`user` `null` = the house,
 * on the local network). `voice` `null`: no choice, `houseVoice` is used, otherwise `defaultVoice` (`TTS_VOICE`).
 */
export interface TranscriptionSettings { user: string | null; voice: string | null; houseVoice: string | null; defaultVoice: string | null }

/** What an instruction consumed; `costUsd` at the API's list price (a plan is not billed per instruction). */
export interface AssistantUsage { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

/** What the assistant (`claude -p` on the server) returns, as it goes, for an instruction. */
export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean }
  | { type: 'done'; ms: number; usage?: AssistantUsage }
  | { type: 'error'; code: string; message: string; usage?: AssistantUsage }

/** An instruction from the assistant's log (the last 200, all accounts, local network only). */
export interface AssistantLogEntry {
  at: number
  user: string | null
  text: string
  tools: { id: string; name: string; input: unknown; ok?: boolean }[]
  answer: string
  error: { code: string; message: string } | null
  ms: number
  /** Absent: an engine that does not say it, or an entry from before 2026-10-11. */
  usage?: AssistantUsage
}

/** A calendar of the house (`agenda` plugin); its iCal address stays on the server. */
export interface AgendaCalendar { id: string; name: string; color: string; fetchedAt: number | null; error: string | null }
/**
 * An event occurrence. Whole day: local dates `YYYY-MM-DD`, end exclusive; otherwise
 * instants in ms.
 */
export type AgendaEvent = { id: string; calendarId: string; title: string; location?: string; description?: string }
  & ({ allDay: true; start: string; end: string } | { allDay: false; start: number; end: number })

/** Attachment of a TouteMonAnnée entry: image or document hosted by the site. */
export interface SchoolFile { type: string; url: string; thumb: string | null; name: string }
/** A class notebook (one class) of the TouteMonAnnée account. */
export interface SchoolJournal { id: string; name: string; years: string | null; students: string[] }
/** A homework item: `date` = the day it is due (`YYYY-MM-DD`). */
export interface SchoolHomework {
  id: number; journalId: string; date: string; title: string | null; subject: string | null; author: string | null
  text: string; levels: string[]; files: SchoolFile[]; done: boolean
  /** The "done" box is the site's: the teacher sees who ticked it. */
  siteAck: { validated: number; total: number } | null
}
/** A message of the liaison notebook; `at` = local time `YYYY-MM-DDTHH:mm`. */
export interface SchoolMessage {
  id: number; journalId: string; at: string; title: string | null; author: string | null
  text: string; levels: string[]; files: SchoolFile[]; read: boolean; responses: number
}
export interface SchoolPost {
  id: number; journalId: string; at: string; title: string | null; author: string | null
  text: string; levels: string[]; files: SchoolFile[]; comments: number
}
export interface SchoolFilters { hiddenJournals: string[]; hiddenLevels: string[] }
/**
 * Everything the `toutemonannee` plugin knows, in one response: every write returns the same shape.
 * The password NEVER appears in it; it only passes through `schoolLogin`.
 */
export interface SchoolData {
  linked: boolean; username: string | null; sessionLost: boolean; fetchedAt: number | null; error: string | null
  journals: SchoolJournal[]; homework: SchoolHomework[]; messages: SchoolMessage[]; posts: SchoolPost[]
  filters: SchoolFilters
  /** Identifier of the most recent publication seen. */
  postsSeen: number
}
/** A Mixcloud mix (`mixcloud` plugin); `key` (`/user/slug/`) is its id for the common player. */
export interface MixcloudMix {
  key: string
  name: string
  user: { username: string; name: string }
  artUrl: string | null
  durationS: number | null
  createdAt: string | null
  tags: string[]
  /** The mix's genres (Mixcloud `/genres/<slug>/` tags), in tag order. */
  genres: { slug: string; name: string }[]
  /** Position kept by the server (s), if this mix was partly listened to from here. */
  resumeS?: number
}
export interface MixcloudUser { username: string; name: string; artUrl: string | null }
/** `account`: the logged-in user whose account it is, `null` for the house. */
export interface MixcloudStatus { username: string | null; user: MixcloudUser | null; lastError: string | null; account: string | null }
export type MixcloudList = 'feed' | 'favorites' | 'listens' | 'uploads'
/** A row of the Mixcloud home, recomposed by the server from the account's public listens. */
export type MixcloudHomeSection =
  | { kind: 'users'; id: 'topCreators'; users: MixcloudUser[] }
  | { kind: 'mixes'; id: 'following' | 'listenAgain'; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'moreFrom'; user: MixcloudUser; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'popular'; genre: { slug: string; name: string }; items: MixcloudMix[] }
export interface MixcloudPage { items: MixcloudMix[]; next: string | null }

/** A web radio of the radio-browser directory (`radio` plugin). */
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
  /** Deduced from the InnerTube subtitle — not a dedicated API field. */
  releaseType?: 'album' | 'single' | 'ep' | 'compilation' | null
  explicit?: boolean
}

/** A player currently playing a stream from the Kasbah proxy (`GET /sessions`). */
/** What the proxy serves to the speaker, and what it received from YouTube to produce it. */
export interface MusicStreamQuality {
  mime: string
  /** null when the source stream is relayed without knowing it (variable bitrate). */
  bitrateKbps: number | null
  /** null when the proxy does not re-encode: the source decides, we do not inspect it. */
  sampleRateHz: number | null
  channels: number | null
  /** Size announced to the speaker; null if the duration is unknown (stream without a size). */
  lengthBytes: number | null
  source: { ext: string | null; formatId: string | null; abrKbps: number | null } | null
}

export interface MusicSession {
  deviceId: string
  /** The track's source (`ytmusic`, `mixcloud`…) and its id there. */
  source: string
  id: string
  sid: string
  /** Track duration (yt-dlp or catalog); the player also knows it from the size of the "file". */
  durationS: number | null
  /** What the catalog said about the track: the UI prefers it to what the speaker publishes (sometimes the stream URL). */
  title: string | null
  artist: string | null
  artUrl: string | null
  /** Absent from a server older than the quality display. */
  quality?: MusicStreamQuality | null
  /** This player's queue (previous / next, repeat); null or absent without a queue. */
  queue?: { length: number; index: number; repeat: MusicRepeat } | null
}

/** The last listen of a player that no longer plays anything of ours (server restarted, stop): enough to resume it. */
export interface MusicLastPlayed {
  deviceId: string
  track: MusicTrack
  /** Position reached (s). */
  positionS: number
  durationS: number | null
  queue: { length: number; index: number; repeat: MusicRepeat }
  at: number
}

/** A genre or a mood: its name (in the requested language), its color, and what it takes to open its page. */
export interface YtmusicExploreCategory {
  title: string
  params: string
  /** `#rrggbb`, the pill at YouTube Music. */
  color: string | null
}
/** "For you" (personalized, sometimes empty), "Moods and moments", "Genres" — titles localized by YouTube. */
export interface YtmusicExplore {
  forYou: { title: string; categories: YtmusicExploreCategory[] }
  moods: { title: string; categories: YtmusicExploreCategory[] }
  genres: { title: string; categories: YtmusicExploreCategory[] }
}
/** A row of a category's page: tracks, official playlists, albums. */
export interface YtmusicExploreShelf {
  title: string
  tracks: YtmusicTrack[]
  playlists: YtmusicPlaylist[]
  albums: YtmusicAlbum[]
}

/** Repeat of the current TRACK: `once` replays it once then the queue resumes, `loop` endlessly. */
export type MusicRepeat = 'off' | 'once' | 'loop'

/** A track as the queue keeps it (what `/api/music/play` accepts): its source and its id there. */
export interface MusicTrack {
  source: string
  id: string
  title?: string
  artist?: string
  artUrl?: string
  durationS?: number
  explicit?: boolean
  /** Start from there (s): resuming a long mix. */
  startS?: number
}

/** A player's queue: `items[index]` is playing. */
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
 * The state of a heating MACHINE, served by its plugin and not by the device registry: these
 * are a dozen measurements that are only consulted on the Heating page, and that did not have to
 * become as many sensors in the house and in the 3D scene.
 */
export interface MelcloudUnit {
  deviceId: string
  name: string
  power: boolean
  /** Heating its circuit right now (`OperationMode`): the only activity signal a cascade gives. */
  heating: boolean
  /** What the vendor claims — it says it is offline while talking. Kept for diagnosis only. */
  offline: boolean
  /** Is the last report too old? It is THIS field that says "unreachable". */
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
  /** `code` is 8000 when all is well: it is `hasError` that decides, never the code. */
  error: { hasError: boolean; code: number | null; message: string | null }
  /** Epoch ms: the server has already brought the vendor's two time bases to the same instant. */
  lastSeen: number | null
  wifi: string | null
  /** False = the machine has no meter: the page omits consumption instead of showing zeros. */
  energyMeter: boolean
}

/**
 * One hour of operating history. The counters are NUMBERS OF SAMPLES, not
 * minutes: `n` gives the scale, and a poorly polled hour reads for what it is instead of
 * passing for an hour without heating.
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

/** Maximum brightness of a step (full hour, local day or month), in lux. */
export interface LightPoint { t: number; maxLux: number }
/** Brightness history of a solar shutter, kept by the server as the box's frames arrive. */
export interface LightHistory { hourly: LightPoint[]; daily: LightPoint[]; monthly: LightPoint[] }

export interface Transport {
  getHouse(): Promise<House>
  getDevices(): Promise<DeviceEntry[]>
  getHealth(): Promise<HealthResponse>
  getHistory(deviceId: string, hours?: number): Promise<EnergyHistory>
  /** Forecast of a `weather` device, on demand (the server returns the last reading of its plugin). */
  getForecast(deviceId: string): Promise<WeatherForecast>
  /** Places whose name matches the search (Open-Meteo geocoding), names in the given language. */
  searchPlaces(query: string, lang: string): Promise<WeatherPlace[]>
  /** Current weather and forecast of a position other than the house. */
  getWeatherAt(lat: number, lon: number): Promise<WeatherElsewhere>
  /** Weather warning of a position (Météo-France through MeteoAlarm, metropolitan France only). */
  getWeatherAlerts(lat: number, lon: number): Promise<WeatherAlerts>
  /** Log of a device that declares the `journal` capability (recorded errors, warnings), from most recent to oldest. */
  getJournal(deviceId: string): Promise<DeviceJournal>
  /** Terrain map of a mower that declares the `site_map` capability (the server returns its plugin's cache). */
  getSiteMap(deviceId: string): Promise<SiteMap>
  /**
   * Release notes of a vehicle that declares `release_notes`, in `lang` if the vendor publishes it,
   * otherwise in English (`lang` of the response): the server returns its plugin's cache, with no call to the vendor.
   */
  getReleaseNotes(deviceId: string, lang: string): Promise<DeviceReleaseNotes>
  /** Consumption history (liters per step, never a cumulative total) of a `water` device, in three series: hour, day, month. */
  getConsumption(deviceId: string): Promise<DeviceConsumption>
  /** A site's daily energy totals (`energy_history` capability), on demand; `days`: only the last ones, today included. */
  getEnergyDays(deviceId: string, days?: number): Promise<DeviceEnergyDays>
  sendCommand(deviceId: string, command: CommandInput): Promise<void>
  getScenes(): Promise<PluginSceneEntry[]>
  /** Recalls a vendor scene (fixed or animated palette). */
  recallScene(sceneId: string, recall: SceneRecallInput): Promise<void>
  /** Writes a scene preference at the vendor (single source of truth). */
  updateScene(sceneId: string, update: SceneUpdate): Promise<void>
  /** Creates a light scene for a group, by copying a scene present elsewhere. */
  createScene(fromSceneId: string, groupName: string): Promise<void>
  /** Deletes a light scene at the vendor (destructive). */
  deleteScene(sceneId: string): Promise<void>
  /** The house's automations and their status (the WebSocket then pushes each change). */
  getAutomations(): Promise<AutomationEntry[]>
  /** Creates or replaces an automation; returns its status recomputed by the server. */
  putAutomation(id: string, body: AutomationBody): Promise<AutomationEntry>
  setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationEntry>
  deleteAutomation(id: string): Promise<void>
  /** Reorders the list (file order); returns the whole list in the new order. */
  setAutomationOrder(ids: string[]): Promise<AutomationEntry[]>
  /** Runs the actions right away (neither trigger nor "Unless"); returns the report. */
  runAutomation(id: string): Promise<AutomationRun>
  /** The house's shopping list. Every write returns the whole list (and the WebSocket pushes it). */
  getShopping(): Promise<ShoppingList>
  addShoppingItems(items: ShoppingAddBody['items']): Promise<ShoppingList>
  updateShoppingItem(id: string, patch: ShoppingItemPatch): Promise<ShoppingList>
  removeShoppingItem(id: string): Promise<ShoppingList>
  /** "Finish shopping": the ticked lines leave the list. */
  finishShopping(): Promise<ShoppingList>
  setShoppingFavorite(name: string, favorite: boolean): Promise<ShoppingList>
  /** Inventory of plugins: all those the server knows, active or not. */
  getPlugins(): Promise<PluginInfo[]>
  /** Writes a choice (activation, sub-item, light scenes) into the house; returns the up-to-date inventory. */
  setPluginSettings(pluginId: string, patch: PluginSettingsPatch): Promise<PluginInfo[]>
  /** The properties the application can show, and the one that is shown. */
  getProperties(): Promise<PropertiesResponse>
  /**
   * Switches to another property (demo mode only: 409 otherwise). The server restarts on
   * the other house; the caller reloads the application once the switch is done.
   */
  selectProperty(id: string): Promise<void>
  /** Creates a new property (demo server only: 409 otherwise); returns its id. */
  createProperty(body: NewPropertyBody): Promise<string>
  /** Duplicates a property (a demo, to modify it) under another name; returns the copy's id. */
  duplicateProperty(id: string, name: string): Promise<string>
  /** Switches to demo or real (server without an imposed house); the server reopens the property remembered for the mode. */
  setPropertyMode(mode: PropertyMode): Promise<void>
  pairHue(): Promise<{ appKey: string; hint: string }>
  /** Google consent URL to open in a browser to link the Nest account. */
  nestAuthUrl(): Promise<{ url: string; redirectUri: string }>
  /** State of the Enphase gateway pairing. Never carries the token itself. */
  enphaseTokenStatus(): Promise<EnphaseTokenStatus>
  /**
   * Pairs the Enphase gateway: a token already obtained, or the account credentials, which serve
   * once to mint one and are not kept. `force` replaces a still-valid token.
   */
  pairEnphase(body: EnphasePairing): Promise<EnphaseTokenStatus>
  /** Fetches Enphase's daily history again (the "Resync" button): the incomplete days, or every day with `force`. */
  syncEnphaseHistory(force?: boolean): Promise<EnphaseTokenStatus>
  /** Where the Tesla setup stands (public key to place, domain registered, account linked). */
  teslaStatus(): Promise<TeslaStatus>
  /** Registers the domain with Tesla, once the public key is placed on it. */
  teslaRegister(): Promise<TeslaStatus>
  /** Tesla consent URL to open in a browser to link the account. */
  teslaAuthUrl(): Promise<{ url: string; redirectUri: string }>
  /** New key pair (the old public key stops being valid: to place again on the domain). */
  teslaRotateKey(): Promise<TeslaStatus>
  /** Where the MY Renault account link stands (Kamereon account kept, vehicles). */
  renaultStatus(): Promise<RenaultStatus>
  /**
   * Links the MY Renault account. Gigya does not offer OAuth: the password goes through the server once
   * and is neither kept nor logged — only the Gigya session token survives.
   */
  renaultLogin(body: { email: string; password: string }): Promise<RenaultStatus>
  /** Unlinks the account: the session token is erased. */
  renaultLogout(): Promise<RenaultStatus>
  /** A vehicle's mileage-capped service contracts (by VIN), read on click. */
  renaultContracts(vin: string, lang: string): Promise<{ contracts: RenaultContract[] }>
  /** Where the MELCloud account link stands (machines seen on the account). */
  melcloudStatus(): Promise<MelcloudStatus>
  /**
   * Links the MELCloud account. The vendor does not offer OAuth: the password goes through the
   * server once and is neither kept nor logged — only the session key survives.
   */
  melcloudLogin(body: { email: string; password: string }): Promise<MelcloudStatus>
  /** Unlinks the account: the session key is erased. */
  melcloudLogout(): Promise<MelcloudStatus>
  /** Where the PetKit account link stands. */
  petkitStatus(): Promise<PetkitStatus>
  /** Step 1: ask PetKit to send a code to this address. It is valid for ten minutes. */
  petkitRequestCode(body: { email: string }): Promise<{ sent: boolean }>
  /** Step 2: exchange the code for a session. No password ever enters here. */
  petkitLogin(body: { email: string; code: string }): Promise<PetkitStatus>
  /** Unlinks the account: the session token is erased. */
  petkitLogout(): Promise<PetkitStatus>
  /** The state of the heating machines (last reading of the polling, never a new call to the vendor). */
  melcloudSystem(): Promise<{ units: MelcloudUnit[]; pollMs: number }>
  /** The operating history, built by the server as the polls go. */
  /** `daily` is absent from a server older than the daily series. */
  melcloudHistory(): Promise<{ hourly: HeatingPoint[]; daily?: HeatingPoint[]; pollMs: number }>
  /** Brightness history of a solar-shutter sensor (TaHoma only). */
  lightHistory(deviceId: string): Promise<LightHistory>
  /** Where the iRobot account link stands (known robots, and which ones answer on the network). */
  irobotStatus(): Promise<IrobotStatus>
  /**
   * Links the iRobot account. The password goes through the server once: what comes out is each robot's
   * LOCAL password, and nothing leaves the house's network afterwards.
   */
  irobotLogin(body: { email: string; password: string }): Promise<IrobotStatus>
  /** Unlinks the account: the local passwords are erased and the links closed. */
  irobotLogout(): Promise<IrobotStatus>
  /** Where the YouTube Music link stands (cookie present, PO Token reachable). */
  ytmusicStatus(): Promise<YtmusicStatus>
  /** Pastes the account's cookie (JSON body). Never logged. */
  ytmusicPutCookie(cookie: string): Promise<YtmusicStatus>
  /**
   * Imports the YouTube cookies via `yt-dlp --cookies-from-browser` on the server machine
   * (browser already logged in to music.youtube.com on this host).
   */
  ytmusicImportCookieFromBrowser(browser: string): Promise<YtmusicStatus>
  /** Erases the cookie. */
  ytmusicClearCookie(): Promise<YtmusicStatus>
  ytmusicSearch(q: string): Promise<YtmusicSearchResult>
  ytmusicLiked(): Promise<{ tracks: YtmusicTrack[] }>
  ytmusicPlaylists(): Promise<{ playlists: YtmusicPlaylist[] }>
  ytmusicPlaylist(id: string): Promise<{ tracks: YtmusicTrack[] }>
  /** Tracks of an album, and its description text if it has one (in the `hl` language). */
  ytmusicAlbum(id: string, hl?: string): Promise<{ tracks: YtmusicTrack[]; description?: string | null }>
  /** Tracks of an artist, and their description text if they have one (in the `hl` language). */
  ytmusicArtist(id: string, hl?: string): Promise<{ tracks: YtmusicTrack[]; description?: string | null }>
  /** Moods and genres; `hl` = app language (the names come from YouTube). */
  ytmusicExplore(hl?: string): Promise<YtmusicExplore>
  /** A category's page, in rows. */
  ytmusicExploreCategory(params: string, hl?: string): Promise<{ shelves: YtmusicExploreShelf[] }>
  /** YouTube Music's new releases (flagship playlists, recent albums and singles), in rows. */
  ytmusicExploreNew(hl?: string): Promise<{ shelves: YtmusicExploreShelf[] }>
  /** Two covers per category (key = `params`), taken from its page: slow the first time (~10 s), kept 6 h. */
  ytmusicExploreCovers(hl?: string): Promise<{ covers: Record<string, string[]> }>
  /** Resolves the stream and sends `play_url` to the player (optional metadata for title / cover). */
  musicPlay(body: {
    source: string
    id: string
    deviceId: string
    title?: string
    artist?: string
    artUrl?: string
    durationS?: number
    /** What the catalog says: the speaker will never know it, the state will carry it for the UI. */
    explicit?: boolean
  }): Promise<{ ok: true; streamUrl: string; sid: string }>
  /** Players currently playing a YouTube Music stream served by Kasbah. */
  musicSessions(): Promise<{ sessions: MusicSession[] }>
  /** The last listen of the players that are not playing anything of ours right now. */
  musicLast(): Promise<{ last: MusicLastPlayed[] }>
  /** Restart a player's last listen (queue included), at its position or at `positionS`. */
  musicResume(deviceId: string, positionS?: number): Promise<{ ok: true; streamUrl: string; sid: string; queue: MusicQueue }>
  /** The current track on `fromDeviceId` restarts on `toDeviceId`, which positions itself at the same position; the source stops. */
  musicTransfer(body: {
    fromDeviceId: string
    toDeviceId: string
    /** Source = this browser: its position and its queue, which the server picks up. */
    positionS?: number
    queue?: { tracks: MusicTrack[]; index: number; repeat: MusicRepeat }
  }): Promise<{
    ok: true; streamUrl: string; sid: string; positionS: number
    /** Target = this browser: the session to read, and the queue it picks up (null without a queue). */
    session?: MusicSession
    queue?: MusicQueue | null
  }>
  /** Playback in THIS browser: the server resolves the track and returns the path of the "file" to read. */
  musicLocalPlay(body: MusicTrack & { clientId: string; next?: { source: string; id: string } }): Promise<{ ok: true; streamUrl: string; session: MusicSession }>
  /** New queue on this player (the old one is replaced): `tracks[startIndex]` plays, the rest follows. */
  musicQueuePlay(body: { deviceId: string; tracks: MusicTrack[]; startIndex?: number }): Promise<{ ok: true; streamUrl: string; sid: string; queue: MusicQueue }>
  musicQueue(deviceId: string): Promise<MusicQueue>
  /** Add without interrupting; nothing playing on this player? The tracks start right away (`started`). */
  musicQueueAdd(body: { deviceId: string; tracks: MusicTrack[]; where: 'next' | 'end' }): Promise<{ ok: true; started: boolean; queue: MusicQueue }>
  musicQueueNext(deviceId: string): Promise<MusicQueue>
  /** To the start of the track if it has been playing for a few seconds, otherwise the previous track. */
  musicQueuePrevious(deviceId: string): Promise<MusicQueue>
  musicQueueJump(deviceId: string, index: number): Promise<MusicQueue>
  musicQueueRepeat(deviceId: string, mode: MusicRepeat): Promise<MusicQueue>
  musicQueueRemove(deviceId: string, index: number): Promise<MusicQueue>
  /** Position reached in a track played by THIS browser (resuming a mix); never blocking. */
  musicProgress(body: { source: string; id: string; positionS: number; durationS?: number; ended?: boolean }): Promise<void>
  /** Clear the queue: the current track continues, alone. */
  musicQueueClear(deviceId: string): Promise<MusicQueue>
  /** The session's account, under the public address; `null` on the local network (no session). */
  session(): Promise<{ user: string | null }>
  /** The Claude plan (`claude` plugin) of the current account. */
  claudeAccount(): Promise<ClaudeAccount>
  /** Stores the `claude setup-token` token for the current account; it never comes back. */
  claudeSetToken(token: string): Promise<ClaudeAccount>
  claudeClearToken(): Promise<ClaudeAccount>
  /** An instruction: events arrive as they go, the promise holds until the end. */
  assistantAsk(text: string, onEvent: (e: AssistantEvent) => void, signal?: AbortSignal): Promise<void>
  /** Is the `transcription` plugin running and does it know where to send the audio? (the microphone only shows then) */
  transcriptionStatus(): Promise<{ ready: boolean; provider: string | null; speech: boolean; autoSend: boolean }>
  /** A 16 kHz mono WAV in base64, and the house's names as vocabulary; returns the text heard. */
  transcribe(audio: string, hints: string[]): Promise<{ text: string; ms: number }>
  /**
   * The assistant's reply spoken aloud (`speech` sub-item): the sound, to play here. `words`: the
   * house's abbreviations to say in full (that of a floor → its name).
   */
  speak(text: string, words: Record<string, string>): Promise<Blob>
  /** The voices created at the provider (VoiceStudio profiles), for the plugin's sheet. */
  transcriptionVoices(): Promise<{ voices: { id: string; name: string; language?: string }[] }>
  /** The voice of spoken replies of the current account (the house on the local network); `null` = the house's, otherwise `TTS_VOICE`. */
  transcriptionSettings(): Promise<TranscriptionSettings>
  setTranscriptionVoice(voice: string | null): Promise<TranscriptionSettings>
  /** The instruction log, most recent first; refused under the public address (`LAN_ONLY`). */
  assistantLog(): Promise<{ entries: AssistantLogEntry[] }>
  /** Accounts of the public address and of the MCP server (AI assistants); local network only. */
  mcpUsers(): Promise<{ users: McpUser[] }>
  /** Creates the account, or changes its password (8 characters at least). */
  mcpSetUser(name: string, password: string): Promise<{ users: McpUser[] }>
  /** Removes the account: its tokens no longer get through. */
  mcpRemoveUser(name: string): Promise<{ users: McpUser[] }>
  /** Version in service and available commits; `refresh` forces a `git fetch`. Local network only. */
  systemVersion(refresh?: boolean): Promise<SystemVersion>
  /** Last update (`null`: never). */
  systemUpdateStatus(): Promise<{ status: UpdateStatus | null }>
  /** Asks the supervisor for the update; `NOT_SUPERVISED` without it, `UPDATE_RUNNING` if it is running. */
  systemUpdate(): Promise<{ status: UpdateStatus }>
  /** The house's calendars (`agenda` plugin, secret iCal addresses). */
  agendaCalendars(): Promise<{ calendars: AgendaCalendar[] }>
  /** Add by iCal address: the server reads it right away and refuses what is not a calendar. */
  agendaAddCalendar(body: { url: string; name?: string; color?: string }): Promise<{ calendars: AgendaCalendar[] }>
  agendaUpdateCalendar(id: string, patch: { name?: string; color?: string }): Promise<{ calendars: AgendaCalendar[] }>
  agendaRemoveCalendar(id: string): Promise<{ calendars: AgendaCalendar[] }>
  /** New order: ALL the identifiers, each once. */
  agendaReorderCalendars(ids: string[]): Promise<{ calendars: AgendaCalendar[] }>
  /** Occurrences of all the calendars over `[from, to[` (ms, 62 days at most). */
  agendaEvents(from: number, to: number): Promise<{ events: AgendaEvent[] }>
  /** Homework, liaison notebook and publications of the class (`toutemonannee` plugin). */
  schoolData(): Promise<SchoolData>
  /** Link the account: the password is used once, on the server side, then forgotten. */
  schoolLogin(body: { username: string; password: string }): Promise<SchoolData>
  schoolLogout(): Promise<SchoolData>
  schoolRefresh(): Promise<SchoolData>
  /** Tick "done": on the site when the teacher has opened their box, otherwise in Kasbah. */
  schoolSetDone(journalId: string, id: number, done: boolean): Promise<SchoolData>
  schoolSetFilters(filters: SchoolFilters): Promise<SchoolData>
  schoolSeenPosts(id: number): Promise<SchoolData>
  /** The linked Mixcloud account (a username: the public API asks for nothing else). */
  mixcloudStatus(): Promise<MixcloudStatus>
  mixcloudSetAccount(username: string): Promise<MixcloudStatus>
  mixcloudClearAccount(): Promise<MixcloudStatus>
  /** A list of the account; `next` = cursor returned by the previous page. `feed` = new releases from follows. */
  mixcloudList(list: MixcloudList, next?: string): Promise<MixcloudPage>
  /** The home: your creators, your follows, listen again, more from your creators, the popular ones of your genres. */
  mixcloudHome(): Promise<{ sections: MixcloudHomeSection[] }>
  mixcloudPlaylists(): Promise<{ playlists: { key: string; name: string }[] }>
  mixcloudPlaylist(key: string, next?: string): Promise<MixcloudPage>
  mixcloudFollowing(): Promise<{ users: MixcloudUser[] }>
  mixcloudUserMixes(username: string, next?: string): Promise<MixcloudPage>
  mixcloudSearch(q: string, next?: string): Promise<MixcloudPage>
  /** Start over: forget a mix's remembered position. */
  mixcloudForgetResume(key: string): Promise<void>
  /** Radios of the directory whose name contains `q`, most listened first. */
  radioSearch(q: string): Promise<{ stations: RadioStation[] }>
  /** The most listened of a country (server default: `RADIO_COUNTRY`). */
  radioTop(country?: string): Promise<{ stations: RadioStation[] }>
  /** The house's favorites, kept by the server. */
  radioFavorites(): Promise<{ stations: RadioStation[] }>
  radioAddFavorite(station: RadioStation): Promise<{ stations: RadioStation[] }>
  radioRemoveFavorite(id: string): Promise<{ stations: RadioStation[] }>
  /** Adds to the favorites a radio the directory does not know (or under a dead address), by its stream. */
  radioAddCustom(body: { name: string; url: string }): Promise<{ stations: RadioStation[] }>
  /** Starts the live radio on a player (`play_url` marked `live`). */
  radioPlay(body: { deviceId: string; stationId: string }): Promise<{ ok: true; station: RadioStation }>
  /** The last station started on each player (its quality: the speaker does not say it). */
  radioPlaying(): Promise<{ playing: { deviceId: string; station: RadioStation }[] }>
  /**
   * Makes the plugin that held a device forget it (`meta.forgettable`), by convention
   * `DELETE /api/plugins/<plugin>/devices/<externalId>`: it leaves the inventory until it
   * announces itself again. Used for devices discovered on the network and gone for good.
   */
  forgetDevice(deviceId: string): Promise<void>
  /**
   * WebSocket URL of a camera's video stream (`live_stream`), by convention
   * `/api/plugins/<plugin>/cameras/<externalId>/stream`; `null` if this transport does not serve any.
   */
  cameraStreamUrl(deviceId: string): string | null
  /**
   * Thumbnails of a plugin's cameras (`externalId` → date), and `watch` to signal that we are watching
   * the Cameras view: this is what keeps the thumbnail sessions alive on the server side.
   */
  cameraSnapshots(pluginId: string, watch: boolean): Promise<Record<string, { at?: number; live: boolean; inactive?: boolean; paused?: boolean; refreshing?: boolean }>>
  /** Stops (`false`) or resumes (`true`) a camera's thumbnail on the Cameras view. */
  setCameraSnapshots(deviceId: string, enabled: boolean): Promise<void>
  /** URL of a camera's JPEG thumbnail; `at` is used to get around the browser cache. */
  cameraSnapshotUrl(deviceId: string, at: number): string | null
  /** (Re)places a device in house.json; returns the rewritten house. */
  placeDevice(id: string, placement: DevicePlacement): Promise<House>
  /** Removes a device from house.json (it becomes unplaced or auto-placed again); returns the rewritten house. */
  removeDevice(id: string): Promise<House>
  /** Creates or adjusts a panel array (`house.arrays`); returns the rewritten house. */
  saveArray(id: string, patch: PanelArrayPatch): Promise<House>
  /** Removes a panel array: its modules disappear, its inverters go back to being placed. */
  removeArray(id: string): Promise<House>
  /** Adjusts an opening (measurements, place on the wall); returns the rewritten house. */
  saveOpening(roomId: string, openingId: string, patch: OpeningPatch): Promise<House>
  /** Adds an opening to a room (kind, wall and measurements decided by the UI); returns the rewritten house. */
  addOpening(roomId: string, opening: NewOpening): Promise<House>
  /** Removes an opening; the cover that dressed it is freed. Returns the rewritten house. */
  removeOpening(roomId: string, openingId: string): Promise<House>
  /** Adds a parking space (what is stored there, where, in which direction); returns the rewritten house. */
  addParking(parking: NewParking): Promise<House>
  /** Adjusts a space (measurements, center, heading); returns the rewritten house. */
  saveParking(id: string, patch: ParkingPatch): Promise<House>
  /** Removes a space: the vehicle stored there goes back to its GPS point. Returns the rewritten house. */
  removeParking(id: string): Promise<House>
  /** Adds an element to the garden (tree, bush, stone); returns the rewritten house. */
  addGardenItem(item: NewGardenItem): Promise<House>
  /** Adjusts a garden element (family, base, height, heading, shape); returns the rewritten house. */
  saveGardenItem(id: string, patch: GardenItemPatch): Promise<House>
  /** Removes a garden element; returns the rewritten house. */
  removeGardenItem(id: string): Promise<House>
  /** Writes the display order of a level's rooms; returns the rewritten house. */
  setRoomOrder(levelId: string, roomIds: string[]): Promise<House>
  /** Saves the 3D scene's light setting in the house; returns the rewritten house. */
  saveRenderTuning(tuning: SceneTuning): Promise<House>
  /** Saves the terrain relief in the house (`null` = flat); returns the rewritten house. */
  saveRelief(relief: Relief | null): Promise<House>
  /** Saves the terrain outline; returns the rewritten house (relief enlarged if needed). */
  saveTerrain(polygon: Vec2[]): Promise<House>
  /** Saves the house's GPS origin (alignment on the photo); returns the rewritten house. */
  saveOrigin(origin: GeoOrigin): Promise<House>
  /** Writes an editing session in one go (finishes, room measurements); returns the rewritten house. */
  saveEdit(patch: HouseEditPatch): Promise<House>
  /** Opens the push channel; returns the closing function. */
  connect(handlers: TransportHandlers): () => void
}
