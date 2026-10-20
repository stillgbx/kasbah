import { z } from 'zod'

// Probe of a Sony BRAVIA TV through its local REST API ("IP control", port 80, JSON-RPC under /sony/).
// The Cast protocol does not know where the sound goes: a TV plugged over HDMI ARC into a soundbar
// plays YouTube Music on screen, but it is the soundbar you hear — and the soundbar, on the Cast side,
// is idle (survey of 2026-09-10: no app, no session). The TV, however, tells it without a key or
// pairing:
//  - `audio.getSoundSettings(outputTerminal)` → `speaker` (its speakers) or `audioSystem` (ARC);
//  - `avContent.getCurrentExternalInputsStatus` → the connected "HDMI 3 (eARC/ARC)" input, and the
//    CEC name of the device plugged into it ("Flexus 300").
// Other methods (`getPlayingContentInfo`, `getSystemInformation`) answer 403 without a PSK key; we
// do not need them. Read-only, two requests per reading.

export type BraviaFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** The model announced over mDNS ("BRAVIA 4K VH22"): only a BRAVIA has this API. */
export const isBravia = (model: string | undefined): boolean => /^BRAVIA\b/i.test(model ?? '')

export type AudioTerminal = 'internal' | 'external' | 'both'
export interface AudioOutput { terminal: AudioTerminal; name?: string }

const settingsReply = z.object({ result: z.tuple([z.array(z.looseObject({ target: z.string(), currentValue: z.string() }))]) })
const inputsReply = z.object({
  result: z.tuple([z.array(z.looseObject({ uri: z.string(), title: z.string().optional(), connection: z.boolean().optional(), label: z.string().optional() }))]),
})

/**
 * Sound output from `outputTerminal`: `speaker` = the TV itself; `audioSystem` and `hdmi` = the
 * plugged-in audio system; `speaker_hdmi` = both. Unknown value or error response: `undefined`.
 */
export function parseSoundOutput(reply: unknown): AudioTerminal | undefined {
  const r = settingsReply.safeParse(reply)
  if (!r.success) return undefined
  switch (r.data.result[0].find((s) => s.target === 'outputTerminal')?.currentValue) {
    case 'speaker': return 'internal'
    case 'audioSystem': case 'hdmi': return 'external'
    case 'speaker_hdmi': return 'both'
    default: return undefined
  }
}

/**
 * Name of the device plugged into the HDMI ARC input: the one the TV learned through CEC ("Flexus
 * 300", input `extInput:cec?…&port=3`), failing that the label the user gave that input ("Barre de
 * son"). `undefined` if no ARC input is connected.
 */
export function parseArcDeviceName(reply: unknown): string | undefined {
  const r = inputsReply.safeParse(reply)
  if (!r.success) return undefined
  const inputs = r.data.result[0]
  const arc = inputs.find((i) => i.uri.startsWith('extInput:hdmi?') && /\bARC\b/i.test(i.title ?? '') && i.connection === true)
  if (!arc) return undefined
  const port = /[?&]port=(\d+)/.exec(arc.uri)?.[1]
  const cec = port ? inputs.find((i) => i.uri.startsWith('extInput:cec?') && new RegExp(`[?&]port=${port}(&|$)`).test(i.uri)) : undefined
  return cec?.title?.trim() || arc.label?.trim() || undefined
}

const DEFAULT_TIMEOUT_MS = 4000

/** One reading: where the sound goes, and the audio system's name if an ARC input is plugged in. `undefined` if the TV does not answer. */
export async function probeBravia(host: string, fetchImpl: BraviaFetch, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AudioOutput | undefined> {
  const call = async (service: string, method: string, params: unknown[], version: string): Promise<unknown> => {
    const res = await fetchImpl(`http://${host}/sony/${service}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, id: 1, params, version }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`bravia ${method} answered HTTP ${res.status}`)
    return res.json()
  }
  const terminal = parseSoundOutput(await call('audio', 'getSoundSettings', [{ target: 'outputTerminal' }], '1.1'))
  if (!terminal) return undefined
  if (terminal === 'internal') return { terminal }
  const name = parseArcDeviceName(await call('avContent', 'getCurrentExternalInputsStatus', [], '1.1'))
  return name ? { terminal, name } : { terminal }
}

export const sameAudioOutput = (a: AudioOutput | undefined, b: AudioOutput | undefined): boolean =>
  a?.terminal === b?.terminal && a?.name === b?.name
