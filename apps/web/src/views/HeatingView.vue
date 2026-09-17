<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import HeatingControl from '../components/heating/HeatingControl.vue'
import HeatingHistoryChart from '../components/heating/HeatingHistoryChart.vue'
import HeatingUnitCard from '../components/heating/HeatingUnitCard.vue'
import type { HeatingPoint, MelcloudUnit } from '../api/transport'
import { useDevicesStore } from '../stores/devices'

// Vue Chauffage. Deux étages seulement :
//
//  1. la MACHINE et son HISTORIQUE, côte à côte en tête — ce qui n'appartient à aucune pièce et
//     qu'on ne lit qu'ici ;
//  2. les APPAREILS, dans leurs pièces, avec leurs commandes sur leur propre ligne (`RoomBands`,
//     comme les vues Lumières et Ouvrants).
//
// Il n'y a PAS de liste de zones en plus. La première version en avait une, et elle redisait les
// mêmes appareils que les bandes de pièces trente centimètres plus bas, dans un autre ordre : on
// cherchait deux fois, et on réglait à un endroit ce qu'on lisait à l'autre. Un appareil de
// chauffage se règle désormais là où il est dans la maison, point.
//
// La machine et l'historique ne sont pas des appareils : ils viennent du plugin, pas du registre.

const devices = useDevicesStore()

const units = ref<MelcloudUnit[]>([])
const history = ref<HeatingPoint[]>([])
const pollMs = ref(120_000)

/**
 * L'état machine et l'historique ne sont pas poussés par le WebSocket (ce ne sont pas des états
 * d'appareils) : cette page les redemande elle-même, au rythme du sondage serveur. Inutile d'aller
 * plus vite que lui — il relirait la même chose.
 */
async function refresh() {
  try {
    const [sys, hist] = await Promise.all([getTransport().melcloudSystem(), getTransport().melcloudHistory()])
    units.value = sys.units
    history.value = hist.hourly
    pollMs.value = sys.pollMs || hist.pollMs || pollMs.value
  } catch {
    // plugin éteint ou compte non lié : la page garde ses appareils et tait la partie machine
    units.value = []
  }
}
onMounted(refresh)
const { pause } = useIntervalFn(refresh, 120_000)
onUnmounted(pause)

const send = (deviceId: string, cmd: CommandInput) => devices.sendCommand(deviceId, cmd)
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__scroll">
      <!-- Première ligne : la machine à gauche, ce qu'elle a fait à droite. Deux colonnes dès que la
           largeur le permet (même seuil que les vues Eau et Énergie), l'une sous l'autre sinon. -->
      <div v-if="units.length" class="heat__top">
        <div class="heat__units">
          <HeatingUnitCard v-for="u in units" :key="u.deviceId" :unit="u" />
        </div>
        <HeatingHistoryChart :points="history" :poll-ms="pollMs" />
      </div>

      <RoomBands kind="climate">
        <!-- « en train de chauffer » ou « au repos », à la suite des deux températures que le statut
             affiche déjà : du texte, comme la vue Médias met l'état de lecture devant le titre. Pas
             une pastille — cette application n'en emploie nulle part ailleurs dans une liste. -->
        <template #status-after="{ entry }">
          <span class="act">· {{ $t(`climate.actions.${(entry as DeviceEntry).state.kind === 'climate' ? ((entry as DeviceEntry).state as StateFor<'climate'>).action ?? 'idle' : 'idle'}`) }}</span>
        </template>
        <!-- les commandes sur leur propre rangée, comme les touches d'un ouvrant ou le curseur
             d'une lampe : rien ne peut chevaucher le nom ni la pastille de liaison -->
        <template #control="{ entry }">
          <HeatingControl :entry="entry as DeviceEntry" @command="send" />
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); display: grid; gap: 16px; align-content: start; }
/* Même seuil que les vues Eau et Énergie, pour que les trois pages se comportent pareil à la même
   largeur de fenêtre. Et comme elles, on laisse le `stretch` par défaut du grid : côte à côte, les
   deux cartes font la MÊME hauteur. `align-items: start` donnait une machine plus courte de 68 px
   que l'historique, et deux bords bas décalés qui cassaient la ligne. */
.heat__top { display: grid; gap: 16px; min-width: 0; }
/* la colonne de gauche transmet l'étirement à sa carte, au lieu de le garder pour elle */
.heat__units { display: grid; gap: 16px; min-width: 0; grid-auto-rows: 1fr; }
/* l'état à la suite des températures, dans la même encre que le reste du statut */
.act { flex: 0 0 auto; white-space: nowrap; }
@media (min-width: 1040px) { .heat__top { grid-template-columns: 1fr 1fr; } }
</style>
