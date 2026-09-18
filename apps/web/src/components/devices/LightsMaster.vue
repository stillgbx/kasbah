<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoomLights } from '../../composables/useRoomLights'
import { useDevicesStore } from '../../stores/devices'
import Segmented from '../ui/Segmented.vue'

// Commande d'ensemble des lampes, en haut de la vue Lumières : DEUX gestes nommés (« Tout
// éteindre », « Tout allumer ») plutôt qu'un interrupteur.
//
// L'interrupteur n'offrait qu'un geste à la fois, et il le déduisait de l'état : sur quinze lampes
// dont trois sont allumées, il fallait deviner ce que l'appui allait faire — et rallumer la maison
// demandait deux appuis. Ici les deux gestes sont toujours à portée, quel que soit l'état du parc.
//
// Le segment allumé montre l'ÉTAT, pas le dernier appui : rien de sélectionné tant que les lampes
// sont partagées. Comme le store applique la commande à l'état sans attendre le serveur (mise à
// jour optimiste), le segment prend quand même sa valeur CIBLE au doigt — et revient tout seul si
// le serveur refuse, puisque le store remet alors l'état d'avant.
//
// L'interrupteur par pièce (`RoomLightsToggle`) n'a pas changé : dans une ligne de pièce il n'y a
// pas la place pour deux mots, et une pièce est un petit lot où l'ambiguïté coûte moins cher.
type Choice = 'off' | 'on' | ''

const props = defineProps<{ deviceIds: (string | undefined)[]; label: string }>()
const devices = useDevicesStore()
const { t } = useI18n()

// Même lecture que les contrôles de pièce, pour que rien ne se contredise d'un écran à l'autre.
const { lights, reachable, on } = useRoomLights(() => props.deviceIds)

const value = computed<Choice>(() =>
  on.value.length === 0 ? 'off' : on.value.length === reachable.value.length ? 'on' : '')

const options = computed(() => {
  // l'INVENTAIRE décide de la présence des segments, la joignabilité de leur activité (règle
  // « rien ne bouge ») : un pont muet grise les deux gestes, il ne les fait pas disparaître
  const disabled = reachable.value.length === 0
  return [
    { value: 'off' as Choice, label: t('lights.allOff'), disabled },
    { value: 'on' as Choice, label: t('lights.allOn'), disabled },
  ]
})

function apply(choice: Choice) {
  if (!choice) return
  const next = choice === 'on'
  // n'écrire que sur les lampes qui doivent changer : le pont limite le débit des commandes
  const targets = reachable.value.filter((l) => l.state.on !== next)
  void devices.runScene(targets.map((l) => ({ deviceId: l.id, command: { type: 'light.set' as const, on: next } })))
}
</script>

<template>
  <Segmented v-if="lights.length" dense :model-value="value" :options="options" :label="label"
             @update:model-value="apply" />
</template>
