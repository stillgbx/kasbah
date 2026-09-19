import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ID, BATTERY_CHARGING, BATTERY_CHARGING_LIAR, BATTERY_UNPLUGGED, BATTERY_WAITING, COCKPIT_V1, COCKPIT_V2_EASTER_EGG,
  EV_SETTINGS, HVAC_STATUS, LOCATION, PERSON, SOC_LEVELS, VEHICLES, VIN,
} from './__fixtures__/kamereon'
import { commandSummary, inWindow, socTargetPayload, toAccounts, toDescriptor, toStatePatch, toVehicleLinks, vehicleName, wakePayload } from './mapping'

// Tout ce fichier travaille sur la CAPTURE du 2026-09-14, pas sur la documentation. Trois pièges
// que seule la capture révèle sont testés nommément : le `cockpit` v2 farceur, le flottant de
// `chargingStatus`, et le fait qu'aucune valeur manquante ne doit devenir un zéro.

const NOW = Date.UTC(2026, 8, 14, 10, 30)

describe('comptes et véhicules', () => {
  it('retient le compte de services connectés, pas la fiche CRM', () => {
    const accounts = toAccounts(PERSON)
    expect(accounts).toHaveLength(2)
    // le choix du MYRENAULT se fait dans le plugin ; ici on vérifie que les deux remontent bien
    expect(accounts.map((a) => a.accountType)).toEqual(['MYRENAULT', 'SFDC'])
    expect(accounts[0]!.accountId).toBe(ACCOUNT_ID)
  })

  it('publie un appareil par VIN, nommé par sa plaque', () => {
    const links = toVehicleLinks(VEHICLES)
    expect(links).toHaveLength(1)
    const d = toDescriptor(links[0]!)
    expect(d).toMatchObject({ id: `renault:${VIN}`, externalId: VIN, kind: 'vehicle', name: 'AA123BB' })
    // aucune capacité de commande en phase 1 : l'UI ne propose rien que le plugin refuserait
    expect(d.capabilities).toEqual(['soc', 'range', 'location', 'charge_limit'])
  })

  it('lit la teinte dans la référence de configuration, et ne devine jamais', () => {
    const links = toVehicleLinks(VEHICLES)
    expect(toDescriptor(links[0]!).meta.vehicle?.color).toBe('#14171a')       // TEGNE = Noir Étoilé

    // Un code de peinture qu'aucune voiture réelle n'a confirmé ne publie RIEN : la scène retombe
    // sur sa couleur de thème, et l'utilisateur tranche. Mieux vaut rien qu'une couleur inventée.
    const inconnu = { vin: VIN, vehicleDetails: { assets: [{ assetType: 'PICTURE', renditions: [{ url: 'https://3dv.renault.com/x?configuration=PAVEH%2FTEZZZ%2FMET05' }] }] } }
    expect(toDescriptor(inconnu).meta.vehicle).toBeUndefined()

    // Contrat de services expiré : ni `vehicleDetails`, ni images, ni couleur — et surtout pas de plantage.
    expect(toDescriptor({ vin: VIN }).meta.vehicle).toBeUndefined()
  })

  it('retombe sur le modèle puis le VIN quand la plaque manque', () => {
    expect(vehicleName({ vin: VIN, vehicleDetails: { brand: { label: 'RENAULT' }, model: { label: 'RENAULT 5' } } }))
      .toBe('RENAULT RENAULT 5')
    expect(vehicleName({ vin: VIN })).toBe(VIN)
  })

  it('ignore un véhicule illisible sans perdre les autres', () => {
    const links = toVehicleLinks({ vehicleLinks: [{ pasDeVin: true }, VEHICLES.vehicleLinks[0]] })
    expect(links).toHaveLength(1)
    expect(links[0]!.vin).toBe(VIN)
  })
})

