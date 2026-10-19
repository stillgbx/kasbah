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
import { leaseOverPace, leaseProgress } from '../lib/vehicleLease'
import { tunableVehicle } from '../lib/vehicleTuning'
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
const router = useRouter()
const { t, locale } = useI18n()
const EMPTY = '—'
const TIRES = ['fl', 'fr', 'rl', 'rr'] as const

/**
 * Renommage d'un véhicule. Le nom choisi vit dans la MAISON (`house.devices[].name`), pas dans
 * l'état : l'état est la vérité du fabricant, réécrite à chaque lecture. Une voiture n'étant pas
 * placée dans la scène 3D, son entrée de maison n'a pas de position — d'où `position` facultative
 * dans le placement. Vider le champ efface le nom choisi et rend la main au fabricant.
 */
/** Le nom choisi dans la maison l'emporte sur celui du fabricant ; à défaut, le fabricant fait foi. */
const displayName = (v: VehicleEntry) => house.houseDeviceFor(v.descriptor.id)?.name ?? v.descriptor.name

const renaming = ref<string | null>(null)
const renameText = ref('')
/** Le champ monté, s'il y en a un. Ref de FONCTION : un `ref` nommé dans un `v-for` rend un tableau. */
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
 * Sur le TERRAIN, la voiture est dessinée dans la 3D : même test que la scène (`gpsPoint`), le
 * relevé corrigé de son décalage tombe dans le polygone du terrain. « À la maison » (rayon) ne suffit
 * pas : le rayon déborde le terrain, et on proposerait d'aller voir une voiture que la 3D ne montre pas.
 */
function onSite(v: VehicleEntry): boolean {
  const h = house.effective ?? house.house
  if (!h || !v.state.location) return false
  return sitePosition(h, v.state.location, house.houseDeviceFor(v.descriptor.id)?.gpsOffset) !== null
}
/** Ouvre la voiture dans la 3D, même ordre que la liste des appareils : naviguer, PUIS sélectionner. */
async function showIn3d(v: VehicleEntry): Promise<void> {
  await router.push({ name: 'home' }).catch(() => {})
  house.selectDevice(house.houseDeviceFor(v.descriptor.id)?.id ?? v.descriptor.id)
}
const has = (v: VehicleEntry, c: Capability) => v.descriptor.capabilities.includes(c)
const asleep = (s: StateFor<'vehicle'>) => s.sleepState !== undefined && s.sleepState !== 'online'

/** « En route · 83 km/h » quand ça roule, sinon le rapport ou « Garé » ; « — » si rien n'est connu. */
function movement(s: StateFor<'vehicle'>): string {
  if (s.speedKmh === undefined && s.gear === undefined) return EMPTY
  if ((s.speedKmh ?? 0) > 0 || (s.gear !== undefined && s.gear !== 'P')) {
    return `${t('vehicle.moving')} · ${formatKm(s.speedKmh ?? 0, locale.value)}/h`
  }
  return t('vehicle.parked')
}
/** Où en est le câble : « Débranché », « Branché », « En charge ». Le détail va sous la jauge. */
function charge(s: StateFor<'vehicle'>): string {
  if (s.charging) return t('vehicle.charging')
  return s.pluggedIn ? t('vehicle.pluggedIn') : t('vehicle.unplugged')
}
/**
 * Ce que la charge en cours donne de plus : puissance, fin estimée, cible. Chaque morceau est
 * facultatif — aucun fabricant ne les donne tous (la R5 ne dit pas la puissance, elle dit le temps ;
 * Tesla dit les deux). Vide hors charge : la ligne reste, sa place est réservée.
 *
 * Rien n'est calculé ici : un temps restant se déduirait mal d'une puissance instantanée, la courbe
 * de charge n'étant pas linéaire. C'est le véhicule qui estime, ou personne.
 */
function chargeDetail(v: VehicleEntry): string {
  const s = v.state
  if (!s.charging) return ''
  const parts: string[] = []
  // la puissance MESURÉE si le véhicule la donne ; sinon celle qu'on déduit de sa propre estimation
  // du temps restant — et qui ne se présente alors pas comme une mesure
  const guess = estimateChargePowerW(s, capacityOf(v) || undefined)
  if (s.chargePowerW) parts.push(formatPower(s.chargePowerW, locale.value))
  else if (guess !== undefined) parts.push(t('vehicle.chargeEstimated', { power: formatPower(guess, locale.value) }))
  if (s.chargeMinutesRemaining !== undefined) parts.push(t('vehicle.chargeEta', { time: formatMinutes(s.chargeMinutesRemaining, locale.value) }))
  if (s.chargeLimit !== undefined) parts.push(t('vehicle.chargeTarget', { percent: formatPercent(s.chargeLimit, locale.value) }))
  return parts.join(' · ')
}

