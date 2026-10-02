<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { AQI_LEVELS, POLLEN_TYPES, type WeatherDailyPoint, type WeatherHourlyPoint } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import MoonDisc from '../components/weather/MoonDisc.vue'
import RainRadar from '../components/weather/RainRadar.vue'
import WeatherPlaces from '../components/weather/WeatherPlaces.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useForecast, useWeather, useWeatherAlerts, useWeatherAt, useWeatherPlaces } from '../composables/useWeather'
import { formatMinutes } from '../lib/format'
import type { IconName } from '../lib/strokeIcons'
import { moonIllumination, moonPhaseName, moonTimes, nextPhase } from '../lib/moon'
import { compassPoint, conditionIcon } from '../lib/weather'
import type { WeatherAlert } from '../api/transport'
import { useHouseStore } from '../stores/house'
import { useAlertsStore } from '../stores/alerts'

// Vue Météo : tout ce que l'appareil météo sait. L'actuel en grand, le soleil, le vent, les 24
// prochaines heures, la semaine, l'air et les pollens, les grandeurs secondaires en tuiles, la
// carte des précipitations. Chaque bloc a une TAILLE FIXE quelle que soit la donnée : sans
// prévisions, la bande horaire garde ses 24 colonnes et la semaine ses 7 lignes, avec des tirets.
const { d, n, t, locale } = useI18n()
const house = useHouseStore()
const weather = useWeather()
const { forecast: homeForecast } = useForecast(computed(() => weather.entry.value?.descriptor.id))
// Ailleurs qu'à la maison (barre de lieux de l'en-tête) : même mise en page, données lues à la demande.
const places = useWeatherPlaces()
const place = places.selected
const elsewhere = useWeatherAt(place)
const live = computed(() => (place.value ? elsewhere.data.value?.state : weather.live.value))
const forecast = computed(() => (place.value ? elsewhere.data.value?.forecast ?? null : homeForecast.value))
/** Ailleurs, Open-Meteo donne toujours air et pollens (des tirets hors d'Europe) : les cartes restent en place. */
const caps = computed(() => new Set(place.value ? ['forecast', 'air_quality', 'pollen'] : weather.descriptor.value?.capabilities ?? []))
const attribution = computed(() => (place.value ? elsewhere.data.value?.attribution : weather.descriptor.value?.meta.weather?.attribution))
const model = computed(() => (place.value ? undefined : weather.descriptor.value?.meta.weather?.model))
/** Fuseau du lieu affiché ; `undefined` = celui de la tablette (la maison). */
const tz = computed(() => (place.value ? elsewhere.data.value?.timezone : undefined))
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone
/** Une heure du lieu affiché, dans SON fuseau : le lever à Tokyo est celui de Tokyo. */
const fd = (ms: number, key: 'time' | 'hour' | 'weekday' | 'date') => d(new Date(ms), tz.value ? { key, timeZone: tz.value } : key)
/** L'heure du relevé ; ailleurs, avec le décalage quand le fuseau n'est pas celui de la tablette. */
const observed = (ms: number) => (tz.value && tz.value !== localTz ? d(new Date(ms), { key: 'time', timeZone: tz.value, timeZoneName: 'short' }) : fd(ms, 'time'))

const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

const home = computed(() => (place.value ? { lat: place.value.lat, lon: place.value.lon } : house.house ? { lat: house.house.origin.lat, lon: house.house.origin.lon } : undefined))
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

// Lune : calculée ici (Open-Meteo n'en dit rien), pour le lieu affiché.
const moon = computed(() => {
  const at = home.value
  if (!at) return null
  const { fraction, phase } = moonIllumination(now.value)
  const full = nextPhase(now.value, 0.5)
  const fresh = nextPhase(now.value, 0)
  return {
    name: moonPhaseName(phase), fraction, phase, south: at.lat < 0,
    times: moonTimes(now.value, at.lat, at.lon),
    next: full < fresh ? { key: 'nextFull', t: full } : { key: 'nextNew', t: fresh },
  }
})

