<script setup lang="ts">
import StrokeIcon from './StrokeIcon.vue'

// Bouton play réutilisable (titre, plus tard album / artiste / playlist).

withDefaults(defineProps<{
  disabled?: boolean
  busy?: boolean
  label?: string
}>(), {
  disabled: false,
  busy: false,
  label: undefined,
})

defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="play-btn"
    data-on="1"
    :disabled="disabled || busy"
    :aria-label="label"
    :aria-busy="busy ? 'true' : undefined"
    @click.stop="$emit('click')"
  >
    <StrokeIcon name="play" :size="16" :stroke-width="2" />
  </button>
</template>

<style scoped>
.play-btn {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 999px;
  border: 0;
  background: var(--accent);
  color: var(--on-accent);
  cursor: pointer;
}
.play-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.play-btn:not(:disabled):hover {
  filter: brightness(1.06);
}
.play-btn:not(:disabled):active {
  transform: scale(0.96);
}
</style>
