<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { typedSetpoint } from '../../lib/setpoint'

// The setpoint figure between its two keys, which a tap turns into a field: the keys move by
// half-degrees, a tenth (19.8) is typed here. The field takes the figure's place in the SAME box —
// nothing around it moves. Enter or leaving the field sets the value, Escape gives up; a text that
// is not a number sends nothing.

const props = defineProps<{ value: number; text: string; editable: boolean; bounds: readonly [number, number]; stepC?: number }>()
const emit = defineEmits<{ set: [value: number] }>()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

async function open(): Promise<void> {
  if (!props.editable) return
  // the figure as shown, without its unit: "19,8" in French, "19.8" in English
  draft.value = props.text.replace(/[^\d.,-]/g, '') || props.value.toFixed(1)
  editing.value = true
  await nextTick()
  input.value?.select()
}
function commit(): void {
  if (!editing.value) return
  editing.value = false
  const v = typedSetpoint(draft.value, props.bounds, props.stepC)
  if (v !== null) emit('set', v)
}
</script>

<template>
  <span class="setpoint">
    <!-- while typing, the figure stays, invisible, and keeps the box's size: a field sizes itself
         on its own, and would push the "+" key away -->
    <template v-if="editing">
      <span class="setpoint__sizer" aria-hidden="true">{{ text }}</span>
      <input ref="input" v-model="draft" class="setpoint__field" inputmode="decimal" enterkeyhint="done"
             :aria-label="$t('climate.typeTarget')" @keydown.enter.prevent="commit" @keydown.escape.prevent="editing = false" @blur="commit">
    </template>
    <button v-else-if="editable" type="button" class="setpoint__text" :title="$t('climate.typeTarget')" @click="open">{{ text }}</button>
    <span v-else>{{ text }}</span>
  </span>
</template>

<style scoped>
.setpoint { display: inline-block; position: relative; }
.setpoint__sizer { visibility: hidden; }
.setpoint__field { position: absolute; inset: 0; min-width: 0; }
/* the button and the field wear the figure's own font and box: switching to the field moves nothing */
.setpoint__text, .setpoint__field {
  font: inherit; color: inherit; text-align: inherit; width: 100%; padding: 0; margin: 0;
  background: transparent; border: 0; border-radius: 6px; line-height: inherit;
}
.setpoint__text { cursor: text; }
.setpoint__text:hover { color: var(--accent, rgb(var(--v-theme-primary))); }
.setpoint__field { outline: 2px solid var(--accent, rgb(var(--v-theme-primary))); outline-offset: 1px; }
</style>
