// Capture du 2026-09-14 sur le vrai compte : une Renault 5 E-Tech (`R5E1VE`, mise en circulation
// le 2024-06-03), branchée au garage sans courant délivré. ANONYMISÉE — VIN, plaque, identifiants
// de compte et position ont été remplacés ; TOUT LE RESTE est ce que Renault a répondu, bizarreries
// comprises. Ne pas « corriger » ces formes : c'est justement leur intérêt.
//
// Les bizarreries qu'il faut garder :
//  1. `cockpit` en v2 répond un HTTP 200 SANS DONNÉES et avec une blague dedans. C'est la v1 qui
//     porte le kilométrage. Un client qui se fie au statut HTTP croit avoir lu quelque chose.
//  2. `chargingStatus` est un FLOTTANT énuméré, pas un booléen : 0.3 = en attente, 1.0 = en charge.
//  3. Les lectures refusées le sont de DEUX façons — 403 `err.func.wired.forbidden` pour
//     `charging-settings` et `charge-mode`, 404 `err.func.wired.notFound` pour `lock-status`,
//     `pressure` et `res-state`. Traiter seulement le 403 laisserait trois lectures se répéter.
//  4. `hvac-status` donne la température INTÉRIEURE (`internalTemperature`), pas l'extérieure.
//  5. Pas de puissance de charge instantanée, pas de cap, pas de pression de pneus, pas de vitesse.

export const VIN = 'VYSP0100000000001'
export const ACCOUNT_ID = '00000000-1111-2222-3333-444444444444'
export const PERSON_ID = '55555555-6666-7777-8888-999999999999'

/** Deux comptes Kamereon pour une seule personne : les services connectés, et la fiche CRM. */
export const PERSON = {
  accounts: [
    { accountId: ACCOUNT_ID, accountType: 'MYRENAULT', accountStatus: 'ACTIVE' },
    { accountId: '99999999-8888-7777-6666-555555555555', accountType: 'SFDC', accountStatus: 'ACTIVE' },
  ],
}

/** La liste des véhicules. `vehicleDetails` est une fiche technique : AUCUN surnom nulle part. */
export const VEHICLES = {
  vehicleLinks: [{
    vin: VIN,
    status: 'ACTIVE',
    linkType: 'OWNER',
    brand: 'RENAULT',
    garageBrand: 'RENAULT',
    vehicleDetails: {
      vin: VIN,
      registrationNumber: 'AA123BB',
      brand: { label: 'RENAULT' },
      model: { code: 'R5E1VE', label: 'RENAULT 5', group: '971' },
      energy: { code: 'ELECX', label: 'ELECTRICITY', group: '019' },
      registrationDate: '2024-06-03',
      firstRegistrationDate: '2024-06-03',
      engineType: '6AK',
      modelSCR: 'R5E',
      deliveryCountry: { code: 'FR', label: 'FRANCE' },
      tcu: { code: 'AIVCT', label: 'WITH AIVC CONNECTION UNIT', group: 'E70' },
      battery: { code: 'BTGAE', label: 'BATTERY BTGAE', group: '968' },
      radioType: { code: 'NA498', label: 'IVI2 FULL10 PREM DAB', group: '425' },
      registrationCountry: { code: 'FR' },
      navigationAssistanceLevel: {},
    },
    connectedDriver: { role: 'MAIN_DRIVER', createdDate: '2024-06-20T08:00:00.000000Z' },
  }],
}

/**
 * Branchée, EN ATTENTE, rien qui coule : `plugStatus: 1` et `chargingStatus: 0.3`. C'est l'état que
 * produit une borne pilotée par le surplus solaire quand la production ne suffit pas — et c'est
 * aussi celui où la R5 reste coincée après une coupure.
 */
