<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { Capability, CommandInput, DeviceEntry, JournalEntry, StateFor } from '@kasbah/shared'
import { useJournals } from '../composables/useJournals'
import JournalList from '../components/robots/JournalList.vue'
import { journalPoints } from '../lib/journal'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import MowerTuning from '../components/robots/MowerTuning.vue'
import VehicleMap from '../components/vehicles/VehicleMap.vue'
import { formatAgo, formatDistance, formatPercent } from '../lib/format'
import { QUOTA_TENSE_PCT, offsetLocation, quotaPercent } from '../lib/map'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Vue Robots : une carte par robot — tondeuse ou aspirateur, les deux kinds que la maison range ici.
//
// La carte d'un ASPIRATEUR est plus courte, et volontairement : le contrat `vacuum` ne porte que
// l'activité, la batterie, le bac et l'erreur. Pas de carte satellite (il ne dit pas où il est), pas
// de journal (il ne déclare pas la capacité), pas de compteurs de vie. Afficher ces sections vides
// pour faire pareil que la tondeuse mentirait sur ce qu'on sait de lui.
//
// Pour la tondeuse : une carte par robot tondeuse. Activité, batterie, ce qui la retient au garage,
// l'erreur du fabricant (code et texte, comme le support les connaît), le prochain départ, la
// hauteur de coupe, les compteurs de vie, et sa position sur la carte — la même carte que les
// véhicules, la maison dessous. Tout est optionnel dans le contrat (la simulation ne dit pas tout) :
// chaque case existe toujours et affiche « — » à défaut, rien ne se décale quand une valeur arrive.
//
// Les boutons suivent les CAPACITÉS du descripteur : un plugin en lecture seule ne se voit pas
// proposer ce qu'il refuserait.
const devices = useDevicesStore()
const house = useHouseStore()
const router = useRouter()
const { t, d, locale } = useI18n()
const EMPTY = '—'

type MowerEntry = DeviceEntry & { state: StateFor<'mower'> }
const mowers = computed(() => devices.list.filter((e): e is MowerEntry => e.state.kind === 'mower'))

type VacuumEntry = DeviceEntry & { state: StateFor<'vacuum'> }
const vacuums = computed(() => devices.list.filter((e): e is VacuumEntry => e.state.kind === 'vacuum'))
/** Le bac : plein, vide, ou inconnu — tous les robots ne le disent pas. */
const binState = (s: StateFor<'vacuum'>) => (s.binFull === undefined ? EMPTY : s.binFull ? t('vacuum.binFull') : t('vacuum.binOk'))
/** Le patin de serpillière (capacité `mop`). */
const padState = (s: StateFor<'vacuum'>) => (s.mopAttached === undefined ? EMPTY : s.mopAttached ? t('vacuum.mopOn') : t('vacuum.mopOff'))
/** L'eau restante. Absente aussi quand le réservoir est retiré — même geste dans les deux cas. */
const tankState = (s: StateFor<'vacuum'>) => (s.tankLevel === undefined || s.tankLevel === null ? EMPTY : formatPercent(s.tankLevel, locale.value))

