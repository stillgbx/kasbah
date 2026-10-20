<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { Capability, CommandInput, DeviceEntry, JournalEntry, SiteMap, StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import { useJournals } from '../composables/useJournals'
import JournalList from '../components/robots/JournalList.vue'
import MowerZones from '../components/robots/MowerZones.vue'
import { journalPoints } from '../lib/journal'
import { siteMapAnchor, siteMapFeatures } from '../lib/siteMap'
import { mowerStatus } from '../lib/mowerTask'
import type { LatLon } from '../lib/map'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import MowerTuning from '../components/robots/MowerTuning.vue'
import VehicleMap from '../components/vehicles/VehicleMap.vue'
import { formatAgo, formatDistance, formatPercent } from '../lib/format'
import { QUOTA_TENSE_PCT, offsetLocation, quotaPercent } from '../lib/map'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Robots view: one card per robot — mower or vacuum, the two kinds the house files here.
//
// The card of a VACUUM is shorter, and deliberately so: the `vacuum` contract only carries the
// activity, the battery, the bin and the error. No satellite map (it does not say where it is),
// no log (it does not declare the capability), no lifetime counters. Showing these sections
// empty to look like the mower would lie about what we know of it.
//
// For the mower: one card per mower robot. Activity, battery, what holds it in the garage, the
// vendor's error (code and text, as support knows them), the next start, the cutting height, the
// lifetime counters, and its position on the map — the same map as the vehicles, the house
// underneath. Everything is optional in the contract (the simulation does not say everything):
// every cell always exists and shows "—" by default, nothing shifts when a value arrives.
//
// The buttons follow the descriptor's CAPABILITIES: a read-only plugin is not offered
// what it would refuse.
const devices = useDevicesStore()
const house = useHouseStore()
const router = useRouter()
const { t, d, locale } = useI18n()
const EMPTY = '—'

type MowerEntry = DeviceEntry & { state: StateFor<'mower'> }
const mowers = computed(() => devices.list.filter((e): e is MowerEntry => e.state.kind === 'mower'))

type VacuumEntry = DeviceEntry & { state: StateFor<'vacuum'> }
const vacuums = computed(() => devices.list.filter((e): e is VacuumEntry => e.state.kind === 'vacuum'))
/** The bin: full, empty, or unknown — not every robot says it. */
const binState = (s: StateFor<'vacuum'>) => (s.binFull === undefined ? EMPTY : s.binFull ? t('vacuum.binFull') : t('vacuum.binOk'))
/** The mop pad (`mop` capability). */
const padState = (s: StateFor<'vacuum'>) => (s.mopAttached === undefined ? EMPTY : s.mopAttached ? t('vacuum.mopOn') : t('vacuum.mopOff'))
/** The remaining water. Also absent when the tank is removed — same gesture in both cases. */
const tankState = (s: StateFor<'vacuum'>) => (s.tankLevel === undefined || s.tankLevel === null ? EMPTY : formatPercent(s.tankLevel, locale.value))

/** The name chosen in the house wins over the vendor's; failing that, the vendor is authoritative. */
const displayName = (m: DeviceEntry) => house.houseDeviceFor(m.descriptor.id)?.name ?? m.descriptor.name
const has = (m: DeviceEntry, c: Capability) => m.descriptor.capabilities.includes(c)
/** "Husqvarna · Husqvarna Automower® 435X AWD" named the brand twice: the model that already carries it is enough. */
function makeAndModel(m: DeviceEntry): string {
  const brand = m.descriptor.meta.manufacturer ?? m.descriptor.pluginId
  const model = m.descriptor.meta.model
  if (!model) return brand
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} · ${model}`
}

/**
 * The robot's BASE: a parking spot reserved for it (`site.parkings[]`). As long as it is not
 * placed, the robot is drawn where its GPS puts it — hence askew next to its station, since a
 * GPS reading is good to within a few meters. The card says so and offers to place it: it is the
 * same gesture as for a device awaiting its place, except that here it is the STATION that is
 * placed, not the robot (it moves by itself).
 *
 * Placing arms the placement and takes you to the House view: the tap on the ground that follows
 * creates the base, and the spot's panel opens on its dimensions.
 */
const dockOf = (m: MowerEntry) => house.dockFor(m.descriptor.id)
async function placeDock(m: MowerEntry) {
  house.startPlacingParking('mower', m.descriptor.id)
  await router.push({ name: 'home' }).catch(() => { /* navigation redondante */ })
}
async function editDock(m: MowerEntry) {
  const dock = dockOf(m)
  if (!dock) return
  await router.push({ name: 'home' }).catch(() => { /* navigation redondante */ })
  house.selectParking(dock.id)
}

/**
 * The GPS offset adjusted in the house applies to the map as to the scene: it is on the aerial
 * photo that you see the robot next to its real place, and that is where the correction must show.
 * Offered ("Adjust") only for a robot placed by its GPS, never for a robot placed by hand.
 */
const tuning = ref<string | null>(null)
const tunable = (m: MowerEntry) => !!m.state.location && house.houseDeviceFor(m.descriptor.id)?.position === undefined
function mapLocation(m: MowerEntry) {
  const loc = m.state.location
  const origin = house.house?.origin
  const offset = house.houseDeviceFor(m.descriptor.id)?.gpsOffset
  return loc && origin && offset ? offsetLocation(origin, loc, offset) : loc
}

/** The status row under the gauge (`lib/mowerTask.ts`). Space always reserved: nothing moves when the error drops in. */
const statusLine = (s: StateFor<'mower'>) => mowerStatus(s, t, now.value, locale.value)
const nextStart = (s: StateFor<'mower'>) => (s.nextStartAt ? d(new Date(s.nextStartAt), 'short') : EMPTY)
const cuttingHeight = (s: StateFor<'mower'>) => (s.cuttingHeight === undefined ? EMPTY : t('mower.cuttingHeightValue', { h: s.cuttingHeight }))
/** "Connected · status 2 min ago": reachable, and how old what the vendor knows of it is. */
function connection(s: StateFor<'mower'>): string {
  const state = s.available ? t('mower.connected') : t('mower.offline')
  return s.statusAt ? `${state} · ${t('mower.statusAgo', { ago: formatAgo(s.statusAt, now.value, locale.value) })}` : state
}
const hours = (sec: number | undefined) => (sec === undefined ? EMPTY : `${new Intl.NumberFormat(locale.value).format(Math.round(sec / 3600))} h`)
const count = (n: number | undefined) => (n === undefined ? EMPTY : new Intl.NumberFormat(locale.value).format(n))
const distance = (m: number | undefined) => (m === undefined ? EMPTY : formatDistance(m, locale.value))
/** Under the card: how old the position is. */
const caption = (s: StateFor<'mower'>) => (s.location ? t('mower.positionAgo', { ago: formatAgo(s.location.at, now.value, locale.value) }) : undefined)

const busy = (m: DeviceEntry) => devices.isPending(m.descriptor.id)
async function send(id: string, cmd: CommandInput): Promise<void> {
  await devices.sendCommand(id, cmd)
  void devices.refreshHealth()                         // one more request: the gauge follows
}

// "12 min ago" ages by itself: a view clock, refreshed every half minute
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

/**
 * The robot's LOG (`journal` capability): what it has recorded itself, from the most recent to the
 * oldest. It ANNOUNCES ITSELF (a "Log" pill with the number of lines and the severity of the
 * last one) and expands on click — the card keeps its height as long as it is not asked for,
 * which is what made it jump before. Expanded, its positioned incidents are placed on the
 * satellite map, and a chosen row brings the map there: that is how a fault is located.
 */
const journalIds = computed(() => mowers.value.filter((m) => has(m, 'journal')).map((m) => m.descriptor.id))
const { journals } = useJournals(journalIds)
const journalOf = (m: MowerEntry): JournalEntry[] => journals.value[m.descriptor.id] ?? []
const journalOpen = ref<string | null>(null)
const journalFocus = ref<Record<string, JournalEntry | undefined>>({})
/**
 * The points MEMOIZED per robot: the map rebuilds its pills when the list changes identity,
 * and recomputing a fresh array on every render rebuilt them on every clock tick.
 */
const pointsByMower = computed(() => Object.fromEntries(mowers.value.map((m) => [m.descriptor.id, journalPoints(journalOf(m))])))
const NO_POINTS: never[] = []
const mapPoints = (m: MowerEntry) => (journalOpen.value === m.descriptor.id ? pointsByMower.value[m.descriptor.id] ?? NO_POINTS : NO_POINTS)
function pickEntry(m: MowerEntry, e: JournalEntry): void {
  journalFocus.value = { ...journalFocus.value, [m.descriptor.id]: e }
}
/** A pill touched on the map: the matching row becomes the active one (and scrolls into view). */
function pickAt(m: MowerEntry, at: number): void {
  const e = journalOf(m).find((x) => x.at === at)
  if (e) pickEntry(m, e)
}
const updatedAgo = (s: StateFor<'mower'>) => t('mower.updatedAgo', { ago: formatAgo(s.updatedAt, now.value, locale.value) })

/**
 * The TERRAIN MAP (`site_map` capability): requested once per robot, again when its zones
 * change (drawn, removed, renamed in the app), and every five minutes while the view is
 * open — the server re-reads it from the vendor when IT judges it stale (zones, synchronization,
 * a day) and serves its cache otherwise: asking again costs no quota. Replaced only if it has
 * changed, so as not to redraw the map for nothing. A map that cannot be read blocks nothing, it
 * is simply missing.
 */
const siteMaps = ref<Record<string, SiteMap>>({})
function loadSiteMap(id: string): void {
  getTransport().getSiteMap(id)
    .then((map) => {
      if (JSON.stringify(map) !== JSON.stringify(siteMaps.value[id])) siteMaps.value = { ...siteMaps.value, [id]: map }
    })
    .catch(() => { /* no map: the button does not appear */ })
}
const siteMapKeys = computed(() => mowers.value.filter((m) => has(m, 'site_map')).map((m) =>
  `${m.descriptor.id}|${(m.state.workAreas ?? []).map((a) => `${a.id}:${a.name}`).join(',')}|${(m.state.stayOutZones ?? []).map((z) => `${z.id}:${z.name}`).join(',')}`))
watch(siteMapKeys, (keys, old) => {
  for (const key of keys) if (!old?.includes(key)) loadSiteMap(key.slice(0, key.indexOf('|')))
}, { immediate: true })
const SITE_MAP_RELOAD_MS = 5 * 60_000
let siteMapTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { siteMapTimer = setInterval(() => { for (const key of siteMapKeys.value) loadSiteMap(key.slice(0, key.indexOf('|'))) }, SITE_MAP_RELOAD_MS) })
onBeforeUnmount(() => { if (siteMapTimer) clearInterval(siteMapTimer) })
/**
 * Where to place the map: its station on the robot's base, or on the robot at the station
 * (`lib/siteMap.ts`). The last anchoring is KEPT: a robot without a base that leaves to mow does
 * not make its map disappear.
 */
const lastAnchors = new Map<string, LatLon>()
const overlays = computed(() => Object.fromEntries(mowers.value.map((m) => {
  const map = siteMaps.value[m.descriptor.id]
  const anchor = siteMapAnchor({
    origin: house.house?.origin, dock: dockOf(m)?.center, location: mapLocation(m),
    atStation: m.state.activity === 'parked' || m.state.activity === 'charging',
    offset: house.houseDeviceFor(m.descriptor.id)?.mapOffset,
  }) ?? lastAnchors.get(m.descriptor.id)
  if (anchor) lastAnchors.set(m.descriptor.id, anchor)
  return [m.descriptor.id, map && anchor ? siteMapFeatures(map, anchor, m.state.stayOutZones, m.state.workAreas) : undefined]
})))

/** The zones panel: mow a zone, open or close an exclusion zone. */
const zonesOpen = ref<string | null>(null)
const hasZones = (m: MowerEntry) => has(m, 'work_areas') || has(m, 'stay_out_zones')

/**
 * The vendor API's quota (`PluginHealth.quota`): 21,000 requests per seven-day window at
 * Husqvarna. Plugin health is not pushed: we ask for it again on arrival, on every tick, after a
 * command. Nothing for a plugin that does not count (the simulation).
 */
const quotaOf = (m: MowerEntry) => devices.health?.plugins[m.descriptor.pluginId]?.quota
type Quota = NonNullable<ReturnType<typeof quotaOf>>
const quotaLabel = (q: Quota) => {
  const fmt = (n: number) => new Intl.NumberFormat(locale.value).format(n)
  const line = t('mower.quota', { used: fmt(q.used), limit: fmt(q.limit), what: t(q.labelKey) })
  if (!q.since) return line
  return `${line} · ${t('vehicle.quotaSince', { date: new Date(q.since).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' }) })}`
}
onMounted(() => {
  void devices.refreshHealth()
  clockTimer = setInterval(() => { now.value = Date.now(); void devices.refreshHealth() }, 30_000)
})
onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer) })
</script>

