<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { useWeather } from '../../composables/useWeather'
import { conditionIcon } from '../../lib/weather'
import StrokeIcon from '../ui/StrokeIcon.vue'

// The House view widget (mockup: bottom left): condition and temperature, then the time
// and the date. RESERVED slot — the card always has the same size, weather or not: with no
// device, the weather area shows a dash and the clock stays. A tap opens the Weather view.
const { d, n, t } = useI18n()
const router = useRouter()
const weather = useWeather()

const now = ref(new Date())
useIntervalFn(() => { now.value = new Date() }, 30_000)

const live = weather.live
const icon = computed(() => (live.value ? conditionIcon(live.value.condition, live.value.isDay) : 'cloud'))
const temp = computed(() => (live.value ? `${n(live.value.tempC, 'integer')}°C` : '—'))
const condition = computed(() => (live.value ? t(`weather.conditions.${live.value.condition}`) : t('weather.title')))
</script>

<template>
  <button type="button" class="wx" :data-live="live ? '1' : '0'" :aria-label="$t('nav.weather')" @click="router.push({ name: 'weather' })">
    <div class="wx__row">
      <StrokeIcon :name="icon" :size="30" class="wx__icon" />
      <div class="wx__temp">{{ temp }}</div>
    </div>
    <div class="wx__cond">{{ condition }}</div>
    <div class="wx__time">{{ d(now, 'time') }}</div>
    <div class="wx__date">{{ d(now, 'date') }}</div>
  </button>
</template>

<style scoped>
/* same glass as the view buttons: the scene passes underneath */
.wx {
  width: var(--wx-w); height: 132px; padding: 12px 14px; text-align: left; border-radius: var(--radius); border: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow); color: var(--text); display: grid; grid-template-rows: 34px 18px 1fr 16px; align-content: start; row-gap: 2px;
}
.wx__row { display: flex; align-items: center; gap: 10px; }
.wx__icon { color: var(--cat-light); flex: 0 0 auto; }
.wx[data-live='0'] .wx__icon { color: var(--muted); }
.wx__temp { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; line-height: 1; white-space: nowrap; }
.wx__cond { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wx__time { font-size: 20px; font-weight: 500; line-height: 1; align-self: end; font-variant-numeric: tabular-nums; }
.wx__date { font-size: 12px; color: var(--muted); white-space: nowrap; text-transform: capitalize; }
/* Phone: the card keeps only the essentials — temperature and time — on two lines. */
@media (max-width: 599px), (max-height: 500px) {
  .wx { height: 72px; padding: 10px 12px; grid-template-rows: 26px 1fr; }
  .wx__row { gap: 6px; }
  .wx__icon { width: 22px; height: 22px; }
  .wx__temp { font-size: 18px; }
  .wx__time { font-size: 16px; }
  .wx__cond, .wx__date { display: none; }
}
/* Portrait phone: a pill the height of the view buttons, under the level tabs
   (see HomeView) — icon, temperature, time. */
@media (max-width: 599px) {
  .wx {
    width: auto; height: var(--ctl-w); padding: 0 14px 0 10px; border-radius: 999px;
    display: flex; align-items: center; gap: 10px;
  }
  .wx__temp { font-size: 16px; font-variant-numeric: tabular-nums; }
  .wx__time { font-size: 16px; color: var(--muted); align-self: center; }
}
</style>
