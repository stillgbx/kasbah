<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '../components/layout/PageHeader.vue'
import MarqueeText from '../components/ui/MarqueeText.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useLocalPluginsStore } from '../stores/localPlugins'
import { useTensStore } from '../stores/tens'
import {
  DURATION_DEFAULT, DURATION_MAX, DURATION_MIN, DURATION_STEP, INTENSITY_MAX, TENS_PROGRAMS, tensProgram,
} from '../lib/tens/programs'
import { INTENSITY_STEP, type TensChannels } from '../lib/tens/protocol'

// Vue TENS : l'électrostimulateur personnel, piloté en Bluetooth depuis CE poste. L'entrée du rail
// n'existe que là où le plugin local est activé (Réglages → Sur cet appareil).
//
// Trois cartes à empreinte fixe — rien ne bouge quand une séance démarre ou s'arrête : la carte
// Séance est toujours là, grisée au repos ; Pause et Reprendre partagent le même emplacement.
const tens = useTensStore()
const localPlugins = useLocalPluginsStore()
const { t, locale } = useI18n()

const enabled = computed(() => localPlugins.isEnabled('tens'))
onMounted(() => { if (enabled.value) void tens.reconnect() })

/** Le programme que Démarrer lancera : aucun tant qu'on n'en a pas choisi un. */
const selected = ref<string | null>(null)
// le programme qui tourne devient le programme choisi — y compris retrouvé après un rechargement
watch(() => tens.currentProgram, (p) => { if (p) selected.value = p }, { immediate: true })
const minutes = ref(DURATION_DEFAULT)
const channels = ref<'1' | '2' | '3'>('3')
const channelOptions = computed(() => [
  { value: '1' as const, label: '1' },
  { value: '2' as const, label: '2' },
  { value: '3' as const, label: t('tens.channelsBoth') },
])

const programName = (id: string) => t(`tens.programNames.${id}`)
const programLabel = (id: string) => `P${tensProgram(id)?.number ?? '?'} · ${programName(id)}`

const canLaunch = computed(() => tens.connected && !tens.active && !tens.busy)
const canDrive = computed(() => tens.connected && tens.running)
/**
 * Arrêter : seulement quand une séance tourne (en cours ou en pause)… et pendant son lancement, les
 * 2 s où le programme part : l'arrêt pressé à ce moment annule le démarrage.
 */
const canStop = computed(() => tens.connected && (tens.active || tens.busy))

function launch(program: string, mins: number, ch: TensChannels) { void tens.startProgram(program, mins, ch) }

const statusLabel = computed(() => t(`tens.status.${tens.status}`))
const batteryLabel = computed(() => {
  const b = tens.battery
  if (!b) return t('tens.noBattery')
  // sur le câble, le pourcentage suit la tension et affiche un faux plein : on dit « en charge »
  return b.charging ? t('tens.charging') : `${b.percent} %`
})

const sessionState = computed(() => t(`tens.state.${tens.session?.state ?? 'idle'}`))
const sessionTitle = computed(() => {
  if (!tens.active) return ''
  return tens.currentProgram ? programLabel(tens.currentProgram) : t('tens.elsewhere')
})
const countdown = computed(() => {
  const s = tens.active ? tens.remainingS : 0
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
})

