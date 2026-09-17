<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize, useIntervalFn } from '@vueuse/core'
import type { DeviceConsumption } from '@kasbah/shared'
import { bucketSlots, CONSUMPTION_PERIODS, frenchAverageDailyLitres, frenchAverageReference, niceAxisTicks, PERIOD_STEPS, seriesFor, slotsMax, slotsTotal, type ConsumptionPeriod, type ConsumptionSlot } from '../../lib/consumption'
import { formatVolume, formatVolumeAxisTick, volumeAxisUnit } from '../../lib/format'
import Segmented from '../ui/Segmented.vue'

// Historique de consommation (`GET /api/devices/:id/consumption`), en barres — un pas mesure un
// VOLUME PENDANT une durée, une barre est le langage naturel pour ça (contrairement à une courbe,
// qui suggérerait une valeur continue entre deux pas). Jour/semaine/mois/année lisent les trois
// séries du contrat ; semaine et mois partagent `daily`, seul le nombre de colonnes change.
//
// Rien ne bouge : `.chart__body` a une hauteur FIXE, qu'il montre le message « ça se remplit », ou
// des barres — 24, 7, 31 ou 12, jamais plus ni moins que ce que la période réserve. Un pas jamais
// mesuré (silence serveur, historique encore jeune) reste un TIRET vertical en pointillé : une barre
// pleine dirait « mesuré à 0 L », ce qui serait faux.

const props = withDefaults(defineProps<{
  consumption: DeviceConsumption | null
  /** Taille du foyer réglée dans les réglages (vue Eau) : nourrit le repère de moyenne française. */
  householdSize?: number
  /**
   * Totaux EXACTS que la station tient elle-même (jour/semaine/mois, `waterStateSchema`) : source de
   * vérité pour le total affiché, JAMAIS dérivée de la somme des pas mesurés — un historique encore
   * jeune ne mesure que quelques heures/jours, sa somme sous-compterait largement la vraie
   * consommation (154 L au compteur, 16 L de barres sur les 3 seules heures déjà mesurées). L'année
   * n'a pas d'équivalent (la station ne tient qu'un compteur glissant par mois) : elle garde la somme
   * des points mensuels, déjà complète.
   */
  todayL?: number
  weekL?: number
  monthL?: number
}>(), { householdSize: 3, todayL: undefined, weekL: undefined, monthL: undefined })
const { t, d, locale } = useI18n()
const householdSize = computed(() => props.householdSize)

const period = ref<ConsumptionPeriod>('day')
const periodOptions = computed(() => CONSUMPTION_PERIODS.map((p) => ({ value: p, label: t(`water.period.${p}`) })))

/** La série du contrat qui nourrit la période choisie, et la clé du message « ça démarre » assortie. */
const EMPTY_KEY: Record<ConsumptionPeriod, 'hourly' | 'daily' | 'monthly'> = { day: 'hourly', week: 'daily', month: 'daily', year: 'monthly' }
const series = computed(() => seriesFor(props.consumption, period.value))
/** Aucun point reçu pour cette série : pas la peine de dessiner un cadre entièrement en pointillés. */
const empty = computed(() => series.value.length === 0)

/** L'horloge murale avance : la fenêtre glissante (dernières 24 h, 7 j…) doit suivre, pas juste la donnée. */
const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

const slots = computed<ConsumptionSlot[]>(() => bucketSlots(series.value, period.value, now.value))
/** Somme des seuls pas mesurés : dernier recours quand la station n'a pas encore publié le compteur exact (voir `exactTotalL`). */
const total = computed(() => slotsTotal(slots.value))
const measuredCount = computed(() => slots.value.filter((s) => s.litres !== null).length)

