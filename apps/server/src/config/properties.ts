import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { PROPERTY_KINDS, type PropertiesResponse, type PropertyKind } from '@kasbah/shared'
import type { House } from '@kasbah/shared'
import { REPO_ROOT, stateFile } from '../core/paths'

// Les PROPRIÉTÉS DE DÉMONSTRATION (`house/demos/`) : un serveur lancé sans `KASBAH_HOUSE_FILE` les
// propose toutes et en fait vivre une. Chaque maison dit elle-même quel parc simulé la peuple
// (`meta.demo.scenario`) : le web lit le même champ, il n'y a qu'une source.

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

/** La propriété démo que le serveur a fait vivre en dernier : elle survit à un redémarrage. */
const ACTIVE_FILE = 'demo-property.json'

export async function readActiveDemo(file = stateFile(ACTIVE_FILE)): Promise<string | null> {
  try { return (JSON.parse(await readFile(file, 'utf8')) as { active?: string }).active ?? null }
  catch { return null }
}

export async function writeActiveDemo(id: string, file = stateFile(ACTIVE_FILE)): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, `${JSON.stringify({ active: id })}\n`, 'utf8')
  await rename(`${file}.tmp`, file)
}

/** Ce que les routes savent des propriétés. Absent = une seule maison, celle du fichier. */
export interface PropertyHost {
  list(): PropertiesResponse
  /** Bascule APRÈS la réponse : le serveur se reconstruit sur l'autre maison. */
  select(id: string): void
}

/** La réponse d'un serveur à une seule maison : elle, et pas de bascule. */
export function singleProperty(house: House): PropertiesResponse {
  const kind = (house.meta?.demo as { kind?: string } | undefined)?.kind === 'apartment' ? 'apartment' : 'house'
  return { activeId: house.id, switchable: false, properties: [{ id: house.id, name: house.name, kind }] }
}
