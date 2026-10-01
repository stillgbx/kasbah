<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor, VehicleSeat } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { formatTemp } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'

/**
 * La climatisation d'un véhicule, COMMUNE à tous : marche, consigne, sièges et volant chauffants.
 * Le panneau montre TOUJOURS le maximum — cinq places et le volant — et grise ce que ce véhicule ne
 * sait pas faire (`meta.vehicle.climate`) : rien n'apparaît ni ne disparaît d'une voiture à l'autre,
 * et l'utilisateur voit ce qui manque au lieu de le chercher.
 *
 * Deux règles viennent du plugin, pas d'ici :
 *  - la MARCHE réveille la voiture s'il le faut (`vehicle.climate_start`) — l'accusé arrive en une
 *    seconde, la clim une vingtaine plus tard : le bouton tient l'attente jusqu'à voir `climateOn` ;
 *  - un RÉGLAGE ne réveille jamais (`vehicle.climate_set`). Endormie, la consigne choisie est donc
 *    RETENUE ici et part avec la marche ; sièges et volant attendent que la clim tourne.
 */
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'> }>()
const devices = useDevicesStore()
const { t, locale } = useI18n()
const id = computed(() => props.descriptor.id)
const features = computed(() => props.descriptor.meta.vehicle?.climate)
const asleep = computed(() => props.state.sleepState === 'asleep' || props.state.sleepState === 'offline')
const on = computed(() => props.state.climateOn === true)

/** Même plafond que le réveil de la vue : une voiture hors de portée ne bloque pas le bouton. */
const WARM_MAX_MS = 90_000
const warming = ref(false)
let warmTimer: ReturnType<typeof setTimeout> | null = null
function stopWarming(): void {
  warming.value = false
  if (warmTimer) clearTimeout(warmTimer)
  warmTimer = null
}
watch(on, (v) => { if (v) stopWarming() })
const busy = computed(() => warming.value || devices.isPending(id.value))

// ── consigne ──────────────────────────────────────────────────────────────────────────────────

/** La consigne choisie et pas encore confirmée par la voiture ; `null` = celle de la voiture. */
const wanted = ref<number | null>(null)
const SEND_AFTER_MS = 800
let sendTimer: ReturnType<typeof setTimeout> | null = null
const target = computed(() => wanted.value ?? props.state.climateTargetC)
watch(() => props.state.climateTargetC, (v) => { if (v !== undefined && v === wanted.value) wanted.value = null })
const canTune = computed(() => !!features.value && props.state.available)
function step(dir: 1 | -1): void {
  const f = features.value
  if (!f) return
  const from = target.value ?? (f.minC + f.maxC) / 2
  const next = Math.min(f.maxC, Math.max(f.minC, Math.round((from + dir * f.stepC) / f.stepC) * f.stepC))
  if (next === target.value) return
  wanted.value = next
  if (sendTimer) clearTimeout(sendTimer)
  // endormie : retenue, elle partira avec la marche ; éveillée : envoyée une fois les clics finis
  if (asleep.value) return
  sendTimer = setTimeout(() => {
    sendTimer = null
    const value = wanted.value
    if (value === null) return
    void devices.sendCommand(id.value, { type: 'vehicle.climate_set', targetTempC: value }).then((ok) => { if (!ok) wanted.value = null })
  }, SEND_AFTER_MS)
}

// ── marche ────────────────────────────────────────────────────────────────────────────────────

async function toggle(): Promise<void> {
  if (on.value) { await devices.sendCommand(id.value, { type: 'vehicle.climate_stop' }); return }
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null }
  const targetTempC = wanted.value ?? undefined
  warming.value = true
  // batterie trop faible : le plugin refuse (`LOW_BATTERY`) et la notification le dit
  const ok = await devices.sendCommand(id.value, { type: 'vehicle.climate_start', ...(targetTempC !== undefined ? { targetTempC } : {}) })
  if (ok) warmTimer = setTimeout(stopWarming, WARM_MAX_MS)
  else stopWarming()
}
onBeforeUnmount(() => { stopWarming(); if (sendTimer) clearTimeout(sendTimer) })

