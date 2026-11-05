/**
 * SURVEY (throwaway): checks the Hue Entertainment stream end to end before the plugin uses it.
 *
 *   node --env-file=apps/server/.env --import tsx tools/hue-entertainment-probe.mts pair
 *   node --env-file=apps/server/.env --import tsx tools/hue-entertainment-probe.mts list
 *   node --env-file=apps/server/.env --import tsx tools/hue-entertainment-probe.mts stream <area id>
 *
 * `pair` (press the bridge button first) asks for a NEW application key with its client key and
 * saves both to apps/server/.state/hue-probe-keys.json (untracked) — never printed. `list` shows
 * the entertainment areas. `stream` starts one, alternates red and blue on every channel for 6 s,
 * stops it, then re-reads the lights to see whether the bridge restored their previous state.
 * Keys: HUE_APP_KEY / HUE_CLIENT_KEY from the environment, else the probe's file.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { Agent, fetch } from 'undici'
import { dtls } from 'node-dtls-client'
import { encodeFrame, type ChannelColor } from '../apps/server/src/plugins/hue/entertainment'

const KEYS_FILE = new URL('../apps/server/.state/hue-probe-keys.json', import.meta.url)
const host = process.env.HUE_BRIDGE_HOST
if (!host) throw new Error('HUE_BRIDGE_HOST is not set')
// throwaway LAN probe: the bridge's certificate is signed by the Signify CA, not a public one
const dispatcher = new Agent({ connect: { rejectUnauthorized: false } })

async function keys(): Promise<{ appKey: string; clientKey: string }> {
  if (process.env.HUE_APP_KEY && process.env.HUE_CLIENT_KEY) return { appKey: process.env.HUE_APP_KEY, clientKey: process.env.HUE_CLIENT_KEY }
  try { return JSON.parse(await readFile(KEYS_FILE, 'utf8')) as { appKey: string; clientKey: string } }
  catch { throw new Error('no client key: run `pair` first (or set HUE_APP_KEY and HUE_CLIENT_KEY)') }
}

async function clip(method: string, path: string, appKey: string, body?: unknown): Promise<{ data: unknown[]; errors: unknown[] }> {
  const res = await fetch(`https://${host}${path}`, {
    method, dispatcher,
    headers: { 'hue-application-key': appKey, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json() as { data: unknown[]; errors: unknown[] }
  if (!res.ok || json.errors?.length) console.log(`  ${method} ${path} → HTTP ${res.status}`, JSON.stringify(json.errors))
  return json
}

interface Area {
  id: string
  metadata?: { name?: string }
  status?: string
  configuration_type?: string
  channels: { channel_id: number; position: { x: number; y: number; z: number }; members: { service: { rid: string } }[] }[]
  light_services?: { rid: string }[]
}
interface Light { id: string; metadata?: { name?: string }; on?: { on: boolean }; dimming?: { brightness: number }; color?: { xy: { x: number; y: number } } }

/** Retries for 10 minutes: the button can be pressed whenever the user gets to the bridge. */
async function pair(): Promise<void> {
  const deadline = Date.now() + 10 * 60_000
  type PairReply = { success?: { username: string; clientkey?: string }; error?: { type: number; description: string } }
  let first: PairReply | undefined
  for (;;) {
    const res = await fetch(`https://${host}/api`, {
      method: 'POST', dispatcher, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ devicetype: 'kasbah#server', generateclientkey: true }),
    })
    first = (await res.json() as PairReply[])[0]
    if (first?.error?.type !== 101 || Date.now() > deadline) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (first?.error) throw new Error(first.error.type === 101 ? 'link button not pressed' : first.error.description)
  if (!first?.success?.clientkey) throw new Error('the bridge gave no client key')
  await writeFile(KEYS_FILE, JSON.stringify({ appKey: first.success.username, clientKey: first.success.clientkey }, null, 2))
  console.log(`paired: keys saved to ${KEYS_FILE.pathname} (not printed)`)
}