describe('lectures → état', () => {
  it('mappe un tour complet', () => {
    const patch = toStatePatch(
      { battery: BATTERY_WAITING, cockpit: COCKPIT_V1, location: LOCATION, hvac: HVAC_STATUS, socLevels: SOC_LEVELS },
      NOW,
    )
    expect(patch).toEqual({
      // l'heure où la VOITURE a parlé, pas celle de notre appel
      readAt: Date.parse('2026-09-14T08:19:43Z'),
      soc: 58,
      rangeKm: 218,
      pluggedIn: true,
      charging: false,
      odometerKm: 12500,
      location: { lat: 47.32, lon: 5.04, at: Date.parse('2026-09-14T08:18:31Z') },
      insideTempC: 37,
      chargeLimit: 80,
      socMin: 20,
      // la voiture n'est pas en charge : le temps restant qu'elle traîne depuis l'avant-veille est EFFACÉ
      chargeMinutesRemaining: null,
    })
  })

  it('branchée mais EN ATTENTE n’est pas « en charge » (chargingStatus 0.3)', () => {
    const patch = toStatePatch({ battery: BATTERY_WAITING }, NOW)
    expect(patch.pluggedIn).toBe(true)
    expect(patch.charging).toBe(false)
  })

  it('reconnaît la charge en cours (chargingStatus 1.0, et elle seule)', () => {
    expect(toStatePatch({ battery: BATTERY_CHARGING }, NOW).charging).toBe(true)
    expect(toStatePatch({ battery: BATTERY_UNPLUGGED }, NOW)).toMatchObject({ pluggedIn: false, charging: false })
  })

  /**
   * Le 2026-09-19, la voiture a servi des heures durant un `0.3` (« en attente de courant ») alors
   * qu'elle avalait 5,5 kW. Deux champs de la MÊME trame la démentaient — d'où la règle du second
   * témoin. Sans elle, l'UI ment et le réveil de charge secoue une voiture déjà en charge.
   */
  it('démasque un `chargingStatus` menteur grâce au temps restant daté de la trame', () => {
    const patch = toStatePatch({ battery: BATTERY_CHARGING_LIAR }, NOW)
    expect(patch.charging).toBe(true)
    expect(patch.chargeMinutesRemaining).toBe(52)

    // le même corps, mais le temps restant TRAÎNE d'une trame précédente : on ne crie pas au loup
    const attrs = { ...BATTERY_CHARGING_LIAR.data.attributes, chargingRemainingTimeLastUpdateDateTime: '2026-09-17T14:45:35Z' }
    const stale = toStatePatch({ battery: { data: { id: 'VF1', attributes: attrs } } }, NOW)
    expect(stale.charging).toBe(false)
    expect(stale.chargeMinutesRemaining).toBeNull()
  })

  it('ne retient le temps de charge restant QUE pendant la charge', () => {
    expect(toStatePatch({ battery: BATTERY_CHARGING }, NOW).chargeMinutesRemaining).toBe(43)
    expect(toStatePatch({ battery: BATTERY_UNPLUGGED }, NOW).chargeMinutesRemaining).toBeNull()
  })

  it('survit au cockpit v2 farceur : pas de kilométrage plutôt qu’un zéro', () => {
    const patch = toStatePatch({ battery: BATTERY_WAITING, cockpit: COCKPIT_V2_EASTER_EGG }, NOW)
    expect(patch.odometerKm).toBeUndefined()
    expect(patch.soc).toBe(58)                    // le reste du tour n'en souffre pas
  })

  it('date l’état de la VOITURE, pas de notre appel — et retombe sur le nôtre sans batterie', () => {
    // Kamereon rend le dernier état remonté : sur une voiture qui dort, il a des heures. Dater du
    // moment de l'appel ferait dire à l'UI « lu il y a 4 min » sur des chiffres de la mi-journée.
    expect(toStatePatch({ battery: BATTERY_WAITING }, NOW).readAt).toBe(Date.parse('2026-09-14T08:19:43Z'))
    expect(toStatePatch({}, NOW).readAt).toBe(NOW)
  })

  it('n’invente jamais un zéro quand une lecture manque', () => {
    const patch = toStatePatch({}, NOW)
    expect(patch).toEqual({ readAt: NOW })
    for (const k of ['soc', 'rangeKm', 'pluggedIn', 'charging', 'odometerKm', 'location', 'insideTempC', 'chargeLimit']) {
      expect(patch).not.toHaveProperty(k)
    }
  })

  it('ne publie rien que la R5 ne donne pas', () => {
    const patch = toStatePatch(
      { battery: BATTERY_WAITING, cockpit: COCKPIT_V1, location: LOCATION, hvac: HVAC_STATUS, socLevels: SOC_LEVELS },
      NOW,
    )
    for (const k of ['locked', 'chargePowerW', 'headingDeg', 'tirePressureBar', 'speedKmh', 'gear', 'outsideTempC', 'sleepState']) {
      expect(patch).not.toHaveProperty(k)
    }
  })

  it('date la position de la lecture quand Renault ne la date pas', () => {
    const patch = toStatePatch({ location: { data: { attributes: { gpsLatitude: 47.32, gpsLongitude: 5.04 } } } }, NOW)
    expect(patch.location).toEqual({ lat: 47.32, lon: 5.04, at: NOW })
  })
})

