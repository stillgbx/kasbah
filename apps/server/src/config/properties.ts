import { readdir, readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PROPERTY_KINDS, newHouseJson, parseHouse, propertyIdFor, type NewPropertyBody, type PropertiesResponse, type PropertyKind, type PropertyMode } from '@kasbah/shared'
import type { House } from '@kasbah/shared'
import { REPO_ROOT, stateFile } from '../core/paths'

// The PROPERTIES that a server started without `KASBAH_HOUSE_FILE` can run, one at a time: the
// DEMOS (`house/demos/`, read-only) and the machine's REAL properties (`house/properties/`). The
// choice and the mode shown live in `catalog.ts`. Each house says itself which simulated device set
// populates it (`meta.demo.scenario`): the web app reads the same field.

export const DEMO_HOUSE_FILES = ['tilleuls', 'embruns', 'belvedere'].map((id) => resolve(REPO_ROOT, `house/demos/${id}.json`))

export interface DemoProperty {
  id: string
  name: string
  kind: PropertyKind
  /** Scenario of the `mock` plugin that populates the house. */
  scenario: string
  path: string
}

export async function loadDemoProperties(files = DEMO_HOUSE_FILES): Promise<DemoProperty[]> {
  return Promise.all(files.map(async (path) => {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { id: string; name: string; meta?: { demo?: { scenario?: string; kind?: string } } }
    const demo = raw.meta?.demo
    if (!demo?.scenario) throw new Error(`${path}: a demo property declares meta.demo.scenario`)
    const kind = (PROPERTY_KINDS as readonly string[]).includes(demo.kind ?? '') ? demo.kind as PropertyKind : 'house'
    return { id: raw.id, name: raw.name, kind, scenario: demo.scenario, path }
  }))
}

/**
 * The machine's REAL properties — created, duplicated, or an existing house put there: one file each
 * (with its automations next to it), in a folder ignored by git. A separate folder rather than
 * `house/`, which also holds the test fixture, backups and history.
 */
export const LOCAL_PROPERTIES_DIR = resolve(REPO_ROOT, 'house/properties')

/** A property the server can run; `demo` = a demo, read-only. */
export interface PropertyEntry {
  id: string
  name: string
  kind: PropertyKind
  /** Scenario of the `mock` plugin (`meta.demo.scenario`): a demo, or its copy, keeps its simulated device set. */
  scenario?: string
  path: string
  demo: boolean
}

type RawProperty = { id?: unknown; name?: unknown; meta?: { kind?: unknown; demo?: { scenario?: unknown; kind?: unknown } } }
/** The kind is read from `meta.demo.kind` (demos) or `meta.kind` (created property); house by default. */
function kindOf(raw: RawProperty): PropertyKind {
  const k = raw.meta?.demo?.kind ?? raw.meta?.kind
  return (PROPERTY_KINDS as readonly unknown[]).includes(k) ? k as PropertyKind : 'house'
}

/** The local properties, sorted by name; an unreadable file or one without an id is ignored. */
export async function loadLocalProperties(dir = LOCAL_PROPERTIES_DIR): Promise<PropertyEntry[]> {
  let names: string[]
  try { names = await readdir(dir) }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err }
  const out: PropertyEntry[] = []
  for (const f of names.filter((n) => n.endsWith('.json') && !n.endsWith('.automations.json'))) {
    const path = join(dir, f)
    let raw: RawProperty
    try { raw = JSON.parse(await readFile(path, 'utf8')) as RawProperty } catch { continue }
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') continue
    const scenario = typeof raw.meta?.demo?.scenario === 'string' ? raw.meta.demo.scenario : undefined
    out.push({ id: raw.id, name: raw.name, kind: kindOf(raw), path, demo: false, ...(scenario ? { scenario } : {}) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Writes a new, validated house into the local folder; its id is derived from the name. */
async function writeLocal(dir: string, id: string, doc: unknown): Promise<string> {
  parseHouse(doc)                                      // an invalid house is never written
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${id}.json`)
  await writeFile(`${path}.tmp`, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(`${path}.tmp`, path)
  return path
}

/** Creates the house of a fresh installation (`newHouseJson`); returns its id. */
export async function createLocalProperty(body: NewPropertyBody, taken: Iterable<string>, dir = LOCAL_PROPERTIES_DIR): Promise<string> {
  const id = propertyIdFor(body.name, taken)
  await writeLocal(dir, id, newHouseJson(id, body))
  return id
}

/** Editable copy of a property (a demo, most often): same house, same simulated device set, another name. */
export async function duplicateProperty(source: PropertyEntry, name: string, taken: Iterable<string>, dir = LOCAL_PROPERTIES_DIR): Promise<string> {
  const id = propertyIdFor(name, taken)
  const doc = JSON.parse(await readFile(source.path, 'utf8')) as Record<string, unknown>
  await writeLocal(dir, id, { ...doc, id, name })
  return id
}

/**
 * The mode shown and the property remembered in EACH: going back to demo reopens the last demo, going
 * back to real reopens its house. Survives a restart. `mode` absent = never chosen (first launch).
 */
export interface ModeState { mode?: PropertyMode; demo?: string; real?: string }
const MODE_FILE = 'property-mode.json'
/** Before the two modes, only the property shown was remembered: we pick it up once. */
const LEGACY_FILE = 'demo-property.json'

export async function readModeState(file = stateFile(MODE_FILE), legacy = stateFile(LEGACY_FILE)): Promise<ModeState> {
  try { return JSON.parse(await readFile(file, 'utf8')) as ModeState } catch { /* not written yet */ }
  try {
    const active = (JSON.parse(await readFile(legacy, 'utf8')) as { active?: string }).active
    return active ? { demo: active, real: active } : {}   // the catalog keeps the one that exists in each mode
  } catch { return {} }
}

export async function writeModeState(state: ModeState, file = stateFile(MODE_FILE)): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, `${JSON.stringify(state)}\n`, 'utf8')
  await rename(`${file}.tmp`, file)
}

/** What the routes know about properties. Absent = a single house, the file's. */
export interface PropertyHost {
  list(): PropertiesResponse
  /** Switches AFTER the response: the server rebuilds itself on the other house. */
  select(id: string): void
  /**
   * The property exists, whatever its mode. `list()` shows only the current mode: a real property
   * just created from demo mode is not in it, and yet we switch to it.
   */
  has(id: string): boolean
  /** Creates a new property; returns its id (switching is a separate `select`). */
  create(body: NewPropertyBody): Promise<string>
  /** Duplicates a property under another name; returns the copy's id. */
  duplicate(id: string, name: string): Promise<string>
  /** Switches to demo or real, AFTER the response (same rebuild as a switch). */
  setMode(mode: PropertyMode): void
}

/** The response of a single-house server: that house, and no switching. */
export function singleProperty(house: House): PropertiesResponse {
  return { activeId: house.id, switchable: false, properties: [{ id: house.id, name: house.name, kind: kindOf(house as RawProperty) }] }
}
