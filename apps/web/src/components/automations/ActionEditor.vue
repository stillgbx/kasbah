<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { commandKind, COVER_CLASSES, inverseCommand, MEDIA_PLAYER_CLASSES, type DeviceKind, type SceneRecallMode, type Target } from '@kasbah/shared'
import { useAutomationNames } from '../../composables/useAutomationNames'
import { choiceOf, choicesFor, COMMANDABLE_KINDS, kindLabel, paramOf, type ActionDraft, type CommandChoice } from '../../lib/automations'
import { useDevicesStore } from '../../stores/devices'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Une action, dans une petite carte. Une commande vise des appareils NOMMÉS, ou une SÉLECTION
// résolue au moment d'agir (« tous les volets du rez-de-chaussée ») — une lampe ajoutée demain y
// entre sans rien réécrire. Les commandes proposées sont celles que les appareils visés déclarent.
// « Pendant N min » : au bout, le serveur envoie la commande inverse — offert seulement quand elle
// en a une (ouvrir ↔ fermer, allumer ↔ éteindre…).
const props = defineProps<{ modelValue: ActionDraft }>()
const emit = defineEmits<{ 'update:modelValue': [value: ActionDraft]; remove: [] }>()
const devices = useDevicesStore()
const { names, deviceOptions, scopeOptions, sceneOptions } = useAutomationNames()
const { t } = useI18n()

const a = computed(() => props.modelValue)

// ── commande ─────────────────────────────────────────────────────────────────────────────────
const kind = computed<DeviceKind>(() => {
  const x = a.value
  if (x.type !== 'command') return 'light'
  if (x.target.type === 'selector') return x.target.kind
  return choiceOf(x.command)?.kind ?? commandKind(x.command as never) as DeviceKind
})
const target = computed<Target | null>(() => (a.value.type === 'command' ? a.value.target : null))
const selected = computed(() => (target.value?.type === 'devices' ? target.value.deviceIds : []))

/** Commandes que TOUS les appareils nommés déclarent (une sélection se contente du kind). */
const choices = computed<CommandChoice[]>(() => choicesFor(kind.value).filter((c) =>
  selected.value.every((id) => devices.descriptors[id]?.capabilities.includes(c.requires) ?? true)))
const choice = computed(() => (a.value.type === 'command' ? choiceOf(a.value.command) : undefined))

function setCommand(x: Partial<Extract<ActionDraft, { type: 'command' }>>) {
  if (a.value.type !== 'command') return
  const next = { ...a.value, ...x }
  if (next.forMin && !inverseCommand(next.command)) delete next.forMin   // la nouvelle commande n'a pas d'inverse
  emit('update:modelValue', next)
}
const hasInverse = computed(() => a.value.type === 'command' && !!inverseCommand(a.value.command))
const forMin = computed(() => (a.value.type === 'command' ? a.value.forMin : undefined))
function setForMin(n: number | undefined) {
  if (a.value.type !== 'command') return
  const { forMin: _, ...rest } = a.value
  emit('update:modelValue', n ? { ...rest, forMin: n } : rest)
}
function setForMinText(raw: string) {
  const n = Number(raw.replace(',', '.'))
  if (Number.isFinite(n)) setForMin(Math.min(1440, Math.max(1, Math.round(n))))
}
function setKind(k: DeviceKind) {
  const first = choicesFor(k)[0]
  const t0 = target.value
  setCommand({
    target: t0?.type === 'selector' ? { type: 'selector', kind: k } : { type: 'devices', deviceIds: [] },
    ...(first ? { command: first.build() } : {}),
  })
}
function setMode(mode: 'devices' | 'selector') {
  setCommand({ target: mode === 'selector' ? { type: 'selector', kind: kind.value } : { type: 'devices', deviceIds: [] } })
}
function setTarget(patch: Record<string, unknown>) {
  if (!target.value) return
  const next = { ...target.value, ...patch } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k]
  setCommand({ target: next as Target })
}
function addDevice(id: string | null) {
  if (id && !selected.value.includes(id)) setTarget({ deviceIds: [...selected.value, id] })
}
function removeDevice(id: string) {
  setCommand({ target: { type: 'devices', deviceIds: selected.value.filter((x) => x !== id) } })
}
function pickChoice(key: string) {
  const c = choicesFor(kind.value).find((x) => x.key === key)
  if (c) setCommand({ command: c.build() })
}
function setParam(raw: string) {
  const c = choice.value
  if (!c?.param) return
  if (c.param.type === 'url' || c.param.type === 'enum') return setCommand({ command: c.build(raw) })
  const n = Number(raw.replace(',', '.'))
  if (Number.isFinite(n)) setCommand({ command: c.build(c.param.type === 'pct' ? Math.min(100, Math.max(0, Math.round(n))) : n) })
}

