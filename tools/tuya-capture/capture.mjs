#!/usr/bin/env node
// Capture des DPS (« data points ») d'un appareil Tuya en LOCAL, sans cloud au fonctionnement.
// But : découvrir quel DP porte quoi sur le ventilateur CREATE (marche, vitesse, lumière,
// intensité…) et sur quelle échelle, en observant ce qui change quand on actionne la
// télécommande RF ou l'appli du fabricant. La sortie JSONL sert ensuite de fixture au plugin.
//
// Prérequis (une seule fois, pour obtenir l'id et la clé locale) :
//   1. Compte sur https://iot.tuya.com → Cloud → Development → projet « Smart Home ».
//      Choisir le data center de l'appli (Europe centrale pour un compte français).
//   2. Onglet « Link Tuya App Account » → scanner le QR code depuis l'appli mobile
//      (Smart Life / Tuya Smart ; pour l'appli CREATE, essayer « Others » — sinon ré-appairer le
//      ventilateur dans Smart Life). Le service « IoT Core » est un essai d'un mois : il ne sert
//      qu'à lire la clé, plus jamais ensuite. La clé change si l'appareil est ré-appairé.
//   3. npx @tuyapi/cli wizard → liste noms, ids et clés locales des appareils du compte.
//
// Usage (dans tools/tuya-capture, après `npm install`) :
//   npm run capture -- --id <deviceId> --key <localKey> [--ip <ip>] [--version 3.3|3.4|3.5]
//                       [--set <dp>=<valeurJSON>] [--out captures/ventilateur.jsonl]
//   ou via .env (copier .env.example) : TUYA_ID, TUYA_KEY, TUYA_IP, TUYA_VERSION.
//
// Une fois connecté, taper dans le terminal :
//   <dp> <valeurJSON>   → envoie la valeur sur ce DP (ex. `3 4` pour vitesse 4, `1 true`, `9 false`)
//   get                 → relit tous les DPS
//   Ctrl+C              → déconnecte et affiche le récapitulatif des valeurs vues par DP
//
// Piège connu : un appareil Tuya n'accepte qu'UNE connexion locale à la fois. Fermer l'appli
// mobile (ou la sortir du même Wi-Fi) si la connexion est refusée ou tombe aussitôt.

import { parseArgs } from 'node:util'
import { mkdir, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import TuyAPI from 'tuyapi'

const { values: args } = parseArgs({
  options: {
    id: { type: 'string' },
    key: { type: 'string' },
    ip: { type: 'string' },
    version: { type: 'string' },
    set: { type: 'string' },
    out: { type: 'string', default: 'captures/ventilateur.jsonl' },
    help: { type: 'boolean', short: 'h' },
  },
})

const id = args.id ?? process.env.TUYA_ID
const key = args.key ?? process.env.TUYA_KEY
const ip = args.ip ?? process.env.TUYA_IP
const version = args.version ?? process.env.TUYA_VERSION

if (args.help || !id || !key) {
  console.error(`Usage : node capture.mjs --id <deviceId> --key <localKey> [--ip <ip>] [--version 3.3|3.4|3.5]
                        [--set <dp>=<valeurJSON>] [--out captures/ventilateur.jsonl]
Ou via variables d'environnement TUYA_ID, TUYA_KEY, TUYA_IP, TUYA_VERSION (fichier .env pris en compte).`)
  process.exit(args.help ? 0 : 2)
}

const now = () => new Date().toISOString()
const log = (...parts) => console.log(now().slice(11, 23), ...parts)

// Journal JSONL : une ligne par événement, réutilisable telle quelle comme fixture (anonymiser
// l'id avant de la committer).
await mkdir(dirname(args.out), { recursive: true })
const record = (event, payload) => appendFile(args.out, JSON.stringify({ at: now(), event, ...payload }) + '\n')

/** Dernier état complet connu et, par DP, la liste ordonnée des valeurs distinctes observées. */
const state = {}
const seen = new Map()

function absorb(event, dps) {
  const changed = {}
  for (const [dp, value] of Object.entries(dps ?? {})) {
    const before = state[dp]
    const same = JSON.stringify(before) === JSON.stringify(value)
    if (!same) changed[dp] = { from: before, to: value }
    state[dp] = value
    const values = seen.get(dp) ?? []
    if (!values.some((v) => JSON.stringify(v) === JSON.stringify(value))) values.push(value)
    seen.set(dp, values)
  }
  if (Object.keys(changed).length === 0) {
    log(`[${event}] aucun changement`, JSON.stringify(dps))
  } else {
    for (const [dp, { from, to }] of Object.entries(changed)) {
      log(`[${event}] DP ${dp} : ${JSON.stringify(from)} → ${JSON.stringify(to)}`)
    }
  }
  void record(event, { dps, changed })
}

function printTable() {
  const rows = Object.entries(state)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([dp, value]) => ({ DP: dp, type: typeof value, valeur: JSON.stringify(value) }))
  console.table(rows)
}