// ── sièges et volant ──────────────────────────────────────────────────────────────────────────

/** Vue de dessus : la rangée avant porte le volant entre les deux sièges. */
const FRONT: (VehicleSeat | 'wheel')[] = ['fl', 'wheel', 'fr']
const REAR: VehicleSeat[] = ['rl', 'rc', 'rr']
const hasSeat = (s: VehicleSeat) => features.value?.seats.includes(s) === true
const levels = computed(() => features.value?.seatLevels ?? 3)
const levelOf = (s: VehicleSeat) => props.state.seatHeat?.[s] ?? 0
/** Chauffer suppose la clim en marche (Tesla), sauf là où ce sont des options du préconditionnement (R5). */
const heatable = computed(() => props.state.available && (features.value?.heatWhileOff === true || (on.value && !asleep.value)))
function cycleSeat(s: VehicleSeat): void {
  const next = (levelOf(s) + 1) % (levels.value + 1)
  void devices.sendCommand(id.value, { type: 'vehicle.climate_set', seatHeat: { [s]: next } })
}
function toggleWheel(): void {
  void devices.sendCommand(id.value, { type: 'vehicle.climate_set', steeringWheelHeat: props.state.steeringWheelHeat !== true })
}
/** Barres allumées : à un seul cran (marche / arrêt), allumé = les trois, pour un gabarit identique. */
const lit = (s: VehicleSeat) => (levels.value === 1 ? (levelOf(s) > 0 ? 3 : 0) : levelOf(s))

/** Une seule ligne d'aide, toujours présente : la raison de ce qui est grisé, ou l'attente en cours. */
const hint = computed(() => {
  if (!props.state.available) return t('vehicle.climatePanel.unavailable')
  if (warming.value) return t('vehicle.climatePanel.warming')
  if (!on.value && features.value?.heatWhileOff) return t('vehicle.climatePanel.presetHint')
  if (!on.value) return asleep.value ? t('vehicle.climateWakeHint') : t('vehicle.climatePanel.offHint')
  return t('vehicle.climateStopHint')
})
const unsupported = t('vehicle.climatePanel.unsupported')
</script>

