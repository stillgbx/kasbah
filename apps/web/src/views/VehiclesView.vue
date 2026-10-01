<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { estimateChargePowerW, geoDistance, type Capability, type CommandInput, type DeviceEntry, type StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import ChargeLimitCard from '../components/vehicles/ChargeLimitCard.vue'
import VehicleMap from '../components/vehicles/VehicleMap.vue'
import VehicleClimate from '../components/vehicles/VehicleClimate.vue'
import VehicleTuning from '../components/vehicles/VehicleTuning.vue'
import { formatAgo, formatDistance, formatKm, formatMinutes, formatPercent, formatPower, formatTemp } from '../lib/format'
import { QUOTA_TENSE_PCT, quotaPercent } from '../lib/map'
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
const { t, locale } = useI18n()
const HOME_RADIUS_M = 120
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
const tuning = ref<string | null>(null)
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
/** Une commande est en vol pour ce véhicule : le bouton le montre et refuse d'être rejoué. */
const busy = (v: VehicleEntry) => devices.isPending(v.descriptor.id) || v.descriptor.id in waking.value

async function wake(v: VehicleEntry): Promise<void> {
  const id = v.descriptor.id
  waking.value = { ...waking.value, [id]: true }
  if (await send(id, { type: 'vehicle.wake' })) setTimeout(() => stopWaking(id), WAKE_MAX_MS)
  else stopWaking(id)                                  // demande refusée : le bouton revient tout de suite
}
// le véhicule a ouvert les yeux : le bouton a fini son travail (et cède la place à « Actualiser »)
watch(vehicles, (list) => { for (const v of list) if (v.state.sleepState === 'online') stopWaking(v.descriptor.id) })

/** La climatisation, repliée derrière son bouton comme « Modifier » : marche, consigne, sièges (cf. `VehicleClimate`). */
const climate = ref<string | null>(null)
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
 * langue et le format de la tablette.
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
          <div class="vcard__head">
            <span class="icon-square" :data-on="v.state.charging ? '1' : '0'"><StrokeIcon name="vehicle" :size="18" /></span>
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
              <div class="muted vcard__sub">{{ v.descriptor.meta.manufacturer ?? v.descriptor.pluginId }} · {{ location(v.state) }}</div>
            </div>
            <!-- pas de pastille quand le fabricant n'a pas de veille (Renault) : un soleil suivi d'un
                 tiret se lirait « éveillée : inconnu ». Rien ne bouge pour autant, l'absence est stable -->
            <span v-if="v.state.sleepState !== undefined" class="vcard__sleep muted" :data-asleep="asleep(v.state) ? '1' : '0'">
              <StrokeIcon :name="asleep(v.state) ? 'moon' : 'sun'" :size="14" />{{ $t(`vehicle.sleep.${v.state.sleepState}`) }}
            </span>
          </div>
          <div class="vcard__soc">
            <div class="big-value">{{ unread(v.state) ? EMPTY : formatPercent(v.state.soc, locale) }}</div>
            <div class="muted">{{ unread(v.state) ? EMPTY : formatKm(v.state.rangeKm, locale) }}</div>
          </div>
          <!-- la jauge et ses repères : la cible de charge, et le plancher voulu quand le fabricant
               a cette notion (la R5 ; Tesla ne l'a pas, et un seul repère se dessine alors) -->
          <div class="vcard__bar">
            <div class="vcard__bar-fill" :style="{ width: `${v.state.soc}%` }" />
            <span v-if="v.state.socMin !== undefined" class="vcard__tick" :style="{ left: `${v.state.socMin}%` }"
                  :title="$t('vehicle.floorMark', { percent: formatPercent(v.state.socMin, locale) })" />
            <span v-if="v.state.chargeLimit !== undefined" class="vcard__tick" :style="{ left: `${v.state.chargeLimit}%` }"
                  :title="$t('vehicle.targetMark', { percent: formatPercent(v.state.chargeLimit, locale) })" />
          </div>
          <!-- détail de la charge en cours : place TOUJOURS réservée, rien ne se décale quand elle démarre -->
          <p class="muted vcard__charge">{{ chargeDetail(v) }}</p>
          <!-- la cible de charge, quand le véhicule la laisse écrire : paliers au doigt, curseur au pour cent -->
          <ChargeLimitCard v-if="has(v, 'charge_limit')" :value="limitOf(v)" :disabled="limitLocked(v)"
                           :hint="asleep(v.state) ? $t('vehicle.wakeHint') : undefined"
                           @preview="preview(v, $event)" @change="setLimit(v, $event)" />
          <div class="vcard__stats">
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('common.status') }}</div><div class="stat__v">{{ locked(v.state) }}</div></div>
            <div class="card card--soft stat"><div class="muted stat__k">{{ $t('vehicle.charge') }}</div>
              <div class="stat__v">{{ charge(v.state) }}</div></div>
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
          <!-- la carte : voiture (avec son cap) et maison, plan ou satellite, plein écran -->
          <VehicleMap class="vcard__map" :location="v.state.location" :heading-deg="v.state.headingDeg" :home="house.house?.origin"
                      :caption="caption(v.state)" />
          <!-- TOUS les boutons, toujours : ce qu'un véhicule ne sait pas faire est grisé, avec la raison
               (règle de l'utilisateur, 2026-10-01). La rangée ne change ni d'un véhicule à l'autre, ni
               quand on branche le câble -->
          <div class="vcard__actions">
            <button type="button" class="pill" :disabled="!has(v, 'lock') || !v.state.available"
                    :title="has(v, 'lock') ? undefined : $t('vehicle.unsupported')" @click="send(v.descriptor.id, { type: v.state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">
              <StrokeIcon :name="v.state.locked ? 'lockOpen' : 'lock'" :size="16" /><span class="vcard__label">{{ v.state.locked ? $t('common.unlock') : $t('common.lock') }}</span>
            </button>
            <button type="button" class="pill" :data-on="v.state.charging ? '1' : '0'" :disabled="!has(v, 'charging') || !v.state.pluggedIn || !v.state.available"
                    :title="!has(v, 'charging') ? $t('vehicle.unsupported') : v.state.pluggedIn ? undefined : $t('vehicle.unplugged')"
                    @click="send(v.descriptor.id, { type: v.state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
              <StrokeIcon :name="v.state.charging ? 'boltOff' : 'bolt'" :size="16" /><span class="vcard__label">{{ v.state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}</span>
            </button>
            <!-- réveiller est un geste explicite (Tesla le facture) : jamais automatique. TOUJOURS là pour un
                 véhicule qui connaît la veille, grisé quand il est éveillé : s'il apparaissait et
                 disparaissait, la rangée changerait de nombre de lignes et pousserait le panneau de la clim -->
            <button type="button" class="pill" :disabled="v.state.sleepState === undefined || !v.state.available || !asleep(v.state) || busy(v)"
                    :aria-busy="busy(v)" :title="v.state.sleepState === undefined ? $t('vehicle.unsupported') : $t('vehicle.wakeHint')" @click="wake(v)">
              <!-- le spinner prend la PLACE de l'icône, même taille : le bouton ne change pas de largeur -->
              <v-progress-circular v-if="busy(v)" indeterminate size="16" width="2" />
              <StrokeIcon v-else name="sun" :size="16" /><span class="vcard__label">{{ $t('vehicle.wake') }}</span>
            </button>
            <!-- relire maintenant (lecture facturée, pas de réveil) ; le sondage repart de cette lecture.
                 Proposé MÊME endormi : c'est ainsi qu'on constate qu'une voiture s'est réveillée seule,
                 sans payer le réveil -->
            <button type="button" class="pill" :disabled="!has(v, 'soc') || !v.state.available || devices.isPending(v.descriptor.id)"
                    :aria-busy="devices.isPending(v.descriptor.id)" :title="$t('vehicle.refreshHint')" @click="send(v.descriptor.id, { type: 'vehicle.refresh' })">
              <!-- il reste cliquable PENDANT un réveil : c'est justement le moment où l'on veut
                   demander « alors, tu es réveillée ? » sans repayer un réveil -->
              <v-progress-circular v-if="devices.isPending(v.descriptor.id)" indeterminate size="16" width="2" />
              <StrokeIcon v-else name="rotateRight" :size="16" /><span class="vcard__label">{{ $t('vehicle.refresh') }}</span>
            </button>
          </div>
          <!-- dessous, à part : les boutons qui DÉPLIENT une section, sous les gestes qui agissent tout de suite -->
          <div class="vcard__actions">
            <!-- ouvre le panneau ; la teinte dit que la clim TOURNE (libellé fixe : la largeur ne bouge pas) -->
            <button type="button" class="pill" :data-on="v.state.climateOn ? '1' : '0'" :disabled="!has(v, 'climate_precondition')"
                    :aria-expanded="climate === v.descriptor.id" :title="has(v, 'climate_precondition') ? $t('vehicle.climateHint') : $t('vehicle.unsupported')"
                    @click="climate = climate === v.descriptor.id ? null : v.descriptor.id">
              <StrokeIcon name="thermostat" :size="16" /><span class="vcard__label">{{ $t('vehicle.climatePanel.title') }}</span>
            </button>
            <!-- ce que la voiture ne dira jamais : replié, parce qu'on le règle une fois -->
            <!-- grisé quand il n'y a RIEN à régler (placé à la main, et bavard sur sa puissance) -->
            <button type="button" class="pill" :data-on="tuning === v.descriptor.id ? '1' : '0'" :disabled="!tunable(v)"
                    :aria-expanded="tuning === v.descriptor.id"
                    @click="tuning = tuning === v.descriptor.id ? null : v.descriptor.id">
              <StrokeIcon name="gear" :size="16" /><span class="vcard__label">{{ $t('vehicle.tune') }}</span>
            </button>
          </div>
          <VehicleClimate v-if="climate === v.descriptor.id" class="card card--soft" :descriptor="v.descriptor" :state="v.state" />
          <VehicleTuning v-if="tuning === v.descriptor.id" :descriptor="v.descriptor" />
          <!-- l'âge des valeurs, toujours affiché : sur une API facturée et une voiture qui dort, elles en ont un -->
          <p class="muted vcard__hint">{{ readAgo(v.state) }}<template v-if="asleep(v.state)"> · {{ $t('vehicle.wakeHint') }}</template></p>
          <!-- ce qu'il reste du quota que le plugin s'impose (API du fabricant facturée) : rien pour
               un plugin qui ne compte pas, la simulation par exemple -->
          <div v-if="quotaOf(v)" class="vcard__quota">
            <span class="muted vcard__quota-text">{{ quotaLabel(quotaOf(v)!) }}</span>
            <div class="vcard__quota-track">
              <div class="vcard__quota-fill" :data-tense="quotaPercent(quotaOf(v)!.used, quotaOf(v)!.limit) >= QUOTA_TENSE_PCT ? '1' : '0'"
                   :style="{ width: `${quotaPercent(quotaOf(v)!.used, quotaOf(v)!.limit)}%` }" />
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vehicles { height: 100%; display: flex; flex-direction: column; }
.vehicles__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); }
.empty { padding: 24px; text-align: center; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.vcard { padding: 18px 20px; display: grid; gap: 14px; align-content: start; }
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
.vcard__sub { font-size: 12px; }
.min0 { min-width: 0; flex: 1 1 auto; }
.vcard__sleep { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; flex: 0 0 auto; }
.vcard__sleep[data-asleep='1'] { color: var(--text); }
.vcard__soc { display: flex; align-items: baseline; justify-content: space-between; }
/* pas d'`overflow: hidden` : les repères DÉBORDENT de la jauge, c'est ce qui les rend lisibles.
   Le remplissage a son propre arrondi, il n'a jamais eu besoin d'être rogné. */
.vcard__bar { position: relative; height: 6px; border-radius: 999px; background: var(--line); }
.vcard__bar-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s; }
/* Repères de limites : le trait de la POSITION FAVORITE d'un ouvrant (cf. `.cover-slider` dans
   app.css), en plus court — mais posé PAR-DESSUS la jauge, qui n'a pas de pouce pour le cacher. */
