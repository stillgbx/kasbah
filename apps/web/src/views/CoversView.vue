<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import CoversToggle from '../components/devices/CoversToggle.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { coverActivity, coverWords, fromClosure, toClosure } from '../lib/cover'
import { useDevicesStore } from '../stores/devices'

// Vue Ouvrants : volets, stores, portails, fenêtres et portes de garage — tout ce qui est du kind
// `cover`. La liste par pièce et son diagnostic de liaison viennent de `RoomBands` (partagé avec
// la vue Lumières) ; il ne reste ici que le contrôle propre à un ouvrant.
//
// Ouvrir / Stop / Fermer sont conditionnés aux capacités, parce que le parc est hétérogène : un
// moteur io-homecontrol sait viser une position (curseur), une radio RTS unidirectionnelle ne sait
// que tout ou rien — lui afficher un curseur promettrait une commande qu'elle refuserait.
//
// Le pourcentage est une FERMETURE (0 % = ouvert, voir `lib/cover.ts`) et le curseur montre la
// position VISÉE tant que le store la tient : un moteur qui ne publie sa position qu'en fin de
// course ferait sinon revenir la poignée en arrière juste après le geste.
const devices = useDevicesStore()

const covers = computed(() => devices.list.filter((e) => e.state.kind === 'cover'))
// position inconnue = pas comptée comme ouverte : on ne sait pas (voir `lib/cover.ts`)
const openCount = computed(() => covers.value.filter((e) => ((e.state as StateFor<'cover'>).position ?? 0) > 0 && e.state.available).length)

// Valeur locale pendant le glissement seulement ; ensuite c'est la cible du store qui s'affiche.
const draft = ref<Record<string, number>>({})
// le curseur n'existe que pour un ouvrant qui sait viser une position, donc qui la publie ; le
// repli à 100 ne sert qu'à donner un nombre au composant si les deux se désaccordaient
const shownClosure = (id: string, position?: number) => draft.value[id] ?? toClosure(devices.targetPosition(id) ?? position ?? 100)

// Jauge peinte en fond de ligne (slot `backdrop` de `RoomBands`, comme la teinte d'une lampe allumée
// ou la pochette d'un lecteur) : la part de l'ouvrant qui SE REMARQUE, de 0 (rien) à 1 (toute la
// ligne). Un volet se remarque ouvert, un store DÉPLOYÉ — c'est l'inverse, et c'est voulu (voir
// `coverActivity`). Position inconnue = pas de jauge : on n'affirme rien d'un moteur muet.
// On lit la position VISÉE quand le store en tient une : la jauge suit le geste, comme le curseur.
const openFraction = (e: DeviceEntry) => {
  const s = e.state as StateFor<'cover'>
  if (!s.available) return 0
  return coverActivity(e.descriptor, devices.targetPosition(e.descriptor.id) ?? s.position)
}

// Position favorite du moteur : repère sur la piste du curseur, et valeur dans le libellé
// accessible de la touche (une ligne de liste n'a pas la place de l'écrire).
const presetClosure = (s: StateFor<'cover'>) => s.presetPosition === undefined ? undefined : toClosure(s.presetPosition)
const presetTicks = (s: StateFor<'cover'>) => { const c = presetClosure(s); return c === undefined ? undefined : [c] }
function drag(id: string, v: number) { draft.value = { ...draft.value, [id]: v } }
function commit(id: string, v: number) {
  void devices.sendCommand(id, { type: 'cover.set_position', position: fromClosure(Math.round(v)) })
  const next = { ...draft.value }
  delete next[id]
  draft.value = next
}
</script>

