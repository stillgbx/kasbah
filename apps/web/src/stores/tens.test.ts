import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTensStore, CHECK_SETTLE_MS, RAMP_INTERVAL_MS } from './tens'
import { FakeTens, fakeBluetooth } from '../lib/tens/fakeTens'
import { CMD, programFrame } from '../lib/tens/protocol'
import { INTENSITY_MAX } from '../lib/tens/programs'
import { TensLink } from '../lib/tens/link'

// Le store TENS contre un faux appareil qui refuse comme le vrai : ordre des trames d'un lancement,
// file des intensités (consigne / acquis), plafond, pause / reprise, et l'arrêt qui l'emporte sur tout.

let dev: FakeTens

function installBluetooth(known = false) {
  Object.defineProperty(navigator, 'bluetooth', { value: fakeBluetooth(dev, known), configurable: true })
}

async function connected() {
  const tens = useTensStore()
  await tens.connect()
  expect(tens.status).toBe('connected')
  return tens
}

async function running() {
  const tens = await connected()
  const p = tens.startProgram('p3', 10, 3)
  await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100)
  await p
  expect(tens.running).toBe(true)
  return tens
}

/** Laisse la file travailler `n` créneaux. */
const slots = (n: number) => vi.advanceTimersByTimeAsync(RAMP_INTERVAL_MS * n + 10)
const intensities = (ch?: 1 | 2) => dev.frames(CMD.intensity).filter((f) => !ch || f[4] === ch).map((f) => f[5]! | (f[6]! << 8))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  setActivePinia(createPinia())
  dev = new FakeTens()
  installBluetooth()
})
afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'bluetooth')
})

describe('connection', () => {
  it('connects, reads the battery, says hello and remembers the device', async () => {
    const tens = await connected()
    expect(tens.battery).toEqual({ charging: false, millivolts: 4000, percent: 89 })
    expect(tens.deviceName).toBe('acTENSv2_015A9F')
    expect(dev.frames(CMD.hello)).toHaveLength(1)
    expect(tens.knownDeviceId).toBe('fake-tens')
  })

  it('forgets the battery level once disconnected', async () => {
    const tens = await connected()
    tens.disconnect()
    expect(tens.battery).toBeNull()
  })

  it('reports an unsupported browser instead of throwing', async () => {
    Reflect.deleteProperty(navigator, 'bluetooth')
    const tens = useTensStore()
    expect(tens.supported).toBe(false)
    await tens.connect()
    expect(tens.error).toBe('tens.errors.unsupported')
  })

  it('goes straight to the remembered device, without the chooser', async () => {
    localStorage.setItem('kasbah.tens.deviceId', JSON.stringify('fake-tens'))
    const bt = { requestDevice: vi.fn(), getDevices: async () => [dev] }
    Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true })
    const tens = useTensStore()
    await tens.connect()
    expect(tens.status).toBe('connected')
    expect(bt.requestDevice).not.toHaveBeenCalled()
  })

  it('filters the chooser on the TENS name by default', async () => {
    const bt = { requestDevice: vi.fn(async () => dev) }
    Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true })
    await useTensStore().connect()
    expect(bt.requestDevice).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ namePrefix: 'acTENS' }] }))
  })

  it('opens the unfiltered chooser when asked for another device', async () => {
    localStorage.setItem('kasbah.tens.deviceId', JSON.stringify('fake-tens'))
    const bt = { requestDevice: vi.fn(async () => dev), getDevices: async () => [dev] }
    Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true })
    const tens = useTensStore()
    await tens.connect(true)
    expect(bt.requestDevice).toHaveBeenCalledWith(expect.objectContaining({ acceptAllDevices: true }))
  })

  it('reconnects silently to the remembered device', async () => {
    localStorage.setItem('kasbah.tens.deviceId', JSON.stringify('fake-tens'))
    installBluetooth(true)
    const tens = useTensStore()
    await tens.reconnect()
    expect(tens.status).toBe('connected')
  })

  it('reconnect does nothing without a remembered device', async () => {
    installBluetooth(true)
    const tens = useTensStore()
    await tens.reconnect()
    expect(tens.status).toBe('disconnected')
  })

  it('goes back to disconnected when the radio drops', async () => {
    const tens = await running()
    dev.drop()
    expect(tens.status).toBe('disconnected')
    expect(tens.battery).toBeNull()
    tens.setIntensity(1, 10)
    await slots(3)
    expect(intensities()).toEqual([])
  })
})

