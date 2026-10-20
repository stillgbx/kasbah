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
    await rename(tmp, path)
  }
  const next = (queues.get(key) ?? Promise.resolve()).then(run)
  const tail = next.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return next
}