/** Verrouillage : « — » tant qu'on ne sait pas (tous les constructeurs ne le disent pas). */
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
 * Ce que seul l'utilisateur peut savoir, replié derrière « Régler » : le décalage 3D, la rotation et
 * la capacité de la batterie (cf. `VehicleTuning`). Un véhicule qui n'a rien à régler — placé à la
 * main ET bavard sur sa puissance de charge — ne se voit pas proposer le bouton.
 */
const tunable = (v: VehicleEntry) => tunableVehicle(v.descriptor, house.houseDeviceFor(v.descriptor.id))
const capacityOf = (v: VehicleEntry) => house.houseDeviceFor(v.descriptor.id)?.batteryKwh ?? 0

/**
 * La LIMITE DE CHARGE, seul réglage de la voiture que la carte laisse changer (cf.
 * `ChargeLimitCard`, partagée avec le panneau de la vue Maison).
 *
 * La valeur qu'on TIENT pendant qu'on glisse vit ici : sans elle, le curseur reviendrait à la valeur
 * du véhicule à chaque image : l'état ne bouge qu'au relâché, quand la commande part.
 */
const dragged = ref<Record<string, number>>({})
const limitOf = (v: VehicleEntry) => dragged.value[v.descriptor.id] ?? v.state.chargeLimit ?? 80
const preview = (v: VehicleEntry, percent: number) => {
  dragged.value = { ...dragged.value, [v.descriptor.id]: percent }
}
/** Endormie, la voiture refuse ses commandes (408 chez Tesla) : mieux vaut ne pas les proposer. */
const limitLocked = (v: VehicleEntry) => !v.state.available || asleep(v.state)
async function setLimit(v: VehicleEntry, percent: number): Promise<void> {
  const id = v.descriptor.id
  preview(v, percent)
  await send(id, { type: 'vehicle.set_charge_limit', percent })
  // la main rendue à l'état : accepté, il porte déjà la cible ; refusé, il a repris l'ancienne
  const next = { ...dragged.value }
  delete next[id]
  dragged.value = next
}

async function send(id: string, cmd: CommandInput): Promise<boolean> {
  const ok = await devices.sendCommand(id, cmd)
  void devices.refreshHealth()                         // une lecture consommée : la jauge de quota suit
  return ok
}

/**
 * Réveil DEMANDÉ, pas encore constaté. Tesla accuse la demande en une seconde, mais la voiture met
 * une dizaine de secondes à ouvrir les yeux (le plugin la relit 15 s plus tard) : `isPending`, qui ne
 * couvre que l'aller-retour avec le serveur, rendrait le bouton inerte alors que rien n'a encore
 * changé à l'écran. Levé dès que le véhicule se déclare éveillé — ou au bout de `WAKE_MAX_MS` s'il ne
 * répond pas, pour ne pas laisser un bouton bloqué sur une voiture hors de portée.
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
 * Une commande est en vol pour ce véhicule, ou son effet est attendu (réveil, charge) : les gestes qui
 * s'y croiseraient sont grisés. Seul le bouton de la commande en cours TOURNE (`waking`, `refreshing`,
 * `devices.isChargeRequested`) : « Lancer la charge » faisait tourner Réveiller et Actualiser.
 */
const busy = (v: VehicleEntry) => devices.isPending(v.descriptor.id) || v.descriptor.id in waking.value || devices.isChargeRequested(v.descriptor.id)
const charging = (v: VehicleEntry) => devices.isChargeRequested(v.descriptor.id)
/** Relecture en vol : le spinner d'Actualiser, et lui seul. */
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
  else stopWaking(id)                                  // demande refusée : le bouton revient tout de suite
}
// le véhicule a ouvert les yeux : le bouton a fini son travail (et cède la place à « Actualiser »)
watch(vehicles, (list) => { for (const v of list) if (v.state.sleepState === 'online') stopWaking(v.descriptor.id) })

