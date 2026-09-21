import { z } from 'zod'

// Schémas des réponses PetKit. Volontairement LARGES, pour la raison déjà payée chez TaHoma puis
// MELCloud : un champ qu'on ne lit même pas suffit à faire échouer la réponse entière. Et le piège
// vérifié en zod 4.5 — `z.unknown()` ne rend PAS la clé facultative — impose `.optional()` partout.
//
// ATTENTION, ces schémas sont écrits AVANT toute capture, d'après des bibliothèques tierces qui ont
// reversé l'API de l'application mobile. Ils ne valident donc que de quoi ADRESSER un appareil et
// lire les quelques grandeurs du contrat. La route `GET /api/plugins/petkit/raw` existe pour que la
// première liaison remplace ces suppositions par du relevé — c'est la marche à suivre établie pour
// un plugin cloud dont le compte n'est pas encore lié (précédent Nest).

/** L'API répond en HTTP 200 même quand elle refuse : l'échec est dans `error`. */
export const petkitEnvelopeSchema = z.looseObject({
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.unknown().optional(), msg: z.unknown().optional() }).optional(),
})

/** `v1/regionservers` : les passerelles régionales, servies par `passport.petkt.com`. */
export const regionServersSchema = z.looseObject({
  list: z.array(z.looseObject({
    id: z.unknown().optional(),
    name: z.unknown().optional(),
    gateway: z.string().min(1),
    /** Code ISO du pays ; c'est lui qui relie « FR » à la passerelle européenne. */
    accountType: z.unknown().optional(),
  })).optional(),
})

/**
 * `user/login`. La session porte sa propre durée de vie : PetKit ne rend PAS de jeton de
 * renouvellement, donc `expiresIn` est le seul garde-fou — voir `auth.ts` pour ce que cela impose.
 */
export const loginSchema = z.looseObject({
  session: z.looseObject({
    id: z.string().min(1),
    /** Date ISO d'émission, avec fuseau. */
    createdAt: z.unknown().optional(),
    /** Durée de vie en SECONDES (de l'ordre de 36 h sur les comptes observés). */
    expiresIn: z.number().optional(),
    region: z.unknown().optional(),
    userId: z.unknown().optional(),
  }),
})

/**
 * Un appareil tel que l'inventaire le nomme. `type` est le code modèle (`d4`, `ctw3`…) et `id`
 * l'identifiant numérique. Les variantes `deviceId` / `deviceType` / `deviceName` sont acceptées
 * en plus : les deux implémentations tierces ne s'accordent pas sur l'orthographe, et rien ne dit
 * que tous les comptes répondent pareil.
 */
export const rosterDeviceSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  deviceId: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  deviceName: z.string().optional(),
  type: z.string().optional(),
  deviceType: z.string().optional(),
  groupId: z.union([z.number(), z.string()]).optional(),
  /**
   * Code NUMÉRIQUE du modèle (11 pour un `D4`, 24 pour une `Ctw3`). C'est LUI que les appels
   * Bluetooth attendent dans leur champ `type`, pas la chaîne : avec `"ctw3"`, `ble/connect`
   * répond « Vous n'avez pas de permission. (code 4) » — vérifié le 21/09.
   */
  deviceTypeId: z.union([z.number(), z.string()]).optional(),
  /** Adresse Bluetooth, indispensable pour ouvrir un relais vers une fontaine. */
  mac: z.string().optional(),
})

/**
 * Réponse de `discovery/device_roster_v2` pour UN groupe. `hasRelay` dit si ce groupe compte un
 * appareil capable de relayer du Bluetooth — l'information est donnée ici, gratuitement, alors
 * qu'on la redemande aussi à `ble/ownSupportBleDevices` juste avant d'ouvrir une liaison.
 */
export const rosterSchema = z.looseObject({
  devices: z.array(rosterDeviceSchema).optional(),
  hasRelay: z.boolean().optional(),
  /** Forme groupée, rencontrée sur certains comptes. */
  list: z.array(z.looseObject({
    devices: z.array(rosterDeviceSchema).optional(),
    groupId: z.union([z.number(), z.string()]).optional(),
  })).optional(),
})

/** `group/family/list` : les « familles » du compte, dont les identifiants pilotent le roster. */
export const familyListSchema = z.array(z.looseObject({
  groupId: z.union([z.number(), z.string()]).optional(),
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
}))

/**
 * État d'une mangeoire (`d4`), CAPTURÉ le 2026-09-21 sur la machine réelle. Ce qui a surpris :
 * `feedState` ne porte PAS `eatAmountTotal` sur ce modèle (pas de plateau pesant), mais il donne
 * le PRÉVU du jour (`planAmountTotal`) à côté du servi (`realAmountTotal`).
 */
