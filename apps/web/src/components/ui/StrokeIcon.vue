<script setup lang="ts">
import { ICONS, type IconName } from '../../lib/strokeIcons'

withDefaults(defineProps<{ name: IconName; size?: number | string; strokeWidth?: number }>(), { size: 24, strokeWidth: 1.8 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="ICONS[name]" />
  </svg>
</template>
