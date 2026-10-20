<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { isPlaced, pointInPolygon, resolveDeviceLevelId, type Vec2 } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import Segmented from '../ui/Segmented.vue'
import type { HouseScene, ReliefEditState, TerrainTab, TerrainView } from '../../three/HouseScene'
import { useHouseStore } from '../../stores/house'
import { useSettingsStore } from '../../stores/settings'
import { fetchIgnRelief, type IgnSource } from '../../lib/ignRelief'
import { fetchIgnParcel, IgnParcelError, type IgnParcel } from '../../lib/ignParcel'

// THE TERRAIN EDITOR (Settings → 3D rendering → "Shape the terrain", or "Edit the terrain
// outline" from the house setting). It floats over the House view like the light bench.
// Two tabs: the RELIEF (one pulls a point, the ground follows) and the OUTLINE (the shape of the parcel:
// vertices to drag, add, remove).
//
// Three exits, because shaping takes long: "Save" writes without leaving (we keep what we have
// and carry on), "Done" writes then leaves, "Cancel" leaves going back to the last saved
// terrain. The land registry import, like the IGN one, replaces the outline's DRAFT only.
// Save writes what changed in both tabs, the outline first (the server then enlarges
// the relief if it no longer covers it). The IGN import replaces the DRAFT only.

const props = defineProps<{ scene: () => HouseScene | null; state: ReliefEditState | null }>()
const settings = useSettingsStore()
const house = useHouseStore()
const { t } = useI18n()

const tab = computed(() => settings.terrainTab)
const TABS = computed(() => (['relief', 'outline'] as const).map((value) => ({ value, label: t(`relief.tabs.${value}`) })))
const outline = computed(() => props.state?.outline ?? null)

/** Whether the relief draft differs from what the house carries. */
const reliefDirty = computed(() => JSON.stringify(props.state?.draft ?? null) !== JSON.stringify(house.house?.site.relief ?? null))
/** Whether the outline draft differs from what the house carries. */
const outlineDirty = computed(() => !!outline.value && JSON.stringify(outline.value.draft) !== JSON.stringify(house.house?.site.terrain ?? null))
/** Whether "Save" has anything to write. */
const dirty = computed(() => reliefDirty.value || outlineDirty.value)
/** Height of the chosen point (m, relative to the house's terrain), as the field displays it. */
const pointM = computed(() => {
  const cm = props.state?.pointCm
  return cm === null || cm === undefined ? '' : (cm / 100).toFixed(2)
})
/** Position of the chosen vertex (m), as the fields display it. */
const vertexM = computed(() => {
  const p = outline.value?.point
  return p ? [p[0].toFixed(2), p[1].toFixed(2)] as const : ['', ''] as const
})
// A point chosen with the MOUSE (or stylus) hands over to the field, value selected: one types the
// height and Enter, then clicks the next point — in series, without going to look for the field. With a
// FINGER, no: the virtual keyboard would open on each tap and cover the scene.
const pointInput = ref<HTMLInputElement | null>(null)
const vertexInput = ref<HTMLInputElement | null>(null)
async function focusOnPick(pick: { by: string } | undefined, input: () => HTMLInputElement | null, chosen: boolean) {
  if (!pick || pick.by === 'touch') return
  await nextTick()                               // the field may have just left its grayed-out state
  const el = input()
  if (!el) return
  if (!chosen) { el.blur(); return }
  el.focus({ preventScroll: true })
  el.select()
}
watch(() => props.state?.pick.seq, () => { void focusOnPick(props.state?.pick, () => pointInput.value, props.state?.pointCm != null) })
watch(() => outline.value?.pick.seq, () => { void focusOnPick(outline.value?.pick, () => vertexInput.value, !!outline.value?.point) })

