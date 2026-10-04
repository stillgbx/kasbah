import { z } from 'zod'

// Ce que les réponses de TouteMonAnnée deviennent pour Kasbah. API PRIVÉE (celle de l'appli web du
// site, relevée le 2026-10-04) : chaque schéma est lâche — un champ en plus ne casse rien, un champ
// qui manque est absorbé là où c'est sans conséquence.

// ---- Réponses du site -------------------------------------------------------------------------

const fileSchema = z.object({
  id: z.number(),
  src: z.string().nullish(),
  src_mini: z.string().nullish(),
  type: z.string().nullish(),
  extension: z.string().nullish(),
  legend: z.string().nullish(),
}).passthrough()

const authorSchema = z.object({ name: z.string() }).passthrough()

/** `{ day: "08", month: "Sept.", year: 2026, hours: "17", minutes: "09" }` : mois abrégé en français. */
const detailedDateSchema = z.object({
  day: z.union([z.string(), z.number()]),
  month: z.string(),
  year: z.union([z.string(), z.number()]),
  hours: z.union([z.string(), z.number()]).optional(),
  minutes: z.union([z.string(), z.number()]).optional(),
}).passthrough()

export const spacesSchema = z.object({
  spaces: z.array(z.object({
    uuid: z.string(),
    display_name: z.string(),
    display_years: z.string().nullish(),
    /** 1 = cahier de texte d'une classe ; 2 = espace d'association, etc. */
    type: z.number(),
    in_scope: z.boolean().optional(),
    deleted_at: z.string().nullish(),
    for_students: z.array(z.object({ display_name: z.string() }).passthrough()).optional(),
  }).passthrough()),
}).passthrough()

export const eventSchema = z.object({
  id: z.number(),
  title: z.string().nullish(),
  author: authorSchema.nullish(),
  content: z.object({ raw: z.string().nullish(), html: z.string().nullish() }).passthrough().nullish(),
  subject: z.object({ title: z.string() }).passthrough().nullish(),
  files: z.array(fileSchema).optional(),
  /** Le jour où c'est à rendre. */
  date: z.string(),
  acks_count: z.number().optional(),
  acks_validated_count: z.number().optional(),
  /** L'enseignante a demandé que l'élève coche « fait » : elle voit qui l'a fait. */
  ack_needed: z.boolean().optional(),
  can_ack: z.boolean().optional(),
  has_acknowledged: z.boolean().optional(),
}).passthrough()
export type RawEvent = z.infer<typeof eventSchema>

export const eventsPageSchema = z.object({
  events: z.object({ current_page: z.number(), last_page: z.number(), data: z.array(eventSchema) }).passthrough(),
}).passthrough()

/** `acknowledge` rend l'entrée à jour : c'est elle qui dit l'état obtenu (la requête BASCULE). */
export const ackResponseSchema = z.object({ event: eventSchema }).passthrough()

export const transmissionSchema = z.object({
  id: z.number(),
  title: z.string().nullish(),
  created_date_detailed: detailedDateSchema,
  author: authorSchema.nullish(),
  content: z.object({ raw: z.string().nullish(), html: z.string().nullish() }).passthrough().nullish(),
  files: z.array(fileSchema).optional(),
  has_acknowledged: z.boolean().optional(),
  can_acknowledge: z.boolean().optional(),
  can_answer: z.boolean().optional(),
  responses_count: z.number().optional(),
}).passthrough()

export const transmissionsPageSchema = z.object({
  current_page: z.number(),
  last_page: z.number(),
  data: z.array(transmissionSchema),
}).passthrough()

/** Les publications mêlent les annonces (`post`) et des rappels générés (`reminder`) qu'on écarte. */
export const postsPageSchema = z.object({
  next_page: z.number().nullish(),
  data: z.array(z.object({ model: z.string(), id: z.number() }).passthrough()),
}).passthrough()

export const postSchema = z.object({
  model: z.literal('post'),
  id: z.number(),
  title: z.string().nullish(),
  activity_date_detailed: detailedDateSchema,
  author: authorSchema.nullish(),
  /** Du HTML léger. */
  content: z.string().nullish(),
  files: z.array(fileSchema).optional(),
  comments_count: z.number().optional(),
}).passthrough()

// ---- Ce que sert Kasbah -----------------------------------------------------------------------

export interface SchoolFile { type: string; url: string; thumb: string | null; name: string }

export interface SchoolJournal { id: string; name: string; years: string | null; students: string[] }

export interface SchoolHomework {
  id: number
  journalId: string
  /** Jour où c'est à rendre, `YYYY-MM-DD`. */
  date: string
  title: string | null
  subject: string | null
  author: string | null
  text: string
  /** Niveaux nommés dans le titre ou le texte (« pour les CE2 ») ; vide = toute la classe. */
  levels: string[]
  files: SchoolFile[]
  done: boolean
  /** La case est celle du SITE : l'enseignante voit qui a coché (`validated` sur `total`). */
  siteAck: { validated: number; total: number } | null
}

