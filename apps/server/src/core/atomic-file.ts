import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// Atomic write of a state file: an intermediate `.tmp` then `rename`, so that a power cut never
// leaves a truncated file.
//
// Writes to the same path are QUEUED. Plugins save without waiting (`void store.save(…)`), and two
// close calls shared the same `.tmp`: the first `rename` won, the second failed with ENOENT (seen at
// startup on 2026-10-01, Tesla state cache). Each write waits for the previous one: the last one
// requested is the last one written. Same mechanism as `updateHouseFile` (config/house.ts).
//
// `.tmp` named after the process: two servers on the same machine (development and preview)
// sometimes write the same file, and a shared intermediate would trip over itself.

const queues = new Map<string, Promise<void>>()

// Windows refuses to `rename` over a file another handle has open (a reader, the antivirus):
// EPERM, EACCES or EBUSY for as long as it stays open. Measured on 2026-10-25: a loop reading the
// file made 1789 renames out of 2000 fail, and the write was lost (an assistant log entry, when
// the log was read meanwhile). The rename is retried for a while, as graceful-fs does; past that,
// the write rejects as before.
const RENAME_RETRY_MS = 2000
const RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

async function renameRetrying(from: string, to: string): Promise<void> {
  const start = Date.now()
  for (let wait = 10; ; wait = Math.min(wait * 2, 100)) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const busy = process.platform === 'win32' && RENAME_BUSY.has((err as NodeJS.ErrnoException).code ?? '')
      if (!busy || Date.now() - start >= RENAME_RETRY_MS) throw err
    }
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

export interface AtomicWriteOptions {
  /** File permissions (`0o600` for a session or a token). */
  mode?: number
}

/**
 * Writes `text` to `path`, after the writes already queued on that path. Rejects if the disk
 * refuses: up to the caller to choose between a warning and an error. A failure does not block the queue.
 */
export function writeFileAtomic(path: string, text: string, options: AtomicWriteOptions = {}): Promise<void> {
  const key = resolve(path)
  const run = async () => {
    const tmp = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, text, { encoding: 'utf8', ...options })
    await renameRetrying(tmp, path)
  }
  const next = (queues.get(key) ?? Promise.resolve()).then(run)
  const tail = next.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return next
}
