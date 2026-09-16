<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { AQI_LEVELS, POLLEN_TYPES, type WeatherDailyPoint, type WeatherHourlyPoint } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RainRadar from '../components/weather/RainRadar.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useForecast, useWeather } from '../composables/useWeather'
import { formatMinutes } from '../lib/format'
import type { IconName } from '../lib/strokeIcons'
import { compassPoint, conditionIcon } from '../lib/weather'
import { useHouseStore } from '../stores/house'

// Vue Météo : tout ce que l'appareil météo sait. L'actuel en grand, le soleil, le vent, les 24
// prochaines heures, la semaine, l'air et les pollens, les grandeurs secondaires en tuiles, la
// carte des précipitations. Chaque bloc a une TAILLE FIXE quelle que soit la donnée : sans
// prévisions, la bande horaire garde ses 24 colonnes et la semaine ses 7 lignes, avec des tirets.
const { d, n, t, locale } = useI18n()
const house = useHouseStore()
const weather = useWeather()
const live = weather.live
const caps = computed(() => new Set(weather.descriptor.value?.capabilities ?? []))
const { forecast } = useForecast(computed(() => weather.entry.value?.descriptor.id))

const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

const home = computed(() => (house.house ? { lat: house.house.origin.lat, lon: house.house.origin.lon } : undefined))
const icon = computed<IconName>(() => (live.value ? conditionIcon(live.value.condition, live.value.isDay) : 'cloud'))
const deg = (v: number | undefined) => (v === undefined ? '—' : `${n(v, 'integer')}°`)
const opt = (v: number | undefined, unit: string, fmt: 'integer' | 'decimal1' = 'integer') => (v === undefined ? '—' : `${n(v, fmt)}${unit}`)

// Soleil : la course du jour, et où on en est. Hors du jour, le point reste caché : l'arc dit
// seulement lever et coucher.
const sun = computed(() => {
  const s = live.value
  if (!s || !s.sunrise || !s.sunset) return null
  const p = Math.min(1, Math.max(0, (now.value - s.sunrise) / (s.sunset - s.sunrise)))
  const a = Math.PI * (1 - p)
  return { p, x: 100 + 86 * Math.cos(a), y: 96 - 86 * Math.sin(a), up: now.value >= s.sunrise && now.value <= s.sunset, lengthMin: (s.sunset - s.sunrise) / 60_000 }
})

const HOURS = 24
const DAYS = 7
const hourly = computed<(WeatherHourlyPoint | null)[]>(() => Array.from({ length: HOURS }, (_, i) => forecast.value?.hourly[i] ?? null))
const daily = computed<(WeatherDailyPoint | null)[]>(() => Array.from({ length: DAYS }, (_, i) => forecast.value?.daily[i] ?? null))
/** Échelle commune des barres de la semaine : le froid et le chaud de la semaine entière. */
const weekRange = computed(() => {
  const pts = daily.value.filter((p): p is WeatherDailyPoint => !!p)
  if (!pts.length) return { min: 0, max: 1 }
  return { min: Math.min(...pts.map((p) => p.minC)), max: Math.max(...pts.map((p) => p.maxC)) }
})
const barStyle = (p: WeatherDailyPoint) => {
  const span = Math.max(1, weekRange.value.max - weekRange.value.min)
  return { left: `${((p.minC - weekRange.value.min) / span) * 100}%`, width: `${Math.max(4, ((p.maxC - p.minC) / span) * 100)}%` }
}
const isToday = (tMs: number) => new Date(tMs).toDateString() === new Date(now.value).toDateString()

const aqiIndex = computed(() => (live.value?.aqiLevel ? AQI_LEVELS.indexOf(live.value.aqiLevel) : -1))
/** Couleurs du palier européen, du bon au très mauvais (échelle officielle EAQI). */
const AQI_COLORS = ['#50f0e6', '#50ccaa', '#f0e641', '#ff5050', '#960032', '#7d2181']
const pollens = computed(() => POLLEN_TYPES.map((type) => ({ type, level: live.value?.pollen?.[type] })))

