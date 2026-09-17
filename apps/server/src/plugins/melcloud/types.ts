import { z } from 'zod'

// Schémas des réponses MELCloud. Volontairement LARGES : rien de ce qu'on ne lit pas n'est
// contraint (`z.unknown()`), parce qu'un champ inutile mal typé suffit à faire échouer une réponse
// entière — la leçon coûteuse du plugin TaHoma (`doc/3_plugins/3_2_ecrire-un-plugin.md`).
//
// Piège vérifié ici (zod 4.5) : `z.unknown()` ne rend PAS la clé facultative. Un champ qu'on ne lit
// pas mais que le fabricant n'envoie pas toujours (`Expiry`, `Device`) fait alors échouer la réponse
// entière — le symptôme exact que la page « Écrire un plugin » attribue aux schémas trop serrés, et
// qui s'obtient ici en croyant justement les avoir relâchés. D'où `.optional()` partout.
//
// Ces schémas ont été écrits AVANT la capture, d'après la documentation communautaire, et c'est
// pourquoi ils ne valident presque rien : ils n'ont à reconnaître qu'une chose, de quoi ADRESSER un
// appareil. La capture est arrivée depuis (`__fixtures__/melcloud.ts`) et c'est elle qui porte le
// mappage (`mapping.ts`) ; ces schémas-ci n'ont pas eu à se resserrer pour autant — un schéma large
// sur ce qu'on ne lit pas reste la bonne réponse, une autre installation ne répondra pas pareil.

/**
 * Réponse de `Login/ClientLogin`. Piège central, le même que Gigya chez Renault : **MELCloud
 * répond toujours en HTTP 200**. Un mot de passe faux arrive en 200 avec un `ErrorId` non nul, et
 * un client qui ne regarde que le statut croit avoir réussi à chaque fois.
 */
export const melcloudLoginSchema = z.looseObject({
  /** `null` = succès. Un nombre = refus (1 : identifiants invalides). */
  ErrorId: z.unknown().optional(),
  LoginData: z.looseObject({
    /** La clé de session, à passer en en-tête `X-MitsContextKey` sur tous les appels suivants. */
    ContextKey: z.string().min(1),
    /** Nom du compte, seulement pour l'afficher dans les Réglages. */
    Name: z.unknown().optional(),
    Expiry: z.unknown().optional(),
  }).nullish(),
})

/**
 * Un appareil, tel qu'il apparaît dans la structure d'un bâtiment de `User/ListDevices`.
 *
 * Seuls trois champs sont contraints, ceux dont on a besoin pour ADRESSER l'appareil : MELCloud
 * range les appareils à quatre profondeurs différentes selon l'installation (`Structure.Devices`,
 * `Structure.Areas[].Devices`, `Structure.Floors[].Devices`, `Structure.Floors[].Areas[].Devices`),
 * et on ne sait pas encore laquelle vos machines empruntent. `mapping.ts` les cherche donc par leur
 * forme plutôt que par leur chemin.
 */
export const listedDeviceSchema = z.looseObject({
  DeviceID: z.union([z.number(), z.string()]),
  BuildingID: z.union([z.number(), z.string()]).optional(),
  DeviceName: z.unknown().optional(),
  /**
   * `Device` porte TOUT l'état : 210 champs sur la machine capturée, contre 42 pour `Device/Get`.
   * C'est la raison pour laquelle le sondage lit `ListDevices` et jamais `Device/Get` — la lecture
   * détaillée est la PLUS PAUVRE des deux, à l'inverse de ce que son nom laisse croire, et elle
   * coûte un appel par machine là où celle-ci les rend toutes d'un coup.
   */
  Device: z.unknown().optional(),
})
export type ListedDevice = z.infer<typeof listedDeviceSchema>

/**
 * Familles d'appareils MELCloud. Une Ecodan Zubadan est un **ATW** (air-eau) : zones de chauffage,
 * ballon, températures de départ et de retour — et non un split, qui serait un ATA.
 */
export const DEVICE_TYPES: Record<number, 'ata' | 'atw' | 'erv'> = { 0: 'ata', 1: 'atw', 3: 'erv' }

