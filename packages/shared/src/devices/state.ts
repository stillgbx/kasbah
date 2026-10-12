import { z } from 'zod'
import { AQI_LEVELS, CLIMATE_MODES, FAN_DIRECTIONS, PET_PUMP_MODES, POLLEN_TYPES, WEATHER_CONDITIONS, type DeviceKind } from './kinds'

// État courant d'un appareil, discriminé par `kind`. `updatedAt` est posé par le serveur
// (jamais par un plugin) ; `available:false` conserve les dernières valeurs connues
// (l'UI les grise au lieu de les perdre).

const pct = z.number().min(0).max(100)
export const xySchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
export type ColorXY = z.infer<typeof xySchema>

const base = { updatedAt: z.number().int(), available: z.boolean() }

export const lightStateSchema = z.object({
  kind: z.literal('light'), ...base,
  on: z.boolean(),
  brightness: pct.optional(),
  colorTempMirek: z.number().optional(),
  color: xySchema.optional(),
  /** Effet du fabricant en cours (`no_effect` quand aucun) — voir `meta.effects`. */
  effect: z.string().optional(),
})

export const COVER_MOTIONS = ['opening', 'closing', 'stopped'] as const
export const coverStateSchema = z.object({
  kind: z.literal('cover'), ...base,
  /**
   * 0 = fermé, 100 = ouvert. **Absente = position inconnue**, et c'est un cas courant : une radio
   * unidirectionnelle (RTS chez Somfy) ne renvoie jamais où elle en est. Tant qu'aucune commande
   * n'est passée par Kasbah, il n'y a rien à afficher — une valeur par défaut se lirait comme un
   * fait (« Baissé » pour un store en réalité remonté, et un compteur de résumé faux avec lui).
   */
  position: pct.optional(),
  tilt: pct.optional(),
  motion: z.enum(COVER_MOTIONS),
  /**
   * Position favorite MÉMORISÉE DANS LE MOTEUR (le « my » de Somfy), même échelle que `position`.
   * Absente = l'appareil sait y aller mais ne dit pas où elle est — c'est le cas d'une radio
   * unidirectionnelle. La capacité `preset` dit qu'on peut la rappeler ; cette valeur, seulement
   * qu'on peut la montrer. Kasbah ne la programme pas, il la lit.
   */
  presetPosition: pct.optional(),
  /**
   * Mode discret (capacité `quiet`) : les manœuvres passées par Kasbah roulent en vitesse lente.
   * C'est un réglage de KASBAH, pas du moteur — la télécommande murale garde sa vitesse normale.
   * Absent = l'appareil ne sait pas rouler lentement.
   */
  quiet: z.boolean().optional(),
  /**
   * Charge de la batterie d'un moteur autonome (capacité `battery`) : un volet SOLAIRE vit sur sa
   * batterie, rechargée par son panneau. Absente = le moteur ne la publie pas.
   */
  batteryPct: pct.optional(),
})

/** `on` : une appli est à l'écran mais ne dit pas ce qu'elle fait (Netflix natif sur un Chromecast) — ni lecture ni pause connues. */
export const PLAYBACKS = ['playing', 'paused', 'idle', 'on', 'off'] as const
export const mediaPlayerStateSchema = z.object({
  kind: z.literal('media_player'), ...base,
  playback: z.enum(PLAYBACKS),
  volume: pct,
  muted: z.boolean(),
  nowPlaying: z.object({
    title: z.string(),
    artist: z.string().optional(),
    album: z.string().optional(),
    artUrl: z.string().optional(),
    durationS: z.number().optional(),
    positionS: z.number().optional(),
    source: z.string().optional(),
    /**
     * Flux EN DIRECT (radio, chaîne d'info) : il n'a ni début où revenir, ni fin, ni piste voisine.
     * Absent = on ne sait pas, et on suppose un morceau ordinaire. Distinct d'une durée absente,
     * qui dit seulement « inconnue » : une appli native de TV n'annonce pas de durée sans être un
     * direct. Ce que l'UI en fait : précédent / suivant / se placer sont refusés.
     */
    live: z.boolean().optional(),
    /**
     * Titre marqué EXPLICIT par le service qui l'a lancé (`media_player.play_url`) : les enceintes
     * ne le publient jamais. Absent = on ne sait pas, et l'UI ne marque rien.
     */
    explicit: z.boolean().optional(),
  }).optional(),
  /**
   * Où SORT le son de l'appareil, quand il sait le dire (une TV Sony par son API locale) : `internal`
   * (ses haut-parleurs), `external` (un système audio branché — HDMI ARC, optique — c'est LUI qu'on
   * entend), `both`. `name` : le nom que l'appareil donne à ce système (nom CEC, « Flexus 300 »).
   * Absent = inconnu. L'UI s'en sert pour poser l'onde sonore sur le bon appareil, avec le lien
   * `meta.audioOutput` déclaré dans house.json.
   */
  audioOutput: z.object({ terminal: z.enum(['internal', 'external', 'both']), name: z.string().optional() }).optional(),
})