const tiles = computed<{ key: string; icon: IconName; value: string; label: string }[]>(() => {
  const s = live.value
  return [
    { key: 'humidity', icon: 'droplet', value: opt(s?.humidity, ' %'), label: t('weather.humidity') },
    { key: 'pressure', icon: 'gauge', value: opt(s?.pressureHpa, ' hPa'), label: t('weather.pressure') },
    { key: 'uv', icon: 'sun', value: opt(s?.uvIndex, '', 'decimal1'), label: t('weather.uv') },
    { key: 'visibility', icon: 'fog', value: s?.visibilityM === undefined ? '—' : s.visibilityM >= 1000 ? `${n(s.visibilityM / 1000, 'integer')} km` : `${n(s.visibilityM, 'integer')} m`, label: t('weather.visibility') },
    { key: 'dew', icon: 'droplet', value: deg(s?.dewPointC), label: t('weather.dewPoint') },
    { key: 'cloud', icon: 'cloud', value: opt(s?.cloudCover, ' %'), label: t('weather.cloudCover') },
    { key: 'precip', icon: 'rain', value: opt(s?.precipMm, ' mm', 'decimal1'), label: t('weather.precip') },
  ]
})
</script>

<template>
  <div class="weather">
    <PageHeader />
    <div class="weather__scroll">
      <div v-if="!weather.entry.value" class="card card--soft empty muted">{{ $t('weather.noDevice') }}</div>
      <div class="weather__grid" :data-live="live ? '1' : '0'">
        <!-- Maintenant : la grande température et la condition ; ressenti et pluie du moment dessous -->
        <section class="card wx-now">
          <div class="wx-now__head"><span class="section-label">{{ $t('weather.now') }}</span><span class="muted small">{{ live ? $t('weather.observed', { time: d(new Date(live.observedAt), 'time') }) : '—' }}</span></div>
          <div class="wx-now__main">
            <StrokeIcon :name="icon" :size="64" class="wx-now__icon" />
            <div>
              <div class="wx-now__temp">{{ deg(live?.tempC) }}</div>
              <div class="wx-now__cond">{{ live ? $t(`weather.conditions.${live.condition}`) : '—' }}</div>
            </div>
          </div>
          <div class="wx-now__foot muted">
            <span>{{ $t('weather.feelsLike') }} {{ deg(live?.feelsLikeC) }}</span>
            <span>{{ $t('weather.precipProbability') }} {{ opt(live?.precipProbability, ' %') }}</span>
          </div>
        </section>

        <!-- Soleil : l'arc du jour -->
        <section class="card wx-sun">
          <div class="section-label">{{ $t('weather.sun') }}</div>
          <svg viewBox="0 0 200 104" class="wx-sun__arc" aria-hidden="true">
            <path d="M14 96 A86 86 0 0 1 186 96" fill="none" stroke="var(--line)" stroke-width="2" stroke-dasharray="3 5" />
            <path v-if="sun && sun.up" :d="`M14 96 A86 86 0 0 1 ${sun.x.toFixed(1)} ${sun.y.toFixed(1)}`" fill="none" stroke="var(--cat-light)" stroke-width="2.5" />
            <line x1="6" y1="96" x2="194" y2="96" stroke="var(--line)" />
            <circle v-if="sun && sun.up" :cx="sun.x" :cy="sun.y" r="7" fill="var(--cat-light)" />
          </svg>
          <div class="wx-sun__times">
            <div><div class="muted small">{{ $t('weather.sunrise') }}</div><div class="wx-sun__t">{{ live?.sunrise ? d(new Date(live.sunrise), 'time') : '—:—' }}</div></div>
            <div class="text-center"><div class="muted small">{{ $t('weather.dayLength') }}</div><div class="wx-sun__t">{{ sun ? formatMinutes(sun.lengthMin, locale) : '—' }}</div></div>
            <div class="text-right"><div class="muted small">{{ $t('weather.sunset') }}</div><div class="wx-sun__t">{{ live?.sunset ? d(new Date(live.sunset), 'time') : '—:—' }}</div></div>
          </div>
        </section>

        <!-- Vent : la rose, d'où il vient -->
        <section class="card wx-wind">
          <div class="section-label">{{ $t('weather.wind') }}</div>
          <div class="wx-wind__body">
            <svg viewBox="0 0 100 100" class="wx-wind__rose" aria-hidden="true">
              <circle cx="50" cy="50" r="44" fill="none" stroke="var(--line)" stroke-width="2" />
              <text x="50" y="14" text-anchor="middle" class="wx-wind__n">N</text>
              <g v-if="live" :transform="`rotate(${live.windDirDeg} 50 50)`">
                <path d="M50 12 L57 34 L50 29 L43 34 Z" fill="var(--accent)" />
                <line x1="50" y1="30" x2="50" y2="78" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" />
              </g>
            </svg>
            <div>
              <div class="wx-wind__speed">{{ opt(live?.windKmh, '') }}<span class="muted wx-wind__unit"> km/h</span></div>
              <div class="muted small">{{ live ? compassPoint(live.windDirDeg) : '—' }} · {{ $t('weather.gusts') }} {{ opt(live?.windGustKmh, ' km/h') }}</div>
            </div>
          </div>
        </section>

        <!-- 24 heures : une colonne par heure, toujours 24 -->
        <section class="card wx-hourly">
          <div class="section-label">{{ $t('weather.hourly') }}</div>
          <div class="wx-hourly__strip">
            <div v-for="(p, i) in hourly" :key="i" class="wx-hour">
              <div class="muted small">{{ p ? d(new Date(p.t), 'hour') : '—' }}</div>
              <StrokeIcon :name="p ? conditionIcon(p.condition, p.isDay) : 'cloud'" :size="22" :class="{ 'wx-dim': !p }" />
              <div class="wx-hour__temp">{{ p ? deg(p.tempC) : '—' }}</div>
              <div class="small wx-hour__rain" :data-on="p && (p.precipProbability ?? 0) >= 10 ? '1' : '0'">{{ p && p.precipProbability !== undefined ? `${n(p.precipProbability, 'integer')} %` : '·' }}</div>
            </div>
          </div>
        </section>

        <!-- 7 jours : jour, condition, pluie, plage min-max sur une échelle commune -->
        <section class="card wx-daily">
          <div class="section-label">{{ $t('weather.daily') }}</div>
          <div class="wx-daily__rows">
            <div v-for="(p, i) in daily" :key="i" class="wx-day">
              <div class="wx-day__name">{{ p ? (isToday(p.t) ? $t('weather.today') : d(new Date(p.t), 'weekday')) : '—' }}</div>
              <StrokeIcon :name="p ? conditionIcon(p.condition) : 'cloud'" :size="20" :class="{ 'wx-dim': !p }" />
              <div class="small wx-day__rain" :data-on="p && (p.precipProbability ?? 0) >= 10 ? '1' : '0'">{{ p && p.precipProbability !== undefined ? `${n(p.precipProbability, 'integer')} %` : '·' }}</div>
              <div class="wx-day__min muted">{{ p ? deg(p.minC) : '—' }}</div>
              <div class="wx-day__track"><div v-if="p" class="wx-day__bar" :style="barStyle(p)" /></div>
              <div class="wx-day__max">{{ p ? deg(p.maxC) : '—' }}</div>
            </div>
          </div>
        </section>

        <!-- Détails : le reste des grandeurs, en liste sobre — une ligne par mesure, hauteur fixe -->
        <div class="wx-bottom">
        <section class="card wx-details">
          <div class="section-label">{{ $t('weather.details') }}</div>
          <div class="wx-details__rows">
            <div v-for="tile in tiles" :key="tile.key" class="wx-detail">
              <StrokeIcon :name="tile.icon" :size="18" class="wx-detail__icon" />
              <span class="muted wx-detail__label">{{ tile.label }}</span>
              <span class="wx-detail__value">{{ tile.value }}</span>
            </div>
          </div>
        </section>

        <!-- Air et pollens : seulement si le fournisseur les donne (capacités) -->
        <div class="wx-side">
        <section v-if="caps.has('air_quality')" class="card wx-air">
          <div class="section-label">{{ $t('weather.airQuality') }}</div>
          <div class="wx-air__body">
            <div class="wx-air__value">{{ opt(live?.aqi, '') }}</div>
            <div>
              <div class="wx-air__level">{{ live?.aqiLevel ? $t(`weather.aqi.${live.aqiLevel}`) : '—' }}</div>
              <div class="muted small">EAQI</div>
            </div>
          </div>
          <div class="wx-air__scale">
            <span v-for="(c, i) in AQI_COLORS" :key="i" :style="{ background: c }" :data-on="i === aqiIndex ? '1' : '0'" />
          </div>
        </section>
        <section v-if="caps.has('pollen')" class="card wx-pollen">
          <div class="section-label">{{ $t('weather.pollen') }}</div>
          <div class="wx-pollen__rows">
            <div v-for="p in pollens" :key="p.type" class="wx-pollen__row">
              <div class="wx-pollen__name">{{ $t(`weather.pollens.${p.type}`) }}</div>
              <div class="wx-pollen__dots"><span v-for="k in 4" :key="k" :data-on="p.level !== undefined && k <= p.level ? '1' : '0'" /></div>
              <div class="muted small wx-pollen__level">{{ p.level === undefined ? '—' : $t(`weather.pollenLevels[${p.level}]`) }}</div>
            </div>
          </div>
        </section>
        </div>

        <div class="muted small wx-credit">
          <template v-if="weather.descriptor.value?.meta.weather">{{ $t('weather.attribution', { source: weather.descriptor.value.meta.weather.attribution }) }}<template v-if="weather.descriptor.value.meta.weather.model"> · {{ $t('weather.model', { model: weather.descriptor.value.meta.weather.model }) }}</template> · </template>
          {{ $t('weather.radarHint') }} · {{ $t('weather.radarSource') }}
        </div>
        </div>

        <!-- Radar des précipitations, centré sur la maison -->
        <section class="wx-radar">
          <RainRadar v-if="home" :home="home" />
        </section>

      </div>
    </div>
  </div>
