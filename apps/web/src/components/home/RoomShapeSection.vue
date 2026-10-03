<script setup lang="ts">
import { computed } from 'vue'
import { useHouseStore } from '../../stores/house'

// Dimensions d'une pièce (mode édition) : ses COTES, côté par côté. Chaque longueur se tape — le
// mur suivant recule ou avance — et la 3D montre les mêmes côtés, qu'on pousse au doigt (poignée au
// milieu d'un mur) ou dont on déplace un sommet. Tout passe par le brouillon de la séance : rien
// n'est écrit avant « Valider ». La ligne d'actions est toujours là : ses boutons se grisent selon
// ce qui est choisi, ils n'apparaissent pas.
const props = defineProps<{ roomId: string }>()
const house = useHouseStore()

const shape = computed(() => house.shapeOf(props.roomId) ?? [])
const sides = computed(() => shape.value.map((a, k) => {
  const b = shape.value[(k + 1) % shape.value.length]!
  return { k, length: Math.hypot(b[0] - a[0], b[1] - a[1]) }
}))
/** Surface des cotes (au milieu des cloisons), pas la surface habitable. */
const area = computed(() => Math.abs(shape.value.reduce((s, a, i) => {
  const b = shape.value[(i + 1) % shape.value.length]!
  return s + a[0] * b[1] - a[1] * b[0]
}, 0)) / 2)

const sel = computed(() => house.shapeSelection)
const wallSel = computed(() => (sel.value && 'wall' in sel.value ? sel.value.wall : null))
const cornerSel = computed(() => (sel.value && 'corner' in sel.value ? sel.value.corner : null))

function setLength(k: number, ev: Event) {
  const input = ev.target as HTMLInputElement
  const v = Number(input.value.replace(',', '.'))
  if (!Number.isFinite(v) || v <= 0.05) { input.value = sides.value[k]!.length.toFixed(2); return }
  house.setSideLength(props.roomId, k, Math.round(v * 100) / 100)
}
function addCorner() { if (wallSel.value !== null) { house.addCorner(props.roomId, wallSel.value); house.shapeSelection = { corner: wallSel.value + 1 } } }
function removeCorner() { if (cornerSel.value !== null) { house.removeCorner(props.roomId, cornerSel.value); house.shapeSelection = null } }
</script>

<template>
  <div class="rs">
    <label class="rs__couple">
      <input v-model="house.coupleWalls" type="checkbox" :disabled="house.savingEdit">
      <span>{{ $t('shape.couple') }}</span>
    </label>
    <p class="muted rs__hint">{{ $t('shape.hint') }}</p>

    <div class="rs__head">
      <span class="section-label">{{ $t('shape.sides') }}</span>
      <span class="muted rs__area">{{ $t('shape.area', { m2: area.toFixed(2) }) }}</span>
    </div>
    <div class="rs__list">
      <div v-for="s in sides" :key="s.k" class="rs__row" :data-on="wallSel === s.k ? '1' : '0'">
        <button type="button" class="rs__name" @click="house.shapeSelection = { wall: s.k }">{{ $t('shape.side', { n: s.k + 1 }) }}</button>
        <input class="rs__len" type="text" inputmode="decimal" :value="s.length.toFixed(2)" :disabled="house.savingEdit"
               :aria-label="`${$t('shape.side', { n: s.k + 1 })} — ${$t('shape.length')}`"
               @focus="house.shapeSelection = { wall: s.k }" @change="setLength(s.k, $event)" @keydown.enter="($event.target as HTMLInputElement).blur()">
        <span class="muted rs__unit">m</span>
      </div>
    </div>

    <div class="rs__actions">
      <button type="button" class="pill rs__btn" :disabled="wallSel === null || house.savingEdit" @click="addCorner()">{{ $t('shape.addCorner') }}</button>
      <button type="button" class="pill rs__btn" :disabled="cornerSel === null || shape.length <= 3 || house.savingEdit" @click="removeCorner()">{{ $t('shape.removeCorner') }}</button>
    </div>
  </div>
</template>

<style scoped>
.rs { display: grid; gap: 10px; min-width: 0; }
.rs__couple { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.rs__couple input { accent-color: var(--accent); width: 16px; height: 16px; }
.rs__hint { margin: 0; font-size: 12px; }
.rs__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.rs__area { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rs__list { display: grid; gap: 4px; }
.rs__row {
  display: grid; grid-template-columns: 1fr 76px auto; align-items: center; gap: 8px;
  padding: 4px 8px; border-radius: 10px; background: var(--surface2); border: 1px solid transparent;
}
.rs__row[data-on='1'] { border-color: var(--accent); }
.rs__name { border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; padding: 4px 0; cursor: pointer; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs__len {
  width: 76px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
  color: var(--text); font: inherit; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums;
}
.rs__len:focus { outline: none; border-color: var(--accent); }
.rs__unit { font-size: 12px; }
.rs__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rs__btn { justify-content: center; min-width: 0; font-size: 13px; white-space: normal; line-height: 1.2; text-align: center; }
</style>
