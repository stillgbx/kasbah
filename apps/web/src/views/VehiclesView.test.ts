import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse, type DeviceDescriptor, type DeviceEntry, type StateFor } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import VehiclesView from './VehiclesView.vue'

// What the view must hold: the "Réveiller" button shows that the request is in progress AS LONG AS
// the car has not opened its eyes — and not just the round trip to the server, which lasts a
// second where the vehicle takes about ten seconds.

const VIN = 'tesla:5YJ'
const vehicle = (sleepState: StateFor<'vehicle'>['sleepState'], available = true): DeviceEntry => ({
  descriptor: {
    id: VIN, pluginId: 'tesla', externalId: '5YJ', kind: 'vehicle', name: 'Voiture 1',
    capabilities: ['soc', 'range', 'location'], meta: { manufacturer: 'Tesla' },
  } as DeviceDescriptor,
  state: {
    kind: 'vehicle', updatedAt: 1, available, soc: 54, rangeKm: 234, pluggedIn: true, charging: false,
    locked: true, sleepState,
  } as StateFor<'vehicle'>,
})

/**
 * `houseDevice`: the vehicle's HOUSE entry, when the case calls for one — the battery's
 * capacity (which no vendor gives) lives there, and a `position` says the car was placed
 * by hand rather than set by its GPS.
 */
function setup(entry = vehicle('asleep'), houseDevice?: Record<string, unknown>) {
  const devices = useDevicesStore()
  devices.setEntries([entry])
  if (houseDevice) {
    const doc = JSON.parse(JSON.stringify(demo)) as { devices: unknown[] }
    doc.devices.push({ id: 'vehicle.sous-test', deviceId: VIN, ...houseDevice })
    useHouseStore().house = parseHouse(doc)
  }
  const sent = vi.spyOn(devices, 'sendCommand').mockResolvedValue(true)
  // the map pulls in MapLibre (WebGL): out of scope here, and happy-dom has none
  const w = mount(VehiclesView, { global: { stubs: { VehicleMap: true, PageHeader: true } } })
  const button = (label: string) => w.findAll('button').find((b) => b.text().includes(label))
  const spinner = () => w.find('.v-progress-circular').exists()
  return { w, devices, sent, button, spinner }
}

describe('VehiclesView — wake-up in progress', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('at rest: "Réveiller" offered, without an indicator', () => {
    const { button, spinner } = setup()
    expect(button('Réveiller')?.attributes('disabled')).toBeUndefined()
    expect(spinner()).toBe(false)
  })

  it('after the click: indicator shown and button locked, EVEN once the request is acknowledged', async () => {
    const { w, sent, button, spinner } = setup()
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(sent).toHaveBeenCalledWith(VIN, { type: 'vehicle.wake' })
    expect(spinner()).toBe(true)
    const b = button('Réveiller')!
    expect(b.attributes('disabled')).toBeDefined()
    expect(b.attributes('aria-busy')).toBe('true')
  })

  it('the vehicle opens its eyes: the indicator fades and "Réveiller" greys out, WITHOUT going away (nothing moves)', async () => {
    const { w, devices, button, spinner } = setup()
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(spinner()).toBe(true)
    devices.setEntries([vehicle('online')])
    await w.vm.$nextTick()
    expect(spinner()).toBe(false)
    expect(button('Réveiller')?.attributes('disabled')).toBeDefined()
    expect(button('Actualiser')?.attributes('disabled')).toBeUndefined()
  })

  /**
   * Re-reading a sleeping car does not wake it (the plugin stops at the list): that is how
   * we notice it woke up by itself, without paying for the wake-up.
   */
  it('asleep: "Actualiser" is offered NEXT TO "Réveiller"', async () => {
    const { sent, button } = setup()
    expect(button('Réveiller')).toBeDefined()
    const refresh = button('Actualiser')
    expect(refresh?.attributes('disabled')).toBeUndefined()
    await refresh!.trigger('click')
    expect(sent).toHaveBeenCalledWith(VIN, { type: 'vehicle.refresh' })
  })

  it('during a wake-up, "Actualiser" stays clickable: it is what says whether it opened its eyes', async () => {
    const { w, button } = setup()
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(button('Réveiller')!.attributes('disabled')).toBeDefined()
    expect(button('Actualiser')!.attributes('disabled')).toBeUndefined()
  })
})