export const CLIMATE_ACTIONS = ['heating', 'cooling', 'idle', 'off'] as const
export const climateStateSchema = z.object({
  kind: z.literal('climate'), ...base,
  mode: z.enum(CLIMATE_MODES),
  action: z.enum(CLIMATE_ACTIONS).optional(),
  targetTempC: z.number(),
  currentTempC: z.number(),
  humidity: pct.optional(),
  fanMode: z.string().optional(),
})

export const VACUUM_ACTIVITIES = ['docked', 'cleaning', 'paused', 'returning', 'error'] as const
export const vacuumStateSchema = z.object({
  kind: z.literal('vacuum'), ...base,
  activity: z.enum(VACUUM_ACTIVITIES),
  battery: pct,
  binFull: z.boolean().optional(),
  errorMessage: z.string().optional(),
  /**
   * Le patin de serpillière est-il posé (capacité `mop`). Sans lui le robot aspire mais ne lave
   * pas, et son appli le dit avant de proposer un lavage. Absent = le robot ne le rapporte pas.
   */
  mopAttached: z.boolean().optional(),
  /**
   * Eau restante, en pour cent (capacité `mop`). Absent aussi quand le RÉSERVOIR n'est pas en
   * place : les deux se confondent ici volontairement, parce qu'un réservoir retiré et un niveau
   * inconnu appellent le même geste — aller voir la machine. Ne pas confondre avec `binFull`, qui
   * parle du bac à poussière.
   */
  tankLevel: pct.optional(),
})

/** `stopped` : arrêté là où il est (bouton STOP, arrêt dans le jardin, robot éteint) — ni garé, ni en pause. */
export const MOWER_ACTIVITIES = ['parked', 'mowing', 'charging', 'returning', 'paused', 'stopped', 'error'] as const
/**
 * Pourquoi la tondeuse ne tond pas alors qu'elle pourrait (Husqvarna `restrictedReason`) : le
 * planning, une consigne de parquer, un capteur (pluie), la limite journalière, une mise à jour, le
 * gel, toutes les zones faites, une consigne externe. Absent = le fabricant ne le dit pas.
 */
