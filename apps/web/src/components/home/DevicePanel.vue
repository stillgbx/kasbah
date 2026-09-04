<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput } from '@kasbah/shared'
import { useDeviceResolver } from '../../composables/useDeviceResolver'
import { headlineValue, isDeviceOn, toggleCommand } from '../../lib/deviceState'
import { kindIcon } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'
import DeviceControl from '../controls/DeviceControl.vue'

// Panneau « appareil » : fil d'Ariane vers la pièce, en-tête (icône, nom, fabricant, bascule),
// grande valeur, puis le contrôle propre au type.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t, locale } = useI18n()
const resolved = useDeviceResolver(computed(() => house.selectedKey))

const crumb = computed(() => {
  const hd = resolved.value?.houseDevice
  if (!hd) return t('nav.home')
  return (hd.roomId ? house.index?.roomsById.get(hd.roomId)?.name : hd.zoneId ? house.index?.zonesById.get(hd.zoneId)?.name : null) ?? t('nav.home')
})
const on = computed(() => !!resolved.value?.state && isDeviceOn(resolved.value.state))
const toggle = computed(() => (resolved.value?.state ? toggleCommand(resolved.value.state) : null))
const headline = computed(() => (resolved.value?.descriptor && resolved.value.state ? headlineValue(resolved.value.descriptor, resolved.value.state, t, locale.value) : ''))
const brand = computed(() => resolved.value?.descriptor?.meta.manufacturer ?? (resolved.value?.deviceId?.split(':')[0] ?? ''))

function send(cmd: CommandInput) {
  const id = resolved.value?.deviceId
  if (id) void devices.sendCommand(id, cmd)
}
</script>

<template>
  <template v-if="resolved">
    <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ crumb }}</button>
    <div class="head">
      <span class="icon-square icon-square--lg" :data-on="on ? '1' : '0'"><StrokeIcon :name="kindIcon(resolved.descriptor?.kind ?? resolved.houseDevice?.kind, resolved.descriptor)" :size="22" /></span>
      <div class="head__main">
        <div class="head__name">{{ resolved.name }}</div>
        <div class="muted head__sub">
          <span v-if="resolved.descriptor">{{ $t(`kinds.${resolved.descriptor.kind}`) }}</span><span v-if="brand"> · {{ brand }}</span>
          <span v-if="resolved.state && !resolved.state.available" class="text-error"> · {{ $t('common.unavailable') }}</span>
        </div>
      </div>
      <v-progress-circular v-if="resolved.deviceId && devices.isPending(resolved.deviceId)" indeterminate size="20" width="2" color="primary" />
      <v-switch v-else-if="toggle" :model-value="on" :disabled="!resolved.state?.available" @update:model-value="send(toggle!)" />
    </div>
    <div v-if="headline" class="big-value">{{ headline }}</div>
    <DeviceControl v-if="resolved.descriptor && resolved.state" :descriptor="resolved.descriptor" :state="resolved.state"
                   :pending="devices.isPending(resolved.deviceId!)" @command="send" />
    <div v-else class="card card--soft unbound muted">{{ $t('device.unbound', { id: resolved.houseDevice?.deviceId ?? resolved.key }) }}</div>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; justify-self: start; }
.crumb:hover { color: var(--text); }
.head { display: flex; align-items: center; gap: 12px; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.head__sub { font-size: 12px; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; }
.unbound { padding: 12px 14px; font-size: 13px; }
</style>