describe('VehiclesView — charge detail', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  const charging = (extra: Partial<StateFor<'vehicle'>>): DeviceEntry => {
    const e = vehicle('online')
    return { ...e, state: { ...e.state, charging: true, ...extra } as StateFor<'vehicle'> }
  }

  it('states the power, the estimated end and the target — and nothing else', () => {
    const { w } = setup(charging({ chargePowerW: 7400, chargeMinutesRemaining: 80, chargeLimit: 80 }))
    expect(w.find('.vcard__charge').text()).toBe('7,4 kW · fin dans 1 h 20 · cible 80 %')
  })

  it('without a vendor estimate, nothing is invented', () => {
    const { w } = setup(charging({ chargeLimit: 80 }))
    expect(w.find('.vcard__charge').text()).toBe('cible 80 %')
  })

  /**
   * The vehicle does not state its power (the R5): it is deduced from the entered capacity and the
   * time the car announces — and is NOT presented as a measurement.
   */
  it('estimates the power that the vehicle does not state, and owns up to it', () => {
    const { w } = setup(charging({ soc: 74, chargeMinutesRemaining: 43, chargeLimit: 80 }), { batteryKwh: 52 })
    expect(w.find('.vcard__charge').text()).toBe('~4,4 kW estimé · fin dans 43 min · cible 80 %')
  })

  it('without an entered capacity, nothing is estimated — what the car says remains', () => {
    const { w } = setup(charging({ soc: 74, chargeMinutesRemaining: 43, chargeLimit: 80 }))
    expect(w.find('.vcard__charge').text()).toBe('fin dans 43 min · cible 80 %')
  })

  it('the gauge carries the marks the vendor gives: the target, and the floor if there is one', () => {
    const { w } = setup(charging({ chargeLimit: 80, socMin: 20 }))
    expect(w.findAll('.soc__tick').map((t) => t.attributes('style'))).toEqual(['left: 20%;', 'left: 80%;'])
    // Tesla has no floor: a single mark, and nothing invented at 0%
    const { w: tesla } = setup(charging({ chargeLimit: 80 }))
    expect(tesla.findAll('.soc__tick')).toHaveLength(1)
  })

  /**
   * The capacity is only used to estimate a power the vehicle does not state: whoever states it
   * (`charge_power` capability, Tesla) is not asked for it — and if NOTHING is left to set, the
   * button itself goes away.
   */
  /**
   * Color and paint OVERRIDE: for each, you must be able to go back to what the
   * plugin deduced. The cross only appears if there is a manual choice to clear — otherwise it
   * would promise to cancel something that does not exist.
   */
  it('a cross hands control back to the vendor, and only when a manual choice exists', async () => {
    const e = vehicle('online')
    const known = {
      ...e,
      descriptor: { ...e.descriptor, meta: { manufacturer: 'Tesla', vehicle: { color: '#285ac8', finish: 'matte' } } },
    } as DeviceEntry

    // nothing set by hand: both rows show what the car says, without a cross
    const { w, button } = setup(known)
    await button('Modifier')!.trigger('click')
    expect(w.find('.tune').text()).toContain('Mate')
    expect(w.findAll('.tune__reset')).toHaveLength(0)

    // paint chosen by hand: one cross, and only one (the color, for its part, stays with the vendor)
    const { w: tuned, button: b2 } = setup(known, { bodyFinish: 'solid' })
    await b2('Modifier')!.trigger('click')
    expect(tuned.findAll('.tune__reset')).toHaveLength(1)

    // both overridden: two crosses
    const { w: both, button: b3 } = setup(known, { bodyFinish: 'solid', bodyColor: '#112233' })
    await b3('Modifier')!.trigger('click')
    expect(both.findAll('.tune__reset')).toHaveLength(2)
  })

  it('a vehicle that states its power is not asked for its capacity', async () => {
    const e = vehicle('online')
    const says = { ...e, descriptor: { ...e.descriptor, capabilities: [...e.descriptor.capabilities, 'charge_power'] } } as DeviceEntry
    const { w, button } = setup(says)
    // placed by its GPS: offset and rotation remain to be set, plus 3D bodywork, paint and
    // color — and the four rows of the lease, which apply to any vehicle
    await button('Modifier')!.trigger('click')
    expect(w.findAll('.tune__row')).toHaveLength(5 + 4)
    expect(w.find('.tune').text()).toContain('Rotation')
    expect(w.find('.tune').text()).not.toContain('Capacité')

    // placed by hand AND talkative about its power: only the appearance choice remains, which
    // depends neither on the place nor on the battery — the tesla plugin delivers a bodywork
    const { w: manual, button: quiet } = setup(says, { position: [1, 2, 0] })
    await quiet('Modifier')!.trigger('click')
    expect(manual.findAll('.tune__row')).toHaveLength(3 + 4)
    expect(manual.find('.tune').text()).toContain('Carrosserie 3D')
    expect(manual.find('.tune').text()).not.toContain('Rotation')
  })

  it('the entered lease reads at the foot of the card, against the odometer', () => {
    vi.useFakeTimers({ now: Date.parse('2026-01-01T12:00:00Z'), toFake: ['Date'] })
    const e = vehicle('online')
    const driven = { ...e, state: { ...e.state, odometerKm: 11000 } } as DeviceEntry
    const { w } = setup(driven, { lease: { start: '2025-01-01', end: '2027-01-01', km: 20000, startKm: 1000 } })
    vi.useRealTimers()
    // mid-contract: 10,000 km driven since the handover of the keys, ~10,000 allowed
    const text = w.find('.vcard__lease').text().replace(/\s/g, ' ')
    expect(text).toContain('LOA · 10 000 km sur 10 0')
    expect(text).toContain('(forfait 20 000)')
    expect(w.find('.vcard__lease-fill').attributes('data-tense')).toBe('0')
    // two-year contract: a graduation at the first anniversary, at mid-gauge; the mark of the
    // allowed maximum is, that day, in the same place
    const years = w.findAll('.vcard__lease-year')
    expect(years).toHaveLength(1)
    expect(parseFloat(years[0]!.attributes('style')!.match(/left: ([\d.]+)%/)![1]!)).toBeCloseTo(50, 0)
    expect(w.find('.vcard__lease-pace').attributes('title')).toMatch(/Autorisé à ce jour/)
    // without an entered lease, nothing: not even the space
    const { w: none } = setup(driven, {})
    expect(none.find('.vcard__lease').exists()).toBe(false)
  })

  it('off charge, the row stays in place and keeps quiet', () => {
    const { w } = setup(vehicle('online'))
    expect(w.find('.vcard__charge').exists()).toBe(true)
    expect(w.find('.vcard__charge').text()).toBe('')
  })

  it('all the buttons, always: what the vehicle cannot do is GREYED OUT with its reason, not hidden', () => {
    // the test vehicle declares neither `lock`, nor `charging`, nor `climate_precondition`
    const { button } = setup(vehicle('online'))
    for (const label of ['Déverrouiller', 'Lancer la charge', 'Climatisation']) {
      expect(button(label)?.attributes('disabled'), label).toBeDefined()
      expect(button(label)?.attributes('title'), label).toBe('Pas disponible sur ce véhicule')
    }
  })

  it('request refused: the button comes back right away', async () => {
    const { w, sent, button, spinner } = setup()
    sent.mockResolvedValue(false)
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(spinner()).toBe(false)
    expect(button('Réveiller')?.attributes('disabled')).toBeUndefined()
  })
})