const HOURS = 24
const DAYS = 7
const hourly = computed<(WeatherHourlyPoint | null)[]>(() => Array.from({ length: HOURS }, (_, i) => forecast.value?.hourly[i] ?? null))
const daily = computed<(WeatherDailyPoint | null)[]>(() => Array.from({ length: DAYS }, (_, i) => forecast.value?.daily[i] ?? null))
// Tendance des 24 heures, d'un coup d'œil : la courbe des températures (lissée) et les pluies en
// barres, sous les colonnes, sur la même grille ; la nuit en fond. Unités du tracé : 10 par heure
// en largeur, des pixels en hauteur (bande de TREND_H px).
const TREND_H = 48
/** Teinte d'une température, sur une échelle FIXE (5 °C froid → 28 °C chaud) : la couleur dit le chaud, pas le rang dans la journée. */
const tempTint = (c: number) => `color-mix(in oklab, var(--cat-light) ${Math.round(Math.min(1, Math.max(0, (c - 5) / 23)) * 100)}%, var(--cat-media))`
/** Hauteur d'une barre de pluie (px) : racine des millimètres, plafond 4 mm/h. */
const rainH = (mm: number) => Math.sqrt(Math.min(1, mm / 4)) * (TREND_H - 6)
/** Graduations de la pluie, montrées seulement quand il pleut dans les 24 heures. */
const RAIN_TICKS = [1, 4].map((mm) => ({ mm, y: TREND_H - rainH(mm) }))
const trend = computed(() => {
  const pts = hourly.value
  if (pts.some((p) => !p)) return null
  const ps = pts as WeatherHourlyPoint[]
  const temps = ps.map((p) => p.tempC)
  const lo = Math.min(...temps)
  const span = Math.max(3, Math.max(...temps) - lo)
  const x = (i: number) => i * 10 + 5
  // hors des bords, la première et la dernière heure se répètent
  const y = (i: number) => 4 + (1 - (temps[Math.min(HOURS - 1, Math.max(0, i))]! - lo) / span) * (TREND_H - 12)
  // Catmull-Rom → Bézier : la courbe passe par chaque heure sans angles
  let line = `M${x(0)} ${y(0).toFixed(1)}`
  for (let i = 0; i < HOURS - 1; i++) {
    const dx = 10 / 3 // (x(i + 1) - x(i - 1)) / 6, constant : les heures sont équidistantes
    line += ` C${x(i) + dx} ${(y(i) + (y(i + 1) - y(i - 1)) / 6).toFixed(1)} ${x(i + 1) - dx} ${(y(i + 1) - (y(i + 2) - y(i)) / 6).toFixed(1)} ${x(i + 1)} ${y(i + 1).toFixed(1)}`
  }
  const area = `${line} L${x(HOURS - 1)} ${TREND_H} L${x(0)} ${TREND_H} Z`
  // pluie : hauteur selon les millimètres (racine, plafond 4 mm/h : la bruine se voit encore),
  // opacité selon la probabilité
  const rain = ps.filter((p) => p.precipMm >= 0.1).map((p) => ({ x: ps.indexOf(p) * 10 + 2, h: Math.max(3, rainH(p.precipMm)), o: 0.15 + 0.4 * ((p.precipProbability ?? 100) / 100) }))
  // le plus froid et le plus chaud (première occurrence) : un point sur la courbe
  const iMin = temps.indexOf(lo)
  const iMax = temps.indexOf(Math.max(...temps))
  const ext = [{ kind: 'min', i: iMin, y: y(iMin) }, { kind: 'max', i: iMax, y: y(iMax) }]
  // nuit : les heures consécutives sans soleil, en une seule bande chacune
  const nights: { x: number; w: number }[] = []
  ps.forEach((p, i) => {
    if (p.isDay) return
    const last = nights[nights.length - 1]
    if (last && last.x + last.w === i) last.w++
    else nights.push({ x: i, w: 1 })
  })
  const tints = temps.map((c, i) => ({ offset: (i + 0.5) / 24, color: tempTint(c) }))
  return { line, area, rain, nights, tints, ext, iMin, iMax }
})
/** La lune de chaque jour de la semaine, prise à midi (le jour commence à minuit local). */
const dailyMoon = computed(() => daily.value.map((p) => (p ? moonIllumination(p.t + 12 * 3_600_000) : null)))
/** Libellé au survol d'un disque de la semaine : la phase et sa part éclairée. */
const moonTitle = (m: { fraction: number; phase: number }) => `${t(`weather.moon.phases.${moonPhaseName(m.phase)}`)} · ${t('weather.moon.lit', { n: n(Math.round(m.fraction * 100), 'integer') })}`
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
const dayOf = (ms: number) => new Date(ms).toLocaleDateString('en-CA', tz.value ? { timeZone: tz.value } : {})
const isToday = (tMs: number) => dayOf(tMs) === dayOf(now.value)