/**
 * Le panneau ouvert, UN à la fois : la climatisation (marche, consigne, sièges, cf. `VehicleClimate`)
 * ou les réglages (cf. `VehicleTuning`). Ils s'ouvrent au même endroit, par-dessus la carte.
 */
type Panel = 'climate' | 'tuning'
const panel = ref<{ id: string; kind: Panel } | null>(null)
const panelOf = (v: VehicleEntry): Panel | null => (panel.value?.id === v.descriptor.id ? panel.value.kind : null)
function togglePanel(v: VehicleEntry, kind: Panel): void {
  panel.value = panelOf(v) === kind ? null : { id: v.descriptor.id, kind }
}
/** Sous la carte : où est la voiture par rapport à la maison, et son kilométrage. */
const caption = (s: StateFor<'vehicle'>) =>
  `${location(s)}${s.odometerKm ? ` · ${t('vehicle.odometer')} ${formatKm(s.odometerKm, locale.value)}` : ''}`

// « lu il y a 12 min » vieillit tout seul : une horloge de la vue, rafraîchie chaque demi-minute
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
/**
 * Quota de l'API du fabricant (`PluginHealth.quota`), montré en jauge au bas de la carte. La santé
 * des plugins ne se pousse pas : on la redemande au serveur (requête locale) en arrivant, à chaque
 * battement d'horloge, et après une commande — un réveil ou une relecture consomme le budget.
 */
const quotaOf = (v: VehicleEntry) => devices.health?.plugins[v.descriptor.pluginId]?.quota
type Quota = NonNullable<ReturnType<typeof quotaOf>>
/**
 * « 0,42 $/10,00 $ de crédit Tesla · depuis le 13 sept. » — le plugin dit CE qu'il compte (`labelKey`),
 * dans quelle unité (`unit`) et depuis quand (`since`) ; la vue ne fait que mettre en forme, dans la
 * langue et le format de l'interface.
 */
const quotaLabel = (q: Quota) => {
  const fmt = (n: number) => (q.unit === 'usd'
    // `narrowSymbol` : « 3,42 $ » et non « 3,42 $US », qui alourdit une ligne déjà dense
    ? new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(n)
    : new Intl.NumberFormat(locale.value).format(n))
  const line = t('vehicle.quota', { used: fmt(q.used), limit: fmt(q.limit), what: t(q.labelKey) })
  if (!q.since) return line
  const date = new Date(q.since).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
  return `${line} · ${t('vehicle.quotaSince', { date })}`
}
/**
 * La LOA saisie au panneau « Modifier », contre le compteur lu : deux lignes et une jauge, à la place
 * du quota (la R5 n'en a pas). Rien sans LOA saisie ni compteur lu. Le repère de la jauge est le
 * rythme autorisé à ce jour ; la jauge passe à l'orangé quand on roule plus vite que lui.
 */
