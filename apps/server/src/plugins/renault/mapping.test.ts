import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ID, BATTERY_CHARGING, BATTERY_UNPLUGGED, BATTERY_WAITING, COCKPIT_V1, COCKPIT_V2_EASTER_EGG,
  HVAC_STATUS, LOCATION, PERSON, SOC_LEVELS, VEHICLES, VIN,
} from './__fixtures__/kamereon'
import { toAccounts, toDescriptor, toStatePatch, toVehicleLinks, vehicleName } from './mapping'

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
    expect(d.capabilities).toEqual(['soc', 'range', 'location'])
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
      readAt: NOW,
      soc: 58,
      rangeKm: 218,
      pluggedIn: true,
      charging: false,
      odometerKm: 12500,
      location: { lat: 47.32, lon: 5.04, at: Date.parse('2026-09-14T08:18:31Z') },
      insideTempC: 37,
      chargeLimit: 80,
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

  it('survit au cockpit v2 farceur : pas de kilométrage plutôt qu’un zéro', () => {
    const patch = toStatePatch({ battery: BATTERY_WAITING, cockpit: COCKPIT_V2_EASTER_EGG }, NOW)
    expect(patch.odometerKm).toBeUndefined()
    expect(patch.soc).toBe(58)                    // le reste du tour n'en souffre pas
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
