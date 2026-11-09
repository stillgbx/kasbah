import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { readAppBuild, registerStatic } from './static'

let dir: string
let app: FastifyInstance | null = null

async function webBuild(files: Record<string, string>) {
  dir = await mkdtemp(join(tmpdir(), 'kasbah-static-'))
  await mkdir(join(dir, 'assets'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body)
}

afterEach(async () => {
  await app?.close(); app = null
  await rm(dir, { recursive: true, force: true })
})

describe('registerStatic', () => {
  it('falls back to index.html for a page address, but a file missing from /assets is a real 404', async () => {
    await webBuild({ 'index.html': '<!doctype html><title>k</title>', 'assets/HomeView-new.js': 'export {}' })
    app = Fastify()
    expect(await registerStatic(app, dir)).toBe(true)

    const page = await app.inject({ method: 'GET', url: '/shopping' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toMatch(/text\/html/)

    const chunk = await app.inject({ method: 'GET', url: '/assets/HomeView-new.js' })
    expect(chunk.statusCode).toBe(200)
    expect(chunk.headers['content-type']).toMatch(/javascript/)

    // the view of a replaced build, requested by a screen left open
    const gone = await app.inject({ method: 'GET', url: '/assets/ShoppingView-old.js' })
    expect(gone.statusCode).toBe(404)
    expect(gone.headers['content-type']).toMatch(/json/)
  })

  it('lets no other site frame a page of the app', async () => {
    await webBuild({ 'index.html': '<!doctype html><title>k</title>', 'diag.html': '<!doctype html>', 'assets/a.js': 'export {}' })
    app = Fastify()
    await registerStatic(app, dir)
    for (const url of ['/', '/index.html', '/vehicles', '/diag.html']) {
      const page = await app.inject({ method: 'GET', url })
      expect(page.statusCode, url).toBe(200)
      expect(page.headers['x-frame-options'], url).toBe('SAMEORIGIN')
      expect(page.headers['content-security-policy'], url).toBe("frame-ancestors 'self'")
    }
  })

  it('serves the install manifest in the browser language, English when neither fr nor en', async () => {
    await webBuild({ 'index.html': '', 'manifest.webmanifest': '{"lang":"fr"}', 'manifest.en.webmanifest': '{"lang":"en"}' })
    app = Fastify()
    await registerStatic(app, dir)
    const cases: [string | undefined, string][] = [
      ['fr-FR,fr;q=0.9,en;q=0.8', 'fr'], ['en-GB,fr;q=0.5', 'en'], ['de-DE,fr;q=0.7', 'fr'], ['de-DE', 'en'], [undefined, 'en'],
    ]
    for (const [accept, lang] of cases) {
      const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest', headers: accept ? { 'accept-language': accept } : {} })
      expect(res.statusCode, accept).toBe(200)
      expect(res.json().lang, accept).toBe(lang)
      expect(res.headers['content-type'], accept).toMatch(/manifest\+json/)
      expect(res.headers.vary, accept).toMatch(/Accept-Language/)
    }
  })

  it('serves /ask as the "Ask Kasbah" app of its own, so iOS can add it to the home screen', async () => {
    const head = '<head>\n    <link rel="manifest" href="/manifest.webmanifest" />\n    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />\n  </head>'
    await webBuild({
      'index.html': `<!doctype html>${head}`,
      'manifest.ask.webmanifest': '{"lang":"fr","short_name":"Demander"}', 'manifest.ask.en.webmanifest': '{"lang":"en","short_name":"Ask"}',
    })
    app = Fastify()
    await registerStatic(app, dir)

    const page = await app.inject({ method: 'GET', url: '/ask', headers: { 'accept-language': 'fr-FR' } })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toMatch(/text\/html/)
    expect(page.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(page.body).toContain('<link rel="manifest" href="/manifest.ask.webmanifest" />')
    expect(page.body).toContain('<link rel="apple-touch-icon" href="/icons/shortcut-ask-maskable-192.png" />')
    expect(page.body).toContain('<meta name="apple-mobile-web-app-title" content="Demander" />')
    expect((await app.inject({ method: 'GET', url: '/ask', headers: { 'accept-language': 'en' } })).body).toContain('content="Ask"')

    const manifest = await app.inject({ method: 'GET', url: '/manifest.ask.webmanifest', headers: { 'accept-language': 'en-GB' } })
    expect(manifest.json().lang).toBe('en')
    expect(manifest.headers.vary).toMatch(/Accept-Language/)

    // the other pages keep the app's own manifest
    expect((await app.inject({ method: 'GET', url: '/lights' })).body).toContain('href="/manifest.webmanifest"')
  })
})

describe('readAppBuild', () => {
  it('reads the build identifier, re-read on each call, and returns undefined without a file', async () => {
    await webBuild({ 'index.html': '' })
    expect(readAppBuild(dir)).toBeUndefined()
    await writeFile(join(dir, 'build-id.txt'), 'abc123\n')
    expect(readAppBuild(dir)).toBe('abc123')
    await writeFile(join(dir, 'build-id.txt'), 'def456')
    expect(readAppBuild(dir)).toBe('def456')
  })
})
