import { readFile } from 'node:fs/promises'
import { lintHouse, parseHouse, type House, type HouseWarning } from '@kasbah/shared'

export interface LoadedHouse { house: House; warnings: HouseWarning[]; path: string; raw: string }

/** Lit et valide le JSON de la maison. Une maison invalide empêche le démarrage (échec rapide). */
export async function loadHouse(path: string): Promise<LoadedHouse> {
  const raw = await readFile(path, 'utf8')
  const house = parseHouse(JSON.parse(raw))
  return { house, warnings: lintHouse(house), path, raw }
}
