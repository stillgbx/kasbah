import type { YtmusicExplore, YtmusicExploreCategory } from './types'

// « Humeurs et genres » de YouTube Music. youtubei.js n'a pas de méthode pour cette page, et son
// analyseur jette la couleur des boutons : on lit donc le JSON InnerTube BRUT de
// `browse FEmusic_moods_and_genres` (des grilles de `musicNavigationButtonRenderer`). La page d'une
// catégorie, elle, est analysée par youtubei.js (`parse: true`) : ses rangées sont faites des mêmes
// nœuds que la recherche, que le catalogue sait déjà convertir.

type Json = Record<string, unknown>
const rec = (v: unknown): Json | null => (v && typeof v === 'object' ? v as Json : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const runsText = (v: unknown): string => list(rec(v)?.runs).map((r) => rec(r)?.text).filter((t): t is string => typeof t === 'string').join('')

/** `leftStripeColor` est un entier ARGB (ex. 4293020416) : on garde le RVB. */
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
 * Les grilles de la page, dans l'ordre : la personnalisée (« Pour vous », parfois absente), les
 * ambiances, les genres. Leurs titres sont localisés, on ne peut pas s'y fier : c'est la POSITION qui
 * décide — la dernière grille est celle des genres, l'avant-dernière celle des ambiances, tout ce
 * qui précède est à l'utilisateur.
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
 * Les rangées (`MusicCarouselShelf`) d'une page analysée par youtubei.js, dans l'ordre, où qu'elles
 * soient dans l'arbre : on ne dépend pas de l'emballage (onglets, liste de sections) qui varie.
 */
export function carouselsOf(parsed: unknown): Array<{ title: string; items: unknown[] }> {
  const shelf = (o: Json) => {
    const title = rec(rec(o.header)?.title)?.text
    return { title: typeof title === 'string' ? title : '', items: [...list(o.contents)] }
  }
  // Une vraie réponse analysée enveloppe `contents` dans un objet aux clés non parcourables, mais
  // youtubei.js indexe chaque type de nœud dans `contents_memo`, dans l'ordre de la page : c'est là
  // qu'on les prend. Le parcours de l'arbre ne sert qu'en repli (réponses simplifiées, tests).
  const memo = rec(parsed)?.contents_memo
  if (memo instanceof Map && memo.has('MusicCarouselShelf')) {
    return list(memo.get('MusicCarouselShelf')).map(rec).filter((o): o is Json => !!o).map(shelf)
  }
  const out: Array<{ title: string; items: unknown[] }> = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 12) return
    seen.add(v)
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    const o = v as Json
    if (o.type === 'MusicCarouselShelf') { out.push(shelf(o)); return }
    for (const k of ['contents', 'content', 'tabs']) walk(o[k], depth + 1)
  }
  walk(rec(parsed)?.contents, 0)
  return out
}