/** Validated input (Enter, leaving the field, arrows): the point takes the typed height, to the centimeter. */
function setPoint(e: Event) { commit(e.target as HTMLInputElement) }
function commit(input: HTMLInputElement) {
  if (input.value === pointM.value) return
  const v = Number(input.value.replace(',', '.'))
  if (input.value.trim() === '' || !Number.isFinite(v)) { input.value = pointM.value; return }
  props.scene()?.setReliefPoint(Math.round(Math.max(-50, Math.min(50, v)) * 100))
}
/** Input of a coordinate of the chosen vertex; refused (outline that crosses itself), the field takes back the kept value. */
function setVertex(axis: 0 | 1, e: Event) {
  const input = e.target as HTMLInputElement
  const p = outline.value?.point
  if (!p || input.value === vertexM.value[axis]) return
  const v = Number(input.value.replace(',', '.'))
  if (input.value.trim() === '' || !Number.isFinite(v)) { input.value = vertexM.value[axis]; return }
  const next: Vec2 = [p[0], p[1]]
  next[axis] = v
  props.scene()?.setOutlinePoint(next)
  void nextTick(() => { input.value = vertexM.value[axis] })
}
function resetField(e: KeyboardEvent, value: string) {
  const input = e.target as HTMLInputElement
  input.value = value
  input.blur()
}

const VIEWS: readonly TerrainView[] = ['north', 'east', 'south', 'west', 'top']

const saving = ref(false)
const saved = ref(false)
async function save(): Promise<boolean> {
  if (!dirty.value) return true
  saving.value = true
  let ok = true
  if (outlineDirty.value && outline.value) ok = await house.saveTerrain(outline.value.draft)
  // reread AFTER the outline: the server may have enlarged the relief as the draft did
  if (ok && reliefDirty.value) ok = await house.saveRelief(props.state?.draft ?? null)
  saving.value = false
  if (ok) { saved.value = true; cadastre.value = null; setTimeout(() => { saved.value = false }, 1500) }
  return ok
}
function undo() { if (tab.value === 'outline') props.scene()?.undoOutline(); else props.scene()?.undoRelief() }
function redo() { if (tab.value === 'outline') props.scene()?.redoOutline(); else props.scene()?.redoRelief() }
const canUndo = computed(() => (tab.value === 'outline' ? outline.value?.canUndo : props.state?.canUndo) ?? false)
const canRedo = computed(() => (tab.value === 'outline' ? outline.value?.canRedo : props.state?.canRedo) ?? false)

// Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) — except in an input field, which keeps its own undo
// The field has just been armed by a click (value selected, nothing typed): Ctrl+Z still undoes the
// TERRAIN there. As soon as one types, it gets its own undo back.
// The ARROWS move to the neighboring relief point (in the screen's direction), including from the
// field: what was typed there is validated first, then the field takes over again on the new point.
// Del (outside a field) removes the chosen vertex from the outline.
const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  // Chrome's autofill emits `keydown` events without `key` (`undefined`, despite the type)
  if (typeof e.key !== 'string') return
  const field = e.target instanceof Element ? e.target.closest('input, textarea') : null
  const arrow = ARROWS[e.key]
  if (tab.value === 'relief' && arrow && !e.ctrlKey && !e.metaKey && !e.altKey && props.state?.pointCm != null && (!field || field === pointInput.value)) {
    e.preventDefault()
    if (field) commit(field as HTMLInputElement)
    props.scene()?.stepReliefSelection(arrow[0], arrow[1])
    return
  }
  if (tab.value === 'outline' && !field && (e.key === 'Delete' || e.key === 'Backspace') && outline.value?.canRemove) {
    e.preventDefault()
    props.scene()?.removeOutlinePoint()
    return
  }
  const armed = tab.value === 'outline' ? vertexInput.value : pointInput.value
  const untouched = field === armed && armed?.value === (tab.value === 'outline' ? vertexM.value[0] : pointM.value)
  if (!(e.ctrlKey || e.metaKey) || (field && !untouched)) return
  const key = e.key.toLowerCase()
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
  else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
})

async function finish() { if (await save()) settings.setReliefEditing(false) }
function cancel() { settings.setReliefEditing(false) }

const ign = ref<{ kind: 'loading' } | { kind: 'done'; source: IgnSource } | { kind: 'error'; message: string } | null>(null)
async function importIgn() {
  const h = house.house
  if (!h || ign.value?.kind === 'loading') return
  ign.value = { kind: 'loading' }
  try {
    const { relief, source } = await fetchIgnRelief(h, 2)
    props.scene()?.setReliefDraft(relief)
    ign.value = { kind: 'done', source }
  } catch (err) {
    ign.value = { kind: 'error', message: (err as Error).message }
  }
}
const ignText = computed(() => {
  const s = ign.value
  if (!s) return ''
  if (s.kind === 'loading') return t('relief.ignLoading')
  if (s.kind === 'done') return t(`relief.ignDone.${s.source}`)
  return t('relief.ignError', { message: s.message })
})

