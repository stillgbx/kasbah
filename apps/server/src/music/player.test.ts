import Fastify from 'fastify'
import pino from 'pino'
import { expect, it } from 'vitest'
import { createMusicPlayer } from './player'

// L'adresse que le lecteur donne aux enceintes se déduit de la page qui commande. Ouverte par le nom
// public (proxy du NAS), ce serait une adresse qui exige une session : une enceinte ne s'y connecte pas.

const PUBLIC = 'kasbah.example.org'

async function build(config: Record<string, string> = {}) {
  const player = createMusicPlayer({
    config, logger: pino({ level: 'silent' }), publicHosts: [PUBLIC],
    source: () => undefined,
    getDevice: () => ({ descriptor: { kind: 'media_player', capabilities: ['play_url'] } }),
    execute: async () => {},
  })
  const app = Fastify()
  await app.register(async (sub) => player.registerRoutes(sub), { prefix: '/api/music' })
  return app
}

const play = (app: Awaited<ReturnType<typeof build>>, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/api/music/play', headers, payload: { source: 'ytmusic', id: 'x', deviceId: 'sonos:salon' } })

it('refuse de publier l’adresse publique aux enceintes, et demande MUSIC_PUBLISH_BASE', async () => {
  const app = await build()
  const asPublic: Record<string, string>[] = [{ host: PUBLIC }, { host: '192.168.1.90:8787', 'x-forwarded-host': PUBLIC }]
  for (const headers of asPublic) {
    const res = await play(app, headers)
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.body).toContain('MUSIC_PUBLISH_BASE required when the UI is opened through the public address')
  }
  expect((await play(app, { host: '192.168.1.90:8787' })).body).not.toContain('public address')
})

it('passe par MUSIC_PUBLISH_BASE quand elle est fixée, même sous le nom public', async () => {
  const app = await build({ MUSIC_PUBLISH_BASE: 'http://192.168.1.90:8787' })
  expect((await play(app, { host: PUBLIC })).body).not.toContain('public address')
})
