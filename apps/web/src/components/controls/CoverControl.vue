<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { coverWords, fromClosure, toClosure } from '../../lib/cover'
import { useDevicesStore } from '../../stores/devices'
import PulseDot from '../ui/PulseDot.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Contrôle d'un ouvrant dans le panneau appareil. Le pourcentage est une FERMETURE (0 % = ouvert),
// voir `lib/cover.ts` — le grand nombre en tête du panneau suit la même convention, donc ce
// contrôle ne le répète pas.
//
// Le curseur affiche la POSITION VISÉE tant que le store la tient (`targetPosition`) : un moteur qui
// ne publie sa position qu'à la fin de la course ferait sinon sauter la poignée en arrière juste
// après le geste. Si l'ouvrant s'arrête ailleurs, le store abandonne la cible et le curseur revient
// tout seul à la réalité.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'cover'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()

const devices = useDevicesStore()
const { t } = useI18n()
const dragging = ref(false)
const drag = ref(0)

// la cible n'est qu'une surcouche : sans elle, l'état reçu en prop fait foi
const target = computed(() => devices.targetPosition(props.descriptor.id))
// `undefined` = position inconnue (radio unidirectionnelle qui n'a rien reçu) : rien à affirmer,
// donc pas de pourcentage et un libellé « Inconnu ». Le curseur, lui, a besoin d'un nombre.
const shown = computed(() => {
  const p = target.value ?? props.state.position
  return p === undefined ? undefined : toClosure(p)
})
const closure = computed(() => (dragging.value ? drag.value : shown.value ?? 0))
watch(shown, (v) => { if (!dragging.value) drag.value = v ?? 0 }, { immediate: true })

// préfixe i18n du vocabulaire : un volet s'ouvre, un store se remonte (voir `lib/cover.ts`)
const w = computed(() => coverWords(props.descriptor))
const moving = computed(() => props.state.motion !== 'stopped')
/**
 * Texte de la ligne d'état : le mouvement quand il y en a un, sinon « Ouvert » / « Fermé » aux
 * extrêmes, sinon le nom du réglage. Jamais le pourcentage — il est déjà au bout de la ligne.
 */
const lineText = computed(() => {
  if (moving.value) return t(`cover.${w.value}.${props.state.motion}`)
  // position inconnue : la grande valeur du panneau dit déjà « Inconnu » juste au-dessus, la ligne
  // garde sa hauteur sans le répéter (elle reprend la parole dès qu'un mouvement commence)
  if (shown.value === undefined) return '—'
  if (shown.value <= 0) return t(`cover.${w.value}.open`)
  if (shown.value >= 100) return t(`cover.${w.value}.closed`)
  return t(`cover.${w.value}.level`)
})
const hasPosition = props.descriptor.capabilities.includes('position')
const hasTilt = props.descriptor.capabilities.includes('tilt')
const hasStop = props.descriptor.capabilities.includes('stop')

// Position favorite mémorisée DANS le moteur (le « my » de Somfy). La capacité dit qu'on peut la
// rappeler ; la valeur, seulement qu'on peut la montrer — un moteur unidirectionnel a la première
// sans la seconde. D'où deux notions distinctes plutôt qu'une.
const hasPreset = props.descriptor.capabilities.includes('preset')
const presetClosure = computed(() =>
  props.state.presetPosition === undefined ? undefined : toClosure(props.state.presetPosition))
// Repère sur la piste du curseur : `ticks` en tableau place la marque avec la géométrie de Vuetify
// (le pouce ne parcourt pas toute la largeur), donc sans calcul de position à la main.
const presetTicks = computed(() => (presetClosure.value === undefined ? undefined : [presetClosure.value]))

function send(cmd: CommandInput) { emit('command', cmd) }
</script>

