import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import type { SessionStore, StoredSession } from './auth'
import { PetkitAuth } from './auth'
import { FAMILIES, ROSTER, FEEDER_DETAIL, FOUNTAIN_DETAIL, WORK_RECORD } from './__fixtures__/petkit'
import { createPetkitPlugin, petkitConfigSchema } from './index'
import { toDescriptor, toDevices, toDrinkPatch, toFeederPatch, toFountainPatch } from './mapping'

// Ce que le plugin doit tenir face à PetKit, et que seule une API privée impose :
//
//  - CONNEXION PAR CODE : aucun mot de passe n'existe. Une session perdue ne se reprend pas toute
//    seule, donc elle doit être prolongée AVANT son échéance, et une seule fois même quand deux
//    lectures la réclament en même temps (deux connexions concurrentes condamnent la session pour
//    la durée de son bail — le bug connu des bibliothèques tierces).
//  - L'API RÉPOND EN HTTP 200 MÊME QUAND ELLE REFUSE : l'échec est dans le corps.
//  - UNE FONTAINE N'A PAS DE WI-FI : elle s'atteint par relais Bluetooth, et la liaison doit être
//    refermée même quand ce qu'on voulait faire a échoué — sinon le relais (la mangeoire) reste
//    immobilisé pour les appels suivants.
//  - UNE RATION HORS LISTE se refuse ici plutôt que de laisser le fabricant l'arrondir en silence.
//
// Les fixtures sont CONSTRUITES, pas capturées — le compte n'est pas encore lié. Elles sont dites
// telles dans `__fixtures__/petkit.ts`, et la route `GET /raw` existe pour les remplacer par du
// relevé dès la première liaison. Aucun compte ni appareil réel n'est touché.

const NOW = Date.UTC(2026, 8, 21, 10)
const GATEWAY = 'https://api.eu-pet.com/latest'
const EMAIL = 'animaux@exemple.fr'
const CODE = '483920'
const SESSION = 'session-abc'
const GROUP = '300000001'
const FEEDER = 'd4-400000004'
const FOUNTAIN = 'ctw3-400000002'

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

/** Le poller lance sa première lecture sans l'attendre : il faut laisser tourner la boucle. */
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)) }

interface FakeOptions {
  /** L'API refuse la session (code 5, en HTTP 200). */
  deadSession?: boolean
  /** `ble/ownSupportBleDevices` ne rend aucun relais : la fontaine est hors de portée. */
  noRelay?: boolean
  /** La lecture de la fontaine échoue UNE FOIS la liaison ouverte. */
  fountainReadFails?: boolean
  /** Durée de vie annoncée pour la session, en secondes. */
  expiresIn?: number
}

