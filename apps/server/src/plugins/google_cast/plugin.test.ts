import { ManualClock } from '@kasbah/mock-sim'
import { Duplex, PassThrough } from 'node:stream'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import {
  CAST_REGISTRY_NETFLIX, CAST_REGISTRY_PRIME_VIDEO, CAST_REGISTRY_YOUTUBE, CRUNCHYROLL_OBJECT_EPISODE, DEEZER_SEARCH_BOUNDARY, ITUNES_SEARCH_BOUNDARY, CRUNCHYROLL_OBJECT_SERIES, CRUNCHYROLL_TOKEN, MEDIA_STATUS_CRUNCHYROLL, MEDIA_STATUS_PLAYING, MEDIA_STATUS_PRIME_VIDEO, MEDIA_STATUS_RADIO, MEDIA_STATUS_YOUTUBE_TV, RECEIVER_STATUS_CHROMECAST_FIXED,
  RECEIVER_STATUS_CRUNCHYROLL, RECEIVER_STATUS_NEST_HUB_IDLE, RECEIVER_STATUS_NETFLIX, RECEIVER_STATUS_PLAYING, RECEIVER_STATUS_PRIME_VIDEO, RECEIVER_STATUS_RADIO, RECEIVER_STATUS_YOUTUBE_TV, SERVICE_BRAVIA, SERVICE_CHROMECAST,
  SERVICE_NEST_HUB, SERVICE_NEST_MINI, TXT_BRAVIA, TXT_CHROMECAST, TXT_NEST_HUB, TXT_NEST_MINI,
} from './__fixtures__/network'
import { BRAVIA_INPUTS_ARC_SOUNDBAR, BRAVIA_SOUND_AUDIO_SYSTEM, BRAVIA_SOUND_SPEAKER } from './__fixtures__/bravia'
import type { BraviaFetch } from './bravia'
import type { SocketFactory } from './channel'
import type { CastDiscovery } from './discovery'
import type { RegistryFetch } from './enrich/appIcon'
import type { CoverFetch } from './enrich/cover'
import type { EnrichFetch } from './enrich/crunchyroll'
import { createGoogleCastPlugin, googleCastConfigSchema, type ArtFetch } from './index'
import { FrameDecoder, NS_HEARTBEAT, NS_MEDIA, NS_RECEIVER, encodeFrame, jsonMessage } from './protocol'
import type { CastService } from './types'

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

interface Sent { namespace: string; destination: string; body: Record<string, unknown> }

/**
 * Faux récepteur Cast au bout d'une socket en mémoire : répond aux GET_STATUS, SET_VOLUME, PING et
 * aux commandes média avec le `requestId` reçu, comme le vrai. `receiver` et `media` sont ses états
 * courants, modifiables par le test ; `push` envoie un état non sollicité.
 */
