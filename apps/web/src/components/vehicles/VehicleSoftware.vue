<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, DeviceReleaseNotes, ReleaseNote, StateFor } from '@kasbah/shared'
import { getTransport } from '../../api'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { formatMinutes, formatPercent } from '../../lib/format'
import { dayOf, delayUntil } from '../../lib/vehicleSoftware'
import { useDevicesStore } from '../../stores/devices'
import { useSettingsStore } from '../../stores/settings'

// Logiciel d'un véhicule : une ligne de la carte (version installée, mise à jour en attente), qui
// ouvre une boîte PAR-DESSUS la page — rien ne bouge — avec les notes de la version à venir, la
// programmation de son installation, et l'historique des notes.
//
// La ligne existe TOUJOURS (« — » à défaut, grisée pour un véhicule qui n'en dit rien, la R5) : une
// mise à jour qui apparaît change son texte, jamais la hauteur de la carte.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'> }>()

const { t, locale } = useI18n()
const devices = useDevicesStore()
const settings = useSettingsStore()
const EMPTY = '—'

const has = (c: 'release_notes' | 'software_update') => props.descriptor.capabilities.includes(c)
const supported = computed(() => has('release_notes') || has('software_update'))
const update = computed(() => props.state.softwareUpdate)
const asleep = computed(() => props.state.sleepState !== undefined && props.state.sleepState !== 'online')

