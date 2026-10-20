<script setup lang="ts">
import StrokeIcon from '../ui/StrokeIcon.vue'

// A collapsible section of the house panel in edit mode. We work by theme: only one section open
// at a time (the parent holds which), it has the whole panel to itself.
defineProps<{ title: string; meta?: string; open: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <section class="es" :data-open="open ? '1' : '0'">
    <button type="button" class="es__head" :aria-expanded="open" @click="$emit('toggle')">
      <span class="section-label es__title">{{ title }}</span>
      <span v-if="meta" class="muted es__meta">{{ meta }}</span>
      <StrokeIcon :name="open ? 'chevronUp' : 'chevronDown'" :size="16" class="muted es__chev" />
    </button>
    <div v-if="open" class="es__body"><slot /></div>
  </section>
</template>

<style scoped>
.es { border-bottom: 1px solid var(--line); }
.es__head {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 0; min-width: 0;
  border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.es__head:hover .es__title, .es__head:hover .es__chev { color: var(--text); }
.es__title { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.es__meta { flex: none; font-size: 12px; font-variant-numeric: tabular-nums; }
.es__chev { flex: none; }
.es__body { padding-bottom: 12px; }
</style>