const device = new TuyAPI({
  id,
  key,
  ...(ip ? { ip } : {}),
  ...(version ? { version } : {}),
  // On veut voir chaque trame arriver nous-mêmes, pas un get implicite à la connexion.
  issueGetOnConnect: false,
  issueRefreshOnConnect: false,
})

device.on('connected', () => log('connecté'))
device.on('disconnected', () => log('déconnecté'))
device.on('error', (err) => {
  log('erreur :', err?.message ?? err)
  void record('error', { message: String(err?.message ?? err) })
})
// `data` : réponse complète (ou trame spontanée) ; `dp-refresh` : mise à jour partielle poussée
// par l'appareil. Les deux portent { dps } — c'est là qu'on lit ce que la télécommande a changé.
device.on('data', (msg) => absorb('data', msg?.dps))
device.on('dp-refresh', (msg) => absorb('dp-refresh', msg?.dps))

// Pas d'IP fournie : recherche par diffusion UDP (l'appareil annonce son IP et sa version).
if (!ip) {
  log('recherche de l\'appareil sur le LAN (10 s)…')
  try {
    await device.find({ timeout: 10 })
    log(`trouvé : ip=${device.device.ip} version=${device.device.version}`)
  } catch (err) {
    console.error(`Appareil introuvable par diffusion : ${err?.message ?? err}
→ Donner --ip (et --version 3.5 pour un firmware récent, qui ne diffuse pas sur les ports écoutés).`)
    process.exit(1)
  }
}

await device.connect()

log('lecture de tous les DPS…')
const first = await device.get({ schema: true })
absorb('get', first?.dps ?? first)
printTable()

// Commande unique passée en ligne : utile pour scripter (ex. tester chaque vitesse 1 à 6).
if (args.set) {
  const [dp, ...rest] = args.set.split('=')
  await sendSet(dp, rest.join('='))
}

console.log(`
Actionnez la télécommande RF ou l'appli du fabricant : chaque DP qui change s'affiche ci-dessus
et va dans ${args.out}. Tapez « <dp> <valeur> » pour envoyer une commande, « get » pour tout relire,
Ctrl+C pour terminer.`)

const rl = createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  if (trimmed === 'get') {
    const res = await device.get({ schema: true }).catch((err) => log('get en échec :', err?.message ?? err))
    if (res) absorb('get', res?.dps ?? res)
    return
  }
  const [dp, ...rest] = trimmed.split(/\s+/)
  await sendSet(dp, rest.join(' '))
})

async function sendSet(dp, raw) {
  const dpNumber = Number(dp)
  if (!Number.isInteger(dpNumber)) {
    log(`DP invalide : « ${dp} »`)
    return
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    value = raw // valeur textuelle brute (énumérations Tuya : "low", "forward"…)
  }
  log(`→ set DP ${dpNumber} = ${JSON.stringify(value)}`)
  void record('set', { dps: { [dpNumber]: value } })
  try {
    const res = await device.set({ dps: dpNumber, set: value })
    // L'appareil répond souvent avec l'état résultant ; s'il refuse, la valeur ne bouge pas.
    if (res?.dps) absorb('set-response', res.dps)
    else log('réponse :', JSON.stringify(res))
  } catch (err) {
    log('set en échec :', err?.message ?? err)
  }
}

process.on('SIGINT', () => {
  console.log('\n\nRécapitulatif des valeurs observées par DP :')
  console.table(
    [...seen.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([dp, values]) => ({ DP: dp, type: typeof values[0], valeurs: values.map((v) => JSON.stringify(v)).join(', ') })),
  )
  console.log(`Journal : ${args.out}`)
  rl.close()
  device.disconnect()
  process.exit(0)
})
