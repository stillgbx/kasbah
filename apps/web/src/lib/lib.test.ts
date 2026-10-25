import { describe, expect, it } from 'vitest'
import { PANEL_PEAK_W, type DeviceDescriptor, type DeviceEntry, type PanelArray, type StateFor } from '@kasbah/shared'
import { optimisticPatch } from './optimistic'
import { fromClosure, toClosure } from './cover'
import type { HouseDevice } from '@kasbah/shared'
import { emitsSound, relayLabel, soundRouting } from './audioRouting'
import { headlineValue, isDeviceBusy, isDeviceOn, isDevicePulsing, statusLabel, toggleChecked, toggleCommand } from './deviceState'
import { formatFlow, formatPower, formatRunTime, formatSensor, formatVolume, formatVolumeAxisTick, summarize, volumeAxisUnit } from './format'
import { deviceColor, deviceIcon, presentRoomFilters, roomFilterCategory } from './deviceIcons'
import { findBatteries, findEnergySite, inverterGroups, isEnergySite, isInverter, shortInverterId } from './energy'
import { coverActivity, coverAtRest, isFlatCover, isPassageCover } from './cover'
import { coverLeaves, coverSize, hasLeaves, isOrientable, isSizable, tvInchesFromSize, tvSizeFromInches } from './orientation'
import { bodyColorOf, bodyFinishOf, FINISH_MATERIAL, SCENE_FINISH } from './vehicleTuning'
import { BOTH_MAX_M, CAR_ZOOM, IGN_ORTHO_TILE_URL, initialView, normalizeHeading, planStyleUrl, satelliteStyle, satelliteStyleWithLabels } from './map'
import { isDaylight, TWILIGHT_MS } from './daylight'
import { bucketSlots, niceAxisTicks, seriesFor, slotsMax, slotsTotal } from './consumption'
import type { ConsumptionPoint, DeviceConsumption } from '@kasbah/shared'
import fr from '../i18n/locales/fr.json'
import en from '../i18n/locales/en.json'

const light: StateFor<'light'> = { kind: 'light', updatedAt: 0, available: true, on: false, brightness: 50 }
const cover: StateFor<'cover'> = { kind: 'cover', updatedAt: 0, available: true, position: 100, motion: 'stopped' }
const sensor: DeviceDescriptor = { id: 'mock:s', pluginId: 'mock', externalId: 's', kind: 'sensor', name: 'T', capabilities: ['measure'], meta: { sensor: { unit: '°C', deviceClass: 'temperature', precision: 1 } } }

/** A heating run time over a year: days and hours, never 3 130 h. */
describe('formatRunTime', () => {
  it('reads minutes, hours, then days', () => {
    expect(formatRunTime(0.6, 'fr')).toBe('36 min')
    expect(formatRunTime(1.6, 'fr')).toBe('1 h 36')
    expect(formatRunTime(30, 'fr')).toBe('1 j 6 h')
    expect(formatRunTime(72.2, 'fr')).toBe('3 j')
    expect(formatRunTime(3130, 'en')).toBe('130 d 10 h')
  })
})

describe('optimisticPatch', () => {
  it('light.set', () => {
    expect(optimisticPatch(light, { type: 'light.set', on: true })).toEqual({ on: true })
    expect(optimisticPatch(light, { type: 'light.set', brightness: 0 })).toEqual({ on: false })
    expect(optimisticPatch(light, { type: 'light.set', brightness: 30 })).toEqual({ on: true, brightness: 30 })
    expect(optimisticPatch(light, { type: 'cover.open' })).toBeNull()
  })
  it('cover', () => {
    expect(optimisticPatch(cover, { type: 'cover.close' })).toEqual({ motion: 'closing' })
    expect(optimisticPatch(cover, { type: 'cover.open' })).toEqual({ motion: 'stopped' })
    expect(optimisticPatch(cover, { type: 'cover.set_position', position: 20 })).toEqual({ motion: 'closing' })
    // recall of the custom position: the direction is read from the motor's memory, failing that we bet
    // on the movement rather than on a gesture without an echo
    expect(optimisticPatch({ ...cover, presetPosition: 20 }, { type: 'cover.preset' })).toEqual({ motion: 'closing' })
    expect(optimisticPatch(cover, { type: 'cover.preset' })).toEqual({ motion: 'opening' })
  })
})

describe('status of a heating device', () => {
  const t = ((key: string) => key) as never
  const climate: StateFor<'climate'> = { kind: 'climate', updatedAt: 0, available: true, mode: 'heat', action: 'idle', currentTempC: 18, targetTempC: 19.5 }

  it('says "measured → setpoint" when it is heating', () => {
    expect(statusLabel(sensor, climate, t, 'fr')).toBe('18,0 °C → 19,5 °C')
  })

  // off, no setpoint applies: repeating it made one believe it was aiming for 19.5 °C,
  // and a thermostat that does not publish it (Nest) displayed the same temperature three times
  it('only says the measured value when it is off', () => {
    expect(statusLabel(sensor, { ...climate, mode: 'off' }, t, 'fr')).toBe('18,0 °C')
    expect(summarize(sensor, { ...climate, mode: 'off' }, 'fr')).toBe('18,0 °C')
  })
})

