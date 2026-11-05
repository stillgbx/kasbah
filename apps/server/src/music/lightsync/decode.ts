import { spawn } from 'node:child_process'
import type { Logger } from 'pino'
import type { SpawnFn } from '../proxy'
import { FeatureExtractor, SAMPLE_RATE, type FeatureSource } from './analyze'

// A second read of the track's source, decoded by ffmpeg to mono float PCM as fast as the network
// allows (no `-re`): the features run ahead of the speaker, and the sync reads them by position.

export interface Decoding {
  readonly features: FeatureSource
  /** True once ffmpeg has finished (end of the source or failure). */
  readonly done: boolean
  stop(): void
}

export interface DecodeOpts {
  ffmpegPath: string
  spawnImpl?: SpawnFn
  logger?: Logger
}

export function decode(sourceUrl: string, startS: number, opts: DecodeOpts): Decoding {
  const features = new FeatureExtractor(startS)
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
  const proc = spawnImpl(opts.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    // `-ss` before `-i`: ffmpeg seeks in the source without decoding what comes before
    ...(startS > 0 ? ['-ss', startS.toFixed(3)] : []),
    '-i', sourceUrl,
    '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

  let done = false
  let stopped = false
  // f32le samples can straddle two chunks: the leftover bytes wait for the next one
  let rest = Buffer.alloc(0)
  proc.stdout.on('data', (chunk: Buffer) => {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk
    const whole = buf.length - (buf.length % 4)
    rest = Buffer.from(buf.subarray(whole))
    if (whole === 0) return
    // copy: a Float32Array view needs 4-byte alignment, which Node's pooled buffers don't promise
    const aligned = new Uint8Array(whole)
    aligned.set(buf.subarray(0, whole))
    features.push(new Float32Array(aligned.buffer))
  })
  let stderr = ''
  proc.stderr.on('data', (c: Buffer) => { if (stderr.length < 2000) stderr += c.toString() })
  proc.on('error', (err) => { done = true; opts.logger?.warn({ err }, 'lightsync: ffmpeg did not start') })
  proc.on('close', (code) => {
    done = true
    if (!stopped && code !== 0) opts.logger?.warn({ code, stderr: stderr.trim() }, 'lightsync: decoding stopped early')
  })

  return {
    features,
    get done() { return done },
    stop() {
      stopped = true
      if (!done) proc.kill('SIGKILL')
    },
  }
}
