import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { REPO_ROOT, SERVER_ROOT } from '../core/paths'
import { envSchema } from './env'
import { checkHouseText } from './house-check'
import { LOCAL_PROPERTIES_DIR } from './properties'

// Validates house files without starting the server:
//   npm run check:house -- [file]
// Without a file: `KASBAH_HOUSE_FILE` from `apps/server/.env`, else every house of `house/properties/`
// (what the server's catalog runs), else the demo house.
// Exits 0 when every house is valid (even with warnings), 1 otherwise.

/** The house files of `house/properties/`, without their automations and shopping list files. */
async function localHouseFiles(): Promise<string[]> {
  let names: string[]
  try { names = await readdir(LOCAL_PROPERTIES_DIR) }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err }
  return names
    .filter((n) => n.endsWith('.json') && !n.endsWith('.automations.json') && !n.endsWith('.shopping.json'))
    .sort()
    .map((n) => join(LOCAL_PROPERTIES_DIR, n))
}

// A path given on the command line is relative to where the command was typed (INIT_CWD, set by npm).
// A relative `KASBAH_HOUSE_FILE` is read from `apps/server/`, as the server does.
const arg = process.argv[2]
const files = arg ? [resolve(process.env.INIT_CWD ?? process.cwd(), arg)]
  : process.env.KASBAH_HOUSE_FILE ? [resolve(SERVER_ROOT, process.env.KASBAH_HOUSE_FILE)]
  : await localHouseFiles()
if (!files.length) files.push(envSchema.shape.KASBAH_HOUSE_FILE.parse(undefined))

let ok = true
for (const path of files) {
  const label = arg ?? relative(REPO_ROOT, path)
  let text: string
  try { text = await readFile(path, 'utf8') } catch (e) {
    console.error(`✗ ${label} : fichier illisible (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
    ok = false
    continue
  }
  const r = checkHouseText(text, label)
  console.log(r.lines.join('\n'))
  ok &&= r.ok
}
process.exit(ok ? 0 : 1)
