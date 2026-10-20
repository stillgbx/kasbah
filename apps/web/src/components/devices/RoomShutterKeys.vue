<script setup lang="ts">
import { computed } from 'vue'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Ouvrir / Stop / Fermer les VOLETS d'une pièce d'un seul appui, dans l'en-tête de sa carte (vue
// Ouvrants). Les mêmes touches que sur une ligne, appliquées à la pièce : comme l'interrupteur des
// lampes d'une pièce (`RoomLightsToggle`), c'est un LOT de commandes (`runScene`).
//
// Les volets seulement (choix de l'utilisateur) : ni store, ni portail, ni porte de garage — une
// pièce qui n'a que ça n'a pas de touches. Un ouvrant sans nature déclarée est un volet, la nature
// par défaut (`coverWords`).
//
// Ouvrir et fermer lisent la position VISÉE (`targetPosition`), comme `CoversMaster` : on peut se
// raviser pendant la course, et l'on n'écrit qu'aux volets qui doivent bouger.
const props = defineProps<{ entries: DeviceEntry[] }>()
const devices = useDevicesStore()

const shutters = computed(() => props.entries.filter((e) => e.state.kind === 'cover'
  && (e.descriptor.meta.cover?.deviceClass || 'shutter') === 'shutter'))
const reachable = computed(() => shutters.value.filter((e) => e.state.available))
const hasStop = computed(() => shutters.value.some((e) => e.descriptor.capabilities.includes('stop')))
const position = (e: DeviceEntry) => devices.targetPosition(e.descriptor.id) ?? (e.state as StateFor<'cover'>).position
// Stop : les volets EN MOUVEMENT seulement. Un arrêt sur un moteur immobile n'est pas anodin : sur
// une radio sans retour il efface la position déduite, et un moteur RTS peut le prendre pour « my ».
// Le mouvement est celui que publie le moteur, ou que le store pose dès le geste (`optimistic.ts`).
const moving = computed(() => reachable.value.filter((e) => e.descriptor.capabilities.includes('stop')
  && (e.state as StateFor<'cover'>).motion !== 'stopped'))

function send(targets: DeviceEntry[], command: CommandInput) {
  void devices.runScene(targets.map((e) => ({ deviceId: e.descriptor.id, command })))
}
// position inconnue : on envoie quand même, on ne sait pas où en est le volet
const open = () => send(reachable.value.filter((e) => (position(e) ?? 0) < 100), { type: 'cover.open' })
const close = () => send(reachable.value.filter((e) => (position(e) ?? 100) > 0), { type: 'cover.close' })
const stop = () => send(moving.value, { type: 'cover.stop' })
</script>

<template>
  <div v-if="shutters.length" class="room-keys">
    <button type="button" class="key" :disabled="!reachable.length"
            :title="$t('rooms.shuttersOpen')" :aria-label="$t('rooms.shuttersOpen')" @click="open">
      <StrokeIcon name="collapseUp" :size="16" />
    </button>
    <!-- grisé quand rien ne bouge : la touche reste à sa place, rien ne se décale -->
    <button v-if="hasStop" type="button" class="key" :disabled="!moving.length"
            :title="$t('rooms.shuttersStop')" :aria-label="$t('rooms.shuttersStop')" @click="stop">
      <StrokeIcon name="stop" :size="16" />
    </button>
    <button type="button" class="key" :disabled="!reachable.length"
            :title="$t('rooms.shuttersClose')" :aria-label="$t('rooms.shuttersClose')" @click="close">
      <StrokeIcon name="collapseDown" :size="16" />
    </button>
  </div>
</template>

<style scoped>
/* marge négative : les touches débordent sur la marge basse de l'en-tête plutôt que de l'agrandir,
   pour que les lignes d'une carte avec ou sans volets commencent au même endroit */
.room-keys { display: flex; gap: 6px; flex: 0 0 auto; margin: -5px 0; }
.key {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
