<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn, useLocalStorage } from '@vueuse/core'
import type { SchoolFile, SchoolHomework } from '../api/transport'
import PageHeader from '../components/layout/PageHeader.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { badges, daysBetween, homeworkDays, isVisible, levelOptions, localDay, nextDueDate } from '../lib/school'
import { useNotificationsStore } from '../stores/notifications'
import { useSchoolStore } from '../stores/school'

// Vue École : le cahier de texte, le cahier de liaison et les publications de la classe
// (plugin `toutemonannee`). Ce que le site fait mal et qu'on fait ici : TOUT ce qui est à faire
// d'un coup d'œil, par jour, sans calendrier à cliquer jour après jour. Pour les parents comme pour
// l'élève : même taille de texte que le reste de Kasbah, le prochain jour mis en avant par le style.
//
// La case « fait » est celle du site quand l'enseignante l'a ouverte (elle voit qui a coché) ;
// sinon elle reste dans Kasbah. Les filtres (classes, niveaux) sont gardés par le serveur : tous
// les écrans de la maison voient la même chose.

type Tab = 'homework' | 'messages' | 'posts'

const { t, locale } = useI18n()
const school = useSchoolStore()
const notifications = useNotificationsStore()

const tab = useLocalStorage<Tab>('kasbah.school.tab', 'homework')
const showPast = ref(false)

const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)
const today = computed(() => localDay(new Date(now.value)))

onMounted(() => { void school.load() })
// la vue reste ouverte sur une tablette : on relit ce que le serveur a lu entre-temps
useIntervalFn(() => { if (school.linked) void school.load() }, 5 * 60_000)

const data = computed(() => school.data)
const filters = computed(() => data.value?.filters ?? { hiddenJournals: [], hiddenLevels: [] })
const visible = <T extends { journalId: string; levels: string[] }>(list: T[]) => list.filter((e) => isVisible(e, filters.value))

const homework = computed(() => visible(data.value?.homework ?? []))
const days = computed(() => homeworkDays(homework.value, today.value))
const nextDue = computed(() => nextDueDate(homework.value, today.value))
/** Des DEVOIRS, pas des jours : « 4 jours passés » se lisait comme 4 jours de calendrier, alors qu'ils
 * s'étalaient sur la semaine relue. */
const pastCount = computed(() => days.value.past.reduce((n, d) => n + d.items.length, 0))
const messages = computed(() => visible(data.value?.messages ?? []))
const posts = computed(() => visible(data.value?.posts ?? []))
const counts = computed(() => (data.value ? badges(data.value, today.value) : { homework: 0, messages: 0, posts: 0 }))

// Les publications vues : « nouveau » reste affiché pendant la visite, la pastille tombe tout de suite.
const postsSeenAtOpen = ref<number | null>(null)
watch([tab, () => data.value?.posts], () => {
  if (tab.value !== 'posts' || !data.value) return
  if (postsSeenAtOpen.value === null) postsSeenAtOpen.value = data.value.postsSeen
  void school.seenPosts().catch(() => {})
}, { immediate: true })
const isNew = (id: number) => id > (postsSeenAtOpen.value ?? data.value?.postsSeen ?? 0)

const tabs = computed(() => [
  { value: 'homework' as const, icon: 'pencil' as const, label: t('school.tabs.homework'), count: counts.value.homework },
  { value: 'messages' as const, icon: 'message' as const, label: t('school.tabs.messages'), count: counts.value.messages },
  { value: 'posts' as const, icon: 'news' as const, label: t('school.tabs.posts'), count: counts.value.posts },
])

// ---- Filtres ----------------------------------------------------------------------------------
const journals = computed(() => data.value?.journals ?? [])
const levels = computed(() => (data.value ? levelOptions(data.value) : []))
const hasFilters = computed(() => journals.value.length > 1 || levels.value.length > 1)
function toggle(list: 'hiddenJournals' | 'hiddenLevels', value: string) {
  const cur = filters.value[list]
  const next = { ...filters.value, [list]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] }
  school.setFilters(next).catch((err: Error) => notifications.error(t('school.saveFailed', { message: err.message })))
}