export const feederDataSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  mac: z.string().optional(),
  /** Adresse Bluetooth de la mangeoire : c'est ELLE qui relaie vers la fontaine voisine. */
  btMac: z.string().optional(),
  /**
   * `factor` : **par combien diviser les quantités pour obtenir l'unité affichée**. La machine
   * réelle répond 10 — ses `amount` sont donc des DIXIÈMES DE TASSE, pas des grammes. C'est
   * l'appareil qui le dit ; le déduire du modèle serait une supposition de plus.
   */
  settings: z.looseObject({ factor: z.number().optional() }).optional(),
  /** Le plan de repas, une entrée par jour de la semaine (`repeats` = 1 lundi … 7 dimanche). */
  multiFeedItem: z.looseObject({
    feedDailyList: z.array(z.looseObject({
      repeats: z.union([z.number(), z.string()]).optional(),
      suspended: z.number().optional(),
      items: z.array(z.looseObject({
        /** Heure du repas, en SECONDES depuis minuit (68400 = 19 h). */
        time: z.number().optional(),
        amount: z.number().optional(),
        name: z.string().optional(),
      })).optional(),
    })).optional(),
  }).optional(),
  state: z.looseObject({
    /** 1 = il reste des croquettes, 0 = trémie vide. Vérifié : la machine garnie répond 1. */
    food: z.number().optional(),
    batteryPower: z.number().optional(),
    batteryStatus: z.number().optional(),
    desiccantLeftDays: z.number().optional(),
    feeding: z.number().optional(),
    errorCode: z.string().optional(),
    errorMsg: z.string().optional(),
    feedState: z.looseObject({
      /** Grammes réellement versés depuis minuit. */
      realAmountTotal: z.number().optional(),
      /** Grammes que le plan du jour prévoit EN TOUT (50 g relevés pour deux repas). */
      planAmountTotal: z.number().optional(),
      /** Présent seulement sur les modèles à plateau pesant ; absent d'un `d4`. */
      eatAmountTotal: z.number().optional(),
      addAmountTotal: z.number().optional(),
    }).optional(),
  }).optional(),
})

/**
 * État d'une fontaine Bluetooth (`ctw3`), CAPTURÉ le 2026-09-21. Trois surprises :
 *
 *  - la marche de la pompe est dans `status.powerStatus`, PAS au premier niveau ;
 *  - **`-1` est une sentinelle « inconnu »**, pas une valeur : `todayCleanWater`, `filterExpectedDays`
 *    et `waterPumpRunTime` valaient tous -1 sur la machine réelle. Les prendre au pied de la lettre
 *    afficherait « 0 mL bus » et « 0 jour de filtre » — deux mensonges (même piège que la sonde
 *    absente à -39 de MELCloud) ;
 *  - ces valeurs datent du dernier relais Bluetooth (`syncTime`), pas de l'instant.
 */
export const fountainDataSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  mac: z.string().optional(),
  /** 1 = continu, 2 = à l'approche. La machine réelle, réglée « intelligent », répond 2. */
  mode: z.number().optional(),
  status: z.looseObject({
    /** 1 = la pompe est alimentée. */
    powerStatus: z.number().optional(),
    suspendStatus: z.number().optional(),
    runStatus: z.number().optional(),
  }).optional(),
  filterPercent: z.number().optional(),
  filterExpectedDays: z.number().optional(),
  filterWarning: z.number().optional(),
  lackWarning: z.number().optional(),
  breakdownWarning: z.number().optional(),
  lowBattery: z.number().optional(),
  electricity: z.looseObject({ batteryPercent: z.number().optional() }).optional(),
  /** Eau distribuée du jour. -1 = la machine ne la compte pas. Unité supposée : millilitres. */
  todayCleanWater: z.number().optional(),
  syncTime: z.string().optional(),
  updateAt: z.string().optional(),
})

/**
 * `ble/ownSupportBleDevices` : les appareils Wi-Fi capables de relayer, pour un groupe donné.
 * **`pim` dit s'ils sont EN LIGNE** — un relais listé mais débranché ne relaiera rien.
 */
export const bleRelaysSchema = z.array(z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  typeId: z.union([z.number(), z.string()]).optional(),
  pim: z.number().optional(),
}))

export type RosterDevice = z.infer<typeof rosterDeviceSchema>
export type FeederData = z.infer<typeof feederDataSchema>
export type FountainData = z.infer<typeof fountainDataSchema>

/**
 * `<type>/getWorkRecord` : les PASSAGES de l'animal à la fontaine, un par visite. C'est ce que
 * l'appli du fabricant affiche en « L'eau potable d'aujourd'hui : 6 fois » et en durée moyenne —
 * une Eversweet Max ne mesure aucun volume, elle compte des venues.
 */
export const workRecordSchema = z.array(z.looseObject({
  /** Instant de la visite (secondes epoch). */
  workTime: z.number().optional(),
  /** Secondes depuis minuit. */
  dayTime: z.number().optional(),
  /** Combien de temps l'animal est resté, en secondes. */
  stayTime: z.number().optional(),
}))