export const BATTERY_WAITING = {
  data: {
    id: VIN,
    attributes: {
      timestamp: '2026-09-14T08:19:43Z',
      batteryLevel: 58,
      batteryAutonomy: 218,
      V2L_SystemStatusDisplay: 0,
      plugStatus: 1,
      chargingStatus: 0.3,
      chargingRemainingTime: 19,
      chargingRemainingTimeLastUpdateDateTime: '2026-09-12T14:56:38Z',
    },
  },
}

/** La même en charge (`chargingStatus: 1.0`), pour distinguer les deux dans les tests. */
export const BATTERY_CHARGING = {
  data: {
    id: VIN,
    attributes: { ...BATTERY_WAITING.data.attributes, batteryLevel: 61, batteryAutonomy: 229, chargingStatus: 1.0 },
  },
}

/** Débranchée, pas en charge. */
export const BATTERY_UNPLUGGED = {
  data: {
    id: VIN,
    attributes: { timestamp: '2026-09-14T08:19:43Z', batteryLevel: 58, batteryAutonomy: 218, plugStatus: 0, chargingStatus: 0.0 },
  },
}

/** `cockpit` en v1 : le kilométrage. `fuelQuantity: 0` sur une électrique. */
export const COCKPIT_V1 = {
  data: { id: VIN, attributes: { fuelQuantity: 0, totalMileage: 12500, timestamp: '2026-09-14T08:18:31Z' } },
}

/**
 * `cockpit` en v2, TEL QUEL : HTTP 200, pas de `data`, et un mot d'esprit à la place. Le mappage
 * doit en sortir sans kilométrage plutôt qu'avec un zéro.
 */
export const COCKPIT_V2_EASTER_EGG = { message: 'you should not be there but well done for the effort' }

export const LOCATION = {
  data: { id: VIN, attributes: { lastUpdateTime: '2026-09-14T08:18:31Z', gpsLatitude: 47.32, gpsLongitude: 5.04 } },
}

/** `internalTemperature` : l'INTÉRIEUR de l'habitacle (voiture au soleil ce jour-là). */
export const HVAC_STATUS = {
  data: { id: VIN, attributes: { internalTemperature: 37, hvacStatus: 'off', socThreshold: 15, lastUpdateTime: '2026-09-14T08:19:09Z' } },
}

/** Réglages VE (`kcm`) : pas d'enveloppe `data`, les champs sont à la racine. */
export const SOC_LEVELS = { lastEnergyUpdateTimestamp: '2026-09-11T09:08:37Z', socMin: 20, socTarget: 80 }

/**
 * Les réglages de charge, tels qu'ils sont. C'est la charge utile qu'un futur « réveil » devra
 * REJOUER À L'IDENTIQUE (seul l'horodatage change) : les valeurs codées en dur par d'autres outils
 * écraseraient l'heure de départ, la durée et la température choisies par l'utilisateur.
 */
export const EV_SETTINGS = {
  lastSettingsUpdateTimestamp: '2026-09-06T12:08:10.89632Z',
  delegatedActivated: false,
  chargeModeRq: 'SCHEDULED',
  chargeTimeStart: '12:00',
  chargeDuration: 420,
  preconditioningTemperature: 21,
  preconditioningHeatedStrgWheel: false,
  preconditioningHeatedRightSeat: false,
  preconditioningHeatedLeftSeat: false,
  programs: [{
    programActivationStatus: false,
    programType: 'CHARGE',
    programDepartureTime: '20:00:00',
    programActivationMonday: true,
    programActivationTuesday: true,
    programActivationWednesday: true,
    programActivationThursday: true,
    programActivationFriday: true,
    programActivationSaturday: true,
    programActivationSunday: true,
  }],
}

/**
 * Les deux refus, avec les codes CONSTATÉS. Seul `errorCode` a été capturé tel quel ; le libellé
 * est reconstitué, il n'est lu par personne.
 */
export const FORBIDDEN = { errors: [{ errorCode: 'err.func.wired.forbidden', errorMessage: 'The access is forbidden' }] }
export const NOT_FOUND = { errors: [{ errorCode: 'err.func.wired.notFound', errorMessage: 'Not found' }] }
