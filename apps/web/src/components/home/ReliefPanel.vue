<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { HouseScene, ReliefEditState, TerrainView } from '../../three/HouseScene'
import { useHouseStore } from '../../stores/house'
import { useSettingsStore } from '../../stores/settings'
import { fetchIgnRelief, type IgnSource } from '../../lib/ignRelief'

// L'ÉDITEUR DU RELIEF (Réglages → Rendu 3D → « Modeler le terrain »). Il flotte sur la vue Maison
// comme le banc de lumière : le terrain se modèle devant la maison, on tire un point, le sol suit.
//
// Trois sorties, parce que modeler est long : « Valider » écrit sans quitter (on garde ce qu'on a
// et on continue), « Terminer » écrit puis quitte, « Annuler » quitte en revenant au dernier relief
// validé. L'import IGN remplace le BROUILLON seulement — rien n'est écrit avant « Valider ».

const props = defineProps<{ scene: () => HouseScene | null; state: ReliefEditState | null }>()
const settings = useSettingsStore()
const house = useHouseStore()
const { t } = useI18n()

/** Le brouillon diffère-t-il de ce que la maison porte : « Valider » a-t-il quelque chose à écrire. */
const dirty = computed(() => JSON.stringify(props.state?.draft ?? null) !== JSON.stringify(house.house?.site.relief ?? null))
/** Hauteur du point choisi (m, par rapport au terrain de la maison), telle que le champ l'affiche. */
const pointM = computed(() => {
  const cm = props.state?.pointCm
  return cm === null || cm === undefined ? '' : (cm / 100).toFixed(2)
})
// Un point choisi à la SOURIS (ou au stylet) donne la main au champ, valeur sélectionnée : on tape la
// hauteur et Entrée, puis on clique le point suivant — en série, sans aller chercher le champ. Au
// DOIGT, non : le clavier virtuel s'ouvrirait à chaque tap et couvrirait la scène.
const pointInput = ref<HTMLInputElement | null>(null)
watch(() => props.state?.pick.seq, async () => {
  const s = props.state
  if (!s || s.pick.by === 'touch') return
  await nextTick()                               // le champ vient peut-être de sortir de son état grisé
  const input = pointInput.value
  if (!input) return
  if (s.pointCm === null) { input.blur(); return }
  input.focus({ preventScroll: true })
  input.select()
})

/** Saisie validée (Entrée, sortie du champ, flèches) : le point prend la hauteur tapée, au centimètre. */
function setPoint(e: Event) { commit(e.target as HTMLInputElement) }
function commit(input: HTMLInputElement) {
  if (input.value === pointM.value) return
  const v = Number(input.value.replace(',', '.'))
  if (input.value.trim() === '' || !Number.isFinite(v)) { input.value = pointM.value; return }
  props.scene()?.setReliefPoint(Math.round(Math.max(-50, Math.min(50, v)) * 100))
}

const VIEWS: readonly TerrainView[] = ['north', 'east', 'south', 'west', 'top']

const saving = ref(false)
const saved = ref(false)
async function save(): Promise<boolean> {
  if (!dirty.value) return true
  saving.value = true
  const ok = await house.saveRelief(props.state?.draft ?? null)
  saving.value = false
  if (ok) { saved.value = true; setTimeout(() => { saved.value = false }, 1500) }
  return ok
}
// Ctrl+Z / Ctrl+Y (ou Ctrl+Maj+Z) — sauf dans un champ de saisie, qui garde son annulation à lui
// Le champ vient d'être armé par un clic (valeur sélectionnée, rien tapé) : Ctrl+Z y annule encore le
// RELIEF. Dès qu'on tape, il retrouve son annulation à lui.
// Les FLÈCHES passent au point voisin (dans le sens de l'écran), y compris depuis le champ : ce qui
// y était tapé est d'abord validé, puis le champ reprend la main sur le nouveau point.
const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  const field = e.target instanceof Element ? e.target.closest('input, textarea') : null
  const arrow = ARROWS[e.key]
  if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey && props.state?.pointCm != null && (!field || field === pointInput.value)) {
    e.preventDefault()
    if (field) commit(field as HTMLInputElement)
    props.scene()?.stepReliefSelection(arrow[0], arrow[1])
    return
  }
  const untouched = field === pointInput.value && pointInput.value?.value === pointM.value
  if (!(e.ctrlKey || e.metaKey) || (field && !untouched)) return
  const key = e.key.toLowerCase()
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); props.scene()?.undoRelief() }
  else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); props.scene()?.redoRelief() }
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
</script>

