import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import { castTxtSchema, type CastService } from './types'

// MÉMOIRE des récepteurs déjà vus. Un Cast éteint (téléviseur au repos, Chromecast débranché) ne
// s'annonce plus en mDNS : sans mémoire, il quitte l'inventaire, et son entrée dans house.json perd
// son nom, son icône et son état — l'UI n'a plus qu'un id brut et « lié à aucun plugin ». On garde
// donc la dernière annonce de chaque appareil dans un petit JSON, rejouée au démarrage : l'appareil
// reste listé, indisponible, jusqu'à ce qu'il se réannonce — ou que l'utilisateur l'oublie.
//
// Fichier absent, illisible ou d'une autre forme : mémoire vide, jamais une erreur fatale (le plugin
// doit démarrer même sans écriture possible sur le disque).

const knownFileSchema = z.object({
  devices: z.array(z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    txt: castTxtSchema,
  })).default([]),
})

export interface KnownDevices {
  load(): Promise<CastService[]>
  save(services: CastService[]): Promise<void>
}

export function createKnownDevicesFile(path: string, logger: Logger): KnownDevices {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return [] }                                       // pas encore de fichier : premier démarrage
      const parsed = knownFileSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger.warn({ path }, 'unreadable Cast device memory, starting empty'); return [] }
      return parsed.data.devices
    },
    async save(services) {
      const text = `${JSON.stringify({ devices: services }, null, 2)}\n`
      // fichier intermédiaire propre au processus : deux serveurs sur la même machine (le serveur de
      // développement et celui de la preview) écrivent ce fichier, et un `.tmp` commun se marcherait dessus
      const tmp = `${path}.${process.pid}.tmp`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, text, 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger.warn({ err, path }, 'could not write Cast device memory')
      }
    },
  }
}