<template>
  <div class="clim">
    <div class="clim__head">
      <button type="button" class="pill clim__power" :data-on="on ? '1' : '0'" :disabled="!state.available || busy"
              :aria-busy="busy" :aria-pressed="on" @click="toggle">
        <!-- le spinner prend la PLACE de l'icône, même taille : le bouton ne change pas de largeur -->
        <v-progress-circular v-if="busy" indeterminate size="16" width="2" />
        <StrokeIcon v-else name="thermostat" :size="16" />{{ $t('vehicle.climate') }}
      </button>
      <div class="clim__temp">
        <button type="button" class="clim__step" :disabled="!canTune" :title="canTune ? undefined : unsupported"
                :aria-label="$t('vehicle.climatePanel.colder')" @click="step(-1)">
          <StrokeIcon name="minus" :size="16" />
        </button>
        <div class="clim__target">
          <span class="clim__value">{{ target === undefined ? '—' : formatTemp(target, locale) }}</span>
          <span class="muted clim__inside">{{ $t('vehicle.climatePanel.inside', { temp: state.insideTempC === undefined ? '—' : formatTemp(state.insideTempC, locale) }) }}</span>
        </div>
        <button type="button" class="clim__step" :disabled="!canTune" :title="canTune ? undefined : unsupported"
                :aria-label="$t('vehicle.climatePanel.warmer')" @click="step(1)">
          <StrokeIcon name="plus" :size="16" />
        </button>
      </div>
    </div>
    <!-- la cabine vue de dessus : avant (siège, volant, siège), puis la banquette -->
    <div class="clim__cabin" role="group" :aria-label="$t('vehicle.climatePanel.cabin')">
      <template v-for="slot in FRONT" :key="slot">
        <button v-if="slot === 'wheel'" type="button" class="clim__seat" :data-on="state.steeringWheelHeat ? '1' : '0'"
                :disabled="!features?.steeringWheelHeat || !heatable" :title="features?.steeringWheelHeat ? undefined : unsupported"
                :aria-pressed="state.steeringWheelHeat === true" @click="toggleWheel">
          <span class="clim__seat-k">{{ $t('vehicle.climatePanel.wheel') }}</span>
          <span class="clim__bars" aria-hidden="true"><i v-for="n in 3" :key="n" :data-lit="state.steeringWheelHeat ? '1' : '0'" /></span>
        </button>
        <button v-else type="button" class="clim__seat" :data-on="levelOf(slot) > 0 ? '1' : '0'"
                :disabled="!hasSeat(slot) || !heatable" :title="hasSeat(slot) ? undefined : unsupported"
                :aria-label="$t('vehicle.climatePanel.seatLevel', { seat: $t(`vehicle.seat.${slot}`), level: levelOf(slot) })" @click="cycleSeat(slot)">
          <span class="clim__seat-k">{{ $t(`vehicle.seat.${slot}`) }}</span>
          <span class="clim__bars" aria-hidden="true"><i v-for="n in 3" :key="n" :data-lit="n <= lit(slot) ? '1' : '0'" /></span>
        </button>
      </template>
      <button v-for="slot in REAR" :key="slot" type="button" class="clim__seat" :data-on="levelOf(slot) > 0 ? '1' : '0'"
              :disabled="!hasSeat(slot) || !heatable" :title="hasSeat(slot) ? undefined : unsupported"
              :aria-label="$t('vehicle.climatePanel.seatLevel', { seat: $t(`vehicle.seat.${slot}`), level: levelOf(slot) })" @click="cycleSeat(slot)">
        <span class="clim__seat-k">{{ $t(`vehicle.seat.${slot}`) }}</span>
        <span class="clim__bars" aria-hidden="true"><i v-for="n in 3" :key="n" :data-lit="n <= lit(slot) ? '1' : '0'" /></span>
      </button>
    </div>
    <p class="muted clim__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
/* `min-width: 0` : le panneau est un élément de la grille de la carte ; sans lui, sa largeur
   minimale élargit la colonne et pousse TOUT le contenu de la carte hors de son cadre (vu à 828 px) */
.clim { min-width: 0; padding: 8px; display: grid; gap: 12px; }
/* trop étroit pour une ligne : la consigne passe dessous. Ne dépend que de la largeur, jamais de l'état */
.clim__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.clim__power { flex: 0 0 auto; padding: 0 10px; }
.clim__temp { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.clim__step {
  width: 32px; height: 32px; display: grid; place-items: center; padding: 0;
  border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text); cursor: pointer;
}
.clim__step:disabled { opacity: .45; cursor: default; }
/* largeur FIXE : « 20,5 °C » et « — » occupent la même place, les boutons ± ne bougent pas */
.clim__target { width: 84px; display: grid; justify-items: center; }
.clim__value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.clim__inside { font-size: 11px; white-space: nowrap; }
.clim__cabin { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.clim__seat {
  min-width: 0; height: 52px; display: grid; place-items: center; gap: 4px; padding: 6px 4px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 12px; cursor: pointer;
}
.clim__seat[data-on='1'] { border-color: var(--accent); }
.clim__seat:disabled { opacity: .45; cursor: default; }
.clim__seat-k { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clim__bars { display: flex; gap: 3px; }
.clim__bars i { width: 12px; height: 3px; border-radius: 2px; background: var(--line); }
.clim__bars i[data-lit='1'] { background: var(--accent); }
/* une ligne réservée : le panneau ne change pas de hauteur quand la raison change */
.clim__hint { margin: 0; font-size: 11px; min-height: 2lh; }
</style>
