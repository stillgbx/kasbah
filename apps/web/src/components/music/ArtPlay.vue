<script setup lang="ts">
import StrokeIcon from '../ui/StrokeIcon.vue'

// Play button set IN THE MIDDLE of a cover art (tile or row): a stroked circle on a dark veil,
// readable on any image, without a flat color fill that screams. It only appears on hover of its
// parent (the parent reveals it via `:deep(.art-play)`), and stays visible while sending. On a
// touch screen, with no hover, it is always there — it is what makes the cover art discreet.
withDefaults(defineProps<{
  size?: number
  disabled?: boolean
  busy?: boolean
  label?: string
}>(), { size: 44, disabled: false, busy: false, label: undefined })
defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button" class="art-play" :style="{ '--size': `${size}px` }" :disabled="disabled || busy"
          :aria-label="label" :title="label" :aria-busy="busy ? 'true' : undefined" @click.stop="$emit('click')">
    <v-progress-circular v-if="busy" indeterminate :size="Math.round(size * 0.5)" :width="2" color="currentColor" />
    <StrokeIcon v-else name="play" :size="Math.round(size * 0.42)" :stroke-width="2" class="art-play__icon" />
  </button>
</template>

<style scoped>
.art-play {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: grid; place-items: center; width: var(--size); height: var(--size); padding: 0;
  border-radius: 999px; border: 1.5px solid rgb(255 255 255 / .92);
  background: rgb(0 0 0 / .38); color: #fff; cursor: pointer;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  transition: opacity .15s, background .15s, border-color .15s;
}
/* the triangle has its weight on the left: re-center it by eye */
.art-play__icon { margin-left: calc(var(--size) * .06); }
.art-play:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
/* greyed by the stroke, not by opacity: the opacity is on the parent, which reveals the button
   on hover */
.art-play:disabled { cursor: default; }
.art-play:disabled:not([aria-busy='true']) { border-color: rgb(255 255 255 / .45); color: rgb(255 255 255 / .5); }
</style>