// ---- Dates ------------------------------------------------------------------------------------
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function dayTitle(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return capital(new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }).format(d))
}
function dayHint(date: string): string {
  const n = daysBetween(today.value, date)
  if (n === 0) return t('school.today')
  if (n === 1) return t('school.tomorrow')
  if (n === -1) return t('school.yesterday')
  return n > 0 ? t('school.inDays', { n }) : t('school.daysAgo', { n: -n })
}
const stamp = (at: string) => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
const readAt = computed(() => (data.value?.fetchedAt
  ? new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(new Date(data.value.fetchedAt))
  : null))

const journalName = (id: string) => journals.value.find((j) => j.id === id)?.name ?? ''
const heading = (h: SchoolHomework) => h.subject ?? h.title ?? t('school.homework')

async function tick(h: SchoolHomework) {
  try { await school.setDone(h.journalId, h.id, !h.done) }
  catch (err) { notifications.error(t('school.tickFailed', { message: (err as Error).message })) }
}

const refreshing = ref(false)
async function refresh() {
  refreshing.value = true
  try { await school.refresh() }
  catch (err) { notifications.error(t('school.refreshFailed', { message: (err as Error).message })) }
  finally { refreshing.value = false }
}

const images = (files: SchoolFile[]) => files.filter((f) => f.type === 'image')
const documents = (files: SchoolFile[]) => files.filter((f) => f.type !== 'image')
</script>

