<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEntry, MediaPlayerClass, StateFor } from '@kasbah/shared'
import { deviceIcon } from '../../lib/deviceIcons'
import { isMediaActive } from '../../lib/deviceState'
import { useHouseStore } from '../../stores/house'
import ExplicitBadge from '../ui/ExplicitBadge.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import PulseDot from '../ui/PulseDot.vue'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau « Écoute » : un lecteur = une session. La ligne choisie est celle que pilote la barre du
// bas et où partent les lectures ; toucher une autre ligne change de session (le salon, la suite…).
// En mode transfert, la même liste sert à choisir la CIBLE : les lignes qui savent recevoir un
// flux (`play_url`) montrent « Ici », la source reste visible mais grisée ; on en sort par le bouton
// de la barre (Transférer devenu Annuler).
//
// Ordre : les FAVORIS d'abord (étoile, mémorisée sur la tablette), puis les autres, chaque groupe
// par ordre alphabétique — la pièce n'est qu'une légende. Un filtre segmenté en tête restreint aux
// enceintes, téléviseurs ou écrans (`meta.mediaPlayer.deviceClass`), comme les filtres de pièce.
// À droite de chaque ligne, trois touches de largeur fixe : lecture / pause du lecteur (invisible s'il
// n'a rien de chargé, l'emplacement reste), « voir dans la maison » (la scène 3D, lecteur sélectionné) et l'étoile ; en
// mode transfert, « Ici » prend la place des deux premières. Une ligne qui joue
// porte sa pochette en fond, fondue vers la droite, comme les lignes de la vue Médias ; un titre
// trop long défile avec un fondu (MarqueeText) au lieu d'être coupé.
const props = defineProps<{
  players: DeviceEntry[]
  selectedId: string | null
  transferMode: boolean
  /** Lecteur vers lequel un transfert est en cours (bouton occupé). */
  transferBusyId: string | null
  /** Lecteur qui reçoit un titre en cours d'envoi (résolution du flux) : sablier sur sa ligne. */
  pendingId: string | null
}>()
const emit = defineEmits<{ select: [id: string]; transferTo: [id: string]; command: [id: string, cmd: CommandInput]; locate: [id: string] }>()
const { t } = useI18n()
const house = useHouseStore()

type Filter = 'all' | MediaPlayerClass
const filter = useLocalStorage<Filter>('kasbah.music.sessionsFilter', 'all')
const favorites = useLocalStorage<string[]>('kasbah.music.favoriteSessions', [])
const isFavorite = (id: string) => favorites.value.includes(id)
function toggleFavorite(id: string) {
  favorites.value = isFavorite(id) ? favorites.value.filter((x) => x !== id) : [...favorites.value, id]
}
const classOf = (e: DeviceEntry): MediaPlayerClass => e.descriptor.meta.mediaPlayer?.deviceClass ?? 'speaker'

const filterOptions = computed(() => {
  const present = new Set(props.players.map(classOf))
  return [
    { value: 'all' as const, label: t('common.all') },
    { value: 'speaker' as const, label: t('media.classes.speaker'), icon: 'speaker' as const, disabled: !present.has('speaker') },
    { value: 'tv' as const, label: t('media.classes.tv'), icon: 'tv' as const, disabled: !present.has('tv') },
    { value: 'display' as const, label: t('media.classes.display'), icon: 'cast' as const, disabled: !present.has('display') },
  ]
})

interface Row {
  entry: DeviceEntry; id: string; name: string; room: string; status: string; active: boolean; target: boolean; art: string | null; favorite: boolean
  /** Ce qu'on entend sur cette ligne (une barre de son relaie sa TV) : c'est lui que lecture / pause commande. */
  heardId: string; heardPlayback: StateFor<'media_player'>['playback']
  /** Morceau signalé explicit par le service qui l'a lancé. */
  explicit: boolean
}
interface Group { key: 'favorites' | 'others'; title: string; rows: Row[] }