function fakePetkit(o: FakeOptions = {}) {
  const calls: { path: string; method: string; form: Record<string, string>; query: Record<string, string> }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const [bare, qs] = url.split('?')
    const path = bare!.replace(`${GATEWAY}/`, '').replace('https://passport.petkt.com/v1/', 'passport/')
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
    const query = Object.fromEntries(new URLSearchParams(qs ?? ''))
    calls.push({ path, method: init?.method ?? 'GET', form, query })
    // Le VERBE compte : PetKit sert `regionservers` et `sendcodeforquicklogin` en GET, et refuse
    // un POST. Le faux fabricant refuse donc pareil, sinon le test ne prouverait rien.
    if (path === 'passport/regionservers' || path === 'user/sendcodeforquicklogin') {
      if ((init?.method ?? 'GET') !== 'GET') return response({ error: { code: 400, msg: 'method not allowed' } })
    }
    if (path === 'passport/regionservers') return response({ list: [{ id: 'fr', name: 'France', gateway: `${GATEWAY}/` }] })
    if (path === 'user/sendcodeforquicklogin') {
      return query.username ? response({ result: { sent: true } }) : response({ error: { code: 400, msg: 'username required' } })
    }
    if (path === 'user/login') {
      if (form.validCode !== CODE) return response({ error: { code: 122, msg: 'invalid code' } })
      return response({ result: { session: { id: SESSION, expiresIn: o.expiresIn ?? 36 * 3600 } } })
    }
    if (path === 'user/refreshsession') return response({ result: { session: { id: `${SESSION}-r`, expiresIn: o.expiresIn ?? 36 * 3600 } } })
    if (o.deadSession) return response({ error: { code: 5, msg: 'session expired' } })
    if (path === 'group/family/list') return response({ result: FAMILIES })
    if (path === 'discovery/device_roster_v2') {
      // `day` ET `groupId` sont exigés : sans eux PetKit refuse en « Request is incorrect. »
      // (vérifié le 21/09). Le faux fabricant refuse pareil, sinon le test ne prouverait rien.
      if (!form.day || !form.groupId) return response({ error: { code: 3, msg: 'Request is incorrect.' } })
      return response({ result: ROSTER })
    }
    if (path === 'ble/ownSupportBleDevices') return response({ result: o.noRelay ? [] : [{ deviceId: 400000004, deviceType: 'd4' }] })
    if (path === 'ble/connect') return response({ result: { state: 1 } })
    if (path === 'ble/poll') return response({ result: 1 })
    if (path === 'ble/cancel') return response({ result: 1 })
    if (path === 'ble/controlDevice') return response({ result: 1 })
    if (path === 'd4/device_detail') return response({ result: FEEDER_DETAIL })
    // Une fontaine répond sur `deviceData`, pas sur `device_detail` (404 vérifié le 21/09).
    if (path === 'ctw3/device_detail') return response({ error: { code: 404, msg: 'not found' } }, 404)
    if (path === 'ctw3/deviceData') {
      if (o.fountainReadFails) return response({ error: { code: 99, msg: 'device busy' } })
      return response({ result: FOUNTAIN_DETAIL })
    }
    if (path === 'ctw3/getWorkRecord') {
      // trois paramètres exigés, dont le PROPRIÉTAIRE : sans lui, « L'appareil n'a pas été trouvé »
      if (!form.day || !form.deviceId || !form.userId) return response({ error: { code: 703, msg: 'device not found' } })
      return response({ result: WORK_RECORD })
    }
    if (path === 'd4/saveDailyFeed' || path === 'd4/callPet') return response({ result: { ok: 1 } })
    return response({ error: { code: 404, msg: `unexpected ${path}` } }, 404)
  })
  return { fetchImpl, calls }
}

async function setup(o: FakeOptions & { session?: StoredSession | null } = {}) {
  const petkit = fakePetkit(o)
  let saved: StoredSession | null = o.session ?? null
  const sessionStore: SessionStore = {
    load: async () => saved,
    save: async (s) => { saved = s },
    clear: async () => { saved = null },
  }
  const clock = new ManualClock(NOW)
  const plugin = createPetkitPlugin({ fetchImpl: petkit.fetchImpl, sessionStore })
  const ctx: PluginContext = {
    pluginId: 'petkit',
    config: petkitConfigSchema.parse({ PETKIT_GATEWAY: `${GATEWAY}/` }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/petkit' })
  await app.ready()
  // `opts` est MUTABLE : certains cas doivent faire échouer une lecture APRÈS la liaison,
  // pas avant — sinon l'adresse Bluetooth n'est jamais apprise et le scénario visé n'a pas lieu.
  return { plugin, app, petkit, ctx, clock, opts: o, store: () => saved }
}

const link = (app: Awaited<ReturnType<typeof setup>>['app'], code = CODE) =>
  app.inject({ method: 'POST', url: '/api/plugins/petkit/login', payload: { email: EMAIL, code } })

const linked = (expiresAt = NOW + 36 * 3600_000): StoredSession =>
  ({ id: SESSION, gateway: `${GATEWAY}/`, createdAt: NOW, expiresAt, account: EMAIL })

describe('PetKit — appairage par code', () => {
  it('demande un code, puis l’échange contre une session ; ni code ni mot de passe ne survivent', async () => {
    const { app, petkit, store } = await setup()
    const asked = await app.inject({ method: 'POST', url: '/api/plugins/petkit/login/code', payload: { email: EMAIL } })
    expect(asked.statusCode).toBe(200)
    // GET, adresse en PARAMÈTRE D'URL : envoyée en POST de formulaire, PetKit refuse — c'est le
    // 502 rencontré au premier appairage réel, le 21/09.
    const ask = petkit.calls.find((c) => c.path === 'user/sendcodeforquicklogin')!
    expect(ask.method).toBe('GET')
    expect(ask.query.username).toBe(EMAIL)

    const r = await link(app)
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ linked: true, account: EMAIL })
    // le jeton survit, le code non — et il n'y a jamais eu de mot de passe à perdre
    expect(store()).toMatchObject({ id: SESSION })
    expect(JSON.stringify(store())).not.toContain(CODE)
    expect(petkit.calls.find((c) => c.path === 'user/login')?.form.password).toBeUndefined()
  })

  it('résout la passerelle en GET et envoie l’IDENTIFIANT du serveur comme région', async () => {
    // « FR » sert à TROUVER le serveur ; ce que PetKit attend ensuite dans `region` est l'id de ce
    // serveur, en minuscules. Confondre les deux passait inaperçu tant que la découverte échouait
    // en silence (elle était appelée en POST).
    const petkit = fakePetkit()
    const auth = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: null, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, store: null, now: () => NOW,
    })
    await auth.loginWithCode(EMAIL, CODE)
    expect(petkit.calls.find((c) => c.path === 'passport/regionservers')?.method).toBe('GET')
    expect(petkit.calls.find((c) => c.path === 'user/login')?.form.region).toBe('fr')
  })

  it('refuse un code faux en 401, alors que PetKit a répondu 200', async () => {
    const { app } = await setup()
    const r = await link(app, '000000')
    expect(r.statusCode).toBe(502)
    // Enveloppe `{ error: { code, message } }` : c'est celle que l'interface sait lire. Avec un
    // `error` en simple chaîne, le message se perdait et l'écran n'affichait qu'un « HTTP 502 ».
    expect(r.json().error.message).toContain('invalid code')
    expect(r.json().error.code).toBe('UPSTREAM_ERROR')
  })

  it('sans compte lié, la santé dit `needs_pairing` et aucun appareil n’est publié', async () => {
    const { plugin, ctx } = await setup()
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!().status).toBe('needs_pairing')
    expect(ctx.emitDevices).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]))
  })
})