describe('cover display convention', () => {
  // The contract measures an OPENING, the interface a CLOSURE. These tests pin down the inversion:
  // it is the kind of convention that a refactor flips without meaning to.
  const t = ((key: string) => key) as never
  const at = (over: Partial<StateFor<'cover'>>): StateFor<'cover'> => ({ ...cover, ...over })

  it('inverts in both directions', () => {
    expect(toClosure(100)).toBe(0)          // wide open = 0 % closure
    expect(toClosure(0)).toBe(100)
    expect(fromClosure(toClosure(37))).toBe(37)
  })

  it('the label gives a CLOSURE percentage', () => {
    expect(statusLabel(sensor, at({ position: 100 }), t, 'fr')).toBe('cover.openClose.open')
    expect(statusLabel(sensor, at({ position: 0 }), t, 'fr')).toBe('cover.openClose.closed')
    expect(statusLabel(sensor, at({ position: 30 }), t, 'fr')).toBe('70 %')
  })

  it('in motion, the label announces the movement and not a position being left', () => {
    expect(statusLabel(sensor, at({ position: 100, motion: 'closing' }), t, 'fr')).toBe('cover.openClose.closing')
    expect(statusLabel(sensor, at({ position: 0, motion: 'opening' }), t, 'fr')).toBe('cover.openClose.opening')
  })

  it('busy = throughout the travel, not during the request', () => {
    expect(isDeviceBusy(at({ motion: 'stopped' }))).toBe(false)
    expect(isDeviceBusy(at({ motion: 'closing' }))).toBe(true)
    expect(isDeviceBusy(at({ motion: 'opening' }))).toBe(true)
    // position aimed but motor not yet started: already busy
    expect(isDeviceBusy(at({ motion: 'stopped' }), true)).toBe(true)
    expect(isDeviceBusy(light)).toBe(false)          // a light has no travel
  })

  it('a blind switches to the other vocabulary', () => {
    const store = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'awning' as const } } }
    expect(statusLabel(store, at({ position: 0 }), t, 'fr')).toBe('cover.upDown.closed')
    expect(statusLabel(store, at({ position: 100 }), t, 'fr')).toBe('cover.upDown.open')
    expect(statusLabel(store, at({ position: 40, motion: 'closing' }), t, 'fr')).toBe('cover.upDown.closing')
    // the intermediate percentage stays a percentage, whatever the vocabulary
    expect(statusLabel(store, at({ position: 40 }), t, 'fr')).toBe('60 %')
  })

  it('what gets NOTICED: an open shutter, but a DEPLOYED blind', () => {
    const shutter = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'shutter' as const } } }
    const store = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'awning' as const } } }
    // a wide-open shutter gets noticed, closed it says nothing
    expect(coverActivity(shutter, 100)).toBe(1)
    expect(coverActivity(shutter, 0)).toBe(0)
    // a blind is the opposite: deployed (position 0, "lowered") it is exposed to the wind, folded up it sleeps
    expect(coverActivity(store, 0)).toBe(1)
    expect(coverActivity(store, 100)).toBe(0)
    expect(coverActivity(store, undefined)).toBe(0)          // unknown position: nothing to report
    // and the tint of the lines and markers follows the same rule
    expect(isDeviceOn(at({ position: 100 }), store)).toBe(false)
    expect(isDeviceOn(at({ position: 30 }), store)).toBe(true)
    expect(isDeviceOn(at({ position: 100 }), shutter)).toBe(true)
    expect(isDeviceOn(at({ position: 100 }))).toBe(true)      // without a descriptor: the shutter rule
  })

  it('AT REST: closed for what stands upright, raised for a blind, and assumes rest if unknown', () => {
    const shutter = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'shutter' as const } } }
    const gate = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'gate' as const } } }
    const store = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'awning' as const } } }
    expect(coverAtRest(shutter, 0)).toBe(true)
    expect(coverAtRest(shutter, 100)).toBe(false)
    // a blind at rest is RAISED (position 100), not lowered: lowered means fabric in the wind
    expect(coverAtRest(store, 100)).toBe(true)
    expect(coverAtRest(store, 0)).toBe(false)
    // doubt leans toward the safe side: a mute gate does not say the house is open
    expect(coverAtRest(gate, undefined)).toBe(true)
    expect(coverAtRest(store, undefined)).toBe(true)
    // what opens onto the street: never opened by a group gesture
    const garage = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'garage' as const } } }
    expect(isPassageCover(gate)).toBe(true)
    expect(isPassageCover(garage)).toBe(true)
    expect(isPassageCover(shutter)).toBe(false)
  })

  it('switch: checked = CLOSED, whereas isDeviceOn keeps open = active', () => {
    expect(toggleChecked(at({ position: 0 }))).toBe(true)
    expect(toggleChecked(at({ position: 100 }))).toBe(false)
    expect(toggleChecked(at({ position: 0, available: false }))).toBe(false)
    expect(toggleChecked(light)).toBe(false)          // a light that is off stays unchecked
  })

  it('toggle: one can REVERSE a movement in progress', () => {
    // shutter at 75, we close: without the target the toggle would send "close" again
    expect(toggleCommand(at({ position: 75 }))).toEqual({ type: 'cover.close' })
    expect(toggleCommand(at({ position: 75 }), 0)).toEqual({ type: 'cover.open' })
    // and during an opening, it must be able to close again
    expect(toggleCommand(at({ position: 25 }), 100)).toEqual({ type: 'cover.close' })
  })

  it('switch: the aimed target toggles right away', () => {
    // shutter at 75 (25 % closure) so switch off; we aim for closure
    expect(toggleChecked(at({ position: 75 }))).toBe(false)
    expect(toggleChecked(at({ position: 75 }), 0)).toBe(true)
    // and the other way around: closed, we aim for opening
    expect(toggleChecked(at({ position: 0 }))).toBe(true)
    expect(toggleChecked(at({ position: 0 }), 100)).toBe(false)
  })

  it('without the `position` capability, the big value gives no deduced percentage', () => {
    // RTS: the position comes from the last full-travel command, not from a measurement. A blind
    // stopped at mid-height displayed "100 %" — the word, for its part, stays true.
    const rts = { ...sensor, kind: 'cover' as const, capabilities: [] as never[], meta: { cover: { deviceClass: 'awning' as const } } }
    expect(headlineValue(rts, at({ position: 0 }), t, 'fr')).toBe('cover.upDown.closed')
    expect(headlineValue(rts, at({ position: 100 }), t, 'fr')).toBe('cover.upDown.open')
    // a motor that can aim at a position MEASURES it: it keeps its percentage
    const io = { ...sensor, kind: 'cover' as const, capabilities: ['position'] as never[], meta: {} }
    expect(headlineValue(io, at({ position: 40 }), t, 'fr')).toBe('60 %')
  })

  it('UNKNOWN position: nothing is asserted', () => {
    // one-way radio (RTS) that never received a command: `position` is absent.
    // The trap fixed here: `defaultState` set 0, and the interface announced "Closed" / "Lowered"
    // for two blinds actually raised, summary counter included.
    const unknown: StateFor<'cover'> = { kind: 'cover', updatedAt: 0, available: true, motion: 'stopped' }
    // we SHOW the assumed state (rest) rather than a mute "Unknown", but never without saying so
    expect(statusLabel(sensor, unknown, t, 'fr')).toBe('cover.assumed')
    expect(headlineValue(sensor, unknown, t, 'fr')).toBe('cover.openClose.closed')
    const store = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'awning' as const } } }
    expect(headlineValue(store, unknown, t, 'fr')).toBe('cover.upDown.open')   // a blind at rest is RAISED
    expect(summarize(sensor, unknown, 'fr')).toBe('—')
    expect(isDeviceOn(unknown)).toBe(false)                             // no icon tint
    expect(toggleChecked(unknown)).toBe(false)                          // "closed" cannot be asserted
    expect(toggleCommand(unknown)).toEqual({ type: 'cover.close' })     // the toggle stays useful
    // the movement, for its part, is known: it is the only thing the box says about an RTS
    expect(statusLabel(sensor, { ...unknown, motion: 'closing' }, t, 'fr')).toBe('cover.openClose.closing')
    // the optimistic patch bets on the movement rather than on "already at the end"
    expect(optimisticPatch(unknown, { type: 'cover.open' })).toEqual({ motion: 'opening' })
    expect(optimisticPatch(unknown, { type: 'cover.close' })).toEqual({ motion: 'closing' })
  })
})

