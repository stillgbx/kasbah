import type { YtmusicExplore, YtmusicExploreCategory } from './types'

// YouTube Music's "Moods & genres". youtubei.js has no method for this page, and its parser throws
// away the buttons' color: so we read the RAW InnerTube JSON of `browse FEmusic_moods_and_genres`
// (grids of `musicNavigationButtonRenderer`). A category's page, on the other hand, is parsed by
// youtubei.js (`parse: true`): its rows are made of the same nodes as search, which the catalog
// already knows how to convert.

type Json = Record<string, unknown>
const rec = (v: unknown): Json | null => (v && typeof v === 'object' ? v as Json : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const runsText = (v: unknown): string => list(rec(v)?.runs).map((r) => rec(r)?.text).filter((t): t is string => typeof t === 'string').join('')

/** `leftStripeColor` is an ARGB integer (e.g. 4293020416): we keep the RGB. */
export function argbToHex(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return `#${((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`
}

function categoryOf(item: unknown): YtmusicExploreCategory | null {
  const b = rec(rec(item)?.musicNavigationButtonRenderer)
  if (!b) return null
  const title = runsText(b.buttonText).trim()
  const params = rec(rec(b.clickCommand)?.browseEndpoint)?.params
  if (!title || typeof params !== 'string' || !params) return null
  return { title, params, color: argbToHex(rec(b.solid)?.leftStripeColor) }
}

/**
 * The page's grids, in order: the personalized one ("For you", sometimes absent), the moods, the
 * genres. Their titles are localized, they cannot be relied on: it is the POSITION that decides —
 * the last grid is the genres', the one before last the moods', everything before belongs to the
 * user.
 */
export function parseMoodsPage(raw: unknown): YtmusicExplore {
  const tabs = list(rec(rec(rec(raw)?.contents)?.singleColumnBrowseResultsRenderer)?.tabs)
  const sections = list(rec(rec(rec(rec(rec(tabs[0])?.tabRenderer)?.content)?.sectionListRenderer))?.contents)
  const grids = sections
    .map((s) => rec(rec(s)?.gridRenderer))
    .filter((g): g is Json => !!g)
    .map((g) => ({
      title: runsText(rec(rec(g.header)?.gridHeaderRenderer)?.title).trim(),
      categories: list(g.items).map(categoryOf).filter((c): c is YtmusicExploreCategory => !!c),
    }))
    .filter((g) => g.categories.length > 0)
  const empty = { title: '', categories: [] }
  const genres = grids.at(-1) ?? empty
  const moods = grids.length >= 2 ? grids.at(-2)! : empty
  const mine = grids.slice(0, Math.max(0, grids.length - 2))
  return {
    forYou: { title: mine[0]?.title ?? '', categories: mine.flatMap((g) => g.categories) },
    moods,
    genres,
  }
}

/**
 * The rows (`MusicCarouselShelf`, and the `Grid` grids) of a page parsed by youtubei.js, in order, wherever they
 * are in the tree: we do not depend on the wrapping (tabs, section list), which varies.
 */
export function carouselsOf(parsed: unknown): Array<{ title: string; items: unknown[] }> {
  const shelf = (o: Json) => {
    const title = rec(rec(o.header)?.title)?.text
    // a row keeps its items in `contents`, a grid in `items`
    return { title: typeof title === 'string' ? title : '', items: [...list(o.contents), ...list(o.items)] }
  }
  // A real parsed response wraps `contents` in an object whose keys cannot be walked, but
  // youtubei.js indexes each node type in `contents_memo`, in page order: that is where we take
  // them. Walking the tree is only a fallback (simplified responses, tests).
  // The GRIDS (`Grid`) too: the new releases page puts its flagship playlists first, in a grid
  // ("RELEASED"…) — placed first, as on YouTube's page.
  const memo = rec(parsed)?.contents_memo
  if (memo instanceof Map && (memo.has('MusicCarouselShelf') || memo.has('Grid'))) {
    const of = (type: string) => list(memo.get(type)).map(rec).filter((o): o is Json => !!o).map(shelf)
    return [...of('Grid'), ...of('MusicCarouselShelf')]
  }
  const out: Array<{ title: string; items: unknown[] }> = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 12) return
    seen.add(v)
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    const o = v as Json
    if (o.type === 'MusicCarouselShelf' || o.type === 'Grid') { out.push(shelf(o)); return }
    for (const k of ['contents', 'content', 'tabs']) walk(o[k], depth + 1)
  }
  walk(rec(parsed)?.contents, 0)
  return out
}