export interface SchoolMessage {
  id: number
  journalId: string
  /** Heure locale de publication, `YYYY-MM-DDTHH:mm`. */
  at: string
  title: string | null
  author: string | null
  text: string
  levels: string[]
  files: SchoolFile[]
  read: boolean
  responses: number
}

export interface SchoolPost {
  id: number
  journalId: string
  at: string
  title: string | null
  author: string | null
  text: string
  levels: string[]
  files: SchoolFile[]
  comments: number
}

// ---- Traductions ------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  janv: 1, janvier: 1, fevr: 2, fev: 2, fevrier: 2, mars: 3, avr: 4, avril: 4, mai: 5, juin: 6,
  juil: 7, juillet: 7, aout: 8, sept: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11,
  dec: 12, decembre: 12,
}
const pad = (v: string | number) => String(v).padStart(2, '0')

/** `{ day: "08", month: "Sept.", year: 2026, hours: "17", minutes: "09" }` → `2026-09-08T17:09`. */
export function detailedToLocal(d: z.infer<typeof detailedDateSchema>): string {
  const key = d.month.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').trim().toLowerCase()
  const month = MONTHS[key]
  if (!month) throw new Error(`unknown month "${d.month}"`)
  return `${d.year}-${pad(month)}-${pad(d.day)}T${pad(d.hours ?? 0)}:${pad(d.minutes ?? 0)}`
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Le HTML léger du site ramené à du texte : jamais injecté tel quel dans l'interface. */
export function htmlToText(html: string): string {
  return html
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const plain = (raw: string | null | undefined) => (raw ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()

/** Les niveaux de l'école élémentaire, tels que les enseignantes les écrivent (« ce1 », « CE2 : »). */
const LEVEL_RE = /\b(CP|CE1|CE2|CM1|CM2)\b/gi
export function levelsIn(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>()
  for (const t of texts) for (const m of (t ?? '').matchAll(LEVEL_RE)) found.add(m[1]!.toUpperCase())
  return [...found].sort()
}

function mapFiles(files: z.infer<typeof fileSchema>[] | undefined): SchoolFile[] {
  return (files ?? []).flatMap((f) => (f.src
    ? [{ type: f.type ?? 'document', url: f.src, thumb: f.src_mini ?? null, name: f.legend || `${f.type ?? 'fichier'}${f.extension ? `.${f.extension}` : ''}` }]
    : []))
}

export function mapJournals(raw: z.infer<typeof spacesSchema>): SchoolJournal[] {
  return raw.spaces
    .filter((s) => s.type === 1 && s.in_scope !== false && !s.deleted_at)
    .map((s) => ({ id: s.uuid, name: s.display_name, years: s.display_years ?? null, students: (s.for_students ?? []).map((st) => st.display_name) }))
}

export function mapHomework(e: RawEvent, journalId: string, localDone: boolean): SchoolHomework {
  const text = plain(e.content?.raw) || htmlToText(e.content?.html ?? '')
  const siteAck = e.ack_needed && e.can_ack ? { validated: e.acks_validated_count ?? 0, total: e.acks_count ?? 0 } : null
  return {
    id: e.id,
    journalId,
    date: e.date,
    title: e.title?.trim() || null,
    subject: e.subject?.title ?? null,
    author: e.author?.name ?? null,
    text,
    levels: levelsIn(e.title, text),
    files: mapFiles(e.files),
    done: siteAck ? e.has_acknowledged === true : localDone,
    siteAck,
  }
}

export function mapMessage(t: z.infer<typeof transmissionSchema>, journalId: string): SchoolMessage {
  const text = plain(t.content?.raw) || htmlToText(t.content?.html ?? '')
  return {
    id: t.id,
    journalId,
    at: detailedToLocal(t.created_date_detailed),
    title: t.title?.trim() || null,
    author: t.author?.name ?? null,
    text,
    levels: levelsIn(t.title, text),
    files: mapFiles(t.files),
    read: t.has_acknowledged === true,
    responses: t.responses_count ?? 0,
  }
}

export function mapPost(p: z.infer<typeof postSchema>, journalId: string): SchoolPost {
  const text = htmlToText(p.content ?? '')
  return {
    id: p.id,
    journalId,
    at: detailedToLocal(p.activity_date_detailed),
    title: p.title?.trim() || null,
    author: p.author?.name ?? null,
    text,
    levels: levelsIn(p.title, text),
    files: mapFiles(p.files),
    comments: p.comments_count ?? 0,
  }
}
