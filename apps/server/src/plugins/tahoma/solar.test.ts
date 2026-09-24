import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { SETUP, SOLAR_SHUTTER, SUN_SENSOR } from './__fixtures__/box'
import { LightHistory, type LightHistoryState } from './history'
import { createTahomaPlugin, tahomaConfigSchema } from './index'
import { isLightSensor, readStates, toAction, toCoverPatch, toDescriptor, toLightSensorDescriptor, coverCommands } from './mapping'
import { overkizDeviceSchema } from './types'

// Volets solaires : leur capteur de luminosité, son historique, et le mode discret (vitesse lente).

const H = 3_600_000
const shutter = overkizDeviceSchema.parse(SOLAR_SHUTTER)
const sensor = overkizDeviceSchema.parse(SUN_SENSOR)
const SENSOR_ID = 'io.1234-5678-9012.44440001.2'
const SHUTTER_ID = 'io.1234-5678-9012.44440001.1'

describe('tahoma solar mapping', () => {
  it('turns the panel into an illuminance sensor linked to its shutter', () => {
    expect(isLightSensor(sensor)).toBe(true)
    expect(isLightSensor(shutter)).toBe(false)
    expect(toLightSensorDescriptor(sensor, `tahoma:${SHUTTER_ID}`)).toMatchObject({
      id: `tahoma:${SENSOR_ID}`, kind: 'sensor', name: 'Volet bureau · luminosité', capabilities: ['measure'],
      meta: { sensor: { unit: 'lx', deviceClass: 'illuminance' }, linkedTo: `tahoma:${SHUTTER_ID}` },
    })
  })

  it('declares quiet only where the box knows the linear-speed command', () => {
    expect(toDescriptor(shutter).capabilities).toContain('quiet')
  })

  it('reads the battery of a solar motor', () => {
    expect(toDescriptor(shutter).capabilities).toContain('battery')
    expect(toCoverPatch(readStates(shutter.states))).toMatchObject({ batteryPct: 100 })
  })

  it('quiet mode sends every travel through setClosureAndLinearSpeed, in CLOSURE', () => {
    const cmds = coverCommands(shutter)
    const url = SOLAR_SHUTTER.deviceURL
    const slow = (closure: number) => ({ deviceURL: url, commands: [{ name: 'setClosureAndLinearSpeed', parameters: [closure, 'lowspeed'] }] })
    expect(toAction(url, { type: 'cover.open' }, cmds, true)).toEqual(slow(0))
    expect(toAction(url, { type: 'cover.close' }, cmds, true)).toEqual(slow(100))
    expect(toAction(url, { type: 'cover.set_position', position: 30 }, cmds, true)).toEqual(slow(70))
    // pas d'équivalent lent : l'arrêt et le rappel « my » gardent leur commande
    expect(toAction(url, { type: 'cover.stop' }, cmds, true)?.commands[0]?.name).toBe('stop')
    expect(toAction(url, { type: 'cover.preset' }, cmds, true)?.commands[0]?.name).toBe('my')
    // hors mode discret, rien ne change
    expect(toAction(url, { type: 'cover.open' }, cmds, false)?.commands[0]?.name).toBe('open')
  })
})

describe('light history', () => {
  it('keeps the maximum per hour and per day', () => {
    const h = new LightHistory()
    const t0 = new Date(2026, 8, 24, 10, 0).getTime()
    h.record('s', 800, t0)
    h.record('s', 4000, t0 + 20 * 60_000)
    h.record('s', 1500, t0 + 40 * 60_000)
    const snap = h.snapshot('s', t0 + 50 * 60_000)!
    expect(snap.hourly).toEqual([{ t: t0, maxLux: 4000 }])
    expect(snap.daily).toEqual([{ t: new Date(2026, 8, 24).getTime(), maxLux: 4000 }])
  })

  it('carries the last value over hours without a frame, as long as this process saw them', () => {
    const h = new LightHistory()
    const t0 = new Date(2026, 8, 24, 20, 0).getTime()
    h.record('s', 0, t0)                                    // la nuit tombe : plus aucune trame
    expect(h.advance(t0 + 3 * H + 5)).toBe(true)            // trois heures ouvertes sans trame
    expect(h.snapshot('s', t0 + 3 * H + 5)!.hourly.map((p) => p.t)).toEqual([t0, t0 + H, t0 + 2 * H, t0 + 3 * H])
  })

  it('leaves the hours before a restart ABSENT rather than at zero', () => {
    const t0 = new Date(2026, 8, 24, 8, 0).getTime()
    const before: LightHistoryState = { sensors: { s: { hourly: [{ t: t0, maxLux: 900 }], daily: [] } } }
    const h = new LightHistory(before)                      // serveur redémarré trois heures plus tard
    h.record('s', 3000, t0 + 3 * H)
    expect(h.snapshot('s', t0 + 3 * H)!.hourly).toEqual([{ t: t0, maxLux: 900 }, { t: t0 + 3 * H, maxLux: 3000 }])
  })

  it('derives the months from the days', () => {
    const h = new LightHistory({ sensors: { s: { hourly: [], daily: [
      { t: new Date(2026, 7, 30).getTime(), maxLux: 9000 },
      { t: new Date(2026, 7, 31).getTime(), maxLux: 7000 },
      { t: new Date(2026, 8, 1).getTime(), maxLux: 4000 },
    ] } } })
    expect(h.snapshot('s', new Date(2026, 8, 1, 12).getTime())!.monthly).toEqual([
      { t: new Date(2026, 7, 1).getTime(), maxLux: 9000 },
      { t: new Date(2026, 8, 1).getTime(), maxLux: 4000 },
    ])
  })
})