// Vigilance Météo-France du département du lieu affiché (métropole seule) : une ligne, la plus
// forte en cours d'abord ; les autres au survol. La ligne garde sa place même sans vigilance.
const alerts = useWeatherAlerts(home)
// une vigilance orange de la MAISON reste signalée sur le rail tant qu'on ne l'a pas masquée ici
const railAlerts = useAlertsStore()
const closable = computed(() => (place.value || !weather.entry.value ? [] : railAlerts.closableFor(weather.entry.value.descriptor.id)))
/** « minuit » pour la fin du jour, l'heure pour aujourd'hui, le jour et l'heure au-delà. */
const when = (ms: number) => (isToday(ms - 1) && !isToday(ms) ? t('weather.alerts.midnight') : isToday(ms) ? fd(ms, 'time') : `${fd(ms, 'weekday')} ${fd(ms, 'time')}`)
const alertText = (w: WeatherAlert) => {
  const on = w.onset <= now.value
  const label = t('weather.alerts.label', { level: t(`weather.alerts.levels.${w.level}`), type: t(`weather.alerts.types.${w.type}`) })
  return `${label} · ${t(on ? 'weather.alerts.until' : 'weather.alerts.from', { when: when(on ? w.expires : w.onset) })}`
}
const alert = computed(() => {
  const a = alerts.data.value
  if (!a) return null
  if (!a.area) return { level: 'none', text: t('weather.alerts.notCovered'), more: 0, title: undefined }
  const ws = a.warnings.filter((w) => w.expires > now.value)
  const title = [a.area, ...ws.map(alertText)].join('\n')
  if (!ws.length) return { level: 'green', text: t('weather.alerts.none'), more: 0, title }
  return { level: ws[0]!.level, text: alertText(ws[0]!), more: ws.length - 1, title }
})

