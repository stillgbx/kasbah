<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { HOME_RADIUS_M, estimateChargePowerW, geoDistance, sitePosition, type Capability, type CommandInput, type DeviceEntry, type StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import ChargeLimitCard from '../components/vehicles/ChargeLimitCard.vue'
import VehicleBattery from '../components/vehicles/VehicleBattery.vue'
import VehicleMap from '../components/vehicles/VehicleMap.vue'
import VehicleClimate from '../components/vehicles/VehicleClimate.vue'
import VehicleSoftware from '../components/vehicles/VehicleSoftware.vue'
import VehicleTuning from '../components/vehicles/VehicleTuning.vue'
import { formatAgo, formatDistance, formatKm, formatMinutes, formatPercent, formatPower, formatTemp } from '../lib/format'
import { QUOTA_TENSE_PCT, quotaPercent } from '../lib/map'
import { leaseOverPace, leaseProgress, leaseYearMarks } from '../lib/vehicleLease'
import { tunableVehicle } from '../lib/vehicleTuning'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Vehicles view: one card per vehicle. Charge, range, cable, lock, position, and what a connected
// vehicle can also say: its SLEEP state, its movement, its tire pressure, its temperatures.
// Everything is optional in the contract (a sleeping or simulated vehicle does not have
// everything): every cell always exists and shows "—" by default, nothing shifts when a value
// arrives.
//
// The buttons follow the descriptor's CAPABILITIES: a read-only plugin (Tesla, phase 1) does not
// declare `lock` or `charging`, and is therefore not offered what it would refuse.
const devices = useDevicesStore()
const house = useHouseStore()
const router = useRouter()
const { t, locale } = useI18n()
const EMPTY = '—'
const TIRES = ['fl', 'fr', 'rl', 'rr'] as const

/**
 * Renaming a vehicle. The chosen name lives in the HOUSE (`house.devices[].name`), not in the
 * state: the state is the vendor's truth, rewritten on every read. A car not being
 * placed in the 3D scene, its house entry has no position — hence an optional `position`
 * in the placement. Emptying the field clears the chosen name and hands control back to the vendor.
 */
/** The name chosen in the house wins over the vendor's; failing that, the vendor is authoritative. */
const displayName = (v: VehicleEntry) => house.houseDeviceFor(v.descriptor.id)?.name ?? v.descriptor.name

const renaming = ref<string | null>(null)
const renameText = ref('')
/** The mounted field, if there is one. FUNCTION ref: a named `ref` in a `v-for` yields an array. */
const renameInput = ref<HTMLInputElement | null>(null)

function startRename(v: VehicleEntry) {
  renaming.value = v.descriptor.id
  renameText.value = displayName(v)
  void nextTick(() => renameInput.value?.select())
}
async function commitRename(v: VehicleEntry) {
  const wanted = renameText.value.trim()
  renaming.value = null
  if (wanted === displayName(v)) return
  await house.renameDevice(v.descriptor.id, wanted)
}

type VehicleEntry = DeviceEntry & { state: StateFor<'vehicle'> }
const vehicles = computed(() => devices.list.filter((e): e is VehicleEntry => e.state.kind === 'vehicle'))

function location(s: StateFor<'vehicle'>): string {
  const o = house.house?.origin
  if (!o || !s.location) return t('common.unknown')
  const d = geoDistance(o, s.location)
  return d < HOME_RADIUS_M ? t('vehicle.atHome') : t('vehicle.away', { distance: formatDistance(d, locale.value) })
}
/**
 * On the TERRAIN, the car is drawn in the 3D: same test as the scene (`gpsPoint`), the
 * reading corrected for its offset falls inside the terrain polygon. "At home" (radius) is not
 * enough: the radius spills over the terrain, and we would offer to go and see a car that the 3D
 * does not show.
 */
function onSite(v: VehicleEntry): boolean {
  const h = house.effective ?? house.house
  if (!h || !v.state.location) return false
  return sitePosition(h, v.state.location, house.houseDeviceFor(v.descriptor.id)?.gpsOffset) !== null
}
/** Opens the car in the 3D, same order as the device list: navigate, THEN select. */
async function showIn3d(v: VehicleEntry): Promise<void> {
  await router.push({ name: 'home' }).catch(() => {})
  house.selectDevice(house.houseDeviceFor(v.descriptor.id)?.id ?? v.descriptor.id)
}
const has = (v: VehicleEntry, c: Capability) => v.descriptor.capabilities.includes(c)
const asleep = (s: StateFor<'vehicle'>) => s.sleepState !== undefined && s.sleepState !== 'online'

/** "Driving · 83 km/h" when moving, otherwise the gear or "Parked"; "—" if nothing is known. */
function movement(s: StateFor<'vehicle'>): string {
  if (s.speedKmh === undefined && s.gear === undefined) return EMPTY
  if ((s.speedKmh ?? 0) > 0 || (s.gear !== undefined && s.gear !== 'P')) {
    return `${t('vehicle.moving')} · ${formatKm(s.speedKmh ?? 0, locale.value)}/h`
  }
  return t('vehicle.parked')
}
/** Where the cable stands: "Unplugged", "Plugged in", "Charging". The detail goes under the gauge. */
function charge(s: StateFor<'vehicle'>): string {
  if (s.charging) return t('vehicle.charging')
  return s.pluggedIn ? t('vehicle.pluggedIn') : t('vehicle.unplugged')
}
/**
 * What the charge in progress gives in addition: power, estimated end, target. Each piece is
 * optional — no vendor gives them all (the R5 does not state the power, it states the time;
 * Tesla states both). Empty off charge: the row stays, its place is reserved.
 *
 * Nothing is computed here: a remaining time would be poorly deduced from an instantaneous
 * power, the charge curve not being linear. It is the vehicle that estimates, or no one.
 */
function chargeDetail(v: VehicleEntry): string {
  const s = v.state
  if (!s.charging) return ''
  const parts: string[] = []
  // the MEASURED power if the vehicle gives it; otherwise the one deduced from its own estimate
  // of the remaining time — which then does not present itself as a measurement
  const guess = estimateChargePowerW(s, capacityOf(v) || undefined)
  if (s.chargePowerW) parts.push(formatPower(s.chargePowerW, locale.value))
  else if (guess !== undefined) parts.push(t('vehicle.chargeEstimated', { power: formatPower(guess, locale.value) }))
  if (s.chargeMinutesRemaining !== undefined) parts.push(t('vehicle.chargeEta', { time: formatMinutes(s.chargeMinutesRemaining, locale.value) }))
  if (s.chargeLimit !== undefined) parts.push(t('vehicle.chargeTarget', { percent: formatPercent(s.chargeLimit, locale.value) }))
  return parts.join(' · ')
}

/** Lock: "—" as long as we do not know (not every manufacturer says it). */
const locked = (s: StateFor<'vehicle'>) =>
  s.locked === undefined ? EMPTY : s.locked ? t('vehicle.locked') : t('vehicle.unlocked')
const temps = (s: StateFor<'vehicle'>) =>
  s.insideTempC === undefined && s.outsideTempC === undefined
    ? EMPTY
    : `${s.insideTempC === undefined ? EMPTY : formatTemp(s.insideTempC, locale.value)} · ${s.outsideTempC === undefined ? EMPTY : formatTemp(s.outsideTempC, locale.value)}`
const tire = (s: StateFor<'vehicle'>, k: (typeof TIRES)[number]) => {
  const v = s.tirePressureBar?.[k]
  return v === undefined ? EMPTY : `${new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} bar`
}
/**
 * What only the user can know, folded behind "Adjust": the 3D offset, the rotation and
 * the battery capacity (see `VehicleTuning`). A vehicle with nothing to adjust — placed by
 * hand AND talkative about its charging power — is not offered the button.
 */
const tunable = (v: VehicleEntry) => tunableVehicle(v.descriptor, house.houseDeviceFor(v.descriptor.id))
const capacityOf = (v: VehicleEntry) => house.houseDeviceFor(v.descriptor.id)?.batteryKwh ?? 0

/**
 * The CHARGE LIMIT, the only setting of the car that the card lets you change (see
 * `ChargeLimitCard`, shared with the House view panel).
 *
 * The value we HOLD while dragging lives here: without it, the slider would go back to the
 * vehicle's value on every frame: the state only moves on release, when the command goes out.
 */
const dragged = ref<Record<string, number>>({})
const limitOf = (v: VehicleEntry) => dragged.value[v.descriptor.id] ?? v.state.chargeLimit ?? 80
const preview = (v: VehicleEntry, percent: number) => {
  dragged.value = { ...dragged.value, [v.descriptor.id]: percent }
}
/** Asleep, the car refuses its commands (408 on Tesla): better not to offer them. */
const limitLocked = (v: VehicleEntry) => !v.state.available || asleep(v.state)
async function setLimit(v: VehicleEntry, percent: number): Promise<void> {
  const id = v.descriptor.id
  preview(v, percent)
  await send(id, { type: 'vehicle.set_charge_limit', percent })
  // control handed back to the state: accepted, it already carries the target; refused, it went back to the old one
  const next = { ...dragged.value }
  delete next[id]
  dragged.value = next
}

async function send(id: string, cmd: CommandInput): Promise<boolean> {
  const ok = await devices.sendCommand(id, cmd)
  void devices.refreshHealth()                         // a read consumed: the quota gauge follows
  return ok
}

/**
 * Wake-up REQUESTED, not yet observed. Tesla acknowledges the request in a second, but the car takes
 * about ten seconds to open its eyes (the plugin re-reads it 15 s later): `isPending`, which only
 * covers the round trip to the server, would make the button inert while nothing has changed
 * on screen yet. Lifted as soon as the vehicle declares itself awake — or after `WAKE_MAX_MS` if
 * it does not answer, so as not to leave a button stuck on a car out of range.
 */
const WAKE_MAX_MS = 90_000
const waking = ref<Record<string, true>>({})
function stopWaking(id: string): void {
  if (!(id in waking.value)) return
  const next = { ...waking.value }
  delete next[id]
  waking.value = next
}
/**
 * A command is in flight for this vehicle, or its effect is awaited (wake-up, charge): the
 * gestures that would cross it are greyed out. Only the button of the command in progress SPINS
 * (`waking`, `refreshing`, `devices.isChargeRequested`): "Start charging" used to make Wake up
 * and Refresh spin.
 */
const busy = (v: VehicleEntry) => devices.isPending(v.descriptor.id) || v.descriptor.id in waking.value || devices.isChargeRequested(v.descriptor.id)
const charging = (v: VehicleEntry) => devices.isChargeRequested(v.descriptor.id)
/** Re-read in flight: the spinner of Refresh, and only it. */
const refreshing = ref<Record<string, true>>({})
async function refresh(v: VehicleEntry): Promise<void> {
  const id = v.descriptor.id
  refreshing.value = { ...refreshing.value, [id]: true }
  try { await send(id, { type: 'vehicle.refresh' }) }
  finally {
    const next = { ...refreshing.value }
    delete next[id]
    refreshing.value = next
  }
}

async function wake(v: VehicleEntry): Promise<void> {
  const id = v.descriptor.id
  waking.value = { ...waking.value, [id]: true }
  if (await send(id, { type: 'vehicle.wake' })) setTimeout(() => stopWaking(id), WAKE_MAX_MS)
  else stopWaking(id)                                  // request refused: the button comes back right away
}
// the vehicle has opened its eyes: the button has done its job (and gives way to "Refresh")
watch(vehicles, (list) => { for (const v of list) if (v.state.sleepState === 'online') stopWaking(v.descriptor.id) })

/**
 * The open panel, ONE at a time: the climate control (on/off, setpoint, seats, see `VehicleClimate`)
 * or the settings (see `VehicleTuning`). They open in the same place, over the card.
 */
type Panel = 'climate' | 'tuning'
const panel = ref<{ id: string; kind: Panel } | null>(null)
const panelOf = (v: VehicleEntry): Panel | null => (panel.value?.id === v.descriptor.id ? panel.value.kind : null)
function togglePanel(v: VehicleEntry, kind: Panel): void {
  panel.value = panelOf(v) === kind ? null : { id: v.descriptor.id, kind }
}
/** Under the card: where the car is relative to the house, and its mileage. */
const caption = (s: StateFor<'vehicle'>) =>
  `${location(s)}${s.odometerKm ? ` · ${t('vehicle.odometer')} ${formatKm(s.odometerKm, locale.value)}` : ''}`

// "read 12 min ago" ages by itself: a view clock, refreshed every half minute
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
/**
 * The vendor API's quota (`PluginHealth.quota`), shown as a gauge at the bottom of the card. Plugin
 * health is not pushed: we ask the server again (local request) on arrival, on every
 * clock tick, and after a command — a wake-up or a re-read consumes the budget.
 */
const quotaOf = (v: VehicleEntry) => devices.health?.plugins[v.descriptor.pluginId]?.quota
type Quota = NonNullable<ReturnType<typeof quotaOf>>
/**
 * "$0.42/$10.00 of Tesla credit · since Sep 13" — the plugin says WHAT it counts (`labelKey`),
 * in which unit (`unit`) and since when (`since`); the view only formats, in the
 * language and format of the interface.
 */
const quotaLabel = (q: Quota) => {
  const fmt = (n: number) => (q.unit === 'usd'
    // `narrowSymbol`: "$3.42" and not "US$3.42", which weighs down an already dense line
    ? new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(n)
    : new Intl.NumberFormat(locale.value).format(n))
  const line = t('vehicle.quota', { used: fmt(q.used), limit: fmt(q.limit), what: t(q.labelKey) })
  if (!q.since) return line
  const date = new Date(q.since).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
  return `${line} · ${t('vehicle.quotaSince', { date })}`
}
/**
 * The lease entered in the "Edit" panel, against the odometer read: two rows and a gauge, in
 * place of the quota (the R5 has none). Nothing without an entered lease or a read odometer. The
 * gauge speaks the language of the card's others: the contract anniversaries cut it into BLOCKS,
 * like the steps of the charge limit, and the allowed maximum to date is a mark of the battery
 * gauge (target, floor); the fill turns red when you drive faster than it.
 */
type LeaseMark = { left: number; title: string }
const leases = computed(() => {
  const out = new Map<string, { line: string; detail: string; fill: number; pace: LeaseMark; years: LeaseMark[]; tense: boolean }>()
  const nf = new Intl.NumberFormat(locale.value)
  for (const v of vehicles.value) {
    const lease = house.houseDeviceFor(v.descriptor.id)?.lease
    const p = lease ? leaseProgress(lease, v.state.odometerKm, now.value) : null
    if (!lease || !p) continue
    const end = new Date(`${lease.end}T12:00:00Z`).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' })
    const total = nf.format(lease.km)
    const driven = nf.format(p.drivenKm)
    out.set(v.descriptor.id, {
      line: p.ended ? t('vehicle.lease.ended', { end, driven, total }) : t('vehicle.lease.line', { driven, allowed: nf.format(p.allowedKm) }),
      detail: p.ended ? '' : p.projectedKm !== null
        ? t('vehicle.lease.projection', { projected: nf.format(p.projectedKm), end, total })
        : t('vehicle.lease.early', { end, total }),
      fill: Math.min(p.usedShare, 1) * 100,
      pace: { left: p.elapsedShare * 100, title: t('vehicle.lease.paceMark', { km: nf.format(p.allowedKm) }) },
      years: leaseYearMarks(lease).map((y) => ({
        left: y.share * 100,
        title: t('vehicle.lease.yearMark', { date: new Date(`${y.date}T12:00:00Z`).toLocaleDateString(locale.value), km: nf.format(y.km) }),
      })),
      tense: leaseOverPace(p),
    })
  }
  return out
})
onMounted(() => {
  void devices.refreshHealth()
  clockTimer = setInterval(() => { now.value = Date.now(); void devices.refreshHealth() }, 30_000)
})
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
          <!-- DOM order = the phone's stack: energy, status, buttons, map, quota. Wider, grid
               AREAS (not columns): a block that spans several rows lets its neighbors
               follow one another without a gap. See `.vcard` and its two @containers. -->
          <div class="vcard__energy">
            <div class="vcard__head">
              <!-- charging: the bolt and a pulsing halo (a shadow: nothing moves around) -->
              <span class="icon-square vcard__icon" :data-on="v.state.charging ? '1' : '0'"><StrokeIcon :name="v.state.charging ? 'bolt' : 'vehicle'" :size="18" /></span>
              <div class="min0">
                <!-- name, or input: the field takes the SAME box as the title, nothing shifts -->
                <div class="vcard__name-row">
                  <input v-if="renaming === v.descriptor.id" :ref="(el) => (renameInput = el as HTMLInputElement | null)"
                         v-model="renameText" class="vcard__name vcard__name-input"
                         :aria-label="$t('vehicle.rename')" :placeholder="v.descriptor.name" @keyup.enter="commitRename(v)"
                         @keyup.escape="renaming = null" @blur="commitRename(v)" />
                  <template v-else>
                    <div class="vcard__name">{{ displayName(v) }}</div>
                    <button type="button" class="vcard__pencil" :title="$t('vehicle.rename')" :aria-label="$t('vehicle.rename')" @click="startRename(v)">
                      <StrokeIcon name="pencil" :size="14" />
                    </button>
                  </template>
                </div>
                <!-- on the terrain, the pin at the end of the place leads (same pill as the device
                     lists) to the car in the 3D. It is at the END of the row: absent, it shifts
                     nothing -->
                <div class="muted vcard__sub">
                  <span class="vcard__sub-text" :title="`${v.descriptor.meta.manufacturer ?? v.descriptor.pluginId} · ${location(v.state)}`">{{ v.descriptor.meta.manufacturer ?? v.descriptor.pluginId }} · {{ location(v.state) }}</span>
                  <button v-if="onSite(v)" type="button" class="vcard__locate" :title="$t('common.showIn3d')" :aria-label="$t('common.showIn3d')" @click="showIn3d(v)">
                    <StrokeIcon name="pin" :size="14" />
                  </button>
                </div>
              </div>
              <!-- on the right, two rows facing the name and the subtitle: the sleep state, then
                   the age of the values. The age is at the TOP of the card: it no longer goes down
                   when a panel opens -->
              <div class="vcard__side">
                <!-- no pill when the vendor has no sleep state (Renault): a sun followed by a
                     dash would read "awake: unknown". Nothing moves either, the absence is stable -->
                <span v-if="v.state.sleepState !== undefined" class="vcard__sleep muted" :data-asleep="asleep(v.state) ? '1' : '0'">
                  <StrokeIcon :name="asleep(v.state) ? 'moon' : 'sun'" :size="14" />{{ $t(`vehicle.sleep.${v.state.sleepState}`) }}
                </span>
                <!-- the age of the values, always displayed: on a billed API and a sleeping car, they have one -->
                <span class="muted vcard__age" :title="asleep(v.state) ? $t('vehicle.wakeHint') : undefined">{{ readAgo(v.state) }}</span>
              </div>
            </div>
            <!-- the range: the component shared with the House view panel; the target mark follows the slider -->
            <VehicleBattery :state="v.state" :limit="limitOf(v)" />
            <!-- detail of the charge in progress: space ALWAYS reserved, nothing shifts when it starts -->
            <p class="muted vcard__charge">{{ chargeDetail(v) }}</p>
            <!-- the charge target, when the vehicle lets it be written: steps by finger, slider by the percent -->
            <ChargeLimitCard v-if="has(v, 'charge_limit')" watermark :value="limitOf(v)" :disabled="limitLocked(v)"
                             :hint="asleep(v.state) ? $t('vehicle.wakeHint') : undefined"
                             @preview="preview(v, $event)" @change="setLimit(v, $event)" />
          </div>
          <div class="vcard__state">
            <!-- each section carries as a watermark, at the bottom right, the icon of what it says (trial 2026-10-01) -->
            <div class="vcard__stats">
              <div class="card card--soft stat"><StrokeIcon class="wm" :name="v.state.locked === false ? 'lockOpen' : 'lock'" :size="48" />
                <div class="muted stat__k">{{ $t('common.status') }}</div><div class="stat__v">{{ locked(v.state) }}</div></div>
              <div class="card card--soft stat"><StrokeIcon class="wm" name="plug" :size="48" /><div class="muted stat__k">{{ $t('vehicle.charge') }}</div>
                <div class="stat__v">{{ charge(v.state) }}</div></div>
              <div class="card card--soft stat"><StrokeIcon class="wm" name="gauge" :size="48" />
                <div class="muted stat__k">{{ $t('vehicle.movement') }}</div><div class="stat__v">{{ movement(v.state) }}</div></div>
              <div class="card card--soft stat"><StrokeIcon class="wm" name="hotCold" :size="48" />
                <div class="muted stat__k">{{ $t('vehicle.temps') }}</div><div class="stat__v">{{ temps(v.state) }}</div></div>
            </div>
            <!-- four wheels, four fixed cells, in the order you look at a car from above -->
            <div class="card card--soft tires">
              <StrokeIcon class="wm" name="tire" :size="56" />
              <div class="muted stat__k">{{ $t('vehicle.tires') }}</div>
              <div class="tires__grid">
                <div v-for="k in TIRES" :key="k" class="tire"><span class="muted tire__k">{{ $t(`vehicle.tire.${k}`) }}</span><span class="tire__v">{{ tire(v.state, k) }}</span></div>
              </div>
            </div>
            <!-- software: installed version and pending update, always there; opens the release notes -->
            <VehicleSoftware :descriptor="v.descriptor" :state="v.state" />
          </div>
          <!-- ALL the buttons, always: what a vehicle cannot do is greyed out, with the reason
               (user rule, 2026-10-01). A grid of six, ordered by `order` (`data-slot`):
               map on the right, the buttons that open a panel are in the column that touches it -->
          <div class="vcard__actions">
            <!-- waking is an explicit gesture (Tesla bills it): never automatic. ALWAYS there for a
                 vehicle that has a sleep state, greyed out when awake: if it appeared and
                 disappeared, the row would change its number of lines and push the climate panel -->
            <button type="button" class="pill" data-slot="wake" :disabled="v.state.sleepState === undefined || !v.state.available || !asleep(v.state) || busy(v)"
                    :aria-busy="v.descriptor.id in waking" :title="v.state.sleepState === undefined ? $t('vehicle.unsupported') : $t('vehicle.wakeHint')" @click="wake(v)">
              <!-- the spinner takes the PLACE of the icon, same size: the button does not change width -->
              <v-progress-circular v-if="v.descriptor.id in waking" indeterminate size="16" width="2" />
              <StrokeIcon v-else name="sun" :size="16" /><span class="vcard__label">{{ $t('vehicle.wake') }}</span>
            </button>
            <!-- re-read now (billed read, no wake-up); polling restarts from that read.
                 Offered EVEN when asleep: that is how you notice a car woke up on its own,
                 without paying for the wake-up -->
            <button type="button" class="pill" data-slot="refresh" :disabled="!has(v, 'soc') || !v.state.available || devices.isPending(v.descriptor.id)"
                    :aria-busy="v.descriptor.id in refreshing" :title="$t('vehicle.refreshHint')" @click="refresh(v)">
              <!-- it stays clickable DURING a wake-up: that is precisely when you want to
                   ask "so, are you awake?" without paying for a wake-up again -->
              <v-progress-circular v-if="v.descriptor.id in refreshing" indeterminate size="16" width="2" />
              <StrokeIcon v-else name="rotateRight" :size="16" /><span class="vcard__label">{{ $t('vehicle.refresh') }}</span>
            </button>
            <button type="button" class="pill" data-slot="lock" :disabled="!has(v, 'lock') || !v.state.available"
                    :title="has(v, 'lock') ? undefined : $t('vehicle.unsupported')" @click="send(v.descriptor.id, { type: v.state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">
              <StrokeIcon :name="v.state.locked ? 'lockOpen' : 'lock'" :size="16" /><span class="vcard__label">{{ v.state.locked ? $t('common.unlock') : $t('common.lock') }}</span>
            </button>
            <!-- once requested, the charge runs until the car SAYS it is active (20 s to 1 min, see the store) -->
            <button type="button" class="pill" data-slot="charge" :data-on="v.state.charging ? '1' : '0'"
                    :disabled="!has(v, 'charging') || !v.state.pluggedIn || !v.state.available || busy(v)" :aria-busy="charging(v)"
                    :title="!has(v, 'charging') ? $t('vehicle.unsupported') : v.state.pluggedIn ? undefined : $t('vehicle.unplugged')"
                    @click="send(v.descriptor.id, { type: v.state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
              <v-progress-circular v-if="charging(v)" indeterminate size="16" width="2" />
              <StrokeIcon v-else :name="v.state.charging ? 'boltOff' : 'bolt'" :size="16" />
              <span class="vcard__label">{{ v.state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}</span>
            </button>
            <!-- opens the panel; the tint says the climate control is RUNNING (fixed label: the width does not move) -->
            <button type="button" class="pill" data-slot="climate" :data-on="v.state.climateOn ? '1' : '0'" :disabled="!has(v, 'climate_precondition')"
                    :aria-expanded="panelOf(v) === 'climate'" :title="has(v, 'climate_precondition') ? $t('vehicle.climateHint') : $t('vehicle.unsupported')"
                    @click="togglePanel(v, 'climate')">
              <StrokeIcon name="thermostat" :size="16" /><span class="vcard__label">{{ $t('vehicle.climatePanel.title') }}</span>
            </button>
            <!-- what the car will never say: folded, because it is set once -->
            <!-- greyed out when there is NOTHING to adjust (placed by hand, and talkative about its power) -->
            <button type="button" class="pill" data-slot="tuning" :data-on="panelOf(v) === 'tuning' ? '1' : '0'" :disabled="!tunable(v)"
                    :aria-expanded="panelOf(v) === 'tuning'"
                    @click="togglePanel(v, 'tuning')">
              <StrokeIcon name="gear" :size="16" /><span class="vcard__label">{{ $t('vehicle.tune') }}</span>
            </button>
          </div>
          <!-- the map: car (with its heading) and house, plan or satellite, fullscreen. A panel opens
               OVER it, without resizing it; it then no longer takes control (`inert`) -->
          <div class="vcard__mapzone">
            <div class="vcard__mapbox" :inert="panelOf(v) !== null">
              <VehicleMap class="vcard__map" :location="v.state.location" :heading-deg="v.state.headingDeg" :home="house.house?.origin"
                          :caption="caption(v.state)" />
            </div>
            <Transition name="vpanel">
              <div v-if="panelOf(v)" :key="panelOf(v)!" class="card vcard__overlay">
                <VehicleClimate v-if="panelOf(v) === 'climate'" class="card card--soft" :descriptor="v.descriptor" :state="v.state" />
                <VehicleTuning v-else :descriptor="v.descriptor" />
              </div>
            </Transition>
          </div>
          <!-- the foot of the left column: vendor quota and lease, one under the other -->
          <div v-if="quotaOf(v) || leases.get(v.descriptor.id)" class="vcard__foot">
            <!-- what remains of the quota the plugin imposes on itself (billed vendor API): nothing for
                 a plugin that does not count, the simulation for example -->
            <div v-if="quotaOf(v)" class="vcard__quota">
              <span class="muted vcard__quota-text" :title="quotaLabel(quotaOf(v)!)">{{ quotaLabel(quotaOf(v)!) }}</span>
              <div class="vcard__quota-track">
                <div class="vcard__quota-fill" :data-tense="quotaPercent(quotaOf(v)!.used, quotaOf(v)!.limit) >= QUOTA_TENSE_PCT ? '1' : '0'"
                     :style="{ width: `${quotaPercent(quotaOf(v)!.used, quotaOf(v)!.limit)}%` }" />
              </div>
            </div>
            <div v-if="leases.get(v.descriptor.id)" class="vcard__quota vcard__lease">
              <span class="muted vcard__quota-text" :title="leases.get(v.descriptor.id)!.line">{{ leases.get(v.descriptor.id)!.line }}</span>
              <div class="vcard__lease-bar">
                <div class="vcard__lease-track">
                  <div class="vcard__lease-fill" :data-tense="leases.get(v.descriptor.id)!.tense ? '1' : '0'"
                       :style="{ width: `${leases.get(v.descriptor.id)!.fill}%` }" />
                  <span v-for="y in leases.get(v.descriptor.id)!.years" :key="y.left" class="vcard__lease-year"
                        :style="{ left: `${y.left}%` }" :title="y.title" />
                </div>
                <span class="vcard__lease-pace" :style="{ left: `${leases.get(v.descriptor.id)!.pace.left}%` }"
                      :title="leases.get(v.descriptor.id)!.pace.title" />
              </div>
              <span class="muted vcard__quota-text vcard__lease-detail" :title="leases.get(v.descriptor.id)!.detail">{{ leases.get(v.descriptor.id)!.detail }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vehicles { height: 100%; display: flex; flex-direction: column; }
.vehicles__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); container-type: inline-size; }
.empty { padding: 24px; text-align: center; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
/* `--vmap-min`: the COMMON minimum height of the map and of the panels that open over it */
.vcard { padding: 18px 20px; display: grid; gap: 14px; align-content: start; --vmap-min: 245px; }
/* Phone: the stack in DOM order — energy, status, buttons, map, quota. */
.vcard__energy, .vcard__state { display: grid; gap: 14px; align-content: start; min-width: 0; }
/* Buttons, vertical order: wake, refresh / unlock, charge / climate, edit */
.vcard__actions .pill[data-slot='wake'] { order: 1; }
.vcard__actions .pill[data-slot='refresh'] { order: 2; }
.vcard__actions .pill[data-slot='lock'] { order: 3; }
.vcard__actions .pill[data-slot='charge'] { order: 4; }
.vcard__actions .pill[data-slot='climate'] { order: 5; }
.vcard__actions .pill[data-slot='tuning'] { order: 6; }
/* the map, and the panel that opens OVER it: same box, no size changes */
/* Phone: map and panel in the SAME cell — the zone takes the height of the larger, and
   grows if the panel needs more; the map keeps its own */
.vcard__mapzone { position: relative; min-width: 0; display: grid; }
.vcard__mapbox, .vcard__overlay { grid-area: 1 / 1; }
/* stacking context: Leaflet's layers (z-index up to 1000) stay under the panel */
.vcard__mapbox { isolation: isolate; height: 100%; }
.vcard__mapbox[inert] { opacity: .35; transition: opacity .2s; }
.vcard__overlay {
  position: relative; z-index: 1; min-height: 100%;
  display: flex; flex-direction: column; padding: 0; border-radius: 14px;
}
/* the panel occupies the WHOLE map zone, not just its own height */
.vcard__overlay > * { flex: 1 0 auto; align-content: start; }
.vpanel-enter-active, .vpanel-leave-active { transition: opacity .2s ease, transform .22s ease; }
.vpanel-enter-from, .vpanel-leave-to { opacity: 0; transform: translateY(14px); }
@media (prefers-reduced-motion: reduce) { .vpanel-enter-from, .vpanel-leave-to { transform: none; } }
/* Wide: energy then status on the left, quota at the bottom; buttons above the map on the right.
   The buttons share the energy row and stretch down to its bottom: the map starts
   at the same height as the status cells. */
@container (min-width: 720px) {
  .cards { grid-template-columns: 1fr; }
  .vcard {
    grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px;
    grid-template-areas: 'a act' 'st map' 'q map';
  }
  .vcard__actions { grid-auto-rows: minmax(56px, 1fr); }
  /* `.vcard` first: the base rule of the tiles (56 px), further down in the file, would win */
  .vcard .vcard__actions .pill { height: auto; }
  .vcard__energy { grid-area: a; }
  .vcard__state { grid-area: st; }
  .vcard__actions { grid-area: act; }
  .vcard__mapzone { grid-area: map; display: flex; flex-direction: column; }
  /* the zone is fixed by the grid: the panel covers it exactly, and scrolls if needed */
  .vcard__overlay { position: absolute; inset: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .vcard__mapbox { flex: 1 1 auto; display: flex; flex-direction: column; }
  .vcard__mapbox > .vcard__map { flex: 1 1 auto; height: auto; min-height: var(--vmap-min); }
  .vcard__foot { grid-area: q; align-self: end; }
}
/* Wide screen: energy | status then buttons | map over the full height. The quota closes the left
   column. Map to the RIGHT of the buttons: those that open a panel go in the column that
   touches it — wake, refresh / unlock, climate / charge, edit */
@container (min-width: 1100px) {
  .vcard {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr);
    grid-template-areas: 'a st map' 'a act map' 'q act map';
  }
  /* here the buttons keep their height: the energy row does not concern them */
  .vcard__actions { grid-auto-rows: auto; }
  .vcard .vcard__actions .pill { height: 56px; }
  .vcard__actions .pill[data-slot='climate'] { order: 4; }
  .vcard__actions .pill[data-slot='charge'] { order: 5; }
}
.vcard__head { display: flex; align-items: center; gap: 12px; }
.vcard__name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* the pencil takes no space until you hover it: it is there, discreet, always at the same point */
.vcard__pencil {
  flex: none; display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; opacity: 0.55;
}
.vcard__pencil:hover, .vcard__pencil:focus-visible { opacity: 1; background: var(--surface); color: var(--text); }
.vcard__name-input {
  flex: 1 1 auto; min-width: 0; padding: 0 6px; margin: 0 -6px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: inherit; font-weight: inherit;
}
.vcard__name { font-weight: 600; font-size: 16px; }
/* a single row, cut: the age of the values opposite takes width from it, and a long place that
   wrapped made the header grow by 18 px on a phone (measured on 2026-10-01) */
.vcard__sub { font-size: 12px; display: flex; align-items: center; gap: 4px; min-width: 0; height: 18px; }
.vcard__sub-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the "show in the 3D view" pin: the `.badge--show` pill of the device lists (RoomBands),
   within the row height */
.vcard__locate {
  flex: none; display: grid; place-items: center; width: 18px; height: 18px; padding: 0;
  border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; transition: background .15s, color .15s;
}
.vcard__locate:hover, .vcard__locate:focus-visible { background: var(--accent-soft); color: var(--accent); }
.min0 { min-width: 0; flex: 1 1 auto; }
/* two fixed rows: the age stays on the second (the subtitle's) even without a sleep pill */
.vcard__side { flex: 0 0 auto; align-self: stretch; display: grid; grid-template-rows: auto auto; align-content: space-between; justify-items: end; }
.vcard__sleep { grid-row: 1; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
.vcard__age { grid-row: 2; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.vcard__sleep[data-asleep='1'] { color: var(--text); }
.vcard__icon[data-on='1'] { animation: vcard-halo 2s ease-out infinite; }
@keyframes vcard-halo {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); }
  100% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 0%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .vcard__icon[data-on='1'] { animation: none; }
}
.vcard__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { padding: 10px 12px; }
/* Section watermark: the icon, monochrome and very pale, at the bottom right, cropped by a
   quarter of its area. UNDER the text: `isolation` makes the section a stacking context, the
   `z-index: -1` stays in it (above the section's background, under its content). Absolute: it
   takes no space. */
.stat, .tires { position: relative; overflow: hidden; isolation: isolate; }
.wm { position: absolute; right: -6px; bottom: -6px; z-index: -1; color: var(--text); opacity: .07; pointer-events: none; }
.tires .wm { right: -8px; bottom: -8px; }
.stat__k { font-size: 11px; }
.stat__v { font-weight: 500; font-size: 14px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tires { padding: 10px 12px; display: grid; gap: 6px; }
.tires__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.tire { display: grid; gap: 2px; font-variant-numeric: tabular-nums; }
.tire__k { font-size: 11px; }
.tire__v { font-weight: 500; font-size: 13px; white-space: nowrap; }
.vcard__map { height: var(--vmap-min); }
/* the charge row holds its height even when empty: the card does not move when the charge
   starts. A HEIGHT equal to the row, not a minimum: `min-height: 16px` under an 18 px row let the
   whole bottom of the card drop by 2 px when the charge started (measured on 2026-10-01) */
.vcard__charge { margin: -8px 0 0; font-size: 12px; height: 1.5em; line-height: 1.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* two columns of IDENTICAL tiles, always the same layout: gestures (2 × 2), then sections */
.vcard__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
/* icon ABOVE the label: "Stop charging" fits in half a card, without being cut */
.vcard__actions .pill { min-width: 0; height: 56px; padding: 0 8px; border-radius: 12px; flex-direction: column; justify-content: center; gap: 3px; font-size: 13px; }
.vcard__label { max-width: 100%; }
.vcard__actions .pill :deep(svg), .vcard__actions .pill .v-progress-circular { flex: 0 0 auto; }
.vcard__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* a button that WAITS is not an unavailable button: the opacity of disabled buttons (.45)
   made the spinner barely visible, yet it is what carries the information */
.vcard__actions .pill[aria-busy='true']:disabled { opacity: .7; }
/* quota and lease stacked at the foot of the column */
.vcard__foot { display: grid; gap: 12px; min-width: 0; }
/* vendor quota: same language as the charge gauge at the top of the card, more discreet */
.vcard__quota { display: grid; gap: 6px; }
/* a single line: the text fits in the narrowest card (320 px), the cut is only a hairline */
.vcard__quota-text { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vcard__quota-track { height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
.vcard__quota-fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width .4s; }
/* the quota is running out: the same orange as the warnings of the Settings cards */
.vcard__quota-fill[data-tense='1'] { background: #d38b22; }
/* LEASE: the battery gauge (`VehicleBattery`, 8 px), cut into blocks by the anniversaries
   like the charge limit track (`ChargeLimitCard`, `.limit__mark`): 2 px slits of
   the card's background color, in a cropped track. The mark of the allowed maximum to date is
   `.soc__tick` of the battery (3 × 16 px, warning), set OVER the track, hence outside the
   cropping. The overrun turns red, like a low battery: in orange, the mark would have blended in. */
.vcard__lease-bar { position: relative; height: 8px; }
.vcard__lease-track { position: absolute; inset: 0; border-radius: 999px; background: var(--line); overflow: hidden; }
.vcard__lease-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); transition: width .4s, background .2s; }
.vcard__lease-fill[data-tense='1'] { background: rgb(var(--v-theme-error)); }
.vcard__lease-year { position: absolute; top: 0; bottom: 0; width: 2px; transform: translateX(-1px); background: var(--surface); }
.vcard__lease-pace {
  position: absolute; top: 50%; width: 3px; height: 16px; border-radius: 2px;
  transform: translate(-50%, -50%); background: rgb(var(--v-theme-warning));
}
/* the detail row holds its height even when empty (lease over): nothing moves under the gauge */
.vcard__lease-detail { height: 1.4em; line-height: 1.4em; }
</style>
