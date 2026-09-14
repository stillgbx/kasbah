<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { geoDistance, type Capability, type CommandInput, type DeviceEntry, type StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { formatAgo, formatDistance, formatKm, formatPercent, formatPower, formatTemp } from '../lib/format'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Vue Véhicules : une carte par véhicule. Charge, autonomie, câble, verrouillage, position, et ce
// qu'un véhicule connecté sait aussi dire : sa VEILLE, son mouvement, la pression de ses pneus, ses
// températures. Tout est optionnel dans le contrat (un véhicule endormi ou simulé n'a pas tout) :
// chaque case existe toujours et affiche « — » à défaut, rien ne se décale quand une valeur arrive.
//
// Les boutons suivent les CAPACITÉS du descripteur : un plugin en lecture seule (Tesla, phase 1) ne
// déclare ni `lock` ni `charging`, et ne se voit donc pas proposer ce qu'il refuserait.
const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()
const HOME_RADIUS_M = 120
const EMPTY = '—'
const TIRES = ['fl', 'fr', 'rl', 'rr'] as const

type VehicleEntry = DeviceEntry & { state: StateFor<'vehicle'> }
const vehicles = computed(() => devices.list.filter((e): e is VehicleEntry => e.state.kind === 'vehicle'))

function location(s: StateFor<'vehicle'>): string {
  const o = house.house?.origin
  if (!o || !s.location) return t('common.unknown')
  const d = geoDistance(o, s.location)
  return d < HOME_RADIUS_M ? t('vehicle.atHome') : t('vehicle.away', { distance: formatDistance(d, locale.value) })
}
const has = (v: VehicleEntry, c: Capability) => v.descriptor.capabilities.includes(c)
const asleep = (s: StateFor<'vehicle'>) => s.sleepState !== undefined && s.sleepState !== 'online'
/**
 * Jamais lu : un véhicule découvert ENDORMI n'a encore livré que sa veille, et son état porte les
 * défauts du contrat (0 %, 0 km). Les afficher se lirait comme une batterie vide ; « — » dit vrai.
 * Un vrai véhicule à 0 % aurait au moins un kilométrage ou une position.
 */
const unread = (s: StateFor<'vehicle'>) => s.soc === 0 && s.rangeKm === 0 && s.odometerKm === undefined && s.location === undefined

/** « En route · 83 km/h » quand ça roule, sinon le rapport ou « Garé » ; « — » si rien n'est connu. */
function movement(s: StateFor<'vehicle'>): string {
  if (s.speedKmh === undefined && s.gear === undefined) return EMPTY
  if ((s.speedKmh ?? 0) > 0 || (s.gear !== undefined && s.gear !== 'P')) {
    return `${t('vehicle.moving')} · ${formatKm(s.speedKmh ?? 0, locale.value)}/h`
  }
  return t('vehicle.parked')
}
const temps = (s: StateFor<'vehicle'>) =>
  s.insideTempC === undefined && s.outsideTempC === undefined
    ? EMPTY
    : `${s.insideTempC === undefined ? EMPTY : formatTemp(s.insideTempC, locale.value)} · ${s.outsideTempC === undefined ? EMPTY : formatTemp(s.outsideTempC, locale.value)}`
const tire = (s: StateFor<'vehicle'>, k: (typeof TIRES)[number]) => {
  const v = s.tirePressureBar?.[k]
  return v === undefined ? EMPTY : `${new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} bar`
}
const send = (id: string, cmd: CommandInput) => devices.sendCommand(id, cmd)

// « lu il y a 12 min » vieillit tout seul : une horloge de la vue, rafraîchie chaque demi-minute
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { clockTimer = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })
const readAgo = (s: StateFor<'vehicle'>) => (s.readAt ? t('vehicle.readAt', { ago: formatAgo(s.readAt, now.value, locale.value) }) : t('vehicle.neverRead'))
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
            <!-- veille : toujours une pastille, même quand le plugin ne la connaît pas (« — ») -->
            <span class="vcard__sleep muted" :data-asleep="asleep(v.state) ? '1' : '0'">
              <StrokeIcon :name="asleep(v.state) ? 'moon' : 'sun'" :size="14" />{{ v.state.sleepState ? $t(`vehicle.sleep.${v.state.sleepState}`) : EMPTY }}
            </span>
          </div>
          <div class="vcard__soc">
            <div class="big-value">{{ unread(v.state) ? EMPTY : formatPercent(v.state.soc, locale) }}</div>
            <div class="muted">{{ unread(v.state) ? EMPTY : formatKm(v.state.rangeKm, locale) }}</div>
          </div>
          <div class="vcard__bar"><div class="vcard__bar-fill" :style="{ width: `${v.state.soc}%` }" /></div>
          <div class="vcard__stats">
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('common.status') }}</div><div class="stat__v">{{ v.state.locked ? $t('vehicle.locked') : $t('vehicle.unlocked') }}</div></div>
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vehicle.charging') }}</div>
              <div class="stat__v">{{ v.state.charging ? `${$t('vehicle.charging')} · ${formatPower(v.state.chargePowerW ?? 0, locale)}` : v.state.pluggedIn ? $t('vehicle.pluggedIn') : $t('vehicle.unplugged') }}</div></div>
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vehicle.movement') }}</div><div class="stat__v">{{ movement(v.state) }}</div></div>
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vehicle.temps') }}</div><div class="stat__v">{{ temps(v.state) }}</div></div>
          </div>
          <!-- quatre roues, quatre cases fixes, dans l'ordre où on regarde une voiture de dessus -->
          <div class="card card--soft tires">
            <div class="muted stat__k">{{ $t('vehicle.tires') }}</div>
            <div class="tires__grid">
              <div v-for="k in TIRES" :key="k" class="tire"><span class="muted tire__k">{{ $t(`vehicle.tire.${k}`) }}</span><span class="tire__v">{{ tire(v.state, k) }}</span></div>
            </div>
          </div>
          <div class="card card--soft vcard__map muted">{{ $t('vehicle.mapPlaceholder') }} · {{ location(v.state) }}<template v-if="v.state.odometerKm"> · {{ $t('vehicle.odometer') }} {{ formatKm(v.state.odometerKm, locale) }}</template></div>
          <div class="vcard__actions">
            <button v-if="has(v, 'lock')" type="button" class="pill" :disabled="!v.state.available" @click="send(v.descriptor.id, { type: v.state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">
              {{ v.state.locked ? $t('common.unlock') : $t('common.lock') }}
            </button>
            <button v-if="has(v, 'charging') && v.state.pluggedIn" type="button" class="pill" :data-on="v.state.charging ? '1' : '0'" :disabled="!v.state.available"
                    @click="send(v.descriptor.id, { type: v.state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
              {{ v.state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}
            </button>
            <!-- réveiller est un geste explicite (Tesla le facture) : jamais automatique, proposé seulement quand ça dort -->
            <button v-if="asleep(v.state)" type="button" class="pill" :disabled="!v.state.available" :title="$t('vehicle.wakeHint')"
                    @click="send(v.descriptor.id, { type: 'vehicle.wake' })">
              <StrokeIcon name="sun" :size="16" />{{ $t('vehicle.wake') }}
            </button>
            <!-- relire maintenant (lecture facturée, pas de réveil) ; le sondage repart de cette lecture -->
            <button v-else-if="has(v, 'soc')" type="button" class="pill" :disabled="!v.state.available || devices.isPending(v.descriptor.id)"
                    :title="$t('vehicle.refreshHint')" @click="send(v.descriptor.id, { type: 'vehicle.refresh' })">
              <StrokeIcon name="rotateRight" :size="16" />{{ devices.isPending(v.descriptor.id) ? $t('vehicle.refreshing') : $t('vehicle.refresh') }}
            </button>
          </div>
          <!-- l'âge des valeurs, toujours affiché : sur une API facturée et une voiture qui dort, elles en ont un -->
          <p class="muted vcard__hint">{{ readAgo(v.state) }}<template v-if="asleep(v.state)"> · {{ $t('vehicle.wakeHint') }}</template></p>
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
.min0 { min-width: 0; flex: 1 1 auto; }
.vcard__sleep { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; flex: 0 0 auto; }
.vcard__sleep[data-asleep='1'] { color: var(--text); }
.vcard__soc { display: flex; align-items: baseline; justify-content: space-between; }
.vcard__bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.vcard__bar-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s; }
.vcard__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { padding: 10px 12px; }
.stat__k { font-size: 11px; }
.stat__v { font-weight: 500; font-size: 14px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tires { padding: 10px 12px; display: grid; gap: 6px; }
.tires__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.tire { display: grid; gap: 2px; font-variant-numeric: tabular-nums; }
.tire__k { font-size: 11px; }
.tire__v { font-weight: 500; font-size: 13px; white-space: nowrap; }
.vcard__map { height: 90px; display: grid; place-items: center; font-size: 12px; text-align: center; padding: 0 12px; }
.vcard__actions { display: flex; gap: 8px; flex-wrap: wrap; min-height: 40px; }
.vcard__hint { margin: 0; font-size: 12px; }
</style>