const aqiIndex = computed(() => (live.value?.aqiLevel ? AQI_LEVELS.indexOf(live.value.aqiLevel) : -1))
/** Couleurs du palier européen, du bon au très mauvais (échelle officielle EAQI). */
const AQI_COLORS = ['#50f0e6', '#50ccaa', '#f0e641', '#ff5050', '#960032', '#7d2181']
/** Plages de l'indice européen, palier par palier (0-20 bon … au-delà de 100 extrêmement mauvais). */
const AQI_RANGES = ['0 – 20', '20 – 40', '40 – 60', '60 – 80', '80 – 100', '> 100']
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
    <PageHeader class="wx-header"><WeatherPlaces class="wx-header__places" /></PageHeader>
    <div class="weather__scroll">
      <div v-if="!place && !weather.entry.value" class="card card--soft empty muted">{{ $t('weather.noDevice') }}</div>
      <div class="weather__grid" :data-live="live ? '1' : '0'">
        <!-- Maintenant : la grande température et la condition ; ressenti et pluie du moment dessous -->
        <section class="card wx-now">
          <!-- le lieu affiché, en toutes lettres : la maison ou le lieu choisi, sa région en retrait -->
          <div class="wx-now__head">
            <span class="wx-now__place" :title="place?.region ? `${place.name} — ${place.region}` : undefined">
              <StrokeIcon :name="place ? 'pin' : 'home'" :size="16" class="wx-now__pin" />
              <span class="wx-now__name">{{ place ? place.name : $t('weather.home') }}</span>
              <span v-if="place?.region" class="muted small wx-now__region">{{ place.region }}</span>
            </span>
            <span class="muted small wx-now__obs">{{ live ? $t('weather.observed', { time: observed(live.observedAt) }) : place && elsewhere.failed.value ? $t('weather.placeFailed') : '—' }}</span>
          </div>
          <div class="wx-now__main">
            <StrokeIcon :name="icon" :size="64" class="wx-now__icon" />
            <div>
              <div class="wx-now__temp">{{ deg(live?.tempC) }}</div>
              <div class="wx-now__cond">{{ live ? $t(`weather.conditions.${live.condition}`) : '—' }}</div>
            </div>
          </div>
          <!-- vigilance du département : place réservée, vide pendant la lecture -->
          <div class="wx-alert-row">
            <div class="small wx-alert" :data-level="alert?.level ?? 'none'" :title="alert?.title">
              <template v-if="alert">
                <span class="wx-alert__dot" />
                <span class="wx-alert__text">{{ alert.text }}</span>
                <span v-if="alert.more" class="wx-alert__more">+{{ alert.more }}</span>
              </template>
            </div>
            <!-- une croix plutôt qu'un mot : à 375 px, « Masquer » rognait la vigilance elle-même -->
            <button v-if="closable.length" type="button" class="wx-alert__dismiss" :title="$t('alerts.dismissHint')" :aria-label="$t('alerts.dismissHint')" @click="railAlerts.dismiss(closable)">
              <StrokeIcon name="close" :size="14" />
            </button>
          </div>
          <div class="wx-now__foot muted">
            <span>{{ $t('weather.feelsLike') }} {{ deg(live?.feelsLikeC) }}</span>
            <span>{{ $t('weather.precipProbability') }} {{ opt(live?.precipProbability, ' %') }}</span>
          </div>
        </section>

        <!-- Soleil : l'arc du jour -->
        <section class="card wx-sun">
          <div class="section-label">{{ $t('weather.sunMoon') }}</div>
          <svg viewBox="0 0 200 104" class="wx-sun__arc" aria-hidden="true">
            <path d="M14 96 A86 86 0 0 1 186 96" fill="none" stroke="var(--line)" stroke-width="2" stroke-dasharray="3 5" />
            <path v-if="sun && sun.up" :d="`M14 96 A86 86 0 0 1 ${sun.x.toFixed(1)} ${sun.y.toFixed(1)}`" fill="none" stroke="var(--cat-light)" stroke-width="2.5" />
            <line x1="6" y1="96" x2="194" y2="96" stroke="var(--line)" />
            <circle v-if="sun && sun.up" :cx="sun.x" :cy="sun.y" r="7" fill="var(--cat-light)" />
          </svg>
          <div class="wx-sun__times">
            <div><div class="muted small">{{ $t('weather.sunrise') }}</div><div class="wx-sun__t">{{ live?.sunrise ? fd(live.sunrise, 'time') : '—:—' }}</div></div>
            <div class="text-center"><div class="muted small">{{ $t('weather.dayLength') }}</div><div class="wx-sun__t">{{ sun ? formatMinutes(sun.lengthMin, locale) : '—' }}</div></div>
            <div class="text-right"><div class="muted small">{{ $t('weather.sunset') }}</div><div class="wx-sun__t">{{ live?.sunset ? fd(live.sunset, 'time') : '—:—' }}</div></div>
          </div>
          <!-- la lune, sous un filet : sa phase dessinée, sa part éclairée, ses prochains passages -->
          <div class="wx-moon">
            <MoonDisc class="wx-moon__disc" :fraction="moon?.fraction ?? 0" :phase="moon?.phase ?? 0" :south="moon?.south" />
            <div class="wx-moon__text">
              <div class="wx-moon__head">
                <span class="wx-moon__name">{{ moon ? $t(`weather.moon.phases.${moon.name}`) : '—' }}</span>
                <span class="muted small">{{ moon ? $t('weather.moon.lit', { n: n(Math.round(moon.fraction * 100), 'integer') }) : '' }}</span>
              </div>
              <div class="muted small wx-moon__line">
                {{ $t('weather.moon.rise') }} {{ moon?.times.rise ? fd(moon.times.rise, 'time') : '—:—' }} · {{ $t('weather.moon.set') }} {{ moon?.times.set ? fd(moon.times.set, 'time') : '—:—' }}
              </div>
              <div class="muted small wx-moon__line">{{ moon ? $t(`weather.moon.${moon.next.key}`, { date: fd(moon.next.t, 'date') }) : '—' }}</div>
            </div>
          </div>
        </section>

        <!-- Vent : la rose pointe là où il souffle (comme la houle de la piscine en 3D) ; le libellé dit d'où il vient -->
        <section class="card wx-wind">
          <div class="section-label">{{ $t('weather.wind') }}</div>
          <div class="wx-wind__body">
            <svg viewBox="0 0 100 100" class="wx-wind__rose" aria-hidden="true">
              <circle cx="50" cy="50" r="44" fill="none" stroke="var(--line)" stroke-width="2" />
              <text x="50" y="14" text-anchor="middle" class="wx-wind__n">N</text>
              <g v-if="live" :transform="`rotate(${live.windDirDeg + 180} 50 50)`">
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
            <!-- la nuit, en fond sur toute la hauteur des colonnes et de la courbe -->
            <svg class="wx-trend__night" viewBox="0 0 24 1" preserveAspectRatio="none" aria-hidden="true">
              <rect v-for="(b, i) in trend?.nights ?? []" :key="i" :x="b.x" y="0" :width="b.w" height="1" />
            </svg>
            <!-- la tendance : la bande garde sa hauteur même sans prévisions -->
            <div class="wx-trend">
            <svg :viewBox="`0 0 240 ${TREND_H}`" preserveAspectRatio="none" aria-hidden="true">
              <template v-if="trend">
                <template v-if="trend.rain.length">
                  <line v-for="tk in RAIN_TICKS" :key="tk.mm" class="wx-trend__tick" x1="0" :y1="tk.y" x2="240" :y2="tk.y" vector-effect="non-scaling-stroke" />
                </template>
                <!-- la couleur suit la température de chaque heure, de gauche à droite -->
                <defs>
                  <linearGradient id="wx-trend-tint" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="240" y2="0">
                    <stop v-for="(s, i) in trend.tints" :key="i" :offset="s.offset" :style="{ stopColor: s.color }" />
                  </linearGradient>
                </defs>
                <rect v-for="(r, i) in trend.rain" :key="i" class="wx-trend__rain" :x="r.x" :y="TREND_H - r.h" width="6" :height="r.h" :opacity="r.o" />
                <path :d="trend.area" fill="url(#wx-trend-tint)" fill-opacity=".14" />
                <path :d="trend.line" fill="none" stroke="url(#wx-trend-tint)" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke" />
              </template>
            </svg>
            <!-- en HTML : un cercle dans un SVG étiré deviendrait une ellipse -->
            <template v-if="trend">
              <span v-for="e in trend.ext" :key="e.kind" class="wx-trend__dot" :data-kind="e.kind" :style="{ left: `${((e.i + 0.5) / HOURS) * 100}%`, top: `${e.y}px` }" />
              <template v-if="trend.rain.length">
                <span v-for="tk in RAIN_TICKS" :key="tk.mm" class="wx-trend__tick-label" :style="{ top: `${tk.y}px` }">{{ n(tk.mm, 'integer') }} mm</span>
              </template>
            </template>
            </div>
            <div v-for="(p, i) in hourly" :key="i" class="wx-hour" :style="{ gridColumn: i + 1 }">
              <div class="muted small">{{ p ? fd(p.t, 'hour') : '—' }}</div>
              <StrokeIcon :name="p ? conditionIcon(p.condition, p.isDay) : 'cloud'" :size="22" :class="{ 'wx-dim': !p }" />
              <div class="wx-hour__temp" :data-ext="i === trend?.iMin ? 'min' : i === trend?.iMax ? 'max' : undefined">{{ p ? deg(p.tempC) : '—' }}</div>
              <div class="small wx-hour__rain" :data-on="p && (p.precipProbability ?? 0) >= 10 ? '1' : '0'">{{ p && p.precipProbability !== undefined ? `${n(p.precipProbability, 'integer')} %` : '·' }}</div>
            </div>
          </div>
        </section>

        <!-- 7 jours : jour, condition, pluie, plage min-max sur une échelle commune -->
        <section class="card wx-daily">
          <div class="section-label">{{ $t('weather.daily') }}</div>
          <div class="wx-daily__rows">
            <div v-for="(p, i) in daily" :key="i" class="wx-day">
              <div class="wx-day__name">
                <template v-if="p && isToday(p.t)"><span class="wx-day__long">{{ $t('weather.today') }}</span><span class="wx-day__short">{{ $t('weather.todayShort') }}</span></template>
                <template v-else>{{ p ? fd(p.t, 'weekday') : '—' }}</template>
              </div>
              <StrokeIcon :name="p ? conditionIcon(p.condition) : 'cloud'" :size="20" :class="{ 'wx-dim': !p }" />
              <div class="small wx-day__rain" :data-on="p && (p.precipProbability ?? 0) >= 10 ? '1' : '0'">{{ p && p.precipProbability !== undefined ? `${n(p.precipProbability, 'integer')} %` : '·' }}</div>
              <div class="wx-day__moon" :title="dailyMoon[i] ? moonTitle(dailyMoon[i]!) : undefined">
                <MoonDisc v-if="dailyMoon[i]" :fraction="dailyMoon[i]!.fraction" :phase="dailyMoon[i]!.phase" :south="(home?.lat ?? 0) < 0" />
              </div>
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
          <!-- légende, poussée au bas de la carte et discrète : les six paliers et leurs plages, celui du moment en évidence -->
          <div class="wx-legend">
            <div class="wx-air__legend">
              <div v-for="(lvl, i) in AQI_LEVELS" :key="lvl" class="wx-air__row" :data-on="i === aqiIndex ? '1' : '0'">
                <span class="wx-air__dot" :style="{ background: AQI_COLORS[i] }" />
                <span class="wx-air__name">{{ $t(`weather.aqi.${lvl}`) }}</span>
                <span class="wx-air__range">{{ AQI_RANGES[i] }}</span>
              </div>
            </div>
            <div>{{ $t('weather.aqiExplain') }}</div>
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
          <!-- légende, poussée au bas de la carte : un point par cran, et ce que mesure l'indice -->
          <div class="wx-legend">
            <div class="wx-pollen__legend">
              <span v-for="k in 4" :key="k" class="wx-pollen__key">
                <span class="wx-pollen__dots"><span v-for="j in k" :key="j" data-on="1" /></span>{{ $t(`weather.pollenLevels[${k}]`) }}
              </span>
            </div>
            <div>{{ $t('weather.pollenExplain') }}</div>
          </div>
        </section>
        </div>

        </div>

        <!-- Radar des précipitations, centré sur la maison -->
        <section class="wx-radar">
          <RainRadar v-if="home" :home="home" :away="!!place" />
        </section>

        <!-- le crédit ferme la page ; écran large : sous le radar, seul bloc qui sait céder de la hauteur -->
        <div class="muted small wx-credit">
          <template v-if="attribution">{{ $t('weather.attribution', { source: attribution }) }}<template v-if="model"> · {{ $t('weather.model', { model }) }}</template> · </template>
          <template v-if="alerts.data.value?.area">{{ $t('weather.alerts.source', { source: alerts.data.value.attribution }) }} · </template>
          {{ $t('weather.radarHint') }} · {{ $t('weather.radarSource') }}
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.weather { height: 100%; display: flex; flex-direction: column; }
.weather__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
/* étroit : les lieux passent sous le titre, sur toute la largeur — pastilles à gauche, recherche à droite */
@media (max-width: 1100px) {
  .wx-header { flex-wrap: wrap; row-gap: 10px; }
  .wx-header__places { flex: 1 1 100%; justify-content: space-between; }
}
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
.wx-now__head { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-width: 0; height: 22px; }
.wx-now__place { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; }
.wx-now__pin { color: var(--accent); flex: 0 0 auto; align-self: center; }
.wx-now__name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
.wx-now__region { overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
.wx-now__obs { flex: 0 0 auto; white-space: nowrap; }
.wx-now__main { display: flex; align-items: center; gap: 20px; flex: 1 1 auto; }
.wx-now__icon { color: var(--cat-light); flex: 0 0 auto; }
.wx-now__temp { font-size: 56px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
.wx-now__cond { font-size: 16px; margin-top: 6px; }
.wx-now__foot { display: flex; gap: 18px; font-size: 13px; }
/* vigilance : une pastille teintée de sa couleur, hauteur fixe ; la croix qui la masque à côté, dans la même rangée */
.wx-alert-row { display: flex; align-items: center; gap: 4px; height: 24px; min-width: 0; max-width: 100%; align-self: flex-start; }
.wx-alert__dismiss { flex: none; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 12px; background: none; color: var(--muted); cursor: pointer; }
.wx-alert__dismiss:hover { color: var(--text); background: var(--surface2); }
.wx-alert { display: flex; align-items: center; gap: 8px; height: 24px; min-width: 0; max-width: 100%; flex: 0 1 auto; padding: 0 10px; border-radius: 12px; color: var(--muted); }
.wx-alert[data-level='yellow'] { --alert: #f2c200; }
.wx-alert[data-level='orange'] { --alert: #ff8a00; }
.wx-alert[data-level='red'] { --alert: #e8322c; }
.wx-alert[data-level='green'] { --alert: #3fb950; }
.wx-alert[data-level='yellow'], .wx-alert[data-level='orange'], .wx-alert[data-level='red'] { background: color-mix(in srgb, var(--alert) 18%, transparent); color: var(--text); font-weight: 600; }
.wx-alert[data-level='none'] { padding: 0; }
.wx-alert__dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--alert, var(--line)); }
.wx-alert__text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.wx-alert__more { flex: 0 0 auto; opacity: .7; }

.wx-sun { display: flex; flex-direction: column; gap: 6px; min-height: 196px; }
.wx-sun__arc { width: 100%; height: 96px; display: block; }
.wx-sun__times { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; }
.wx-sun__t { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wx-moon { display: flex; align-items: center; gap: 12px; margin-top: 2px; padding-top: 8px; border-top: 1px solid var(--line); min-width: 0; }
.wx-moon__disc { width: 32px; height: 32px; flex: 0 0 auto; }
.wx-moon__text .small { line-height: 1.35; }
.wx-moon__text { min-width: 0; flex: 1 1 auto; display: grid; gap: 2px; }
.wx-moon__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.wx-moon__name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wx-moon__head .small, .wx-moon__line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

.wx-wind { display: flex; flex-direction: column; gap: 10px; min-height: 196px; }
.wx-wind__body { display: flex; align-items: center; gap: 16px; flex: 1 1 auto; }
.wx-wind__rose { width: 96px; height: 96px; flex: 0 0 auto; }
.wx-wind__n { font: 600 12px var(--font); fill: var(--muted); }
.wx-wind__speed { font-size: 32px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
.wx-wind__unit { font-size: 14px; font-weight: 500; }

.wx-hourly__strip { display: grid; grid-template-columns: repeat(24, minmax(46px, 1fr)); gap: 4px; margin-top: 12px; overflow-x: auto; padding-bottom: 4px; }
.wx-hourly__strip { grid-template-rows: auto 48px; }
.wx-hour { grid-row: 1; display: grid; grid-template-rows: 16px 26px 20px 16px; justify-items: center; align-items: center; row-gap: 4px; min-width: 46px; }
/* la tendance sous les colonnes, la nuit derrière tout : placées sur la même grille, elles suivent le défilement */
.wx-trend { grid-row: 2; grid-column: 1 / -1; position: relative; height: 48px; }
.wx-trend > svg { width: 100%; height: 100%; display: block; overflow: visible; }
.wx-trend__tick { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 4; opacity: .35; }
/* la valeur posée SUR sa ligne, dans une pastille du fond de la carte : lisible même quand la courbe passe dessous */
.wx-trend__tick-label { position: absolute; right: 0; transform: translateY(-50%); font-size: 10px; line-height: 1; padding: 1px 4px; border-radius: 4px; background: color-mix(in srgb, var(--surface) 85%, transparent); color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; }
.wx-trend__dot { position: absolute; width: 8px; height: 8px; margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid var(--surface); box-sizing: content-box; }
.wx-trend__dot[data-kind='min'] { background: var(--cat-media); }
.wx-trend__dot[data-kind='max'] { background: var(--cat-light); }
.wx-hour__temp[data-ext='min'] { color: var(--cat-media); }
.wx-hour__temp[data-ext='max'] { color: var(--cat-light); }
.wx-trend__night { grid-row: 1 / 3; grid-column: 1 / -1; width: 100%; height: 100%; display: block; fill: var(--text); opacity: .045; border-radius: 8px; }
.wx-trend__rain { fill: var(--cat-media); }
.wx-hour__temp { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wx-hour__rain, .wx-day__rain { color: transparent; font-variant-numeric: tabular-nums; }
.wx-hour__rain[data-on='1'], .wx-day__rain[data-on='1'] { color: var(--cat-media); }

.wx-daily__rows { display: grid; gap: 6px; margin-top: 12px; }
/* le nom du jour prend jusqu'à 72 px (« Aujourd'hui » en entier) sur la barre, qui garde au moins
   48 px ; toutes les lignes ont la même largeur, donc les mêmes colonnes */
.wx-day { display: grid; grid-template-columns: minmax(40px, 72px) 24px 44px 18px 40px minmax(48px, 1fr) 40px; align-items: center; gap: 8px; height: 30px; }
.wx-day__short { display: none; }
/* la semaine sur une demi-largeur (760-1099 px) : la place manque, « Aujourd'hui » s'abrège et la
   colonne pluie se resserre, pour laisser une barre à l'amplitude */
@media (min-width: 760px) and (max-width: 1099px) {
  .wx-day { grid-template-columns: 44px 24px 36px 18px 40px minmax(0, 1fr) 40px; }
  .wx-day__long { display: none; }
  .wx-day__short { display: inline; }
}
.wx-day__moon { width: 18px; height: 18px; }
.wx-day__moon > svg { width: 100%; height: 100%; }
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
/* légendes : au bas de la carte (la marge automatique les y pousse), sous un filet, en petit et en retrait */
.wx-legend { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line); display: grid; gap: 8px; font-size: 11px; line-height: 1.35; color: var(--muted); opacity: .85; }
.wx-air__legend { display: grid; gap: 0; }
.wx-air__row { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; height: 18px; }
.wx-air__row[data-on='1'] { color: var(--text); font-weight: 600; }
.wx-air__dot { width: 8px; height: 8px; border-radius: 50%; opacity: .8; }
.wx-air__range { font-variant-numeric: tabular-nums; }

.wx-pollen__rows { display: grid; gap: 8px; margin-top: 8px; }
.wx-pollen__row { display: grid; grid-template-columns: 96px 1fr 84px; align-items: center; gap: 10px; height: 22px; }
.wx-pollen__name { font-size: 13px; }
.wx-pollen__dots { display: flex; gap: 5px; }
.wx-pollen__dots span { width: 12px; height: 12px; border-radius: 50%; background: var(--line); }
.wx-pollen__dots span[data-on='1'] { background: var(--cat-light); }
.wx-pollen__level { text-align: right; }
.wx-pollen { display: flex; flex-direction: column; }
.wx-pollen__legend { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.wx-pollen__key { display: inline-flex; align-items: center; gap: 5px; }
.wx-pollen__key .wx-pollen__dots span { width: 7px; height: 7px; opacity: .8; }
.wx-pollen__key .wx-pollen__dots { gap: 3px; }

.wx-radar { padding: 0 !important; height: 400px; }
.wx-radar > * { height: 100%; }
/* en flux, le crédit ferme la page, centré */
.wx-credit { grid-column: span 12; text-align: center; }
/* en flux, le bloc « bas gauche » est transparent : détails, air et pollens gardent leur place dans la grille */
.wx-bottom { display: contents; }
/* en flux, la colonne air/pollens est transparente : ses deux cartes gardent leur place dans la grille */
.wx-side { display: contents; }

/* TOUT TIENT SANS DÉFILER : sur un écran large et assez haut (1920 × 945 est le cas visé), la
   SEMAINE prend le haut à droite, à côté de l'instant et des 24 heures ; la troisième rangée aligne
   détails, air et pollens à gauche, et le radar ferme la page en bas à droite, dans la hauteur qui
   reste. Les blocs gardent leurs tailles ; seule la disposition change. Le crédit passe sous le
   radar, le seul bloc qui sait céder de la hauteur. Grille de 24 colonnes : la première rangée se
   partage 5 / 5 / 4, le soleil et la lune prennent la place dont le vent n'a pas besoin.
   Seuils MESURÉS (2026-10-01) : la lune demande ~1770 px de large, le contenu ~934 px de haut ;
   en dessous, la page défile plutôt que de couper. */
@media (min-width: 1770px) and (min-height: 934px) {
  .weather__scroll { display: flex; flex-direction: column; overflow: hidden; gap: 0; }
  .weather__grid { flex: 1 1 auto; min-height: 0; grid-template-columns: repeat(24, minmax(0, 1fr)); grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 16px; align-content: start; }
  .wx-now { grid-column: 1 / 6 !important; grid-row: 1; }
  .wx-sun { grid-column: 6 / 11 !important; grid-row: 1; }
  .wx-wind { grid-column: 11 / 15 !important; grid-row: 1; }
  /* l'arc se resserre pour faire place à la lune sans pousser la page au-delà de l'écran */
  .wx-sun__arc { height: 72px; }
  .wx-hourly { grid-column: 1 / 15 !important; grid-row: 2; }
  .wx-hourly__strip { grid-template-columns: repeat(24, minmax(36px, 1fr)); gap: 2px; overflow: hidden; padding-bottom: 0; }
  .wx-hour { min-width: 36px; }
  .wx-hour__rain { font-size: 11px; }
  /* la semaine en haut à droite, sur la hauteur des deux premières rangées : ses lignes s'espacent pour la remplir */
  .wx-daily { grid-column: 15 / 25 !important; grid-row: 1 / 3; min-height: 0; }
  .wx-daily__rows { gap: 6px; margin-top: 12px; }
  .wx-day { height: 38px; }
  /* détails resserrés sur deux colonnes ; air et pollens à leur droite ; les deux blocs de DROITE
     (semaine, radar) partagent les mêmes colonnes, donc le même bord gauche */
  .wx-bottom { display: grid; grid-column: 1 / 15; grid-row: 3 / 5; grid-template-columns: 2fr 5fr; gap: 16px; align-items: stretch; min-height: 0; }
  /* la carte Détails s'aligne sur la hauteur de ses voisines (air, pollens) plutôt que de s'arrêter à sa dernière ligne */
  .wx-details { grid-column: 1 !important; grid-row: 1; }
  .wx-side { display: grid; grid-column: 2; grid-row: 1; grid-template-columns: 2fr 3fr; gap: 16px; }
  /* les attributions sous le radar, sur deux lignes réservées : un lieu sans vigilance n'y fait rien bouger */
  .wx-credit { grid-column: 15 / 25; grid-row: 4; text-align: left; line-height: 18px; height: 36px; overflow: hidden; }
  .wx-pollen__row { grid-template-columns: 84px auto 1fr; }
  /* la carte ferme la page : en bas à droite, dans la hauteur qui reste, alignée sur la semaine */
  .wx-radar { grid-column: 15 / 25 !important; grid-row: 3; height: auto; min-height: 0; }
  .wx-radar > * { min-height: 0; }
  .wx-air { grid-column: auto !important; }
  .wx-pollen { grid-column: auto !important; }
}
</style>
