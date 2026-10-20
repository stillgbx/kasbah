<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// Seven pills, Monday first, to pick days of the week. With a finger, a pill beats a checkbox (and
// `v-checkbox-btn` renders empty in this project). The values are those of `Date.getDay()`:
// 0 = Sunday. No day checked = every day (`undefined`).
const props = defineProps<{ modelValue: readonly number[] | undefined; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number[] | undefined] }>()
const { locale } = useI18n()

const ORDER = [1, 2, 3, 4, 5, 6, 0]
const labels = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' })
  const long = new Intl.DateTimeFormat(locale.value, { weekday: 'long' })
  // January 4, 2026 is a Sunday
  return ORDER.map((d) => ({ d, short: fmt.format(new Date(2026, 0, 4 + d)), long: long.format(new Date(2026, 0, 4 + d)) }))
})

const on = (d: number) => !props.modelValue || props.modelValue.includes(d)

function toggle(d: number) {
  const current = new Set(props.modelValue ?? ORDER)
  if (current.has(d)) current.delete(d)
  else current.add(d)
  // all checked = no filter; none checked makes no sense, it also falls back to "every day"
  emit('update:modelValue', current.size === 7 || current.size === 0 ? undefined : ORDER.filter((x) => current.has(x)))
}
</script>

<template>
  <div class="days" role="group" :aria-label="$t('automations.trigger.days')">
    <button v-for="l in labels" :key="l.d" type="button" class="days__pill" :data-on="on(l.d) ? '1' : '0'"
            :disabled="disabled" :title="l.long" :aria-label="l.long" :aria-pressed="on(l.d)" @click="toggle(l.d)">
      {{ l.short }}
    </button>
  </div>
</template>

<style scoped>
.days { display: flex; gap: 4px; }
/* fixed width: the seven fit in 296 px, and a wider letter shifts nothing */
.days__pill {
  flex: 1 1 0; min-width: 0; height: 32px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface); color: var(--muted); font: 600 12px/1 var(--font); text-transform: uppercase;
  transition: background .15s, color .15s;
}
.days__pill[data-on='1'] { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.days__pill:disabled { opacity: .45; }
</style>
