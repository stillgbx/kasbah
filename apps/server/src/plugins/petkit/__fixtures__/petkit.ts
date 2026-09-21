// Fixtures PetKit — **CAPTURÉES SUR LE VRAI COMPTE le 2026-09-21**, puis anonymisées (adresses
// matérielles, numéros de série, secrets, identifiant d'utilisateur et nom du réseau Wi-Fi
// remplacés ; identifiants d'appareil et noms donnés par l'utilisateur conservés, ils ne révèlent
// rien et rendent les tests lisibles).
//
// Elles remplacent des fixtures INVENTÉES d'après des bibliothèques tierces, qui se sont trompées
// sur six points — chacun aurait produit un affichage faux :
//
//  1. le roster ne porte NI nom NI adresse Bluetooth, seulement `id` et `type` (en casse mixte) ;
//  2. une fontaine ne répond pas sur `device_detail` (404) mais sur `deviceData` ;
//  3. la marche de la pompe est dans `status.powerStatus`, pas au premier niveau ;
//  4. **`-1` est une sentinelle « non compté »** : la fontaine réelle rend -1 pour l'eau du jour,
//     les jours de filtre et le temps de pompe. Les lire comme des zéros afficherait « 0 mL bus »
//     et « 0 jour de filtre » ;
//  5. les quantités de la mangeoire ne sont PAS des grammes : `settings.factor: 10` dit qu'elles
//     comptent en dixièmes de tasse — « 30 g » affiché valait en réalité 0,3 tasse ;
//  6. la fontaine ne mesure aucun volume mais tient le REGISTRE DE SES VISITES (`getWorkRecord`).
//
// C'est exactement la leçon que le wiki tire de TaHoma et de COMAP : une fixture écrite d'après la
// documentation valide ce que l'appareil ne fait pas.

/** Les « familles » du compte : un seul foyer. */
export const FAMILIES = [{ groupId: 300000001, name: 'Maison' }]

/**
 * Inventaire d'un groupe (`discovery/device_roster_v2`, exige `day` et `groupId`). Le `type` arrive
 * en CASSE MIXTE (`D4`, `Ctw3`) : il faut le normaliser avant toute comparaison.
 */
export const ROSTER = {
  hasRelay: true,
  devices: [
    { type: 'D4', id: 400000004, shared: 0, groupId: 300000001, deviceTypeId: 11, deviceTypeAndId: '11_400000004' },
    { type: 'Ctw3', id: 400000002, shared: 0, groupId: 300000001, deviceTypeId: 24, deviceTypeAndId: '24_400000002' },
    { type: 'D4', id: 400000003, shared: 0, groupId: 300000001, deviceTypeId: 11, deviceTypeAndId: '11_400000003' },
    { type: 'Ctw3', id: 400000001, shared: 0, groupId: 300000001, deviceTypeId: 24, deviceTypeAndId: '24_400000001' },
  ],
}

/**
 * Mangeoire Fresh Element Solo (`d4/device_detail`). Ce que la capture apprend :
 *  - `food: 1` = il reste des croquettes (la trémie était garnie) ;
 *  - `feedState` donne le SERVI (`realAmountTotal`) et le PRÉVU du jour (`planAmountTotal`), mais
 *    **pas `eatAmountTotal`** : sans plateau pesant, ce modèle ignore ce qui a été mangé ;
 *  - `batteryPower: 0` sur une machine au secteur SANS piles — ce n'est pas une batterie à plat ;
 *  - `desiccantLeftDays: 0` : le sachet n'a jamais été réarmé, la valeur est vraie.
 */
export const FEEDER_DETAIL = {
  id: 400000004,
  mac: 'aabbccdd0001',
  btMac: 'aabbccdd0002',
  sn: 'SN-ANONYMISE-1',
  name: 'Distributeur 1',
  hardware: 1,
  firmware: 1,
  typeCode: 1,
  familyId: 300000001,
  locale: 'Europe/Paris',
  // `factor: 10` = les `amount` sont des DIXIÈMES DE TASSE. C'est la machine qui le déclare.
  settings: { factor: 10, feedNotify: 0, foodNotify: 1 },
  // Le plan de la semaine : sept listes identiques ici, `repeats` 1 = lundi … 7 = dimanche.
  multiFeedItem: {
    feedDailyList: Array.from({ length: 7 }, (_, i) => ({
      suspended: 0, repeats: i + 1,
      items: [
        { id: '3600', time: 3600, amount: 30, name: 'Goûter du soir' },
        { id: '68400', time: 68400, amount: 20, name: 'Dîner' },
      ],
    })),
    isExecuted: 1,
  },
  state: {
    wifi: { ssid: 'RESEAU', bssid: 'aabbccdd0003', rsq: -63 },
    pim: 1, ota: 0, overall: 1,
    batteryStatus: 0, runtime: 0, batteryPower: 0,
    food: 1,
    feedState: {
      realAmountTotal: 30, planAmountTotal: 50, addAmountTotal: 0, planRealAmountTotal: 30,
      times: 1, feedTimes: { 3600: 1, 68400: 3 },
    },
    desiccantLeftDays: 0, door: 0, feeding: 0, desiccantTime: 0,
  },
}

/**
 * Fontaine Eversweet Max (`ctw3/deviceData`). Filtre à bout (`filterPercent: 0`,
 * `filterWarning: 1`), pompe alimentée en cycle INTERMITTENT (`mode: 2`), batterie pleine, et TROIS
 * grandeurs à -1 que le modèle ne compte pas.
 */
export const FOUNTAIN_DETAIL = {
  id: 400000002,
  mac: 'aabbccdd0004',
  secret: 'SECRET-ANONYMISE',
  userId: '000000000',
  sn: 'SN-ANONYMISE-2',
  name: 'Fontaine 1',
  hardware: 1,
  firmware: 111,
  typeCode: 1,
  mode: 2,
  status: { powerStatus: 1, suspendStatus: 1, runStatus: 0, detectStatus: 0, electricStatus: 2 },
  breakdownWarning: 0,
  filterWarning: 1,
  lackWarning: 0,
  lowBattery: 0,
  electricity: { supplyVoltage: 5096, batteryVoltage: 4164, batteryPercent: 100 },
  isNightNoDisturbing: 0,
  waterPumpRunTime: -1,
  filterPercent: 0,
  todayPumpRunTime: 15638,
  todayCleanWater: -1,
  todayUseElectricity: 0,
  expectedCleanWater: -1,
  expectedUseElectricity: -1,
  filterExpectedDays: -1,
  recordAutomaticAddWater: 0,
  syncTime: '2026-09-21T06:35:36.860+0000',
  updateAt: '2026-09-21T06:35:36.251+0000',
  familyId: 300000001,
  moduleStatus: 0,
  locale: 'Europe/Paris',
}

/**
 * `ctw3/getWorkRecord` : les passages du jour. Deux venues relevées, de 30 s et 21 s. C'est tout ce
 * qu'une Eversweet Max sait dire de la consommation — pas un millilitre.
 */
export const WORK_RECORD = [
  { workTime: 1789959912, dayTime: 18312, stayTime: 30 },
  { workTime: 1789943759, dayTime: 2159, stayTime: 21 },
]