<template>
  <section class="relief" :aria-label="t('relief.title')">
    <header class="relief__head">
      <div class="relief__title">{{ t('relief.title') }}</div>
      <!-- toujours là, grisés quand il n'y a rien à annuler ou rétablir : l'en-tête ne bouge pas -->
      <button type="button" class="relief__close" :disabled="!state?.canUndo" :title="t('relief.undo')" :aria-label="t('relief.undo')" @click="scene()?.undoRelief()">
        <StrokeIcon name="undo" :size="16" />
      </button>
      <button type="button" class="relief__close" :disabled="!state?.canRedo" :title="t('relief.redo')" :aria-label="t('relief.redo')" @click="scene()?.redoRelief()">
        <StrokeIcon name="redo" :size="16" />
      </button>
      <button type="button" class="relief__close" :aria-label="t('common.close')" @click="cancel()">
        <StrokeIcon name="close" :size="16" />
      </button>
    </header>

    <div class="relief__body">
      <div class="muted small">{{ t('relief.help') }}</div>
      <div class="row">
        <label class="row__label" for="relief-point">{{ t('relief.point') }}</label>
        <!-- toujours là, grisé sans point choisi : le panneau ne change pas de forme à la sélection -->
        <div class="point">
          <input id="relief-point" ref="pointInput" class="point__input" type="number" step="0.05" inputmode="decimal"
                 :value="pointM" :disabled="state?.pointCm === null || state?.pointCm === undefined" :placeholder="t('relief.none')"
                 @change="setPoint" @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="(e: KeyboardEvent) => { (e.target as HTMLInputElement).value = pointM; (e.target as HTMLInputElement).blur() }">
          <span class="point__unit">m</span>
        </div>
      </div>
      <!-- remettre à zéro passe par l'historique : Ctrl+Z la défait, aucune confirmation à demander -->
      <div class="relief__actions">
        <button type="button" class="chip chip--wide" :disabled="ign?.kind === 'loading'" @click="importIgn()">{{ t('relief.ign') }}</button>
        <button type="button" class="chip chip--wide" :disabled="!state?.draft" @click="scene()?.setReliefDraft(null)">{{ t('relief.reset') }}</button>
      </div>
      <div class="relief__group">{{ t('relief.view') }}</div>
      <div class="relief__actions">
        <button v-for="v in VIEWS" :key="v" type="button" class="chip chip--wide" :title="t(`relief.views.${v}.hint`)"
                @click="scene()?.viewTerrainFrom(v)">{{ t(`relief.views.${v}.short`) }}</button>
      </div>
      <!-- une ligne réservée : le message de l'import n'écarte rien en apparaissant -->
      <div class="relief__status muted small" :data-error="ign?.kind === 'error' ? '1' : '0'">{{ ignText }}</div>
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
/* Même place et même gabarit que le banc de lumière : colle au rail, laisse la maison au centre.
   Largeur fixe et cellules de valeur fixes : rien ne bouge quand un nombre change. */
.relief {
  position: absolute; left: calc(var(--rail-w) + 12px); top: 96px; z-index: 4;
  width: 300px;
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
.relief__body { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; }
.relief__status { min-height: 32px; line-height: 16px; }
.relief__status[data-error='1'] { color: var(--danger, #e5484d); }
.row { display: grid; grid-template-columns: 1fr 104px; align-items: center; gap: 6px; min-height: 28px; }
.point { display: flex; align-items: center; gap: 4px; }
.point__input {
  width: 84px; height: 26px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--line);
  background: transparent; color: var(--text); text-align: right;
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums;
}
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