/** A point is OUTSIDE if it is neither in the polygon nor on its edge (to within 5 cm: a zone that
 *  shares a corner with the terrain is not outside). */
function outside(p: readonly number[], poly: readonly Vec2[]): boolean {
  const x = p[0]!, y = p[1]!
  if (pointInPolygon([x, y], poly)) return false
  for (let k = 0; k < poly.length; k++) {
    const [ax, ay] = poly[k]!, [bx, by] = poly[(k + 1) % poly.length]!
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= 0.05) return false
  }
  return true
}

/**
 * What the new outline puts OUTSIDE — and that was inside: nothing is removed, we only say
 * so. A garden item, a ground spot or an outdoor device by its point; a
 * zone or the house as soon as one of their vertices goes out.
 */
const outsideText = computed(() => {
  const h = house.house, poly = outline.value?.draft
  if (!h || !poly || !outlineDirty.value) return ''
  const saved = h.site.terrain
  const pushed = (p: readonly number[]) => outside(p, poly) && !outside(p, saved)
  const roomsById = new Map(h.rooms.map((r) => [r.id, r]))
  const counts = {
    garden: h.site.garden.filter((g) => pushed(g.center)).length,
    parking: h.site.parkings.filter((p) => !p.levelId && pushed(p.center)).length,
    zone: h.site.zones.filter((z) => z.polygon.some(pushed)).length,
    device: h.devices.filter((d) => isPlaced(d) && !resolveDeviceLevelId(d, roomsById) && pushed(d.position)).length,
  }
  const parts = (Object.keys(counts) as (keyof typeof counts)[]).filter((k) => counts[k] > 0).map((k) => t(`relief.outline.count.${k}`, counts[k]))
  if (h.rooms.some((r) => r.polygon.some(pushed))) parts.push(t('relief.outline.house'))
  return parts.length ? t('relief.outline.outside', { list: parts.join(', ') }) : ''
})
/**
 * Import of the cadastral outline: it replaces the draft (one history step). The message says which
 * parcel is loaded as long as the draft IS that of the import; an edit or a Save clears it.
 */
const cadastre = ref<{ kind: 'loading' } | { kind: 'done'; parcels: IgnParcel[]; merged: boolean; key: string } | { kind: 'error'; message: string; code?: 'none' | 'shape' } | null>(null)
async function importCadastre() {
  const h = house.house
  if (!h || cadastre.value?.kind === 'loading') return
  cadastre.value = { kind: 'loading' }
  try {
    const { polygon, parcels, merged } = await fetchIgnParcel(h)
    props.scene()?.setOutlineDraft(polygon)
    cadastre.value = { kind: 'done', parcels, merged, key: JSON.stringify(polygon) }
  } catch (err) {
    cadastre.value = { kind: 'error', message: (err as Error).message, ...(err instanceof IgnParcelError ? { code: err.code } : {}) }
  }
}
watch(() => JSON.stringify(outline.value?.draft ?? null), (k) => {
  const c = cadastre.value
  if (c?.kind === 'done' && c.key !== k) cadastre.value = null
})
const parcelName = (p: IgnParcel) => `${p.section} ${Number(p.numero) || p.numero}`
const cadastreText = computed(() => {
  const c = cadastre.value
  if (!c) return ''
  if (c.kind === 'loading') return t('relief.outline.cadastreLoading')
  if (c.kind === 'error') return c.code ? t(`relief.outline.cadastreFail.${c.code}`) : t('relief.outline.cadastreError', { message: c.message })
  const m2 = c.parcels.reduce((sum, p) => sum + (p.contenance ?? 0), 0)
  const area = m2 ? `${m2.toLocaleString(settings.resolvedLocale)} m²` : '—'
  if (!c.merged) return t('relief.outline.cadastrePartial', { name: parcelName(c.parcels[0]!), area })
  if (c.parcels.length > 1) return t('relief.outline.cadastreMerged', { names: c.parcels.map(parcelName).join(', '), area })
  return t('relief.outline.cadastreDone', { name: parcelName(c.parcels[0]!), area })
})

const outlineStatus = computed(() => [cadastreText.value, outsideText.value].filter(Boolean).join(' ')
  || (outline.value ? t('relief.outline.points', outline.value.draft.length) : ''))

