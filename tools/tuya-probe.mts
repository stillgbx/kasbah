/**
 * Sonde Tuya locale : connexion 3.5, accumulation des DP, observation des changements.
 * Lecture seule par défaut ; `--set <dp>=<json>` pour une écriture (puis attendre l'état).
 *
 *   npx tsx --env-file=apps/server/.env tools/tuya-probe.mts
 *   npx tsx --env-file=apps/server/.env tools/tuya-probe.mts --set 20=false
 *
 * Ne JAMAIS passer la clé en argument CLI (visible dans la liste des processus).
 * Source : TUYA_DEVICES dans apps/server/.env (premier appareil du tableau).
 */
import TuyAPI from 'tuyapi'
import { parseTuyaDevices } from '../apps/server/src/plugins/tuya/types.ts'

const raw = process.env.TUYA_DEVICES ?? ''
const devices = parseTuyaDevices(raw)
if (!devices.length) {
  console.error('TUYA_DEVICES vide ou absent. Voir apps/server/.env.example.')
  process.exit(2)
}

const cfg = devices[0]!
const setArg = process.argv.find((a) => a.startsWith('--set='))?.slice('--set='.length)
  ?? (process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : undefined)

const etat: Record<string, unknown> = {}
let vivant = true

const device = new TuyAPI({
  id: cfg.id,
  key: cfg.key,
  ip: cfg.ip,
  version: cfg.version,
  issueRefreshOnConnect: true,
})

const absorb = (label: string, dps: Record<string, unknown> | undefined) => {
  if (!dps) return
  const changed: string[] = []
  for (const [k, v] of Object.entries(dps)) {
    if (JSON.stringify(etat[k]) !== JSON.stringify(v)) changed.push(`${k}: ${JSON.stringify(etat[k])} → ${JSON.stringify(v)}`)
    etat[k] = v
  }
  if (changed.length) console.log(`[${label}]`, changed.join(' | '))
  else console.log(`[${label}] (inchangé)`, JSON.stringify(dps))
}

device.on('data', (d: { dps?: Record<string, unknown> }) => absorb('data', d?.dps))
device.on('dp-refresh', (d: { dps?: Record<string, unknown> }) => absorb('dp-refresh', d?.dps))
device.on('error', () => {}) // bruit de reconnexion
device.on('disconnected', () => console.log('déconnecté'))

process.on('SIGINT', () => { vivant = false; try { device.disconnect() } catch { /* */ }; process.exit(0) })

console.log(`Sonde ${cfg.name} @ ${cfg.ip} (id ${cfg.id.slice(0, 6)}…, v${cfg.version})`)
console.log('Ctrl+C pour quitter. Ne sonde JAMAIS un DP isolé (ECONNRESET).\n')

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitEtat(dp: string, value: unknown, ms = 8_000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (JSON.stringify(etat[dp]) === JSON.stringify(value)) return true
    await sleep(50)
  }
  return false
}

while (vivant) {
  try {
    await device.connect()
    console.log('connecté — état :', JSON.stringify(etat))

    if (setArg) {
      const eq = setArg.indexOf('=')
      const dp = setArg.slice(0, eq)
      const value = JSON.parse(setArg.slice(eq + 1)) as unknown
      console.log(`écriture DP ${dp} =`, value)
      await device.set({ dps: Number(dp), set: value })
      const ok = await waitEtat(dp, value)
      console.log(ok ? 'effet confirmé sur l\'état' : 'plafond atteint — effet non vu (accusé non fiable)')
      vivant = false
      break
    }

    await new Promise<void>((resolve) => {
      const done = () => { device.removeListener('disconnected', done); clearTimeout(t); resolve() }
      device.on('disconnected', done)
      const t = setTimeout(done, 60_000)
    })
  } catch (err) {
    console.log('connexion échouée:', (err as Error).message)
  }
  if (!vivant) break
  await sleep(700)
}

try { device.disconnect() } catch { /* */ }
console.log('\nÉtat final :', JSON.stringify(etat, null, 2))
