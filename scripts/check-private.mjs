#!/usr/bin/env node
/**
 * Personal data safeguard: refuses what would identify the real house or its family.
 *
 * The list of forbidden values is itself sensitive: it lives in `.private-denylist` at the
 * root, a gitignored file that only exists at the owner's. One line per value, literal,
 * or `re:<regular expression>`; `#` comments. Without this file, the script blocks nothing.
 *
 *   node scripts/check-private.mjs            the whole tracked repo (working files)
 *   node scripts/check-private.mjs --staged   the added lines of the commit being prepared (pre-commit hook)
 *   node scripts/check-private.mjs --message <file>   the commit message (commit-msg hook)
 *
 * Hooks: `npm run hooks` points git at `.githooks/` (once per clone).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const listFile = join(root, '.private-denylist')

if (!existsSync(listFile)) {
  if (process.argv.includes('--all')) console.warn('[check-private] no .private-denylist: nothing to check')
  process.exit(0)
}

const rules = readFileSync(listFile, 'utf8').split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => (l.startsWith('re:') ? new RegExp(l.slice(3), 'u') : { test: (s) => s.includes(l) }))

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
const found = []
const scan = (where, text) => text.split(/\r?\n/).forEach((line, i) => {
  if (rules.some((r) => r.test(line))) found.push(`${where}:${i + 1}`)
})

const mode = process.argv[2] ?? '--all'
if (mode === '--message') {
  scan('message de commit', readFileSync(process.argv[3], 'utf8'))
} else if (mode === '--staged') {
  let file = '?'
  for (const line of git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff').split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6)
    else if (line.startsWith('+') && rules.some((r) => r.test(line))) found.push(file)
  }
} else {
  for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
    const buf = readFileSync(join(root, f))
    if (!buf.subarray(0, 8000).includes(0)) scan(f, buf.toString('utf8'))
  }
}

if (found.length) {
  // We name the place, never the value: the output may end up in a log.
  console.error(`[check-private] personal data found (see .private-denylist):\n  ${[...new Set(found)].join('\n  ')}`)
  process.exit(1)
}
