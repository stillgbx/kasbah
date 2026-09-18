<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { coverAtRest, isFlatCover, isPassageCover } from '../../lib/cover'
import { useDevicesStore } from '../../stores/devices'
import Segmented from '../ui/Segmented.vue'

// Commande d'ensemble des ouvrants, en haut de la vue Ouvrants. Comme celle des lampes
// (`LightsMaster`), le protocole n'a rien de tel — c'est un LOT de commandes (`runScene`) — et ce
// sont DEUX gestes nommés plutôt qu'un interrupteur : sur dix-neuf ouvrants dont seize sont
// ouverts, un interrupteur laissait deviner ce que l'appui allait faire.
//
// Les deux gestes ne sont volontairement pas symétriques :
//
// - **« Tout fermer » met chacun AU REPOS** : volets et portail fermés, stores REMONTÉS. Un store
//   déployé n'est pas une maison sécurisée, c'est de la toile au vent — fermer ne doit donc jamais
//   le baisser, alors que la commande `cover.close` le ferait (`lib/cover.ts`, `coverAtRest`).
// - **« Tout ouvrir » n'ouvre que les VOLETS.** Ni le portail ni les stores ne bougent : un geste
//   d'ensemble n'ouvre pas sur la rue, et ne déploie pas une toile. Ce qu'on ouvre par erreur ici
//   coûte plus cher que ce qu'on oublie d'ouvrir. Sans rien à ouvrir (une terrasse de stores et un
//   portail), le segment est grisé : il ne promet pas un geste qu'il ne ferait pas.
//
// Une position inconnue est supposée au repos pour l'ÉTAT montré (sans ça, un portail muet suffisait
// à ne jamais rien allumer) mais reçoit quand même la commande quand on ferme : on ne sait pas où il
// en est, et fermer ce qui est déjà fermé ne coûte rien.
//
// Tout se lit sur la position VISÉE quand le store en tient une (`targetPosition`), jamais sur la
// seule position publiée. C'est ce qui permet de se raviser : un volet lancé vers le bas compte
// comme fermé dès le geste, donc « Tout ouvrir » dans la seconde qui suit le voit encore à ouvrir
// et le relance — alors qu'avec la position du moteur, muette pendant les ~20 s de descente, il
// l'aurait cru déjà ouvert et ne lui aurait rien dit. C'est aussi ce qui fait prendre au segment sa
// valeur cible au doigt, et revenir tout seul si le serveur refuse (le store libère la cible).
type Choice = 'rest' | 'open' | ''

const props = defineProps<{ entries: DeviceEntry[]; label: string }>()
const devices = useDevicesStore()
const { t } = useI18n()

const covers = computed(() => props.entries.filter((e) => e.state.kind === 'cover'))
const reachable = computed(() => covers.value.filter((e) => e.state.available))
const position = (e: DeviceEntry) => devices.targetPosition(e.descriptor.id) ?? (e.state as StateFor<'cover'>).position
const atRest = (e: DeviceEntry) => coverAtRest(e.descriptor, position(e))
/** Ce que le geste « ouvrir » touche : volets, rideaux, fenêtres — jamais un passage ni un store. */
const openable = computed(() => reachable.value.filter((e) => !isFlatCover(e.descriptor) && !isPassageCover(e.descriptor)))

const value = computed<Choice>(() => {
  if (reachable.value.length > 0 && reachable.value.every(atRest)) return 'rest'
  if (openable.value.length > 0 && openable.value.every((e) => (position(e) ?? 0) >= 100)) return 'open'
  return ''
})

const options = computed(() => [
  { value: 'rest' as Choice, label: t('covers.allClose'), disabled: reachable.value.length === 0 },
  { value: 'open' as Choice, label: t('covers.allOpen'), disabled: openable.value.length === 0 },
])

function apply(choice: Choice) {
  if (choice === 'open') {
    // les volets qu'on ne sait pas déjà grands ouverts
    const targets = openable.value.filter((e) => (position(e) ?? 0) < 100)
    void devices.runScene(targets.map((e) => ({ deviceId: e.descriptor.id, command: { type: 'cover.open' as const } })))
    return
  }
  if (choice !== 'rest') return
  // chacun vers son repos — fermer ce qui se tient debout, remonter les stores
  const targets = reachable.value.filter((e) => position(e) === undefined || !atRest(e))
  void devices.runScene(targets.map((e) => ({
    deviceId: e.descriptor.id,
    command: { type: isFlatCover(e.descriptor) ? ('cover.open' as const) : ('cover.close' as const) },
  })))
}
</script>

<template>
  <Segmented v-if="covers.length" dense :model-value="value" :options="options" :label="label"
             @update:model-value="apply" />
</template>