describe('PetKit — session', () => {
  it('prolonge la session UNE SEULE FOIS quand deux lectures la réclament en même temps', async () => {
    // Le bug connu : les deux voient le bail à moitié écoulé, les deux se reconnectent, l'un des
    // deux jetons est mort-né et tout échoue ensuite en silence jusqu'à l'expiration.
    const petkit = fakePetkit()
    const auth = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: `${GATEWAY}/`, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, store: null, now: () => NOW + 30 * 3600_000,
    })
    await auth.loginWithCode(EMAIL, CODE)
    // la connexion a daté la session de `now` : on la vieillit en la rechargeant depuis un store
    const aged = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: `${GATEWAY}/`, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, now: () => NOW + 30 * 3600_000,
      store: { load: async () => linked(), save: async () => {}, clear: async () => {} },
    })
    await aged.restore()
    await Promise.all([aged.ensureFresh(), aged.ensureFresh(), aged.ensureFresh()])
    expect(petkit.calls.filter((c) => c.path === 'user/refreshsession')).toHaveLength(1)
  })

  it('ne prolonge pas une session encore jeune', async () => {
    const petkit = fakePetkit()
    const auth = new PetkitAuth({
      passportUrl: 'https://passport.petkt.com/', gateway: `${GATEWAY}/`, region: 'FR', timezone: 'Europe/Paris',
      appVersion: '13.2.1', fetchImpl: petkit.fetchImpl, now: () => NOW,
      store: { load: async () => linked(), save: async () => {}, clear: async () => {} },
    })
    await auth.restore()
    await auth.ensureFresh()
    expect(petkit.calls.filter((c) => c.path === 'user/refreshsession')).toHaveLength(0)
  })

  it('une session refusée est JETÉE : la carte des Réglages redemandera un code', async () => {
    const { plugin, app, store } = await setup({ deadSession: true, session: linked() })
    await plugin.discover()
    await flush()
    expect(store()).toBeNull()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/petkit/status' })).json()).toMatchObject({ linked: false })
  })

  it('ne reprend pas une session déjà périmée au démarrage', async () => {
    const { plugin } = await setup({ session: linked(NOW - 1000) })
    expect(plugin.health!().status).toBe('needs_pairing')
  })
})

