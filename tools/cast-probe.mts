/**
 * SURVEY (throwaway): opens a Cast connection to a device, announces itself to the running
 * app, and listens to EVERYTHING that passes on the channels it declares — plus a few questions
 * sent by hand. Used to answer "does the protocol give X?" with a capture, not with a
 * guess (here: the YouTube video id, to derive the public thumbnail from it).
 *
 *   npx tsx tools/cast-probe.mts 192.168.1.87
 *
 * Read-only: no transport command is sent. A second "sender" connection
 * does not disturb the plugin, the protocol accepts several.
 */
import { connect } from 'node:tls'
import { FrameDecoder, encodeFrame, jsonMessage, NS_CONNECTION, NS_HEARTBEAT, NS_MEDIA, NS_RECEIVER, RECEIVER_ID } from '../apps/server/src/plugins/google_cast/protocol'

const host = process.argv[2] ?? '192.168.1.87'
const SENDER = 'sender-probe'
const NS_MDX = 'urn:x-cast:com.google.youtube.mdx'
const NS_CUSTOM = 'urn:x-cast:com.google.cast.customdata'
const NS_SYSTEM = 'urn:x-cast:com.google.cast.system'
const LISTEN_MS = 20_000

const socket = connect({ host, port: 8009, rejectUnauthorized: false }, () => {
  console.log(`connected to ${host}:8009`)
  send(RECEIVER_ID, NS_CONNECTION, { type: 'CONNECT' })
  send(RECEIVER_ID, NS_RECEIVER, { type: 'GET_STATUS', requestId: nextId() })
})

let requestId = 0
const nextId = () => ++requestId
function send(destination: string, namespace: string, body: Record<string, unknown>): void {
  socket.write(encodeFrame(jsonMessage(SENDER, destination, namespace, body)))
  console.log(`→ ${namespace.replace('urn:x-cast:com.google.', '')} ${JSON.stringify(body)}`)
}

const decoder = new FrameDecoder()
let transportId: string | null = null

socket.on('data', (chunk: Buffer) => {
  for (const m of decoder.push(chunk)) {
    if (m.namespace === NS_HEARTBEAT) { if (m.payload.includes('PING')) send(RECEIVER_ID, NS_HEARTBEAT, { type: 'PONG' }); continue }
    const short = m.namespace.replace('urn:x-cast:com.google.', '')
    console.log(`← ${short} ${m.payload.slice(0, 2000)}`)
    if (transportId || m.namespace !== NS_RECEIVER) continue
    // first reply of the receiver: announce ourselves to the app and query it about its channels
    const app = (JSON.parse(m.payload) as { status?: { applications?: { transportId?: string; isIdleScreen?: boolean }[] } }).status?.applications?.find((a) => !a.isIdleScreen)
    if (!app?.transportId) { console.log('no app to query'); continue }
    transportId = app.transportId
    send(transportId, NS_CONNECTION, { type: 'CONNECT' })
    send(transportId, NS_MEDIA, { type: 'GET_STATUS', requestId: nextId() })
    // The MDX channel is the one the phone uses to drive YouTube on the TV: we ask it the
    // known questions of this protocol, and watch what it pushes by itself.
    send(transportId, NS_MDX, { type: 'getMdxSessionStatus' })
    send(transportId, NS_MDX, { type: 'getNowPlaying' })
    send(transportId, NS_CUSTOM, { type: 'getStatus' })
    send(transportId, NS_SYSTEM, { type: 'getStatus' })
  }
})

socket.on('error', (err) => { console.error('erreur socket', err.message); process.exit(1) })
setInterval(() => send(RECEIVER_ID, NS_HEARTBEAT, { type: 'PING' }), 5000)
setTimeout(() => { console.log('end of the survey'); socket.destroy(); process.exit(0) }, LISTEN_MS)
