import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../../core/sse'
import {
  RENEW_WARNING_DAYS, checkToken, createTokenFile, decodeEnphaseToken, loginEnlighten, mintEnphaseToken, rejectionMessage,
  resolveEnphaseToken, tokenStage,
} from './token'

// Jeton de la passerelle IQ : lecture de l'échéance, frappe au cloud, choix du jeton à utiliser.
// Aucune passerelle ni aucun compte réel n'est touché — les jetons sont fabriqués ici, le cloud est
// un faux `fetch`. Les vrais jetons portent une signature, jamais vérifiée de notre côté (c'est la
// passerelle qui vérifie) : la partie signature est donc un remplissage quelconque.

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 11)
const SERIAL = '123456789012'

function jwt(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`
}

/** Jeton valable `days` jours, émis pour `serial` (défaut : la passerelle de référence). */
const token = (days: number, over: Record<string, unknown> = {}) => jwt({
  aud: SERIAL, iss: 'Entrez', enphaseUser: 'owner', username: 'toit@exemple.fr',
  exp: Math.floor((NOW + days * DAY) / 1000), ...over,
})

const response = (text: string, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => JSON.parse(text) as unknown,
  text: async () => text,
})

/** Faux cloud Enphase : session puis échange, comme la note technique du fabricant les décrit. */
function fakeCloud(opts: { sessionStatus?: number; tokenBody?: string } = {}) {
  const calls: { url: string; body: string }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, body: String(init?.body ?? '') })
    if (url.includes('/login/login.json')) {
      return opts.sessionStatus
        ? response('{"message":"invalid credentials"}', opts.sessionStatus)
        : response('{"session_id":"sess-1","message":"success"}')
    }
    return response(opts.tokenBody ?? token(365))
  })
  return { fetchImpl, calls }
}

describe('lecture du jeton', () => {
  it('donne la passerelle, le rôle et une échéance en millisecondes', () => {
    const claims = decodeEnphaseToken(token(365))
    expect(claims).toMatchObject({ serial: SERIAL, role: 'owner', username: 'toit@exemple.fr' })
    expect(claims!.expiresAt).toBe(NOW + 365 * DAY)
  })

  it('accepte un `aud` en tableau et se passe des champs optionnels', () => {
    const claims = decodeEnphaseToken(jwt({ aud: [SERIAL, 'autre'], exp: 1 }))
    expect(claims).toEqual({ serial: SERIAL, role: undefined, username: undefined, expiresAt: 1000 })
  })

  it('rend null sur ce qui n\'est pas un JWT lisible — un jeton tronqué doit se dire, pas partir en 401', () => {
    expect(decodeEnphaseToken('pas-un-jeton')).toBeNull()
    expect(decodeEnphaseToken('a.b')).toBeNull()
    expect(decodeEnphaseToken('a.!!!.c')).toBeNull()
    expect(decodeEnphaseToken(jwt({ aud: SERIAL }))).toBeNull()          // sans `exp`, rien à surveiller
  })
})

describe('échéance', () => {
  const stageOf = (days: number) => tokenStage(decodeEnphaseToken(token(days))!, NOW)

  it('signale le renouvellement sous 30 jours, et l\'expiration passé le terme', () => {
    expect(stageOf(365)).toEqual({ stage: 'ok', daysLeft: 365 })
    expect(stageOf(RENEW_WARNING_DAYS)).toMatchObject({ stage: 'ok' })
    expect(stageOf(RENEW_WARNING_DAYS - 1)).toEqual({ stage: 'expiring', daysLeft: 29 })
    expect(stageOf(0.5)).toMatchObject({ stage: 'expiring', daysLeft: 0 })
    expect(stageOf(-1)).toEqual({ stage: 'expired', daysLeft: -1 })
  })

  it('un jeton d\'installateur (12 h) naît déjà en renouvellement : c\'est ce qui le fait remarquer', () => {
    const claims = decodeEnphaseToken(token(0.5, { enphaseUser: 'installer' }))!
    expect(claims.role).toBe('installer')
    expect(tokenStage(claims, NOW).stage).toBe('expiring')
  })
})

describe('frappe au cloud', () => {
  it('ouvre une session puis échange l\'id contre un jeton pour CETTE passerelle', async () => {
    const cloud = fakeCloud()
    const { token: minted, claims } = await mintEnphaseToken({
      user: 'toit@exemple.fr', password: 'secret', serial: SERIAL, fetchImpl: cloud.fetchImpl,
    })
    expect(claims.serial).toBe(SERIAL)
    expect(decodeEnphaseToken(minted)).not.toBeNull()
    expect(cloud.calls.map((c) => c.url)).toEqual([
      'https://enlighten.enphaseenergy.com/login/login.json',
      'https://entrez.enphaseenergy.com/tokens',
    ])
    // le mot de passe part en formulaire encodé, l'échange en JSON avec l'id de session
    expect(new URLSearchParams(cloud.calls[0]!.body).get('user[password]')).toBe('secret')
    expect(JSON.parse(cloud.calls[1]!.body)).toEqual({ session_id: 'sess-1', serial_num: SERIAL, username: 'toit@exemple.fr' })
  })

  it('accepte le jeton en texte brut comme en JSON — les firmwares ne répondent pas pareil', async () => {
    const raw = token(365)
    for (const body of [raw, `  ${raw}\n`, JSON.stringify({ token: raw })]) {
      const cloud = fakeCloud({ tokenBody: body })
      const r = await mintEnphaseToken({ user: 'u', password: 'p', serial: SERIAL, fetchImpl: cloud.fetchImpl })
      expect(r.token).toBe(raw)
    }
  })

  it('identifiants refusés → NEEDS_PAIRING (à l\'utilisateur d\'agir), et rien n\'est échangé', async () => {
    const cloud = fakeCloud({ sessionStatus: 401 })
    await expect(mintEnphaseToken({ user: 'u', password: 'faux', serial: SERIAL, fetchImpl: cloud.fetchImpl }))
      .rejects.toMatchObject({ code: 'NEEDS_PAIRING' })
    expect(cloud.calls).toHaveLength(1)
  })

  it('sépare le cookie Rails du session_id JSON : le premier ouvre Enlighten, le second frappe le jeton', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.includes('/login/login.json')) {
        return {
          ok: true, status: 200, body: null,
          json: async () => ({ session_id: 'sess-json', message: 'success' }),
          text: async () => '{"session_id":"sess-json","message":"success"}',
          headers: {
            get: (name: string) => name.toLowerCase() === 'set-cookie'
              ? 'locale=en; path=/, _enlighten_4_session=rails-cookie; path=/; httponly'
              : null,
            getSetCookie: () => [
              'locale=en; path=/',
              '_enlighten_4_session=rails-cookie; path=/; httponly',
            ],
          },
        }
      }
      return response(token(365))
    })
    const r = await loginEnlighten({ user: 'u', password: 'p', fetchImpl })
    expect(r).toEqual({ sessionId: 'sess-json', cookie: 'rails-cookie' })
  })

  it('réponse sans jeton utilisable → UPSTREAM_ERROR, cloud injoignable → UPSTREAM_ERROR', async () => {
    const cloud = fakeCloud({ tokenBody: 'Gateway not found' })
    await expect(mintEnphaseToken({ user: 'u', password: 'p', serial: SERIAL, fetchImpl: cloud.fetchImpl }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    const down = vi.fn<FetchLike>(async () => { throw new Error('ECONNREFUSED') })
    await expect(mintEnphaseToken({ user: 'u', password: 'p', serial: SERIAL, fetchImpl: down }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
  })
})

describe('recevabilité d\'un jeton', () => {
  /** `serial` omis = passerelle inconnue (elle n'a pas répondu à `/info`). */
  const reasonOf = (t: string, serial?: string) => {
    const r = checkToken(t, { ...(serial ? { serial } : {}), now: NOW })
    return r.ok ? 'ok' : r.reason
  }

  it('distingue les trois refus, qui ne se réparent pas de la même façon', () => {
    expect(reasonOf(token(100), SERIAL)).toBe('ok')
    expect(reasonOf('tronque', SERIAL)).toBe('unreadable')
    expect(reasonOf(token(-1), SERIAL)).toBe('expired')
    expect(reasonOf(token(100, { aud: '999999999999' }), SERIAL)).toBe('other-gateway')
    // passerelle inconnue : on ne peut rien reprocher à l'audience du jeton, on l'accepte
    expect(reasonOf(token(100, { aud: '999999999999' }))).toBe('ok')
  })

  it('accompagne chaque refus d\'une phrase montrable à l\'utilisateur', () => {
    const message = (t: string) => {
      const r = checkToken(t, { serial: SERIAL, now: NOW })
      return r.ok ? '' : rejectionMessage(r.reason, r.claims, SERIAL)
    }
    expect(message('tronque')).toMatch(/not a readable/)
    expect(message(token(-1))).toMatch(/expired on 2026-09-10/)
    expect(message(token(100, { aud: '999999999999' }))).toMatch(/999999999999.*not 123456789012/)
  })

  it('rend le jeton débarrassé de ses espaces : un copier-coller en traîne souvent', () => {
    const r = checkToken(`  ${token(100)}\n`, { serial: SERIAL, now: NOW })
    expect(r.ok && r.checked.token).toBe(token(100))
  })
})

describe('cache du jeton', () => {
  it('relit ce qu\'il a écrit, et tolère un fichier absent ou illisible', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'kasbah-enphase-')), 'token.json')
    const file = createTokenFile(path)
    expect(await file.load()).toBeNull()                    // premier démarrage
    await file.save('abc')
    expect(await file.load()).toBe('abc')
    await writeFile(path, '{ pas du json', 'utf8')
    expect(await file.load()).toBeNull()
  })
})

describe('choix du jeton au démarrage', () => {
  const file = async (cached?: string) => {
    const store = createTokenFile(join(await mkdtemp(join(tmpdir(), 'kasbah-enphase-')), 'token.json'))
    if (cached) await store.save(cached)
    return store
  }

  it('garde celui qui expire le plus tard, quelle que soit sa provenance', async () => {
    const long = token(300), short = token(200)
    // cas vécu : un jeton d'installateur de 12 h laissé dans `.env` ne doit pas éclipser le jeton
    // d'un an que l'appairage vient de mettre en cache
    const a = await resolveEnphaseToken({ token: token(0.5, { enphaseUser: 'installer' }), serial: SERIAL, store: await file(long), now: NOW })
    expect(a).toMatchObject({ source: 'cache', token: long })
    const b = await resolveEnphaseToken({ token: long, serial: SERIAL, store: await file(short), now: NOW })
    expect(b).toMatchObject({ source: 'config', token: long })
  })

  it('un jeton irrecevable en configuration retombe sur le cache : il ne doit pas masquer un jeton frais', async () => {
    const cached = token(120)
    for (const bad of [token(-5), 'tronque', token(100, { aud: '999999999999' })]) {
      const r = await resolveEnphaseToken({ token: bad, store: await file(cached), serial: SERIAL, now: NOW })
      expect(r).toMatchObject({ source: 'cache', token: cached })
    }
  })

  it('rien d\'utilisable → null, et AUCUN appel au cloud : frapper un jeton demande des identifiants', async () => {
    expect(await resolveEnphaseToken({ token: token(-1), serial: SERIAL, now: NOW })).toBeNull()
    expect(await resolveEnphaseToken({ serial: SERIAL, now: NOW })).toBeNull()
    expect(await resolveEnphaseToken({ store: await file(), serial: SERIAL, now: NOW })).toBeNull()
  })

  it('rend l\'échéance avec le jeton : c\'est elle que l\'UI affiche pour réclamer un renouvellement', async () => {
    const r = await resolveEnphaseToken({ token: token(12), serial: SERIAL, now: NOW })
    expect(r).toMatchObject({ stage: 'expiring', daysLeft: 12 })
    expect(r!.claims.expiresAt).toBe(NOW + 12 * DAY)
  })
})
