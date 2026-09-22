<script setup lang="ts">
import StrokeIcon from '../ui/StrokeIcon.vue'

// Rangée de pastilles effaçables (recherches récentes) : libellé fixe à gauche, pastilles à droite.
// La rangée garde sa hauteur minimale même vide, pour que ce qui suit ne remonte pas.
defineProps<{ label: string; items: { key: string; label: string }[]; disabled?: boolean; removeLabel: string }>()
defineEmits<{ pick: [key: string]; remove: [key: string] }>()
</script>

<template>
  <div class="chips">
    <span class="chips__label muted">{{ label }}</span>
    <div class="chips__list">
      <div v-for="it in items" :key="it.key" class="chip">
        <button type="button" class="chip__go" :disabled="disabled" @click="$emit('pick', it.key)">{{ it.label }}</button>
        <button type="button" class="chip__x" :aria-label="removeLabel" :disabled="disabled" @click="$emit('remove', it.key)">
          <StrokeIcon name="close" :size="12" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chips { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 2px; }
.chips__label { flex: 0 0 auto; font-size: 12px; white-space: nowrap; }
.chips__list { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; flex: 1 1 auto; min-height: 28px; align-items: center; }
.chip { display: inline-flex; align-items: center; max-width: 220px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); overflow: hidden; }
.chip__go {
  min-width: 0; flex: 1 1 auto; padding: 4px 8px 4px 10px; border: 0; background: transparent; color: var(--text);
  font: inherit; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
}
.chip__go:hover:not(:disabled) { background: color-mix(in srgb, var(--muted) 12%, transparent); }
.chip__x { flex: 0 0 auto; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-left: 1px solid var(--line); background: transparent; color: var(--muted); }
.chip__x:hover:not(:disabled) { color: var(--text); background: color-mix(in srgb, var(--muted) 12%, transparent); }
.chip__go:disabled, .chip__x:disabled { opacity: .45; cursor: default; }
</style>