<template>
  <div class="cover">
    <div class="cover__keys">
      <button type="button" class="key" :disabled="disabled" @click="send({ type: 'cover.open' })">
        <StrokeIcon name="collapseUp" :size="16" /><span>{{ $t(`cover.${w}.actionOpen`) }}</span>
      </button>
      <button v-if="hasStop" type="button" class="key" :disabled="disabled" @click="send({ type: 'cover.stop' })">
        <StrokeIcon name="stop" :size="16" /><span>{{ $t('common.stop') }}</span>
      </button>
      <button type="button" class="key" :disabled="disabled" @click="send({ type: 'cover.close' })">
        <StrokeIcon name="collapseDown" :size="16" /><span>{{ $t(`cover.${w}.actionClose`) }}</span>
      </button>
    </div>

    <!-- UNE seule ligne, de hauteur constante : le point garde sa place même éteint, le texte
         occupe le milieu et le pourcentage reste collé à droite. Une ligne qui apparaît et
         disparaît décalerait tout ce qui suit à chaque mouvement. -->
    <div class="line" :data-moving="moving ? '1' : '0'">
      <PulseDot :on="moving" />
      <span class="line__text">{{ lineText }}</span>
      <span v-if="hasPosition && shown !== undefined" class="line__pct">{{ Math.round(closure) }} %</span>
    </div>

    <v-slider v-if="hasPosition" v-model="drag" :min="0" :max="100" :step="5" :disabled="disabled"
              :ticks="presetTicks" :show-ticks="presetTicks ? 'always' : false"
              density="compact" hide-details class="cover__slider"
              @start="dragging = true"
              @end="(v: number) => { dragging = false; send({ type: 'cover.set_position', position: fromClosure(Math.round(v)) }) }" />

    <!-- Sur sa propre ligne, pleine largeur : « Position perso » ne tient pas dans un quart des
         340 px du panneau, et la valeur mérite d'être écrite. Une infobulle serait inutile ici,
         l'application est tactile — rien ne survole. -->
    <button v-if="hasPreset" type="button" class="key key--wide" :disabled="disabled" @click="send({ type: 'cover.preset' })">
      <StrokeIcon name="crosshair" :size="16" />
      <span>{{ $t('cover.preset') }}</span>
      <span v-if="presetClosure !== undefined" class="key__pct">{{ Math.round(presetClosure) }} %</span>
    </button>

    <template v-if="hasTilt">
      <!-- même gabarit que la ligne ci-dessus : les deux pourcentages s'alignent -->
      <div class="line">
        <PulseDot :on="false" />
        <span class="line__text">{{ $t('cover.tilt') }}</span>
        <span class="line__pct">{{ state.tilt ?? 0 }} %</span>
      </div>
      <v-slider :model-value="state.tilt ?? 0" :min="0" :max="100" :step="10" :disabled="disabled"
                density="compact" hide-details
                @end="(v: number) => send({ type: 'cover.set_tilt', tilt: Math.round(v) })" />
    </template>
  </div>
</template>

<style scoped>
.cover { display: grid; gap: 2px; }
.cover__keys { display: flex; gap: 6px; }
.line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin-top: 10px; }
.line[data-moving='1'] { color: var(--accent); }
.line__text { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* chiffres a largeur fixe : le pourcentage ne fremit pas quand il change */
.line__pct { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
/* `min-width: 0` est indispensable : trois boutons à largeur minimale par défaut débordent des
   340 px du panneau. */
.key {
  flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px;
  height: 40px; padding: 0 6px; border-radius: 10px; border: 1px solid var(--line);
  background: transparent; color: var(--text); font-size: 12px; font-weight: 500;
  white-space: nowrap; overflow: hidden;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
/* la touche « position perso » prend la ligne entière et pousse sa valeur à droite */
.key--wide { flex: none; width: 100%; justify-content: flex-start; gap: 8px; margin-top: 6px; }
.key__pct { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
/* repère de la position perso : lisible sans concurrencer le pouce du curseur */
.cover__slider :deep(.v-slider-track__tick) { background: var(--accent); opacity: .85; width: 2px; height: 8px; border-radius: 1px; }
/* Sur la portion ACTIVE, un repère couleur accent est accent sur accent : invisible. Vuetify
   marque ces repères `--filled`, et `--on-accent` est le jeton fait pour écrire sur l'accent. */
.cover__slider :deep(.v-slider-track__tick--filled) { background: var(--on-accent); opacity: 1; }
/* Vuetify étiquette un repère donné en tableau (« 73 » sous la piste) : 24 px de hauteur en plus,
   et le chiffre est déjà écrit dans la touche juste en dessous. */
.cover__slider :deep(.v-slider-track__tick-label) { display: none; }
.cover__slider :deep(.v-slider--has-labels) { margin-bottom: 0; }
</style>