describe('launch', () => {
  it('launches a program in the order the phone app does', async () => {
    const tens = await running()
    expect(dev.written.map((f) => f[2])).toEqual([CMD.hello, CMD.check, CMD.program, CMD.start, CMD.register])
    expect(dev.frames(CMD.check)[0]![4]).toBe(3)                                     // les deux canaux
    expect(dev.frames(CMD.start)[0]!.slice(4, 6)).toEqual(Uint8Array.of(0x58, 0x02)) // 600 s
    expect(tens.currentProgram).toBe('p3')
    expect(tens.remainingS).toBe(600)
  })

  it('sends every segment of a multi-segment program with its segment count', async () => {
    const tens = await connected()
    const p = tens.startProgram('p9', 30, 1)
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100)
    await p
    expect(dev.frames(CMD.program).map((f) => f[6])).toEqual([1, 2, 3, 4])
    expect(dev.frames(CMD.program).every((f) => f[5] === 4)).toBe(true)
    expect(dev.frames(CMD.check)[0]![4]).toBe(1)
  })

  it('ramps up on its own to the intensities given at launch, on the channels in use only', async () => {
    const tens = await connected()
    const p = tens.startProgram('p3', 10, 1, { 1: 20, 2: 50 })
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100)
    await p
    await slots(6)
    expect(intensities(1)).toEqual([5, 10, 15, 20])         // par paliers de 0,5 mA, pas d'un coup
    expect(intensities(2)).toEqual([])                     // canal 2 hors séance : rien
    expect(tens.targetOf(2)).toBe(0)
  })

  it('a launch target never exceeds the cap, and a gesture replaces it', async () => {
    const tens = await connected()
    const p = tens.startProgram('p3', 10, 3, { 1: INTENSITY_MAX + 100, 2: 0 })
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100)
    await p
    expect(tens.targetOf(1)).toBe(INTENSITY_MAX)
    await slots(2)
    tens.setIntensity(1, 5)
    await slots(3)
    expect(tens.acquiredOf(1)).toBe(5)
  })

  it('refuses to launch over a running session', async () => {
    const tens = await running()
    await tens.startProgram('p6', 60)
    expect(dev.frames(CMD.start)).toHaveLength(1)
  })

  it('names the refusal of a TENS that is not on the skin', async () => {
    dev.electrodes = false
    const tens = await connected()
    const p = tens.startProgram('p3', 10)
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100)
    await p
    expect(tens.error).toBe('tens.errors.electrodes')
    expect(dev.frames(CMD.start)).toHaveLength(0)
    expect(tens.running).toBe(false)
  })

  it('stop pressed during a launch prevents the start', async () => {
    const tens = await connected()
    const p = tens.startProgram('p6', 60)
    await vi.advanceTimersByTimeAsync(100)   // vérification des électrodes envoyée, on attend
    await tens.stop()
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS)
    await p
    expect(dev.frames(CMD.program)).toHaveLength(0)
    expect(dev.frames(CMD.start)).toHaveLength(0)
    expect(tens.error).toBeNull()
  })

  it('counts down between two session notifications', async () => {
    const tens = await running()
    await vi.advanceTimersByTimeAsync(5000)
    // l'horloge de la page bat à la seconde, sans être calée sur la notification : ±1 s
    expect(tens.remainingS).toBeGreaterThanOrEqual(595)
    expect(tens.remainingS).toBeLessThanOrEqual(596)
  })
})

