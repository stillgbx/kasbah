import { z } from 'zod'

// Schemas of the Tuya plugin. The configuration carries id + key + IP together: they are
// inseparable per device, and broadcast discovery is unusable here
// (see doc 3_18_tuya / implementation plan).

/** A physical device declared in `TUYA_DEVICES`. */
export const tuyaDeviceConfigSchema = z.object({
  id: z.string().trim().min(1),
  /** 16-character local key — never logged. */
  key: z.string().min(1),
  ip: z.string().trim().min(1),
  /** Name of the PHYSICAL object ("Office ceiling fan") — the kinds derive theirs from it. */
  name: z.string().trim().min(1),
  /** Local protocol. The CREATE requires 3.5 (3.4 refuses the connection). */
  version: z.string().trim().default('3.5'),
})
export type TuyaDeviceConfig = z.infer<typeof tuyaDeviceConfigSchema>

/** Parses `TUYA_DEVICES` (JSON array). Empty string → no device. */
export function parseTuyaDevices(raw: string): TuyaDeviceConfig[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch {
    throw new Error('TUYA_DEVICES must be a JSON array')
  }
  return z.array(tuyaDeviceConfigSchema).parse(parsed)
}

/** DP frame as `tuyapi` pushes it (`data` / `dp-refresh`). */
export type TuyaDps = Record<string, unknown>
