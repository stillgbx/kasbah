import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic-file'

// Queued atomic write: the race seen on 2026-10-01 (two `rename`s of the same `.tmp`, the second
// with ENOENT) depends on the disk — two writes don't reliably trigger it here, ten do.

const scratch = () => mkdtemp(join(tmpdir(), 'kasbah-atomic-'))

describe('writeFileAtomic', () => {
  it('close writes do not trip over each other, and the last one wins', async () => {
    const dir = await scratch()
    const path = join(dir, 'state.json')
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeFileAtomic(path, String(i))))
    expect(await readFile(path, 'utf8')).toBe('9')
    expect(await readdir(dir)).toEqual(['state.json'])      // no `.tmp` left behind
  })

  it('writes over a file another handle is reading (Windows refuses the rename meanwhile)', async () => {
    const dir = await scratch()
    const path = join(dir, 'state.json')
    await writeFile(path, 'avant', 'utf8')
    const reader = await open(path, 'r')
    const written = writeFileAtomic(path, 'après')
    setTimeout(() => { void reader.close() }, 100)
    await written
    expect(await readFile(path, 'utf8')).toBe('après')
    expect(await readdir(dir)).toEqual(['state.json'])
  })

  it('a failure rejects, and does not block the following writes', async () => {
    const dir = await scratch()
    const blocker = join(dir, 'sub')
    await writeFile(blocker, 'un fichier, pas un dossier', 'utf8')
    const path = join(blocker, 'state.json')
    await expect(writeFileAtomic(path, 'perdu')).rejects.toThrow()
    await rm(blocker)
    await writeFileAtomic(path, 'écrit')
    expect(await readFile(path, 'utf8')).toBe('écrit')
  })
})