describe('player: app on screen (`on`)', () => {
  const t = ((key: string) => key) as never
  const tv = (playback: StateFor<'media_player'>['playback']): StateFor<'media_player'> =>
    ({ kind: 'media_player', updatedAt: 0, available: true, playback, volume: 100, muted: false, nowPlaying: { title: '', source: 'Netflix' } })
  it('counts as active and pulses, like a playback; at rest it does not', () => {
    expect(isDeviceOn(tv('on'))).toBe(true)
    expect(toggleChecked(tv('on'))).toBe(true)
    expect(isDevicePulsing(tv('on'))).toBe(true)
    expect(isDeviceOn(tv('idle'))).toBe(false)
    expect(isDevicePulsing(tv('idle'))).toBe(false)
  })
  it('the label names the app; the toggle CLOSES the app (stop), pause staying for playback', () => {
    expect(statusLabel(sensor, tv('on'), t, 'fr')).toBe('media.on · Netflix')
    expect(toggleCommand(tv('on'))).toEqual({ type: 'media_player.stop' })
    expect(toggleCommand(tv('playing'))).toEqual({ type: 'media_player.pause' })
    expect(toggleCommand(tv('idle'))).toEqual({ type: 'media_player.play' })
  })
})

describe('sound routing: a TV on HDMI ARC makes a soundbar play', () => {
  // The case observed on 2026-09-10: the living-room TV plays YouTube Music, its sound goes out over eARC to the soundbar,
  // which the Cast protocol sees at rest. The link is declared in house.json on the TV.
  const t = ((key: string, named?: Record<string, unknown>) => `${key}${named ? `(${String(named.name)})` : ''}`) as never
  const tvHouse: HouseDevice = { id: 'tv', deviceId: 'cast:tv', position: [0, 0, 0], meta: { audioOutput: 'bar' } }
  const barHouse: HouseDevice = { id: 'bar', deviceId: 'cast:bar', position: [0, 0, 0] }
  const player = (over: Partial<StateFor<'media_player'>>): StateFor<'media_player'> =>
    ({ kind: 'media_player', updatedAt: 0, available: true, playback: 'idle', volume: 6, muted: false, ...over })
  const tvPlaying = player({ playback: 'playing', nowPlaying: { title: 'Cs60', artist: 'BADBADNOTGOOD' }, audioOutput: { terminal: 'external', name: 'Flexus 300' } })
  const bar = player({})

  it('the bar relays and makes noise, the TV goes quiet (its sound goes out elsewhere)', () => {
    const r = soundRouting([tvHouse, barHouse], { 'cast:tv': tvPlaying, 'cast:bar': bar })
    expect(r.relays.get('cast:bar')).toBe('cast:tv')
    expect(emitsSound('cast:bar', bar, r)).toBe(true)
    expect(emitsSound('cast:tv', tvPlaying, r)).toBe(false)
    expect(relayLabel('TV Salon', tvPlaying, t)).toBe('media.relaying(TV Salon) · Cs60')
  })
  it('TV set to its speakers: the link does not play; TV mute on that: we believe the declaration', () => {
    const own = { ...tvPlaying, audioOutput: { terminal: 'internal' as const } }
    const r1 = soundRouting([tvHouse, barHouse], { 'cast:tv': own, 'cast:bar': bar })
    expect(r1.relays.size).toBe(0)
    expect(emitsSound('cast:tv', own, r1)).toBe(true)
    expect(emitsSound('cast:bar', bar, r1)).toBe(false)
    const { audioOutput: _o, ...unknown } = tvPlaying
    const r2 = soundRouting([tvHouse, barHouse], { 'cast:tv': unknown, 'cast:bar': bar })
    expect(r2.relays.get('cast:bar')).toBe('cast:tv')
    expect(emitsSound('cast:tv', unknown, r2)).toBe(false)
    // `both`: both play
    const both = { ...tvPlaying, audioOutput: { terminal: 'both' as const } }
    const r3 = soundRouting([tvHouse, barHouse], { 'cast:tv': both, 'cast:bar': bar })
    expect(emitsSound('cast:tv', both, r3)).toBe(true)
    expect(emitsSound('cast:bar', bar, r3)).toBe(true)
  })
  it('nothing plays, TV unavailable, or link to a missing device: nobody relays', () => {
    expect(soundRouting([tvHouse, barHouse], { 'cast:tv': player({ audioOutput: { terminal: 'external' } }), 'cast:bar': bar }).relays.size).toBe(0)
    expect(soundRouting([tvHouse, barHouse], { 'cast:tv': { ...tvPlaying, available: false }, 'cast:bar': bar }).relays.size).toBe(0)
    expect(soundRouting([tvHouse], { 'cast:tv': tvPlaying }).relays.size).toBe(0)
    // without a declared link, a TV that sends its sound elsewhere goes quiet anyway: the picture stays with it
    const r = soundRouting([{ ...tvHouse, meta: {} }, barHouse], { 'cast:tv': tvPlaying, 'cast:bar': bar })
    expect(emitsSound('cast:tv', tvPlaying, r)).toBe(false)
    expect(emitsSound('cast:bar', bar, r)).toBe(false)
  })
})

