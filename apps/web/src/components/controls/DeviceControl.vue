<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { CommandInput, DeviceDescriptor, DeviceKind, DeviceState } from '@kasbah/shared'
import LightControl from './LightControl.vue'
import CoverControl from './CoverControl.vue'
import MediaPlayerControl from './MediaPlayerControl.vue'
import ClimateControl from './ClimateControl.vue'
import VacuumControl from './VacuumControl.vue'
import MowerControl from './MowerControl.vue'
import SensorCard from './SensorCard.vue'
import EnergyCard from './EnergyCard.vue'
import EvChargerControl from './EvChargerControl.vue'
import VehicleCard from './VehicleCard.vue'
import CameraCard from './CameraCard.vue'
import WeatherCard from './WeatherCard.vue'
import WaterCard from './WaterCard.vue'
import FanControl from './FanControl.vue'
import PetFeederCard from './PetFeederCard.vue'
import PetFountainCard from './PetFountainCard.vue'

// Aiguillage par kind : chaque contrôle reçoit (descriptor, state, pending) et émet `command`.
const CONTROLS: Record<DeviceKind, Component> = {
  light: LightControl, cover: CoverControl, media_player: MediaPlayerControl, climate: ClimateControl, vacuum: VacuumControl,
  mower: MowerControl, sensor: SensorCard, energy: EnergyCard, ev_charger: EvChargerControl, vehicle: VehicleCard, camera: CameraCard,
  weather: WeatherCard, water: WaterCard, pet_feeder: PetFeederCard, pet_fountain: PetFountainCard, fan: FanControl,
}

const props = defineProps<{ descriptor: DeviceDescriptor; state: DeviceState; pending?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const control = computed(() => CONTROLS[props.descriptor.kind])
</script>

<template>
  <component :is="control" :descriptor="descriptor" :state="state" :pending="pending" :disabled="!state.available"
             @command="(c: CommandInput) => emit('command', c)" />
</template>