const kindItems = computed(() => COMMANDABLE_KINDS.map((k) => ({ value: k, title: t(`kinds.${k}`) })))
const addItems = computed(() => deviceOptions([kind.value]).filter((o) => !selected.value.includes(o.value)))
const choiceItems = computed(() => choices.value.map((c) => ({ value: c.key, title: t(`automations.command.${c.key}`, { n: '…' }) })))
const classValues = computed(() => (kind.value === 'cover' ? COVER_CLASSES : kind.value === 'media_player' ? MEDIA_PLAYER_CLASSES : []))
const classItems = computed(() => [{ value: '', title: t('automations.anyClass') }, ...classValues.value.map((v) => ({ value: v, title: kindLabel(kind.value, v, t) }))])
const scope = computed<string[]>(() => {
  const x = target.value
  if (x?.type !== 'selector') return []
  return [...(x.levelIds ?? []).map((id) => `level:${id}`), ...(x.roomIds ?? []).map((id) => `room:${id}`), ...(x.zoneIds ?? []).map((id) => `zone:${id}`)]
})
function setScope(values: string[]) {
  const of = (prefix: string) => values.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length))
  setTarget({ levelIds: of('level:'), roomIds: of('room:'), zoneIds: of('zone:') })
}
const exceptOn = computed(() => target.value?.type === 'selector' && !!target.value.exceptRoomsWith)
const exceptKind = computed(() => (target.value?.type === 'selector' ? target.value.exceptRoomsWith : undefined))
const EXCEPT_ITEMS = computed(() => [
  { value: 'media_player:tv', title: t('media.classes.tv') },
  { value: 'media_player:', title: t('kinds.media_player') },
  { value: 'light:', title: t('kinds.light') },
])
const exceptValue = computed(() => (exceptKind.value ? `${exceptKind.value.kind}:${exceptKind.value.deviceClass ?? ''}` : 'media_player:tv'))
function setExcept(v: string | null) {
  if (!v) return setTarget({ exceptRoomsWith: undefined })
  const [k, cls] = v.split(':') as [DeviceKind, string]
  setTarget({ exceptRoomsWith: cls ? { kind: k, deviceClass: cls } : { kind: k } })
}
const climateItems = computed(() => (choice.value?.param?.type === 'enum' ? choice.value.param.values.map((v) => ({ value: v, title: t(`climate.modes.${v}`) })) : []))

// ── ambiance ─────────────────────────────────────────────────────────────────────────────────
const recallModes = computed(() => (['static', 'dynamic', 'off'] as const).map((m) => ({ value: m, label: t(`automations.recall.${m}`) })))
</script>