function fakeReceiver(receiver: Record<string, unknown>, media?: Record<string, unknown>) {
  const sent: Sent[] = []
  const toReceiver = new PassThrough(), fromReceiver = new PassThrough()
  const decoder = new FrameDecoder()
  const state = { receiver: structuredClone(receiver), media: media ? structuredClone(media) : undefined, sent, closed: false }
  const reply = (to: string, namespace: string, body: Record<string, unknown>) => { if (!state.closed) fromReceiver.write(encodeFrame(jsonMessage(to === 'sender-0' ? 'receiver-0' : to, 'sender-0', namespace, body))) }
  const mediaStatus = (requestId: number | undefined) => ({ type: 'MEDIA_STATUS', requestId, status: state.media ? [state.media] : [] })
  /** Comme le vrai récepteur : une commande de transport est acquittée par un état SANS le bloc `media` (inchangé). */
  const mediaDelta = (requestId: number | undefined) => {
    const { media: _omitted, ...rest } = state.media as Record<string, unknown>
    return { type: 'MEDIA_STATUS', requestId, status: [rest] }
  }
  toReceiver.on('data', (chunk: Buffer) => {
    for (const m of decoder.push(chunk)) {
      const body = JSON.parse(m.payload) as Record<string, unknown>
      sent.push({ namespace: m.namespace, destination: m.destinationId, body })
      const requestId = body.requestId as number | undefined
      if (m.namespace === NS_HEARTBEAT && body.type === 'PING') reply(m.destinationId, NS_HEARTBEAT, { type: 'PONG' })
      if (m.namespace === NS_RECEIVER) {
        if (body.type === 'SET_VOLUME') {
          const v = body.volume as { level?: number; muted?: boolean }
          state.receiver.volume = { ...(state.receiver.volume as object), ...v }
        }
        // STOP d'une session : l'appli se ferme, le récepteur répond par un état sans appli
        if (body.type === 'STOP') { state.receiver = { ...state.receiver, applications: [] }; state.media = undefined }
        reply(m.destinationId, NS_RECEIVER, { type: 'RECEIVER_STATUS', requestId, status: state.receiver })
      }
      if (m.namespace === NS_MEDIA) {
        if (!state.media) { reply(m.destinationId, NS_MEDIA, { type: 'INVALID_REQUEST', requestId, reason: 'INVALID_MEDIA_SESSION_ID' }); continue }
        if (body.type === 'PAUSE') state.media.playerState = 'PAUSED'
        if (body.type === 'PLAY') state.media.playerState = 'PLAYING'
        if (body.type === 'SEEK') state.media.currentTime = body.currentTime
        reply(m.destinationId, NS_MEDIA, ['PAUSE', 'PLAY', 'SEEK'].includes(body.type as string) ? mediaDelta(requestId) : mediaStatus(requestId))
      }
    }
  })
  const socket = Duplex.from({ writable: toReceiver, readable: fromReceiver })
  return {
    state, sent, socket,
    push(receiver: Record<string, unknown>) { state.receiver = structuredClone(receiver); reply('sender-0', NS_RECEIVER, { type: 'RECEIVER_STATUS', status: state.receiver }) },
    pushMedia(media: Record<string, unknown> | undefined, transportId: string) { state.media = media ? structuredClone(media) : undefined; if (!state.closed) fromReceiver.write(encodeFrame(jsonMessage(transportId, 'sender-0', NS_MEDIA, mediaStatus(undefined)))) },
    /** L'appareil coupe (redémarrage, Wi-Fi perdu). */
    drop() { state.closed = true; fromReceiver.end() },
    of(type: string): Sent[] { return sent.filter((s) => s.body.type === type) },
  }
}

function fakeDiscovery(initial: CastService[]) {
  let onUp: ((s: CastService) => void) | null = null
  const d: CastDiscovery & { announce(s: CastService): void } = {
    start: vi.fn((cb) => { onUp = cb; for (const s of initial) cb(s) }),
    refresh: vi.fn(), stop: vi.fn(),
    announce(s) { onUp?.(s) },
  }
  return d
}

function fakeContext(clock: ManualClock, config: Record<string, string> = {}) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    // `CAST_KNOWN_FILE` vide : aucun test ne doit lire ni écrire la mémoire réelle du poste de dev.
    // `CAST_COVER_LOOKUP` faux : aucun test ne doit sortir sur le réseau — le test qui l'éprouve
    // l'active en injectant de faux catalogues.
    pluginId: 'google_cast', config: googleCastConfigSchema.parse({ CAST_DISCOVERY_WAIT_MS: '1000', CAST_KNOWN_FILE: '', CAST_COVER_LOOKUP: 'false', ...config }), logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
  }
  return { ctx, ctrl }
}

/** Câble un faux récepteur par hôte ; un hôte absent est injoignable. */
function network(receivers: Record<string, ReturnType<typeof fakeReceiver>>) {
  const connect: SocketFactory = vi.fn(async (host) => {
    const r = receivers[host]
    if (!r) throw new Error(`connect ECONNREFUSED ${host}`)
    return r.socket
  })
  return connect
}

/** Registre des applis Cast : muet par défaut (aucun test ne doit sortir sur le réseau), Netflix ou Prime Video connus sur demande. */
const noRegistry: RegistryFetch = async () => ({ ok: false, status: 404, text: async () => '' })
const netflixRegistry: RegistryFetch = async (url) => (url.endsWith('CA5E8412') ? { ok: true, status: 200, text: async () => CAST_REGISTRY_NETFLIX } : noRegistry(url))
const primeVideoRegistry: RegistryFetch = async (url) => (url.endsWith('17608BC8') ? { ok: true, status: 200, text: async () => CAST_REGISTRY_PRIME_VIDEO } : noRegistry(url))
/** Comme le vrai registre : la variante Android TV de YouTube (2C6A6E3D) ne rend AUCUN visuel. */
const youtubeRegistry: RegistryFetch = async (url) => (url.endsWith('233637DE') ? { ok: true, status: 200, text: async () => CAST_REGISTRY_YOUTUBE } : noRegistry(url))

