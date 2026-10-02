import { DEVICE_KINDS, type Command, type DeviceDescriptor, type DeviceKind, type PluginHealth, type StatePatch } from '@kasbah/shared'
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

/**
 * Sous-items de la simulation : un par type d'appareil. Décocher sert à la faire COMPLÉTER un parc
 * réel au lieu de le doubler — dès qu'un vrai plugin couvre un kind (les lampes par Hue, les
 * ouvrants par TaHoma, le solaire par Enphase), ses équivalents simulés n'ont plus de raison
 * d'encombrer les listes en « hors plan ». Décocher emporte ce qui appartient à l'installation du
 * kind : sortir `energy` retire le site solaire ET ses panneaux, qui sont des capteurs
 * (`Simulation.hiddenFor`). `camera` n'est pas simulé : il n'est pas dans la liste.
 */
const SIMULATED_KINDS = DEVICE_KINDS.filter((k) => k !== 'camera')
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
  /** externalId des appareils exclus : le registre ne les connaît pas, ne rien leur émettre. */
  let hidden = new Set<string>()
  /** Kinds décochés dans les Réglages (le reste de `ctx.parts` vaut `true`). */
  let excluded: DeviceKind[] = []
  return {
    id: 'mock',
    configSchema: mockConfigSchema,
    parts: MOCK_PARTS,
    async init(c) {
      ctx = c
      config = c.config as MockConfig   // déjà validé/transformé par l'hôte via configSchema
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
      // la simulation décide elle-même ce que masquer : un appareil qui appartient à l'installation
      // d'un kind exclu tombe avec elle (les panneaux simulés avec `energy`, voir `hiddenFor`)
      hidden = sim!.hiddenFor(excluded)
      return sim!.devices().filter((d) => !hidden.has(d.externalId))
    },
    async start() {
      // états initiaux complets, puis patchs différentiels au fil des ticks
      for (const [id, state] of sim!.states()) {
        if (hidden.has(id)) continue
        const { kind: _k, updatedAt: _u, ...rest } = state
        ctx!.emitState(id, rest as StatePatch)
      }
      // la simulation continue de faire vivre les appareils exclus ; on filtre à la sortie, sinon
      // le registre journalise un « patch pour un appareil inconnu » à chaque tick
      sim!.start(
        (id, patch) => { if (!hidden.has(id)) ctx!.emitState(id, patch) },
        (id, available) => { if (!hidden.has(id)) ctx!.setAvailable(id, available) },
      )
    },
    async execute(externalId: string, command: Command) {
      try { await sim!.execute(externalId, command) }
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
    async stop() { sim?.stop() },
    health(): PluginHealth {
      const detail = `scenario ${config?.MOCK_SCENARIO ?? '?'} ×${config?.MOCK_TIME_SCALE ?? 1}`
      return { status: 'ok', detail: excluded.length ? `${detail}, sans ${excluded.join('/')}` : detail }
    },
  }
}
