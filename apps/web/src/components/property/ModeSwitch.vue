<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PropertyMode } from '@kasbah/shared'
import { usePropertiesStore } from '../../stores/properties'
import Segmented from '../ui/Segmented.vue'

// Demo or real, in the "Property" card of Settings. Switching reloads the application onto another
// house: it is confirmed (a wall-mounted tablet must not switch on a passing finger). The line
// below is reserved — instruction at rest, armed confirmation —: nothing moves.
const properties = usePropertiesStore()
const { t } = useI18n()
/** The requested mode, awaiting confirmation. */
const pending = ref<PropertyMode | null>(null)
const options = computed(() => [
  { value: 'demo' as const, label: t('properties.modeDemo') },
  { value: 'real' as const, label: t('properties.modeReal'), disabled: !properties.info?.realAvailable },
])
function ask(m: PropertyMode) { pending.value = m === properties.mode ? null : m }
function go() { if (pending.value) void properties.setMode(pending.value) }
</script>

<template>
  <div class="ms">
    <div class="ms__row">
      <span class="section-label">{{ $t('properties.mode') }}</span>
      <Segmented dense fill class="ms__seg" :model-value="pending ?? properties.mode ?? 'demo'" :options="options" @update:model-value="ask" />
    </div>
    <div class="ms__line">
      <template v-if="pending">
        <span class="ms__ask">{{ $t('properties.modeConfirm', { mode: $t(pending === 'demo' ? 'properties.modeDemo' : 'properties.modeReal').toLowerCase() }) }}</span>
        <button type="button" class="pill pill--sm" :disabled="!!properties.switching" @click="pending = null">{{ $t('common.cancel') }}</button>
        <button type="button" class="pill pill--sm ms__go" :disabled="!!properties.switching" @click="go()">
          <v-progress-circular v-if="properties.switching" indeterminate size="14" width="2" />{{ $t('properties.modeGo') }}
        </button>
      </template>
      <span v-else class="muted small">{{ properties.info?.realAvailable ? $t('properties.modeHint') : $t('properties.modeHintNoReal') }}</span>
    </div>
  </div>
</template>

<style scoped>
.ms { display: grid; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.ms__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ms__seg { flex: 0 1 220px; min-width: 0; }
/* two reserved lines: the instruction and the confirmation replace each other without pushing anything */
.ms__line { display: flex; align-items: center; gap: 8px; height: 40px; line-height: 1.5; font-size: 12px; }
.ms__ask { flex: 1 1 auto; min-width: 0; }
.ms__go { gap: 6px; border-color: var(--accent); color: var(--accent); }
</style>
