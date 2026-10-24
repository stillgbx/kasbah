import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCookieFile, writeNetscapeBeside } from './cookie'

// The cookie is the whole Google session, kept twice (raw for InnerTube, Netscape for yt-dlp).

describe('YouTube Music cookie file', () => {
  const cookie = '__Secure-3PAPISID=abc; SID=def'

  it('removes both copies when the account is unlinked', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kasbah-ytm-cookie-')), 'ytmusic-cookie.txt')
    const store = createCookieFile(file)
    await store.write(cookie)
    const netscape = await writeNetscapeBeside(file, cookie)
    expect(await store.read()).toBe(cookie)
    await store.clear()
    expect(existsSync(file)).toBe(false)
    expect(existsSync(netscape)).toBe(false)
    await store.clear() // nothing left: not an error
  })

  it.skipIf(process.platform === 'win32')('writes both copies readable by the server alone', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kasbah-ytm-cookie-')), 'ytmusic-cookie.txt')
    await createCookieFile(file).write(cookie)
    const netscape = await writeNetscapeBeside(file, cookie)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(netscape).mode & 0o777).toBe(0o600)
  })
})
