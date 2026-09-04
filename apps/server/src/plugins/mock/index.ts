import type { Command, DeviceDescriptor, PluginHealth, StatePatch } from '@kasbah/shared'
import { SCENARIO_NAMES, SimError, Simulation, type SimErrorCode } from '@kasbah/mock-sim'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext, type PluginErrorCode } from '../../core/plugin'

// Adaptateur mince autour de @kasbah/mock-sim : le moteur est pur, ce plugin ne fait que brancher
// ses patchs sur le contexte et traduire ses erreurs.

export const mockConfigSchema = z.object({
  MOCK_SCENARIO: z.enum(SCENARIO_NAMES).default('default'),
  MOCK_SEED: z.coerce.number().int().default(42),
  MOCK_START_TIME: z.iso.datetime({ offset: true }).optional(),
  MOCK_TIME_SCALE: z.coerce.number().positive().default(1),
})
export type MockConfig = z.infer<typeof mockConfigSchema>

const CODE_MAP: Record<SimErrorCode, PluginErrorCode> = {
  UNSUPPORTED_COMMAND: 'UNSUPPORTED_COMMAND',
  DEVICE_UNAVAILABLE: 'DEVICE_UNAVAILABLE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  TIMEOUT: 'TIMEOUT',
}

export function createMockPlugin(): DevicePlugin {
  let sim: Simulation | null = null
  let ctx: PluginContext | null = null
  let config: MockConfig | null = null
  return {
    id: 'mock',
    configSchema: mockConfigSchema,
    async init(c) {
      ctx = c
      config = c.config as MockConfig   // déjà validé/transformé par l'hôte via configSchema
      sim = new Simulation({
        scenario: config.MOCK_SCENARIO,
        seed: config.MOCK_SEED,
        timeScale: config.MOCK_TIME_SCALE,
        clock: c.clock,
        ...(config.MOCK_START_TIME ? { startTime: Date.parse(config.MOCK_START_TIME) } : {}),
      })
    },
    async discover(): Promise<DeviceDescriptor[]> { return sim!.devices() },
    async start() {
      // états initiaux complets, puis patchs différentiels au fil des ticks
      for (const [id, state] of sim!.states()) {
        const { kind: _k, updatedAt: _u, ...rest } = state
        ctx!.emitState(id, rest as StatePatch)
      }
      sim!.start(
        (id, patch) => ctx!.emitState(id, patch),
        (id, available) => ctx!.setAvailable(id, available),
      )
    },
    async execute(externalId: string, command: Command) {
      try { await sim!.execute(externalId, command) }
      catch (err) {
        if (err instanceof SimError) throw new PluginError(CODE_MAP[err.code], err.message, { cause: err })
        throw err
      }
    },
    async stop() { sim?.stop() },
    health(): PluginHealth {
      return { status: 'ok', detail: `scenario ${config?.MOCK_SCENARIO ?? '?'} ×${config?.MOCK_TIME_SCALE ?? 1}` }
    },
  }
}
