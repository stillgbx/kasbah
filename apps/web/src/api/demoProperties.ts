import type { PropertiesResponse, PropertyKind } from '@kasbah/shared'
import type { ScenarioName } from '@kasbah/mock-sim'
import tilleuls from '../../../../house/demos/tilleuls.json'
import embruns from '../../../../house/demos/embruns.json'
import belvedere from '../../../../house/demos/belvedere.json'

// The three demonstration properties (`house/demos/`), for demo mode without a server
// (VITE_INPROCESS_MOCK=1). Each house itself says which simulated device set populates it
// (`meta.demo.scenario`): the server reads the same field, so there is a single source.

export interface DemoProperty {
  id: string
  name: string
  kind: PropertyKind
  scenario: ScenarioName
  /** The raw house JSON, as the file carries it (parsed on use). */
  house: unknown
}

interface DemoMeta { meta: { demo: { scenario: string; kind: PropertyKind } } }
const property = (raw: { id: string; name: string } & DemoMeta): DemoProperty =>
  ({ id: raw.id, name: raw.name, kind: raw.meta.demo.kind, scenario: raw.meta.demo.scenario as ScenarioName, house: raw })

export const DEMO_PROPERTIES: readonly DemoProperty[] = [property(tilleuls as never), property(embruns as never), property(belvedere as never)]

const KEY = 'kasbah.demoProperty'
/** The first house a visitor of the static demo sees: Les Embruns, the flat-roofed one. */
const DEFAULT_ID = 'embruns'

/** The demo property remembered by THIS browser; Les Embruns if none is remembered (or if storage is missing). */
export function activeDemoProperty(): DemoProperty {
  let id: string | null = null
  try { id = localStorage.getItem(KEY) } catch { /* storage unavailable: the default one */ }
  return DEMO_PROPERTIES.find((p) => p.id === id) ?? DEMO_PROPERTIES.find((p) => p.id === DEFAULT_ID)!
}

export function rememberDemoProperty(id: string): void {
  try { localStorage.setItem(KEY, id) } catch { /* the choice will not survive a reload */ }
}

export function demoPropertiesResponse(activeId: string): PropertiesResponse {
  return { activeId, switchable: true, properties: DEMO_PROPERTIES.map(({ id, name, kind }) => ({ id, name, kind })) }
}
