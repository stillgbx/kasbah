import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import { csrfFromHtml, type FetchLike } from './client'
import { createToutemonanneePlugin } from './index'
import { detailedToLocal, htmlToText, levelsIn } from './mapping'
import { memoryTmaStore } from './store'

// Responses surveyed on the site on 2026-10-04, names replaced.
const J = 'journal-ce1-ce2'
const SPACES = {
  spaces: [
    { id: 1, uuid: 'asso', display_name: 'APE', display_years: '2026-2027', type: 2, in_scope: true, deleted_at: null, for_students: [] },
    { id: 2, uuid: J, display_name: 'CE1-CE2', display_years: '2026-2027', type: 1, in_scope: true, deleted_at: null, for_students: [{ id: 9, display_name: 'ÉLÈVE Lou' }] },
  ],
  spaces_soon_archived: [{ uuid: 'old', display_name: 'Classe de CE1', type: 1, in_scope: false }],
}
const event = (over: Record<string, unknown>) => ({
  id: 1, title: 'devoirs', author: { name: 'Mme Martin', avatar_url: 'x' }, content: { raw: 'texte', html: 'texte' },
  subject: null, files: [], files_count: 0, recipients: [{ label: 'CE1-CE2', value: 2, group: 'classes' }],
  date: '2026-10-05', acks_count: 0, acks_validated_count: 0, ack_needed: false, can_ack: false, has_acknowledged: false, ...over,
})
const UPCOMING = [
  event({ id: 101, title: 'devoirs ce1', content: { raw: "pour les ce1: faire l'exercice de maths ( cahier panda)" } }),
  event({ id: 102, title: 'devoirs', content: { raw: 'CE2 : \r\nexercice + leçon sur les polygones\r\nmots de dictée' } }),
  event({ id: 103, title: null, subject: { id: 3, title: 'Français' }, date: '2026-10-08', content: { raw: 'pour les CE2: relire le texte' }, acks_count: 33, acks_validated_count: 2, ack_needed: true, can_ack: true }),
]
const PAST = event({ id: 90, title: 'évaluations nationales', date: '2026-10-02', content: { raw: 'Signer la pochette bleue.' } })
const TRANSMISSIONS = {
  total: 1, current_page: 1, last_page: 1, page_size: 10,
  data: [{
    id: 501, title: 'journée du sport', created_date_detailed: { day: '08', month: 'Sept.', year: 2026, hours: '17', minutes: '09' },
    author: { id: 7, name: 'Mme Durand' }, content: { raw: 'Marche dans le village.', html: 'Marche dans le village.' },
    response_type: 1, responses_count: 0, has_answered: false, can_answer: true, has_acknowledged: true, can_acknowledge: false, files_count: 0, recipients: [], absence: null,
  }],
}
const POSTS = {
  current_page: 1, previous_page: null, next_page: null, page_size: 10,
  data: [
    { model: 'reminder', type: 1, id: 1, title: 'Demain', content: 'Joyeux anniversaire', date: 'le 05/10/2026' },
    {
      model: 'post', id: 700, title: 'Photos de classe', activity_date_detailed: { day: '01', month: 'Oct.', year: 2026, hours: '10', minutes: '48' },
      author: { name: 'Mme Martin' }, content: '<p>Bonjour,<br>les photos sont&nbsp;prêtes.</p><p>Merci</p>',
      files: [{ id: 1, src: 'https://s3.example/a.jpg', src_mini: 'https://s3.example/a-mini.jpg', type: 'image', extension: 'jpg', legend: null }],
      comments_count: 2,
    },
  ],
}

interface Call { method: string; path: string; headers: Record<string, string>; body?: unknown }

