<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'

/**
 * The thermostat this one is LINKED to (`house.climateLinks`): the server copies a setpoint set on
 * one to the other, whatever their brands — a Nest in front of a heat pump must not fight it. Any
 * other `climate` that takes a setpoint can be chosen; "None" unlinks. In a group of three, the
 * first other member is shown.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()
const devices = useDevicesStore()

const nameOf = (id: string) => house.houseDeviceFor(id)?.name ?? devices.descriptors[id]?.name ?? id
const candidates = computed(() => devices.list
  .filter((e) => e.descriptor.id !== props.descriptor.id && e.descriptor.kind === 'climate' && e.descriptor.capabilities.includes('target_temp'))
  .map((e) => ({ id: e.descriptor.id, name: nameOf(e.descriptor.id) }))
  .sort((a, b) => a.name.localeCompare(b.name)))
const linkedTo = computed(() => house.house?.climateLinks?.find((g) => g.includes(props.descriptor.id))?.find((id) => id !== props.descriptor.id) ?? '')

function setLink(raw: string): void {
  if (raw === linkedTo.value) return
  void house.saveClimateLink({ deviceId: props.descriptor.id, linkedTo: raw || null })
}
</script>

<template>
  <div class="card card--soft tune">
    <label class="tune__row">
      <span class="muted tune__k">{{ $t('climate.link.title') }}</span>
      <span class="tune__fields">
        <select :value="linkedTo" @change="setLink(($event.target as HTMLSelectElement).value)">
          <option value="">{{ $t('climate.link.none') }}</option>
          <option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </span>
    </label>
    <p class="muted tune__hint">{{ $t('climate.link.hint') }}</p>
  </div>
</template>

<style scoped>
/* same layout as the other settings of the panel (`CoverTuning`, `VehicleTuning`) */
.tune { padding: 10px 12px; display: grid; gap: 8px; }
.tune__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.tune__k { flex: 1 1 auto; min-width: 0; }
.tune__fields { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
/* a device name, not a word: wider than the other settings' selectors, and cut rather than overflowing */
.tune select {
  width: 160px; max-width: 100%; padding: 4px 8px; text-overflow: ellipsis;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px;
}
.tune__hint { margin: 0; font-size: 12px; }
</style>
