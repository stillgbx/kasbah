import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { SpawnFn } from '../../music/proxy'
import { resolveStreamUrl } from './resolve'

/** yt-dlp `-J` answering one m4a format of `filesize` bytes, with `stderr` on the side. */
function fakeYtdlp(filesize: number, stderr = '') {
  const spawnImpl = vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough }
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    queueMicrotask(() => {
      proc.stderr.end(stderr)
      proc.stdout.end(JSON.stringify({
        duration: 248,
        formats: [{ url: 'https://googlevideo.example/a.m4a', format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', filesize }],
      }))
      proc.emit('close', 0)
    })
    return proc as never
  })
  return spawnImpl as unknown as SpawnFn & ReturnType<typeof vi.fn>
}

const base = { videoId: 'LlVN5B1uMRw', ytdlpPath: 'yt-dlp', poTokenUrl: 'http://127.0.0.1:4416', netscapePath: 'cookies.netscape' }

describe('resolveStreamUrl', () => {
  it('hands yt-dlp warnings over instead of silencing them', async () => {
    const spawnImpl = fakeYtdlp(500_000, 'WARNING: [youtube] The provided YouTube account cookies are no longer valid.\n[debug] noise\n')
    const onWarnings = vi.fn()
    await resolveStreamUrl({ ...base, cookieRaw: 'SAPISID=x', spawnImpl, onWarnings })
    expect(spawnImpl.mock.calls[0]![1]).not.toContain('--no-warnings')
    expect(onWarnings).toHaveBeenCalledWith(['WARNING: [youtube] The provided YouTube account cookies are no longer valid.'])
  })

  it('refuses a stream that YouTube cuts after its first megabyte', async () => {
    // seen on 2026-10-30 with a cookie yt-dlp no longer accepted: 0-1048575 → 206, anything past it → 403
    const asked: string[] = []
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>).range!
      asked.push(range)
      return new Response(null, { status: 403 })
    }) as unknown as typeof fetch
    await expect(resolveStreamUrl({ ...base, cookieRaw: 'SAPISID=x', spawnImpl: fakeYtdlp(4_007_928), fetchImpl }))
      .rejects.toThrow(/first megabyte.*paste a fresh one/)
    expect(asked).toEqual(['bytes=4007927-4007927'])
  })

  it('serves the stream when its end answers, or when the check cannot be made', async () => {
    const ok = (async () => new Response('x', { status: 206 })) as unknown as typeof fetch
    await expect(resolveStreamUrl({ ...base, cookieRaw: '', spawnImpl: fakeYtdlp(4_007_928), fetchImpl: ok }))
      .resolves.toMatchObject({ sizeBytes: 4_007_928 })
    // the network failing is not YouTube refusing: the speaker will say for itself
    const down = (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
    await expect(resolveStreamUrl({ ...base, cookieRaw: '', spawnImpl: fakeYtdlp(4_007_928), fetchImpl: down }))
      .resolves.toMatchObject({ sizeBytes: 4_007_928 })
  })

  it('does not check a stream that fits in its first megabyte', async () => {
    const fetchImpl = vi.fn()
    await resolveStreamUrl({ ...base, cookieRaw: '', spawnImpl: fakeYtdlp(786_113), fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