</template>

<style scoped>
.weather { height: 100%; display: flex; flex-direction: column; }
.weather__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
.small { font-size: 12px; }
.weather__grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px; }
/* les sections de la grille, directes ou dans un bloc transparent (`.wx-side`, `.wx-bottom`) : mêmes marges, même largeur par défaut */
.weather__grid > section, .wx-side > section, .wx-bottom > section { grid-column: span 12; padding: 18px 20px; min-width: 0; }
@media (min-width: 760px) {
  .wx-now { grid-column: span 6 !important; } .wx-sun { grid-column: span 6 !important; }
  .wx-daily, .wx-details, .wx-air, .wx-pollen { grid-column: span 6 !important; }
}
@media (min-width: 1100px) {
  .wx-now { grid-column: span 5 !important; } .wx-sun { grid-column: span 4 !important; } .wx-wind { grid-column: span 3 !important; }
  .wx-daily { grid-column: span 7 !important; } .wx-details { grid-column: span 5 !important; }
  .wx-air { grid-column: span 5 !important; } .wx-pollen { grid-column: span 7 !important; }
}
/* indisponible : tout reste en place, en grisé */
.weather__grid[data-live='0'] .wx-now__main, .weather__grid[data-live='0'] .wx-wind__body { opacity: .45; }
.wx-dim { opacity: .3; }

