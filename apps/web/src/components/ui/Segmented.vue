<script setup lang="ts" generic="T extends string">
// Contrôle segmenté en pilule : conteneur surface + bordure, segment actif sur l'accent.
defineProps<{ modelValue: T; options: { value: T; label: string }[]; dense?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div class="segmented" :class="{ 'segmented--dense': dense }" role="tablist">
    <button v-for="o in options" :key="o.value" type="button" role="tab" class="segmented__item" :data-on="o.value === modelValue ? '1' : '0'"
            :aria-selected="o.value === modelValue" @click="emit('update:modelValue', o.value)">
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); }
.segmented__item {
  height: 36px; padding: 0 16px; border-radius: 999px; border: 0; background: transparent; color: var(--muted);
  font: 500 14px/1 var(--font); transition: background .15s, color .15s; white-space: nowrap;
}
.segmented--dense .segmented__item { height: 32px; padding: 0 12px; font-size: 13px; }
.segmented__item:hover { color: var(--text); }
.segmented__item[data-on='1'] { background: var(--accent); color: var(--on-accent); }
</style>