/** Mémoire des appareils vus, en mémoire vive : ce que `known.ts` fait avec un fichier. */
function fakeKnown(initial: CastService[] = []) {
  let devices = initial
  return {
    async load() { return devices },
    async save(services: CastService[]) { devices = services },
    get current() { return devices },
  }
}

/** API d'une TV Sony : muette par défaut (aucun test ne doit sortir sur le réseau). */
const noBravia: BraviaFetch = async () => { throw new Error('ECONNREFUSED') }

async function started(discovery: CastDiscovery, connect: SocketFactory, fetchImpl?: ArtFetch, enrichFetch?: EnrichFetch, registryFetch: RegistryFetch = noRegistry, known?: ReturnType<typeof fakeKnown>, coverFetch?: CoverFetch, braviaFetch: BraviaFetch = noBravia) {
  const clock = new ManualClock(0)
  // injecter de faux catalogues, c'est vouloir éprouver la recherche de pochette : elle s'allume avec
  const { ctx, ctrl } = fakeContext(clock, coverFetch ? { CAST_COVER_LOOKUP: 'true' } : {})
  const plugin = createGoogleCastPlugin({ discovery, connect, registryFetch, braviaFetch, ...(fetchImpl ? { fetchImpl } : {}), ...(enrichFetch ? { enrichFetch } : {}), ...(known ? { known } : {}), ...(coverFetch ? { coverFetch } : {}) })
  await plugin.init(ctx)
  const p = plugin.discover()
  await flush()
  clock.advance(1000)                                            // fin de la fenêtre d'écoute mDNS
  await flush(8)
  const descriptors = await p
  await plugin.start()
  return { plugin, ctx, ctrl, clock, descriptors }
}

const patches = (ctx: PluginContext, externalId: string) =>
  (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === externalId).map((c) => c[1] as Record<string, unknown>)