const leases = computed(() => {
  const out = new Map<string, { line: string; detail: string; fill: number; pace: number; tense: boolean }>()
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
      pace: p.elapsedShare * 100,
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
          <!-- Ordre du DOM = la pile du téléphone : énergie, état, boutons, carte, quota. Plus large, des
               ZONES de grille (et non des colonnes) : un bloc qui couvre plusieurs rangées laisse ses voisins
               se suivre sans trou. Voir `.vcard` et ses deux @container. -->
          <div class="vcard__energy">
            <div class="vcard__head">
              <!-- en charge : l'éclair et un halo qui pulse (une ombre : rien ne bouge autour) -->
              <span class="icon-square vcard__icon" :data-on="v.state.charging ? '1' : '0'"><StrokeIcon :name="v.state.charging ? 'bolt' : 'vehicle'" :size="18" /></span>
              <div class="min0">
                <!-- nom, ou saisie : le champ occupe la MÊME boîte que le titre, rien ne se décale -->
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
                <!-- sur le terrain, l'épingle au bout du lieu mène (même pastille que les listes d'appareils) à la voiture dans la 3D. Il est au BOUT
                     de la ligne : absent, il ne décale rien -->
                <div class="muted vcard__sub">
                  <span class="vcard__sub-text" :title="`${v.descriptor.meta.manufacturer ?? v.descriptor.pluginId} · ${location(v.state)}`">{{ v.descriptor.meta.manufacturer ?? v.descriptor.pluginId }} · {{ location(v.state) }}</span>
                  <button v-if="onSite(v)" type="button" class="vcard__locate" :title="$t('common.showIn3d')" :aria-label="$t('common.showIn3d')" @click="showIn3d(v)">
                    <StrokeIcon name="pin" :size="14" />
                  </button>
                </div>
              </div>
              <!-- à droite, deux lignes en face du nom et du sous-titre : la veille, puis l'âge des valeurs.
                   L'âge est en HAUT de carte : il ne descend plus quand un panneau s'ouvre -->
              <div class="vcard__side">
                <!-- pas de pastille quand le fabricant n'a pas de veille (Renault) : un soleil suivi d'un
                     tiret se lirait « éveillée : inconnu ». Rien ne bouge pour autant, l'absence est stable -->
                <span v-if="v.state.sleepState !== undefined" class="vcard__sleep muted" :data-asleep="asleep(v.state) ? '1' : '0'">
                  <StrokeIcon :name="asleep(v.state) ? 'moon' : 'sun'" :size="14" />{{ $t(`vehicle.sleep.${v.state.sleepState}`) }}
                </span>
                <!-- l'âge des valeurs, toujours affiché : sur une API facturée et une voiture qui dort, elles en ont un -->
                <span class="muted vcard__age" :title="asleep(v.state) ? $t('vehicle.wakeHint') : undefined">{{ readAgo(v.state) }}</span>
              </div>
            </div>
            <!-- l'autonomie : le composant partagé avec le panneau de la vue Maison ; le repère de cible suit le curseur -->
            <VehicleBattery :state="v.state" :limit="limitOf(v)" />
            <!-- détail de la charge en cours : place TOUJOURS réservée, rien ne se décale quand elle démarre -->
            <p class="muted vcard__charge">{{ chargeDetail(v) }}</p>
            <!-- la cible de charge, quand le véhicule la laisse écrire : paliers au doigt, curseur au pour cent -->
            <ChargeLimitCard v-if="has(v, 'charge_limit')" watermark :value="limitOf(v)" :disabled="limitLocked(v)"
                             :hint="asleep(v.state) ? $t('vehicle.wakeHint') : undefined"
                             @preview="preview(v, $event)" @change="setLimit(v, $event)" />
          </div>
          <div class="vcard__state">
            <!-- chaque section porte en filigrane, en bas à droite, l'icône de ce qu'elle dit (essai 2026-10-01) -->
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
            <!-- quatre roues, quatre cases fixes, dans l'ordre où on regarde une voiture de dessus -->
            <div class="card card--soft tires">
              <StrokeIcon class="wm" name="tire" :size="56" />
              <div class="muted stat__k">{{ $t('vehicle.tires') }}</div>
              <div class="tires__grid">
                <div v-for="k in TIRES" :key="k" class="tire"><span class="muted tire__k">{{ $t(`vehicle.tire.${k}`) }}</span><span class="tire__v">{{ tire(v.state, k) }}</span></div>
              </div>
            </div>
            <!-- logiciel : version installée et mise à jour en attente, toujours là ; ouvre les notes de version -->
            <VehicleSoftware :descriptor="v.descriptor" :state="v.state" />
          </div>
          <!-- TOUS les boutons, toujours : ce qu'un véhicule ne sait pas faire est grisé, avec la raison
               (règle de l'utilisateur, 2026-10-01). Une grille de six, rangée par `order` (`data-slot`) :
               carte à droite, les boutons qui ouvrent un panneau sont dans la colonne qui la touche -->
          <div class="vcard__actions">
            <!-- réveiller est un geste explicite (Tesla le facture) : jamais automatique. TOUJOURS là pour un
                 véhicule qui connaît la veille, grisé quand il est éveillé : s'il apparaissait et
                 disparaissait, la rangée changerait de nombre de lignes et pousserait le panneau de la clim -->
            <button type="button" class="pill" data-slot="wake" :disabled="v.state.sleepState === undefined || !v.state.available || !asleep(v.state) || busy(v)"
                    :aria-busy="v.descriptor.id in waking" :title="v.state.sleepState === undefined ? $t('vehicle.unsupported') : $t('vehicle.wakeHint')" @click="wake(v)">
              <!-- le spinner prend la PLACE de l'icône, même taille : le bouton ne change pas de largeur -->
              <v-progress-circular v-if="v.descriptor.id in waking" indeterminate size="16" width="2" />
              <StrokeIcon v-else name="sun" :size="16" /><span class="vcard__label">{{ $t('vehicle.wake') }}</span>
            </button>
            <!-- relire maintenant (lecture facturée, pas de réveil) ; le sondage repart de cette lecture.
                 Proposé MÊME endormi : c'est ainsi qu'on constate qu'une voiture s'est réveillée seule,
                 sans payer le réveil -->
            <button type="button" class="pill" data-slot="refresh" :disabled="!has(v, 'soc') || !v.state.available || devices.isPending(v.descriptor.id)"
                    :aria-busy="v.descriptor.id in refreshing" :title="$t('vehicle.refreshHint')" @click="refresh(v)">
              <!-- il reste cliquable PENDANT un réveil : c'est justement le moment où l'on veut
                   demander « alors, tu es réveillée ? » sans repayer un réveil -->
              <v-progress-circular v-if="v.descriptor.id in refreshing" indeterminate size="16" width="2" />
              <StrokeIcon v-else name="rotateRight" :size="16" /><span class="vcard__label">{{ $t('vehicle.refresh') }}</span>
            </button>
            <button type="button" class="pill" data-slot="lock" :disabled="!has(v, 'lock') || !v.state.available"
                    :title="has(v, 'lock') ? undefined : $t('vehicle.unsupported')" @click="send(v.descriptor.id, { type: v.state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">
              <StrokeIcon :name="v.state.locked ? 'lockOpen' : 'lock'" :size="16" /><span class="vcard__label">{{ v.state.locked ? $t('common.unlock') : $t('common.lock') }}</span>
            </button>
            <!-- demandée, la charge tourne jusqu'à ce que la voiture la DISE active (20 s à 1 min, cf. le store) -->
            <button type="button" class="pill" data-slot="charge" :data-on="v.state.charging ? '1' : '0'"
                    :disabled="!has(v, 'charging') || !v.state.pluggedIn || !v.state.available || busy(v)" :aria-busy="charging(v)"
                    :title="!has(v, 'charging') ? $t('vehicle.unsupported') : v.state.pluggedIn ? undefined : $t('vehicle.unplugged')"
                    @click="send(v.descriptor.id, { type: v.state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
              <v-progress-circular v-if="charging(v)" indeterminate size="16" width="2" />
              <StrokeIcon v-else :name="v.state.charging ? 'boltOff' : 'bolt'" :size="16" />
              <span class="vcard__label">{{ v.state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}</span>
            </button>
            <!-- ouvre le panneau ; la teinte dit que la clim TOURNE (libellé fixe : la largeur ne bouge pas) -->
            <button type="button" class="pill" data-slot="climate" :data-on="v.state.climateOn ? '1' : '0'" :disabled="!has(v, 'climate_precondition')"
                    :aria-expanded="panelOf(v) === 'climate'" :title="has(v, 'climate_precondition') ? $t('vehicle.climateHint') : $t('vehicle.unsupported')"
                    @click="togglePanel(v, 'climate')">
              <StrokeIcon name="thermostat" :size="16" /><span class="vcard__label">{{ $t('vehicle.climatePanel.title') }}</span>
            </button>
            <!-- ce que la voiture ne dira jamais : replié, parce qu'on le règle une fois -->
            <!-- grisé quand il n'y a RIEN à régler (placé à la main, et bavard sur sa puissance) -->
            <button type="button" class="pill" data-slot="tuning" :data-on="panelOf(v) === 'tuning' ? '1' : '0'" :disabled="!tunable(v)"
                    :aria-expanded="panelOf(v) === 'tuning'"
                    @click="togglePanel(v, 'tuning')">
              <StrokeIcon name="gear" :size="16" /><span class="vcard__label">{{ $t('vehicle.tune') }}</span>
            </button>
          </div>
          <!-- la carte : voiture (avec son cap) et maison, plan ou satellite, plein écran. Un panneau s'ouvre
               PAR-DESSUS, sans la redimensionner ; elle ne prend alors plus la main (`inert`) -->
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
          <!-- le pied de la colonne de gauche : quota du fabricant et LOA, l'un sous l'autre -->
          <div v-if="quotaOf(v) || leases.get(v.descriptor.id)" class="vcard__foot">
            <!-- ce qu'il reste du quota que le plugin s'impose (API du fabricant facturée) : rien pour
                 un plugin qui ne compte pas, la simulation par exemple -->
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
                <div class="vcard__quota-track">
                  <div class="vcard__quota-fill" :data-tense="leases.get(v.descriptor.id)!.tense ? '1' : '0'"
                       :style="{ width: `${leases.get(v.descriptor.id)!.fill}%` }" />
                </div>
                <span class="vcard__lease-pace" :style="{ left: `${leases.get(v.descriptor.id)!.pace}%` }" />
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
/* `--vmap-min` : la hauteur minimale COMMUNE de la carte et des panneaux qui s'ouvrent par-dessus */
.vcard { padding: 18px 20px; display: grid; gap: 14px; align-content: start; --vmap-min: 245px; }
/* Téléphone : la pile dans l'ordre du DOM — énergie, état, boutons, carte, quota. */
.vcard__energy, .vcard__state { display: grid; gap: 14px; align-content: start; min-width: 0; }
/* Boutons, ordre vertical : réveiller, actualiser / déverrouiller, charge / clim, modifier */
.vcard__actions .pill[data-slot='wake'] { order: 1; }
.vcard__actions .pill[data-slot='refresh'] { order: 2; }
.vcard__actions .pill[data-slot='lock'] { order: 3; }
.vcard__actions .pill[data-slot='charge'] { order: 4; }
.vcard__actions .pill[data-slot='climate'] { order: 5; }
.vcard__actions .pill[data-slot='tuning'] { order: 6; }
/* la carte, et le panneau qui s'ouvre PAR-DESSUS : même boîte, aucune taille ne change */
/* Téléphone : carte et panneau dans la MÊME cellule — la zone prend la hauteur du plus grand, et
   grandit si le panneau en demande plus ; la carte, elle, garde la sienne */
.vcard__mapzone { position: relative; min-width: 0; display: grid; }
.vcard__mapbox, .vcard__overlay { grid-area: 1 / 1; }
/* contexte d'empilement : les calques de Leaflet (z-index jusqu'à 1000) restent sous le panneau */
.vcard__mapbox { isolation: isolate; height: 100%; }
.vcard__mapbox[inert] { opacity: .35; transition: opacity .2s; }
.vcard__overlay {
  position: relative; z-index: 1; min-height: 100%;
  display: flex; flex-direction: column; padding: 0; border-radius: 14px;
}
/* le panneau occupe TOUTE la zone de la carte, pas seulement sa propre hauteur */
.vcard__overlay > * { flex: 1 0 auto; align-content: start; }
.vpanel-enter-active, .vpanel-leave-active { transition: opacity .2s ease, transform .22s ease; }
.vpanel-enter-from, .vpanel-leave-to { opacity: 0; transform: translateY(14px); }
@media (prefers-reduced-motion: reduce) { .vpanel-enter-from, .vpanel-leave-to { transform: none; } }
/* Large : énergie puis état à gauche, quota en bas ; boutons au-dessus de la carte à droite.
   Les boutons partagent la rangée de l'énergie et s'étirent jusqu'à son bas : la carte commence
   à la même hauteur que les cases d'état. */
@container (min-width: 720px) {
  .cards { grid-template-columns: 1fr; }
  .vcard {
    grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px;
    grid-template-areas: 'a act' 'st map' 'q map';
  }
  .vcard__actions { grid-auto-rows: minmax(56px, 1fr); }
  /* `.vcard` en tête : la règle de base des tuiles (56 px), plus bas dans le fichier, l'emporterait */
  .vcard .vcard__actions .pill { height: auto; }
  .vcard__energy { grid-area: a; }
  .vcard__state { grid-area: st; }
  .vcard__actions { grid-area: act; }
  .vcard__mapzone { grid-area: map; display: flex; flex-direction: column; }
  /* la zone est fixée par la grille : le panneau la recouvre exactement, et défile s'il le faut */
  .vcard__overlay { position: absolute; inset: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .vcard__mapbox { flex: 1 1 auto; display: flex; flex-direction: column; }
  .vcard__mapbox > .vcard__map { flex: 1 1 auto; height: auto; min-height: var(--vmap-min); }
  .vcard__foot { grid-area: q; align-self: end; }
}
/* Écran large : énergie | état puis boutons | carte sur toute la hauteur. Le quota ferme la colonne
   de gauche. Carte à DROITE des boutons : ceux qui ouvrent un panneau passent dans la colonne qui la
   touche — réveiller, actualiser / déverrouiller, clim / charge, modifier */
@container (min-width: 1100px) {
  .vcard {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr);
    grid-template-areas: 'a st map' 'a act map' 'q act map';
  }
  /* ici les boutons gardent leur hauteur : la rangée de l'énergie ne les concerne pas */
  .vcard__actions { grid-auto-rows: auto; }
  .vcard .vcard__actions .pill { height: 56px; }
  .vcard__actions .pill[data-slot='climate'] { order: 4; }
  .vcard__actions .pill[data-slot='charge'] { order: 5; }
}
.vcard__head { display: flex; align-items: center; gap: 12px; }
.vcard__name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* le crayon ne prend pas de place tant qu'on ne le survole pas : il est là, discret, toujours au même point */
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
/* une ligne, coupée : l'âge des valeurs en face lui prend de la largeur, et un lieu long qui passait
   à la ligne faisait grandir l'en-tête de 18 px sur téléphone (mesuré le 2026-10-01) */
.vcard__sub { font-size: 12px; display: flex; align-items: center; gap: 4px; min-width: 0; height: 18px; }
.vcard__sub-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* l'épingle « voir dans la vue 3D » : la pastille `.badge--show` des listes d'appareils (RoomBands),
   dans la hauteur de la ligne */
.vcard__locate {
  flex: none; display: grid; place-items: center; width: 18px; height: 18px; padding: 0;
  border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; transition: background .15s, color .15s;
}
.vcard__locate:hover, .vcard__locate:focus-visible { background: var(--accent-soft); color: var(--accent); }
.min0 { min-width: 0; flex: 1 1 auto; }
/* deux rangées fixes : l'âge reste sur la seconde (celle du sous-titre) même sans pastille de veille */
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
/* Filigrane de section : l'icône, monochrome et très pâle, en bas à droite, rognée d'un quart de sa surface.
   SOUS le texte : `isolation` fait de la section un contexte d'empilement, le `z-index: -1` y
   reste (au-dessus du fond de la section, sous son contenu). Absolu : il ne prend aucune place. */
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
/* la ligne de charge tient sa hauteur même vide : la carte ne bouge pas quand la charge démarre.
   Une HAUTEUR égale à la ligne, pas un minimum : `min-height: 16px` sous une ligne de 18 px laissait
   tout le bas de la carte descendre de 2 px au démarrage de la charge (mesuré le 2026-10-01) */
.vcard__charge { margin: -8px 0 0; font-size: 12px; height: 1.5em; line-height: 1.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* deux colonnes de tuiles IDENTIQUES, toujours la même disposition : gestes (2 × 2), puis sections */
.vcard__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
/* icône AU-DESSUS du libellé : « Arrêter la charge » tient dans une demi-carte, sans être coupé */
.vcard__actions .pill { min-width: 0; height: 56px; padding: 0 8px; border-radius: 12px; flex-direction: column; justify-content: center; gap: 3px; font-size: 13px; }
.vcard__label { max-width: 100%; }
.vcard__actions .pill :deep(svg), .vcard__actions .pill .v-progress-circular { flex: 0 0 auto; }
.vcard__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* un bouton qui ATTEND n'est pas un bouton indisponible : l'opacité des boutons désactivés (.45)
   rendait le spinner à peine visible, or c'est lui qui porte l'information */
.vcard__actions .pill[aria-busy='true']:disabled { opacity: .7; }
/* quota et LOA empilés au pied de la colonne */
.vcard__foot { display: grid; gap: 12px; min-width: 0; }
/* quota du fabricant : même langage que la jauge de charge en haut de carte, en plus discret */
.vcard__quota { display: grid; gap: 6px; }
/* une seule ligne : le texte tient dans la carte la plus étroite (320 px), la coupure n'est qu'un filet */
.vcard__quota-text { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vcard__quota-track { height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
.vcard__quota-fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width .4s; }
/* le quota touche à sa fin : le même orangé que les avertissements des cartes de Réglages */
.vcard__quota-fill[data-tense='1'] { background: #d38b22; }
/* LOA : le repère du rythme autorisé dépasse de la jauge, qui elle rogne son remplissage */
.vcard__lease-bar { position: relative; }
.vcard__lease-pace { position: absolute; top: -3px; width: 2px; height: 10px; margin-left: -1px; border-radius: 1px; background: var(--text); opacity: .55; }
/* la ligne du détail garde sa hauteur même vide (LOA terminée) : rien ne bouge sous la jauge */
.vcard__lease-detail { height: 1.4em; line-height: 1.4em; }
</style>