async function lightsById(appKey: string): Promise<Map<string, Light>> {
  const { data } = await clip('GET', '/clip/v2/resource/light', appKey)
  return new Map((data as Light[]).map((l) => [l.id, l]))
}

const describeLight = (l: Light | undefined) => l
  ? `${l.metadata?.name ?? l.id}: ${l.on?.on ? 'on' : 'off'} ${l.dimming?.brightness ?? '?'}% xy=${l.color ? `${l.color.xy.x.toFixed(3)},${l.color.xy.y.toFixed(3)}` : '-'}`
  : '?'

async function list(): Promise<void> {
  const appKey = process.env.HUE_APP_KEY ?? (await keys()).appKey   // listing needs no client key
  const lights = await lightsById(appKey)
  const { data } = await clip('GET', '/clip/v2/resource/entertainment_configuration', appKey)
  if (data.length === 0) console.log('no entertainment area: create one in the Hue app (Settings → Entertainment areas)')
  for (const a of data as Area[]) {
    console.log(`${a.id}  "${a.metadata?.name}"  ${a.configuration_type} status=${a.status}`)
    for (const c of a.channels) console.log(`  channel ${c.channel_id} at (${c.position.x}, ${c.position.y}, ${c.position.z}) members=${c.members.length}`)
    for (const s of a.light_services ?? []) console.log(`  light ${describeLight(lights.get(s.rid))}`)
  }
}

async function stream(areaId: string): Promise<void> {
  const { appKey, clientKey } = await keys()
  const { data } = await clip('GET', `/clip/v2/resource/entertainment_configuration/${areaId}`, appKey)
  const area = (data as Area[])[0]
  if (!area) throw new Error(`no entertainment area ${areaId}`)
  const lightIds = (area.light_services ?? []).map((s) => s.rid)
  const before = await lightsById(appKey)
  console.log('before:'); for (const id of lightIds) console.log(`  ${describeLight(before.get(id))}`)

  await clip('PUT', `/clip/v2/resource/entertainment_configuration/${areaId}`, appKey, { action: 'start' })
  const t0 = Date.now()
  const socket = dtls.createSocket({
    type: 'udp4', address: host!, port: 2100, timeout: 3000,
    psk: { [appKey]: Buffer.from(clientKey, 'hex') },
    ciphers: ['TLS_PSK_WITH_AES_128_GCM_SHA256'],
  })
  await new Promise<void>((resolve, reject) => {
    socket.on('connected', () => { console.log(`DTLS connected in ${Date.now() - t0} ms`); resolve() })
    socket.on('error', reject)
  })

  let seq = 0
  let sent = 0
  const start = Date.now()
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = Date.now() - start
      if (elapsed >= 6000) { resolve(); return }
      const red = Math.floor(elapsed / 500) % 2 === 0
      const colors: ChannelColor[] = area.channels.map((c) => ({ id: c.channel_id, r: red ? 1 : 0, g: 0, b: red ? 0 : 1 }))
      socket.send(encodeFrame(areaId, seq++, colors))
      sent++
      setTimeout(tick, 20)
    }
    tick()
  })
  console.log(`${sent} frames in 6 s (${(sent / 6).toFixed(1)}/s)`)
  socket.close()
  await clip('PUT', `/clip/v2/resource/entertainment_configuration/${areaId}`, appKey, { action: 'stop' })

  await new Promise((r) => setTimeout(r, 2000))
  const after = await lightsById(appKey)
  console.log('2 s after stop:'); for (const id of lightIds) console.log(`  ${describeLight(after.get(id))}`)
}

const [cmd, arg] = process.argv.slice(2)
try {
  if (cmd === 'pair') await pair()
  else if (cmd === 'list') await list()
  else if (cmd === 'stream' && arg) await stream(arg)
  else console.log('usage: pair | list | stream <area id>')
} finally {
  await dispatcher.close()
}
