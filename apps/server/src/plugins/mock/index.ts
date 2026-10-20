import { DEVICE_KINDS, type Command, type DeviceDescriptor, type DeviceKind, type PluginHealth, type SceneRecall, type StatePatch } from '@kasbah/shared'
import { SCENARIO_NAMES, SimError, Simulation, type SimErrorCode } from '@kasbah/mock-sim'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext, type PluginErrorCode } from '../../core/plugin'

// Thin adapter around @kasbah/mock-sim: the engine is pure, this plugin only plugs its patches
// into the context and translates its errors.

export const mockConfigSchema = z.object({
  MOCK_SCENARIO: z.enum(SCENARIO_NAMES).default('default'),
  MOCK_SEED: z.coerce.number().int().default(42),
  MOCK_START_TIME: z.iso.datetime({ offset: true }).optional(),
  MOCK_TIME_SCALE: z.coerce.number().positive().default(1),
})
export type MockConfig = z.infer<typeof mockConfigSchema>

/**
 * The simulation's sub-items: one per device type. Unchecking one makes it COMPLEMENT a real
 * device set instead of duplicating it — as soon as a real plugin covers a kind (lights through
 * Hue, covers through TaHoma, solar through Enphase), its simulated equivalents have no reason to
 * clutter the lists as "off plan". Unchecking takes along what belongs to the kind's installation:
 * dropping `energy` removes the solar site AND its panels, which are sensors
 * (`Simulation.hiddenFor`). Every kind is simulated, cameras and doorbells included (no stream).
 */
const SIMULATED_KINDS = [...DEVICE_KINDS]
const MOCK_PARTS = SIMULATED_KINDS.map((kind) => ({ id: kind, labelKey: `kinds.${kind}`, enabledByDefault: true }))

const CODE_MAP: Record<SimErrorCode, PluginErrorCode> = {
  UNSUPPORTED_COMMAND: 'UNSUPPORTED_COMMAND',
  DEVICE_UNAVAILABLE: 'DEVICE_UNAVAILABLE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  TIMEOUT: 'TIMEOUT',
  LOW_BATTERY: 'LOW_BATTERY',
}

export function createMockPlugin(): DevicePlugin {
  let sim: Simulation | null = null
  let ctx: PluginContext | null = null
  let config: MockConfig | null = null
  /** externalIds of the excluded devices: the registry does not know them, emit nothing for them. */
  let hidden = new Set<string>()
  /** Kinds unchecked in Settings (the rest of `ctx.parts` is `true`). */
  let excluded: DeviceKind[] = []
  return {
    id: 'mock',
    configSchema: mockConfigSchema,
    parts: MOCK_PARTS,
    async init(c) {
      ctx = c
      config = c.config as MockConfig   // already validated/transformed by the host via configSchema
      excluded = SIMULATED_KINDS.filter((k) => c.parts[k] === false)
      sim = new Simulation({
        scenario: config.MOCK_SCENARIO,
        seed: config.MOCK_SEED,
        timeScale: config.MOCK_TIME_SCALE,
        clock: c.clock,
        ...(config.MOCK_START_TIME ? { startTime: Date.parse(config.MOCK_START_TIME) } : {}),
      })
    },
    async discover(): Promise<DeviceDescriptor[]> {
      // the simulation decides by itself what to hide: a device that belongs to an excluded kind's
      // installation goes with it (the simulated panels with `energy`, see `hiddenFor`)
      hidden = sim!.hiddenFor(excluded)
      return sim!.devices().filter((d) => !hidden.has(d.externalId))
    },
    async start() {
      // full initial states, then differential patches tick after tick
      for (const [id, state] of sim!.states()) {
        if (hidden.has(id)) continue
        const { kind: _k, updatedAt: _u, ...rest } = state
        ctx!.emitState(id, rest as StatePatch)
      }
      // the simulation keeps the excluded devices alive; we filter on the way out, otherwise the
      // registry logs a "patch for an unknown device" on every tick
      // light scenes: they set lights, so they go away with the simulated lights
      const withScenes = !excluded.includes('light')
      if (withScenes) {
        ctx!.emitScenes(sim!.scenes().map((s) => ({ ...s, id: `mock:${s.externalId}`, pluginId: 'mock', autoDynamic: false })))
        for (const s of sim!.scenes()) ctx!.emitSceneState(s.externalId, sim!.sceneState(s.externalId))
      }
      sim!.start(
        (id, patch) => { if (!hidden.has(id)) ctx!.emitState(id, patch) },
        (id, available) => { if (!hidden.has(id)) ctx!.setAvailable(id, available) },
        (id, event) => { if (!hidden.has(id)) ctx!.emitEvent(id, event) },
        (id, active) => { if (withScenes) ctx!.emitSceneState(id, active) },
      )
    },
    async execute(externalId: string, command: Command) {
      try { await sim!.execute(externalId, command) }
      catch (err) {
        if (err instanceof SimError) throw new PluginError(CODE_MAP[err.code], err.message, { cause: err })
        throw err
      }
    },
    async recallScene(externalId: string, recall: SceneRecall) {
      try { await sim!.recallScene(externalId, recall) }
      catch (err) {
        if (err instanceof SimError) throw new PluginError(CODE_MAP[err.code], err.message, { cause: err })
        throw err
      }
    },
    async forecast(externalId: string) {
      try { return sim!.forecast(externalId) }
      catch (err) {
        if (err instanceof SimError) throw new PluginError(CODE_MAP[err.code], err.message, { cause: err })
        throw err
      }
    },
    async releaseNotes(externalId: string, lang: string) {
      try { return sim!.releaseNotes(externalId, lang) }
      catch (err) {
        if (err instanceof SimError) throw new PluginError(CODE_MAP[err.code], err.message, { cause: err })
        throw err
      }
    },
    async siteMap(externalId: string) {
      try { return sim!.siteMap(externalId) }
      catch (err) {
        if (err instanceof SimError) throw new PluginError(CODE_MAP[err.code], err.message, { cause: err })
        throw err
      }
    },
    async stop() { sim?.stop() },
    health(): PluginHealth {
      const detail = `scenario ${config?.MOCK_SCENARIO ?? '?'} ×${config?.MOCK_TIME_SCALE ?? 1}`
      return { status: 'ok', detail: excluded.length ? `${detail}, sans ${excluded.join('/')}` : detail }
    },
  }
}
