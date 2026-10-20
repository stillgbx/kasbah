<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useDevicesStore } from '../../stores/devices'

// "Forget device": a plugin can REMEMBER a device it discovered on the network
// (`descriptor.meta.forgettable` — a switched-off Cast no longer announces itself, and without
// memory its entry in the house would lose its name and state). One that has disappeared for good
// is forgotten from here, otherwise it would stay listed forever.
//
// A TWO-STEP gesture (arm, then confirm within 4 s), like "Remove from house": the position of the
// button and its width do not change between the two states, only the label changes.
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
/* width shared by both labels ("Forget device" / "Confirm removal"): nothing moves */
.forget { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.forget--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
</style>