describe('intensity queue', () => {
  it('climbs 0.5 mA per slot towards the target', async () => {
    const tens = await running()
    tens.setIntensity(1, 20)
    expect(tens.targetOf(1)).toBe(20)
    await slots(0)
    expect(intensities()).toEqual([5])
    expect(tens.acquiredOf(1)).toBe(5)
    await slots(3)
    expect(intensities()).toEqual([5, 10, 15, 20])
    expect(tens.acquiredOf(1)).toBe(20)
  })

  it('adds up fast clicks on the target, and the TENS catches up', async () => {
    const tens = await running()
    for (let i = 0; i < 6; i++) tens.nudge(1, 1)     // six clics d'affilée
    expect(tens.targetOf(1)).toBe(30)
    await slots(8)
    expect(intensities()).toEqual([5, 10, 15, 20, 25, 30])
    expect(tens.acquiredOf(1)).toBe(30)
  })

  it('follows a target lowered mid-climb straight down', async () => {
    const tens = await running()
    tens.setIntensity(1, 50)
    await slots(1)                                     // 5 puis 10
    tens.setIntensity(1, 0)
    await slots(5)
    expect(intensities()).toEqual([5, 10, 0])
    expect(tens.acquiredOf(1)).toBe(0)
  })

  it('never goes past the cap', async () => {
    const tens = await running()
    tens.setIntensity(1, INTENSITY_MAX + 100)
    expect(tens.targetOf(1)).toBe(INTENSITY_MAX)
    await slots(70)
    expect(Math.max(...intensities())).toBe(INTENSITY_MAX)
  })

  it('keeps the target through "too soon" refusals and retries on the next slot', async () => {
    const tens = await running()
    dev.refuseIntensity = 2
    tens.setIntensity(1, 10)
    await slots(5)
    expect(tens.error).toBeNull()
    expect(dev.ch[1]).toBe(10)
    expect(tens.acquiredOf(1)).toBe(10)
  })

  it('gives up on a refusal that never ends and shows what the TENS really has', async () => {
    const tens = await running()
    tens.setIntensity(1, 5)
    await slots(1)
    dev.refuseIntensity = 100
    tens.setIntensity(1, 20)
    await slots(15)
    expect(tens.error).toBe('tens.errors.refused')
    expect(tens.errorDetail).toBe('code 0x33')
    expect(tens.targetOf(1)).toBe(5)
    expect(tens.acquiredOf(1)).toBe(5)
  })

  it('spaces commands 300 ms apart across both channels, alternating them', async () => {
    const tens = await running()
    tens.setIntensity(1, 15)
    tens.setIntensity(2, 15)
    await slots(8)
    const gaps = dev.intensityAt.slice(1).map((t, i) => t - dev.intensityAt[i]!)
    expect(dev.frames(CMD.intensity).map((f) => f[4])).toEqual([1, 2, 1, 2, 1, 2])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(RAMP_INTERVAL_MS)
  })

  it('stop empties the queue and resets both values', async () => {
    const tens = await running()
    tens.setIntensity(1, 50)
    await slots(0)
    await tens.stop()
    await slots(10)
    expect(intensities()).toEqual([5])
    expect(dev.frames(CMD.register).map((f) => f[5])).toEqual([0xff, 0])
    expect(tens.active).toBe(false)
    expect(tens.targetOf(1)).toBe(0)
  })

  it('pause zeroes the channels and resume climbs back to the targets', async () => {
    const tens = await running()
    tens.setIntensity(1, 15)
    await slots(3)
    await tens.pause()
    expect(tens.paused).toBe(true)
    expect(tens.acquiredOf(1)).toBe(0)
    const back = tens.resume()
    await slots(4)
    await back
    expect(intensities(1)).toEqual([5, 10, 15, 5, 10, 15])
    expect(tens.acquiredOf(1)).toBe(15)
  })

  it('ignores intensity requests when no session runs', async () => {
    const tens = await connected()
    tens.setIntensity(1, 20)
    await slots(3)
    expect(intensities()).toEqual([])
    expect(tens.targetOf(1)).toBe(0)
  })

  it('surfaces a command the device does not answer', async () => {
    const tens = await running()
    dev.silent.add(CMD.pause)
    const p = tens.pause()
    await vi.advanceTimersByTimeAsync(3000)
    await p
    expect(tens.error).toBe('tens.errors.command')
    expect(tens.busy).toBe(false)
  })
})

describe('tens link refusals', () => {
  it('fails a refused command at once instead of waiting for the timeout', async () => {
    const link = new TensLink(dev, { onBattery: () => {}, onSession: () => {}, onDisconnect: () => {} })
    await link.open()
    const res = link.send(programFrame(0x54, 0x49, new Uint8Array(14))).catch((e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(0)
    expect(await res).toBe('refused:5')
  })
})
