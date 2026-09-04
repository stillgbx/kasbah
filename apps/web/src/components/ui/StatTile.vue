<script setup lang="ts">
import type { IconName } from '../../lib/strokeIcons'
import StrokeIcon from './StrokeIcon.vue'

defineProps<{ value: string; label: string; icon?: IconName; hint?: string }>()
</script>

<template>
  <div class="stat-tile card card--soft">
    <div v-if="icon || hint" class="stat-tile__head">
      <span v-if="icon" class="icon-square" data-on="1"><StrokeIcon :name="icon" :size="18" /></span>
      <span v-if="hint" class="muted text-caption">{{ hint }}</span>
    </div>
    <div class="stat-value">{{ value }}</div>
    <div class="stat-tile__label">{{ label }}</div>
  </div>
</template>

<style scoped>
.stat-tile { padding: 14px; min-width: 0; }
.stat-tile__head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.stat-tile__label { font-size: 12px; color: var(--muted); margin-top: 2px; }
</style>