describe('PetKit — inventaire et mappage', () => {
  it('publie une mangeoire et une fontaine, et ignore les modèles inconnus', async () => {
    const devices = toDevices(ROSTER, GROUP)
    expect(devices.map((d) => d.externalId)).toEqual([FEEDER, FOUNTAIN, 'd4-400000003', 'ctw3-400000001'])
    expect(devices.map((d) => d.kind)).toEqual(['pet_feeder', 'pet_fountain', 'pet_feeder', 'pet_fountain'])
    // l'identifiant de groupe vient de l'APPELANT : le roster est demandé groupe par groupe et
    // l'appareil ne répète pas le sien — sans cela, aucun relais Bluetooth ne serait trouvable
    expect(devices.every((d) => d.groupId === GROUP)).toBe(true)
  })

  it('demande les FAMILLES avant l’inventaire, et un roster par groupe', async () => {
    // PetKit n'expose aucune vue « tout le compte » : sans `group/family/list` d'abord, puis un
    // roster portant `day` et `groupId`, la réponse est « Request is incorrect. (code 3) ».
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    petkit.calls.length = 0
    await plugin.discover()
    expect(petkit.calls.some((c) => c.path === 'group/family/list')).toBe(true)
    const roster = petkit.calls.find((c) => c.path === 'discovery/device_roster_v2')!
    expect(roster.form.groupId).toBe(GROUP)
    expect(roster.form.day).toBe('20260921')
  })

  it('compte les PASSAGES de l’animal, faute de savoir mesurer un volume', async () => {
    // Une Eversweet Max rend -1 pour l'eau distribuée mais tient le registre de ses visites :
    // c'est cela que `water_usage` porte ici, pas des millilitres.
    const fountain = toDevices(ROSTER, GROUP).find((d) => d.kind === 'pet_fountain')!
    expect(toDescriptor(fountain).capabilities).toContain('water_usage')
    expect(toDrinkPatch(WORK_RECORD)).toEqual({ drinksToday: 2, drinkAvgS: 26 })
    // aucune visite : le compte est 0 et la moyenne EFFACÉE, pas 0 s (« venu sans boire »)
    expect(toDrinkPatch([])).toEqual({ drinksToday: 0, drinkAvgS: null })
  })

  it('déclare `feed` avec les rations du MODÈLE, jamais une plage inventée', async () => {
    const [feeder] = toDevices(ROSTER, GROUP)
    const d = toDescriptor(feeder!)
    expect(d.capabilities).toContain('feed')
    // en TASSES, pas en grammes : la machine déclare `factor: 10`, ses 10..50 sont des dixièmes
    expect(d.meta.petFeeder).toEqual({ portions: [1, 2, 3, 4, 5], unit: 'cup' })
    expect(d.meta.model).toBe('Fresh Element Solo')
  })

  it('ne déclare PAS `feed` pour un modèle dont on ignore les rations', async () => {
    const unknownModel = toDevices({ devices: [{ id: 9, type: 'd4s', name: 'Gemini' }] }, GROUP)
    // `d4s` est une mangeoire, mais à deux trémies : ses rations ne sont pas des grammes, et
    // proposer des boutons faux serait pire que ne rien proposer.
    expect(unknownModel).toHaveLength(0)
  })

  it('traduit l’état d’une mangeoire sans inventer ce qu’elle ne dit pas', async () => {
    const patch = toFeederPatch(FEEDER_DETAIL, 'd4', NOW)
    // 30 et 50 bruts deviennent 3 et 5 dixièmes de tasse — le facteur vient de la machine
    expect(patch).toMatchObject({ foodLow: false, servedToday: 3, plannedToday: 5, desiccantDays: 0, feeding: false })
    // Ce modèle n'a pas de plateau pesant : il ne dit PAS ce qui a été mangé. La ligne reste vide
    // plutôt que de recopier le servi sous un autre nom.
    expect(patch.eatenToday).toBeUndefined()
    // machine au secteur sans piles (`batteryPower: 0`) : absent, et surtout pas « 0 % »
    expect(patch.batteryPct).toBeUndefined()
    // erreur résolue : `null` EFFACE, sinon un vieux message resterait collé à la carte
    expect(patch.errorMessage).toBeNull()
  })

  it('traduit l’état d’une fontaine et DATE le relevé', async () => {
    const patch = toFountainPatch(FOUNTAIN_DETAIL, NOW)
    // `on` vient de `status.powerStatus` et non du premier niveau : lu à côté, la fontaine
    // paraîtrait éteinte en permanence.
    expect(patch).toMatchObject({ on: true, mode: 'intermittent', filterPct: 0, waterLow: false, batteryPct: 100 })
    // -1 = « non compté » : effacé (null), jamais ramené à zéro — « 0 mL bus » serait un mensonge.
    expect(patch.todayMl).toBeNull()
    expect(patch.filterDays).toBeNull()
    expect(patch.syncedAt).toBe(Date.parse('2026-09-21T06:35:36.860+0000'))
  })

  it('sans date de synchro, le relevé est daté de MAINTENANT plutôt que laissé inconnu', async () => {
    const patch = toFountainPatch({ ...FOUNTAIN_DETAIL, syncTime: undefined, updateAt: undefined }, NOW)
    expect(patch.syncedAt).toBe(NOW)
  })
})