<template>
  <div class="robots">
    <PageHeader />
    <div class="robots__scroll">
      <div v-if="mowers.length === 0 && vacuums.length === 0" class="card card--soft empty muted">{{ $t('mower.none') }}</div>
      <div class="cards">
        <!-- The VACUUM. Four fields in the contract, hence four fields on screen: the activity, the
             battery, the bin, the error. The error row keeps its place even when empty (`min-height`),
             as on the mower: nothing shifts when a fault drops in. -->
        <article v-for="v in vacuums" :key="v.descriptor.id" class="card rcard rcard--vacuum" :data-unavailable="v.state.available ? '0' : '1'">
          <div class="rcard__group rcard__energy">
            <div class="rcard__head">
              <span class="icon-square" :data-on="v.state.activity === 'cleaning' ? '1' : '0'"><StrokeIcon name="vacuum" :size="18" /></span>
              <div class="min0">
                <div class="rcard__name">{{ displayName(v) }}</div>
                <div class="muted rcard__sub">{{ makeAndModel(v) }}</div>
              </div>
              <span class="rcard__activity" :data-tone="v.state.activity === 'error' ? 'error' : v.state.activity === 'cleaning' ? 'on' : 'off'">
                {{ $t(`vacuum.activities.${v.state.activity}`) }}
              </span>
            </div>
            <div class="rcard__soc">
              <div class="big-value">{{ formatPercent(v.state.battery, locale) }}</div>
              <div class="muted">{{ $t('vacuum.battery') }}</div>
            </div>
            <div class="rcard__bar">
              <div class="rcard__bar-fill" :data-low="v.state.battery < 20 ? '1' : '0'" :style="{ width: `${v.state.battery}%` }" />
            </div>
            <div class="rcard__status" :data-error="v.state.activity === 'error' ? '1' : '0'">
              <span class="rcard__status-text">{{ v.state.errorMessage ?? '' }}</span>
            </div>
          </div>
          <div class="rcard__group rcard__state">
            <div class="rcard__stats">
              <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.bin') }}</div><div class="stat__v">{{ binState(v.state) }}</div></div>
              <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.connection') }}</div><div class="stat__v">{{ v.state.available ? $t('vacuum.connected') : $t('vacuum.offline') }}</div></div>
              <!-- mop: two more cells, and only for a robot that WASHES. A dry Roomba
                   has no pad or tank, and two "—" cells would be worth less than nothing. -->
              <template v-if="has(v, 'mop')">
                <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.mopPad') }}</div><div class="stat__v">{{ padState(v.state) }}</div></div>
                <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.tank') }}</div><div class="stat__v">{{ tankState(v.state) }}</div></div>
              </template>
            </div>
          </div>
          <div class="rcard__group rcard__side">
            <div class="rcard__actions">
              <button v-if="has(v, 'clean')" type="button" class="pill" :data-on="v.state.activity === 'cleaning' ? '1' : '0'" :disabled="!v.state.available || busy(v)" :aria-busy="busy(v)"
                      @click="send(v.descriptor.id, v.state.activity === 'cleaning' ? { type: 'vacuum.pause' } : { type: 'vacuum.start' })">
                <v-progress-circular v-if="busy(v)" indeterminate size="16" width="2" />
                <StrokeIcon v-else :name="v.state.activity === 'cleaning' ? 'pause' : 'play'" :size="16" />
                {{ v.state.activity === 'cleaning' ? $t('common.pause') : $t('common.start') }}
              </button>
              <button v-if="has(v, 'dock')" type="button" class="pill" :disabled="!v.state.available || busy(v) || v.state.activity === 'docked'"
                      @click="send(v.descriptor.id, { type: 'vacuum.dock' })">
                <StrokeIcon name="home" :size="16" />{{ $t('common.dock') }}
              </button>
              <button v-if="has(v, 'locate')" type="button" class="pill" :disabled="!v.state.available || busy(v)"
                      @click="send(v.descriptor.id, { type: 'vacuum.locate' })">
                <StrokeIcon name="crosshair" :size="16" />{{ $t('common.locate') }}
              </button>
            </div>
          </div>
        </article>

        <!-- DOM order = the phone's stack. Wider, the groups become grid AREAS,
             like a vehicle's card: see `.rcard__group` and its two @containers. -->
        <article v-for="m in mowers" :key="m.descriptor.id" class="card rcard rcard--mower" :data-unavailable="m.state.available ? '0' : '1'">
          <div class="rcard__group rcard__energy">
            <div class="rcard__head">
              <span class="icon-square" :data-on="m.state.activity === 'mowing' ? '1' : '0'"><StrokeIcon name="mower" :size="18" /></span>
              <div class="min0">
                <div class="rcard__name">{{ displayName(m) }}</div>
                <div class="muted rcard__sub">{{ makeAndModel(m) }}</div>
              </div>
              <span class="rcard__activity" :data-tone="m.state.activity === 'error' ? 'error' : m.state.activity === 'mowing' ? 'on' : 'off'">
                {{ $t(`mower.activities.${m.state.activity}`) }}
              </span>
            </div>
            <div class="rcard__soc">
              <div class="big-value">{{ formatPercent(m.state.battery, locale) }}</div>
              <div class="muted">{{ $t('mower.battery') }}</div>
            </div>
            <div class="rcard__bar">
              <div class="rcard__bar-fill" :data-low="m.state.battery < 20 ? '1' : '0'" :style="{ width: `${m.state.battery}%` }" />
            </div>
            <!-- the vendor's error, or what holds the robot back: space ALWAYS reserved -->
            <div class="rcard__status" :data-error="m.state.activity === 'error' ? '1' : '0'">
              <span class="rcard__status-text">{{ statusLine(m.state) }}</span>
              <!-- an error that the vendor clears remotely: the link, on the row itself (nothing moves) -->
              <button v-if="has(m, 'confirm_error') && m.state.activity === 'error' && m.state.errorConfirmable" type="button" class="rcard__dismiss"
                      :disabled="!m.state.available || busy(m)" @click="send(m.descriptor.id, { type: 'mower.confirm_error' })">{{ $t('mower.confirmError') }}</button>
            </div>
          </div>
          <div class="rcard__group rcard__state">
            <div class="rcard__stats">
              <div class="card card--soft stat"><div class="muted stat__k">{{ $t('mower.nextStartLabel') }}</div><div class="stat__v">{{ nextStart(m.state) }}</div></div>
              <div class="card card--soft stat"><div class="muted stat__k">{{ $t('mower.cuttingHeight') }}</div><div class="stat__v">{{ cuttingHeight(m.state) }}</div></div>
              <div class="card card--soft stat stat--wide"><div class="muted stat__k">{{ $t('mower.connection') }}</div><div class="stat__v">{{ connection(m.state) }}</div></div>
            </div>
          </div>
          <!-- the lifetime counters, four fixed cells -->
          <div class="card card--soft counters">
            <div class="muted stat__k">{{ $t('mower.statistics') }}</div>
            <div class="counters__grid">
              <div class="counter"><span class="muted counter__k">{{ $t('mower.cuttingTime') }}</span><span class="counter__v">{{ hours(m.state.statistics?.cuttingTimeS) }}</span></div>
              <div class="counter"><span class="muted counter__k">{{ $t('mower.chargingCycles') }}</span><span class="counter__v">{{ count(m.state.statistics?.chargingCycles) }}</span></div>
              <div class="counter"><span class="muted counter__k">{{ $t('mower.collisions') }}</span><span class="counter__v">{{ count(m.state.statistics?.collisions) }}</span></div>
              <div class="counter"><span class="muted counter__k">{{ $t('mower.driveDistance') }}</span><span class="counter__v">{{ distance(m.state.statistics?.driveDistanceM) }}</span></div>
            </div>
          </div>
          <!-- the map: the robot (a disc, it does not say its heading), the house, and — log expanded — its incidents -->
          <VehicleMap class="rcard__map" subject="mower" :location="mapLocation(m)" :home="house.house?.origin" :caption="caption(m.state)"
                      :overlay="overlays[m.descriptor.id]" :points="mapPoints(m)" :focus="journalFocus[m.descriptor.id]?.location" :active-at="journalFocus[m.descriptor.id]?.at"
                      @point-tap="pickAt(m, $event)" />
          <!-- Its station. It is not a vendor command (so it does not follow the
               capabilities, and does not live in the row of buttons): it is a survey of the house,
               placed once, that parks the robot on its base as soon as it gets in. The row exists
               in both states, at the same height — nothing moves when the station is placed. -->
          <div class="rcard__group rcard__side">
            <div class="card card--soft dock">
              <div class="min0">
                <div class="muted stat__k">{{ $t('parking.dock') }}</div>
                <div class="stat__v dock__state" :data-todo="dockOf(m) ? '0' : '1'">
                  {{ dockOf(m) ? $t('parking.dockPlaced') : $t('parking.dockMissing') }}
                </div>
              </div>
              <button type="button" class="pill dock__btn" @click="dockOf(m) ? editDock(m) : placeDock(m)">
                <StrokeIcon name="parking" :size="16" />{{ dockOf(m) ? $t('vehicle.tune') : $t('parking.dockPlace') }}
              </button>
            </div>
            <div class="rcard__actions">
              <button v-if="has(m, 'mow')" type="button" class="pill" :data-on="m.state.activity === 'mowing' ? '1' : '0'" :disabled="!m.state.available || busy(m)" :aria-busy="busy(m)"
                      @click="send(m.descriptor.id, m.state.activity === 'mowing' ? { type: 'mower.pause' } : { type: 'mower.start', durationMin: 60 })">
                <v-progress-circular v-if="busy(m)" indeterminate size="16" width="2" />
                <StrokeIcon v-else :name="m.state.activity === 'mowing' ? 'pause' : 'play'" :size="16" />
                {{ m.state.activity === 'mowing' ? $t('common.pause') : $t('mower.startFor') }}
              </button>
              <button v-if="has(m, 'park')" type="button" class="pill" :disabled="!m.state.available || busy(m) || m.state.activity === 'parked' || m.state.activity === 'charging'"
                      @click="send(m.descriptor.id, { type: 'mower.park', untilNextSchedule: true })">
                <StrokeIcon name="parking" :size="16" />{{ $t('common.park') }}
              </button>
              <!-- "Mow" without a duration: the robot forgets pause and setpoints and follows its schedule -->
              <button v-if="has(m, 'schedule') && has(m, 'mow')" type="button" class="pill" :disabled="!m.state.available || busy(m)"
                      @click="send(m.descriptor.id, { type: 'mower.start' })">
                <StrokeIcon name="calendar" :size="16" />{{ $t('mower.resumeSchedule') }}
              </button>
              <button v-if="hasZones(m)" type="button" class="pill" :data-on="zonesOpen === m.descriptor.id ? '1' : '0'"
                      :aria-expanded="zonesOpen === m.descriptor.id"
                      @click="zonesOpen = zonesOpen === m.descriptor.id ? null : m.descriptor.id">
                <StrokeIcon name="layers" :size="16" />{{ $t('mower.zones') }}
              </button>
              <!-- the log announces itself: how many lines, and the severity of the last as a pill -->
              <button v-if="has(m, 'journal')" type="button" class="pill" :data-on="journalOpen === m.descriptor.id ? '1' : '0'"
                      :aria-expanded="journalOpen === m.descriptor.id"
                      @click="journalOpen = journalOpen === m.descriptor.id ? null : m.descriptor.id">
                <StrokeIcon name="list" :size="16" />{{ $t('mower.journal') }}
                <span class="rcard__count" :data-severity="journalOf(m)[0]?.severity ?? 'none'">{{ journalOf(m).length }}</span>
              </button>
              <!-- what the robot will never say: where it is REALLY, to within a few meters -->
              <button v-if="tunable(m)" type="button" class="pill" :data-on="tuning === m.descriptor.id ? '1' : '0'"
                      :aria-expanded="tuning === m.descriptor.id"
                      @click="tuning = tuning === m.descriptor.id ? null : m.descriptor.id">
                <StrokeIcon name="gear" :size="16" />{{ $t('vehicle.tune') }}
              </button>
            </div>
            <MowerZones v-if="zonesOpen === m.descriptor.id" :state="m.state" :work-areas="has(m, 'work_areas')" :stay-out-zones="has(m, 'stay_out_zones')"
                        :busy="busy(m)" @command="send(m.descriptor.id, $event)" />
            <div v-if="journalOpen === m.descriptor.id" class="card card--soft journal">
              <JournalList :entries="journalOf(m)" :active="journalFocus[m.descriptor.id]?.at" @pick="pickEntry(m, $event)" />
            </div>
            <MowerTuning v-if="tuning === m.descriptor.id" :descriptor="m.descriptor" />
          </div>
          <div class="rcard__group rcard__foot">
            <p class="muted rcard__hint">{{ updatedAgo(m.state) }}</p>
            <div v-if="quotaOf(m)" class="rcard__quota">
              <span class="muted rcard__quota-text">{{ quotaLabel(quotaOf(m)!) }}</span>
              <div class="rcard__quota-track">
                <div class="rcard__quota-fill" :data-tense="quotaPercent(quotaOf(m)!.used, quotaOf(m)!.limit) >= QUOTA_TENSE_PCT ? '1' : '0'"
                     :style="{ width: `${quotaPercent(quotaOf(m)!.used, quotaOf(m)!.limit)}%` }" />
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.robots { height: 100%; display: flex; flex-direction: column; }
.dock { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dock .min0 { flex: 1 1 0; min-width: 0; }
.dock__btn { flex: none; }
/* a missing station is not an error, it is a survey to finish: the accent tint says so
   without shouting, like the armed button of a placement */
.dock__state[data-todo='1'] { color: var(--accent); }
.robots__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); container-type: inline-size; }
.empty { padding: 24px; text-align: center; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.rcard { padding: 18px 20px; display: grid; gap: 14px; align-content: start; }
/* `min-width: 0` on each row: without it, a `nowrap` line (the vendor's model, a
   counter) sets the minimum width of the whole card, which then overflows its column instead of
   cutting the text — seen on a narrow window */
.rcard > *, .rcard__group > * { min-width: 0; }
/* Phone: the groups disappear (`contents`), their rows remain the card's, in DOM
   order. Wider, they become areas, modeled on the Vehicles view. */
.rcard__group { display: contents; }
@container (min-width: 720px) {
  .cards { grid-template-columns: 1fr; }
  .rcard { column-gap: 20px; }
  .rcard__group { display: grid; gap: 14px; align-content: start; }
  .rcard__energy { grid-area: a; }
  .rcard__state { grid-area: st; }
  .rcard__side { grid-area: side; }
  .rcard__foot { grid-area: f; align-self: end; }
  .counters { grid-area: cnt; align-self: start; }
  /* the card takes the full height of its column, 220 px at least (`.rcard` first: the base
     height, further down in the file, would win) */
  .rcard .rcard__map { grid-area: map; height: auto; min-height: 220px; }
  /* mower: everything on the left, the map on the right; vacuum (no map): energy and buttons | status */
  .rcard--mower { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-areas: 'a map' 'st map' 'cnt map' 'side map' 'f map'; }
  .rcard--vacuum { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-areas: 'a st' 'side st'; }
}
/* Wide screen: energy then counters | status then station and buttons | map over the full height;
   freshness and quota close the left column. The vacuum: three columns side by side. */
@container (min-width: 1100px) {
  .rcard--mower {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr);
    grid-template-areas: 'a st map' 'cnt side map' 'f side map';
  }
  .rcard--vacuum { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr); grid-template-areas: 'a st side'; }
}
.rcard[data-unavailable='1'] .rcard__soc, .rcard[data-unavailable='1'] .rcard__stats, .rcard[data-unavailable='1'] .counters { opacity: .55; }
.rcard__head { display: flex; align-items: center; gap: 12px; }
.rcard__name { font-weight: 600; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rcard__sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.min0 { min-width: 0; flex: 1 1 auto; }
/* the activity, as a pill on the right: accent when mowing, warning orange on error, neutral otherwise */
.rcard__activity { flex: 0 0 auto; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; white-space: nowrap; background: var(--surface2); color: var(--muted); }
.rcard__activity[data-tone='on'] { background: var(--accent); color: var(--on-accent); }
.rcard__activity[data-tone='error'] { background: #d38b22; color: #fff; }
.rcard__soc { display: flex; align-items: baseline; justify-content: space-between; }
.rcard__bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.rcard__bar-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s; }
.rcard__bar-fill[data-low='1'] { background: #d24a43; }
/* the status row holds its height even when empty: nothing moves when the error arrives or drops */
.rcard__status { margin: -8px 0 0; font-size: 12px; line-height: 16px; min-height: 16px; color: var(--muted); display: flex; gap: 10px; }
.rcard__status-text { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* "Hide": a link on the row itself, at its height (nothing moves when it goes) */
.rcard__dismiss { flex: none; padding: 0; border: 0; background: none; font: inherit; line-height: 16px; color: var(--muted); text-decoration: underline; cursor: pointer; }
.rcard__dismiss:hover { color: var(--text); }
.rcard__status[data-error='1'] { color: #d38b22; font-weight: 500; }
.rcard__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { padding: 10px 12px; min-width: 0; }
.stat--wide { grid-column: 1 / -1; }
.stat__k { font-size: 11px; }
.stat__v { font-weight: 500; font-size: 14px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.counters { padding: 10px 12px; display: grid; gap: 6px; }
.counters__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.counter { display: grid; gap: 2px; font-variant-numeric: tabular-nums; min-width: 0; }
.counter__k { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.counter__v { font-weight: 500; font-size: 13px; white-space: nowrap; }
.rcard__map { height: 220px; }
.journal { padding: 8px 10px; }
/* the log count, tinted with the severity of the last row; fixed minimum width: 9 or 22, same pill */
.rcard__count { min-width: 22px; padding: 1px 6px; border-radius: 999px; font-size: 11px; font-weight: 600; text-align: center; background: var(--surface2); color: var(--text); }
.rcard__count[data-severity='warning'] { background: #d38b22; color: #fff; }
.rcard__count[data-severity='error'], .rcard__count[data-severity='fatal'] { background: #d24a43; color: #fff; }
.pill[data-on='1'] .rcard__count { background: rgb(255 255 255 / .25); color: inherit; }
.rcard__actions { display: flex; gap: 8px; flex-wrap: wrap; min-height: 40px; }
.rcard__actions .pill[aria-busy='true']:disabled { opacity: .7; }
.rcard__hint { margin: 0; font-size: 12px; }
.rcard__quota { display: grid; gap: 6px; }
.rcard__quota-text { font-size: 11px; }
.rcard__quota-track { height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
.rcard__quota-fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width .4s; }
.rcard__quota-fill[data-tense='1'] { background: #d38b22; }
</style>