.wx-now { display: flex; flex-direction: column; gap: 14px; min-height: 196px; }
.wx-now__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.wx-now__main { display: flex; align-items: center; gap: 20px; flex: 1 1 auto; }
.wx-now__icon { color: var(--cat-light); flex: 0 0 auto; }
.wx-now__temp { font-size: 56px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
.wx-now__cond { font-size: 16px; margin-top: 6px; }
.wx-now__foot { display: flex; gap: 18px; font-size: 13px; }

.wx-sun { display: flex; flex-direction: column; gap: 6px; min-height: 196px; }
.wx-sun__arc { width: 100%; height: 96px; display: block; }
.wx-sun__times { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; }
.wx-sun__t { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }

.wx-wind { display: flex; flex-direction: column; gap: 10px; min-height: 196px; }
.wx-wind__body { display: flex; align-items: center; gap: 16px; flex: 1 1 auto; }
.wx-wind__rose { width: 96px; height: 96px; flex: 0 0 auto; }
.wx-wind__n { font: 600 12px var(--font); fill: var(--muted); }
.wx-wind__speed { font-size: 32px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
.wx-wind__unit { font-size: 14px; font-weight: 500; }

.wx-hourly__strip { display: grid; grid-template-columns: repeat(24, minmax(46px, 1fr)); gap: 4px; margin-top: 12px; overflow-x: auto; padding-bottom: 4px; }
.wx-hour { display: grid; grid-template-rows: 16px 26px 20px 16px; justify-items: center; align-items: center; row-gap: 4px; min-width: 46px; }
.wx-hour__temp { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wx-hour__rain, .wx-day__rain { color: transparent; font-variant-numeric: tabular-nums; }
.wx-hour__rain[data-on='1'], .wx-day__rain[data-on='1'] { color: var(--cat-media); }

.wx-daily__rows { display: grid; gap: 6px; margin-top: 12px; }
.wx-day { display: grid; grid-template-columns: 52px 24px 44px 40px 1fr 40px; align-items: center; gap: 8px; height: 30px; }
.wx-day__name { font-size: 13px; font-weight: 500; text-transform: capitalize; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wx-day__min, .wx-day__max { font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; }
.wx-day__max { font-weight: 600; }
.wx-day__track { position: relative; height: 6px; border-radius: 3px; background: var(--line); }
.wx-day__bar { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: linear-gradient(90deg, var(--cat-media), var(--cat-light)); }

.wx-details__rows { display: grid; gap: 4px; margin-top: 10px; }
.wx-detail { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 10px; height: 32px; }
.wx-detail__icon { color: var(--muted); }
.wx-detail__label { font-size: 13px; }
.wx-detail__value { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }

.wx-air { display: flex; flex-direction: column; gap: 14px; }
.wx-air__body { display: flex; align-items: center; gap: 16px; }
.wx-air__value { font-size: 40px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; min-width: 64px; }
.wx-air__level { font-size: 16px; font-weight: 500; }
.wx-air__scale { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; height: 10px; }
.wx-air__scale span { border-radius: 3px; opacity: .35; transition: opacity .2s; }
.wx-air__scale span[data-on='1'] { opacity: 1; outline: 2px solid var(--text); outline-offset: 1px; }

.wx-pollen__rows { display: grid; gap: 8px; margin-top: 8px; }
.wx-pollen__row { display: grid; grid-template-columns: 96px 1fr 84px; align-items: center; gap: 10px; height: 22px; }
.wx-pollen__name { font-size: 13px; }
.wx-pollen__dots { display: flex; gap: 5px; }
.wx-pollen__dots span { width: 12px; height: 12px; border-radius: 50%; background: var(--line); }
.wx-pollen__dots span[data-on='1'] { background: var(--cat-light); }
.wx-pollen__level { text-align: right; }

.wx-radar { padding: 0 !important; height: 400px; }
.wx-radar > * { height: 100%; }
/* en flux, le crédit ferme la page (l'`order` le passe derrière le radar malgré sa place dans le DOM) */
.wx-credit { grid-column: span 12; text-align: center; order: 99; }
/* en flux, le bloc « bas gauche » est transparent : détails, air, pollens et crédit gardent leur place dans la grille */
.wx-bottom { display: contents; }
/* en flux, la colonne air/pollens est transparente : ses deux cartes gardent leur place dans la grille */
.wx-side { display: contents; }

/* TOUT TIENT SANS DÉFILER : sur un écran large et assez haut (1920 × 945 est le cas visé), la
   SEMAINE prend le haut à droite, à côté de l'instant et des 24 heures ; la troisième rangée aligne
   détails, air et pollens à gauche, et le radar ferme la page en bas à droite, dans la hauteur qui
   reste. Les blocs gardent leurs tailles ; seule la disposition change. Le crédit monte dans
   l'en-tête pour ne pas coûter une rangée. */
@media (min-width: 1400px) and (min-height: 820px) {
  .weather__scroll { display: flex; flex-direction: column; overflow: hidden; gap: 0; }
  .weather__grid { flex: 1 1 auto; min-height: 0; grid-template-rows: auto auto minmax(0, 1fr); gap: 16px; align-content: start; }
  .wx-now { grid-column: 1 / 4 !important; grid-row: 1; }
  .wx-sun { grid-column: 4 / 6 !important; grid-row: 1; }
  .wx-wind { grid-column: 6 / 8 !important; grid-row: 1; }
  .wx-hourly { grid-column: 1 / 8 !important; grid-row: 2; }
  .wx-hourly__strip { grid-template-columns: repeat(24, minmax(36px, 1fr)); gap: 2px; overflow: hidden; padding-bottom: 0; }
  .wx-hour { min-width: 36px; }
  .wx-hour__rain { font-size: 11px; }
  /* la semaine en haut à droite, sur la hauteur des deux premières rangées : ses lignes s'espacent pour la remplir */
  .wx-daily { grid-column: 8 / 13 !important; grid-row: 1 / 3; min-height: 0; }
  .wx-daily__rows { gap: 6px; margin-top: 12px; }
  .wx-day { height: 38px; }
  /* détails resserrés sur deux colonnes ; air et pollens à leur droite ; les deux blocs de DROITE
     (semaine, radar) partagent les mêmes colonnes, donc le même bord gauche */
  .wx-bottom { display: grid; grid-column: 1 / 8; grid-row: 3; grid-template-columns: 2fr 5fr; grid-template-rows: auto minmax(0, 1fr); gap: 16px; align-items: start; min-height: 0; }
  .wx-details { grid-column: 1 !important; grid-row: 1; }
  .wx-side { display: grid; grid-column: 2; grid-row: 1; grid-template-columns: 2fr 3fr; gap: 16px; }
  /* les attributions en bas à gauche, sous les détails : la place y est */
  .wx-credit { grid-column: 1 / 3; grid-row: 2; align-self: end; text-align: left; order: 0; }
  .wx-pollen__row { grid-template-columns: 84px auto 1fr; }
  /* la carte ferme la page : en bas à droite, dans la hauteur qui reste, alignée sur la semaine */
  .wx-radar { grid-column: 8 / 13 !important; grid-row: 3; height: auto; min-height: 0; }
  .wx-air { grid-column: auto !important; }
  .wx-pollen { grid-column: auto !important; }
}
</style>