export const MOWER_RESTRICTIONS = [
  'none', 'week_schedule', 'park_override', 'sensor', 'daily_limit', 'fota', 'frost', 'all_work_areas_completed', 'external', 'not_applicable',
] as const
export type MowerRestriction = (typeof MOWER_RESTRICTIONS)[number]
export const mowerStateSchema = z.object({
  kind: z.literal('mower'), ...base,
  activity: z.enum(MOWER_ACTIVITIES),
  battery: pct,
  nextStartAt: z.number().optional(),
  errorMessage: z.string().optional(),
  /** Code d'erreur du fabricant (Husqvarna en a 160) : ce que le support demande, à côté du texte. */
  errorCode: z.number().int().optional(),
  /** Quand l'erreur est survenue. */
  errorAt: z.number().optional(),
  restrictedReason: z.enum(MOWER_RESTRICTIONS).optional(),
  /** Position locale (repère maison, mètres) si le robot la publie. */
  position: z.tuple([z.number(), z.number()]).optional(),
  /**
   * Position GPS, pour un robot qui la publie ainsi (Husqvarna) : c'est la scène qui la projette sur
   * le terrain, comme pour un véhicule — le plugin ne connaît pas le repère de la maison. `position`
   * (locale) prime si les deux sont là.
   */
  location: z.object({ lat: z.number(), lon: z.number(), at: z.number() }).optional(),
  /** Hauteur de coupe en centimètres (1 à 9 chez Husqvarna : c'est ainsi que son appli la nomme). */
  cuttingHeight: z.number().int().min(1).max(9).optional(),
  /** Dernier statut REÇU du robot par le fabricant : plus vieux qu'`updatedAt` quand le robot ne parle plus. */
  statusAt: z.number().optional(),
  /**
   * Zones de travail (capacité `work_areas`), tracées dans l'appli du fabricant. Un nom vide est
   * possible : Husqvarna publie une zone `0` sans nom, tout le terrain, tant qu'on n'en a pas tracé.
   */
  workAreas: z.array(z.object({ id: z.number().int().min(0), name: z.string(), enabled: z.boolean() })).optional(),
  /** Zones d'exclusion (capacité `stay_out_zones`) : `enabled` = le robot n'y entre pas. */
  stayOutZones: z.array(z.object({ id: z.string().min(1), name: z.string(), enabled: z.boolean() })).optional(),
  /** Compteurs de vie du robot, tels que le fabricant les tient (secondes, mètres, nombres). */
  statistics: z.object({
    cuttingTimeS: z.number().optional(),
    chargingTimeS: z.number().optional(),
    runningTimeS: z.number().optional(),
    searchingTimeS: z.number().optional(),
    bladeUsageTimeS: z.number().optional(),
    chargingCycles: z.number().optional(),
    collisions: z.number().optional(),
    driveDistanceM: z.number().optional(),
  }).optional(),
})

export const sensorStateSchema = z.object({
  kind: z.literal('sensor'), ...base,
  value: z.number(),
  /**
   * Plus haute valeur jamais rapportée par l'appareil, quand c'est LUI qui la tient (un micro-onduleur
   * Enphase publie son `maxReportWatts`). Un record, pas une caractéristique : il dit ce qui s'est
   * produit, jamais ce que l'appareil sait faire. Absent = l'appareil ne le dit pas.
   */
  maxValue: z.number().optional(),
})

export const energyStateSchema = z.object({
  kind: z.literal('energy'), ...base,
  /** Jamais négatif : un champ photovoltaïque produit ou ne produit pas, il ne consomme pas. */
  productionW: z.number(),
  consumptionW: z.number(),
  /** >0 import réseau, <0 export. */
  gridW: z.number(),
  /** >0 charge, <0 décharge. */
  batteryW: z.number().optional(),
  batterySoc: pct.optional(),
  todayProductionWh: z.number().optional(),
  todayConsumptionWh: z.number().optional(),
})

export const CHARGER_STATUSES = ['disconnected', 'connected', 'charging', 'finished', 'error'] as const
export const evChargerStateSchema = z.object({
  kind: z.literal('ev_charger'), ...base,
  status: z.enum(CHARGER_STATUSES),
  powerW: z.number(),
  sessionWh: z.number(),
  maxCurrentA: z.number().optional(),
  /**
   * La borne s'est repliée sur son intensité de SÉCURITÉ (Enphase `safeLimitState: 1`, « mode
   * sécurisé », 8 A sur la borne de référence) : sa répartition dynamique de charge n'a plus de
   * mesure, typiquement quand elle a perdu la passerelle. `maxCurrentA` ne vaut alors plus. Absent = inconnu.
   */
  safeLimit: z.boolean().optional(),
})

/**
 * Veille d'un véhicule connecté. `asleep` est un état NORMAL, pas une panne : une Tesla à l'arrêt
 * coupe son ordinateur au bout d'un quart d'heure pour ne pas vider sa batterie, et ne répond plus
 * à rien tant qu'on ne la réveille pas. Les autres valeurs de l'état sont alors les DERNIÈRES
 * connues, toujours affichées ; `available` reste vrai. `offline` = injoignable par le fabricant
 * (parking souterrain, sans réseau).
 */
