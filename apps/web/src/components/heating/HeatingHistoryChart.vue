<script setup lang="ts">
import { computed, ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { HeatingPoint } from '../../api/transport'
import { formatTemp } from '../../lib/format'

// Historique de fonctionnement sur 48 h : combien de chaque heure la machine a passé à chauffer, et
// quelle température il faisait dehors pendant ce temps-là. Les deux ensemble font le seul récit
// intéressant — une pompe à chaleur qui tourne beaucoup par 12 °C ne dit pas la même chose qu'une
// qui tourne beaucoup par -5 °C.
//
// Pas de kWh : cette machine n'a aucun compteur, et MELCloud rend des relevés d'énergie vides même
// sur un hiver entier. Ce qu'on trace est donc du TEMPS DE MARCHE, mesuré par le serveur au fil de
// ses sondages — la seule chose qu'on sache honnêtement.
//
// Rien ne bouge : la zone de tracé a une hauteur FIXE et toujours 48 créneaux, que l'historique
// soit vide, jeune ou complet. Une heure jamais sondée reste un TIRET en pointillé : une barre à
// zéro dirait « mesurée, elle n'a pas chauffé », ce qui serait faux.

const props = defineProps<{ points: HeatingPoint[]; pollMs: number }>()

const HOURS = 48
const HOUR_MS = 3_600_000
/** Repère du tracé. `preserveAspectRatio="none"` l'étire en largeur ; les traits gardent leur épaisseur. */
const VB_W = HOURS * 10
const VB_H = 100

/** L'horloge murale avance : la fenêtre glissante doit suivre, pas seulement la donnée. */
const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

interface Slot { t: number; share: number | null; defrost: boolean; booster: boolean; outdoorC: number | null }

/** Les 48 créneaux de l'heure pleine la plus ancienne à l'heure en cours, trous compris. */
const slots = computed<Slot[]>(() => {
  const byHour = new Map(props.points.map((p) => [p.t, p]))
  const last = Math.floor(now.value / HOUR_MS) * HOUR_MS
  return Array.from({ length: HOURS }, (_, i) => {
    const t = last - (HOURS - 1 - i) * HOUR_MS
    const p = byHour.get(t)
    if (!p) return { t, share: null, defrost: false, booster: false, outdoorC: null }
    return { t, share: p.heating / p.n, defrost: p.defrost > 0, booster: p.booster > 0, outdoorC: p.outdoorC }
  })
})

const measured = computed(() => slots.value.filter((s) => s.share !== null))
const empty = computed(() => measured.value.length === 0)

/** Heures de marche cumulées sur la fenêtre : la somme des parts, chacune valant une heure. */
const runHours = computed(() => measured.value.reduce((a, s) => a + (s.share ?? 0), 0))

/** Bornes de la courbe extérieure, arrondies au degré et jamais plates (sinon la courbe serait une ligne au sol). */
const outdoorRange = computed<[number, number] | null>(() => {
  const temps = slots.value.map((s) => s.outdoorC).filter((t): t is number => t !== null)
  if (!temps.length) return null
  const lo = Math.floor(Math.min(...temps))
  const hi = Math.ceil(Math.max(...temps))
  return hi - lo < 2 ? [lo - 1, lo + 1] : [lo, hi]
})

/** La courbe extérieure, en segments : un trou dans la mesure coupe le trait au lieu de l'inventer. */
const outdoorPath = computed(() => {
  const range = outdoorRange.value
  if (!range) return ''
  const [lo, hi] = range
  let d = ''
  let pen = false
  slots.value.forEach((s, i) => {
    if (s.outdoorC === null) { pen = false; return }
    const x = i * 10 + 5
    // 10 % de marge en haut et en bas : la courbe ne colle ni au plafond ni au sol
    const y = VB_H - 10 - ((s.outdoorC - lo) / (hi - lo)) * (VB_H - 20)
    d += `${pen ? 'L' : 'M'}${x} ${Math.round(y * 10) / 10} `
    pen = true
  })
  return d.trim()
})

const hourLabel = (t: number) => new Date(t).getHours()
/** Une graduation toutes les six heures : assez pour se repérer, assez peu pour rester lisible. */
const ticks = computed(() => slots.value.map((s, i) => ({ i, t: s.t })).filter(({ t }) => new Date(t).getHours() % 6 === 0))
</script>

<template>
  <section class="card hist">
    <div class="hist__head">
      <div>
        <div class="hist__title">{{ $t('heating.history.title') }}</div>
        <div class="muted small">{{ $t('heating.history.window') }}</div>
      </div>
      <div class="hist__stat">
        <div class="hist__value">{{ empty ? '—' : $t('heating.history.runHours', { h: runHours.toFixed(1) }) }}</div>
        <div class="muted small">{{ $t('heating.history.run') }}</div>
      </div>
    </div>

    <div class="hist__body">
      <p v-if="empty" class="muted small hist__empty">{{ $t('heating.history.filling', { min: Math.round(pollMs / 60000) }) }}</p>
      <svg v-else class="hist__svg" :viewBox="`0 0 ${VB_W} ${VB_H}`" preserveAspectRatio="none" role="img"
           :aria-label="$t('heating.history.title')">
        <!-- les heures jamais sondées : un tiret, pas une barre à zéro -->
        <line v-for="(s, i) in slots" v-show="s.share === null" :key="`gap-${s.t}`"
              class="hist__gap" :x1="i * 10 + 5" :x2="i * 10 + 5" :y1="VB_H - 4" :y2="VB_H" vector-effect="non-scaling-stroke" />
        <rect v-for="(s, i) in slots" v-show="s.share !== null" :key="`bar-${s.t}`"
              class="hist__bar" :x="i * 10 + 1.5" :width="7"
              :y="VB_H - (s.share ?? 0) * (VB_H - 4)" :height="Math.max((s.share ?? 0) * (VB_H - 4), (s.share ?? 0) > 0 ? 1.5 : 0)" />
        <!-- dégivrage et appoint électrique : deux marques au pied de l'heure concernée -->
        <rect v-for="(s, i) in slots" v-show="s.defrost" :key="`d-${s.t}`" class="hist__defrost" :x="i * 10 + 1.5" :y="VB_H - 2.5" width="7" height="2.5" />
        <rect v-for="(s, i) in slots" v-show="s.booster" :key="`b-${s.t}`" class="hist__booster" :x="i * 10 + 1.5" :y="VB_H - 5" width="7" height="2.5" />
        <path v-if="outdoorPath" class="hist__outdoor" :d="outdoorPath" vector-effect="non-scaling-stroke" />
      </svg>
    </div>

    <div class="hist__axis" aria-hidden="true">
      <span v-for="tk in ticks" :key="tk.t" class="hist__tick" :style="{ left: `${((tk.i * 10 + 5) / VB_W) * 100}%` }">{{ hourLabel(tk.t) }}h</span>
    </div>

    <div class="hist__legend muted small">
      <span class="key"><i class="swatch swatch--bar" />{{ $t('heating.history.legendRun') }}</span>
      <span class="key"><i class="swatch swatch--outdoor" />{{ $t('heating.history.legendOutdoor') }}<template v-if="outdoorRange">
        · {{ formatTemp(outdoorRange[0], $i18n.locale) }} → {{ formatTemp(outdoorRange[1], $i18n.locale) }}</template></span>
      <span class="key"><i class="swatch swatch--defrost" />{{ $t('heating.history.legendDefrost') }}</span>
      <span class="key"><i class="swatch swatch--booster" />{{ $t('heating.history.legendBooster') }}</span>
    </div>
  </section>
</template>

<style scoped>
.hist { padding: 14px 16px; display: grid; gap: 10px; min-width: 0; }
.hist__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.hist__title { font-size: 15px; font-weight: 600; }
.hist__stat { flex: 0 0 auto; text-align: right; }
.hist__value { font-size: 20px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
/* hauteur FIXE : le cadre ne bouge ni quand l'historique est vide, ni quand il se remplit.
   96 px et non 132 : la forme des barres se lit aussi bien, et la page tient sur un écran. */
.hist__body { height: 96px; position: relative; }
.hist__empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; margin: 0; padding: 0 12px; }
.hist__svg { width: 100%; height: 100%; display: block; overflow: visible; }
.hist__bar { fill: var(--accent); opacity: .85; }
.hist__gap { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 2; }
.hist__defrost { fill: #4aa3d2; }
.hist__booster { fill: #d38b22; }
.hist__outdoor { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
/* graduations posées en pourcentage sous le tracé : elles suivent l'étirement du viewBox */
.hist__axis { position: relative; height: 14px; }
.hist__tick { position: absolute; transform: translateX(-50%); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.hist__legend { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.key { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
.swatch--bar { background: var(--accent); }
.swatch--outdoor { height: 2px; border-radius: 1px; background: var(--muted); }
.swatch--defrost { background: #4aa3d2; }
.swatch--booster { background: #d38b22; }
.small { font-size: 12px; }
</style>