/** A fake site: the app's routes, cookies set at sign-in, session required elsewhere. */
function fakeSite(opts: { password?: string } = {}) {
  const calls: Call[] = []
  let acked = false
  let sessionValid = true
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url)
    const path = u.pathname + u.search
    const headers = init.headers as Record<string, string>
    calls.push({ method: init.method ?? 'GET', path, headers, body: init.body })
    const authed = sessionValid && /remember_web_abc=/.test(headers.cookie ?? '')
    if (u.pathname === '/connect' && init.method === 'GET') {
      return new Response('<html><head><meta name="csrf-token" content="CSRFtoken0123456789abcdefghij"></head></html>', {
        status: 200, headers: [['content-type', 'text/html'], ['set-cookie', 'XSRF-TOKEN=xsrf%3D1; Path=/'], ['set-cookie', 'diedm_session=s1; Path=/; HttpOnly']],
      })
    }
    if (u.pathname === '/connect/check-email-username') return json({ is_username_or_email_used: true, user: { display_name: 'Parent' } })
    if (u.pathname === '/connect/signin') {
      const form = init.body as FormData
      if (form.get('password') !== (opts.password ?? 'bon')) return new Response('{"message":"invalid"}', { status: 422, headers: { 'content-type': 'application/json' } })
      return json({ redirect: '/dashboard' }, { 'set-cookie': 'remember_web_abc=r1; Path=/; Max-Age=34560000' })
    }
    if (!authed) return new Response(null, { status: 302, headers: { location: 'https://www.toutemonannee.com/connect' } })
    if (u.pathname === '/spaces/list') return json(SPACES)
    if (u.pathname === `/journal/${J}/events/list`) {
      const date = u.searchParams.get('date')
      const withAck = (e: ReturnType<typeof event>) => (e.id === 103 ? { ...e, has_acknowledged: acked, acks_validated_count: acked ? 3 : 2 } : e)
      const data = date ? [...UPCOMING, PAST].filter((e) => e.date === date).map(withAck) : UPCOMING.map(withAck)
      return json({ events: { total: data.length, current_page: 1, last_page: 1, page_size: 10, data } })
    }
    if (u.pathname === `/journal/${J}/events/acknowledge/103` && init.method === 'PUT') {
      acked = !acked
      return json({ reason: acked ? 'Validé !' : "C'est compris !", event: { ...UPCOMING[2], has_acknowledged: acked } })
    }
    if (u.pathname === `/journal/${J}/transmissions/list`) return json(TRANSMISSIONS)
    if (u.pathname === `/journal/${J}/posts/list`) return json(POSTS)
    return new Response('not found', { status: 404 })
  }
  return { fetch, calls, expire: () => { sessionValid = false }, get acked() { return acked } }
}

function fakeCtx(config: Record<string, unknown>): PluginContext {
  return {
    pluginId: 'toutemonannee',
    config,
    logger: pino({ level: 'silent' }),
    // Sunday October 4, 2026, noon (local time)
    clock: new ManualClock(new Date(2026, 9, 4, 12).getTime()),
    signal: new AbortController().signal,
    emitState: vi.fn(),
    setAvailable: vi.fn(),
    emitDevices: vi.fn(),
    emitScenes: vi.fn(),
    emitSceneState: vi.fn(),
    emitEvent: vi.fn(),
    parts: {},
    site: { lat: 0, lon: 0, alt: 0 },
  }
}

async function boot(site = fakeSite(), store = memoryTmaStore()) {
  const plugin = createToutemonanneePlugin({ store, fetch: site.fetch })
  await plugin.init(fakeCtx(plugin.configSchema.parse({ TMA_PAST_DAYS: 3 })))
  const app = Fastify()
  await app.register(async (sub) => plugin.registerRoutes!.call(plugin, sub), { prefix: '/api/plugins/toutemonannee' })
  await app.ready()
  const login = (password = 'bon') => app.inject({ method: 'POST', url: '/api/plugins/toutemonannee/login', payload: { username: 'parent@example.org', password } })
  return { plugin, app, store, site, login }
}

