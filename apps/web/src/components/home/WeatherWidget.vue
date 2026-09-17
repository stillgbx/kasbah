<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { useWeather } from '../../composables/useWeather'
import { conditionIcon } from '../../lib/weather'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Le widget de la vue Maison (maquette : en bas à gauche) : condition et température, puis l'heure
// et la date. Emplacement RÉSERVÉ — la carte a toujours la même taille, météo ou pas : sans
// appareil, la zone météo montre un tiret et l'horloge reste. Un tap ouvre la vue Météo.
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
/* même verre que les boutons de vue : la scène passe dessous */
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
</style>
