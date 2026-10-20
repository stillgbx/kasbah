import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { lintHouse, parseHouse, type House, type HouseWarning } from '@kasbah/shared'

export interface LoadedHouse {
  house: House; warnings: HouseWarning[]; path: string; raw: string
  /** Demo property: any write is refused (`ReadOnlyHouseError`). */
  readOnly?: boolean
}

/** Write refused: the property shown is a demo, which you duplicate to change it. */
export class ReadOnlyHouseError extends Error {
  readonly statusCode = 409
  readonly code = 'DEMO_READONLY'
  constructor() { super('this property is a demo: duplicate it to change it'); this.name = 'ReadOnlyHouseError' }
}

/** Reads and validates the house JSON. An invalid house prevents startup (fail fast). */
export async function loadHouse(path: string): Promise<LoadedHouse> {
  const raw = await readFile(path, 'utf8')
  const house = parseHouse(JSON.parse(raw))
  return { house, warnings: lintHouse(house), path, raw }
}

// Writing: the ONLY change the server makes to the file (placing a device from the UI).
// Read-modify-write on the file itself — not from memory — so as not to overwrite a manual edit
// made since startup; full validation before writing; atomic write (temporary file + rename) with a
// `.bak` copy of the previous version. Writes are serialized per file.

const queues = new Map<string, Promise<unknown>>()

/** Versions kept in `history/`: the `.bak` keeps only one, overwritten at the next write. */
export const HOUSE_HISTORY_KEEP = 50

/**
 * Timestamped copy of the version about to be replaced, in `history/` next to the file: an editing
 * mistake can be undone even several writes later. The oldest ones beyond `HOUSE_HISTORY_KEEP` are
 * removed (the ISO timestamp sorts as a string).
 */
async function keepHistory(path: string, raw: string): Promise<void> {
  const dir = join(dirname(path), 'history')
  const name = basename(path).replace(/.json$/, '')
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await writeFile(join(dir, `${name}.${stamp}.json`), raw, 'utf8')
  const mine = (await readdir(dir)).filter((f) => f.startsWith(`${name}.`) && f.endsWith('.json')).sort()
  for (const old of mine.slice(0, Math.max(0, mine.length - HOUSE_HISTORY_KEEP))) await rm(join(dir, old), { force: true })
}

export async function updateHouseFile(loaded: LoadedHouse, mutate: (doc: unknown) => unknown): Promise<House> {
  if (loaded.readOnly) throw new ReadOnlyHouseError()
  const run = async () => {
    const raw = await readFile(loaded.path, 'utf8')
    const doc = mutate(JSON.parse(raw))
    const house = parseHouse(doc)             // HouseValidationError → 400 through the error handler
    const text = `${JSON.stringify(doc, null, 2)}\n`
    await writeFile(`${loaded.path}.bak`, raw, 'utf8')
    await keepHistory(loaded.path, raw)
    await writeFile(`${loaded.path}.tmp`, text, 'utf8')
    await rename(`${loaded.path}.tmp`, loaded.path)
    loaded.house = house
    loaded.warnings = lintHouse(house)
    loaded.raw = text
    return house
  }
  const prev = queues.get(loaded.path) ?? Promise.resolve()
  const next = prev.then(run, run)
  queues.set(loaded.path, next)
  try { return await next }
  finally { if (queues.get(loaded.path) === next) queues.delete(loaded.path) }
}