describe('toutemonannee mapping', () => {
  it('reads the French abbreviated dates of the site', () => {
    expect(detailedToLocal({ day: '08', month: 'Sept.', year: 2026, hours: '17', minutes: '09' })).toBe('2026-09-08T17:09')
    expect(detailedToLocal({ day: '1', month: 'Févr.', year: 2027 })).toBe('2027-02-01T00:00')
    expect(detailedToLocal({ day: '15', month: 'Août', year: 2027, hours: 9, minutes: 5 })).toBe('2027-08-15T09:05')
    expect(() => detailedToLocal({ day: '1', month: 'Brumaire', year: 2027 })).toThrow()
  })

  it('turns light HTML into text, never into markup', () => {
    expect(htmlToText('<p>Bonjour,<br>les photos sont&nbsp;prêtes&#33;</p><p>Merci <b>&amp;</b> bonne journée</p>'))
      .toBe('Bonjour,\nles photos sont prêtes!\nMerci & bonne journée')
    expect(htmlToText('<script>alert(1)</script>x')).toBe('alert(1)x')
  })

  it('finds the levels a homework speaks to, whatever the case', () => {
    expect(levelsIn('devoirs ce1', "pour les ce1: faire l'exercice")).toEqual(['CE1'])
    expect(levelsIn(null, 'CE2 :\nleçon O4 ; les CE1 aussi')).toEqual(['CE1', 'CE2'])
    expect(levelsIn('évaluations nationales', 'Signer la pochette')).toEqual([])
    expect(levelsIn('CE10 n’est pas un niveau')).toEqual([])
  })

  it('finds the CSRF token of a Laravel page', () => {
    expect(csrfFromHtml('<meta name="csrf-token" content="abcdefghijklmnopqrstuvwxyz0123">')).toBe('abcdefghijklmnopqrstuvwxyz0123')
    expect(csrfFromHtml('<meta content="abcdefghijklmnopqrstuvwxyz0123" name="csrf-token">')).toBe('abcdefghijklmnopqrstuvwxyz0123')
    expect(csrfFromHtml('<html></html>')).toBeNull()
  })
})

