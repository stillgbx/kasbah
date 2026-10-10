import { readdir, readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { PROPERTY_KINDS, newHouseJson, parseHouse, propertyIdFor, type NewPropertyBody, type PropertiesResponse, type PropertyKind, type PropertyMode } from '@kasbah/shared'
import type { House } from '@kasbah/shared'
import { REPO_ROOT, stateFile } from '../core/paths'

// Les PROPRIÉTÉS qu'un serveur lancé sans `KASBAH_HOUSE_FILE` sait faire vivre, une à la fois : les
// DÉMONSTRATIONS (`house/demos/`, en lecture seule) et les propriétés RÉELLES du poste
// (`house/properties/`). Le choix et le mode montré vivent dans `catalog.ts`. Chaque maison dit
// elle-même quel parc simulé la peuple (`meta.demo.scenario`) : le web lit le même champ.

export const DEMO_HOUSE_FILES = ['tilleuls', 'embruns', 'belvedere'].map((id) => resolve(REPO_ROOT, `house/demos/${id}.json`))

export interface DemoProperty {
  id: string
  name: string
  kind: PropertyKind
  /** Scénario du plugin `mock` qui peuple la maison. */
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
 * Les propriétés RÉELLES du poste — créées, dupliquées, ou une maison existante qu'on y range : un
 * fichier chacune (avec ses automatisations à côté), dans un dossier ignoré par git. Un dossier à
 * part plutôt que `house/`, qui porte aussi la fixture des tests, des sauvegardes et l'historique.
 */
export const LOCAL_PROPERTIES_DIR = resolve(REPO_ROOT, 'house/properties')

/** Une propriété que le serveur sait faire vivre ; `demo` = une démonstration, en lecture seule. */
export interface PropertyEntry {
  id: string
  name: string
  kind: PropertyKind
  /** Scénario du plugin `mock` (`meta.demo.scenario`) : une démo, ou sa copie, garde son parc simulé. */
  scenario?: string
  path: string
  demo: boolean
}

type RawProperty = { id?: unknown; name?: unknown; meta?: { kind?: unknown; demo?: { scenario?: unknown; kind?: unknown } } }
/** Le type se lit dans `meta.demo.kind` (démos) ou `meta.kind` (propriété créée) ; maison par défaut. */
function kindOf(raw: RawProperty): PropertyKind {
  const k = raw.meta?.demo?.kind ?? raw.meta?.kind
  return (PROPERTY_KINDS as readonly unknown[]).includes(k) ? k as PropertyKind : 'house'
}

/** Les propriétés locales, triées par nom ; un fichier illisible ou sans id est ignoré. */
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

/** Écrit une maison neuve, validée, dans le dossier local ; son id est tiré du nom. */
async function writeLocal(dir: string, id: string, doc: unknown): Promise<string> {
  parseHouse(doc)                                      // une maison invalide n'est jamais écrite
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${id}.json`)
  await writeFile(`${path}.tmp`, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(`${path}.tmp`, path)
  return path
}

/** Crée la maison d'une installation neuve (`newHouseJson`) ; rend son id. */
export async function createLocalProperty(body: NewPropertyBody, taken: Iterable<string>, dir = LOCAL_PROPERTIES_DIR): Promise<string> {
  const id = propertyIdFor(body.name, taken)
  await writeLocal(dir, id, newHouseJson(id, body))
  return id
}

/** Copie modifiable d'une propriété (une démo, le plus souvent) : même maison, même parc simulé, autre nom. */
export async function duplicateProperty(source: PropertyEntry, name: string, taken: Iterable<string>, dir = LOCAL_PROPERTIES_DIR): Promise<string> {
  const id = propertyIdFor(name, taken)
  const doc = JSON.parse(await readFile(source.path, 'utf8')) as Record<string, unknown>
  await writeLocal(dir, id, { ...doc, id, name })
  return id
}

/**
 * Le mode montré et la propriété retenue dans CHACUN : revenir en démo rouvre la dernière démo, revenir
 * au réel rouvre sa maison. Survit à un redémarrage. `mode` absent = jamais choisi (premier lancement).
 */
export interface ModeState { mode?: PropertyMode; demo?: string; real?: string }
const MODE_FILE = 'property-mode.json'
/** Avant les deux modes, seule la propriété montrée était retenue : on la reprend une fois. */
const LEGACY_FILE = 'demo-property.json'

export async function readModeState(file = stateFile(MODE_FILE), legacy = stateFile(LEGACY_FILE)): Promise<ModeState> {
  try { return JSON.parse(await readFile(file, 'utf8')) as ModeState } catch { /* pas encore écrit */ }
  try {
    const active = (JSON.parse(await readFile(legacy, 'utf8')) as { active?: string }).active
    return active ? { demo: active, real: active } : {}   // le catalogue garde celle qui existe dans chaque mode
  } catch { return {} }
}

export async function writeModeState(state: ModeState, file = stateFile(MODE_FILE)): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, `${JSON.stringify(state)}\n`, 'utf8')
  await rename(`${file}.tmp`, file)
}

/** Ce que les routes savent des propriétés. Absent = une seule maison, celle du fichier. */
export interface PropertyHost {
  list(): PropertiesResponse
  /** Bascule APRÈS la réponse : le serveur se reconstruit sur l'autre maison. */
  select(id: string): void
  /** Crée une propriété neuve ; rend son id (la bascule est un `select` à part). */
  create(body: NewPropertyBody): Promise<string>
  /** Duplique une propriété sous un autre nom ; rend l'id de la copie. */
  duplicate(id: string, name: string): Promise<string>
  /** Passe en démo ou en réel, APRÈS la réponse (même reconstruction qu'une bascule). */
  setMode(mode: PropertyMode): void
}

/** La réponse d'un serveur à une seule maison : elle, et pas de bascule. */
export function singleProperty(house: House): PropertiesResponse {
  return { activeId: house.id, switchable: false, properties: [{ id: house.id, name: house.name, kind: kindOf(house as RawProperty) }] }
}
