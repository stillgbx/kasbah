import type { MixcloudApi, MixcloudMix, MixcloudUser } from './api'

// L'accueil Mixcloud, à la façon du site, recomposé à partir de ce que le profil montre publiquement
// (aucune connexion) : les écoutes disent qui et quel genre on écoute le plus. Vu le 2026-09-23 sur
// le compte de l'utilisateur : The Boat Pod et Worldwide FM en tête, jazz et soul pour les genres —
// exactement les « More from… » et « Popular … shows » du site.

export type HomeSection =
  | { kind: 'users'; id: 'topCreators'; users: MixcloudUser[] }
  | { kind: 'mixes'; id: 'following' | 'listenAgain'; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'moreFrom'; user: MixcloudUser; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'popular'; genre: { slug: string; name: string }; items: MixcloudMix[] }

export interface HomeOptions {
  /** Créateurs montrés en tête. */
  topCreators?: number
  /** Créateurs qui ont chacun leur rangée « Plus de… ». */
  moreFrom?: number
  /** Genres qui ont leur rangée « populaires ». */
  genres?: number
  /** Mix par rangée. */
  perShelf?: number
}

/** Les plus fréquents d'abord ; à égalité, celui vu en premier (le plus récemment écouté). */
function ranked<T>(values: T[], key: (v: T) => string): { value: T; n: number }[] {
  const seen = new Map<string, { value: T; n: number; first: number }>()
  values.forEach((v, i) => {
    const k = key(v)
    const hit = seen.get(k)
    if (hit) hit.n++
    else seen.set(k, { value: v, n: 1, first: i })
  })
  return [...seen.values()].sort((a, b) => b.n - a.n || a.first - b.first)
}

/** Un genre qui n'est que le nom d'un créateur (`worldwide-fm`) ferait double emploi avec sa rangée. */
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export async function buildHome(
  api: MixcloudApi,
  username: string,
  following: () => Promise<MixcloudMix[]>,
  opts: HomeOptions = {},
): Promise<HomeSection[]> {
  const { topCreators = 10, moreFrom = 3, genres = 3, perShelf = 20 } = opts
  const [listens, followed] = await Promise.all([
    api.listens(username, undefined, 100).then((p) => p.items),
    api.following(username).catch(() => null),
  ])
  // Comme sur le site : « tes créateurs » sont des comptes SUIVIS, classés par écoutes — l'API publique
  // rend aussi ceux qu'on a écoutés sans les suivre, on les écarte ici. Suivis illisibles : on garde tout.
  const followedNames = followed ? new Set(followed.map((u) => u.username.toLowerCase())) : null
  const listenedCreators = ranked(listens, (m) => m.user.username).filter((c) => c.value.user.username !== username)
  const creators = listenedCreators.filter((c) => !followedNames || followedNames.has(c.value.user.username.toLowerCase()))
  // tous les créateurs ÉCOUTÉS, suivis ou non : un genre qui n'est que le nom de l'un d'eux n'est pas un genre
  const creatorSlugs = new Set(listenedCreators.flatMap((c) => [slugOf(c.value.user.username), slugOf(c.value.user.name)]))
  const topGenres = ranked(listens.flatMap((m) => m.genres), (g) => g.slug)
    .filter((g) => !creatorSlugs.has(g.value.slug))
    .slice(0, genres)
    .map((g) => g.value)

  // les appels suivants sont indépendants : en parallèle, chacun pouvant échouer seul
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback)
  const top = creators.slice(0, topCreators)
  // la rangée se complète de tes autres suivis, dans l'ordre de ta liste : ceux que tu écoutes d'abord
  const listened = new Set(top.map((c) => c.value.user.username.toLowerCase()))
  const others = (followed ?? []).filter((u) => !listened.has(u.username.toLowerCase())).slice(0, Math.max(0, topCreators - top.length))
  const [users, feed, more, popular] = await Promise.all([
    Promise.all(top.map((c) => safe(api.user(c.value.user.username), null))),
    safe(following(), [] as MixcloudMix[]),
    Promise.all(top.slice(0, moreFrom).map((c) => safe(api.cloudcasts(c.value.user.username), { items: [], next: null }))),
    Promise.all(topGenres.map((g) => safe(api.popular(g.slug), { items: [], next: null }))),
  ])

  const listenAgain: MixcloudMix[] = []
  const keys = new Set<string>()
  for (const m of listens) if (!keys.has(m.key)) { keys.add(m.key); listenAgain.push(m) }

  const sections: HomeSection[] = []
  const creatorUsers = users.flatMap((u, i) => u ? [u] : [{ username: top[i]!.value.user.username, name: top[i]!.value.user.name, artUrl: null }])
  if (creatorUsers.length + others.length) sections.push({ kind: 'users', id: 'topCreators', users: [...creatorUsers, ...others] })
  if (feed.length) sections.push({ kind: 'mixes', id: 'following', items: feed.slice(0, perShelf) })
  if (listenAgain.length) sections.push({ kind: 'mixes', id: 'listenAgain', items: listenAgain.slice(0, perShelf) })
  more.forEach((page, i) => {
    if (page.items.length) sections.push({ kind: 'mixes', id: 'moreFrom', user: creatorUsers[i]!, items: page.items.slice(0, perShelf) })
  })
  popular.forEach((page, i) => {
    if (page.items.length) sections.push({ kind: 'mixes', id: 'popular', genre: topGenres[i]!, items: page.items.slice(0, perShelf) })
  })
  return sections
}