describe("energy site vs battery", () => {
  const entry = (externalId: string, capabilities: DeviceDescriptor['capabilities'], state: Partial<StateFor<'energy'>>) => ({
    descriptor: { id: `enphase:${externalId}`, pluginId: 'enphase', externalId, kind: 'energy' as const, name: externalId, capabilities, meta: {} },
    state: { kind: 'energy' as const, updatedAt: 0, available: true, productionW: 0, consumptionW: 0, gridW: 0, ...state },
  })
  // real order of an Enphase installation: the site, then the batteries
  const site = entry('site', ['production', 'consumption', 'grid', 'storage'], { productionW: 6456, consumptionW: 691, gridW: -5765 })
  const battery = entry('b1', ['storage'], { batterySoc: 100, batteryW: -16 })

  it('recognizes the site by the GRID measurement, not by its rank in the list', () => {
    expect(isEnergySite(site.descriptor)).toBe(true)
    expect(isEnergySite(battery.descriptor)).toBe(false)
    // regression: a battery placed before the site gave 0 W of production and 100 % charge
    expect(findEnergySite([battery, site])?.descriptor.externalId).toBe('site')
    expect(findEnergySite([site, battery])?.descriptor.externalId).toBe('site')
  })

  it('lists the batteries separately, and falls back on the first `energy` without a grid meter', () => {
    expect(findBatteries([site, battery, battery]).map((e) => e.descriptor.externalId)).toEqual(['b1', 'b1'])
    const noMeter = entry('sans-compteur', ['production'], { productionW: 12 })
    expect(findEnergySite([noMeter])?.descriptor.externalId).toBe('sans-compteur')
    expect(findEnergySite([])).toBeUndefined()
  })
})

describe("inverters arranged by array", () => {
  const inv = (id: string, watts: number, available = true, maxValue?: number): DeviceEntry => ({
    descriptor: { id: `enphase:${id}`, pluginId: 'enphase', externalId: id, kind: 'sensor', name: `Onduleur ${id}`, capabilities: ['measure'], meta: { sensor: { unit: 'W', deviceClass: 'power' } } } as DeviceDescriptor,
    state: { kind: 'sensor', updatedAt: 0, available, value: watts, ...(maxValue === undefined ? {} : { maxValue }) } as StateFor<'sensor'>,
  })
  const array = (id: string, cols: number, rows: number, panels: (string | null)[]): PanelArray => ({
    id, levelId: 'toit', origin: [0, 0, 0], yaw: 180, slope: 0, tilt: 15, rows, cols, gap: 0.02,
    panel: { width: 1.13, height: 1.76, peakW: 500 }, maxOutputW: 480, panels,
  } as PanelArray)
  const grid = (g: { cells: { label: string }[]; cols: number }) =>
    Array.from({ length: g.cells.length / g.cols }, (_, r) => g.cells.slice(r * g.cols, (r + 1) * g.cols).map((c) => c.label).join(' '))

  it('renders the array\'s GRID, row by row, like the 3D scene', () => {
    // the array is filled in reverse: it is `panels` that says the place, and it alone
    const field = array('pv', 2, 2, ['enphase:d', 'enphase:c', 'enphase:b', 'enphase:a'])
    const [g] = inverterGroups([field], [inv('a', 10), inv('b', 20), inv('c', 30), inv('d', 40)])
    expect([g!.rows, g!.cols]).toEqual([2, 2])
    expect(grid(g!)).toEqual(['D C', 'B A'])
    expect(g!.cells.map((c) => [c.row, c.col])).toEqual([[1, 1], [1, 2], [2, 1], [2, 2]])
    expect(g!.totalW).toBe(100)
    expect(g!.index).toBe(0)
  })

  it('keeps the cell of an empty place: without it, the grid no longer looks like the roof', () => {
    const field = array('pv', 3, 1, ['enphase:a', null, 'enphase:c'])
    const [g] = inverterGroups([field], [inv('a', 100), inv('c', 120)])
    expect(grid(g!)).toEqual(['A 1-2 C'])                  // the empty cell carries its place
    expect(g!.cells[1]).toMatchObject({ id: null, watts: 0 })
    expect(g!.totalW).toBe(220)
  })

  it('a mute inverter is not worth zero watts', () => {
    const [g] = inverterGroups([array('pv', 1, 1, ['enphase:a'])], [inv('a', 250, false)])
    expect(g!.cells[0]).toMatchObject({ available: false, watts: 0 })
    expect(g!.totalW).toBe(0)
  })

  it('carries the peak and the max output power of the array, and a scale that contains both', () => {
    const [g] = inverterGroups([array('pv', 1, 1, ['enphase:a'])], [inv('a', 250)])
    expect([g!.peakW, g!.maxOutputW, g!.scaleW]).toEqual([500, 480, 500])
    // outside an array, nobody declares a module or an inverter: the current peak, and no ceiling
    const [loose] = inverterGroups([], [inv('b', 250)])
    expect([loose!.peakW, loose!.maxOutputW, loose!.scaleW]).toEqual([PANEL_PEAK_W, 0, PANEL_PEAK_W])
  })

  it('opens the scale rather than discarding a marker that exceeds the module\'s peak', () => {
    // an IQ8P (480 W) under a 450 Wp module: the ceiling was higher than the peak, and
    // disappeared without a word. Same for a record above both.
    const small = { ...array('pv', 1, 1, ['enphase:a']), panel: { width: 1.13, height: 1.76, peakW: 450 } } as PanelArray
    expect(inverterGroups([small], [inv('a', 200)])[0]!.scaleW).toBe(480)
    expect(inverterGroups([small], [inv('a', 200, true, 495)])[0]!.scaleW).toBe(495)
  })

  it('keeps each inverter\'s RECORD, the one the gateway holds, even when it goes quiet', () => {
    const [g] = inverterGroups([array('pv', 2, 1, ['enphase:a', 'enphase:b'])], [inv('a', 250, true, 431), inv('b', 0, false, 438)])
    expect(g!.cells.map((c) => c.maxW)).toEqual([431, 438])
    // an inverter that publishes none: 0, and the Energy view then marks no record
    const [none] = inverterGroups([array('pv', 1, 1, ['enphase:c'])], [inv('c', 100)])
    expect(none!.cells[0]!.maxW).toBe(0)
  })

  it('an array without an inverter makes no card, and an id the plugin no longer publishes leaves an empty cell', () => {
    const vide = array('vide', 2, 1, [null, null])
    const fantome = array('fantome', 1, 1, ['enphase:parti'])
    expect(inverterGroups([vide, fantome], [])).toEqual([])
  })

  it('puts the inverters that no array carries in a last one-column group, sorted by number', () => {
    const field = array('pv', 1, 1, ['enphase:1'])
    const groups = inverterGroups([field], [inv('10', 5), inv('2', 7), inv('1', 100)])
    expect(groups.map((g) => g.index)).toEqual([0, null])
    expect(groups[1]!.cols).toBe(1)
    expect(groups[1]!.cells.map((c) => c.name)).toEqual(['Onduleur 2', 'Onduleur 10'])
    expect(groups[1]!.totalW).toBe(12)
  })

  it('recognizes an inverter: a power sensor of the installation\'s plugin', () => {
    expect(isInverter(inv('a', 1).descriptor, 'enphase')).toBe(true)
    expect(isInverter(inv('a', 1).descriptor, 'mock')).toBe(false)
    expect(isInverter(sensor, 'mock')).toBe(false)
  })

  it('cuts the serial number to five characters, the length of the published names', () => {
    expect(shortInverterId('enphase:482409158')).toBe('09158')
    expect(shortInverterId('mock:panel-s10')).toBe('10')
  })
})

