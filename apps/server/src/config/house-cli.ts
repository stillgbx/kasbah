import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { envSchema } from './env'
import { checkHouseText } from './house-check'

// Validates a house file without starting the server:
//   npm run check:house -- [file]   (default: KASBAH_HOUSE_FILE from `.env`, else the demo house)
// Exits 0 when the house is valid (even with warnings), 1 otherwise.

// `npm -w` runs the script from `apps/server/`: a path given on the command line is relative to
// where the command was typed (INIT_CWD).
const arg = process.argv[2]
const path = arg
  ? resolve(process.env.INIT_CWD ?? process.cwd(), arg)
  : envSchema.shape.KASBAH_HOUSE_FILE.parse(process.env.KASBAH_HOUSE_FILE)

let text: string
try { text = await readFile(path, 'utf8') } catch (e) {
  console.error(`✗ ${path} : fichier illisible (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
  process.exit(1)
}
const { ok, lines } = checkHouseText(text, arg ?? path)
console.log(lines.join('\n'))
process.exit(ok ? 0 : 1)
