import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

// Un plugin construit avec sa configuration par défaut écrit dans `apps/server/.state` — y compris
// sous vitest : un test qui appelle `plugin.init()` sans stub de store CHARGE l'état réel, y ajoute
// ses fixtures et le réécrit (constaté le 2026-09-18 sur `comap-consumption.json` et
// `melcloud-history.json`). Ce fichier, chargé avant chaque fichier de test, déplace le dossier.
const dir = join(tmpdir(), 'kasbah-test-state', String(process.pid))
process.env.KASBAH_STATE_DIR = dir

// Les sauvegardes des plugins sont en « feu et oubli » : une écriture peut être encore en vol ici,
// et son `rename` échouerait dans le vide — c'est justement ce qui laissait des `.tmp`, désormais
// dans un dossier jetable.
afterAll(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) })