describe('PetKit — commandes', () => {
  it('sert une ration puis RELIT : l’accusé du fabricant ne prouve pas que la ration est tombée', async () => {
    const { plugin, app, petkit, ctx } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await plugin.execute(FEEDER, { type: 'pet_feeder.feed', amount: 2 })
    const feed = petkit.calls.find((c) => c.path === 'd4/saveDailyFeed')
    // l'utilisateur demande 2 dixièmes de tasse, la machine reçoit 20 : la conversion est ici
    expect(feed?.form).toMatchObject({ amount: '20', deviceId: '400000004', day: '20260921' })
    expect(petkit.calls.some((c) => c.path === 'd4/device_detail')).toBe(true)
    expect(ctx.emitState).toHaveBeenCalledWith(FEEDER, expect.objectContaining({ servedToday: 3 }))
  })

  it('refuse une ration que le modèle n’accepte pas, au lieu de la laisser arrondir', async () => {
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await expect(plugin.execute(FEEDER, { type: 'pet_feeder.feed', amount: 2.5 })).rejects.toThrow(/1, 2, 3, 4, 5 cup/)
    expect(petkit.calls.some((c) => c.path === 'd4/saveDailyFeed')).toBe(false)
  })

  it('pilote la fontaine par relais : connexion, trame, relecture, fermeture', async () => {
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_mode', mode: 'continuous' })
    expect(petkit.calls.map((c) => c.path)).toEqual([
      'ble/ownSupportBleDevices', 'ble/connect', 'ble/poll', 'ble/controlDevice', 'ctw3/deviceData', 'ble/cancel',
    ])
    const frame = petkit.calls.find((c) => c.path === 'ble/controlDevice')!
    const bytes = [...Buffer.from(decodeURIComponent(frame.form.data!), 'base64')]
    // Trame MESURÉE sur la vraie fontaine : en-tête, code 220, compteur, longueur, marche, puis le
    // mode RÉPÉTÉ DEUX FOIS. C'est ce dernier octet que la table de la bibliothèque de référence
    // avait faux — sa trame était accusée « 1 » et ne changeait rien.
    expect(bytes).toEqual([250, 252, 253, 220, 1, 1, 3, 0, 1, 1, 1, 251])
    expect(frame.form.cmd).toBe('220')
  })

  it('ÉTEINDRE la pompe ne change pas son régime au passage', async () => {
    // Marche et régime voyagent dans la même trame : en figer un ferait basculer l'autre à l'insu
    // de l'utilisateur — une fontaine réglée en intermittent repasserait en continu à chaque arrêt.
    const { plugin, app, petkit } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    petkit.calls.length = 0
    await plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_power', on: false })
    const bytes = [...Buffer.from(decodeURIComponent(petkit.calls.find((c) => c.path === 'ble/controlDevice')!.form.data!), 'base64')]
    // marche = 0, et le mode RESTE 2 (intermittent), celui que la capture porte. Vérifié sur la
    // vraie fontaine : `powerStatus` passe à 0, `mode` ne bouge pas, la remise en route revient à 1.
    expect(bytes.slice(-4)).toEqual([0, 2, 2, 251])
  })

  it('REFERME la liaison même quand ce qu’on voulait faire échoue', async () => {
    // Sans cela, le relais — c'est-à-dire la mangeoire — resterait immobilisé pour la suite.
    const { plugin, app, petkit, opts } = await setup({ session: linked() })
    await link(app)
    await plugin.discover()
    // la fontaine ne tombe en panne qu'APRÈS avoir été lue une fois : sans cela on ne connaîtrait
    // pas son adresse Bluetooth, et la commande échouerait avant même d'ouvrir une liaison
    opts.fountainReadFails = true
    petkit.calls.length = 0
    await expect(plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_power', on: false })).rejects.toThrow()
    expect(petkit.calls.some((c) => c.path === 'ble/cancel')).toBe(true)
  })

  it('une fontaine hors de portée DÉGRADE, elle ne met pas le plugin en panne', async () => {
    const { plugin, app } = await setup({ session: linked(), noRelay: true })
    await link(app)
    await plugin.discover()
    await expect(plugin.execute(FOUNTAIN, { type: 'pet_fountain.set_power', on: true })).rejects.toThrow(/relay/)
    const r = await app.inject({ method: 'GET', url: '/api/plugins/petkit/status' })
    expect(r.json().linked).toBe(true)
  })
})