export const VEHICLE_SLEEP_STATES = ['online', 'asleep', 'offline'] as const
export type VehicleSleepState = (typeof VEHICLE_SLEEP_STATES)[number]
/** Rapport engagé : `P` = à l'arrêt. Absent = inconnu (véhicule endormi, jamais lu). */
export const VEHICLE_GEARS = ['P', 'R', 'N', 'D'] as const
export type VehicleGear = (typeof VEHICLE_GEARS)[number]

/**
 * Où en est une mise à jour logicielle du véhicule. `available` = téléchargée, prête à installer ;
 * `scheduled` = installation programmée (`scheduledAt`) ; `waiting_wifi` = le téléchargement attend
 * un Wi-Fi (Tesla `downloading_wifi_wait`). Rien en attente = pas de `softwareUpdate` du tout.
 */
export const VEHICLE_UPDATE_STATUSES = ['available', 'scheduled', 'downloading', 'waiting_wifi', 'installing'] as const
export type VehicleUpdateStatus = (typeof VEHICLE_UPDATE_STATUSES)[number]

const seatLevel = z.number().int().min(0).max(3)

export const vehicleStateSchema = z.object({
  kind: z.literal('vehicle'), ...base,
  soc: pct,
  rangeKm: z.number(),
  pluggedIn: z.boolean(),
  charging: z.boolean(),
  chargePowerW: z.number().optional(),
  /**
   * Puissance de charge TELLE QUE LE VÉHICULE LA DIT. Absente = il ne la dit pas (la Renault 5
   * E-Tech, vérifié voiture en charge) : Kasbah l'ESTIME alors à l'affichage (`estimateChargePowerW`)
   * à partir de la capacité saisie dans la maison, et l'annonce comme une estimation. Rien de déduit
   * n'entre ici : cet état est ce que le fabricant a répondu.
   */
  /**
   * Plancher de charge voulu par l'utilisateur (%) : le niveau sous lequel il ne veut pas que la
   * voiture descende (`socMin` de Renault, seuil de la décharge V2L comprise). Tesla n'a pas cette
   * notion — le champ reste absent, et la jauge ne montre alors qu'un repère.
   */
  socMin: pct.optional(),
  /**
   * Minutes restantes avant la fin de la charge, telles que le VÉHICULE les estime (Tesla
   * `time_to_full_charge`, Renault `chargingRemainingTime`) — jamais un calcul de Kasbah, qui ne
   * connaît ni la courbe de charge ni le chauffage de la batterie. Absent = pas d'estimation ; ne
   * vaut que pendant la charge (un véhicule à l'arrêt garde parfois la dernière valeur, périmée).
   */
  chargeMinutesRemaining: z.number().min(0).optional(),
  chargeLimit: pct.optional(),
  /**
   * Verrouillage. **Optionnel = inconnu** : tous les constructeurs ne le disent pas (la R5 E-Tech
   * repond 403 sur son endpoint `lock-status`). Meme arbitrage que la `position` d'un ouvrant :
   * afficher Â« â Â» plutot qu'un cadenas qui mentirait.
   */
  locked: z.boolean().optional(),
  location: z.object({ lat: z.number(), lon: z.number(), at: z.number() }).optional(),
  /** Cap du véhicule (degrés, 0 = nord, sens horaire) : oriente son marqueur sur la carte. Absent = inconnu. */
  headingDeg: z.number().min(0).max(360).optional(),
  odometerKm: z.number().optional(),
  sleepState: z.enum(VEHICLE_SLEEP_STATES).optional(),
  /** Vitesse instantanée ; 0 à l'arrêt. Absente = inconnue. */
  speedKmh: z.number().min(0).optional(),
  gear: z.enum(VEHICLE_GEARS).optional(),
  /**
   * Pression des quatre pneus (avant gauche, avant droit, arrière gauche, arrière droit), en bar.
   * Chaque roue est optionnelle : les capteurs ne rapportent qu'en roulant, un véhicule qui n'a pas
   * bougé depuis longtemps n'en donne aucune.
   */
  tirePressureBar: z.object({
    fl: z.number().optional(), fr: z.number().optional(), rl: z.number().optional(), rr: z.number().optional(),
  }).optional(),
  insideTempC: z.number().optional(),
  outsideTempC: z.number().optional(),
  /** Climatisation de l'habitacle en marche (préconditionnement compris). Absent = inconnu. */
  climateOn: z.boolean().optional(),
  /** Consigne de l'habitacle, °C, telle que la voiture la garde. Absente = inconnue. */
  climateTargetC: z.number().optional(),
  /** Chauffage de chaque siège, cran 0 (arrêt) à 3. Une place absente = inconnue ou sans chauffage. */
  seatHeat: z.object({
    fl: seatLevel.optional(), fr: seatLevel.optional(), rl: seatLevel.optional(), rc: seatLevel.optional(), rr: seatLevel.optional(),
  }).optional(),
  steeringWheelHeat: z.boolean().optional(),
  /** Version logicielle INSTALLÉE, telle que le fabricant la nomme (`2026.32.7`). Absente = inconnue. */
  softwareVersion: z.string().optional(),
  /**
   * Mise à jour EN ATTENTE ; absente = aucune (ou inconnu). Chaque nombre est facultatif et ne vaut
   * que dans son statut : Tesla laisse traîner `install_perc` hors installation, le plugin ne le
   * publie que pendant `installing`.
   */
  softwareUpdate: z.object({
    status: z.enum(VEHICLE_UPDATE_STATUSES),
    version: z.string().optional(),
    downloadPct: pct.optional(),
    installPct: pct.optional(),
    /** Heure d'installation programmée (ms epoch), en `scheduled` seulement. */
    scheduledAt: z.number().optional(),
    /** Durée annoncée de l'installation, secondes : la voiture est inutilisable pendant ce temps. */
    expectedDurationS: z.number().min(0).optional(),
  }).optional(),
  /**
   * Date (ms epoch) de la dernière LECTURE COMPLÈTE du véhicule — pas `updatedAt`, que la seule veille
   * fait bouger. C'est ce que l'UI affiche (« lu il y a 12 min ») : sur une API facturée et un
   * véhicule qui dort, les valeurs ont un âge, et l'utilisateur doit le voir. Absente = jamais lu.
   */
  readAt: z.number().int().optional(),
})

