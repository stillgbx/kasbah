import type { MixcloudApi, MixcloudMix, MixcloudUser } from './api'

// The Mixcloud home view, the way the site does it, rebuilt from what the profile shows publicly (no
// sign-in): the listens tell who and which genre is listened to most. Seen on 2026-09-23 on the
// user's account: The Boat Pod and Worldwide FM on top, jazz and soul for the genres — exactly the
// site's "More from…" and "Popular … shows".

export type HomeSection =
  | { kind: 'users'; id: 'topCreators'; users: MixcloudUser[] }
  | { kind: 'mixes'; id: 'following' | 'listenAgain'; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'moreFrom'; user: MixcloudUser; items: MixcloudMix[] }
  | { kind: 'mixes'; id: 'popular'; genre: { slug: string; name: string }; items: MixcloudMix[] }

export interface HomeOptions {
  /** Creators shown at the top. */
  topCreators?: number
  /** Creators who each get their own "More from…" row. */
  moreFrom?: number
  /** Genres that get their "popular" row. */
  genres?: number
  /** Mixes per row. */
  perShelf?: number
}

/** Most frequent first; on a tie, the one seen first (the most recently listened). */
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

/** A genre that is only a creator's name (`worldwide-fm`) would duplicate that creator's row. */
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
  // As on the site: "your creators" are FOLLOWED accounts, ranked by listens — the public API also
  // returns those listened to without following them, we drop them here. Follows unreadable: we keep all.
  const followedNames = followed ? new Set(followed.map((u) => u.username.toLowerCase())) : null
  const listenedCreators = ranked(listens, (m) => m.user.username).filter((c) => c.value.user.username !== username)
  const creators = listenedCreators.filter((c) => !followedNames || followedNames.has(c.value.user.username.toLowerCase()))
  // all LISTENED creators, followed or not: a genre that is only the name of one of them is not a genre
  const creatorSlugs = new Set(listenedCreators.flatMap((c) => [slugOf(c.value.user.username), slugOf(c.value.user.name)]))
  const topGenres = ranked(listens.flatMap((m) => m.genres), (g) => g.slug)
    .filter((g) => !creatorSlugs.has(g.value.slug))
    .slice(0, genres)
    .map((g) => g.value)

  // the following calls are independent: in parallel, each one able to fail on its own
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback)
  const top = creators.slice(0, topCreators)
  // the row is filled up with your other follows, in your list's order: the ones you listen to first
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
