import type { Command, DeviceDescriptor, DeviceId, FanDirection, StatePatch } from '@kasbah/shared'
import { PluginError } from '../../core/plugin'
import type { TuyaDeviceConfig, TuyaDps } from './types'

// Tuya CREATE mapping (`fsd` category, protocol 3.5) ↔ Kasbah contract.
//
// Two devices per physical machine: a `light` and a `fan` (no shared command — PetKit
// precedent). The DPs were MEASURED for reading and writing; the acknowledgment lies about
// the color temperature (pitfall 2) — hence the plugin-side refusal of values outside the
// three steps, rather than letting the device swallow them.

export const PLUGIN_ID = 'tuya'

/** Accepted speeds (DP 62) — a list, not a range. */
export const FAN_SPEEDS = [1, 2, 3, 4, 5, 6] as const

/**
 * Applicable temperatures, DP 23 → mirek. Only 0 / 500 / 1000 change the state; 250, 750, 137
 * are accepted by the protocol and ignored (measured).
 *
 * Direction MEASURED on the CREATE (2026-09-21, corrected after a UI trial): **0 = cool / white
 * (4000 K), 1000 = warm / yellow (2700 K)** — the reverse of the "naive" Kelvin scale often
 * documented for other Tuya CCT devices.
 */
export const COLOR_TEMP_STEPS: readonly { dp: number; mirek: number; kelvin: number }[] = [
  { dp: 1000, mirek: 370, kelvin: 2700 },
  { dp: 500, mirek: 303, kelvin: 3300 },
  { dp: 0, mirek: 250, kelvin: 4000 },
]

export const COLOR_TEMP_MIREKS = COLOR_TEMP_STEPS.map((s) => s.mirek)

const DP = {
  lightOn: 20,
  colorTemp: 23,
  fanOn: 60,
  speed: 62,
  direction: 63,
  timer: 64,
  mute: 66,
} as const

export function lightExternalId(deviceId: string): string {
  return `${deviceId}_light`
}

export function fanExternalId(deviceId: string): string {
  return `${deviceId}_fan`
}

/**
 * Names derived from the PHYSICAL configuration name. The room lives in `house.json` — don't
 * inject it here ("Bureau › Ventilateur Bureau").
 */
export function deriveNames(physicalName: string): { fan: string; light: string } {
  const m = physicalName.match(/^Ventilateur\s+plafonnier\s+(.+)$/i)
  if (m?.[1]) return { fan: `Ventilateur ${m[1].trim()}`, light: `Plafonnier ${m[1].trim()}` }
  return { fan: physicalName, light: physicalName }
}

/** Two descriptors for one physical device. */
export function toDescriptors(cfg: TuyaDeviceConfig): DeviceDescriptor[] {
  const { fan, light } = deriveNames(cfg.name)
  const lightId = lightExternalId(cfg.id)
  const fanId = fanExternalId(cfg.id)
  const lightDeviceId = `${PLUGIN_ID}:${lightId}` as DeviceId
  return [
    {
      id: lightDeviceId,
      pluginId: PLUGIN_ID,
      externalId: lightId,
      kind: 'light',
      name: light,
      capabilities: ['on_off', 'color_temp'],
      meta: {
        manufacturer: 'CREATE / Tuya',
        model: 'Windcalm-Windstylance Not dimmable',
        colorTempMirekSteps: [...COLOR_TEMP_MIREKS],
      },
    },
    {
      id: `${PLUGIN_ID}:${fanId}`,
      pluginId: PLUGIN_ID,
      externalId: fanId,
      kind: 'fan',
      name: fan,
      capabilities: ['on_off', 'fan_speed', 'fan_direction', 'fan_timer', 'mute'],
      meta: {
        manufacturer: 'CREATE / Tuya',
        model: 'Windcalm-Windstylance Not dimmable',
        fan: { speeds: [...FAN_SPEEDS] },
        linkedTo: lightDeviceId,
      },
    },
  ]
}

/** Physical identifier from a `…_light` / `…_fan` externalId. */
export function physicalIdOf(externalId: string): string | null {
  if (externalId.endsWith('_light')) return externalId.slice(0, -'_light'.length)
  if (externalId.endsWith('_fan')) return externalId.slice(0, -'_fan'.length)
  return null
}

export function isLightExternalId(externalId: string): boolean {
  return externalId.endsWith('_light')
}

export function isFanExternalId(externalId: string): boolean {
  return externalId.endsWith('_fan')
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function asInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined
}

