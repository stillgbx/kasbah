<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AutomationRow from '../components/automations/AutomationRow.vue'
import PageHeader from '../components/layout/PageHeader.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useAutomationNames } from '../composables/useAutomationNames'
import { describeAutomation, involvedDeviceIds, involvedRoomIds } from '../lib/automations'
import { MIN_QUERY } from '../composables/useSearch'
import { normalize, queryTerms, scoreQuery } from '../lib/search'
import { useAutomationsStore } from '../stores/automations'

// Automatisations de la maison : la liste (recherche, filtre, ordre rangé à la main). Toucher une ligne
// ouvre sa page d'édition (`AutomationEditView`) : une règle qui accumule des exceptions et des
// actions ne tient pas dans un panneau de 340 px.
const store = useAutomationsStore()
const { names } = useAutomationNames()
const { t, locale } = useI18n()
const router = useRouter()
/** Téléphone : les compteurs se taisent, le bouton de création perd son texte, le filtre prend la largeur. */
const narrow = useMediaQuery('(max-width: 600px)')

type Filter = 'all' | 'enabled' | 'disabled' | 'check'
const filter = ref<Filter>('all')
const query = ref('')

// « il y a 3 h » se tient à jour sans relire le serveur
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  if (!store.list.length) void store.load()
  tick = setInterval(() => { now.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => { if (tick) clearInterval(tick) })

const counts = computed(() => ({
  enabled: store.list.filter((e) => e.automation.enabled).length,
  check: store.list.filter((e) => e.status.health !== 'ok').length,
}))

const filterOptions = computed(() => [
  { value: 'all' as const, label: t('automations.filters.all') },
  { value: 'enabled' as const, label: t('automations.filters.enabled') },
  { value: 'disabled' as const, label: t('automations.filters.disabled') },
  { value: 'check' as const, label: t('automations.filters.check') },
])

/** Ce que la recherche lit : le nom, la phrase, les appareils et les pièces nommés. */
function haystack(e: (typeof store.list)[number]): string {
  const a = e.automation
  return normalize([
    a.name,
    describeAutomation(a, names, t, locale.value),
    ...involvedDeviceIds(a).map(names.deviceName),
    ...involvedRoomIds(a).map(names.roomName),
  ].join(' '))
}

const shown = computed(() => {
  const terms = query.value.trim().length >= MIN_QUERY ? queryTerms(query.value) : []
  return store.list.filter((e) => {
    if (filter.value === 'enabled' && !e.automation.enabled) return false
    if (filter.value === 'disabled' && e.automation.enabled) return false
    if (filter.value === 'check' && e.status.health === 'ok') return false
    return !terms.length || scoreQuery(haystack(e), terms) !== null
  })
})

// ---- ranger la liste -------------------------------------------------------------------------
// Le glissement part de la POIGNÉE (la ligne ouvre l'éditeur, l'interrupteur bascule) ; la liste se
// réorganise sous le doigt, l'ordre part au relâchement. Filtrée, seules les lignes affichées
// échangent leurs places : les autres gardent les leurs dans le fichier.
const drag = ref<{ id: string; ids: string[]; from: string[] } | null>(null)
const rows = computed(() => {
  const ids = drag.value?.ids
  return ids ? [...shown.value].sort((a, b) => ids.indexOf(a.automation.id) - ids.indexOf(b.automation.id)) : shown.value
})

function startDrag(ev: PointerEvent, id: string) {
  ev.preventDefault()
  const ids = shown.value.map((e) => e.automation.id)
  drag.value = { id, ids, from: ids }
  // sur la FENÊTRE : Vue déplace la ligne (donc la poignée) à chaque échange, ce qui relâche la capture
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}
function moveDrag(ev: PointerEvent) {
  const d = drag.value
  if (!d) return
  const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-automation]')?.dataset.automation
  const from = d.ids.indexOf(d.id)
  const to = over ? d.ids.indexOf(over) : -1
  if (to < 0 || to === from) return
  const ids = [...d.ids]
  ids.splice(from, 1)
  ids.splice(to, 0, d.id)
  drag.value = { ...d, ids }
}
function endDrag() {
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  const d = drag.value
  drag.value = null
  if (!d || d.ids.join() === d.from.join()) return
  const moved = new Set(d.ids)
  let k = 0
  void store.reorder(store.list.map((e) => (moved.has(e.automation.id) ? d.ids[k++]! : e.automation.id)))
}
onBeforeUnmount(endDrag)   // quitter la vue en plein glissement ne doit pas laisser d'écouteurs

const open = (id: string) => router.push({ name: 'automation-edit', params: { id } })
const create = () => open('new')
</script>

<template>
  <div class="page">
    <PageHeader>
      <div class="head">
        <span class="muted count">{{ $t('automations.count', counts.enabled) }}</span>
        <!-- toujours affiché, estompé à 0 : le compteur ne saute pas d'apparence -->
        <span class="muted count count--check" :data-zero="counts.check === 0 ? '1' : '0'">{{ $t('automations.checkCount', counts.check) }}</span>
        <button type="button" class="pill" data-on="1" :aria-label="$t('automations.new')" :title="$t('automations.new')" @click="create">
          <StrokeIcon name="plus" :size="16" /><span class="head__new">{{ $t('automations.new') }}</span>
        </button>
      </div>
    </PageHeader>

    <div class="tools">
      <div class="search">
        <StrokeIcon name="search" :size="16" class="search__icon" />
        <input v-model="query" type="search" class="search__input" :placeholder="$t('automations.searchPlaceholder')" :aria-label="$t('automations.search')">
        <button type="button" class="search__clear" :class="{ 'is-hidden': !query }" :aria-label="$t('automations.clearSearch')" @click="query = ''">
          <StrokeIcon name="close" :size="14" />
        </button>
      </div>
      <Segmented v-model="filter" dense :fill="narrow" class="tools__filter" :options="filterOptions" :label="$t('automations.filters.label')" />
    </div>

    <div class="page__scroll">
      <div v-if="!shown.length" class="card card--soft empty muted">{{ store.list.length ? $t('automations.noMatch') : $t('automations.none') }}</div>
      <div class="rows">
        <AutomationRow v-for="e in rows" :key="e.automation.id" :entry="e" :now="now" :dragged="drag?.id === e.automation.id"
                       @open="open(e.automation.id)" @grab="startDrag($event, e.automation.id)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; }
.head { display: flex; align-items: center; gap: 14px; }
.head .pill { flex: 0 0 auto; white-space: nowrap; }
.count { font-size: 13px; white-space: nowrap; }
.count--check { color: #d38b22; }
.count--check[data-zero='1'] { color: var(--muted); opacity: .55; }
.tools { display: flex; align-items: center; gap: 12px; padding: 0 24px 12px; flex: 0 0 auto; min-height: 48px; flex-wrap: wrap; }
.search {
  flex: 1 1 220px; min-width: 0; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 6px 0 12px;
  border-radius: 999px; border: 1px solid var(--line); background: var(--surface);
}
.search__icon { color: var(--muted); flex: 0 0 auto; }
.search__input { flex: 1 1 0; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 14px; outline: none; }
.search__input::-webkit-search-cancel-button { display: none; }
.search__clear { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; color: var(--muted); flex: 0 0 auto; }
.search__clear:hover { background: var(--surface2); color: var(--text); }
.search__clear.is-hidden { visibility: hidden; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); }
.rows { display: grid; gap: 8px; }
.empty { padding: 24px; text-align: center; margin-bottom: 8px; }
@media (max-width: 600px) {
  .count { display: none; }
  .head__new { display: none; }
  .tools__filter { flex: 1 1 100%; }
}
</style>
