<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { coverWords, fromClosure, toClosure } from '../lib/cover'
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
      <div class="muted count">{{ $t('covers.summary', { open: openCount, total: covers.length }) }}</div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="covers.length === 0" class="card card--soft empty muted">{{ $t('covers.none') }}</div>
      <RoomBands kind="cover">
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
            <v-slider v-if="entry.descriptor.capabilities.includes('position')"
                      :model-value="shownClosure(entry.descriptor.id, (entry.state as StateFor<'cover'>).position)"
                      :min="0" :max="100" :step="5" :disabled="!entry.state.available"
                      :ticks="presetTicks(entry.state as StateFor<'cover'>)"
                      :show-ticks="presetTicks(entry.state as StateFor<'cover'>) ? 'always' : false"
                      density="compact" hide-details class="controls__slider"
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
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.controls { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; margin: 2px 4px 0; }
.controls__slider { flex: 1 1 auto; }
/* meme repere que dans le panneau appareil */
.controls__slider :deep(.v-slider-track__tick) { background: var(--accent); opacity: .85; width: 2px; height: 8px; border-radius: 1px; }
/* accent sur accent serait invisible sur la portion active de la piste */
.controls__slider :deep(.v-slider-track__tick--filled) { background: var(--on-accent); opacity: 1; }
/* pas d'etiquette sous la piste : elle ajoute 24 px et la valeur est dans le libelle de la touche */
.controls__slider :deep(.v-slider-track__tick-label) { display: none; }
.controls__slider :deep(.v-slider--has-labels) { margin-bottom: 0; }
.dot { margin-right: 6px; color: var(--accent); }
.keys { display: flex; gap: 4px; flex: 0 0 auto; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