function asDirection(v: unknown): FanDirection | undefined {
  return v === 'forward' || v === 'reverse' ? v : undefined
}

function mirekOfDp(dp: number): number | undefined {
  return COLOR_TEMP_STEPS.find((s) => s.dp === dp)?.mirek
}

function dpOfMirek(mirek: number): number | undefined {
  return COLOR_TEMP_STEPS.find((s) => s.mirek === mirek)?.dp
}

/** DP → light patch (absent keys = unchanged). */
export function toLightPatch(dps: TuyaDps): StatePatch<'light'> {
  const patch: StatePatch<'light'> = {}
  const get = (dp: number) => dps[String(dp)] ?? dps[dp as unknown as keyof TuyaDps]

  const on = asBool(get(DP.lightOn))
  if (on !== undefined) patch.on = on

  const rawTemp = get(DP.colorTemp)
  if (rawTemp !== undefined) {
    const n = asInt(rawTemp)
    if (n !== undefined) {
      const mirek = mirekOfDp(n)
      if (mirek !== undefined) patch.colorTempMirek = mirek
    }
  }
  return patch
}

/** DP → fan patch. */
export function toFanPatch(dps: TuyaDps): StatePatch<'fan'> {
  const patch: StatePatch<'fan'> = {}
  const get = (dp: number) => dps[String(dp)] ?? dps[dp as unknown as keyof TuyaDps]

  const on = asBool(get(DP.fanOn))
  if (on !== undefined) patch.on = on

  const speed = asInt(get(DP.speed))
  if (speed !== undefined) patch.speed = speed

  const direction = asDirection(get(DP.direction))
  if (direction !== undefined) patch.direction = direction

  const timer = asInt(get(DP.timer))
  if (timer !== undefined) patch.timerMin = timer

  const muted = asBool(get(DP.mute))
  if (muted !== undefined) patch.muted = muted

  return patch
}

export type DpWrite = { dps: number; set: unknown }

/**
 * `light.set` → DP writes. Refuses a temperature outside the three steps
 * (`UNSUPPORTED_COMMAND`) rather than letting the device swallow it.
 */
export function lightCommandToDps(cmd: Extract<Command, { type: 'light.set' }>): DpWrite[] {
  const out: DpWrite[] = []
  if (cmd.on !== undefined) out.push({ dps: DP.lightOn, set: cmd.on })
  if (cmd.colorTempMirek !== undefined) {
    const dp = dpOfMirek(cmd.colorTempMirek)
    if (dp === undefined) {
      throw new PluginError(
        'UNSUPPORTED_COMMAND',
        `color temperature ${cmd.colorTempMirek} mirek is not one of ${COLOR_TEMP_MIREKS.join(', ')}`,
      )
    }
    out.push({ dps: DP.colorTemp, set: dp })
  }
  if (cmd.brightness !== undefined || cmd.color !== undefined || cmd.effect !== undefined) {
    throw new PluginError('UNSUPPORTED_COMMAND', 'CREATE light has no brightness, color or effect')
  }
  return out
}

/**
 * `fan.set` → DP writes.
 * Writing the speed SWITCHES ON the fan (pitfall 1) — the optimistic UI-side patch says so too.
 */
export function fanCommandToDps(cmd: Extract<Command, { type: 'fan.set' }>): DpWrite[] {
  const out: DpWrite[] = []
  if (cmd.on !== undefined) out.push({ dps: DP.fanOn, set: cmd.on })
  if (cmd.speed !== undefined) {
    if (!(FAN_SPEEDS as readonly number[]).includes(cmd.speed)) {
      throw new PluginError('UNSUPPORTED_COMMAND', `fan speed ${cmd.speed} is not one of ${FAN_SPEEDS.join(', ')}`)
    }
    out.push({ dps: DP.speed, set: cmd.speed })
  }
  if (cmd.direction !== undefined) out.push({ dps: DP.direction, set: cmd.direction })
  if (cmd.timerMin !== undefined) out.push({ dps: DP.timer, set: cmd.timerMin })
  if (cmd.muted !== undefined) out.push({ dps: DP.mute, set: cmd.muted })
  return out
}

/** Predicate: the accumulated state already contains the expected values after a write. */
export function dpsMatchExpected(current: TuyaDps, writes: DpWrite[]): boolean {
  return writes.every((w) => {
    const v = current[String(w.dps)] ?? current[w.dps as unknown as keyof TuyaDps]
    return v === w.set
  })
}
