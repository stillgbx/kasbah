<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { YtmusicAlbum, YtmusicExploreShelf, YtmusicPlaylist, YtmusicTrack } from '../../api/transport'
import MusicTile from './MusicTile.vue'

// Rows of tiles from a YouTube Music page (a genre or mood category, the new releases):
// playable tracks (the row becomes the queue), playlists and albums that open or play with one
// gesture. A row without a title (the grid of featured playlists in the new releases) takes the
// name of what it contains. `grid`: the tiles wrap instead of scrolling (the new releases).
defineProps<{
  shelves: YtmusicExploreShelf[]
  playTarget: boolean
  /** Track being sent. */
  playingId: string | null
  /** Playlist or album being sent. */
  playingCollection: string | null
  /** Tiles in a grid (wrapping) rather than in a scrolling row. */
  grid?: boolean
}>()
defineEmits<{
  playTrack: [track: YtmusicTrack, list: YtmusicTrack[]]
  openPlaylist: [pl: YtmusicPlaylist]
  playPlaylist: [pl: YtmusicPlaylist]
  openAlbum: [al: YtmusicAlbum]
  playAlbum: [al: YtmusicAlbum]
}>()
const { t } = useI18n()

const trackMeta = (tr: YtmusicTrack) => [tr.artists.join(', '), tr.album].filter(Boolean).join(' · ')
const albumMeta = (al: YtmusicAlbum) => [al.artists.join(', '), al.year].filter(Boolean).join(' · ')
function shelfTitle(sh: YtmusicExploreShelf): string {
  if (sh.title) return sh.title
  if (sh.playlists.length) return t('music.browsePlaylists')
  if (sh.albums.length) return t('ytmusic.sectionAlbums')
  return t('ytmusic.sectionTracks')
}
</script>

<template>
  <section v-for="(sh, si) in shelves" :key="`${si}:${sh.title}`" class="shelf">
    <div class="shelf__head"><h2 class="section-label">{{ shelfTitle(sh) }}</h2></div>
    <div class="shelf__row" :class="{ 'shelf__row--grid': grid }">
      <MusicTile v-for="tr in sh.tracks" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit" :meta="trackMeta(tr)"
                 :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="$emit('playTrack', tr, sh.tracks)" />
      <MusicTile v-for="pl in sh.playlists" :key="pl.id" action="open" playable icon="list" :art="pl.artUrl" :title="pl.title"
                 :meta="pl.trackCount != null ? $t('ytmusic.tracks', { n: pl.trackCount }, pl.trackCount) : ''"
                 :disabled="!playTarget" :busy="playingCollection === pl.id" :play-label="$t('music.playAll')"
                 @open="$emit('openPlaylist', pl)" @play="$emit('playPlaylist', pl)" />
      <MusicTile v-for="al in sh.albums" :key="al.id" action="open" playable icon="disc" :art="al.artUrl" :title="al.title" :explicit="!!al.explicit"
                 :meta="albumMeta(al)" :disabled="!playTarget" :busy="playingCollection === al.id" :play-label="$t('music.playAll')"
                 @open="$emit('openAlbum', al)" @play="$emit('playAlbum', al)" />
    </div>
  </section>
</template>

<style scoped>
.shelf { margin: 4px 0 18px; }
.shelf__head { display: flex; align-items: baseline; justify-content: space-between; margin: 0 4px 8px; }
.section-label { margin: 0 4px; }
.shelf__row { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x proximity; padding: 2px 4px 8px; }
/* grid: same tile width (128 px), as many columns as the width holds, left-aligned */
.shelf__row--grid { display: grid; grid-template-columns: repeat(auto-fill, 128px); gap: 18px 14px; overflow: visible; scroll-snap-type: none; }
.shelf__row::-webkit-scrollbar { height: 6px; }
.shelf__row::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }
</style>