/**
 * Une caméra n'a pour l'instant pas d'état propre : l'API Google Nest ne dit ni si elle filme ni si
 * elle est « allumée » (ce réglage n'y est pas exposé). Seule `available` porte une information.
 * Les événements (sonnerie, mouvement) viendront s'ajouter ici quand le flux Pub/Sub sera branché.
 */
export const cameraStateSchema = z.object({
  kind: z.literal('camera'), ...base,
})

/**
 * La météo AU-DESSUS de la maison, maintenant. Un seul appareil par plugin (sa position est
 * `house.origin`), en lecture seule comme une caméra. Ce qui est ici est ce que le widget, la scène
 * 3D et une future routine ont besoin de savoir SANS rien demander : les prévisions, plus lourdes et
 * qui changent à chaque sondage, se lisent à la demande (`GET /api/devices/:id/forecast`).
 *
 * Les champs OPTIONNELS sont ceux qu'un fournisseur peut ne pas avoir ; absent = il ne le dit pas,
 * jamais un zéro. Les pourcentages sont sur 100 comme partout ailleurs dans le contrat
 * (`climate.humidity`) — la scène 3D, qui pense en 0-1, convertit.
 */
export const VIGILANCE_LEVELS = ['yellow', 'orange', 'red'] as const
export type VigilanceLevel = (typeof VIGILANCE_LEVELS)[number]