/** Le compteur exact de la station pour la période choisie ; `null` pour l'année (aucun équivalent). */
const exactTotalL = computed<number | null>(() => {
  const v = period.value === 'day' ? props.todayL : period.value === 'week' ? props.weekL : period.value === 'month' ? props.monthL : undefined
  return v ?? null
})
/** Le total à AFFICHER, et pour le résumé accessible : le compteur exact s'il est connu, sinon la
 * somme des pas mesurés, sinon `null` (rien de connu — ni compteur, ni le moindre pas). Jamais deux
 * chiffres différents pour la même case. */
const displayTotalL = computed<number | null>(() => exactTotalL.value ?? (empty.value ? null : total.value))
const totalText = computed(() => (displayTotalL.value === null ? '—' : formatVolume(displayTotalL.value, locale.value)))

/**
 * Repère de consommation moyenne française (SISPEA 2023) : `null` pour la période jour (une ligne
 * horaire mentirait, voir `frenchAverageReference`), sinon une valeur par pas — une DROITE dans les
 * quatre autres périodes (l'année y compris : voir `frenchAverageReference`). L'échelle de l'axe
 * (`maxLitres`) l'intègre pour que la ligne ne soit jamais rognée quand le foyer consomme MOINS que
 * le repère (le cas normal).
 */
const refPerSlot = computed<(number | null)[]>(() => slots.value.map(() => frenchAverageReference(period.value, householdSize.value)))
const refMax = computed(() => Math.max(0, ...refPerSlot.value.filter((v): v is number => v !== null)))
const maxLitres = computed(() => Math.max(slotsMax(slots.value), refMax.value))

const stage = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(stage)
const measured = computed(() => width.value > 0 && height.value > 0)

const PAD_TOP = 14
const PAD_BOTTOM = 4
/** Hauteur du tiret d'un pas non mesuré : FIXE, elle ne représente aucune valeur. */
const MISSING_H = 16
/** Nombre de colonnes qui portent un libellé, pour ne pas empiler 31 dates illisibles. */
const LABEL_EVERY: Record<ConsumptionPeriod, number> = { day: 4, week: 1, month: 5, year: 1 }

interface BarGeom { i: number; x: number; barW: number; cx: number; baseline: number; known: boolean; barH: number }

const baseline = computed(() => Math.max(0, height.value - PAD_BOTTOM))
const plotH = computed(() => Math.max(1, height.value - PAD_TOP - PAD_BOTTOM))
const barGeom = computed<BarGeom[]>(() => {
  if (!measured.value) return []
  const count = Math.max(1, slots.value.length)
  const slotW = width.value / count
  const barW = Math.max(2, slotW * 0.6)
  return slots.value.map((s, i) => {
    const x = i * slotW + (slotW - barW) / 2
    const known = s.litres !== null
    const barH = known ? Math.max(3, (s.litres! / maxLitres.value) * plotH.value) : 0
    return { i, x, barW, cx: x + barW / 2, baseline: baseline.value, known, barH }
  })
})

const labelled = computed(() => barGeom.value.filter((g) => g.i % LABEL_EVERY[period.value] === 0 || g.i === barGeom.value.length - 1))

/**
 * Un segment horizontal par pas qui a un repère (voir `refPerSlot`) : la largeur exacte du pas, pas
 * celle plus étroite de la barre — visuellement SECOND PLAN (couleur et pointillé distincts de la
 * barre pleine et du tiret « pas non mesuré »), jamais confondu avec une mesure. Dessiné PAR-DESSUS
 * les barres (voir le gabarit) pour rester visible même quand une barre l'approche ou le dépasse.
 */
interface RefSeg { i: number; x0: number; x1: number; y: number; value: number }
const refSegs = computed<RefSeg[]>(() => {
  if (!measured.value) return []
  const count = Math.max(1, slots.value.length)
  const slotW = width.value / count
  const segs: RefSeg[] = []
  refPerSlot.value.forEach((v, i) => {
    if (v === null) return
    segs.push({ i, x0: i * slotW, x1: (i + 1) * slotW, y: baseline.value - (v / maxLitres.value) * plotH.value, value: v })
  })
  return segs
})
const hasReference = computed(() => refSegs.value.length > 0)
/** Repère quotidien (N × 145 L) affiché en légende, indépendant de la période — jamais de saut de mise en page au changement d'onglet. */
const dailyReferenceL = computed(() => frenchAverageDailyLitres(householdSize.value))