/** Ce qu'on retient d'un appareil pour l'adresser et le nommer. Le reste attend la capture. */
export interface DeviceLink {
  /** `DeviceID` en chaîne : c'est l'`externalId`, stable, sans `:` ni espace. */
  deviceId: string
  /** Exigé en paramètre par `Device/Get` : sans lui, pas de lecture. */
  buildingId: string
  /** Nom du bâtiment qui le porte, pour s'y retrouver quand il y a plusieurs machines. */
  buildingName: string | null
  name: string
  /** `'atw'` pour une Ecodan. `null` = MELCloud ne l'a pas dit. */
  family: 'ata' | 'atw' | 'erv' | null
  deviceType: number | null
  /**
   * Tout ce que `ListDevices` dit de cette machine, MIS À PLAT : l'enveloppe puis le sous-objet
   * `Device`, qui gagne en cas de conflit. Les deux niveaux portent des champs utiles et aucun ne
   * se suffit — les bornes de consigne (`MinTemperature`, `MaxTemperature`) sont dans l'enveloppe,
   * l'état de la machine dans `Device` —, et les joindre ici évite à tout le reste du plugin de
   * savoir lequel des deux consulter.
   */
  fields: Record<string, unknown>
}

/**
 * L'état d'une ZONE de chauffage, une fois décidé sur quoi elle se règle. Une Ecodan air-eau pilote
 * chaque zone soit sur l'air de la pièce, soit sur la température de l'eau de départ — et les deux
 * couples de champs MELCloud n'ont rien à voir.
 */
export interface ZoneReading {
  zone: 1 | 2
  /** `room` : consigne et mesure d'ambiance. `flow` : consigne et mesure d'eau de départ. */
  control: 'room' | 'flow'
  currentTempC: number | null
  targetTempC: number | null
  /** La zone chauffe-t-elle en ce moment, ou attend-elle ? */
  idle: boolean
  heating: boolean
  cooling: boolean
  /** Bornes de la consigne, qui ne sont PAS les mêmes selon `control` (ambiante vs départ). */
  bounds: [number, number] | null
  name: string | null
}

/**
 * L'état de la MACHINE, par opposition à celui des zones : ce qu'on regarde pour savoir si elle
 * tourne, ce qu'elle fait, et si elle va mal. Servi à la vue Chauffage, pas publié comme appareil —
 * une douzaine de capteurs pour des valeurs qu'on ne consulte qu'à un seul endroit encombrerait
 * l'inventaire, la recherche et la scène 3D pour rien.
 */
export interface SystemReading {
  deviceId: string
  name: string
  power: boolean
  /**
   * Ce que le FABRICANT prétend. À ne pas confondre avec joignable : relevé sur la vraie machine,
   * `Offline` passe à vrai alors que l'horodatage avance chaque minute, que `WifiAdapterStatus` dit
   * `NORMAL` et qu'aucune erreur n'est signalée. Gardé pour le diagnostic, jamais pour décider.
   */
  offline: boolean
  /** La vraie question : la dernière remontée est-elle encore fraîche ? C'est `stale` qui décide. */
  stale: boolean
  outdoorTempC: number | null
  flowTempC: number | null
  returnTempC: number | null
  condensingTempC: number | null
  /** Ce que le régulateur demande à la machine, en pourcentage. */
  demandPercent: number | null
  defrosting: boolean
  /** Appoints électriques : ils coûtent cher, les voir tourner est le genre de chose qu'on veut savoir. */
  boosterHeater: boolean
  immersionHeater: boolean
  /** Les quatre circulateurs, dans l'ordre où MELCloud les numérote. */
  pumps: boolean[]
  valve3Way: boolean
  /** `ErrorCode` VAUT 8000 QUAND TOUT VA BIEN : `hasError` est la seule lecture fiable. */
  error: { hasError: boolean; code: number | null; message: string | null }
  /**
   * Quand la machine a parlé au cloud pour la dernière fois, en MILLISECONDES EPOCH et non en
   * chaîne. Deux raisons, toutes deux mesurées sur la vraie machine :
   *
   *  - le champ n'est pas le même selon la lecture : `LastTimeStamp` dans `ListDevices` (celle
   *    qu'on sonde), `LastCommunication` dans `Device/Get` ;
   *  - et ils n'ont PAS la même base de temps. `LastTimeStamp` est en heure LOCALE, écrite sans
   *    fuseau ; `LastCommunication` est en UTC, écrite sans fuseau elle aussi. Les rendre tels
   *    quels laisserait l'affichage se tromper de deux heures selon la route utilisée — le piège
   *    déjà rencontré chez Husqvarna. Résolu ici, une fois, plutôt que chez chaque lecteur.
   */
  lastSeen: number | null
  /** `NORMAL` quand le module Wi-Fi va bien : c'est ce qui distingue une machine muette d'un réseau muet. */
  wifi: string | null
  /**
   * La machine a-t-elle un compteur d'énergie ? `false` sur l'installation de référence, et c'est
   * ce qui autorise la vue à ne pas afficher une section de consommation vide plutôt qu'une pleine
   * de zéros (les relevés d'un hiver entier sont revenus à zéro).
   */
  energyMeter: boolean
}
