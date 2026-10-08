import { z } from 'zod'

// Schémas du plugin Tuya. La configuration porte id + clé + IP ensemble : ils sont
// indissociables par appareil, et la découverte par broadcast est inutilisable ici
// (voir doc 3_18_tuya / plan d'implémentation).

/** Un appareil physique déclaré dans `TUYA_DEVICES`. */
export const tuyaDeviceConfigSchema = z.object({
  id: z.string().trim().min(1),
  /** Clé locale 16 caractères — jamais loguée. */
  key: z.string().min(1),
  ip: z.string().trim().min(1),
  /** Nom de l'objet PHYSIQUE (« Ventilateur plafonnier Bureau ») — les kinds en dérivent le leur. */
  name: z.string().trim().min(1),
  /** Protocole local. Le CREATE exige 3.5 (3.4 refuse la connexion). */
  version: z.string().trim().default('3.5'),
})
export type TuyaDeviceConfig = z.infer<typeof tuyaDeviceConfigSchema>

/** Parse `TUYA_DEVICES` (JSON tableau). Chaîne vide → aucun appareil. */
export function parseTuyaDevices(raw: string): TuyaDeviceConfig[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch {
    throw new Error('TUYA_DEVICES must be a JSON array')
  }
  return z.array(tuyaDeviceConfigSchema).parse(parsed)
}

/** Trame DP telle que `tuyapi` la pousse (`data` / `dp-refresh`). */
export type TuyaDps = Record<string, unknown>