<template>
  <div class="page">
    <PageHeader />

    <div v-if="!school.loaded" class="page__body" />
    <div v-else-if="school.unavailable || !school.linked" class="page__body">
      <div class="card card--soft school__empty">
        <StrokeIcon name="school" :size="28" class="muted" />
        <p class="muted">{{ school.unavailable ? $t('school.disabled') : $t('school.notLinked') }}</p>
        <router-link :to="{ name: 'settings' }" class="pill">{{ $t('school.openSettings') }}</router-link>
      </div>
    </div>

    <div v-else class="page__body school">
      <!-- une seule barre : filtres à gauche ; fraîcheur de la lecture et onglets (icônes, nom en
           infobulle) à droite -->
      <div class="school__bar">
        <div v-if="hasFilters" class="school__filters" :aria-label="$t('school.filtersLabel')">
          <template v-if="journals.length > 1">
            <button v-for="j in journals" :key="j.id" type="button" class="school__chip" :data-on="filters.hiddenJournals.includes(j.id) ? '0' : '1'"
                    :aria-pressed="!filters.hiddenJournals.includes(j.id)" @click="toggle('hiddenJournals', j.id)">
              <StrokeIcon :name="filters.hiddenJournals.includes(j.id) ? 'minusCircle' : 'checkCircle'" :size="14" />{{ j.name }}
            </button>
          </template>
          <button v-for="l in levels" :key="l" type="button" class="school__chip" :data-on="filters.hiddenLevels.includes(l) ? '0' : '1'"
                  :aria-pressed="!filters.hiddenLevels.includes(l)" :title="$t('school.levelHint', { level: l })" @click="toggle('hiddenLevels', l)">
            <StrokeIcon :name="filters.hiddenLevels.includes(l) ? 'minusCircle' : 'checkCircle'" :size="14" />{{ l }}
          </button>
        </div>
        <div class="school__status muted">
          <StrokeIcon v-if="data?.sessionLost || data?.error" name="alert" :size="16" class="school__warn"
                      :title="data?.sessionLost ? $t('school.sessionLost') : data?.error ?? ''" />
          <!-- la relecture se fait seule (toutes les 30 min) : le geste manuel reste discret, porté par l'heure -->
          <button type="button" class="school__stamp" :disabled="refreshing" :title="$t('school.refresh')" :aria-label="$t('school.refresh')" @click="refresh">
            <StrokeIcon name="rotateRight" :size="13" />
            <span v-if="readAt" class="school__readat">{{ $t('school.updatedAt', { time: readAt }) }}</span>
          </button>
          <Segmented v-model="tab" :options="tabs" :label="$t('school.tabsLabel')" />
        </div>
      </div>

      <div v-if="data?.sessionLost" class="card card--soft school__notice">
        <span>{{ $t('school.sessionLost') }}</span>
        <router-link :to="{ name: 'settings' }" class="pill">{{ $t('school.openSettings') }}</router-link>
      </div>

      <div class="school__scroll">
        <!-- Devoirs ---------------------------------------------------------------------------- -->
        <template v-if="tab === 'homework'">
          <button v-if="days.past.length" type="button" class="school__past" :aria-expanded="showPast" @click="showPast = !showPast">
            <StrokeIcon :name="showPast ? 'chevronUp' : 'chevronDown'" :size="16" />
            {{ showPast ? $t('school.hidePast') : $t('school.showPast', { n: pastCount }, pastCount) }}
          </button>
          <template v-if="showPast">
            <section v-for="d in days.past" :key="d.date" class="school__day school__day--past">
              <h2 class="school__dayhead">{{ dayTitle(d.date) }}<span class="school__dayhint">{{ dayHint(d.date) }}</span></h2>
              <article v-for="h in d.items" :key="h.id" class="card school__item" :data-done="h.done ? '1' : '0'">
                <button type="button" role="checkbox" class="school__check" :aria-checked="h.done" :disabled="school.pending.has(h.id)"
                        :aria-label="$t('school.markDone', { what: heading(h) })" @click="tick(h)">
                  <StrokeIcon v-if="h.done" name="check" :size="16" />
                </button>
                <div class="school__content">
                  <div class="school__title">{{ heading(h) }}<span v-for="l in h.levels" :key="l" class="school__level">{{ l }}</span></div>
                  <p class="school__text">{{ h.text }}</p>
                </div>
              </article>
            </section>
          </template>

          <p v-if="!days.upcoming.length" class="card card--soft school__none muted">{{ $t('school.noHomework') }}</p>
          <section v-for="d in days.upcoming" :key="d.date" class="school__day" :data-next="d.date === nextDue ? '1' : '0'">
            <h2 class="school__dayhead">{{ dayTitle(d.date) }}<span class="school__dayhint">{{ dayHint(d.date) }}</span></h2>
            <article v-for="h in d.items" :key="h.id" class="card school__item" :data-done="h.done ? '1' : '0'">
              <button type="button" role="checkbox" class="school__check" :aria-checked="h.done" :disabled="school.pending.has(h.id)"
                      :aria-label="$t('school.markDone', { what: heading(h) })" @click="tick(h)">
                <StrokeIcon v-if="h.done" name="check" :size="16" />
              </button>
              <div class="school__content">
                <div class="school__title">
                  {{ heading(h) }}<span v-for="l in h.levels" :key="l" class="school__level">{{ l }}</span>
                </div>
                <p class="school__text">{{ h.text }}</p>
                <div v-if="h.files.length" class="school__files">
                  <a v-for="f in h.files" :key="f.url" :href="f.url" target="_blank" rel="noopener noreferrer" class="school__file">
                    <StrokeIcon name="link" :size="14" />{{ f.name }}
                  </a>
                </div>
                <div class="school__meta muted">
                  <span v-if="h.author">{{ h.author }}</span>
                  <span v-if="journals.length > 1">{{ journalName(h.journalId) }}</span>
                  <span v-if="h.siteAck" class="school__ack" :title="$t('school.siteAckHint')">
                    <StrokeIcon name="person" :size="13" />{{ $t('school.siteAck', { n: h.siteAck.validated, total: h.siteAck.total }) }}
                  </span>
                </div>
              </div>
            </article>
          </section>
        </template>

        <!-- Cahier de liaison ------------------------------------------------------------------ -->
        <template v-else-if="tab === 'messages'">
          <p v-if="!messages.length" class="card card--soft school__none muted">{{ $t('school.noMessage') }}</p>
          <article v-for="m in messages" :key="m.id" class="card school__entry">
            <div class="school__title">
              {{ m.title ?? $t('school.message') }}<span v-if="!m.read" class="school__flag">{{ $t('school.unread') }}</span>
            </div>
            <div class="school__meta muted">
              <span>{{ stamp(m.at) }}</span><span v-if="m.author">{{ m.author }}</span>
              <span v-if="m.responses">{{ $t('school.responses', { n: m.responses }, m.responses) }}</span>
            </div>
            <p class="school__text">{{ m.text }}</p>
            <div v-if="m.files.length" class="school__files">
              <a v-for="f in m.files" :key="f.url" :href="f.url" target="_blank" rel="noopener noreferrer" class="school__file">
                <StrokeIcon name="link" :size="14" />{{ f.name }}
              </a>
            </div>
          </article>
        </template>

        <!-- Publications ------------------------------------------------------------------------ -->
        <template v-else>
          <p v-if="!posts.length" class="card card--soft school__none muted">{{ $t('school.noPost') }}</p>
          <article v-for="p in posts" :key="p.id" class="card school__entry">
            <div class="school__title">
              {{ p.title ?? $t('school.post') }}<span v-if="isNew(p.id)" class="school__flag">{{ $t('school.new') }}</span>
            </div>
            <div class="school__meta muted">
              <span>{{ stamp(p.at) }}</span><span v-if="p.author">{{ p.author }}</span>
              <span v-if="p.comments">{{ $t('school.comments', { n: p.comments }, p.comments) }}</span>
            </div>
            <p v-if="p.text" class="school__text">{{ p.text }}</p>
            <div v-if="images(p.files).length" class="school__images">
              <a v-for="f in images(p.files)" :key="f.url" :href="f.url" target="_blank" rel="noopener noreferrer">
                <img :src="f.thumb ?? f.url" :alt="f.name" loading="lazy" referrerpolicy="no-referrer" />
              </a>
            </div>
            <div v-if="documents(p.files).length" class="school__files">
              <a v-for="f in documents(p.files)" :key="f.url" :href="f.url" target="_blank" rel="noopener noreferrer" class="school__file">
                <StrokeIcon name="link" :size="14" />{{ f.name }}
              </a>
            </div>
          </article>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__body { flex: 1 1 auto; min-height: 0; padding: 0 var(--page-x); display: flex; flex-direction: column; gap: 12px; }
