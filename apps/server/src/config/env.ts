import { resolve } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../core/paths'

// The server's KASBAH_* variables. Keys specific to a plugin (HUE_*, CAST_*) are validated by the
// plugin itself (see DevicePlugin.configSchema). Which plugins are ACTIVE is not decided here but
// in the house (`house.plugins`), from Settings → Plugins.

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

export const envSchema = z.object({
  KASBAH_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  KASBAH_HOST: z.string().default('0.0.0.0'),
  KASBAH_HOUSE_FILE: z.string().default(resolve(REPO_ROOT, 'house/demo-house.json')),
  KASBAH_STATIC_DIR: z.string().default(resolve(REPO_ROOT, 'apps/web/dist')),
  KASBAH_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  KASBAH_LOG_PRETTY: bool.default(false),
  KASBAH_STRICT_PLUGINS: bool.default(false),
  KASBAH_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
})
export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = envSchema.safeParse(source)
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`invalid environment:\n${lines}`)
  }
  return r.data
}