function setTab(v: TerrainTab) { settings.setTerrainTab(v) }
</script>

<template>
  <section class="relief" :aria-label="t('relief.title')">
    <header class="relief__head">
      <div class="relief__title">{{ t('relief.title') }}</div>
      <!-- always there, grayed out when there is nothing to undo or redo: the header does not move -->
      <button type="button" class="relief__close" :disabled="!canUndo" :title="t('relief.undo')" :aria-label="t('relief.undo')" @click="undo()">
        <StrokeIcon name="undo" :size="16" />
      </button>
      <button type="button" class="relief__close" :disabled="!canRedo" :title="t('relief.redo')" :aria-label="t('relief.redo')" @click="redo()">
        <StrokeIcon name="redo" :size="16" />
      </button>
      <button type="button" class="relief__close" :aria-label="t('common.close')" @click="cancel()">
        <StrokeIcon name="close" :size="16" />
      </button>
    </header>

    <div class="relief__tabs">
      <Segmented :model-value="tab" :options="TABS" dense fill :label="t('relief.tabs.label')" @update:model-value="setTab" />
    </div>

    <!-- the two tabs in the SAME cell, the inactive one hidden without leaving the flow: the panel keeps
         the height of the larger one, nothing moves when switching tabs -->
    <div class="relief__stack">
      <div class="relief__body" :data-on="tab === 'relief' ? '1' : '0'" :inert="tab !== 'relief'">
        <div class="muted small">{{ t('relief.help') }}</div>
        <div class="row">
          <label class="row__label" for="relief-point">{{ t('relief.point') }}</label>
          <!-- always there, grayed out with no point chosen: the panel does not change shape on selection -->
          <div class="point">
            <input id="relief-point" ref="pointInput" class="point__input" type="number" step="0.05" inputmode="decimal"
                   :value="pointM" :disabled="state?.pointCm === null || state?.pointCm === undefined" :placeholder="t('relief.none')"
                   @change="setPoint" @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="(e: KeyboardEvent) => resetField(e, pointM)">
            <span class="point__unit">m</span>
          </div>
        </div>
        <!-- resetting to zero goes through the history: Ctrl+Z undoes it, no confirmation to ask for -->
        <div class="relief__actions">
          <button type="button" class="chip chip--wide" :disabled="ign?.kind === 'loading'" @click="importIgn()">{{ t('relief.ign') }}</button>
          <button type="button" class="chip chip--wide" :disabled="!state?.draft" @click="scene()?.setReliefDraft(null)">{{ t('relief.reset') }}</button>
        </div>
        <div class="relief__group">{{ t('relief.view') }}</div>
        <div class="relief__actions">
          <button v-for="v in VIEWS" :key="v" type="button" class="chip chip--wide" :title="t(`relief.views.${v}.hint`)"
                  @click="scene()?.viewTerrainFrom(v)">{{ t(`relief.views.${v}.short`) }}</button>
        </div>
        <!-- a reserved line: the import message pushes nothing aside when it appears -->
        <div class="relief__status muted small" :data-error="ign?.kind === 'error' ? '1' : '0'">{{ ignText }}</div>
      </div>

      <div class="relief__body" :data-on="tab === 'outline' ? '1' : '0'" :inert="tab !== 'outline'">
        <div class="muted small">{{ t('relief.outline.help') }}</div>
        <div class="row row--xy">
          <span class="row__label">{{ t('relief.outline.point') }}</span>
          <!-- always there, grayed out with no vertex chosen -->
          <div class="point">
            <input ref="vertexInput" class="point__input point__input--xy" type="number" step="0.1" inputmode="decimal" aria-label="X"
                   :value="vertexM[0]" :disabled="!outline?.point" placeholder="x"
                   @change="(e: Event) => setVertex(0, e)" @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="(e: KeyboardEvent) => resetField(e, vertexM[0])">
            <input class="point__input point__input--xy" type="number" step="0.1" inputmode="decimal" aria-label="Y"
                   :value="vertexM[1]" :disabled="!outline?.point" placeholder="y"
                   @change="(e: Event) => setVertex(1, e)" @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="(e: KeyboardEvent) => resetField(e, vertexM[1])">
            <span class="point__unit">m</span>
          </div>
        </div>
        <div class="relief__actions">
          <button type="button" class="chip chip--wide" :disabled="cadastre?.kind === 'loading'" @click="importCadastre()">{{ t('relief.outline.cadastre') }}</button>
          <button type="button" class="chip chip--wide" :disabled="!outline?.canRemove" :title="t('relief.outline.removeHint')"
                  @click="scene()?.removeOutlinePoint()">{{ t('relief.outline.remove') }}</button>
        </div>
        <div class="relief__group">{{ t('relief.view') }}</div>
        <div class="relief__actions">
          <button v-for="v in VIEWS" :key="v" type="button" class="chip chip--wide" :title="t(`relief.views.${v}.hint`)"
                  @click="scene()?.viewTerrainFrom(v)">{{ t(`relief.views.${v}.short`) }}</button>
        </div>
        <!-- three reserved lines: the warning pushes nothing aside when it appears -->
        <div class="relief__status relief__status--tall muted small" :data-error="cadastre?.kind === 'error' ? '1' : '0'" :title="outlineStatus">
          <template v-if="cadastreText || outsideText">{{ cadastreText }} <span class="relief__warn">{{ outsideText }}</span></template>
          <template v-else>{{ outlineStatus }}</template>
        </div>
      </div>
    </div>

    <footer class="relief__foot">
      <button type="button" class="chip" @click="cancel()">{{ t('relief.cancel') }}</button>
      <button type="button" class="chip chip--go" :disabled="!dirty || saving" @click="save()">
        {{ saved ? t('relief.saved') : t('relief.save') }}
      </button>
      <button type="button" class="chip chip--go" :disabled="saving" @click="finish()">{{ t('relief.finish') }}</button>
    </footer>
  </section>