describe('toutemonannee plugin', () => {
  it('asks for an account, links it without keeping the password, and keeps the session cookies', async () => {
    const { plugin, store, login, site } = await boot()
    expect(plugin.health!().status).toBe('needs_pairing')
    const res = await login()
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('bon"')
    const saved = await store.load()
    expect(saved.account).toEqual({ username: 'parent@example.org' })
    expect(saved.cookies).toMatchObject({ remember_web_abc: 'r1', diedm_session: 's1' })
    expect(JSON.stringify(saved)).not.toContain('"bon"')
    // the sign-in follows the page: the page's CSRF token, then the Laravel header taken from the cookie
    const signin = site.calls.find((c) => c.path === '/connect/signin')!
    expect(signin.headers).toMatchObject({ 'x-csrf-token': 'CSRFtoken0123456789abcdefghij', 'x-xsrf-token': 'xsrf=1', 'x-requested-with': 'XMLHttpRequest' })
    expect((signin.body as FormData).get('remember')).toBe('1')
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '1 class' })
  })

  it('refuses wrong credentials with a 401 and stays unlinked', async () => {
    const { plugin, store, login } = await boot()
    const res = await login('faux')
    expect(res.statusCode).toBe(401)
    expect((await store.load()).account).toBeNull()
    expect(plugin.health!().status).toBe('needs_pairing')
  })

  it('serves homework (upcoming and past days), messages and posts of the class journals only', async () => {
    const { login } = await boot()
    const school = (await login()).json()
    expect(school.journals).toEqual([{ id: J, name: 'CE1-CE2', years: '2026-2027', students: ['ÉLÈVE Lou'] }])
    expect(school.homework.map((h: { id: number }) => h.id)).toEqual([90, 101, 102, 103])
    const [past, ce1, ce2, fr] = school.homework
    expect(past).toMatchObject({ date: '2026-10-02', levels: [], siteAck: null, done: false })
    expect(ce1).toMatchObject({ levels: ['CE1'], author: 'Mme Martin', title: 'devoirs ce1' })
    expect(ce2.text).toBe('CE2 :\nexercice + leçon sur les polygones\nmots de dictée')
    expect(fr).toMatchObject({ title: null, subject: 'Français', levels: ['CE2'], siteAck: { validated: 2, total: 33 } })
    expect(school.messages).toEqual([expect.objectContaining({ id: 501, at: '2026-09-08T17:09', read: true, text: 'Marche dans le village.' })])
    expect(school.posts).toHaveLength(1)
    expect(school.posts[0]).toMatchObject({ id: 700, at: '2026-10-01T10:48', text: 'Bonjour,\nles photos sont prêtes.\nMerci', comments: 2 })
    expect(school.posts[0].files[0]).toMatchObject({ type: 'image', url: 'https://s3.example/a.jpg', thumb: 'https://s3.example/a-mini.jpg' })
  })

  it("ticks the site's own box only when its state differs — the request toggles", async () => {
    const { app, login, site } = await boot()
    await login()
    const put = (done: boolean) => app.inject({ method: 'PUT', url: `/api/plugins/toutemonannee/homework/${J}/103/done`, payload: { done } })
    const on = await put(true)
    expect(on.statusCode).toBe(200)
    expect(on.json().homework.find((h: { id: number }) => h.id === 103).done).toBe(true)
    expect(site.acked).toBe(true)
    // already ticked: nothing is sent to the site again, otherwise it would untick
    await put(true)
    expect(site.acked).toBe(true)
    expect(site.calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    await put(false)
    expect(site.acked).toBe(false)
  })

  it('keeps the other ticks in Kasbah', async () => {
    const { app, login, store, site } = await boot()
    await login()
    const res = await app.inject({ method: 'PUT', url: `/api/plugins/toutemonannee/homework/${J}/101/done`, payload: { done: true } })
    expect(res.json().homework.find((h: { id: number }) => h.id === 101).done).toBe(true)
    expect((await store.load()).done).toEqual([101])
    expect(site.calls.some((c) => c.method === 'PUT')).toBe(false)
    expect((await app.inject({ method: 'PUT', url: `/api/plugins/toutemonannee/homework/${J}/999/done`, payload: { done: true } })).statusCode).toBe(404)
  })

  it('keeps the last read when the session is lost, and asks to link again', async () => {
    const { app, plugin, login, site } = await boot()
    await login()
    site.expire()
    const res = await app.inject({ method: 'POST', url: '/api/plugins/toutemonannee/refresh' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ sessionLost: true, linked: true })
    expect(res.json().homework).toHaveLength(4)
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
  })

  it('saves the filters and the last post seen', async () => {
    const { app, login, store } = await boot()
    await login()
    const f = await app.inject({ method: 'PUT', url: '/api/plugins/toutemonannee/filters', payload: { hiddenJournals: [], hiddenLevels: ['CE1'] } })
    expect(f.json().filters).toEqual({ hiddenJournals: [], hiddenLevels: ['CE1'] })
    await app.inject({ method: 'PUT', url: '/api/plugins/toutemonannee/posts/seen', payload: { id: 700 } })
    await app.inject({ method: 'PUT', url: '/api/plugins/toutemonannee/posts/seen', payload: { id: 1 } })
    expect((await store.load())).toMatchObject({ postsSeen: 700, filters: { hiddenLevels: ['CE1'] } })
    expect((await app.inject({ method: 'PUT', url: '/api/plugins/toutemonannee/filters', payload: { hiddenLevels: 'CE1' } })).statusCode).toBe(400)
  })

  it('unlinks: cookies gone, filters kept', async () => {
    const { app, login, store } = await boot()
    await login()
    await app.inject({ method: 'PUT', url: '/api/plugins/toutemonannee/filters', payload: { hiddenJournals: ['x'], hiddenLevels: [] } })
    const res = await app.inject({ method: 'POST', url: '/api/plugins/toutemonannee/logout' })
    expect(res.json()).toMatchObject({ linked: false, homework: [] })
    const saved = await store.load()
    expect(saved).toMatchObject({ account: null, cookies: {}, filters: { hiddenJournals: ['x'] } })
  })
})
