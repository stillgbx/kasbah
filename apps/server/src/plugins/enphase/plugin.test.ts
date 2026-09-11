import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { ENSEMBLE_INVENTORY, ENSEMBLE_POWER, INVERTERS, LIVEDATA, PRODUCTION } from './__fixtures__/gateway'
import { createEnphasePlugin, enphaseConfigSchema } from './index'
import { PANEL_STALE_MS } from './mapping'
import type { TokenStore } from './token'

// Appairage de la passerelle IQ. Le point surveillé ici : les identifiants du compte Enphase
// TRAVERSENT la route et disparaissent — ils ne sont ni conservés en cache, ni renvoyés à l'UI, ni
// exigés en configuration. Aucune passerelle ni aucun compte réel n'est touché.

const NOW = Date.UTC(2026, 8, 11)
const DAY = 86_400_000
const SERIAL = '123456789012'
const HOST = 'envoy.test'

const INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<envoy_info><time>1789123472</time><device><sn>${SERIAL}</sn><pn>800-00654-r09</pn>
<software>D8.3.5289</software><imeter>true</imeter></device><web-tokens>true</web-tokens></envoy_info>`

/** Ce que la vraie passerelle renvoie sur chaque route (capture anonymisee). */
const FIXTURES: Record<string, unknown> = {
  '/production.json?details=1': PRODUCTION,
  '/api/v1/production/inverters': INVERTERS,
  '/ivp/livedata/status': LIVEDATA,
  '/ivp/ensemble/inventory': ENSEMBLE_INVENTORY,
  '/ivp/ensemble/power': ENSEMBLE_POWER,
}

function jwt(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`
}
const token = (days: number, over: Record<string, unknown> = {}) => jwt({
  aud: SERIAL, enphaseUser: 'owner', username: 'toit@exemple.fr',
  exp: Math.floor((NOW + days * DAY) / 1000), ...over,
})

const response = (text: string, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => JSON.parse(text) as unknown,
  text: async () => text,
})

/** Fausse passerelle : `/info` sans jeton, le reste en Bearer ; 401 si le jeton ne correspond pas. */
function fakeGateway(opts: { infoDown?: boolean; accept?: string; failing?: string[] } = {}) {
  const calls: { path: string; auth: string | undefined }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = url.replace(`https://${HOST}`, '')
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    calls.push({ path, auth })
    if (path === '/info') {
      if (opts.infoDown) throw new Error('ECONNREFUSED')
      return response(INFO_XML)
    }
    if (opts.accept && auth !== `Bearer ${opts.accept}`) return response('<html>401</html>', 401)
    if (opts.failing?.includes(path)) return response('<html>not found</html>', 404)
    const fixture = FIXTURES[path]
    return response(JSON.stringify(fixture ?? { path }))
  })
  return { fetchImpl, calls }
}

/** Faux cloud Enphase : session puis échange, comme la note technique du fabricant les décrit. */
function fakeCloud(minted = token(365)) {
  const calls: { url: string; body: string }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, body: String(init?.body ?? '') })
    if (url.includes('/login/login.json')) return response('{"session_id":"sess-1"}')
    return response(minted)
  })
  return { fetchImpl, calls }
}

function memoryStore(): TokenStore & { value: string | null } {
  const store = {
    value: null as string | null,
    load: async () => store.value,
    save: async (t: string) => { store.value = t },
  }
  return store
}

