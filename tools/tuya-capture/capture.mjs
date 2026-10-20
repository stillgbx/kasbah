#!/usr/bin/env node
// Capture of the DPS ("data points") of a Tuya device LOCALLY, with no cloud at run time.
// Goal: discover which DP carries what on the CREATE fan (on/off, speed, light,
// intensity…) and on what scale, by observing what changes when the RF remote
// or the vendor's app is operated. The JSONL output then serves as a fixture for the plugin.
//
// Prerequisites (only once, to obtain the id and the local key):
//   1. Account on https://iot.tuya.com → Cloud → Development → "Smart Home" project.
//      Choose the data center of the app (Central Europe for a French account).
//   2. "Link Tuya App Account" tab → scan the QR code from the mobile app
//      (Smart Life / Tuya Smart; for the CREATE app, try "Others" — otherwise re-pair the
//      fan in Smart Life). The "IoT Core" service is a one-month trial: it is only used
//      to read the key, never again afterwards. The key changes if the device is re-paired.
//   3. npx @tuyapi/cli wizard → lists names, ids and local keys of the devices of the account.
//
// Usage (in tools/tuya-capture, after `npm install`):
//   npm run capture -- --id <deviceId> --key <localKey> [--ip <ip>] [--version 3.3|3.4|3.5]
//                       [--set <dp>=<JSONvalue>] [--out captures/ventilateur.jsonl]
//   or via .env (copy .env.example): TUYA_ID, TUYA_KEY, TUYA_IP, TUYA_VERSION.
//
// Once connected, type in the terminal:
//   <dp> <JSONvalue>    → sends the value on that DP (e.g. `3 4` for speed 4, `1 true`, `9 false`)
//   get                 → re-reads all the DPS
//   Ctrl+C              → disconnects and displays the summary of the values seen per DP
//
// Known pitfall: a Tuya device only accepts ONE local connection at a time. Close the mobile
// app (or take it off the same Wi-Fi) if the connection is refused or drops immediately.

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
  console.error(`Usage: node capture.mjs --id <deviceId> --key <localKey> [--ip <ip>] [--version 3.3|3.4|3.5]
                        [--set <dp>=<JSONvalue>] [--out captures/ventilateur.jsonl]
Or via environment variables TUYA_ID, TUYA_KEY, TUYA_IP, TUYA_VERSION (.env file taken into account).`)
  process.exit(args.help ? 0 : 2)
}

const now = () => new Date().toISOString()
const log = (...parts) => console.log(now().slice(11, 23), ...parts)

// JSONL log: one line per event, reusable as is as a fixture (anonymize
// the id before committing it).
await mkdir(dirname(args.out), { recursive: true })
const record = (event, payload) => appendFile(args.out, JSON.stringify({ at: now(), event, ...payload }) + '\n')

/** Last known complete state and, per DP, the ordered list of distinct values observed. */
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
  // We want to see each frame arrive ourselves, not an implicit get on connection.
  issueGetOnConnect: false,
  issueRefreshOnConnect: false,
})

device.on('connected', () => log('connecté'))
device.on('disconnected', () => log('déconnecté'))
device.on('error', (err) => {
  log('erreur :', err?.message ?? err)
  void record('error', { message: String(err?.message ?? err) })
})
// `data`: complete response (or spontaneous frame); `dp-refresh`: partial update pushed
// by the device. Both carry { dps } — that is where one reads what the remote changed.
device.on('data', (msg) => absorb('data', msg?.dps))
device.on('dp-refresh', (msg) => absorb('dp-refresh', msg?.dps))

// No IP provided: search by UDP broadcast (the device announces its IP and its version).
if (!ip) {
  log('recherche de l\'appareil sur le LAN (10 s)…')
  try {
    await device.find({ timeout: 10 })
    log(`trouvé : ip=${device.device.ip} version=${device.device.version}`)
  } catch (err) {
    console.error(`Device not found by broadcast: ${err?.message ?? err}
→ Give --ip (and --version 3.5 for a recent firmware, which does not broadcast on the listened ports).`)
    process.exit(1)
  }
}

await device.connect()

log('lecture de tous les DPS…')
const first = await device.get({ schema: true })
absorb('get', first?.dps ?? first)
printTable()

// Single command passed on the command line: useful for scripting (e.g. testing each speed from 1 to 6).
if (args.set) {
  const [dp, ...rest] = args.set.split('=')
  await sendSet(dp, rest.join('='))
}

console.log(`
Operate the RF remote or the vendor's app: each DP that changes is displayed above
and goes into ${args.out}. Type "<dp> <value>" to send a command, "get" to re-read everything,
Ctrl+C to finish.`)

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
    value = raw // raw text value (Tuya enumerations: "low", "forward"…)
  }
  log(`→ set DP ${dpNumber} = ${JSON.stringify(value)}`)
  void record('set', { dps: { [dpNumber]: value } })
  try {
    const res = await device.set({ dps: dpNumber, set: value })
    // The device often answers with the resulting state; if it refuses, the value does not move.
    if (res?.dps) absorb('set-response', res.dps)
    else log('réponse :', JSON.stringify(res))
  } catch (err) {
    log('set en échec :', err?.message ?? err)
  }
}

process.on('SIGINT', () => {
  console.log('\n\nSummary of the values observed per DP:')
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