describe("what has an adjustable orientation", () => {
  const dev = { id: 'x', position: [0, 0, 0] as [number, number, number] }
  const desc = (kind: DeviceDescriptor['kind'], meta: DeviceDescriptor['meta'] = {}): DeviceDescriptor =>
    ({ id: `p:${kind}`, pluginId: 'p', externalId: kind, kind, name: kind, capabilities: [], meta })

  it('what LOOKS somewhere, and what is placed AGAINST A WALL', () => {
    // looks somewhere
    expect(isOrientable(dev, desc('camera'))).toBe(true)
    expect(isOrientable(dev, desc('vehicle'))).toBe(true)
    expect(isOrientable(dev, desc('media_player', { mediaPlayer: { deviceClass: 'tv' } }))).toBe(true)
    // has a face: charger, battery, gateway case
    expect(isOrientable(dev, desc('ev_charger'))).toBe(true)
    expect(isOrientable(dev, desc('energy'))).toBe(true)
    // a water treatment unit is screwed ON THE WALL: its back touches it, its face looks at the room
    expect(isOrientable(dev, desc('water'))).toBe(true)
  })

  it("neither a cylinder/pebble speaker, nor a light, nor a sensor has a useful orientation", () => {
    const speaker = desc('media_player', { mediaPlayer: { deviceClass: 'speaker' } })
    expect(isOrientable(dev, speaker)).toBe(false)
    expect(isOrientable({ ...dev, speakerShape: 'pebble' }, speaker)).toBe(false)
    expect(isOrientable(dev, desc('light'))).toBe(false)
    expect(isOrientable(dev, desc('sensor'))).toBe(false)
    // without a descriptor, only a `yaw` already set in the JSON is authoritative
    expect(isOrientable(dev, undefined)).toBe(false)
    expect(isOrientable({ ...dev, yaw: 90 }, undefined)).toBe(true)
  })

  it("a soundbar or an alarm-clock block orient: their face has a direction", () => {
    const speaker = desc('media_player', { mediaPlayer: { deviceClass: 'speaker' } })
    expect(isOrientable({ ...dev, speakerShape: 'bar' }, speaker)).toBe(true)
    expect(isOrientable({ ...dev, speakerShape: 'block' }, speaker)).toBe(true)
    // mediaClass absent = speaker by default: the bar stays orientable
    expect(isOrientable({ ...dev, speakerShape: 'bar' }, desc('media_player'))).toBe(true)
  })

  it("a FREE cover orients and sizes itself, a cover linked to an opening does not", () => {
    const gate = desc('cover', { cover: { deviceClass: 'gate' } })
    expect(isOrientable(dev, gate)).toBe(true)
    expect(isSizable(dev, gate)).toBe(true)
    // shutter of a window: its apron already follows the opening's rectangle
    const shutter = desc('cover', { cover: { deviceClass: 'shutter' } })
    const onWindow = { ...dev, openingId: 'win.salon' }
    expect(isOrientable(onWindow, shutter)).toBe(false)
    expect(isSizable(onWindow, shutter)).toBe(false)
  })

  it('a TV is sized by its diagonal (inches → 16:9 panel), a speaker is not', () => {
    const tv = desc('media_player', { mediaPlayer: { deviceClass: 'tv' } })
    const speaker = desc('media_player', { mediaPlayer: { deviceClass: 'speaker' } })
    const display = desc('media_player', { mediaPlayer: { deviceClass: 'display' } })
    expect(isSizable(dev, tv)).toBe(true)
    expect(isSizable(dev, speaker)).toBe(false)
    expect(isSizable(dev, display)).toBe(false)
    // default 45″ → 16:9 width × height
    expect(coverSize(dev, tv)).toEqual(tvSizeFromInches(45))
    expect(tvInchesFromSize(coverSize(dev, tv))).toBe(45)
    expect(tvInchesFromSize(tvSizeFromInches(55))).toBe(55)
    expect(coverSize({ ...dev, size: tvSizeFromInches(65) }, tv)).toEqual(tvSizeFromInches(65))
  })

  it('a blind deploys FLAT, with its own default size', () => {
    const awning = desc('cover', { cover: { deviceClass: 'awning' } })
    const gate = desc('cover', { cover: { deviceClass: 'gate' } })
    expect(isFlatCover(awning)).toBe(true)
    expect(isFlatCover(gate)).toBe(false)
    // the awning is wide and projects; the gate stays the small standing panel
    expect(coverSize(dev, awning)).toEqual({ width: 3, height: 2 })
    expect(coverSize(dev, gate)).toEqual({ width: 0.6, height: 0.5 })
    // the JSON always wins over the default
    expect(coverSize({ ...dev, size: { width: 4, height: 2.5 } }, awning)).toEqual({ width: 4, height: 2.5 })
  })

  it("a gate counts its leaves, a blind has none", () => {
    const gate = desc('cover', { cover: { deviceClass: 'gate' } })
    const garage = desc('cover', { cover: { deviceClass: 'garage' } })
    const awning = desc('cover', { cover: { deviceClass: 'awning' } })
    expect(hasLeaves(dev, gate)).toBe(true)
    expect(hasLeaves(dev, awning)).toBe(false)
    // two leaves for a gate, one piece for a garage door
    expect(coverLeaves(dev, gate)).toBe(2)
    expect(coverLeaves(dev, garage)).toBe(1)
    expect(coverLeaves({ ...dev, leaves: 1 }, gate)).toBe(1)
  })
})

