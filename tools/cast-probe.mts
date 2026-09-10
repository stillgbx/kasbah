/**
 * RELEVÉ (jetable) : ouvre une connexion Cast vers un appareil, s'annonce auprès de l'appli qui
 * tourne, et écoute TOUT ce qui passe sur les canaux qu'elle déclare — plus quelques questions
 * envoyées à la main. Sert à répondre « le protocole donne-t-il X ? » par une capture, pas par une
 * supposition (ici : l'id de la vidéo YouTube, pour en tirer la vignette publique).
 *
 *   npx tsx tools/cast-probe.mts 192.168.1.87
 *
 * Lecture seule : aucune commande de transport n'est envoyée. Une seconde connexion de « sender »
 * ne dérange pas le plugin, le protocole en accepte plusieurs.
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
  console.log(`connecté à ${host}:8009`)
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
    // première réponse du récepteur : s'annoncer auprès de l'appli et l'interroger sur ses canaux
    const app = (JSON.parse(m.payload) as { status?: { applications?: { transportId?: string; isIdleScreen?: boolean }[] } }).status?.applications?.find((a) => !a.isIdleScreen)
    if (!app?.transportId) { console.log('aucune appli à interroger'); continue }
    transportId = app.transportId
    send(transportId, NS_CONNECTION, { type: 'CONNECT' })
    send(transportId, NS_MEDIA, { type: 'GET_STATUS', requestId: nextId() })
    // Le canal MDX est celui qu'utilise le téléphone pour piloter YouTube sur la TV : on lui pose les
    // questions connues de ce protocole, et on regarde ce qu'il pousse de lui-même.
    send(transportId, NS_MDX, { type: 'getMdxSessionStatus' })
    send(transportId, NS_MDX, { type: 'getNowPlaying' })
    send(transportId, NS_CUSTOM, { type: 'getStatus' })
    send(transportId, NS_SYSTEM, { type: 'getStatus' })
  }
})

socket.on('error', (err) => { console.error('erreur socket', err.message); process.exit(1) })
setInterval(() => send(RECEIVER_ID, NS_HEARTBEAT, { type: 'PING' }), 5000)
setTimeout(() => { console.log('fin du relevé'); socket.destroy(); process.exit(0) }, LISTEN_MS)
