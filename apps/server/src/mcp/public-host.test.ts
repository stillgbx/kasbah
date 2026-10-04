import { resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'
import { createMockPlugin } from '../plugins/mock'

// Sous le nom public (`MCP_PUBLIC_URL`, celui du proxy inverse du NAS), seul le MCP répond : le
// proxy transmet tout, c'est l'application assemblée qui trie. Le réseau local ne change pas.

const PUBLIC = 'kasbah.example.org'
let kasbah: KasbahApp
beforeAll(async () => {
  kasbah = await buildApp({
    env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
    logger: pino({ level: 'silent' }),
    house: await loadHouse(resolve(import.meta.dirname, '../../../../house/demo-house.json')),
    factories: { mock: createMockPlugin },
    envSource: { MCP_PUBLIC_URL: `https://${PUBLIC}` },
    serveStatic: false,
  })
  await kasbah.app.ready()
})
afterAll(async () => { await kasbah.close() })

const get = (url: string, headers: Record<string, string>) => kasbah.app.inject({ method: 'GET', url, headers })

it('cache l\'interface, l\'API, le WebSocket et les comptes sous le nom public', async () => {
  for (const url of ['/', '/settings', '/api/devices', '/api/health', '/api/mcp/users', '/ws', '/api/devices?x=1', '/oauth', '/.well-known/other']) {
    expect((await get(url, { host: PUBLIC })).statusCode, url).toBe(404)
  }
})

it('laisse passer le MCP et son autorisation sous le nom public', async () => {
  expect((await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: PUBLIC, 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(401)
  const meta = await get('/.well-known/oauth-protected-resource/mcp', { host: PUBLIC })
  expect(meta.json()).toMatchObject({ resource: `https://${PUBLIC}/mcp` })
  expect((await get('/.well-known/oauth-authorization-server', { host: PUBLIC })).statusCode).toBe(200)
  expect((await get('/oauth/authorize?client_id=x', { host: PUBLIC })).statusCode).toBe(400)
})

it('reconnaît aussi le nom public transmis par le proxy en X-Forwarded-Host', async () => {
  expect((await get('/api/devices', { host: '192.168.1.90:8787', 'x-forwarded-host': `${PUBLIC}:443` })).statusCode).toBe(404)
})

it('ne change rien sur le réseau local', async () => {
  expect((await get('/api/devices', { host: 'kasbah:8787' })).statusCode).toBe(200)
  expect((await get('/api/mcp/users', { host: 'localhost:8787' })).statusCode).toBe(200)
})