describe('google_cast plugin', () => {
  it('discovers the devices, connects to each and publishes their capabilities and state', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE), tv = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const { plugin, ctx, descriptors } = await started(fakeDiscovery([SERVICE_NEST_HUB, SERVICE_CHROMECAST]), network({ [SERVICE_NEST_HUB.host]: hub, [SERVICE_CHROMECAST.host]: tv }))

    expect(descriptors.map((d) => d.name)).toEqual(['Réveil parents', "Chambre 3"])
    expect(descriptors[0]!.capabilities).toContain('volume')
    expect(descriptors[1]!.capabilities).not.toContain('volume')          // volume `fixed` connu dès le premier état
    // le récepteur a reçu CONNECT puis GET_STATUS
    expect(hub.sent.map((s) => s.body.type)).toEqual(['CONNECT', 'GET_STATUS'])
    // rien n'est publié pendant discover (les appareils ne sont pas encore enregistrés) : un seul patch complet au start
    expect(patches(ctx, TXT_NEST_HUB.id)).toEqual([{ volume: 20, muted: false, playback: 'idle', nowPlaying: null }])
    expect(ctx.setAvailable).not.toHaveBeenCalled()
    expect(plugin.health!()).toEqual({ status: 'ok', detail: '2 device(s), 2 connected' })
    await plugin.stop()
  })

  it('lists an unreachable device anyway, unavailable, and retries later', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_HUB.host]: hub }
    const { plugin, ctx, clock, descriptors } = await started(fakeDiscovery([SERVICE_NEST_HUB, SERVICE_NEST_MINI]), network(receivers))
    expect(descriptors).toHaveLength(2)
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_NEST_MINI.id, false)
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '2 device(s), 1 connected' })

    // l'enceinte revient : la nouvelle tentative (backoff 5 s ± gigue) la trouve
    receivers[SERVICE_NEST_MINI.host] = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    clock.advance(7000)
    await flush(8)
    expect(patches(ctx, TXT_NEST_MINI.id)).toEqual([{ volume: 20, muted: false }, { playback: 'idle', nowPlaying: null }])
    await plugin.stop()
  })

  it('follows the running app: now playing, then pause acknowledged by the receiver', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    const transportId = RECEIVER_STATUS_PLAYING.applications[0]!.transportId
    // connexion au canal de l'appli, puis état média demandé
    expect(speaker.sent.filter((s) => s.destination === transportId).map((s) => s.body.type)).toEqual(['CONNECT', 'GET_STATUS'])
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: 'Terracotta', artist: 'Mira Solano', source: 'Spotify' } })

    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.pause' })
    expect(speaker.of('PAUSE')[0]).toMatchObject({ destination: transportId, body: { mediaSessionId: 1 } })
    await flush()
    // l'accusé de PAUSE ne porte pas `media` : le morceau connu est conservé
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'paused', nowPlaying: { title: 'Terracotta', artist: 'Mira Solano' } })

    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.next' })
    expect(speaker.of('QUEUE_UPDATE')[0]!.body).toMatchObject({ jump: 1, mediaSessionId: 1 })

    // se placer dans le morceau : SEEK, et l'état qui revient porte la nouvelle position
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.seek', positionS: 90 })
    expect(speaker.of('SEEK')[0]!.body).toMatchObject({ mediaSessionId: 1, currentTime: 90 })
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ nowPlaying: { title: 'Terracotta', positionS: 90 } })
    // une nouvelle session sans `media` (autre morceau pas encore décrit) ne garde pas l'ancien
    speaker.pushMedia({ mediaSessionId: 2, playerState: 'BUFFERING' }, transportId)
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toEqual({ playback: 'playing', nowPlaying: null })
    expect(plugin.health!()).toMatchObject({ detail: expect.stringContaining('1 connected') })
    await plugin.stop()
  })

  it('"previous" restarts the track past three seconds, and goes back a track before that', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)          // currentTime 42.5
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    const transportId = RECEIVER_STATUS_PLAYING.applications[0]!.transportId
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.previous' })
    expect(speaker.of('SEEK')[0]).toMatchObject({ destination: transportId, body: { mediaSessionId: 1, currentTime: 0 } })
    expect(speaker.of('QUEUE_UPDATE')).toHaveLength(0)
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ nowPlaying: { title: 'Terracotta', positionS: 0 } })

    // deux secondes plus tard (position estimée ~2 s), « précédent » veut dire le morceau d'avant
    clock.advance(2000)
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.previous' })
    expect(speaker.of('QUEUE_UPDATE')[0]!.body).toMatchObject({ jump: -1, mediaSessionId: 1 })
    expect(speaker.of('SEEK')).toHaveLength(1)

    // quatre secondes après le dernier état, la position estimée dépasse le seuil : retour au début
    clock.advance(4000)
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.previous' })
    expect(speaker.of('SEEK')).toHaveLength(2)
    await plugin.stop()
  })

  it('refuses to skip or seek a LIVE stream, and sends nothing (real franceinfo capture)', async () => {
    // Relevé en réel : « précédent » sur le direct de franceinfo envoyait un SEEK à 0 (position >
    // 3 s, comme sur un morceau). Le flux s'arrêtait et l'appli ne repartait plus. Un direct n'a ni
    // début où revenir, ni piste voisine, quoi qu'annonce `supportedMediaCommands`.
    const speaker = fakeReceiver(RECEIVER_STATUS_RADIO, MEDIA_STATUS_RADIO)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: 'franceinfo', live: true } })

    for (const type of ['media_player.previous', 'media_player.next'] as const) {
      await expect(plugin.execute(TXT_NEST_MINI.id, { type })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('live stream') })
    }
    await expect(plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.seek', positionS: 0 })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    expect(speaker.of('SEEK')).toHaveLength(0)
    expect(speaker.of('QUEUE_UPDATE')).toHaveLength(0)

    // pause, reprise et volume, eux, marchent sur un direct : ils ne sont pas grisés
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.pause' })
    expect(speaker.of('PAUSE')).toHaveLength(1)
    await plugin.stop()
  })

  it('clears the track when the app stops, and refuses play when nothing plays', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    speaker.push(RECEIVER_STATUS_NEST_HUB_IDLE)                           // Spotify fermé, écran de veille
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toEqual({ playback: 'idle', nowPlaying: null })
    await expect(plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.play' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('nothing is playing') })
    await plugin.stop()
  })

  it('shows a native app without a media channel as on screen, and never talks to it (real Netflix capture)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, netflixRegistry)
    tv.push(RECEIVER_STATUS_NETFLIX)                                      // Netflix ouvert sur le Chromecast
    await flush(8)
    const onScreen = patches(ctx, TXT_CHROMECAST.id).filter((p) => p.playback === 'on')
    // d'abord l'état nu, sans attendre le registre ; puis le logo de l'appli (identifiant natif → CA5E8412), relayé par /art, en pochette de repli
    const icon = 'https://lh3.googleusercontent.com/anonymised-netflix-icon'
    expect(onScreen[0]).toEqual({ playback: 'on', nowPlaying: { title: '', source: 'Netflix' } })
    expect(onScreen.at(-1)).toEqual({ playback: 'on', nowPlaying: { title: '', source: 'Netflix', artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(icon)}` } })
    // pas de transportId : ni CONNECT vers l'appli ni GET_STATUS média, seulement ceux du récepteur à l'ouverture
    expect(tv.sent.filter((s) => s.destination !== 'receiver-0')).toEqual([])
    await expect(plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.pause' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    // « éteindre » = fermer l'appli : STOP de sa session sur le canal récepteur, acquitté par un état sans appli
    await plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.stop' })
    expect(tv.of('STOP')).toEqual([{ namespace: NS_RECEIVER, destination: 'receiver-0', body: { type: 'STOP', sessionId: '0a9d3eeb-0000-4000-8000-000000000005', requestId: expect.any(Number) } }])
    await flush()
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toEqual({ playback: 'idle', nowPlaying: null })
    await expect(plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.stop' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('nothing is on screen') })
    await plugin.stop()
  })

  it('sets the volume as a 0–1 level and refuses it on a fixed-volume device', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE), tv = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_HUB, SERVICE_CHROMECAST]), network({ [SERVICE_NEST_HUB.host]: hub, [SERVICE_CHROMECAST.host]: tv }))
    await plugin.execute(TXT_NEST_HUB.id, { type: 'media_player.set_volume', volume: 45 })
    expect(hub.of('SET_VOLUME')[0]!.body).toMatchObject({ volume: { level: 0.45 } })
    await flush()
    expect(patches(ctx, TXT_NEST_HUB.id).at(-1)).toEqual({ volume: 45, muted: false })
    await plugin.execute(TXT_NEST_HUB.id, { type: 'media_player.set_mute', muted: true })
    expect(hub.of('SET_VOLUME')[1]!.body).toMatchObject({ volume: { muted: true } })
    await expect(plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.set_volume', volume: 10 })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('nope', { type: 'media_player.play' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.stop()
  })

  it('marks a device unavailable when it drops, then reconnects with backoff', async () => {
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_HUB.host]: fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE) }
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_HUB]), network(receivers))
    receivers[SERVICE_NEST_HUB.host]!.drop()
    await flush()
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_NEST_HUB.id, false)
    await expect(plugin.execute(TXT_NEST_HUB.id, { type: 'media_player.set_volume', volume: 10 })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: '1 device(s), 0 connected' })

    receivers[SERVICE_NEST_HUB.host] = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    clock.advance(7000)
    await flush(8)
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
    await plugin.stop()
  })

  it('answers the receiver pings and gives up on a silent socket', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_HUB]), network({ [SERVICE_NEST_HUB.host]: hub }))
    clock.advance(5000)
    await flush()
    expect(hub.of('PING')).toHaveLength(1)                                 // notre battement de cœur, et le PONG est revenu
    hub.state.closed = true                                                // l'appareil ne répond plus, sans fermer
    clock.advance(20_000)
    await flush()
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_NEST_HUB.id, false)
    await plugin.stop()
  })

  it('publishes a device announced after discovery', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE), mini = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const discovery = fakeDiscovery([SERVICE_NEST_HUB])
    const { plugin, ctx, clock } = await started(discovery, network({ [SERVICE_NEST_HUB.host]: hub, [SERVICE_NEST_MINI.host]: mini }))
    expect(ctx.emitDevices).not.toHaveBeenCalled()
    discovery.announce(SERVICE_NEST_MINI)
    await flush(8)
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(2)
    expect(patches(ctx, TXT_NEST_MINI.id)[0]).toEqual({ volume: 20, muted: false })
    clock.advance(60_000)
    expect(discovery.refresh).toHaveBeenCalled()
    await plugin.stop()
    expect(discovery.stop).toHaveBeenCalled()
  })

  it('serves the artwork it has seen through /art, cached, and refuses any other URL', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const calls: string[] = []
    const fetchImpl: ArtFetch = vi.fn(async (url) => {
      calls.push(url)
      // Google se plaint une fois, puis sert l'image
      if (calls.length === 1) return { ok: false, status: 429, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
      return { ok: true, status: 200, headers: { get: (n: string) => (n === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer }
    })
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }), fetchImpl)
    const original = MEDIA_STATUS_PLAYING.media.metadata.images[0]!.url
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ nowPlaying: { artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(original)}` } })

    const app = Fastify()
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/google_cast' })
    await app.ready()
    // la nouvelle tentative attend 800 ms d'horloge : on l'avance pendant que la requête est en vol
    const pending = app.inject({ method: 'GET', url: `/api/plugins/google_cast/art?url=${encodeURIComponent(original)}` })
    await flush(); clock.advance(1000)
    const res = await pending
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.rawPayload.length).toBe(3)
    expect(calls).toHaveLength(2)                                           // 429 puis 200
    // en cache : pas de nouveau téléchargement
    expect((await app.inject({ method: 'GET', url: `/api/plugins/google_cast/art?url=${encodeURIComponent(original)}` })).statusCode).toBe(200)
    expect(calls).toHaveLength(2)
    // une URL jamais vue dans un état média n'est pas relayée
    expect((await app.inject({ method: 'GET', url: '/api/plugins/google_cast/art?url=https%3A%2F%2Fexample.com%2Fx.jpg' })).statusCode).toBe(404)
    await app.close()
    await plugin.stop()
  })

  it('enriches a Crunchyroll episode: series, S·E and thumbnail arrive in a second patch, then straight from cache', async () => {
    // vu en réel le 2026-09-10 : l'appareil peut omettre le titre lui-même, l'API le fournit
    const tv = fakeReceiver(RECEIVER_STATUS_CRUNCHYROLL, { ...MEDIA_STATUS_CRUNCHYROLL, media: { ...MEDIA_STATUS_CRUNCHYROLL.media, metadata: { metadataType: 0, artist: ' ' } } })
    const enrichFetch: EnrichFetch = vi.fn(async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith('/auth/v1/token') ? CRUNCHYROLL_TOKEN : url.includes('/cms/series/') ? CRUNCHYROLL_OBJECT_SERIES : CRUNCHYROLL_OBJECT_EPISODE) }))
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, enrichFetch)
    const all = patches(ctx, TXT_CHROMECAST.id)
    // d'abord ce que l'appareil a dit (titre seul), sans attendre Crunchyroll
    expect(all.at(-1)).toMatchObject({ nowPlaying: { title: '', source: 'Crunchyroll' } })
    expect((all.at(-1) as { nowPlaying: { artist?: string } }).nowPlaying.artist).toBeUndefined()
    await flush(8)
    // puis la même lecture, complétée
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      playback: 'playing',
      nowPlaying: { title: 'Un épisode de démonstration', artist: 'Les Chroniques de démo', album: 'S1 · E10', source: 'Crunchyroll', artUrl: expect.stringContaining('poster_tall') },
    })
    expect(enrichFetch).toHaveBeenCalledTimes(3)                           // jeton + épisode + série
    // l'affiche enrichie est servie par /art (URL connue), comme les pochettes des métadonnées
    const poster = CRUNCHYROLL_OBJECT_SERIES.data[0]!.images.poster_tall[0]![3]!.source
    expect((patches(ctx, TXT_CHROMECAST.id).at(-1) as { nowPlaying: { artUrl: string } }).nowPlaying.artUrl).toBe(`/api/plugins/google_cast/art?url=${encodeURIComponent(poster)}`)
    // un nouvel état du même contenu (pause) part enrichi d'un coup, depuis le cache
    await plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.pause' })
    await flush()
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({ playback: 'paused', nowPlaying: { artist: 'Les Chroniques de démo', album: 'S1 · E10' } })
    expect(enrichFetch).toHaveBeenCalledTimes(3)
    await plugin.stop()
  })

  it('leaves other apps alone and works without enrichment when disabled', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const enrichFetch: EnrichFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const { plugin } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }), undefined, enrichFetch)
    await flush(4)
    expect(enrichFetch).not.toHaveBeenCalled()                               // Spotify : rien à enrichir
    await plugin.stop()
    expect(googleCastConfigSchema.parse({ CAST_CRUNCHYROLL_ENRICH: 'false' }).CAST_CRUNCHYROLL_ENRICH).toBe(false)
  })

  it('remembers a device that stopped announcing itself: listed and unavailable, connected as soon as it speaks again', async () => {
    // le téléviseur a été vu lors d'un run précédent ; il est éteint, donc absent du mDNS et du réseau
    const known = fakeKnown([SERVICE_CHROMECAST])
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_MINI.host]: fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE) }
    const discovery = fakeDiscovery([SERVICE_NEST_MINI])
    const { plugin, ctx, descriptors } = await started(discovery, network(receivers), undefined, undefined, undefined, known)

    // il garde son nom, sa nature et ses capacités : l'entrée de house.json qui le vise reste lisible
    expect(descriptors.map((d) => d.name)).toEqual(['Chambre 3', 'Cuisine'])
    expect(descriptors[0]!.meta.mediaPlayer).toEqual({ deviceClass: 'tv' })
    expect(descriptors[0]!.meta.forgettable).toBe(true)
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_CHROMECAST.id, false)
    expect(plugin.health!()).toMatchObject({ detail: '2 device(s), 1 connected' })
    // la nouvelle enceinte est entrée dans la mémoire, le téléviseur y reste
    expect(known.current.map((s) => s.txt.id)).toEqual([TXT_CHROMECAST.id, TXT_NEST_MINI.id])

    // on rallume le téléviseur : son annonce suffit, sans attendre la fin du délai de reconnexion
    receivers[SERVICE_CHROMECAST.host] = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    discovery.announce(SERVICE_CHROMECAST)
    await flush(8)
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({ playback: 'idle' })
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '2 device(s), 2 connected' })
    await plugin.stop()
  })

  it('follows a device that changed address or name, and forgets one on demand', async () => {
    const known = fakeKnown()
    const first = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_MINI.host]: first }
    const discovery = fakeDiscovery([SERVICE_NEST_MINI])
    const { plugin, ctx, clock } = await started(discovery, network(receivers), undefined, undefined, undefined, known)

    // nouveau bail DHCP et renommage dans Google Home : l'ancienne connexion ne mène plus à rien
    const moved: CastService = { ...SERVICE_NEST_MINI, host: '192.168.1.207', txt: { ...TXT_NEST_MINI, fn: 'Cuisine bas' } }
    receivers[moved.host] = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    discovery.announce(moved)
    await flush()
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toMatchObject([{ name: 'Cuisine bas' }])
    expect(known.current[0]!.host).toBe(moved.host)
    clock.advance(7000)                                                   // nouvelle tentative, sur la nouvelle adresse
    await flush(8)
    expect(plugin.health!()).toMatchObject({ detail: '1 device(s), 1 connected' })

    // oublier : l'appareil sort de la liste ET de la mémoire (route pendant de `known.ts`)
    const app = Fastify()
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/google_cast' })
    await app.ready()
    const res = await app.inject({ method: 'DELETE', url: `/api/plugins/google_cast/devices/${TXT_NEST_MINI.id}` })
    expect(res.statusCode).toBe(200)
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toEqual([])
    expect(known.current).toEqual([])
    // un appareil déjà oublié n'est plus connu
    expect((await app.inject({ method: 'DELETE', url: `/api/plugins/google_cast/devices/${TXT_NEST_MINI.id}` })).statusCode).toBe(404)
    await app.close()
    await plugin.stop()
  })

  it('gives a Prime Video playback its position and the app logo, without inventing a title (real capture)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_PRIME_VIDEO, MEDIA_STATUS_PRIME_VIDEO)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, primeVideoRegistry)
    const all = patches(ctx, TXT_CHROMECAST.id)
    // `duration: -0.001` veut dire « inconnue » : pas de durée publiée, la position reste
    expect(all.at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: '', positionS: 141.89, source: 'Prime Video' } })
    expect((all.at(-1) as { nowPlaying: Record<string, unknown> }).nowPlaying).not.toHaveProperty('durationS')
    await flush(8)
    // puis le logo de l'appli en pochette de repli (appli native → 17608BC8 dans le registre), relayé par /art
    const icon = 'https://lh3.googleusercontent.com/anonymised-prime-video-icon'
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      nowPlaying: { title: '', source: 'Prime Video', artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(icon)}` },
    })
    await plugin.stop()
  })

  it('takes the app logo from the CANONICAL app id when a TV runs its own variant (real YouTube capture)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_YOUTUBE_TV, MEDIA_STATUS_YOUTUBE_TV)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, youtubeRegistry)
    // titre et artiste viennent de l'appli, mais elle ne publie aucune image
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      playback: 'playing',
      nowPlaying: { title: 'SLOW RIVERS - Live Performance (Piano Set)', artist: 'SLOW RIVERS', durationS: 1544.541, positionS: 602.781, source: 'YouTube' },
    })
    await flush(8)
    // le logo arrive par `universalAppId` (233637DE) : interroger `appId` (2C6A6E3D) ne rendait rien
    const icon = 'https://lh3.googleusercontent.com/anonymised-youtube-icon'
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      nowPlaying: { artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(icon)}` },
    })
    await plugin.stop()
  })

  it('prefers the cover of the track being played over the app logo (real YouTube + catalogue captures)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_YOUTUBE_TV, {
      ...MEDIA_STATUS_YOUTUBE_TV,
      media: { ...MEDIA_STATUS_YOUTUBE_TV.media, metadata: { metadataType: 0, title: 'Horizon', artist: 'Northwind et Lumen' } },
    })
    const catalogs: CoverFetch = vi.fn(async (url) => ({
      ok: true, status: 200,
      json: async () => (url.includes('itunes.apple.com') ? ITUNES_SEARCH_BOUNDARY : DEEZER_SEARCH_BOUNDARY),
    }))
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, youtubeRegistry, undefined, catalogs)
    // d'abord ce que l'appareil dit, sans image : on ne fait pas attendre le catalogue
    expect(patches(ctx, TXT_CHROMECAST.id)[0]).toMatchObject({ nowPlaying: { title: 'Horizon', artist: 'Northwind et Lumen' } })
    await flush(8)
    // puis la pochette de l'album, relayée par /art — et non le logo de YouTube
    const cover = 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/anonymised/199502092474_cover.jpg/600x600bb.jpg'
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      nowPlaying: { title: 'Horizon', artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(cover)}` },
    })
    expect(catalogs).toHaveBeenCalledTimes(1)                            // iTunes a suffi, Deezer n'a pas été appelé
    await plugin.stop()
  })

  it('asks a Sony TV where its sound goes and publishes it, but never asks anything else (real captures)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_YOUTUBE_TV, MEDIA_STATUS_YOUTUBE_TV), chromecast = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const replies: Record<string, unknown> = { getSoundSettings: BRAVIA_SOUND_AUDIO_SYSTEM, getCurrentExternalInputsStatus: BRAVIA_INPUTS_ARC_SOUNDBAR }
    const bravia: BraviaFetch = vi.fn(async (url, init) => {
      const { method } = JSON.parse(init.body) as { method: string }
      return { ok: true, status: 200, json: async () => replies[method] }
    })
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_BRAVIA, SERVICE_CHROMECAST]), network({ [SERVICE_BRAVIA.host]: tv, [SERVICE_CHROMECAST.host]: chromecast }), undefined, undefined, noRegistry, undefined, undefined, bravia)
    // relevé fait pendant `discover`, publié d'un bloc au `start` avec le reste de l'état
    expect(patches(ctx, TXT_BRAVIA.id)[0]).toMatchObject({ playback: 'playing', audioOutput: { terminal: 'external', name: 'Flexus 300' } })
    // seule la TV Sony est interrogée, et seulement à son adresse
    for (const call of (bravia as ReturnType<typeof vi.fn>).mock.calls) expect(call[0]).toMatch(`http://${SERVICE_BRAVIA.host}/sony/`)
    expect(patches(ctx, TXT_CHROMECAST.id).some((p) => 'audioOutput' in p)).toBe(false)

    // même réponse dix secondes plus tard : rien de republié (la relecture de position, elle, continue)
    const audioPatches = () => patches(ctx, TXT_BRAVIA.id).filter((p) => 'audioOutput' in p)
    expect(audioPatches()).toHaveLength(1)
    clock.advance(10_000)
    await flush(6)
    expect(audioPatches()).toHaveLength(1)
    // la TV repasse sur ses haut-parleurs : un patch, sans nom d'appareil (plus rien à nommer)
    replies.getSoundSettings = BRAVIA_SOUND_SPEAKER
    clock.advance(10_000)
    await flush(6)
    expect(audioPatches()).toHaveLength(2)
    expect(audioPatches().at(-1)).toEqual({ audioOutput: { terminal: 'internal' } })
    // la TV ne répond plus (éteinte) : le dernier relevé reste, rien d'inventé
    replies.getSoundSettings = { error: [403, 'Forbidden'] }
    clock.advance(10_000)
    await flush(6)
    expect(audioPatches()).toHaveLength(2)
    await plugin.stop()
  })

  it('reports no device found as degraded', async () => {
    const { plugin } = await started(fakeDiscovery([]), network({}))
    expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: expect.stringContaining('CAST_MDNS_INTERFACE') })
    await plugin.stop()
  })
})