async function started(over: {
  env?: Record<string, string>
  gateway?: ReturnType<typeof fakeGateway>
  cloud?: ReturnType<typeof fakeCloud>
  store?: ReturnType<typeof memoryStore>
} = {}) {
  const gateway = over.gateway ?? fakeGateway()
  const cloud = over.cloud ?? fakeCloud()
  const store = over.store ?? memoryStore()
  const plugin = createEnphasePlugin({ gatewayFetch: gateway.fetchImpl, cloudFetch: cloud.fetchImpl, store })
  const clock = new ManualClock(NOW)
  const ctx: PluginContext = {
    pluginId: 'enphase',
    config: enphaseConfigSchema.parse({ ENPHASE_HOST: HOST, ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/enphase' })
  await app.ready()
  return { plugin, app, gateway, cloud, store, ctx, clock }
}

/** Laisse les promesses en vol se resoudre (les sondes tournent sur l'horloge injectee). */
const settle = () => new Promise((r) => setTimeout(r, 0))

const post = (app: Awaited<ReturnType<typeof started>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/plugins/enphase/token', payload: payload as object })
const get = (app: Awaited<ReturnType<typeof started>>['app'], url: string) =>
  app.inject({ method: 'GET', url: `/api/plugins/enphase${url}` })

describe('passerelle non appairée', () => {
  it('démarre quand même, se déclare needs_pairing, et a déjà lu le numéro de série sur /info', async () => {
    const { plugin, app, gateway } = await started()
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
    // /info ne porte AUCUN jeton : c'est ce qui permet de reconnaître la passerelle avant l'appairage
    expect(gateway.calls).toEqual([{ path: '/info', auth: undefined }])
    expect(await get(app, '/token').then((r) => r.json())).toMatchObject({ paired: false, serial: SERIAL, software: 'D8.3.5289', stage: 'none' })
  })

  it('dit OÙ le jeton sera gardé : c\'est ce qui répond « ai-je quelque chose à recopier ? »', async () => {
    const withCache = await started()
    expect((await get(withCache.app, '/token').then((r) => r.json())).tokenFile).toMatch(/enphase-token\.json$/)
    // cache désactivé : l'UI doit alors prévenir que l'appairage ne survivra pas au redémarrage
    const without = await started({ env: { ENPHASE_TOKEN_FILE: '' } })
    expect((await get(without.app, '/token').then((r) => r.json())).tokenFile).toBeNull()
  })

  it('les clés annoncées dans les Réglages ne contiennent aucun identifiant de compte', async () => {
    const { plugin } = await started()
    expect(plugin.health!().keys).toEqual(['ENPHASE_HOST', 'ENPHASE_TOKEN', 'ENPHASE_TOKEN_FILE'])
    expect(Object.keys(enphaseConfigSchema.shape)).not.toContain('ENPHASE_PASSWORD')
  })

  it('refuse le relevé brut tant qu\'aucun jeton n\'est en place', async () => {
    const { app } = await started()
    expect((await get(app, '/raw')).statusCode).toBe(409)
  })
})

describe('appairage par jeton collé', () => {
  it('adopte un jeton valable, le met en cache, et passe à ok', async () => {
    const pasted = token(300)
    const { plugin, app, store, cloud } = await started({ gateway: fakeGateway({ accept: pasted }) })
    const r = await post(app, { token: `  ${pasted}\n` })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ paired: true, serial: SERIAL, stage: 'ok', daysLeft: 300, role: 'owner', source: 'minted' })
    expect(store.value).toBe(pasted)                       // le cache garde le jeton, pas les identifiants
    expect(cloud.calls).toHaveLength(0)                    // un jeton collé ne touche pas au cloud
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
  })

  it('la réponse ne renvoie JAMAIS le jeton lui-même, seulement son échéance', async () => {
    const pasted = token(300)
    const { app } = await started()
    const body = await post(app, { token: pasted }).then((r) => r.body)
    expect(body).not.toContain(pasted)
    expect(JSON.parse(body)).toHaveProperty('expiresAt', NOW + 300 * DAY)
  })

  it('refuse un jeton illisible, expiré, ou émis pour une AUTRE passerelle, en disant lequel', async () => {
    const { app } = await started()
    for (const [bad, expected] of [
      ['tronque', /not a readable/],
      [token(-1), /expired on/],
      [token(100, { aud: '999999999999' }), /issued for gateway 999999999999/],
    ] as const) {
      const r = await post(app, { token: bad })
      expect(r.statusCode).toBe(400)
      expect(r.json()).toMatchObject({ error: { code: 'NEEDS_PAIRING', message: expect.stringMatching(expected) as unknown as string } })
    }
  })

  it('un corps qui n\'est ni un jeton ni des identifiants → 400 qui dit quoi envoyer', async () => {
    const { app } = await started()
    const r = await post(app, { user: 'seul' })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: { message: expect.stringContaining('{ token }') as unknown as string } })
  })
})