/**
 * Graduation de l'axe des ordonnées : 3-4 valeurs rondes (`niceAxisTicks`), jamais le maximum brut.
 * L'unité (L ou m³) suit le même seuil que `formatVolume` et se lit une fois, en tête de colonne —
 * chaque graduation reste un nombre nu (voir `chart__yaxis-unit` dans le gabarit).
 */
const axisUnit = computed(() => volumeAxisUnit(maxLitres.value))
interface AxisTick { value: number; y: number; text: string }
const axisTicks = computed<AxisTick[]>(() => {
  if (!measured.value) return []
  return niceAxisTicks(maxLitres.value).map((value) => ({
    value,
    y: baseline.value - (value / maxLitres.value) * plotH.value,
    text: formatVolumeAxisTick(value, axisUnit.value, locale.value),
  }))
})

/** Libellé court d'un pas : heure pour le jour, mois pour l'année, jour de semaine sinon (semaine ET mois lisent `daily`). */
function axisLabel(tMs: number): string {
  if (period.value === 'day') return d(new Date(tMs), 'hour')
  if (period.value === 'year') return d(new Date(tMs), 'month')
  return d(new Date(tMs), 'weekday')
}
/** Infobulle d'une barre : la date en clair (jamais coupée comme le libellé d'axe) et la valeur, ou l'absence de mesure. */
function tooltip(s: ConsumptionSlot): string {
  const when = period.value === 'day' ? d(new Date(s.t), 'short') : period.value === 'year' ? d(new Date(s.t), 'month') : d(new Date(s.t), 'date')
  return s.litres === null ? `${when} · ${t('water.noReading')}` : `${when} · ${formatVolume(s.litres, locale.value)}`
}

/** Unité réelle du pas de chaque période, pour la mention « X <unité> sur N mesuré(e)s » — jamais
 * le mot générique « pas » (voir `measuredFragment`), et l'accord (heure/jour/mois) en dépend. */
const MEASURED_UNIT_KEY: Record<ConsumptionPeriod, 'hours' | 'days' | 'months'> = { day: 'hours', week: 'days', month: 'days', year: 'months' }

/**
 * Fragment « X <unité> sur N mesuré(e)s », dans l'unité réelle du pas (heures/jours/mois) — jamais
 * le mot générique « pas », qui en français se lit comme une négation : « 9/12 pas mesurés » se lit
 * spontanément « neuf douzièmes NE SONT PAS mesurés », l'exact inverse de ce qu'il veut dire.
 * Piège vue-i18n : le nombre total de pas s'appelle `steps`, jamais `count` ni `n` — ces deux noms
 * sont réservés par `getPluralIndex` et écraseraient silencieusement le 3ᵉ argument (vécu : avec
 * `count`, l'accord suivait le nombre de colonnes de la période, pas le nombre de pas mesurés).
 */
const measuredFragment = computed(() => t(`water.measuredFragment.${MEASURED_UNIT_KEY[period.value]}`, {
  measured: measuredCount.value,
  steps: PERIOD_STEPS[period.value],
}, measuredCount.value))

/**
 * Résumé lisible par un lecteur d'écran : le SVG est décoratif (`aria-hidden`), tout est dit ici.
 * Les graduations de l'axe n'ajoutent rien qu'un lecteur d'écran doive entendre en plus : elles ne
 * font que redessiner visuellement le total et les valeurs déjà dites par chaque infobulle.
 */
const summary = computed(() => t('water.chartSummary', {
  period: t(`water.period.${period.value}`),
  total: totalText.value,
  fragment: measuredFragment.value,
}))