/** Le nom choisi dans la maison l'emporte sur celui du fabricant ; à défaut, le fabricant fait foi. */
const displayName = (m: DeviceEntry) => house.houseDeviceFor(m.descriptor.id)?.name ?? m.descriptor.name
const has = (m: DeviceEntry, c: Capability) => m.descriptor.capabilities.includes(c)
/** « Husqvarna · Husqvarna Automower® 435X AWD » disait deux fois la marque : le modèle qui la porte déjà suffit. */
function makeAndModel(m: DeviceEntry): string {
  const brand = m.descriptor.meta.manufacturer ?? m.descriptor.pluginId
  const model = m.descriptor.meta.model
  if (!model) return brand
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} · ${model}`
}

/**
 * La BASE du robot : une place de stationnement qui lui est réservée (`site.parkings[]`). Tant
 * qu'elle n'est pas posée, le robot se dessine où son GPS le met — donc de travers à côté de sa
 * station, puisqu'un relevé est bon à quelques mètres près. La carte le dit et propose de la poser :
 * c'est le même geste que pour un appareil qui attend sa place, sauf qu'ici c'est la STATION qu'on
 * pose, pas le robot (lui bouge tout seul).
 *
 * Poser arme la pose et emmène sur la vue Maison : le tap au sol qui suit crée la base, et le
 * panneau de la place s'ouvre sur ses cotes.
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
 * Le décalage GPS réglé dans la maison s'applique à la carte comme à la scène : c'est sur la photo
 * aérienne qu'on voit le robot à côté de sa vraie place, et c'est là qu'on doit voir la correction.
 * Proposé (« Régler ») seulement à un robot posé par son GPS, jamais à un robot placé à la main.
 */
const tuning = ref<string | null>(null)
const tunable = (m: MowerEntry) => !!m.state.location && house.houseDeviceFor(m.descriptor.id)?.position === undefined
function mapLocation(m: MowerEntry) {
  const loc = m.state.location
  const origin = house.house?.origin
  const offset = house.houseDeviceFor(m.descriptor.id)?.gpsOffset
  return loc && origin && offset ? offsetLocation(origin, loc, offset) : loc
}

/**
 * La ligne d'état sous la jauge : l'ERREUR du fabricant quand il y en a une (« Erreur 2 · No loop
 * signal · il y a 3 h »), sinon pourquoi le robot ne tond pas (planning, pluie, gel, consigne).
 * Place toujours réservée : rien ne bouge quand l'erreur tombe.
 */
function statusLine(s: StateFor<'mower'>): string {
  if (s.activity === 'error' || s.errorCode !== undefined) {
    const parts = [s.errorCode === undefined ? t('mower.activities.error') : t('mower.error', { code: s.errorCode })]
    if (s.errorMessage) parts.push(s.errorMessage)
    if (s.errorAt) parts.push(formatAgo(s.errorAt, now.value, locale.value))
    return parts.join(' · ')
  }
  if (s.restrictedReason && s.activity !== 'mowing' && s.activity !== 'returning') return t(`mower.restrictions.${s.restrictedReason}`)
  return ''
}
const nextStart = (s: StateFor<'mower'>) => (s.nextStartAt ? d(new Date(s.nextStartAt), 'short') : EMPTY)
const cuttingHeight = (s: StateFor<'mower'>) => (s.cuttingHeight === undefined ? EMPTY : t('mower.cuttingHeightValue', { h: s.cuttingHeight }))
/** « Connectée · statut il y a 2 min » : joignable, et de quand date ce que le fabricant en sait. */
function connection(s: StateFor<'mower'>): string {
  const state = s.available ? t('mower.connected') : t('mower.offline')
  return s.statusAt ? `${state} · ${t('mower.statusAgo', { ago: formatAgo(s.statusAt, now.value, locale.value) })}` : state
}
const hours = (sec: number | undefined) => (sec === undefined ? EMPTY : `${new Intl.NumberFormat(locale.value).format(Math.round(sec / 3600))} h`)
const count = (n: number | undefined) => (n === undefined ? EMPTY : new Intl.NumberFormat(locale.value).format(n))
const distance = (m: number | undefined) => (m === undefined ? EMPTY : formatDistance(m, locale.value))
/** Sous la carte : de quand date la position. */
const caption = (s: StateFor<'mower'>) => (s.location ? t('mower.positionAgo', { ago: formatAgo(s.location.at, now.value, locale.value) }) : undefined)

const busy = (m: DeviceEntry) => devices.isPending(m.descriptor.id)
async function send(id: string, cmd: CommandInput): Promise<void> {
  await devices.sendCommand(id, cmd)
  void devices.refreshHealth()                         // une requête de plus : la jauge suit
}

// « il y a 12 min » vieillit tout seul : une horloge de la vue, rafraîchie chaque demi-minute
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

/**
 * Le JOURNAL du robot (capacité `journal`) : ce qu'il a consigné lui-même, du plus récent au plus
 * ancien. Il se SIGNALE (une pilule « Journal » avec le nombre de lignes et la gravité de la
 * dernière) et se déplie au clic — la carte garde sa hauteur tant qu'on ne le demande pas, c'est ce
 * qui la faisait sauter avant. Déplié, ses incidents positionnés se posent sur la carte satellite,
 * et une ligne choisie y amène la carte : c'est ainsi qu'on localise une panne.
 */
const journalIds = computed(() => mowers.value.filter((m) => has(m, 'journal')).map((m) => m.descriptor.id))
const { journals } = useJournals(journalIds)
const journalOf = (m: MowerEntry): JournalEntry[] => journals.value[m.descriptor.id] ?? []
const journalOpen = ref<string | null>(null)
const journalFocus = ref<Record<string, JournalEntry | undefined>>({})
/**
 * Les points MÉMORISÉS par robot : la carte refait ses pastilles quand la liste change d'identité,
 * et recalculer un tableau neuf à chaque rendu les refaisait à chaque battement d'horloge.
 */
const pointsByMower = computed(() => Object.fromEntries(mowers.value.map((m) => [m.descriptor.id, journalPoints(journalOf(m))])))
const NO_POINTS: never[] = []
const mapPoints = (m: MowerEntry) => (journalOpen.value === m.descriptor.id ? pointsByMower.value[m.descriptor.id] ?? NO_POINTS : NO_POINTS)
function pickEntry(m: MowerEntry, e: JournalEntry): void {
  journalFocus.value = { ...journalFocus.value, [m.descriptor.id]: e }
}
/** Une pastille touchée sur la carte : la ligne correspondante devient l'active (et défile à portée de vue). */
function pickAt(m: MowerEntry, at: number): void {
  const e = journalOf(m).find((x) => x.at === at)
  if (e) pickEntry(m, e)
}
const updatedAgo = (s: StateFor<'mower'>) => t('mower.updatedAgo', { ago: formatAgo(s.updatedAt, now.value, locale.value) })

/**
 * Quota de l'API du fabricant (`PluginHealth.quota`) : 10 000 requêtes par mois chez Husqvarna. La
 * santé des plugins ne se pousse pas : on la redemande en arrivant, à chaque battement, après une
 * commande. Rien pour un plugin qui ne compte pas (la simulation).
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
        <!-- L'ASPIRATEUR. Quatre champs au contrat, donc quatre champs à l'écran : l'activité, la
             batterie, le bac, l'erreur. La ligne d'erreur garde sa place même vide (`min-height`),
             comme sur la tondeuse : rien ne se décale quand une panne tombe. -->
        <article v-for="v in vacuums" :key="v.descriptor.id" class="card rcard" :data-unavailable="v.state.available ? '0' : '1'">
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
          <p class="rcard__status" :data-error="v.state.activity === 'error' ? '1' : '0'">{{ v.state.errorMessage ?? '' }}</p>
          <div class="rcard__stats">
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.bin') }}</div><div class="stat__v">{{ binState(v.state) }}</div></div>
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.connection') }}</div><div class="stat__v">{{ v.state.available ? $t('vacuum.connected') : $t('vacuum.offline') }}</div></div>
            <!-- serpillière : deux cases de plus, et seulement pour un robot qui LAVE. Un Roomba sec
                 n'a pas de patin ni de réservoir, et deux cases à « — » vaudraient moins que rien. -->
            <template v-if="has(v, 'mop')">
              <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.mopPad') }}</div><div class="stat__v">{{ padState(v.state) }}</div></div>
              <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vacuum.tank') }}</div><div class="stat__v">{{ tankState(v.state) }}</div></div>
            </template>
          </div>
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
        </article>

        <article v-for="m in mowers" :key="m.descriptor.id" class="card rcard" :data-unavailable="m.state.available ? '0' : '1'">
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
          <!-- l'erreur du fabricant, ou ce qui retient le robot : place TOUJOURS réservée -->
          <p class="rcard__status" :data-error="m.state.activity === 'error' ? '1' : '0'">{{ statusLine(m.state) }}</p>
          <div class="rcard__stats">
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('mower.nextStartLabel') }}</div><div class="stat__v">{{ nextStart(m.state) }}</div></div>
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('mower.cuttingHeight') }}</div><div class="stat__v">{{ cuttingHeight(m.state) }}</div></div>
            <div class="card card--soft stat stat--wide"><div class="muted stat__k">{{ $t('mower.connection') }}</div><div class="stat__v">{{ connection(m.state) }}</div></div>
          </div>
          <!-- les compteurs de vie, quatre cases fixes -->
          <div class="card card--soft counters">
            <div class="muted stat__k">{{ $t('mower.statistics') }}</div>
            <div class="counters__grid">
              <div class="counter"><span class="muted counter__k">{{ $t('mower.cuttingTime') }}</span><span class="counter__v">{{ hours(m.state.statistics?.cuttingTimeS) }}</span></div>
              <div class="counter"><span class="muted counter__k">{{ $t('mower.chargingCycles') }}</span><span class="counter__v">{{ count(m.state.statistics?.chargingCycles) }}</span></div>
              <div class="counter"><span class="muted counter__k">{{ $t('mower.collisions') }}</span><span class="counter__v">{{ count(m.state.statistics?.collisions) }}</span></div>
              <div class="counter"><span class="muted counter__k">{{ $t('mower.driveDistance') }}</span><span class="counter__v">{{ distance(m.state.statistics?.driveDistanceM) }}</span></div>
            </div>
          </div>
          <!-- la carte : le robot (disque, il ne dit pas son cap), la maison, et — journal déplié — ses incidents -->
          <VehicleMap class="rcard__map" subject="mower" :location="mapLocation(m)" :home="house.house?.origin" :caption="caption(m.state)"
                      :points="mapPoints(m)" :focus="journalFocus[m.descriptor.id]?.location" :active-at="journalFocus[m.descriptor.id]?.at"
                      @point-tap="pickAt(m, $event)" />
          <!-- Sa station. Ce n'est pas une commande du fabricant (elle ne suit donc pas les
               capacités, et ne vit pas dans la rangée des boutons) : c'est un relevé de la maison,
               posé une fois, qui range le robot sur sa base dès qu'il y rentre. La ligne existe
               dans les deux états, à la même hauteur — rien ne bouge quand la station est posée. -->
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
            <!-- le journal se signale : combien de lignes, et la gravité de la dernière en pastille -->
            <button v-if="has(m, 'journal')" type="button" class="pill" :data-on="journalOpen === m.descriptor.id ? '1' : '0'"
                    :aria-expanded="journalOpen === m.descriptor.id"
                    @click="journalOpen = journalOpen === m.descriptor.id ? null : m.descriptor.id">
              <StrokeIcon name="list" :size="16" />{{ $t('mower.journal') }}
              <span class="rcard__count" :data-severity="journalOf(m)[0]?.severity ?? 'none'">{{ journalOf(m).length }}</span>
            </button>
            <!-- ce que le robot ne dira jamais : où il est VRAIMENT, à quelques mètres près -->
            <button v-if="tunable(m)" type="button" class="pill" :data-on="tuning === m.descriptor.id ? '1' : '0'"
                    :aria-expanded="tuning === m.descriptor.id"
                    @click="tuning = tuning === m.descriptor.id ? null : m.descriptor.id">
              <StrokeIcon name="gear" :size="16" />{{ $t('vehicle.tune') }}
            </button>
          </div>
          <div v-if="journalOpen === m.descriptor.id" class="card card--soft journal">
            <JournalList :entries="journalOf(m)" :active="journalFocus[m.descriptor.id]?.at" @pick="pickEntry(m, $event)" />
          </div>
          <MowerTuning v-if="tuning === m.descriptor.id" :descriptor="m.descriptor" />
          <p class="muted rcard__hint">{{ updatedAgo(m.state) }}</p>
          <div v-if="quotaOf(m)" class="rcard__quota">
            <span class="muted rcard__quota-text">{{ quotaLabel(quotaOf(m)!) }}</span>
            <div class="rcard__quota-track">
              <div class="rcard__quota-fill" :data-tense="quotaPercent(quotaOf(m)!.used, quotaOf(m)!.limit) >= QUOTA_TENSE_PCT ? '1' : '0'"
                   :style="{ width: `${quotaPercent(quotaOf(m)!.used, quotaOf(m)!.limit)}%` }" />
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
/* une station qui manque n'est pas une erreur, c'est un relevé à finir : la teinte d'accent le dit
   sans crier, comme le bouton armé d'une pose */
.dock__state[data-todo='1'] { color: var(--accent); }
.robots__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.empty { padding: 24px; text-align: center; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.rcard { padding: 18px 20px; display: grid; gap: 14px; align-content: start; }
/* `min-width: 0` sur chaque rangée : sans lui, une ligne en `nowrap` (le modèle du fabricant, un
   compteur) fixe la largeur minimale de toute la carte, qui déborde alors de sa colonne au lieu de
   couper le texte — constaté sur une fenêtre étroite */
.rcard > * { min-width: 0; }
.rcard[data-unavailable='1'] .rcard__soc, .rcard[data-unavailable='1'] .rcard__stats, .rcard[data-unavailable='1'] .counters { opacity: .55; }
.rcard__head { display: flex; align-items: center; gap: 12px; }
.rcard__name { font-weight: 600; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rcard__sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.min0 { min-width: 0; flex: 1 1 auto; }
/* l'activité, en pastille à droite : accent en tonte, orangé d'avertissement en erreur, neutre sinon */
.rcard__activity { flex: 0 0 auto; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; white-space: nowrap; background: var(--surface2); color: var(--muted); }
.rcard__activity[data-tone='on'] { background: var(--accent); color: var(--on-accent); }
.rcard__activity[data-tone='error'] { background: #d38b22; color: #fff; }
.rcard__soc { display: flex; align-items: baseline; justify-content: space-between; }
.rcard__bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.rcard__bar-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s; }
.rcard__bar-fill[data-low='1'] { background: #d24a43; }
/* la ligne d'état tient sa hauteur même vide : rien ne bouge quand l'erreur arrive ou tombe */
.rcard__status { margin: -8px 0 0; font-size: 12px; min-height: 16px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
/* le compte du journal, teinté de la gravité de la dernière ligne ; largeur minimale fixe : 9 ou 22, même pilule */
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