const time = (ms: number) => new Date(ms).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
/** « à 02:00 », « demain à 02:00 », « le 5 oct. à 02:00 » */
function when(at: number): string {
  const day = dayOf(at, Date.now())
  if (day === 'today') return t('vehicle.software.at', { time: time(at) })
  if (day === 'tomorrow') return t('vehicle.software.tomorrowAt', { time: time(at) })
  return t('vehicle.software.onDate', { date: new Date(at).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' }), time: time(at) })
}
/**
 * Sous ce délai, une installation programmée se montre en DÉCOMPTE, avec l'annulation seule — comme
 * l'appli Tesla après « Installer maintenant » (Tesla laisse lui-même quelques minutes, vu le 2026-10-02).
 */
const COUNTDOWN_MS = 15 * 60_000
/**
 * L'horloge de la vue, tant qu'une installation est programmée : à la demi-minute de loin, à la
 * seconde à l'approche du décompte. Elle s'arrête d'elle-même quand plus rien n'est programmé.
 */
const now = ref(Date.now())
let tick: ReturnType<typeof setTimeout> | null = null
function loop(): void {
  now.value = Date.now()
  const u = update.value
  if (u?.status !== 'scheduled' || u.scheduledAt === undefined) { tick = null; return }
  tick = setTimeout(loop, u.scheduledAt - now.value < COUNTDOWN_MS + 60_000 ? 1000 : 30_000)
}
watch(() => update.value?.status === 'scheduled', (v) => { if (v && !tick) loop() }, { immediate: true })
onBeforeUnmount(() => { if (tick) clearTimeout(tick) })

/** Où en est l'installation : prête (programmable), décompte, démarrage attendu, en cours. */
type Phase = 'ready' | 'countdown' | 'starting' | 'installing' | 'other'
const phase = computed<Phase>(() => {
  const u = update.value
  if (!u) return 'other'
  if (u.status === 'installing') return 'installing'
  if (u.status === 'available') return 'ready'
  if (u.status !== 'scheduled') return 'other'
  if (u.scheduledAt === undefined) return 'ready'
  const left = u.scheduledAt - now.value
  return left <= 0 ? 'starting' : left <= COUNTDOWN_MS ? 'countdown' : 'ready'
})
/** « 1:42 », « 12:05 » */
const left = computed(() => {
  const ms = Math.max(0, (update.value?.scheduledAt ?? 0) - now.value)
  const sec = Math.ceil(ms / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
})
/** Fin estimée d'après la progression et la durée annoncée : rien quand l'une des deux manque. */
const endsAround = computed(() => {
  const u = update.value
  if (u?.status !== 'installing' || !u.expectedDurationS || u.installPct === undefined) return ''
  return t('vehicle.software.endsAround', { time: time(Date.now() + u.expectedDurationS * 1000 * (1 - u.installPct / 100)) })
})

/** Où en est la mise à jour, en une ligne ; vide quand rien n'attend. */
const status = computed(() => {
  const u = update.value
  if (!u) return ''
  const version = u.version ?? ''
  if (phase.value === 'countdown') return t('vehicle.software.status.countdown', { version, left: left.value })
  if (phase.value === 'starting') return t('vehicle.software.status.starting', { version })
  switch (u.status) {
    case 'scheduled': return t('vehicle.software.status.scheduled', { version, when: u.scheduledAt ? when(u.scheduledAt) : '' }).trim()
    case 'downloading': return t('vehicle.software.status.downloading', { version, pct: u.downloadPct === undefined ? '' : formatPercent(u.downloadPct, locale.value) }).trim()
    case 'installing': return t('vehicle.software.status.installing', { version, pct: u.installPct === undefined ? '' : formatPercent(u.installPct, locale.value) }).trim()
    default: return t(`vehicle.software.status.${u.status}`, { version })
  }
})
const line = computed(() => [props.state.softwareVersion ?? EMPTY, status.value].filter(Boolean).join(' · '))

// ---- la boîte ---------------------------------------------------------------------------------

const open = ref(false)
const notes = ref<DeviceReleaseNotes | null>(null)
const loading = ref(false)
const failed = ref(false)
/** Les notes viennent du cache du serveur : les redemander à l'ouverture ne coûte aucun appel au fabricant. */
async function load(): Promise<void> {
  if (!has('release_notes')) return
  loading.value = true
  failed.value = false
  try { notes.value = await getTransport().getReleaseNotes(props.descriptor.id, locale.value) }
  catch { failed.value = true }
  finally { loading.value = false }
}
watch(open, (v) => { if (v) void load() })
// une version installée ou attendue qui change pendant que la boîte est ouverte : ses notes aussi
// … et la langue de l'app, qui choisit celle des notes
watch(() => `${props.state.softwareVersion}|${update.value?.version}|${locale.value}`, () => { if (open.value) void load() })
/** Notes servies dans une autre langue que celle de l'app : le fabricant ne la publie pas (ou pas encore lue). */
const fallback = computed(() => !!notes.value?.lang && notes.value.lang !== locale.value)

/** L'illustration du thème courant : Tesla en publie une pour le sombre, une pour le clair. */
const image = (n: ReleaseNote) => (settings.isDark ? n.imageUrl ?? n.lightImageUrl : n.lightImageUrl ?? n.imageUrl)

// ---- installer --------------------------------------------------------------------------------

/** On ne programme que ce qui est TÉLÉCHARGÉ : Tesla refuserait le reste. */
const wakeText = computed(() => {
  // l'installation lancée, la voiture n'attend plus de commande : on dit ce qu'elle fait
  if (phase.value === 'starting' || phase.value === 'installing') return t('vehicle.software.blockedNow')
  if (phase.value === 'countdown' && !asleep.value) return t('vehicle.software.countdownHint')
  return t(asleep.value ? (waking.value ? 'vehicle.software.waking' : 'vehicle.software.wakeFirst') : 'vehicle.software.awake')
})
const installable = computed(() => has('software_update') && (update.value?.status === 'available' || update.value?.status === 'scheduled'))
const busy = computed(() => devices.isPending(props.descriptor.id))
const blocked = computed(() => !props.state.available || asleep.value || busy.value)
const scheduleTime = ref('02:00')
const duration = computed(() => {
  const s = update.value?.expectedDurationS
  return s ? formatMinutes(Math.round(s / 60), locale.value) : t('vehicle.software.unknownDuration')
})
/** Confirmation en cours : l'installation immobilise la voiture, c'est un geste qu'on confirme. */
const confirming = ref<{ delayS: number; when: string } | null>(null)
function ask(delayS: number): void {
  confirming.value = { delayS, when: delayS === 0 ? t('vehicle.software.now') : when(Date.now() + delayS * 1000) }
}
async function confirm(): Promise<void> {
  const c = confirming.value
  confirming.value = null
  if (c) await devices.sendCommand(props.descriptor.id, { type: 'vehicle.schedule_update', delayS: c.delayS })
}
/**
 * Réveiller sans quitter la boîte : endormie, la voiture refuse l'installation. Comme le bouton de la
 * carte, le réveil est DEMANDÉ avant d'être constaté (une dizaine de secondes) : le bouton tourne
 * jusqu'à ce que la voiture se dise éveillée, ou `WAKE_MAX_MS` si elle ne répond pas.
 */
const WAKE_MAX_MS = 90_000
const waking = ref(false)
let wakeTimer: ReturnType<typeof setTimeout> | null = null
function stopWaking(): void { waking.value = false; if (wakeTimer) clearTimeout(wakeTimer); wakeTimer = null }
async function wake(): Promise<void> {
  waking.value = true
  if (await devices.sendCommand(props.descriptor.id, { type: 'vehicle.wake' })) wakeTimer = setTimeout(stopWaking, WAKE_MAX_MS)
  else stopWaking()
}
watch(asleep, (v) => { if (!v) stopWaking() })
onBeforeUnmount(stopWaking)
async function cancelSchedule(): Promise<void> {
  await devices.sendCommand(props.descriptor.id, { type: 'vehicle.cancel_update' })
}
</script>

<template>
  <!-- la ligne : un seul bouton, la boîte s'ouvre par-dessus -->
  <button type="button" class="card card--soft soft" :disabled="!supported" :title="supported ? $t('vehicle.software.open') : $t('vehicle.unsupported')"
          :aria-haspopup="'dialog'" @click="open = true">
    <StrokeIcon class="wm" name="sparkle" :size="48" />
    <span class="soft__text">
      <span class="muted soft__k">{{ $t('vehicle.software.title') }}</span>
      <span class="soft__v" :title="line"><span>{{ state.softwareVersion ?? EMPTY }}</span><span v-if="status" class="soft__status"> · {{ status }}</span></span>
    </span>
    <StrokeIcon class="muted soft__chevron" name="chevron" :size="16" />
  </button>

  <v-dialog v-model="open" max-width="560" scrollable>
    <div class="card box">
      <div class="box__head">
        <div class="min0">
          <h2 class="box__title">{{ $t('vehicle.software.title') }}</h2>
          <div class="muted box__sub">{{ $t('vehicle.software.installed', { version: state.softwareVersion ?? EMPTY }) }}</div>
        </div>
        <button type="button" class="box__close" :title="$t('common.close')" :aria-label="$t('common.close')" @click="open = false">
          <StrokeIcon name="close" :size="18" />
        </button>
      </div>
      <div class="box__body">
        <!-- à venir : la mise à jour en attente, ce qu'elle apporte, et son installation -->
        <section v-if="update" class="sec">
          <div class="section-label">{{ $t('vehicle.software.pending') }}</div>
          <div class="sec__status">{{ status }}</div>
          <!-- la durée annoncée par le fabricant, quand il la donne : la voiture est bloquée pendant ce temps -->
          <p v-if="update.expectedDurationS && update.status !== 'installing'" class="sec__duration">
            <StrokeIcon name="clock" :size="14" />{{ $t('vehicle.software.durationNote', { duration }) }}
          </p>
          <!-- la zone d'action : une hauteur FIXE, quatre états — boutons, décompte, démarrage, progression -->
          <div v-if="installable || phase === 'starting' || phase === 'installing'" class="stage">
          <div v-if="phase === 'countdown'" class="count">
            <div class="count__k muted">{{ $t('vehicle.software.countdown') }}</div>
            <div class="count__v" aria-live="polite">{{ left }}</div>
            <button type="button" class="pill count__cancel" :disabled="blocked" @click="cancelSchedule">
              <StrokeIcon name="close" :size="16" />{{ $t('vehicle.software.cancelInstall') }}
            </button>
          </div>
          <div v-else-if="phase === 'starting'" class="count">
            <v-progress-circular indeterminate size="20" width="2" />
            <div class="count__k">{{ $t('vehicle.software.starting') }}</div>
          </div>
          <div v-else-if="phase === 'installing'" class="prog">
            <div class="prog__head"><span>{{ $t('vehicle.software.installingNow') }}</span>
              <span class="prog__pct">{{ update.installPct === undefined ? '' : formatPercent(update.installPct, locale) }}</span></div>
            <div class="prog__track"><div class="prog__fill" :style="{ width: `${update.installPct ?? 0}%` }" /></div>
            <div class="muted prog__end">{{ endsAround }}</div>
          </div>
          <div v-else class="acts">
            <button type="button" class="pill" :disabled="blocked" @click="ask(0)">
              <StrokeIcon name="play" :size="16" />{{ $t('vehicle.software.installNow') }}
            </button>
            <span class="acts__at">
              <input v-model="scheduleTime" type="time" class="acts__time" :aria-label="$t('vehicle.software.time')" :disabled="blocked" />
              <button type="button" class="pill" :disabled="blocked || !scheduleTime" @click="ask(delayUntil(scheduleTime, Date.now()))">
                <StrokeIcon name="clock" :size="16" />{{ update.status === 'scheduled' ? $t('vehicle.software.reschedule') : $t('vehicle.software.schedule') }}
              </button>
            </span>
            <button v-if="update.status === 'scheduled'" type="button" class="pill" :disabled="blocked" @click="cancelSchedule">
              <StrokeIcon name="close" :size="16" />{{ $t('vehicle.software.cancel') }}
            </button>
          </div>
          </div>
          <!-- une rangée de hauteur FIXE : endormie, l'explication et « Réveiller » ; réveillée, « prête » à
               la même place — rien ne bouge dans la boîte quand la voiture ouvre les yeux -->
          <div v-if="installable || phase === 'starting' || phase === 'installing'" class="wakerow">
            <span class="muted wakerow__text" :title="wakeText">{{ wakeText }}</span>
            <button v-if="asleep && (phase === 'ready' || phase === 'countdown')" type="button" class="pill wakerow__btn" :disabled="!state.available || waking || busy"
                    :aria-busy="waking" :title="$t('vehicle.wakeHint')" @click="wake">
              <v-progress-circular v-if="waking" indeterminate size="16" width="2" />
              <StrokeIcon v-else name="sun" :size="16" />{{ $t('vehicle.wake') }}
            </button>
          </div>
          <template v-if="notes?.pending">
            <article v-for="(n, i) in notes.pending.notes" :key="`p${i}`" class="note">
              <img v-if="image(n)" class="note__img" :src="image(n)" alt="" loading="lazy" />
              <h3 class="note__title">{{ n.title }}</h3>
              <p v-if="n.description" class="note__desc">{{ n.description }}</p>
            </article>
          </template>
          <p v-else-if="has('release_notes') && !loading" class="muted hint">{{ $t('vehicle.software.notRead') }}</p>
        </section>

        <!-- historique : ce que les versions installées ont apporté, la plus récente en haut -->
        <section v-if="has('release_notes')" class="sec">
          <div class="section-label">{{ $t('vehicle.software.history') }}</div>
          <div v-if="loading && !notes" class="sec__loading"><v-progress-circular indeterminate size="20" width="2" /></div>
          <p v-else-if="failed" class="muted hint">{{ $t('vehicle.software.loadError') }}</p>
          <p v-else-if="!notes?.history.length" class="muted hint">{{ $t('vehicle.software.noHistory') }}</p>
          <div v-for="v in notes?.history ?? []" :key="v.version" class="ver">
            <div class="ver__name">{{ v.version }}</div>
            <article v-for="(n, i) in v.notes" :key="i" class="note">
              <img v-if="image(n)" class="note__img" :src="image(n)" alt="" loading="lazy" />
              <h3 class="note__title">{{ n.title }}</h3>
              <p v-if="n.description" class="note__desc">{{ n.description }}</p>
            </article>
          </div>
          <p v-if="notes?.history.length || notes?.pending" class="muted hint">{{ fallback ? $t('vehicle.software.fallbackLang') : $t('vehicle.software.vendorText') }}</p>
        </section>
      </div>
    </div>
  </v-dialog>

  <!-- l'installation immobilise la voiture : confirmée, avec sa durée -->
  <v-dialog :model-value="confirming !== null" max-width="420" @update:model-value="(v: boolean) => { if (!v) confirming = null }">
    <div v-if="confirming" class="card box">
      <h2 class="box__title">{{ $t('vehicle.software.confirmTitle', { version: update?.version ?? '' }) }}</h2>
      <p class="confirm__text">{{ $t('vehicle.software.confirmText', { when: confirming.when, duration }) }}</p>
      <div class="confirm__acts">
        <button type="button" class="pill" @click="confirming = null">{{ $t('common.cancel') }}</button>
        <button type="button" class="pill" data-on="1" @click="confirm">{{ $t('vehicle.software.confirm') }}</button>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
/* la ligne : même boîte que les cases d'état de la carte (`.stat`), sur toute la largeur */
.soft {
  position: relative; overflow: hidden; isolation: isolate; width: 100%; padding: 10px 12px;
  display: flex; align-items: center; gap: 8px; text-align: left; color: var(--text); font: inherit;
}
.soft:not(:disabled):hover { background: color-mix(in srgb, var(--surface2) 80%, var(--text) 6%); }
.soft:disabled { cursor: default; }
.soft__text { flex: 1 1 auto; min-width: 0; display: grid; }
.soft__k { font-size: 11px; }
.soft__v { font-weight: 500; font-size: 14px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.soft__status { color: var(--accent); }
.soft__chevron { flex: none; }
.soft:disabled .soft__chevron { opacity: 0; }
.wm { position: absolute; right: -6px; bottom: -6px; z-index: -1; color: var(--text); opacity: .07; pointer-events: none; }

/* toute la largeur que le v-dialog accorde (560 px au plus) : sans quoi la boîte prenait celle de son
   contenu, plus étroite en anglais, et ses lignes changeaient de hauteur d'une langue à l'autre */
.box { width: 100%; container-type: inline-size; padding: 18px 20px 20px; display: grid; gap: 12px; box-shadow: var(--shadow); max-height: 85vh; grid-template-rows: auto minmax(0, 1fr); }
.box__head { display: flex; align-items: flex-start; gap: 12px; }
.min0 { min-width: 0; flex: 1 1 auto; }
.box__title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; }
.box__sub { font-size: 13px; margin-top: 2px; font-variant-numeric: tabular-nums; }
.box__close { flex: 0 0 auto; width: 32px; height: 32px; margin: -4px -6px 0 0; border: 0; border-radius: 10px; background: transparent; color: var(--muted); display: grid; place-items: center; }
.box__close:hover { background: var(--surface2); color: var(--text); }
.box__body { overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 20px; align-content: start; margin-right: -8px; padding-right: 8px; }
.sec { display: grid; gap: 10px; }
.sec__status { font-weight: 600; font-size: 15px; color: var(--accent); }
.sec__duration { margin: -4px 0 0; display: flex; align-items: center; gap: 6px; font-size: 13px; }
.sec__duration :deep(svg) { flex: none; color: var(--muted); }
.sec__loading { display: grid; place-items: center; padding: 12px; }
/* deux rangées de boutons : la hauteur la plus grande des quatre états, réservée pour tous */
.stage { min-height: 88px; display: grid; align-content: start; }
.acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.count { min-height: 88px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
.count__k { font-size: 13px; }
.count__v { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; min-width: 4.2ch; }
.count__cancel { margin-left: auto; }
.prog { min-height: 88px; display: grid; gap: 8px; align-content: center; }
.prog__head { display: flex; justify-content: space-between; font-size: 14px; font-weight: 500; }
.prog__pct { font-variant-numeric: tabular-nums; }
.prog__track { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; }
.prog__fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width .6s; }
.prog__end { font-size: 12px; height: 16px; }
.acts__at { display: inline-flex; gap: 6px; align-items: center; }
.acts__time {
  height: 40px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
  color: var(--text); font: inherit; font-variant-numeric: tabular-nums; color-scheme: light dark;
}
.hint { margin: 0; font-size: 12px; }
.wakerow { height: 40px; display: flex; align-items: center; gap: 10px; }
/* deux lignes au plus, dans la hauteur FIXE de la rangée : sur téléphone, le texte et le bouton ne
   tiennent pas sur une ligne, et la rangée ne doit pas grandir d'un état à l'autre */
.wakerow__text {
  flex: 1 1 auto; min-width: 0; font-size: 12px; line-height: 16px; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;
}
.wakerow__btn { flex: none; }
/* boîte très étroite (téléphone zoomé) : le bouton passe SOUS le texte ; hauteur fixe ici aussi, avec ou sans bouton */
@container (max-width: 340px) {
  .wakerow { height: 84px; flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 8px; }
  .wakerow__text { flex: none; }
}
.wakerow__btn[aria-busy='true']:disabled { opacity: .7; }
.ver { display: grid; gap: 10px; }
.ver__name { font-weight: 600; font-size: 14px; font-variant-numeric: tabular-nums; padding-top: 4px; border-top: 1px solid var(--line); }
.ver:first-of-type .ver__name { border-top: 0; padding-top: 0; }
.note { display: grid; gap: 4px; }
/* place réservée au format des illustrations de Tesla (740 × 463) : rien ne saute quand elles arrivent */
.note__img { width: 100%; aspect-ratio: 740 / 463; object-fit: contain; border-radius: var(--radius-sm); background: var(--surface2); margin-bottom: 4px; }
.note__title { margin: 0; font-size: 14px; font-weight: 600; }
.note__desc { margin: 0; font-size: 13px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.confirm__text { margin: 0; font-size: 14px; line-height: 1.5; }
.confirm__acts { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
</style>