/**
 * Rappel VISIBLE (pas seulement accessible) que les barres ne couvrent qu'une partie de la période
 * quand l'historique est encore jeune : un total de 154 L au-dessus de barres qui n'en totalisent
 * que 16 doit s'expliquer tout seul. Omis quand tout est mesuré : dire « 24 heures sur 24 mesurées »
 * n'apprend rien et encombre — la disparition ne fait que raccourcir la fin de `.chart__total`,
 * jamais bouger sa hauteur ni sa position (voir le gabarit, `v-if` sur `.chart__totalNote`).
 */
const fullyMeasured = computed(() => measuredCount.value === PERIOD_STEPS[period.value])
const measuredNote = computed(() => (fullyMeasured.value ? '' : t('water.measuredNote', { fragment: measuredFragment.value })))
</script>

<template>
  <section class="card chart" :aria-label="t('water.consumption')">
    <div class="chart__head">
      <div class="chart__title">{{ t('water.consumption') }}</div>
      <Segmented v-model="period" :options="periodOptions" dense />
    </div>
    <div class="muted chart__total">
      {{ t('water.consumptionTotal', { period: t(`water.period.${period}`), value: totalText }) }}
      <span v-if="measuredNote" class="chart__totalNote">· {{ measuredNote }}</span>
    </div>
    <!-- Repère de moyenne française : MÊME texte quelle que soit la période (ne dépend que du
         foyer réglé) — jamais de saut de mise en page au changement d'onglet. Source visible
         (SISPEA 2023), nuance en infobulle (ordre de grandeur, pas un verdict). -->
    <div class="muted chart__reference" :title="t('water.referenceHint')">
      {{ t('water.referenceLegend', { value: formatVolume(dailyReferenceL, locale), n: householdSize }) }}
    </div>
    <p class="chart__sr">{{ summary }}</p>
    <div class="chart__body">
      <div v-if="empty" class="muted chart__empty">{{ t(`water.consumptionEmpty.${EMPTY_KEY[period]}`) }}</div>
      <template v-else>
        <div class="chart__plot">
          <!-- Largeur FIXE, réservée que l'unité soit "L" ou "m³" : sinon la zone des barres change
               de largeur au moment même où l'axe change d'unité (voir formatVolumeAxisTick). -->
          <div class="chart__yaxis">
            <span class="chart__yaxis-unit">{{ axisUnit }}</span>
            <span v-for="tk in axisTicks" :key="tk.value" class="chart__yaxis-tick" :style="{ top: `${tk.y}px` }">{{ tk.text }}</span>
          </div>
          <div class="chart__stagecol">
            <div ref="stage" class="chart__stage">
              <svg v-if="measured" class="chart__bars" :viewBox="`0 0 ${Math.round(width)} ${Math.round(height)}`" aria-hidden="true">
                <line v-for="tk in axisTicks" :key="`grid-${tk.value}`" class="chart__gridline" x1="0" :y1="tk.y" :x2="width" :y2="tk.y" />
                <line class="chart__baseline" x1="0" :y1="baseline" :x2="width" :y2="baseline" />
                <template v-for="g in barGeom" :key="g.i">
                  <rect v-if="g.known" class="chart__bar" :x="g.x" :y="g.baseline - g.barH" :width="g.barW" :height="g.barH" rx="2"><title>{{ tooltip(slots[g.i]!) }}</title></rect>
                  <line v-else class="chart__missing" :x1="g.cx" :y1="g.baseline" :x2="g.cx" :y2="g.baseline - MISSING_H"><title>{{ tooltip(slots[g.i]!) }}</title></line>
                </template>
                <!-- Repère de moyenne française : PAR-DESSUS les barres (reste visible même dépassé),
                     second plan par la couleur et le pointillé — jamais la teinte pleine d'une barre. -->
                <template v-if="hasReference">
                  <line v-for="seg in refSegs" :key="`ref-${seg.i}`" class="chart__reference-line" :x1="seg.x0" :y1="seg.y" :x2="seg.x1" :y2="seg.y">
                    <title>{{ t('water.referenceMark', { value: formatVolume(seg.value, locale) }) }}</title>
                  </line>
                </template>
              </svg>
            </div>
            <div class="chart__axis">
              <span v-for="g in labelled" :key="g.i" class="muted chart__axis-label" :style="{ left: `${g.cx}px` }">{{ axisLabel(slots[g.i]!.t) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.chart { padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; }
.chart__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.chart__title { font-weight: 600; font-size: 14px; }
.chart__total { font-size: 12px; font-variant-numeric: tabular-nums; }
/* absente quand tout est mesuré (v-if) : ne raccourcit que la fin de `.chart__total`, ne change
   jamais sa hauteur ni sa position — voir `measuredNote`. */
.chart__totalNote { opacity: .75; }
/* Légende du repère : même texte quelle que soit la période (ne dépend que du foyer réglé), donc
   jamais de saut de mise en page au changement d'onglet — voir `dailyReferenceL`. */
.chart__reference { font-size: 11px; margin-top: 1px; }
/* résumé pour lecteur d'écran seul : hors flux visuel, mais jamais display:none (perdu des lecteurs) */
.chart__sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* hauteur MINIMALE, jamais moins : ni la période, ni le nombre de colonnes, ni l'état vide ne la
   font descendre sous 192px. Elle peut monter au-delà quand la carte est étirée par sa voisine en
   mise en page à deux colonnes (`WaterView.vue`, `align-items: stretch` sur `.water__top`) — le
   `.chart` racine reçoit alors une hauteur imposée par la grille, et `flex: 1 1 192px` la reporte
   ici plutôt que sur l'en-tête ou le total, dont la hauteur ne doit jamais dépendre du voisinage. */
.chart__body { min-height: 192px; flex: 1 1 192px; margin-top: 8px; display: flex; flex-direction: column; }
.chart__empty { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 13px; padding: 0 12px; }
.chart__plot { display: flex; flex: 1 1 auto; min-height: 0; gap: 8px; }
/* Largeur FIXE (jamais calculée depuis le texte des graduations) : elle ne doit pas bouger quand
   l'axe bascule de « L » à « m³ » (`formatVolumeAxisTick`) au changement de période. 44px mesurés
   pour le pire texte réaliste (« 1 000 », séparateur de milliers FR compris) sans jamais tronquer. */
.chart__yaxis { flex: 0 0 44px; width: 44px; position: relative; }
.chart__yaxis-unit { position: absolute; top: 0; right: 0; font-size: 10px; color: var(--muted); }
.chart__yaxis-tick { position: absolute; right: 0; transform: translateY(-50%); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.chart__stagecol { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.chart__stage { flex: 1 1 auto; min-height: 0; min-width: 0; position: relative; }
.chart__bars { position: absolute; inset: 0; width: 100%; height: 100%; }
.chart__baseline { stroke: var(--line); stroke-width: 1; }
/* Repères de fond, discrets : ils ne doivent pas concurrencer les barres (doc/4_ui/4_0_langage-visuel.md). */
.chart__gridline { stroke: var(--line); stroke-width: 1; stroke-dasharray: 1 3; }
.chart__bar { fill: var(--accent); }
.chart__missing { stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 1.5 3; opacity: .55; }
/* Repère de moyenne française : couleur ET pointillé distincts de la barre (fond plein) comme du
   tiret « non mesuré » (fin, arrondi) — jamais confondu avec une mesure. Même jeton que les repères
   de la vue Véhicules (`VehicleCard.vue .soc__tick`), déjà établi pour ce rôle. */
.chart__reference-line { stroke: rgb(var(--v-theme-warning)); stroke-width: 1.5; stroke-dasharray: 5 3; opacity: .85; }
.chart__axis { position: relative; flex: 0 0 20px; }
.chart__axis-label { position: absolute; top: 2px; transform: translateX(-50%); font-size: 11px; white-space: nowrap; }
</style>
