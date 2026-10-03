<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Barre du brouillon d'apparence : annuler / rétablir un choix, abandonner la séance, ou la valider
// — seul « Valider » écrit dans house.json, et il écrit tout d'un coup (plusieurs pièces, la façade).
// Ctrl+Z / Ctrl+Y (ou Ctrl+Maj+Z) font la même chose que les deux flèches, hors d'un champ de saisie.
const house = useHouseStore()

function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey && house.canUndoEdit) { e.preventDefault(); house.undoEdit() }
  else if ((k === 'y' || (k === 'z' && e.shiftKey)) && house.canRedoEdit) { e.preventDefault(); house.redoEdit() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="ab">
    <div class="ab__row">
      <button type="button" class="ab__icon" :disabled="!house.canUndoEdit || house.savingEdit"
              :title="$t('finish.undo')" :aria-label="$t('finish.undo')" @click="house.undoEdit()">
        <StrokeIcon name="undo" :size="18" />
      </button>
      <button type="button" class="ab__icon" :disabled="!house.canRedoEdit || house.savingEdit"
              :title="$t('finish.redo')" :aria-label="$t('finish.redo')" @click="house.redoEdit()">
        <StrokeIcon name="redo" :size="18" />
      </button>
      <!-- l'état du brouillon, dans la place qui reste : il change sans rien pousser. Ce qui empêche
           d'écrire s'y dit aussi (le premier motif ; tous dans l'info-bulle) -->
      <span v-if="house.editBlocking.length" class="ab__status ab__status--block" :title="house.editBlocking.join('\n')">
        {{ $t('shape.blocking') }} : {{ house.editBlocking[0] }}
      </span>
      <span v-else class="muted ab__status">{{ house.editDirty ? $t('finish.pending') : $t('finish.clean') }}</span>
    </div>
    <!-- deux moitiés égales : « Abandonner » ne tenait pas sur la même ligne que les flèches -->
    <div class="ab__actions">
      <button type="button" class="pill ab__btn" :disabled="!house.canUndoEdit || house.savingEdit" @click="house.discardEdit()">
        {{ $t('finish.discard') }}
      </button>
      <button type="button" class="pill ab__btn" :data-on="house.editDirty ? '1' : '0'"
              :disabled="!house.editDirty || house.editBlocking.length > 0 || house.savingEdit" @click="house.saveEdit()">
        <StrokeIcon name="check" :size="16" /> {{ $t('finish.save') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ab { display: grid; gap: 8px; }
.ab__row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ab__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ab__btn { justify-content: center; gap: 6px; min-width: 0; }
.ab__icon {
  display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
  border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--text); cursor: pointer;
}
.ab__icon:hover:not(:disabled) { background: var(--surface2); }
.ab__icon:disabled { opacity: .4; cursor: default; }
.ab__status--block { color: rgb(var(--v-theme-error)); }
.ab__status { flex: 1 1 0; min-width: 0; margin-left: 6px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