<template>
  <div class="act">
    <div class="act__head">
      <span class="act__type">{{ $t(`automations.action.${a.type}`) }}</span>
      <button type="button" class="key" :title="$t('automations.editor.removeRow')" :aria-label="$t('automations.editor.removeRow')" @click="emit('remove')">
        <StrokeIcon name="trash" :size="15" />
      </button>
    </div>

    <template v-if="a.type === 'command' && target">
      <v-select :model-value="kind" :items="kindItems" :label="$t('automations.editor.kind')" density="compact" variant="outlined" hide-details @update:model-value="setKind" />
      <Segmented dense fill :model-value="target.type" :label="$t('automations.editor.target')"
                 :options="[{ value: 'devices', label: $t('automations.target.devices') }, { value: 'selector', label: $t('automations.target.selector') }]"
                 @update:model-value="setMode" />

      <template v-if="target.type === 'devices'">
        <div v-if="selected.length" class="act__chips">
          <span v-for="id in selected" :key="id" class="act__chip" :data-missing="devices.descriptors[id] ? '0' : '1'">
            <span class="act__chip-name">{{ names.deviceName(id) }}</span>
            <button type="button" class="act__chip-x" :aria-label="$t('automations.editor.removeDevice', { name: names.deviceName(id) })" @click="removeDevice(id)">
              <StrokeIcon name="close" :size="12" />
            </button>
          </span>
        </div>
        <v-select :model-value="null" :items="addItems" :label="$t('automations.editor.addDevice')" :no-data-text="$t('automations.editor.noDevice')"
                  density="compact" variant="outlined" hide-details @update:model-value="addDevice" />
      </template>

      <template v-else>
        <v-select v-if="classValues.length" :model-value="target.deviceClass ?? ''" :items="classItems" :label="$t('automations.editor.class')"
                  density="compact" variant="outlined" hide-details @update:model-value="(v: string) => setTarget({ deviceClass: v || undefined })" />
        <v-select :model-value="scope" :items="scopeOptions" multiple chips closable-chips :label="$t('automations.editor.scope')"
                  :placeholder="$t('automations.summary.wholeHouse')" persistent-placeholder
                  density="compact" variant="outlined" hide-details @update:model-value="setScope" />
        <div class="act__except">
          <button type="button" class="act__toggle" :data-on="exceptOn ? '1' : '0'" :aria-pressed="exceptOn"
                  @click="setExcept(exceptOn ? null : exceptValue)">{{ $t('automations.target.except') }}</button>
          <!-- place réservée : la liste n'apparaît pas en poussant ce qui suit -->
          <v-select class="act__except-kind" :style="{ visibility: exceptOn ? 'visible' : 'hidden' }" :model-value="exceptValue" :items="EXCEPT_ITEMS"
                    density="compact" variant="outlined" hide-details :aria-label="$t('automations.target.except')" @update:model-value="setExcept" />
        </div>
      </template>

      <v-select :model-value="choice?.key ?? null" :items="choiceItems" :label="$t('automations.editor.command')" density="compact" variant="outlined" hide-details @update:model-value="pickChoice" />
      <!-- paramètre : place toujours là, vide pour une commande qui n'en a pas -->
      <div class="act__param">
        <template v-if="choice?.param?.type === 'pct' || choice?.param?.type === 'number'">
          <input class="act__input act__input--num" type="text" inputmode="decimal" enterkeyhint="done" :value="String(paramOf(a.command) ?? '')"
                 :aria-label="$t('automations.editor.param')" @change="setParam(($event.target as HTMLInputElement).value)">
          <span class="muted">{{ choice.param.type === 'pct' ? '%' : choice.param.unit }}</span>
        </template>
        <input v-else-if="choice?.param?.type === 'url'" class="act__input" type="url" inputmode="url" :placeholder="$t('automations.editor.urlPlaceholder')"
               :value="String(paramOf(a.command) ?? '')" :aria-label="$t('automations.editor.url')" @change="setParam(($event.target as HTMLInputElement).value)">
        <v-select v-else-if="choice?.param?.type === 'enum'" class="act__grow" :model-value="paramOf(a.command)" :items="climateItems"
                  density="compact" variant="outlined" hide-details :aria-label="$t('automations.editor.param')" @update:model-value="(v: string | number) => setParam(String(v))" />
      </div>
      <!-- « pendant N min » : place toujours là, éteinte pour une commande sans inverse -->
      <div class="act__for" :title="hasInverse ? $t('automations.editor.forMinHint') : $t('automations.editor.noInverse')">
        <button type="button" class="act__toggle" :disabled="!hasInverse" :data-on="forMin ? '1' : '0'" :aria-pressed="!!forMin"
                @click="setForMin(forMin ? undefined : 20)">{{ $t('automations.editor.forMin') }}</button>
        <input class="act__input act__input--num" :style="{ visibility: forMin ? 'visible' : 'hidden' }" type="text" inputmode="numeric" enterkeyhint="done"
               :value="String(forMin ?? '')" :aria-label="$t('automations.editor.forMin')" @change="setForMinText(($event.target as HTMLInputElement).value)">
        <span class="muted" :style="{ visibility: forMin ? 'visible' : 'hidden' }">{{ $t('automations.editor.minutes') }}</span>
      </div>
    </template>

    <template v-else-if="a.type === 'recallScene'">
      <v-select :model-value="a.sceneId || null" :items="sceneOptions" :label="$t('automations.editor.scene')" :no-data-text="$t('automations.editor.noScene')"
                density="compact" variant="outlined" hide-details
                @update:model-value="(v: string) => emit('update:modelValue', { ...a, sceneId: v } as ActionDraft)" />
      <Segmented dense fill :model-value="a.recall.mode" :options="recallModes" :label="$t('automations.editor.recallMode')"
                 @update:model-value="(m: SceneRecallMode) => a.type === 'recallScene' && emit('update:modelValue', { ...a, recall: { ...a.recall, mode: m } })" />
    </template>
  </div>
</template>

<style scoped>
.act { display: grid; gap: 8px; padding: 10px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); min-width: 0; }
.act__head { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.act__type { flex: 1 1 0; min-width: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.act__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.act__chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%; height: 28px; padding: 0 4px 0 10px;
  border-radius: 999px; background: var(--surface2); font-size: 12px;
}
.act__chip[data-missing='1'] { color: #d38b22; }
.act__chip-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.act__chip-x { display: grid; place-items: center; width: 20px; height: 20px; border: 0; border-radius: 50%; background: transparent; color: var(--muted); }
.act__chip-x:hover { background: var(--line); color: var(--text); }
.act__except { display: flex; align-items: center; gap: 8px; min-width: 0; }
.act__toggle {
  flex: 0 0 auto; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line);
  background: transparent; color: var(--muted); font: 500 12px/1 var(--font);
}
.act__toggle[data-on='1'] { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.act__toggle:disabled { opacity: .45; }
.act__for { display: flex; align-items: center; gap: 8px; min-height: 36px; }
.act__except-kind { flex: 1 1 0; min-width: 0; }
.act__param { display: flex; align-items: center; gap: 6px; min-height: 36px; }
.act__grow { flex: 1 1 0; min-width: 0; }
.act__input {
  flex: 1 1 0; min-width: 0; height: 36px; box-sizing: border-box; padding: 0 8px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text); font: inherit; font-size: 14px;
}
.act__input--num { flex: 0 0 7ch; text-align: right; font-variant-numeric: tabular-nums; }
.key {
  flex: 0 0 auto; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--muted); transition: background .15s, color .15s;
}
.key:hover { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
</style>