describe('cible de charge', () => {
  it('ne change QUE la cible : le plancher est le réglage de l’utilisateur', () => {
    const body = socTargetPayload(SOC_LEVELS, 70, NOW)!
    expect(body.socTarget).toBe(70)
    expect(body.socMin).toBe(SOC_LEVELS.socMin)
    expect(body.lastEnergyUpdateTimestamp).toBe(new Date(NOW).toISOString())
  })

  it('n’invente rien quand les niveaux ne sont pas un objet', () => {
    expect(socTargetPayload(null, 70, NOW)).toBeNull()
    expect(socTargetPayload([80], 70, NOW)).toBeNull()
  })
})

describe('réveil de charge', () => {
  it('rejoue les réglages de la voiture À L’IDENTIQUE, horodatage neuf', () => {
    const body = wakePayload(EV_SETTINGS, NOW)!
    // tout est conservé : l'heure de départ, la durée et la température sont des CHOIX de
    // l'utilisateur, faits dans sa voiture — les écraser serait le prix caché du réveil
    expect(body.chargeTimeStart).toBe('12:00')
    expect(body.chargeDuration).toBe(420)
    expect(body.preconditioningTemperature).toBe(21)
    expect(body.chargeModeRq).toBe('SCHEDULED')
    expect(body.programs).toEqual(EV_SETTINGS.programs)
    // seul l'horodatage change : c'est l'ÉCRITURE qui réveille, pas son contenu
    expect(body.lastSettingsUpdateTimestamp).toBe(new Date(NOW).toISOString())
    expect(body.lastSettingsUpdateTimestamp).not.toBe(EV_SETTINGS.lastSettingsUpdateTimestamp)
  })

  it('n’invente rien quand les réglages ne sont pas un objet', () => {
    expect(wakePayload(null, NOW)).toBeNull()
    expect(wakePayload('nope', NOW)).toBeNull()
    expect(wakePayload([1, 2], NOW)).toBeNull()
  })

  it('résume la COMMANDE rendue par Renault, et ne lève rien sur autre chose', () => {
    // réponse réelle du 2026-09-19 : ce n'est pas un enregistrement, c'est une commande déposée
    expect(commandSummary({ commandId: 'abc', type: 'HVAC_CHARGE_SYNCH', status: 'CREATED' }))
      .toBe('HVAC_CHARGE_SYNCH CREATED abc')
    expect(commandSummary({ status: 'CREATED' })).toBe('CREATED')
    expect(commandSummary({})).toBeNull()
    expect(commandSummary(null)).toBeNull()
    expect(commandSummary('nope')).toBeNull()
  })

  it('la fenêtre horaire borne le réveil à la journée', () => {
    const at = (h: number, m = 0) => new Date(2026, 8, 14, h, m)
    expect(inWindow(at(12), '08:00', '20:00')).toBe(true)
    expect(inWindow(at(8), '08:00', '20:00')).toBe(true)      // borne basse incluse
    expect(inWindow(at(20), '08:00', '20:00')).toBe(false)    // borne haute exclue
    expect(inWindow(at(3), '08:00', '20:00')).toBe(false)
    // une fenêtre à cheval sur minuit se lit des deux côtés
    expect(inWindow(at(23), '22:00', '06:00')).toBe(true)
    expect(inWindow(at(2), '22:00', '06:00')).toBe(true)
    expect(inWindow(at(12), '22:00', '06:00')).toBe(false)
    // bornes égales ou illisibles = jamais : c'est le moyen de couper la fonction
    expect(inWindow(at(12), '08:00', '08:00')).toBe(false)
    expect(inWindow(at(12), 'midi', '20:00')).toBe(false)
  })
})