export const weatherStateSchema = z.object({
  kind: z.literal('weather'), ...base,
  condition: z.enum(WEATHER_CONDITIONS),
  tempC: z.number(),
  feelsLikeC: z.number().optional(),
  dewPointC: z.number().optional(),
  humidity: pct,
  pressureHpa: z.number().optional(),
  windKmh: z.number().min(0),
  windGustKmh: z.number().min(0).optional(),
  /** D'où vient le vent (degrés, 0 = nord, sens horaire). */
  windDirDeg: z.number().min(0).max(360),
  cloudCover: pct,
  /** Précipitations de l'heure écoulée (mm). */
  precipMm: z.number().min(0).optional(),
  precipProbability: pct.optional(),
  visibilityM: z.number().min(0).optional(),
  uvIndex: z.number().min(0).optional(),
  isDay: z.boolean(),
  /** Lever et coucher du JOUR COURANT (ms epoch) : ce qu'une routine « avant le coucher » attend. */
  sunrise: z.number().int(),
  sunset: z.number().int(),
  /** Indice européen de qualité de l'air (0-20 bon … >100 extrêmement mauvais) et son palier. */
  aqi: z.number().min(0).optional(),
  aqiLevel: z.enum(AQI_LEVELS).optional(),
  /** Niveau par pollen, 0 (nul) à 4 (très élevé). Absent = ce fournisseur ne suit pas les pollens. */
  pollen: z.partialRecord(z.enum(POLLEN_TYPES), z.number().int().min(0).max(4)).optional(),
  /** Heure de l'observation ou du pas de modèle (ms epoch), distincte d'`updatedAt` (heure du sondage). */
  observedAt: z.number().int(),
  /**
   * Vigilances Météo-France EN COURS sur le département de la maison (au moins jaunes), la plus
   * forte d'abord : ce qu'une alerte ou une routine lit sans rien demander. `[]` = aucune ; absent =
   * on ne sait pas (hors de la métropole, ou flux pas encore lu). Les vigilances à venir et celles
   * d'un autre lieu se lisent à la demande (`/api/plugins/open_meteo/alerts`).
   */
  vigilance: z.array(z.object({
    /** Phénomène (`thunderstorm`, `wind`…), `other` pour un phénomène inconnu. */
    type: z.string(),
    level: z.enum(VIGILANCE_LEVELS),
    onset: z.number().int(),
    expires: z.number().int(),
  })).optional(),
})

/**
 * Une station qui traite l'eau de toute la maison (COMAP Proteo) : elle filtre, passe aux
 * ultraviolets, et tient les compteurs de ce qu'elle a laissé passer. En lecture seule comme la
 * météo — ses réglages (dureté de l'eau, créneaux de la lampe, horloge) se font sur son écran
 * tactile. Son protocole sait pourtant écrire : c'est un choix, pas une limite, parce qu'une fausse
 * manœuvre à distance sur l'eau potable coûterait plus cher que le confort gagné.
 *
 * TOUS les champs de mesure sont optionnels, et c'est délibéré : avant la première lecture réussie,
 * « absent » se lit « inconnu ». Un `0 %` d'usure ou un `0 L` de consommation affirmerait une
 * mesure qu'on n'a pas — même règle que `cover.position`.
 */
