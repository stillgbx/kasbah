<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useDevicesStore } from '../../stores/devices'

// « Oublier l'appareil » : un plugin peut RETENIR un appareil qu'il a découvert sur le réseau
// (`descriptor.meta.forgettable` — un Cast éteint ne s'annonce plus, et sans mémoire son entrée
// dans la maison perdrait son nom et son état). Celui qui a disparu pour de bon s'oublie d'ici,
// sinon il resterait listé pour toujours.
//
// Geste en DEUX TEMPS (armer, puis confirmer dans les 4 s), comme « Retirer de la maison » : la
// place du bouton et sa largeur ne changent pas entre les deux états, seul le libellé change.
const props = defineProps<{ deviceId: string }>()
const emit = defineEmits<{ forgotten: [] }>()
const devices = useDevicesStore()

const armed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function click() {
  if (!armed.value) { armed.value = true; disarm = setTimeout(() => { armed.value = false }, 4000); return }
  clearTimeout(disarm)
  armed.value = false
  void devices.forget(props.deviceId).then((ok) => { if (ok) emit('forgotten') })
}
onBeforeUnmount(() => clearTimeout(disarm))
</script>

<template>
  <button type="button" class="pill forget" :class="{ 'forget--armed': armed }" :title="$t('device.forgetHint')" @click.stop="click">
    {{ armed ? $t('device.forgetConfirm') : $t('device.forget') }}
  </button>
</template>

<style scoped>
/* largeur commune aux deux libellés (« Oublier l'appareil » / « Confirmer l'oubli ») : rien ne bouge */
.forget { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.forget--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
</style>