describe('format & icons', () => {
  it('formats power and sensors', () => {
    expect(formatPower(850, 'en')).toBe('850 W')
    expect(formatPower(2400, 'en')).toBe('2.4 kW')
    expect(formatSensor(sensor, 21.44, 'en')).toBe('21.4 °C')
    expect(summarize(sensor, { kind: 'sensor', updatedAt: 0, available: true, value: 3 }, 'en')).toBe('3.0 °C')
  })
  it('flow and volume: liters AND m3 side by side, ALWAYS (no more threshold hiding the m3)', () => {
    // the flow always carries both units, at 3 decimals (flowmeter step: 36 L/h = 0.036 m3/h,
    // constant over its whole range: 2 decimals would already lose the information, not only near 0)
    expect(formatFlow(612, 'fr')).toBe('612 L/h · 0,612 m³/h')
    expect(formatFlow(2556, 'en')).toBe('2,556 L/h · 2.556 m³/h')
    // an EXACTLY zero flow is a measurement, not an approximation: no chatty "0,000 m3/h"
    expect(formatFlow(0, 'fr')).toBe('0 L/h')
    // the volume now displays the m3 at any non-zero value; below 1 m3, 3 decimals so as to
    // NEVER write "0,00 m3" on a real measurement (3 L, 93 L) - the rule "absent is not zero"
    // applied to rounding. Beyond 1 m3, 2 decimals suffice (a liter can no longer be read there).
    expect(formatVolume(3, 'fr')).toBe('3 L · 0,003 m³')
    expect(formatVolume(93, 'fr')).toBe('93 L · 0,093 m³')
    expect(formatVolume(999, 'fr')).toBe('999 L · 0,999 m³')
    expect(formatVolume(1000, 'fr')).toBe('1 000 L · 1,00 m³')
    expect(formatVolume(7545, 'fr')).toBe('7 545 L · 7,55 m³')
    expect(formatVolume(1234567, 'en')).toBe('1,234,567 L · 1,234.57 m³')
    // an EXACTLY zero volume stays "0 L" alone: the m3 teaches nothing there
    expect(formatVolume(0, 'fr')).toBe('0 L')
  })
  it('volume axis: a single unit for the whole axis, never glued to the tick', () => {
    // same threshold as formatVolume (1000 L): below it the axis stays in L, beyond it switches to m³
    expect(volumeAxisUnit(999)).toBe('L')
    expect(volumeAxisUnit(1000)).toBe('m³')
    expect(formatVolumeAxisTick(120, 'L', 'fr')).toBe('120')
    expect(formatVolumeAxisTick(5000, 'm³', 'fr')).toBe('5')
    expect(formatVolumeAxisTick(1500, 'm³', 'fr')).toBe('1,5')
  })
  it('picks icons and colors from state', () => {
    const d: DeviceDescriptor = { ...sensor, kind: 'light', capabilities: ['on_off'], meta: {} }
    expect(deviceIcon(d, { ...light, on: true })).not.toBe(deviceIcon(d, light))
    expect(deviceColor({ ...light, on: true })).toBe('warning')
    expect(deviceColor({ ...light, available: false })).toBe('on-surface-variant')
  })
})

describe('room filter', () => {
  it('sets heating and the temperature probe apart, the rest like the rail', () => {
    expect(roomFilterCategory('light')).toBe('light')
    expect(roomFilterCategory('cover')).toBe('cover')
    expect(roomFilterCategory('climate')).toBe('climate')
    expect(roomFilterCategory('media_player')).toBe('media')
    expect(roomFilterCategory('camera')).toBe('camera')
    expect(roomFilterCategory('vacuum')).toBe('other')
    expect(roomFilterCategory(undefined)).toBe('other')
    expect(roomFilterCategory('sensor', { ...sensor, kind: 'sensor' })).toBe('climate')
    expect(roomFilterCategory('sensor', { ...sensor, kind: 'sensor', meta: { sensor: { unit: '%', deviceClass: 'humidity', precision: 0 } } })).toBe('other')
  })
  it('only keeps the categories present, in tab order', () => {
    expect(presentRoomFilters(['other', 'media', 'light', 'light'])).toEqual(['light', 'media', 'other'])
    expect(presentRoomFilters([])).toEqual([])
  })
})

describe('i18n locales', () => {
  const keys = (o: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]))
  it('fr and en expose the same keys', () => {
    const a = keys(fr).sort(), b = keys(en).sort()
    expect(a).toEqual(b)
  })
})

