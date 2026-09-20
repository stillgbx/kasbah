import { Innertube } from 'youtubei.js'
import { bestThumb, mapPlaylist, mapPlaylists, mapTrack, mapTracks, type RawPlaylist, type RawTrack } from './mapping'
import type { YtmusicPlaylist, YtmusicTrack } from './types'

// Catalogue via youtubei.js `yt.music` (client InnerTube Music / WEB_REMIX).
// Pas de flux audio ici — c'est le rôle de yt-dlp + PO Token (`stream.ts`).

export type InnertubeLike = {
  music: {
    search(query: string, filters?: { type?: string }): Promise<{
      songs?: { contents?: unknown[] }
    }>
    getPlaylist(id: string): Promise<{
      items?: unknown[]
      contents?: unknown[]
    }>
    getLibrary(): Promise<{
      contents?: unknown[]
      applyFilter?(filter: string): Promise<{ contents?: unknown[] }>
    }>
  }
}

export type CreateSession = (cookie: string) => Promise<InnertubeLike>

const defaultCreate: CreateSession = async (cookie) =>
  Innertube.create({ cookie }) as unknown as InnertubeLike

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? v as Record<string, unknown> : null
}

function itemToRawTrack(item: unknown): RawTrack | null {
  const o = asRecord(item)
  if (!o) return null
  const id = typeof o.id === 'string' ? o.id : null
  const title = typeof o.title === 'string' ? o.title : null
  if (!id && !title) return null
  const artists = Array.isArray(o.artists)
    ? o.artists.map((a) => {
      const ar = asRecord(a)
      return typeof a === 'string' ? a : (typeof ar?.name === 'string' ? ar.name : null)
    })
    : []
  const duration = asRecord(o.duration)
  const thumbs = Array.isArray(o.thumbnails) ? o.thumbnails as Array<{ url?: string; width?: number }>
    : (asRecord(o.thumbnail)?.contents as Array<{ url?: string; width?: number }> | undefined)
  const album = asRecord(o.album)
  return {
    videoId: id,
    title,
    artists: artists.filter((a): a is string => !!a),
    artUrl: bestThumb(thumbs),
    durationS: typeof duration?.seconds === 'number' ? duration.seconds : null,
    album: typeof album?.name === 'string' ? album.name : null,
  }
}

function itemToRawPlaylist(item: unknown): RawPlaylist | null {
  const o = asRecord(item)
  if (!o) return null
  const id = typeof o.id === 'string' ? o.id
    : (typeof o.playlistId === 'string' ? o.playlistId : null)
  const title = typeof o.title === 'string' ? o.title
    : (typeof o.name === 'string' ? o.name : null)
  if (!id) return null
  const thumbs = Array.isArray(o.thumbnails) ? o.thumbnails as Array<{ url?: string; width?: number }> : undefined
  return {
    id,
    title,
    artUrl: bestThumb(thumbs),
    item_count: (o.item_count ?? o.song_count ?? o.trackCount) as string | number | null | undefined,
  }
}

function shelfItems(contents: unknown[] | undefined): unknown[] {
  if (!contents) return []
  const out: unknown[] = []
  for (const shelf of contents) {
    const s = asRecord(shelf)
    const items = s?.contents ?? s?.items
    if (Array.isArray(items)) out.push(...items)
    else out.push(shelf)
  }
  return out
}

export class YtmusicCatalog {
  private session: InnertubeLike | null = null
  private sessionCookie: string | null = null

  constructor(private readonly createSession: CreateSession = defaultCreate) {}

  /** Invalide la session (cookie changé / oublié). */
  reset(): void {
    this.session = null
    this.sessionCookie = null
  }

  private async ensure(cookie: string): Promise<InnertubeLike> {
    if (this.session && this.sessionCookie === cookie) return this.session
    this.session = await this.createSession(cookie)
    this.sessionCookie = cookie
    return this.session
  }

  async search(cookie: string, query: string): Promise<YtmusicTrack[]> {
    const yt = await this.ensure(cookie)
    const result = await yt.music.search(query, { type: 'song' })
    const raws = (result.songs?.contents ?? []).map(itemToRawTrack).filter((r): r is RawTrack => !!r)
    return mapTracks(raws)
  }

  /** Titres aimés : playlist système `LM` (Liked Music). */
  async liked(cookie: string): Promise<YtmusicTrack[]> {
    return this.playlistTracks(cookie, 'LM')
  }

  async playlists(cookie: string): Promise<YtmusicPlaylist[]> {
    const yt = await this.ensure(cookie)
    let lib = await yt.music.getLibrary()
    if (typeof lib.applyFilter === 'function') {
      try { lib = await lib.applyFilter('playlists') }
      catch { /* filtre absent : on lit le contenu tel quel */ }
    }
    const items = shelfItems(lib.contents)
    const raws = items.map(itemToRawPlaylist).filter((r): r is RawPlaylist => !!r)
    return mapPlaylists(raws)
  }

  async playlistTracks(cookie: string, playlistId: string): Promise<YtmusicTrack[]> {
    const yt = await this.ensure(cookie)
    const pl = await yt.music.getPlaylist(playlistId)
    const items = pl.items ?? pl.contents ?? []
    const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
    return mapTracks(raws)
  }
}

/** Export pour les tests de mapping depuis des items déjà aplatis. */
export { mapTrack, mapTracks, mapPlaylist, mapPlaylists }