const ma = (tenths: number) => (tenths / 10).toLocaleString(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const capLabel = computed(() => t('tens.cap', { max: ma(INTENSITY_MAX) }))
/** Où en est le TENS, et ce qui est demandé : deux valeurs, la file rapproche l'une de l'autre. */
const acquired = (ch: 1 | 2) => (tens.active ? tens.acquiredOf(ch) : 0)
const requested = (ch: 1 | 2) => (tens.active ? tens.targetOf(ch) : 0)
const pct = (v: number) => `${(v / INTENSITY_MAX) * 100}%`
/** Repères du curseur tous les 5 mA (0, 5, 10… jusqu'au plafond), en dixièmes comme les valeurs. */
const TICKS = Array.from({ length: Math.floor(INTENSITY_MAX / 50) + 1 }, (_, i) => i * 50)

// Aide à l'appairage : ouverte d'office tant que ce poste n'a jamais connecté le TENS, repliable ensuite.
const showPairing = ref(!tens.knownDeviceId)
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__scroll">
      <div v-if="!enabled" class="card card--soft empty muted">
        {{ $t('tens.notEnabled') }}
        <router-link :to="{ name: 'settings' }" class="pill pill--sm empty__btn">{{ $t('tens.openSettings') }}</router-link>
      </div>
      <div v-else-if="!tens.supported" class="card card--soft empty muted">{{ $t('tens.unsupported') }}</div>

      <template v-else>
        <!-- l'appareil : connexion et batterie, une ligne -->
        <section class="card device">
          <span class="icon-square" :data-on="tens.connected ? '1' : '0'"><StrokeIcon name="pulse" :size="18" /></span>
          <div class="device__main">
            <div class="device__name">{{ tens.deviceName ?? $t('settings.localTens') }}</div>
            <div class="muted device__sub">{{ $t('tens.localOnly') }}</div>
          </div>
          <div class="device__stat">
            <div class="device__value">{{ batteryLabel }}</div>
            <div class="muted device__status">{{ statusLabel }}</div>
          </div>
          <!-- les deux emplacements restent là une fois connecté (le second masqué) : la ligne ne bouge pas -->
          <div class="device__actions">
            <button v-if="tens.connected" type="button" class="pill pill--sm device__primary" @click="tens.disconnect()">{{ $t('tens.disconnect') }}</button>
            <button v-else type="button" class="pill pill--sm device__primary" data-on="1" :disabled="tens.status === 'connecting'" @click="tens.connect()">{{ $t('tens.connect') }}</button>
            <button type="button" class="pill pill--sm" :style="{ visibility: tens.connected ? 'hidden' : 'visible' }" :disabled="tens.status !== 'disconnected'" @click="tens.connect(true)">{{ $t('tens.chooseOther') }}</button>
            <button type="button" class="device__help" :data-on="showPairing ? '1' : '0'" :aria-label="$t('tens.pairing.title')" :title="$t('tens.pairing.title')" @click="showPairing = !showPairing">
              <StrokeIcon name="info" :size="18" />
            </button>
          </div>
        </section>
        <!-- l'appairage, tel que la notice le décrit : sans le mode appairage, le TENS refuse tout nouvel appareil -->
        <section v-if="showPairing" class="card card--soft pairing">
          <div class="pairing__title">{{ $t('tens.pairing.title') }}</div>
          <ol class="pairing__steps">
            <li>{{ $t('tens.pairing.step1') }}</li>
            <li>{{ $t('tens.pairing.step2') }}</li>
            <li>{{ $t('tens.pairing.step3') }}</li>
            <li>{{ $t('tens.pairing.step4') }}</li>
          </ol>
          <div class="muted small">{{ $t('tens.pairing.flag') }}</div>
          <div class="muted small">{{ $t('tens.pairing.note') }}</div>
        </section>
        <!-- ligne réservée : une erreur apparaît sans rien pousser -->
        <div class="error" role="status">{{ tens.error ? $t(tens.error) : '' }}<span v-if="tens.errorDetail" class="error__detail"> ({{ tens.errorDetail }})</span></div>

        <div class="tens__grid">
          <!-- la séance : toujours là, grisée au repos -->
          <section class="card session" :data-off="tens.active ? '0' : '1'">
            <div class="session__head">
              <div class="session__titles">
                <div class="section-label">{{ $t('tens.session') }}</div>
                <MarqueeText class="session__program" :text="sessionTitle || sessionState" />
              </div>
              <div class="session__state muted">{{ tens.active ? sessionState : '' }}</div>
            </div>
            <div class="big-value session__time">{{ countdown }}</div>

            <div v-for="ch in ([1, 2] as const)" :key="ch" class="channel">
              <span class="channel__label">{{ $t('tens.channel', { n: ch }) }}</span>
              <button type="button" class="channel__btn" :disabled="!canDrive || requested(ch) <= 0" :aria-label="$t('tens.decrease', { n: ch })" @click="tens.nudge(ch, -1)">
                <StrokeIcon name="minus" :size="18" />
              </button>
              <!-- le curseur porte la CONSIGNE (on le fait glisser pour aller vite), la barre dessous
                   ce que le TENS a vraiment accepté : l'écart se voit tant que la file travaille -->
              <div class="channel__track">
                <v-slider :model-value="requested(ch)" :min="0" :max="INTENSITY_MAX" :step="INTENSITY_STEP" :disabled="!canDrive"
                          :ticks="TICKS" show-ticks="always" class="channel__slider" hide-details density="compact" :aria-label="$t('tens.requested', { n: ch })"
                          @update:model-value="(v: number) => tens.setIntensity(ch, v)" />
                <div class="channel__gauge"><div class="channel__fill" :style="{ width: pct(acquired(ch)) }" /></div>
              </div>
              <!-- en haut ce qui est DEMANDÉ ; dessous, discret, où en est le TENS — effacé une fois rattrapé -->
              <div class="channel__values">
                <span class="channel__value">{{ ma(requested(ch)) }} mA</span>
                <span class="channel__actual">{{ requested(ch) !== acquired(ch) ? $t('tens.actual', { v: ma(acquired(ch)) }) : '' }}</span>
              </div>
              <button type="button" class="channel__btn" :disabled="!canDrive || requested(ch) >= INTENSITY_MAX" :aria-label="$t('tens.increase', { n: ch })" @click="tens.nudge(ch, 1)">
                <StrokeIcon name="plus" :size="18" />
              </button>
            </div>
            <div class="muted small">{{ capLabel }}</div>

            <div class="session__actions">
              <button v-if="tens.paused" type="button" class="pill session__btn" :disabled="!tens.connected || tens.busy" @click="tens.resume()">
                <StrokeIcon name="play" :size="16" />{{ $t('tens.resume') }}
              </button>
              <button v-else type="button" class="pill session__btn" :disabled="!canDrive || tens.busy" @click="tens.pause()">
                <StrokeIcon name="pause" :size="16" />{{ $t('tens.pause') }}
              </button>
              <!-- l'arrêt n'attend jamais : actif dès qu'une séance tourne, et déjà pendant son lancement -->
              <button type="button" class="pill session__btn session__stop" :disabled="!canStop" @click="tens.stop()">
                <StrokeIcon name="stop" :size="16" />{{ $t('tens.stop') }}
              </button>
            </div>
          </section>

          <!-- lancer : les favoris en un clic, puis n'importe quel programme -->
          <section class="card launch">
            <div class="section-label">{{ $t('tens.favorites') }}</div>
            <div class="favorites">
              <div v-for="f in tens.favorites" :key="f.program" class="favorite" :data-current="tens.currentProgram === f.program ? '1' : '0'">
                <button type="button" class="favorite__go" :disabled="!canLaunch" @click="launch(f.program, f.minutes, 3)">
                  <StrokeIcon name="play" :size="14" />
                  <span class="favorite__name">{{ programLabel(f.program) }}</span>
                  <span class="muted favorite__time">{{ $t('tens.minutes', { n: f.minutes }) }}</span>
                </button>
                <button type="button" class="favorite__remove" :aria-label="$t('tens.favoriteRemove', { name: programLabel(f.program) })" :title="$t('tens.favoriteRemove', { name: programLabel(f.program) })"
                        @click="tens.toggleFavorite(f.program, f.minutes)">
                  <StrokeIcon name="close" :size="14" />
                </button>
              </div>
              <div v-if="tens.favorites.length === 0" class="muted small">{{ $t('tens.favoritesEmpty') }}</div>
            </div>

            <div class="section-label">{{ $t('tens.programs') }}</div>
            <div class="programs">
              <!-- trois marques distinctes : sélectionné pour Démarrer (fond), en cours (point), favori (étoile) -->
              <div v-for="p in TENS_PROGRAMS" :key="p.id" class="program" :data-on="selected === p.id ? '1' : '0'" :data-current="tens.currentProgram === p.id ? '1' : '0'">
                <button type="button" class="program__pick" :title="tens.currentProgram === p.id ? $t('tens.running') : undefined" @click="selected = p.id">
                  <span class="program__num">P{{ p.number }}</span>
                  <span class="program__name">{{ programName(p.id) }}</span>
                  <PulseDot :on="tens.currentProgram === p.id && tens.running" :size="8" class="program__dot" />
                </button>
                <button type="button" class="program__star" :data-on="tens.isFavorite(p.id) ? '1' : '0'"
                        :aria-label="$t(tens.isFavorite(p.id) ? 'tens.favoriteRemove' : 'tens.favoriteAdd', { name: programLabel(p.id), n: minutes })"
                        :title="$t(tens.isFavorite(p.id) ? 'tens.favoriteRemove' : 'tens.favoriteAdd', { name: programLabel(p.id), n: minutes })"
                        @click="tens.toggleFavorite(p.id, minutes)">
                  <StrokeIcon name="star" :size="14" />
                </button>
              </div>
            </div>

            <div class="launch__row">
              <span class="muted small">{{ $t('tens.duration') }}</span>
              <div class="stepper">
                <button type="button" class="stepper__btn" :disabled="minutes <= DURATION_MIN" :aria-label="$t('tens.shorter')" @click="minutes = Math.max(DURATION_MIN, minutes - DURATION_STEP)">
                  <StrokeIcon name="minus" :size="14" />
                </button>
                <span class="stepper__val">{{ $t('tens.minutes', { n: minutes }) }}</span>
                <button type="button" class="stepper__btn" :disabled="minutes >= DURATION_MAX" :aria-label="$t('tens.longer')" @click="minutes = Math.min(DURATION_MAX, minutes + DURATION_STEP)">
                  <StrokeIcon name="plus" :size="14" />
                </button>
              </div>
            </div>
            <div class="launch__row">
              <span class="muted small">{{ $t('tens.channels') }}</span>
              <Segmented v-model="channels" dense :options="channelOptions" :label="$t('tens.channels')" />
            </div>
            <button type="button" class="pill launch__go" data-on="1" :disabled="!canLaunch || !selected" @click="selected && launch(selected, minutes, Number(channels) as TensChannels)">
              <StrokeIcon name="play" :size="16" />{{ tens.busy && !tens.active ? $t('tens.busyStarting') : $t('tens.start') }}
            </button>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); display: grid; gap: 14px; align-content: start; }