const rows = computed<Row[]>(() => {
  const idx = house.index
  return props.players
    .filter((e) => filter.value === 'all' || classOf(e) === filter.value)
    .map((e) => {
      const hd = idx?.devicesByBinding.get(e.descriptor.id)
      const room = hd?.roomId ? idx?.roomsById.get(hd.roomId) : undefined
      const s = e.state as StateFor<'media_player'>
      const relay = house.relaySource(e.descriptor.id)
      const heard = relay && relay.state.kind === 'media_player' ? relay.state : s
      const n = heard.nowPlaying
      // un identifiant de flux ou une URL n'est ni un titre ni une source lisible (Sonos, serveur redémarré)
      const readable = (v: string | undefined) => (v && !/^([0-9a-f]{24}|https?:\/\/.*)$/i.test(v.trim()) ? v : undefined)
      const title = readable(n?.title)
      const source = readable(n?.source)
      const status = !s.available ? t('common.unavailable')
        : title ? [title, n?.artist].filter(Boolean).join(' — ')
        : source ? source
        : t(`media.${s.playback}`)
      const active = s.available && (isMediaActive(s) || !!relay)
      return {
        heardId: relay && relay.state.kind === 'media_player' ? relay.descriptor.id : e.descriptor.id,
        heardPlayback: heard.playback,
        entry: e,
        id: e.descriptor.id,
        name: hd?.name ?? e.descriptor.name,
        room: room?.name ?? e.descriptor.meta.room ?? '',
        status,
        active,
        target: s.available && e.descriptor.capabilities.includes('play_url'),
        art: active && n?.artUrl ? n.artUrl : null,
        explicit: active && n?.explicit === true,
        favorite: isFavorite(e.descriptor.id),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
})
/** Deux groupes, favoris au-dessus ; sans favori, une seule liste sans titre. */
const groups = computed<Group[]>(() => {
  const fav = rows.value.filter((r) => r.favorite)
  const rest = rows.value.filter((r) => !r.favorite)
  if (!fav.length) return [{ key: 'others', title: '', rows: rest }]
  return [
    { key: 'favorites', title: t('music.favorites'), rows: fav },
    ...(rest.length ? [{ key: 'others' as const, title: t('music.otherPlayers'), rows: rest }] : []),
  ]
})

const loaded = (r: Row) => r.entry.state.available && (r.heardPlayback === 'playing' || r.heardPlayback === 'paused')
function togglePlayback(r: Row) {
  emit('command', r.heardId, { type: r.heardPlayback === 'playing' ? 'media_player.pause' : 'media_player.play' })
}
function rowDisabled(r: Row): boolean {
  return props.transferMode ? (r.id === props.selectedId || !r.target || !!props.transferBusyId) : !r.entry.state.available
}
function tap(r: Row) {
  if (props.transferMode) emit('transferTo', r.id)
  else emit('select', r.id)
}
</script>

<template>
  <aside class="sessions card">
    <!-- l'explication ne s'affiche qu'à la demande : infobulle sur le point d'information -->
    <div class="sessions__head">
      <div class="sessions__title">{{ transferMode ? $t('music.transferTo') : $t('music.sessions') }}</div>
      <span class="sessions__info muted" :title="transferMode ? $t('music.transferHint') : $t('music.sessionsHint')" tabindex="0">
        <StrokeIcon name="info" :size="16" />
      </span>
    </div>
    <div class="sessions__filter">
      <Segmented v-model="filter" dense fill :options="filterOptions" :label="$t('music.filterPlayers')" />
    </div>
    <div class="sessions__scroll">
      <p v-if="rows.length === 0" class="muted empty">{{ $t('music.noSession') }}</p>
      <!-- de vrais éléments par groupe : l'ordre favoris → autres ne dépend pas d'un fragment clé -->
      <section v-for="g in groups" :key="g.key" class="group">
        <div v-if="g.title" class="section-label group-title">{{ g.title }}</div>
        <div v-for="r in g.rows" :key="r.id" class="row"
             :data-selected="r.id === selectedId ? '1' : '0'"
             :data-dim="transferMode && (r.id === selectedId || !r.target) ? '1' : '0'">
          <Transition name="rowart">
            <span v-if="r.art" :key="r.art" class="row-art" :style="{ backgroundImage: `url(${JSON.stringify(r.art)})` }" aria-hidden="true" />
          </Transition>
          <button type="button" class="row__main" :disabled="rowDisabled(r)" @click="tap(r)">
            <span class="icon-square" :data-on="r.active ? '1' : '0'">
              <StrokeIcon :name="deviceIcon(r.entry.descriptor, r.entry.state)" :size="18" />
            </span>
            <span class="min0 lines">
              <span class="line1">
                <MarqueeText class="name" :text="r.name" />
                <PulseDot :on="r.active" class="dot" />
              </span>
              <span class="line2 muted">
                <span v-if="r.room" class="room">{{ r.room }}</span>
                <span v-if="r.room" class="sep">·</span>
                <ExplicitBadge v-if="r.explicit" class="row-explicit" />
                <MarqueeText class="status" :text="r.status" />
              </span>
            </span>
          </button>
          <!-- touches à part : un bouton dans un bouton n'existe pas -->
          <span v-if="transferMode" class="trail trail--wide">
            <v-progress-circular v-if="transferBusyId === r.id" indeterminate :size="18" :width="2" color="primary" />
            <span v-else-if="r.target && r.id !== selectedId" class="pill pill--here" data-on="1">{{ $t('music.transferHere') }}</span>
          </span>
          <template v-else>
            <!-- pendant l'envoi d'un titre à ce lecteur, la touche lecture / pause laisse place au sablier ;
                 rien de chargé : la touche disparaît mais garde sa place, les voisines ne bougent pas -->
            <span v-if="pendingId === r.id" class="key" aria-busy="true">
              <v-progress-circular indeterminate :size="18" :width="2" color="primary" />
            </span>
            <button v-else type="button" class="key" :class="{ 'is-hidden': !loaded(r) }" :disabled="!loaded(r)" :tabindex="loaded(r) ? 0 : -1"
                    :title="r.heardPlayback === 'playing' ? $t('common.pause') : $t('media.play')" :aria-label="r.heardPlayback === 'playing' ? $t('common.pause') : $t('media.play')"
                    @click.stop="togglePlayback(r)">
              <StrokeIcon :name="r.heardPlayback === 'playing' ? 'pause' : 'play'" :size="16" />
            </button>
            <button type="button" class="key" :title="$t('music.locate')" :aria-label="$t('music.locate')" @click.stop="emit('locate', r.id)">
              <StrokeIcon name="pin" :size="16" />
            </button>
          </template>
          <button type="button" class="key star" :data-on="r.favorite ? '1' : '0'"
                  :title="r.favorite ? $t('music.favoriteRemove') : $t('music.favoriteAdd')" :aria-label="r.favorite ? $t('music.favoriteRemove') : $t('music.favoriteAdd')"
                  :aria-pressed="r.favorite ? 'true' : 'false'" @click.stop="toggleFavorite(r.id)">
            <StrokeIcon name="star" :size="16" />
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sessions { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
/* en-tête de hauteur fixe : le titre, et un point d'information qui porte l'explication en infobulle */
.sessions__head { display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 16px; flex: 0 0 auto; }
.sessions__title { font-size: 14px; font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sessions__info { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 999px; cursor: help; flex: 0 0 auto; }
.sessions__info:hover, .sessions__info:focus-visible { color: var(--text); background: var(--surface2); outline: 0; }
.sessions__filter { padding: 0 12px 10px; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.is-hidden { visibility: hidden; }
.sessions__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 8px calc(var(--safe-bottom) + 8px); }
.group-title { padding: 10px 8px 4px; }
.row {
  position: relative; isolation: isolate; overflow: hidden;
  display: flex; align-items: center; width: 100%; height: 60px;
  border-radius: var(--radius-sm); transition: background .15s;
}
.row:hover { background: var(--surface2); }
.row[data-selected='1'] { background: var(--accent-soft); }
.row[data-dim='1'] .row__main { opacity: .45; }
.row__main {
  flex: 1 1 auto; min-width: 0; height: 100%; display: flex; align-items: center; gap: 12px; padding: 0 0 0 8px;
  border: 0; background: transparent; color: inherit; text-align: left; font: inherit;
}
.row__main:disabled { cursor: default; }
/* pochette derrière la ligne : sous l'icône et le nom, fondue avant la colonne de droite */
.row-art {
  position: absolute; inset: 0; z-index: -1; pointer-events: none; display: block;
  background-size: cover; background-position: center; opacity: .22;
  mask-image: linear-gradient(90deg, #000 0, #000 30%, transparent 75%);
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 30%, transparent 75%);
}
.rowart-enter-active, .rowart-leave-active { transition: opacity .6s ease; }
.rowart-enter-from, .rowart-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .rowart-enter-active, .rowart-leave-active { transition: none; } }
.min0 { min-width: 0; }
.lines { flex: 1 1 0; display: grid; gap: 2px; }
.line1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name { min-width: 0; flex: 1 1 auto; font-size: 14px; font-weight: 500; }
.dot { color: var(--accent); flex: 0 0 auto; }
.row-explicit { transform: scale(0.85); }
.line2 { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 12px; }
.room { flex: 0 0 auto; white-space: nowrap; }
.sep { flex: 0 0 auto; }
.status { min-width: 0; flex: 1 1 auto; }
/* en mode transfert, « Ici » occupe la largeur des deux touches qu'il remplace : rien ne bouge */
.trail { flex: 0 0 auto; width: 36px; display: grid; place-items: center; }
.trail--wide { width: 72px; }
.pill--here { height: 30px; padding: 0 10px; font-size: 12.5px; }
/* touches de ligne : même empreinte, discrètes tant qu'elles ne sont pas allumées */
.key {
  flex: 0 0 auto; display: grid; place-items: center; width: 36px; height: 60px; padding: 0;
  border: 0; background: transparent; color: var(--muted);
}
.key:hover:not(:disabled) { color: var(--accent); }
.key:disabled { opacity: .3; cursor: default; }
.star { margin-right: 2px; color: color-mix(in srgb, var(--muted) 55%, transparent); }
.star:hover { color: var(--text); }
.star[data-on='1'] { color: var(--accent); }
.star[data-on='1'] :deep(svg) { fill: currentColor; }
.empty { padding: 16px 8px; }
</style>
