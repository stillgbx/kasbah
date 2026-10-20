import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../../core/sse'
import {
  RENEW_WARNING_DAYS, checkToken, createTokenFile, decodeEnphaseToken, loginEnlighten, mintEnphaseToken, rejectionMessage,
  resolveEnphaseToken, tokenStage,
} from './token'

// IQ Gateway token: reading the expiry, minting with the cloud, choosing the token to use. No real
// gateway or account is touched — tokens are built here, the cloud is a fake `fetch`. Real tokens
// carry a signature, never checked on our side (the gateway checks it): the signature part is
// therefore arbitrary filler.

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 11)
const SERIAL = '123456789012'

function jwt(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`
}

/** Token valid for `days` days, issued for `serial` (default: the reference gateway). */
const token = (days: number, over: Record<string, unknown> = {}) => jwt({
  aud: SERIAL, iss: 'Entrez', enphaseUser: 'owner', username: 'toit@exemple.fr',
  exp: Math.floor((NOW + days * DAY) / 1000), ...over,
})

const response = (text: string, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => JSON.parse(text) as unknown,
  text: async () => text,
})

/** Fake Enphase cloud: session then exchange, as the vendor's technical note describes them. */
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

describe('reading the token', () => {
  it('gives the gateway, the role and an expiry in milliseconds', () => {
    const claims = decodeEnphaseToken(token(365))
    expect(claims).toMatchObject({ serial: SERIAL, role: 'owner', username: 'toit@exemple.fr' })
    expect(claims!.expiresAt).toBe(NOW + 365 * DAY)
  })

  it('accepts an array `aud` and does without the optional fields', () => {
    const claims = decodeEnphaseToken(jwt({ aud: [SERIAL, 'autre'], exp: 1 }))
    expect(claims).toEqual({ serial: SERIAL, role: undefined, username: undefined, expiresAt: 1000 })
  })

  it('returns null on anything that is not a readable JWT — a truncated token must say so, not end up as a 401', () => {
    expect(decodeEnphaseToken('pas-un-jeton')).toBeNull()
    expect(decodeEnphaseToken('a.b')).toBeNull()
    expect(decodeEnphaseToken('a.!!!.c')).toBeNull()
    expect(decodeEnphaseToken(jwt({ aud: SERIAL }))).toBeNull()          // without `exp`, nothing to watch
  })
})

describe('expiry', () => {
  const stageOf = (days: number) => tokenStage(decodeEnphaseToken(token(days))!, NOW)

  it('flags renewal under 30 days, and expiry past the term', () => {
    expect(stageOf(365)).toEqual({ stage: 'ok', daysLeft: 365 })
    expect(stageOf(RENEW_WARNING_DAYS)).toMatchObject({ stage: 'ok' })
    expect(stageOf(RENEW_WARNING_DAYS - 1)).toEqual({ stage: 'expiring', daysLeft: 29 })
    expect(stageOf(0.5)).toMatchObject({ stage: 'expiring', daysLeft: 0 })
    expect(stageOf(-1)).toEqual({ stage: 'expired', daysLeft: -1 })
  })

  it('an installer token (12 h) is born already due for renewal: that is what gets it noticed', () => {
    const claims = decodeEnphaseToken(token(0.5, { enphaseUser: 'installer' }))!
    expect(claims.role).toBe('installer')
    expect(tokenStage(claims, NOW).stage).toBe('expiring')
  })
})

describe('minting with the cloud', () => {
  it('opens a session then exchanges the id for a token for THIS gateway', async () => {
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
    // the password goes out as an encoded form, the exchange as JSON with the session id
    expect(new URLSearchParams(cloud.calls[0]!.body).get('user[password]')).toBe('secret')
    expect(JSON.parse(cloud.calls[1]!.body)).toEqual({ session_id: 'sess-1', serial_num: SERIAL, username: 'toit@exemple.fr' })
  })

  it('accepts the token as plain text as well as JSON — firmwares do not answer the same way', async () => {
    const raw = token(365)
    for (const body of [raw, `  ${raw}\n`, JSON.stringify({ token: raw })]) {
      const cloud = fakeCloud({ tokenBody: body })
      const r = await mintEnphaseToken({ user: 'u', password: 'p', serial: SERIAL, fetchImpl: cloud.fetchImpl })
      expect(r.token).toBe(raw)
    }
  })

  it('credentials refused → NEEDS_PAIRING (up to the user to act), and nothing is exchanged', async () => {
    const cloud = fakeCloud({ sessionStatus: 401 })
    await expect(mintEnphaseToken({ user: 'u', password: 'faux', serial: SERIAL, fetchImpl: cloud.fetchImpl }))
      .rejects.toMatchObject({ code: 'NEEDS_PAIRING' })
    expect(cloud.calls).toHaveLength(1)
  })

  it('separates the Rails cookie from the JSON session_id: the first opens Enlighten, the second mints the token', async () => {
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

  it('response without a usable token → UPSTREAM_ERROR, cloud unreachable → UPSTREAM_ERROR', async () => {
    const cloud = fakeCloud({ tokenBody: 'Gateway not found' })
    await expect(mintEnphaseToken({ user: 'u', password: 'p', serial: SERIAL, fetchImpl: cloud.fetchImpl }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    const down = vi.fn<FetchLike>(async () => { throw new Error('ECONNREFUSED') })
    await expect(mintEnphaseToken({ user: 'u', password: 'p', serial: SERIAL, fetchImpl: down }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
  })
})

describe('token acceptability', () => {
  /** `serial` omitted = unknown gateway (it did not answer `/info`). */
  const reasonOf = (t: string, serial?: string) => {
    const r = checkToken(t, { ...(serial ? { serial } : {}), now: NOW })
    return r.ok ? 'ok' : r.reason
  }

  it('tells apart the three refusals, which are not fixed the same way', () => {
    expect(reasonOf(token(100), SERIAL)).toBe('ok')
    expect(reasonOf('tronque', SERIAL)).toBe('unreadable')
    expect(reasonOf(token(-1), SERIAL)).toBe('expired')
    expect(reasonOf(token(100, { aud: '999999999999' }), SERIAL)).toBe('other-gateway')
    // unknown gateway: nothing can be held against the token's audience, we accept it
    expect(reasonOf(token(100, { aud: '999999999999' }))).toBe('ok')
  })

  it('pairs each refusal with a sentence that can be shown to the user', () => {
    const message = (t: string) => {
      const r = checkToken(t, { serial: SERIAL, now: NOW })
      return r.ok ? '' : rejectionMessage(r.reason, r.claims, SERIAL)
    }
    expect(message('tronque')).toMatch(/not a readable/)
    expect(message(token(-1))).toMatch(/expired on 2026-09-10/)
    expect(message(token(100, { aud: '999999999999' }))).toMatch(/999999999999.*not 123456789012/)
  })

  it('returns the token stripped of its whitespace: a copy-paste often drags some along', () => {
    const r = checkToken(`  ${token(100)}\n`, { serial: SERIAL, now: NOW })
    expect(r.ok && r.checked.token).toBe(token(100))
  })
})

describe('token cache', () => {
  it('reads back what it wrote, and tolerates a missing or unreadable file', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'kasbah-enphase-')), 'token.json')
    const file = createTokenFile(path)
    expect(await file.load()).toBeNull()                    // first start
    await file.save('abc')
    expect(await file.load()).toBe('abc')
    await writeFile(path, '{ pas du json', 'utf8')
    expect(await file.load()).toBeNull()
  })
})

describe('choosing the token at startup', () => {
  const file = async (cached?: string) => {
    const store = createTokenFile(join(await mkdtemp(join(tmpdir(), 'kasbah-enphase-')), 'token.json'))
    if (cached) await store.save(cached)
    return store
  }

  it('keeps the one that expires the latest, whatever its origin', async () => {
    const long = token(300), short = token(200)
    // real case: a 12 h installer token left in `.env` must not eclipse the one-year token the
    // pairing has just cached
    const a = await resolveEnphaseToken({ token: token(0.5, { enphaseUser: 'installer' }), serial: SERIAL, store: await file(long), now: NOW })
    expect(a).toMatchObject({ source: 'cache', token: long })
    const b = await resolveEnphaseToken({ token: long, serial: SERIAL, store: await file(short), now: NOW })
    expect(b).toMatchObject({ source: 'config', token: long })
  })

  it('an unacceptable token in the configuration falls back on the cache: it must not hide a fresh token', async () => {
    const cached = token(120)
    for (const bad of [token(-5), 'tronque', token(100, { aud: '999999999999' })]) {
      const r = await resolveEnphaseToken({ token: bad, store: await file(cached), serial: SERIAL, now: NOW })
      expect(r).toMatchObject({ source: 'cache', token: cached })
    }
  })

  it('nothing usable → null, and NO call to the cloud: minting a token requires credentials', async () => {
    expect(await resolveEnphaseToken({ token: token(-1), serial: SERIAL, now: NOW })).toBeNull()
    expect(await resolveEnphaseToken({ serial: SERIAL, now: NOW })).toBeNull()
    expect(await resolveEnphaseToken({ store: await file(), serial: SERIAL, now: NOW })).toBeNull()
  })

  it('returns the expiry with the token: it is what the UI shows to ask for a renewal', async () => {
    const r = await resolveEnphaseToken({ token: token(12), serial: SERIAL, now: NOW })
    expect(r).toMatchObject({ stage: 'expiring', daysLeft: 12 })
    expect(r!.claims.expiresAt).toBe(NOW + 12 * DAY)
  })
})