describe('appairage par identifiants', () => {
  it('frappe un jeton au cloud pour CETTE passerelle, sans conserver le mot de passe', async () => {
    const minted = token(365)
    const { app, cloud, store } = await started({ gateway: fakeGateway({ accept: minted }), cloud: fakeCloud(minted) })
    const r = await post(app, { user: 'toit@exemple.fr', password: 'motdepasse' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ paired: true, stage: 'ok', daysLeft: 365 })

    // le numéro de série vient de /info : l'utilisateur n'a pas eu à le saisir
    expect(JSON.parse(cloud.calls[1]!.body)).toMatchObject({ serial_num: SERIAL })
    // le mot de passe n'a servi qu'à la session, et ne survit ni en cache ni dans la réponse
    expect(new URLSearchParams(cloud.calls[0]!.body).get('user[password]')).toBe('motdepasse')
    expect(store.value).toBe(minted)
    expect(r.body).not.toContain('motdepasse')
  })

  it('sans passerelle joignable, refuse de frapper : son numéro de série est indispensable', async () => {
    const { app, cloud } = await started({ gateway: fakeGateway({ infoDown: true }) })
    const r = await post(app, { user: 'u', password: 'p' })
    expect(r.statusCode).toBe(502)
    expect(cloud.calls).toHaveLength(0)
  })

  it('refuse de frapper quand le jeton en place est encore bon : un jeton de plus serait inutilisé', async () => {
    const { app, cloud } = await started({ env: { ENPHASE_TOKEN: token(200) } })
    const r = await post(app, { user: 'u', password: 'p' })
    expect(r.statusCode).toBe(409)
    expect(r.json()).toMatchObject({ error: { code: 'TOKEN_STILL_VALID', message: expect.stringContaining('200 day(s)') as unknown as string } })
    expect(cloud.calls).toHaveLength(0)
  })

  it('`force` passe outre ce garde-fou, pour qui veut vraiment remplacer son jeton', async () => {
    const minted = token(365)
    const { app, cloud, store } = await started({ env: { ENPHASE_TOKEN: token(200) }, cloud: fakeCloud(minted) })
    const r = await post(app, { user: 'u', password: 'p', force: true })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ daysLeft: 365 })
    expect(cloud.calls).toHaveLength(2)
    expect(store.value).toBe(minted)
  })

  it('un jeton qui expire bientôt ne déclenche PAS le garde-fou : le renouveler est justement le but', async () => {
    const { app, cloud } = await started({ env: { ENPHASE_TOKEN: token(5) } })
    expect((await post(app, { user: 'u', password: 'p' })).statusCode).toBe(200)
    expect(cloud.calls).toHaveLength(2)
  })

  it('identifiants refusés par le cloud → 400, et rien n\'est mis en cache', async () => {
    const cloud = { calls: [] as { url: string; body: string }[], fetchImpl: vi.fn<FetchLike>(async () => response('{"message":"bad"}', 401)) }
    const { app, store } = await started({ cloud: cloud as unknown as ReturnType<typeof fakeCloud> })
    const r = await post(app, { user: 'u', password: 'faux' })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: { code: 'NEEDS_PAIRING' } })
    expect(store.value).toBeNull()
  })
})

describe('jeton déjà connu au démarrage', () => {
  it('prend celui de la configuration, et le dit dans son état', async () => {
    const configured = token(200)
    const { app } = await started({ env: { ENPHASE_TOKEN: configured }, gateway: fakeGateway({ accept: configured }) })
    expect(await get(app, '/token').then((r) => r.json())).toMatchObject({ paired: true, source: 'config', daysLeft: 200 })
  })

  it('reprend celui du cache au démarrage suivant : plus rien à taper pendant un an', async () => {
    const cached = token(180)
    const store = memoryStore()
    store.value = cached
    const { plugin } = await started({ store, gateway: fakeGateway({ accept: cached }) })
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
  })

  it('passe en degraded sous 30 jours : la pastille des Réglages alerte AVANT la panne', async () => {
    const { plugin, app } = await started({ env: { ENPHASE_TOKEN: token(12) } })
    expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: expect.stringContaining('12 day(s)') as unknown as string })
    expect(await get(app, '/token').then((r) => r.json())).toMatchObject({ stage: 'expiring', daysLeft: 12, renewUnderDays: 30 })
  })

  it('un jeton expiré en configuration laisse le plugin en needs_pairing, pas en erreur', async () => {
    const { plugin } = await started({ env: { ENPHASE_TOKEN: token(-3) } })
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
  })
})