</template>

<style scoped>
/* Same place and same layout as the light bench: sticks to the rail, leaves the house in the center.
   Fixed width and fixed value cells: nothing moves when a number changes. */
.relief {
  position: absolute; left: calc(var(--rail-w) + 12px); top: 96px; z-index: 4;
  width: 300px;
  /* a low (or zoomed) window keeps the header and the exit buttons: it is the body that scrolls */
  max-height: calc(100% - 96px - 12px);
  display: flex; flex-direction: column;
  border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--surface);
  box-shadow: var(--shadow);
}
.relief__head { display: flex; align-items: center; gap: 8px; padding: 10px 8px 6px 12px; border-bottom: 1px solid var(--line); }
.relief__title { flex: 1; font-weight: 600; font-size: 13px; }
.relief__close {
  display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 6px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.relief__close:hover:not(:disabled) { background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--text); }
.relief__close:disabled { opacity: .35; cursor: default; }
.relief__tabs { padding: 8px 12px 0; }
.relief__stack { display: grid; min-height: 0; overflow-y: auto; }
.relief__stack > .relief__body { grid-area: 1 / 1; }
.relief__body[data-on='0'] { visibility: hidden; }
.relief__body { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; }
.relief__status { min-height: 32px; line-height: 16px; }
.relief__status--tall {
  height: 48px; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3;
}
.relief__status[data-error='1'] { color: var(--danger, #e5484d); }
.relief__warn { color: var(--danger, #e5484d); }
.row { display: grid; grid-template-columns: 1fr 104px; align-items: center; gap: 6px; min-height: 28px; }
.row--xy { grid-template-columns: 1fr auto; }
.point { display: flex; align-items: center; gap: 4px; }
.point__input {
  width: 84px; height: 26px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--line);
  background: transparent; color: var(--text); text-align: right;
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums;
}
.point__input--xy { width: 76px; }
.point__input:focus { outline: none; border-color: var(--accent); }
.point__input:disabled { opacity: .5; }
.point__unit { font-size: 11px; color: var(--muted); }
.row__label { font-size: 11px; color: var(--muted); }
.chip {
  padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); background: transparent;
  color: var(--muted); font-size: 11px; cursor: pointer;
}
.relief__actions { display: flex; gap: 6px; margin-top: 4px; }
.relief__group { margin-top: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.chip--wide { flex: 1; padding: 5px 8px; }
.chip:disabled { cursor: default; opacity: .6; }
.relief__foot { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line); }
.relief__foot .chip { flex: 1; text-align: center; padding: 5px 8px; }
.chip--go { border-color: var(--accent); color: var(--text); }
.chip--go:disabled { border-color: var(--line); color: var(--muted); }
</style>
