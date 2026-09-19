import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// `import.meta.url` vaut `apps/server/src/…` en développement mais `apps/server/dist/main.js` une
// fois bundlé par esbuild : une profondeur en dur est juste dans un cas et fausse dans l'autre (elle
// désignait un dossier HORS du dépôt en production). On remonte donc jusqu'à `apps/server` selon la
// forme, et tout le reste se déduit de là — un seul endroit à relire si l'arborescence bouge.
const here = dirname(fileURLToPath(import.meta.url))
export const SERVER_ROOT = here.endsWith(`${sep}dist`) ? resolve(here, '..') : resolve(here, '../..')
export const REPO_ROOT = resolve(SERVER_ROOT, '../..')

/**
 * Chemin d'un fichier d'état persistant (jetons, historiques, appareils connus). Le dossier se
 * déplace par `KASBAH_STATE_DIR` : c'est ce que font les tests (`test/state-isolation.ts`), qui
 * sinon chargeraient et réécriraient le VRAI état — un plugin construit avec sa configuration par
 * défaut pointe sur ces fichiers-là, y compris sous vitest.
 */
export const stateFile = (name: string): string =>
  resolve(process.env.KASBAH_STATE_DIR ?? resolve(SERVER_ROOT, '.state'), name)