<template>
  <div class="page">
    <PageHeader>
      <!-- tout fermer (ou tout ouvrir) d'un geste ; « fermer » baisse un store, le plugin traduit -->
      <div class="head">
        <div class="muted count">{{ $t('covers.summary', { open: openCount, total: covers.length }) }}</div>
        <CoversToggle :entries="covers" :label="$t('covers.all')" />
      </div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="covers.length === 0" class="card card--soft empty muted">{{ $t('covers.none') }}</div>
      <RoomBands kind="cover">
        <!-- ce qui manquait le plus dans cette vue : voir OUVERT sans lire chaque ligne -->
        <template #backdrop="{ entry }">
          <div class="row-open" aria-hidden="true"
               :style="{ '--open': openFraction(entry) }" />
        </template>
        <!-- le point pulsant accompagne le libellé (« Fermeture en cours »), qui est déjà dans le
             statut : posé avant le curseur, il en changerait la largeur à chaque mouvement -->
        <template #status-badge="{ entry }">
          <PulseDot :on="(entry.state as StateFor<'cover'>).motion !== 'stopped'" class="dot" />
        </template>
        <template #control="{ entry }">
          <!-- une ligne à part : trois boutons dans la 4e colonne écraseraient le nom de l'ouvrant -->
          <div class="controls">
            <div class="keys">
              <button type="button" class="key" :disabled="!entry.state.available"
                      :title="$t(`cover.${coverWords(entry.descriptor)}.actionOpen`)"
                      :aria-label="$t(`cover.${coverWords(entry.descriptor)}.actionOpen`)"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.open' })">
                <StrokeIcon name="collapseUp" :size="18" />
              </button>
              <button v-if="entry.descriptor.capabilities.includes('stop')" type="button" class="key"
                      :disabled="!entry.state.available" :title="$t('common.stop')" :aria-label="$t('common.stop')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.stop' })">
                <StrokeIcon name="stop" :size="18" />
              </button>
              <button type="button" class="key" :disabled="!entry.state.available"
                      :title="$t(`cover.${coverWords(entry.descriptor)}.actionClose`)"
                      :aria-label="$t(`cover.${coverWords(entry.descriptor)}.actionClose`)"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.close' })">
                <StrokeIcon name="collapseDown" :size="18" />
              </button>
              <!-- la valeur ne tient pas dans une touche de 36 px : elle passe par le libellé -->
              <button v-if="entry.descriptor.capabilities.includes('preset')" type="button" class="key"
                      :disabled="!entry.state.available"
                      :title="presetClosure(entry.state as StateFor<'cover'>) !== undefined
                        ? $t('cover.presetAt', { pct: `${Math.round(presetClosure(entry.state as StateFor<'cover'>)!)} %` })
                        : $t('cover.preset')"
                      :aria-label="$t('cover.preset')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.preset' })">
                <StrokeIcon name="crosshair" :size="18" />
              </button>
            </div>
            <!-- pas de 1 % : Vuetify aligne le pouce sur le pas, et à 5 % il ne pouvait pas se
                 poser sur le repère de position favorite du moteur (voir `CoverControl.vue`) -->
            <v-slider v-if="entry.descriptor.capabilities.includes('position')"
                      :model-value="shownClosure(entry.descriptor.id, (entry.state as StateFor<'cover'>).position)"
                      :min="0" :max="100" :step="1" :disabled="!entry.state.available"
                      :ticks="presetTicks(entry.state as StateFor<'cover'>)"
                      :show-ticks="presetTicks(entry.state as StateFor<'cover'>) ? 'always' : false"
                      density="compact" hide-details class="controls__slider cover-slider"
                      @update:model-value="(v: number) => drag(entry.descriptor.id, v)"
                      @end="(v: number) => commit(entry.descriptor.id, v)" />
          </div>
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.head { display: flex; align-items: center; gap: 14px; }
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.controls { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; margin: 2px 4px 0; }
.controls__slider { flex: 1 1 auto; }
/* le repere de position favorite est style globalement, voir `styles/app.css` (`.cover-slider`) */
.dot { margin-right: 6px; color: var(--accent); }
/* Jauge d'ouverture : une bande d'accent doux qui part du bord gauche et s'étire avec l'ouverture,
   fondue sur sa fin pour qu'elle ne se lise pas comme une seconde piste de curseur. Absolue et en
   z-index négatif (contexte posé par `.row`) : elle ne décale rien, et une ligne fermée n'a
   simplement rien à montrer. Déborde de 4 px de chaque côté, comme la teinte des lampes. */
.row-open {
  position: absolute; left: -4px; top: 0; bottom: 0; z-index: -1; pointer-events: none;
  width: calc(var(--open) * (100% + 8px));
  background: var(--accent-soft);
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 60%, transparent 100%);
  mask-image: linear-gradient(90deg, #000 0, #000 60%, transparent 100%);
  transition: width .4s ease;
}
@media (prefers-reduced-motion: reduce) { .row-open { transition: none; } }
.keys { display: flex; gap: 4px; flex: 0 0 auto; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
