<script setup lang="ts" generic="T extends string">
import StrokeIcon from '../ui/StrokeIcon.vue'

// "+ Add" button that opens a list of choices — the idiom of the add menu of the spots
// (`ParkingRows.vue`). Used for the conditions, the "Any of these" group and the editor's actions.
defineProps<{ label: string; items: { value: T; title: string }[]; disabled?: boolean }>()
const emit = defineEmits<{ pick: [value: T] }>()
</script>

<template>
  <v-menu location="bottom start">
    <template #activator="{ props: menu }">
      <button v-bind="menu" type="button" class="pill add" :disabled="disabled || !items.length">
        <StrokeIcon name="plus" :size="16" /> {{ label }}
      </button>
    </template>
    <div class="add-list card">
      <div class="section-label add-list__title">{{ label }}</div>
      <button v-for="i in items" :key="i.value" type="button" class="add-item" @click="emit('pick', i.value)">{{ i.title }}</button>
    </div>
  </v-menu>
</template>

<style scoped>
.add { align-self: flex-start; height: 34px; font-size: 13px; }
.add-list { padding: 8px; display: grid; gap: 2px; min-width: 200px; max-width: min(280px, 80vw); }
.add-list__title { padding: 2px 8px 4px; }
.add-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.add-item:hover { background: var(--surface2); }
</style>