.empty { padding: 24px; text-align: center; display: grid; gap: 12px; justify-items: center; }
.empty__btn { text-decoration: none; }
.small { font-size: 12px; }
.pill--sm { height: 32px; padding: 0 12px; font-size: 13px; }

.device { padding: 14px 18px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.device__main { flex: 1 1 220px; min-width: 0; }
.device__name { font-size: 15px; font-weight: 600; }
.device__sub { font-size: 12px; margin-top: 2px; }
/* largeur réservée : « 92 % » devenant « En charge » ne pousse ni le nom ni les boutons */
.device__stat { flex: 0 0 120px; text-align: right; }
.device__value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.device__status { font-size: 12px; white-space: nowrap; }
.device__actions { display: flex; gap: 8px; }
/* « Connecter » et « Déconnecter » dans la même largeur */
.device__primary { min-width: 118px; justify-content: center; }
.device__help { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--muted); display: grid; place-items: center; padding: 0; }
.device__help[data-on='1'] { color: var(--accent); border-color: var(--accent); }
.pairing { padding: 14px 18px; display: grid; gap: 8px; }
.pairing__title { font-weight: 600; font-size: 14px; }
.pairing__steps { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 13px; }
.error__detail { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.error { min-height: 18px; font-size: 13px; color: rgb(var(--v-theme-error)); margin: -6px 4px 0; }

.tens__grid { display: grid; gap: 14px; min-width: 0; }
/* côte à côte, les deux cartes prennent la hauteur de la plus haute (étirement par défaut de la grille) */
@media (min-width: 1040px) { .tens__grid { grid-template-columns: 1fr 1fr; } }

/* en colonne flex : la hauteur gagnée par l'étirement va sous le contenu, et Pause / Arrêter
   restent collés en bas de la carte au lieu d'écarter les lignes */
.session { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; transition: opacity .2s; }
.session[data-off='1'] .session__time, .session[data-off='1'] .channel { opacity: .45; }
.session__head { display: flex; align-items: flex-start; gap: 12px; }
.session__titles { flex: 1 1 auto; min-width: 0; display: grid; gap: 4px; }
.session__program { font-size: 15px; font-weight: 600; }
/* réservé : « Vérification des électrodes » est le plus long des états */
.session__state { flex: 0 0 150px; text-align: right; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session__time { font-size: 44px; }

.channel { display: grid; grid-template-columns: 64px 36px 1fr 84px 36px; align-items: center; gap: 10px; }
.channel__track { display: grid; gap: 2px; min-width: 0; }
/* repères tous les 5 mA : la couleur du repère de position des ouvrants (`app.css`,
   `.cover-slider`), en trait plus court — ils sont sept sur la piste, pas un seul */
.channel__slider :deep(.v-slider-track__tick) {
  width: 2px; height: 12px; margin: 0; border-radius: 1px; opacity: 1;
  top: 50%; transform: translate(-50%, -50%); background: rgb(var(--v-theme-warning));
}
/* les repères extrêmes sont placés par des marges que `margin: 0` annule : on les remet en bout de piste */
.channel__slider :deep(.v-slider-track__tick--first) { inset-inline-start: 0; }
.channel__slider :deep(.v-slider-track__tick--last) { inset-inline-start: 100%; }
/* Vuetify étiquette un repère donné en tableau (la valeur sous la piste) : 24 px de plus, inutiles ici */
.channel__slider :deep(.v-slider-track__tick-label) { display: none; }
/* la barre du TENS s'aligne sous la piste du curseur (Vuetify la borde de la moitié du pouce, 10 px) */
.channel__track .channel__gauge { margin: 0 10px; height: 4px; }
.channel__values { display: grid; justify-items: end; line-height: 1.2; }
/* ligne réservée : « TENS 7,0 mA » apparaît et disparaît sans faire bouger la valeur au-dessus */
.channel__actual { min-height: 15px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.channel__label { font-size: 13px; color: var(--muted); }
.channel__btn { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--text); display: grid; place-items: center; padding: 0; }
.channel__btn:disabled { opacity: .35; cursor: default; }
.channel__gauge { height: 8px; border-radius: 4px; background: var(--surface2); overflow: hidden; }
.channel__fill { height: 100%; background: var(--accent); transition: width .25s; }
/* la barre du TENS, sous le curseur : même rôle d'information, couleur discrète pour ne pas
   concurrencer la consigne */
.channel__track .channel__fill { background: var(--muted); opacity: .6; }
.channel__value { font-size: 15px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

.session__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: auto; }
.session__btn { justify-content: center; }
.session__stop:not(:disabled) { background: rgb(var(--v-theme-error)); color: #fff; border-color: transparent; }

.launch { padding: 18px 20px; display: grid; gap: 12px; align-content: start; }
.favorites { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.favorite { display: flex; align-items: center; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--surface); min-width: 0; }
.favorite[data-current='1'] { border-color: var(--accent); }
.favorite__go { flex: 1 1 auto; display: flex; align-items: center; gap: 10px; padding: 12px 6px 12px 14px; border: 0; background: transparent; color: var(--text); text-align: left; min-width: 0; }
.favorite__go:disabled { opacity: .45; cursor: default; }
.favorite__remove, .program__star { flex: 0 0 auto; width: 30px; height: 30px; margin-right: 6px; border-radius: 50%; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; padding: 0; }
.favorite__remove:hover, .program__star:hover { background: var(--surface2); color: var(--text); }
.favorite__name { flex: 1 1 auto; min-width: 0; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.favorite__time { font-size: 12px; white-space: nowrap; }
/* 200 px : la place du nom une fois le numéro, le point « en cours » et l'étoile posés — à 170 px
   « Gate Control 100 Hz » tombait à « Gate Con… » */
.programs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
.program { display: flex; align-items: center; border-radius: var(--radius-sm); border: 1px solid var(--line); min-width: 0; }
.program[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); }
.program__pick { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 4px 6px 10px; border: 0; background: transparent; color: var(--text); text-align: left; min-width: 0; }
/* le point pulsant « en cours » a toujours sa place (PulseDot la réserve) : il s'allume sans décaler le nom */
.program__dot { margin-left: auto; color: var(--accent); }
.program__star { width: 26px; height: 26px; margin-right: 4px; }
.program__star[data-on='1'] { color: var(--accent); }
.program__num { flex: 0 0 30px; font-size: 12px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
/* le nom passe sur deux lignes plutôt que d'être coupé ; la case a la hauteur de deux lignes pour
   TOUTES, que la grille reste régulière quel que soit le nom */
.program__name { min-width: 0; font-size: 13px; line-height: 1.25; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.launch__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.launch__go { justify-content: center; }
.stepper { display: inline-flex; align-items: center; gap: 8px; }
.stepper__btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--text); }
.stepper__btn:disabled { opacity: .35; cursor: default; }
/* largeur fixe : « 5 min » -> « 120 min » ne fait pas bouger les boutons */
.stepper__val { min-width: 7ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px; }
</style>