export const waterStateSchema = z.object({
  kind: z.literal('water'), ...base,
  /**
   * Ce qu'il RESTE de chaque consommable, 100 = neuf. Le préfiltre retient les sédiments (il se
   * lave, une fois par an), les deux cartouches de charbon actif le goût de chlore et les
   * pesticides, la lampe UVc les bactéries et les virus.
   */
  prefilterPct: pct.optional(),
  carbon1Pct: pct.optional(),
  carbon2Pct: pct.optional(),
  uvLampPct: pct.optional(),
  /**
   * La lampe UVc éclaire EN CE MOMENT. Elle s'économise d'elle-même : la station accepte trois
   * créneaux quotidiens de « mode économie » pendant lesquels elle s'éteint au bout d'une heure
   * sans tirage d'eau — une lampe éteinte la nuit n'est donc pas une panne.
   */
  uvOn: z.boolean().optional(),
  /**
   * Débit instantané, en litres par heure — CONFIRMÉ au robinet le 2026-09-16 : un mitigeur
   * ouvert à fond a fait monter la station à 900, soit 15 L/min, l'ordre de grandeur exact d'un
   * robinet (en litres par minute, il aurait fallu croire à 54 m³/h).
   *
   * Le débitmètre compte par pas de 36 L/h — toutes les valeurs relevées en sont des multiples —
   * donc la mesure est BEAUCOUP plus grossière que ses trois chiffres ne le laissent croire : à
   * montrer comme un ordre de grandeur, jamais comme une précision au litre.
   */
  flowLph: z.number().min(0).optional(),
  /** Eau consommée (litres), sur les fenêtres que la station compte elle-même. */
  todayL: z.number().min(0).optional(),
  weekL: z.number().min(0).optional(),
  monthL: z.number().min(0).optional(),
  /**
   * La station signale un avertissement, ou un défaut. Elle tient par ailleurs un historique
   * d'alertes codées que sa notice ne documente pas (elle renvoie au SAV) : Kasbah n'en publie donc
   * que ces deux résumés-là, les seuls dont le sens soit établi.
   */
  warning: z.boolean().optional(),
  defect: z.boolean().optional(),
})

export const petFeederStateSchema = z.object({
  kind: z.literal('pet_feeder'), ...base,
  /**
   * Le fabricant annonce un MANQUE de croquettes, pas un niveau : la mangeoire n'a qu'un détecteur
   * de trémie vide, aucune jauge. Publier un pourcentage serait inventer une précision qui n'existe
   * pas. Absent = la machine ne s'est pas prononcée.
   */
  foodLow: z.boolean().optional(),
  /** Une ration tombe EN CE MOMENT. Dure quelques secondes ; sert à accuser le geste. */
  feeding: z.boolean().optional(),
  /**
   * Servi depuis minuit et ce que le plan du jour prévoit EN TOUT, **dans l'unité que l'appareil
   * déclare** (`meta.petFeeder.unit`). Ce n'est pas toujours une masse : une Fresh Element Solo
   * compte en TASSES (0,3 tasse), une Fresh Element Infinity en grammes. L'écart entre servi et
   * prévu dit s'il reste des repas à venir.
   */
  servedToday: z.number().min(0).optional(),
  plannedToday: z.number().min(0).optional(),
  /**
   * Mangé depuis minuit. Absent sur les modèles SANS pesée : une Fresh Element Solo dit ce qu'elle
   * a versé, pas ce que l'animal a pris (vérifié sur la machine réelle le 21/09) — seuls les
   * modèles à plateau pesant le rapportent.
   */
  eatenToday: z.number().min(0).optional(),
  /** Quand tombe le prochain repas programmé, et combien. Absent = plus rien d'ici minuit. */
  nextMealAt: z.number().int().optional(),
  nextMealAmount: z.number().min(0).optional(),
  /** Jours qu'il reste au sachet dessiccant (capacité `consumables`). */
  desiccantDays: z.number().int().min(0).optional(),
  /**
   * Batterie de SECOURS (capacité `battery`) : la mangeoire vit sur secteur et ne tient sur pile
   * qu'une coupure. Absente = pas de pile en place, ce qui n'est pas une panne.
   */
  batteryPct: pct.optional(),
  errorMessage: z.string().optional(),
})