const json = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, body: null, json: async () => data, text: async () => JSON.stringify(data) })

describe('tahoma plugin with solar shutters', () => {
  async function started(events: unknown[] = [], setup: unknown = SETUP, save: (s: LightHistoryState) => Promise<void> = async () => {}) {
    const applied: { actions: unknown }[] = []
    let served = 0
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      const path = url.replace(/^https:\/\/[^/]+\/enduser-mobile-web\/1\/enduserAPI/, '')
      if (path === '/apiVersion') return json({ protocolVersion: '2026.3.3-7' })
      if (path === '/setup') return json(setup)
      if (path === '/events/register') return json({ id: 'l1' })
      if (path === '/events/l1/fetch') return json(++served === 1 ? events : [])
      if (path === '/exec/apply') { applied.push(JSON.parse(String(init?.body)) as { actions: unknown }); return json({ execId: 'e1' }) }
      return json({})
    })
    const clock = new ManualClock(new Date(2026, 8, 24, 12, 0).getTime())
    const ctx: PluginContext = {
      pluginId: 'tahoma', logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
      config: tahomaConfigSchema.parse({ TAHOMA_HOST: 'box', TAHOMA_TOKEN: 't', TAHOMA_QUIET_FILE: '' }),
      emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
      parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
    }
    const saved: LightHistoryState[] = []
    const plugin = createTahomaPlugin({ fetchImpl, lightHistoryStore: { load: async () => null, save: async (s) => { saved.push(s); await save(s) } } })
    await plugin.init(ctx)
    const descriptors = await plugin.discover()
    await plugin.start()
    return { plugin, ctx, clock, descriptors, applied, saved }
  }

  it('publishes the luminance and follows its frames', async () => {
    const frame = { name: 'DeviceStateChangedEvent', deviceURL: SUN_SENSOR.deviceURL, deviceStates: [{ name: 'core:LuminanceState', type: 1, value: '3800' }] }
    const { plugin, ctx, clock, descriptors } = await started([frame])
    expect(descriptors.find((d) => d.id === `tahoma:${SENSOR_ID}`)?.meta.linkedTo).toBe(`tahoma:${SHUTTER_ID}`)
    expect(ctx.emitState).toHaveBeenCalledWith(SENSOR_ID, { value: 1200 })
    clock.advance(2000)
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.emitState).toHaveBeenCalledWith(SENSOR_ID, { value: 3800 })
    await plugin.stop()
  })

  it('holds the quiet switch and applies it to the next travels', async () => {
    const { plugin, ctx, applied } = await started()
    expect(ctx.emitState).toHaveBeenCalledWith(SHUTTER_ID, { quiet: false })
    await plugin.execute(SHUTTER_ID, { type: 'cover.set_quiet', on: true })
    expect(applied).toHaveLength(0)                         // basculer le mode ne bouge rien
    expect(ctx.emitState).toHaveBeenCalledWith(SHUTTER_ID, { quiet: true })
    await plugin.execute(SHUTTER_ID, { type: 'cover.close' })
    expect(applied[0]?.actions).toEqual([{ deviceURL: SOLAR_SHUTTER.deviceURL, commands: [{ name: 'setClosureAndLinearSpeed', parameters: [100, 'lowspeed'] }] }])
    await plugin.execute(SHUTTER_ID, { type: 'cover.set_quiet', on: false })
    await plugin.execute(SHUTTER_ID, { type: 'cover.close' })
    expect(applied[1]?.actions).toEqual([{ deviceURL: SOLAR_SHUTTER.deviceURL, commands: [{ name: 'close', parameters: [] }] }])
    await plugin.stop()
  })

  it('never writes the history twice at once, even when every sensor opens its hour together', async () => {
    const more = [2, 3, 4].map((n) => ({ ...SUN_SENSOR, deviceURL: `io://1234-5678-9012/4444000${n}#2` }))
    let inFlight = 0
    let overlap = false
    const slowSave = async () => {
      inFlight++
      if (inFlight > 1) overlap = true
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    }
    const { plugin, saved } = await started([], { devices: [...SETUP.devices, ...more] }, slowSave)
    await plugin.stop()
    expect(overlap).toBe(false)
    // quatre capteurs ouvrent leur heure dans la même passe : une écriture, plus une de rattrapage
    expect(saved.length).toBeLessThanOrEqual(3)
  })

  it('refuses quiet mode on a motor without linear speed', async () => {
    const { plugin } = await started()
    await expect(plugin.execute('io.1234-5678-9012.11110001', { type: 'cover.set_quiet', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await plugin.stop()
  })
})