.school__empty { margin: auto; max-width: 460px; padding: 28px; display: grid; justify-items: center; gap: 12px; text-align: center; }
.school__empty p { margin: 0; }

.school__bar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; min-width: 0; }
.school__status { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-left: auto; }
.school__stamp {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 2px; border: 0; background: none;
  color: var(--muted); font: 500 12px/1 var(--font); cursor: pointer;
}
.school__stamp:hover:not(:disabled) { color: var(--text); }
.school__stamp:disabled { cursor: progress; opacity: .6; }
/* téléphone : l'heure passait sur deux lignes — l'icône seule reste, l'infobulle dit le geste */
@media (max-width: 520px) { .school__readat { display: none; } }
.school__warn { color: #d38b22; flex: 0 0 auto; }
.school__notice { padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; }

.school__filters { display: flex; gap: 6px; flex-wrap: wrap; }
.school__chip {
  height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text);
  display: inline-flex; align-items: center; gap: 6px; font: 500 13px/1 var(--font); cursor: pointer; transition: opacity .15s;
}
.school__chip[data-on='1'] { color: var(--accent); }
.school__chip[data-on='0'] { opacity: .5; text-decoration: line-through; }

.school__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-bottom: calc(var(--safe-bottom) + 24px); display: flex; flex-direction: column; gap: 10px; }
.school__scroll > * { width: 100%; max-width: 820px; box-sizing: border-box; }

.school__day { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.school__dayhead { margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: baseline; gap: 10px; }
.school__dayhint { font-size: 12px; font-weight: 500; color: var(--muted); }
/* le prochain jour à rendre : celui qu'on regarde en rentrant de l'école */
.school__day[data-next='1'] .school__dayhead { color: var(--accent); }
.school__day[data-next='1'] .school__dayhint {
  color: var(--on-accent); background: var(--accent); padding: 2px 9px; border-radius: 999px; font-weight: 600;
}
.school__day--past { opacity: .8; }

.school__item { padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; }
.school__item[data-done='1'] .school__content { opacity: .5; }
.school__check {
  flex: 0 0 auto; width: 26px; height: 26px; margin-top: 1px; border-radius: 8px; border: 2px solid var(--line); background: var(--surface);
  color: var(--on-accent); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
}
.school__check[aria-checked='true'] { background: var(--accent); border-color: var(--accent); }
.school__check:disabled { cursor: progress; opacity: .6; }
.school__content { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.school__entry { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }

.school__title { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.school__level {
  font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 6px; border: 1px solid var(--line); color: var(--muted);
}
.school__flag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--accent); color: var(--on-accent); }
.school__text { margin: 0; font-size: 14px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.school__meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; }
.school__ack { display: inline-flex; align-items: center; gap: 4px; }
.school__files { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
.school__file { display: inline-flex; align-items: center; gap: 5px; color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
.school__images { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.school__images img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius); display: block; }

.school__past {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 4px 0; border: 0; background: none;
  color: var(--muted); font: 500 13px/1.2 var(--font); cursor: pointer; width: auto;
}
.school__none { padding: 18px; margin: 0; text-align: center; }
</style>
