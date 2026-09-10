import { z } from 'zod'

// Sonde d'une TV Sony BRAVIA par son API REST locale (« IP control », port 80, JSON-RPC sous /sony/).
// Le protocole Cast ne sait pas où part le son : une TV branchée en HDMI ARC sur une barre de son joue
// YouTube Music à l'image, mais c'est la barre qu'on entend — et la barre, côté Cast, est au repos
// (relevé du 2026-09-10 : aucune appli, aucune session). La TV, elle, le dit sans clé ni appairage :
//  - `audio.getSoundSettings(outputTerminal)` → `speaker` (ses haut-parleurs) ou `audioSystem` (ARC) ;
//  - `avContent.getCurrentExternalInputsStatus` → l'entrée « HDMI 3 (eARC/ARC) » connectée, et le nom
//    CEC de l'appareil branché dessus (« Flexus 300 »).
// D'autres méthodes (`getPlayingContentInfo`, `getSystemInformation`) répondent 403 sans clé PSK ; on
// n'en a pas besoin. Lecture seule, deux requêtes par relevé.

export type BraviaFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** Le modèle annoncé en mDNS (« BRAVIA 4K VH22 ») : seule une BRAVIA a cette API. */
export const isBravia = (model: string | undefined): boolean => /^BRAVIA\b/i.test(model ?? '')

export type AudioTerminal = 'internal' | 'external' | 'both'
export interface AudioOutput { terminal: AudioTerminal; name?: string }

const settingsReply = z.object({ result: z.tuple([z.array(z.looseObject({ target: z.string(), currentValue: z.string() }))]) })
const inputsReply = z.object({
  result: z.tuple([z.array(z.looseObject({ uri: z.string(), title: z.string().optional(), connection: z.boolean().optional(), label: z.string().optional() }))]),
})

/**
 * Sortie son d'après `outputTerminal` : `speaker` = la TV elle-même ; `audioSystem` et `hdmi` = le
 * système audio branché ; `speaker_hdmi` = les deux. Valeur inconnue ou réponse d'erreur : `undefined`.
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
 * Nom de l'appareil branché sur l'entrée HDMI ARC : celui que la TV a appris par CEC (« Flexus 300 »,
 * entrée `extInput:cec?…&port=3`), à défaut l'étiquette donnée par l'utilisateur à cette entrée
 * (« Barre de son »). `undefined` si aucune entrée ARC n'est connectée.
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

/** Un relevé : où part le son, et le nom du système audio si une entrée ARC est branchée. `undefined` si la TV ne répond pas. */
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
