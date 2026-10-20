<script setup lang="ts">
import { computed } from 'vue'
import { FINISH_FAMILIES, FINISHES, finishesFor, type Finish, type FinishFamily, type FinishId, type FinishSurface } from '@kasbah/shared'
import { textureUrl } from '../../three/textures/assets'

// FINISH picker for a surface (floor, a room's walls, facade): the thumbnail of each material of
// the catalog, arranged by family, plus "the style's own" at the top. The choice goes straight into
// the house draft (the scene shows it); it is the appearance bar that writes it. Nothing moves:
// the name line and the tint line have their place, filled or not.
const props = defineProps<{ surface: FinishSurface; value: Finish | undefined; disabled?: boolean }>()
const emit = defineEmits<{ change: [finish: Finish | null] }>()

const groups = computed(() => {
  const ids = finishesFor(props.surface)
  return FINISH_FAMILIES
    .map((family) => ({ family, ids: ids.filter((id) => FINISHES[id].family === family) }))
    .filter((g): g is { family: FinishFamily; ids: FinishId[] } => g.ids.length > 0)
})
const thumb = (id: FinishId) => `url("${textureUrl(FINISHES[id].dir, 'thumb')}")`
const tintable = computed(() => !!props.value && !!FINISHES[props.value.id].tintable)
/** A paint keeps its tint when switching to another paint: we change the grain, not the color. */
function pick(id: FinishId) {
  if (props.value?.id === id) return
  const tint = props.value?.tint && FINISHES[id].tintable ? props.value.tint : undefined
  emit('change', tint ? { id, tint } : { id })
}
function setTint(tint: string | undefined) {
  if (!props.value) return
  emit('change', tint ? { id: props.value.id, tint } : { id: props.value.id })
}
</script>

<template>
  <div class="fp">
    <!-- the name of the chosen finish: a reserved line, always there -->
    <div class="fp__current">
      <span class="fp__name">{{ value ? $t(`finish.names.${value.id}`) : $t('finish.styleDefault') }}</span>
      <span class="muted fp__family">{{ value ? $t(`finish.families.${FINISHES[value.id].family}`) : '' }}</span>
    </div>

    <div class="fp__row">
      <span class="muted">{{ $t('finish.tint') }}</span>
      <span class="fp__tint">
        <!-- RESERVED places: grayed out outside paint, never removed -->
        <button type="button" class="fp__reset" :class="{ 'fp__reset--off': !value?.tint }"
                :disabled="disabled || !value?.tint" :tabindex="value?.tint ? 0 : -1"
                :title="$t('finish.tintNone')" :aria-label="$t('finish.tintNone')" @click="setTint(undefined)">×</button>
        <input class="fp__color" type="color" :value="value?.tint ?? (value ? FINISHES[value.id].color : '#cccccc')"
               :disabled="disabled || !tintable" :aria-label="$t('finish.tint')"
               @change="setTint(($event.target as HTMLInputElement).value)">
      </span>
    </div>

    <button type="button" class="fp__default" :data-on="value ? '0' : '1'" :disabled="disabled" @click="value && emit('change', null)">
      {{ $t('finish.styleDefault') }}
    </button>

    <div v-for="g in groups" :key="g.family" class="fp__group">
      <div class="section-label">{{ $t(`finish.families.${g.family}`) }}</div>
      <div class="fp__grid">
        <button v-for="id in g.ids" :key="id" type="button" class="fp__swatch" :data-on="value?.id === id ? '1' : '0'"
                :style="{ backgroundImage: thumb(id) }" :title="$t(`finish.names.${id}`)" :aria-label="$t(`finish.names.${id}`)"
                :aria-pressed="value?.id === id" :disabled="disabled" @click="pick(id)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.fp { display: grid; gap: 10px; min-width: 0; }
.fp__current { display: flex; align-items: baseline; gap: 8px; min-height: 20px; min-width: 0; }
.fp__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fp__family { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fp__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.fp__tint { display: inline-flex; align-items: center; gap: 6px; }
.fp__color { width: 72px; height: 30px; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); cursor: pointer; }
.fp__color:disabled { opacity: .4; cursor: default; }
.fp__reset { width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
.fp__reset:hover { background: var(--surface2); color: var(--text); }
.fp__reset--off { visibility: hidden; }
.fp__default {
  justify-self: start; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px;
  background: transparent; color: var(--text); font: inherit; font-size: 13px; cursor: pointer;
}
.fp__default[data-on='1'] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.fp__group { display: grid; gap: 6px; }
.fp__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px; }
.fp__swatch {
  aspect-ratio: 1; min-height: 44px; border-radius: 8px; border: 2px solid transparent; background-size: cover;
  background-color: var(--surface2); cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .12);
}
.fp__swatch:hover { filter: brightness(1.06); }
.fp__swatch[data-on='1'] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.fp__swatch:disabled { cursor: default; opacity: .5; }
</style>