describe('vehicle map (lib/map)', () => {
  const home = { lat: 45.1885, lon: 5.7245 }
  it('car near the house: both in the frame; far: the car alone at neighborhood zoom', () => {
    const near = { lat: 45.19, lon: 5.726 }
    expect(initialView(near, home)).toEqual({ kind: 'bounds', sw: { lat: 45.1885, lon: 5.7245 }, ne: { lat: 45.19, lon: 5.726 } })
    const far = { lat: 45.171, lon: 5.7211 }                 // ~2 km
    expect(initialView(far, home).kind).toBe('bounds')
    const away = { lat: 45.0, lon: 5.0 }                     // ~60 km
    expect(initialView(away, home)).toEqual({ kind: 'center', center: away, zoom: CAR_ZOOM })
    expect(BOTH_MAX_M).toBeGreaterThan(2000)
  })
  it('without a car: the house; without anything: nothing', () => {
    expect(initialView(undefined, home)).toEqual({ kind: 'center', center: home, zoom: CAR_ZOOM })
    expect(initialView(undefined, undefined)).toEqual({ kind: 'none' })
  })
  it('the plan follows the theme, the satellite is an IGN raster source without a key', () => {
    expect(planStyleUrl(false)).toContain('/liberty')
    expect(planStyleUrl(true)).toContain('/dark')
    expect(IGN_ORTHO_TILE_URL).toContain('HR.ORTHOIMAGERY.ORTHOPHOTOS')
    expect(IGN_ORTHO_TILE_URL).not.toMatch(/apikey|key=/i)
    const st = satelliteStyle()
    expect(st.layers[0]).toMatchObject({ type: 'raster', source: 'ign' })
  })
  it('the satellite keeps the plan\'s LABELS, and nothing of its geometry', () => {
    // a plan style reduced to the essentials: a vector source, a background, roads, names
    const plan = {
      version: 8 as const,
      glyphs: 'https://exemple/{fontstack}/{range}.pbf',
      sprite: 'https://exemple/sprite',
      sources: { openmaptiles: { type: 'vector' as const, url: 'https://exemple/tiles.json' } },
      layers: [
        { id: 'fond', type: 'background' as const, paint: {} },
        { id: 'routes', type: 'line' as const, source: 'openmaptiles', 'source-layer': 'transportation' },
        { id: 'nom-ville', type: 'symbol' as const, source: 'openmaptiles', 'source-layer': 'place' },
        { id: 'nom-rue', type: 'symbol' as const, source: 'openmaptiles', 'source-layer': 'transportation_name' },
      ],
    }
    const st = satelliteStyleWithLabels(plan)
    // the photo first, the names on top: the order of the layers IS the stacking
    expect(st.layers[0]).toMatchObject({ type: 'raster', source: 'ign' })
    expect(st.layers.map((l) => l.id)).toEqual(['ign', 'nom-ville', 'nom-rue'])
    // neither background nor roads: they would mask the orthophoto
    expect(st.layers.some((l) => l.type === 'background' || l.type === 'line')).toBe(false)
    // fonts, icons and vector source follow, otherwise no label gets drawn
    expect(st.glyphs).toBe(plan.glyphs)
    expect(st.sprite).toBe(plan.sprite)
    expect(st.sources).toHaveProperty('openmaptiles')
  })
  it('the heading normalizes into [0, 360[', () => {
    expect(normalizeHeading(372)).toBe(12)
    expect(normalizeHeading(-90)).toBe(270)
    expect(normalizeHeading(360)).toBe(0)
  })
})

describe('bodywork color', () => {
  const car = (color?: string) => ({ meta: color ? { vehicle: { color } } : {} } as DeviceDescriptor)

  it('the manual setting wins, and clearing it falls back on what the plugin deduced', () => {
    // The plugin knows, the user said nothing: we paint what we know.
    expect(bodyColorOf(car('#14171a'), {})).toBe('#14171a')
    // The user has decided: a wrap or a repaint contradict the factory, the user wins.
    expect(bodyColorOf(car('#14171a'), { bodyColor: '#c8102e' })).toBe('#c8102e')
    // Cleared — and we FALL BACK on the plugin's info, not on the scene's gray.
    expect(bodyColorOf(car('#14171a'), { bodyColor: undefined })).toBe('#14171a')
    // Nobody knows: the scene applies its vehicle color, which follows the theme.
    expect(bodyColorOf(car(), {})).toBeUndefined()
    expect(bodyColorOf(undefined, undefined)).toBeUndefined()
  })

  it('the finish follows the same rule, and decides the material\'s rendering', () => {
    const matte = { meta: { vehicle: { finish: 'matte' } } } as DeviceDescriptor
    expect(bodyFinishOf(matte, {})).toBe('matte')
    expect(bodyFinishOf(matte, { bodyFinish: 'solid' })).toBe('solid')
    expect(bodyFinishOf(matte, { bodyFinish: undefined })).toBe('matte')
    // Nothing known: the finish the scene's material already carries, so nothing changes.
    expect(bodyFinishOf(undefined, undefined)).toBe(SCENE_FINISH)
    // A matte paint DIFFUSES: it is the roughness that sets it apart, and the gap must be clear.
    expect(FINISH_MATERIAL.matte.roughness).toBeGreaterThan(FINISH_MATERIAL.metallic.roughness + 0.4)
    expect(FINISH_MATERIAL.solid.metalness).toBeLessThan(FINISH_MATERIAL.metallic.metalness)
  })
})

