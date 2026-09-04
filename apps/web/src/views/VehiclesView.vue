<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { geoDistance, type CommandInput, type DeviceEntry, type StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { formatDistance, formatKm, formatPercent, formatPower } from '../lib/format'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Vue Véhicules : une carte par véhicule (charge, autonomie, état, position, actions).
const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()
const HOME_RADIUS_M = 120

const vehicles = computed(() => devices.list.filter((e): e is DeviceEntry & { state: StateFor<'vehicle'> } => e.state.kind === 'vehicle'))

function location(s: StateFor<'vehicle'>): string {
  const o = house.house?.origin
  if (!o || !s.location) return t('common.unknown')
  const d = geoDistance(o, s.location)
  return d < HOME_RADIUS_M ? t('vehicle.atHome') : t('vehicle.away', { distance: formatDistance(d, locale.value) })
}
const send = (id: string, cmd: CommandInput) => devices.sendCommand(id, cmd)
</script>

<template>
  <div class="vehicles">
    <PageHeader />
    <div class="vehicles__scroll">
      <div v-if="vehicles.length === 0" class="card card--soft empty muted">{{ $t('vehicle.none') }}</div>
      <div class="cards">
        <article v-for="v in vehicles" :key="v.descriptor.id" class="card vcard">
          <div class="vcard__head">
            <span class="icon-square" :data-on="v.state.charging ? '1' : '0'"><StrokeIcon name="vehicle" :size="18" /></span>
            <div class="min0">
              <div class="vcard__name">{{ v.descriptor.name }}</div>
              <div class="muted vcard__sub">{{ v.descriptor.meta.manufacturer ?? v.descriptor.pluginId }} · {{ location(v.state) }}</div>
            </div>
          </div>
          <div class="vcard__soc">
            <div class="big-value">{{ formatPercent(v.state.soc, locale) }}</div>
            <div class="muted">{{ formatKm(v.state.rangeKm, locale) }}</div>
          </div>
          <div class="vcard__bar"><div class="vcard__bar-fill" :style="{ width: `${v.state.soc}%` }" /></div>
          <div class="vcard__stats">
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('common.status') }}</div><div class="stat__v">{{ v.state.locked ? $t('vehicle.locked') : $t('vehicle.unlocked') }}</div></div>
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vehicle.charging') }}</div>
              <div class="stat__v">{{ v.state.charging ? `${$t('vehicle.charging')} · ${formatPower(v.state.chargePowerW ?? 0, locale)}` : v.state.pluggedIn ? $t('vehicle.pluggedIn') : $t('vehicle.unplugged') }}</div></div>
          </div>
          <div class="card card--soft vcard__map muted">{{ $t('vehicle.mapPlaceholder') }} · {{ location(v.state) }}</div>
          <div class="vcard__actions">
            <button type="button" class="pill" :disabled="!v.state.available" @click="send(v.descriptor.id, { type: v.state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">
              {{ v.state.locked ? $t('common.unlock') : $t('common.lock') }}
            </button>
            <button v-if="v.state.pluggedIn" type="button" class="pill" :data-on="v.state.charging ? '1' : '0'" :disabled="!v.state.available"
                    @click="send(v.descriptor.id, { type: v.state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
              {{ v.state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}
            </button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vehicles { height: 100%; display: flex; flex-direction: column; }
.vehicles__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.empty { padding: 24px; text-align: center; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.vcard { padding: 18px 20px; display: grid; gap: 14px; align-content: start; }
.vcard__head { display: flex; align-items: center; gap: 12px; }
.vcard__name { font-weight: 600; font-size: 16px; }
.vcard__sub { font-size: 12px; }
.min0 { min-width: 0; }
.vcard__soc { display: flex; align-items: baseline; justify-content: space-between; }
.vcard__bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.vcard__bar-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s; }
.vcard__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { padding: 10px 12px; }
.stat__k { font-size: 11px; }
.stat__v { font-weight: 500; font-size: 14px; margin-top: 2px; }
.vcard__map { height: 90px; display: grid; place-items: center; font-size: 12px; text-align: center; }
.vcard__actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