export const petFountainStateSchema = z.object({
  kind: z.literal('pet_fountain'), ...base,
  /** La pompe tourne. Seul champ obligatoire : c'est ce que l'interrupteur montre. */
  on: z.boolean(),
  mode: z.enum(PET_PUMP_MODES).optional(),
  /** Ce qu'il reste au filtre (capacité `consumables`), et en jours quand le fabricant l'estime. */
  filterPct: pct.optional(),
  filterDays: z.number().int().min(0).optional(),
  /** Le bac est vide, ou presque — l'alerte que le fabricant lève, pas un niveau mesuré. */
  waterLow: z.boolean().optional(),
  batteryPct: pct.optional(),
  /**
   * Ce que la fontaine sait de la journée (capacité `water_usage`). Une Eversweet Max ne mesure
   * PAS un volume — elle compte les PASSAGES et leur durée. Le volume reste là pour les modèles
   * qui le mesurent ; l'un ou l'autre peut manquer, jamais les deux ensemble sur une même machine.
   */
  drinksToday: z.number().int().min(0).optional(),
  /** Durée moyenne d'un passage, en secondes. */
  drinkAvgS: z.number().min(0).optional(),
  todayMl: z.number().min(0).optional(),
  errorMessage: z.string().optional(),
  /**
   * Quand ces valeurs ont été relevées SUR la fontaine. Indispensable ici et nulle part ailleurs :
   * une Eversweet n'a pas de Wi-Fi, elle est lue par relais Bluetooth au travers d'un appareil
   * voisin. Entre deux relais, le cloud rend la dernière synchro — parfois vieille de plusieurs
   * heures si le relais était hors de portée. Montrer l'âge vaut mieux que laisser croire au direct
   * (même raison que `readAt` d'un véhicule endormi). Absent = on ne sait pas dater le relevé.
   */
  syncedAt: z.number().int().optional(),
})

export const fanStateSchema = z.object({
  kind: z.literal('fan'), ...base,
  on: z.boolean(),
  /** Vitesse courante (capacité `fan_speed`) — valeurs acceptées dans `meta.fan.speeds`. */
  speed: z.number().int().positive().optional(),
  direction: z.enum(FAN_DIRECTIONS).optional(),
  /**
   * Minutes restantes sur la minuterie. 0 / absent = aucune. Effacée quand le ventilateur
   * s'éteint (mesuré sur le CREATE : éteindre remet `dp 64` à 0).
   */
  timerMin: z.number().int().min(0).optional(),
  /**
   * Bip d'accusé coupé (`true` = silencieux). Capacité `mute` — pas le son d'un lecteur
   * multimédia ; voir commentaire sur la capacité dans `kinds.ts`.
   */
  muted: z.boolean().optional(),
})

export const deviceStateSchema = z.discriminatedUnion('kind', [
  lightStateSchema, coverStateSchema, mediaPlayerStateSchema, climateStateSchema, vacuumStateSchema,
  mowerStateSchema, sensorStateSchema, energyStateSchema, evChargerStateSchema, vehicleStateSchema,
  cameraStateSchema, weatherStateSchema, waterStateSchema, petFeederStateSchema, petFountainStateSchema,
  fanStateSchema,
])
export type DeviceState = z.infer<typeof deviceStateSchema>
export type StateFor<K extends DeviceKind> = Extract<DeviceState, { kind: K }>
/** Patch émis par un plugin : tout est optionnel ; `kind`/`updatedAt` ne se patchent pas (distributif sur K). */
/**
 * Modification partielle d'un état, côté serveur uniquement (le client reçoit toujours l'état
 * entier). `undefined` = « je ne parle pas de ce champ » ; **`null` = « efface ce champ »**, et
 * n'est accepté que sur un champ déjà optionnel — c'est le seul moyen de repasser une valeur à
 * « inconnue ». Un plugin en a besoin : rappeler la position favorite d'un moteur unidirectionnel
 * le déplace vers une position qu'on ne connaît pas, donc celle qu'on affichait devient fausse.
 */
export type StatePatch<K extends DeviceKind = DeviceKind> = K extends DeviceKind
  ? { [P in keyof Omit<StateFor<K>, 'kind' | 'updatedAt'>]?: undefined extends StateFor<K>[P] ? StateFor<K>[P] | null : StateFor<K>[P] }
  : never

const STATE_KEYS = new Map<DeviceKind, ReadonlySet<string>>(
  deviceStateSchema.options.map((o) => [o.shape.kind.value as DeviceKind, new Set(Object.keys(o.shape))]),
)
/** Clés légales de l'état d'un kind (pour rejeter un patch qui ne le concerne pas). */
export function stateKeys(kind: DeviceKind): ReadonlySet<string> {
  return STATE_KEYS.get(kind) ?? new Set()
}
