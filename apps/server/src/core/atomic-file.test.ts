import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic-file'

// Écriture atomique à la file : la course vue le 2026-10-01 (deux `rename` du même `.tmp`, le second
// en ENOENT) dépend du disque — deux écritures ne la déclenchent pas ici à coup sûr, dix si.

const scratch = () => mkdtemp(join(tmpdir(), 'kasbah-atomic-'))

describe('writeFileAtomic', () => {
  it('des écritures rapprochées ne se marchent pas dessus, et la dernière l’emporte', async () => {
    const dir = await scratch()
    const path = join(dir, 'state.json')
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeFileAtomic(path, String(i))))
    expect(await readFile(path, 'utf8')).toBe('9')
    expect(await readdir(dir)).toEqual(['state.json'])      // aucun `.tmp` laissé derrière
  })

  it('un échec rejette, et ne bloque pas les écritures suivantes', async () => {
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