describe('relevé brut (pour écrire les fixtures du mappage)', () => {
  it('interroge toutes les routes locales avec le jeton, et porte l\'échec d\'une seule sans tomber', async () => {
    const pasted = token(300)
    const gateway = fakeGateway({ accept: pasted, failing: ['/ivp/ensemble/power'] })
    const { app } = await started({ gateway })
    await post(app, { token: pasted })
    const raw = await get(app, '/raw').then((r) => r.json() as Record<string, unknown>)
    expect(raw.info).toMatchObject({ serial: SERIAL })
    expect(raw['/api/v1/production/inverters']).toHaveLength(20)
    expect(raw['/ivp/ensemble/power']).toMatchObject({ error: expect.stringContaining('404') as unknown as string })
    // toutes les routes authentifiées portent le Bearer
    const authed = gateway.calls.filter((c) => c.path !== '/info')
    expect(authed.every((c) => c.auth === `Bearer ${pasted}`)).toBe(true)
  })
})

describe('appareils', () => {
  /** Plugin appairé sur la fausse passerelle, qui sert les réponses capturées sur la vraie. */
  const paired = async () => {
    const t = token(300)
    return started({ env: { ENPHASE_TOKEN: t }, gateway: fakeGateway({ accept: t }) })
  }

  it('publie le site, un capteur par onduleur et un appareil par batterie', async () => {
    const { plugin } = await paired()
    const devices = await plugin.discover()
    expect(devices).toHaveLength(23)
    expect(devices[0]).toMatchObject({ id: 'enphase:site', kind: 'energy' })
    expect(devices.filter((d) => d.kind === 'sensor')).toHaveLength(20)
  })

  it('ne publie rien tant que la passerelle n\'est pas appairée', async () => {
    const { plugin } = await started()
    expect(await plugin.discover()).toEqual([])
  })

  it('sonde les compteurs et pousse l\'état du site', async () => {
    const { plugin, ctx } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    const site = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.find(([id]) => id === 'site')
    expect(site?.[1]).toMatchObject({ kind: 'energy', productionW: 6472, consumptionW: 725, gridW: -5763, batteryW: -16 })
    await plugin.stop()
  })

  it('pousse la puissance de chaque onduleur, et les batteries', async () => {
    const { plugin, ctx } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    const calls = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls
    const panels = calls.filter(([, patch]) => (patch as { kind: string }).kind === 'sensor')
    expect(panels).toHaveLength(20)
    expect(panels[0]![1]).toMatchObject({ kind: 'sensor', value: INVERTERS[0]!.lastReportWatts })
    // deux batteries, l'une au repos et l'autre en décharge de 16 W (signe du contrat : négatif)
    const batteries = calls.filter(([id]) => ENSEMBLE_INVENTORY[0]!.devices.some((d) => d.serial_num === id))
    expect(batteries).toHaveLength(2)
    expect(batteries.map(([, p]) => (p as { batteryW: number }).batteryW).sort()).toEqual([-16, 0])
    await plugin.stop()
  })

  it('un onduleur muet depuis trop longtemps est declare indisponible, pas remis a zero', async () => {
    const { plugin, ctx, clock } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    ;(ctx.setAvailable as ReturnType<typeof vi.fn>).mockClear()
    ;(ctx.emitState as ReturnType<typeof vi.fn>).mockClear()
    // la capture date d'un après-midi ensoleillé : on avance au-delà du dernier rapport + la
    // demi-heure de grâce, ce qui simule la nuit tombée
    const last = Math.max(...INVERTERS.map((i) => i.lastReportDate)) * 1000
    clock.advance(last + PANEL_STALE_MS + 60_000 - clock.now())
    await settle()
    const off = (ctx.setAvailable as ReturnType<typeof vi.fn>).mock.calls.filter(([, ok]) => ok === false)
    expect(off).toHaveLength(20)
    // aucune valeur n'a ete republiee pour un panneau : on ne remplace pas une mesure par un zero
    const panels = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter(([, patch]) => (patch as { kind: string }).kind === 'sensor')
    expect(panels).toHaveLength(0)
    await plugin.stop()
  })

  it('refuse toute commande : la passerelle est en lecture seule ici', async () => {
    const { plugin } = await started()
    await expect(plugin.execute('x', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
  })
})
