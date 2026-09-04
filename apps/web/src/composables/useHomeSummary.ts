import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import { formatPower, formatTemp } from '../lib/format'
import { useDevicesStore } from '../stores/devices'

// Chiffres de synthèse partagés par l'en-tête et les tuiles : lumières allumées, volets ouverts,
// production solaire, batterie, température intérieure.

export function useHomeSummary() {
  const devices = useDevicesStore()
  const { t, locale } = useI18n()

  const lights = computed(() => devices.list.filter((e) => e.state.kind === 'light'))
  const lightsOn = computed(() => lights.value.filter((e) => (e.state as StateFor<'light'>).on && e.state.available).length)
  const covers = computed(() => devices.list.filter((e) => e.state.kind === 'cover'))
  const coversOpen = computed(() => covers.value.filter((e) => (e.state as StateFor<'cover'>).position > 0).length)
  const energy = computed(() => devices.list.find((e) => e.state.kind === 'energy')?.state as StateFor<'energy'> | undefined)
  const climate = computed(() => devices.list.find((e) => e.state.kind === 'climate')?.state as StateFor<'climate'> | undefined)
  const indoorTemp = computed<number | null>(() => {
    if (climate.value) return climate.value.currentTempC
    const s = devices.list.find((e) => e.descriptor.kind === 'sensor' && e.descriptor.meta.sensor?.deviceClass === 'temperature' && e.descriptor.name.toLowerCase().indexOf('ext') < 0)
    return s ? (s.state as StateFor<'sensor'>).value : null
  })
  const vehicles = computed(() => devices.list.filter((e) => e.state.kind === 'vehicle'))
  const chargers = computed(() => devices.list.filter((e) => e.state.kind === 'ev_charger'))

  const headline = computed(() => {
    const parts: string[] = []
    if (lights.value.length) parts.push(t('summary.lightsOn', { n: lightsOn.value }, lightsOn.value))
    if (indoorTemp.value !== null) parts.push(formatTemp(indoorTemp.value, locale.value))
    if (energy.value) parts.push(`${formatPower(energy.value.productionW, locale.value)} ${t('summary.solar').toLowerCase()}`)
    return parts.join(' · ')
  })

  return { lights, lightsOn, covers, coversOpen, energy, climate, indoorTemp, vehicles, chargers, headline }
}