describe('isDaylight', () => {
  const geo = { lat: 47.3, lon: 5.04 }                 // the reference house, in Burgundy
  const sunrise = Date.parse('2026-06-21T03:47:00Z')
  const sunset = Date.parse('2026-06-21T19:37:00Z')
  const at = (iso: string) => new Date(Date.parse(iso))

  it('the weather\'s hours win, with the half hour of twilight on each side', () => {
    // We stay DARK half an hour after sunrise, and go back to it half an hour before sunset.
    expect(isDaylight({ now: new Date(sunrise + TWILIGHT_MS - 60_000), sunrise, sunset, geo })).toBe(false)
    expect(isDaylight({ now: new Date(sunrise + TWILIGHT_MS + 60_000), sunrise, sunset, geo })).toBe(true)
    expect(isDaylight({ now: new Date(sunset - TWILIGHT_MS - 60_000), sunrise, sunset, geo })).toBe(true)
    expect(isDaylight({ now: new Date(sunset - TWILIGHT_MS + 60_000), sunrise, sunset, geo })).toBe(false)
  })

  it('without weather, the sun computed locally — and the same margin, expressed in height', () => {
    expect(isDaylight({ now: at('2026-06-21T10:00:00Z'), geo })).toBe(true)     // 58°: full daylight
    expect(isDaylight({ now: at('2026-06-21T22:00:00Z'), geo })).toBe(false)    // below the horizon
    // The sun is UP (4.3°) but we keep dark: it is the half hour of margin.
    expect(isDaylight({ now: at('2026-06-21T04:20:00Z'), geo })).toBe(false)
    // …and we go back to dark while it is still at 4.8°, half an hour before setting.
    expect(isDaylight({ now: at('2026-06-21T19:00:00Z'), geo })).toBe(false)
    expect(isDaylight({ now: at('2026-12-21T12:00:00Z'), geo })).toBe(true)     // 19° in midwinter
  })

  it('a mute weather (hours at zero) does not take precedence over the computation', () => {
    expect(isDaylight({ now: at('2026-06-21T10:00:00Z'), sunrise: 0, sunset: 0, geo })).toBe(true)
  })

  it('house without a GPS origin: the typical 7 am - 9 pm day, browser time', () => {
    expect(isDaylight({ now: new Date(2026, 5, 21, 12, 0) })).toBe(true)
    expect(isDaylight({ now: new Date(2026, 5, 21, 8, 0) })).toBe(true)
    expect(isDaylight({ now: new Date(2026, 5, 21, 7, 10) })).toBe(false)       // just risen
    expect(isDaylight({ now: new Date(2026, 5, 21, 23, 0) })).toBe(false)
  })
})

describe('consumption history (lib/consumption)', () => {
  const NOW = Date.now()
  // real hours, as the server stamps them: `setHours` would fall twice on the same hour the day the clocks go back
  const hourStart = (offsetH: number) => new Date(NOW).setMinutes(0, 0, 0) - offsetH * 3600_000
  const dayStart = (offsetD: number) => { const d = new Date(NOW); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offsetD); return d.getTime() }
  const monthStart = (offsetM: number) => { const d = new Date(NOW); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - offsetM); return d.getTime() }
  const consumption = (over: Partial<DeviceConsumption> = {}): DeviceConsumption => ({ deviceId: 'comap:station', hourly: [], daily: [], monthly: [], ...over })

  it('each period reads its contract series; week and month share daily', () => {
    const c = consumption({ hourly: [{ t: 1, litres: 2 }], daily: [{ t: 3, litres: 4 }], monthly: [{ t: 5, litres: 6 }] })
    expect(seriesFor(c, 'day')).toBe(c.hourly)
    expect(seriesFor(c, 'week')).toBe(c.daily)
    expect(seriesFor(c, 'month')).toBe(c.daily)
    expect(seriesFor(c, 'year')).toBe(c.monthly)
    expect(seriesFor(null, 'day')).toEqual([])
  })

  it('always 24 columns; a step never measured stays null, distinct from a step measured at zero', () => {
    const points: ConsumptionPoint[] = [
      { t: hourStart(23), litres: 10 },
      // -22 h deliberately absent: server silence, not a zero consumption
      { t: hourStart(21), litres: 0 },
      { t: hourStart(0), litres: 5 },
    ]
    const slots = bucketSlots(points, 'day', NOW)
    expect(slots).toHaveLength(24)
    expect(slots[0]).toMatchObject({ litres: 10 })
    expect(slots[1]!.litres).toBeNull()
    expect(slots[2]).toMatchObject({ litres: 0 })     // measured at zero: NOT the same as absence
    expect(slots[23]).toMatchObject({ litres: 5 })
    expect(slots[0]!.t).toBeLessThan(slots[23]!.t)    // from oldest to most recent
  })

  it('week = 7 columns, month = 31: both read daily, only the number of columns changes', () => {
    const daily: ConsumptionPoint[] = [{ t: dayStart(0), litres: 120 }, { t: dayStart(2), litres: 90 }]
    expect(bucketSlots(daily, 'week', NOW)).toHaveLength(7)
    expect(bucketSlots(daily, 'month', NOW)).toHaveLength(31)
    const week = bucketSlots(daily, 'week', NOW)
    expect(week[6]).toMatchObject({ litres: 120 })    // today
    expect(week[5]!.litres).toBeNull()                // yesterday: nothing measured
    expect(week[4]).toMatchObject({ litres: 90 })     // the day before yesterday
  })

  it('year = 12 columns of CALENDAR MONTHS, not 30-day slices', () => {
    const monthly: ConsumptionPoint[] = [{ t: monthStart(0), litres: 7500 }, { t: monthStart(1), litres: 7000 }]
    const slots = bucketSlots(monthly, 'year', NOW)
    expect(slots).toHaveLength(12)
    expect(slots[11]).toMatchObject({ litres: 7500 })
    expect(slots[10]).toMatchObject({ litres: 7000 })
    expect(slots[9]!.litres).toBeNull()
  })

  it('total and maximum ignore absent steps; the maximum is floored at 1 to never divide by zero', () => {
    const slots = bucketSlots([{ t: hourStart(0), litres: 40 }], 'day', NOW)
    expect(slotsTotal(slots)).toBe(40)
    expect(slotsMax(slots)).toBe(40)
    expect(slotsTotal(bucketSlots([], 'day', NOW))).toBe(0)
    expect(slotsMax(bucketSlots([], 'day', NOW))).toBe(1)
  })

  it('axis tick: round values, never the raw maximum, never beyond it', () => {
    // the visual language's example: 12,396 real maximum -> ticks 5,000 / 10,000, not 12,396
    expect(niceAxisTicks(12396)).toEqual([5000, 10000])
    expect(niceAxisTicks(40)).toEqual([10, 20, 30, 40])
    expect(niceAxisTicks(0)).toEqual([])
  })
})