.vcard__tick {
  position: absolute; top: 50%; width: 3px; height: 14px; border-radius: 2px;
  transform: translate(-50%, -50%); background: rgb(var(--v-theme-warning));
}
.vcard__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { padding: 10px 12px; }
.stat__k { font-size: 11px; }
.stat__v { font-weight: 500; font-size: 14px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tires { padding: 10px 12px; display: grid; gap: 6px; }
.tires__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.tire { display: grid; gap: 2px; font-variant-numeric: tabular-nums; }
.tire__k { font-size: 11px; }
.tire__v { font-weight: 500; font-size: 13px; white-space: nowrap; }
.vcard__map { height: 220px; }
/* la ligne de charge tient sa hauteur même vide : la carte ne bouge pas quand la charge démarre */
.vcard__charge { margin: -8px 0 0; font-size: 12px; min-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
.vcard__hint { margin: 0; font-size: 12px; }
/* quota du fabricant : même langage que la jauge de charge en haut de carte, en plus discret */
.vcard__quota { display: grid; gap: 6px; }
.vcard__quota-text { font-size: 11px; }
.vcard__quota-track { height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
.vcard__quota-fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width .4s; }
/* le quota touche à sa fin : le même orangé que les avertissements des cartes de Réglages */
.vcard__quota-fill[data-tense='1'] { background: #d38b22; }
</style>
