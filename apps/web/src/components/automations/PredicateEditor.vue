<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  COVER_CLASSES, MEDIA_PLAYER_CLASSES, PREDICATE_OPS, TRIGGER_FIELDS,
  type DeviceKind, type LeafPredicate, type Predicate, type PredicateOp, type TriggerField,
} from '@kasbah/shared'
import { useAutomationNames } from '../../composables/useAutomationNames'
import { blankPredicate, kindLabel, PREDICATE_TYPES } from '../../lib/automations'
import { useDevicesStore } from '../../stores/devices'
import StrokeIcon from '../ui/StrokeIcon.vue'
import AddMenu from './AddMenu.vue'
import DayPills from './DayPills.vue'

// A condition, in a small card: its nature at the top (with NOT and the trash can), its fields
// stacked below — the panel is only ~300 px wide, nothing fits side by side. An "Any of these"
// group contains simple conditions (a single level of OR, like the schema).
const props = defineProps<{ modelValue: Predicate; negatable?: boolean; removable?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Predicate]; remove: [] }>()
const devices = useDevicesStore()
const { deviceOptions, roomOptions, parkingOptions } = useAutomationNames()
const { t } = useI18n()

const p = computed(() => props.modelValue)
const set = (patch: Partial<Predicate>) => emit('update:modelValue', { ...p.value, ...patch } as Predicate)

const FIELD_KINDS = Object.keys(TRIGGER_FIELDS) as DeviceKind[]
const ACTIVE_KINDS: DeviceKind[] = ['light', 'cover', 'media_player', 'climate', 'vacuum', 'mower', 'ev_charger', 'vehicle', 'energy', 'pet_feeder', 'pet_fountain', 'fan']
const LOCATED_KINDS: DeviceKind[] = ['vehicle', 'mower']
const ROOM_KINDS: DeviceKind[] = ['light', 'media_player', 'fan', 'cover', 'climate']

// ── comparison of a field ─────────────────────────────────────────────────────────────────────
const deviceKind = computed<DeviceKind | undefined>(() => ('deviceId' in p.value ? devices.descriptors[p.value.deviceId]?.kind : undefined))
const fields = computed<readonly TriggerField[]>(() => (deviceKind.value ? TRIGGER_FIELDS[deviceKind.value] ?? [] : []))
const field = computed(() => (p.value.type === 'device' ? fields.value.find((f) => f.field === (p.value as { field: string }).field) : undefined))
const ops = computed<readonly PredicateOp[]>(() => (field.value?.type === 'number' ? PREDICATE_OPS : ['eq', 'ne']))

function defaultValue(f: TriggerField | undefined): string | number | boolean {
  if (!f || f.type === 'boolean') return true
  return f.type === 'enum' ? f.values?.[0] ?? '' : 0
}
function pickDevice(deviceId: string) {
  if (p.value.type !== 'device') return set({ deviceId } as Partial<Predicate>)
  const kind = devices.descriptors[deviceId]?.kind
  const first = kind ? TRIGGER_FIELDS[kind]?.[0] : undefined
  set({ deviceId, field: first?.field ?? '', op: 'eq', value: defaultValue(first) } as Partial<Predicate>)
}
function pickField(name: string) {
  const f = fields.value.find((x) => x.field === name)
  set({ field: name, op: 'eq', value: defaultValue(f) } as Partial<Predicate>)
}
const fieldItems = computed(() => fields.value.map((f) => ({ value: f.field, title: t(`automations.field.${f.field}`) })))
const opItems = computed(() => ops.value.map((o) => ({ value: o, title: t(`automations.op.${o}`) })))
const enumItems = computed(() => (field.value?.values ?? []).map((v) => ({ value: v, title: v })))

function setNumber(raw: string) {
  const n = Number(raw.replace(',', '.'))
  if (Number.isFinite(n)) set({ value: n } as Partial<Predicate>)
}

// ── room ─────────────────────────────────────────────────────────────────────────────────────
const roomKindItems = computed(() => ROOM_KINDS.map((k) => ({ value: k, title: t(`kinds.${k}`) })))
const classItems = computed(() => {
  if (p.value.type !== 'anyInRoom') return []
  const values = p.value.kind === 'cover' ? COVER_CLASSES : p.value.kind === 'media_player' ? MEDIA_PLAYER_CLASSES : []
  return [{ value: '', title: t('automations.anyClass') }, ...values.map((v) => ({ value: v, title: kindLabel(p.value.type === 'anyInRoom' ? p.value.kind : 'light', v, t) }))]
})
function setRoomKind(kind: DeviceKind) {
  if (p.value.type !== 'anyInRoom') return
  const { deviceClass: _drop, ...rest } = p.value
  emit('update:modelValue', { ...rest, kind })
}
function setClass(v: string) {
  if (p.value.type !== 'anyInRoom') return
  const { deviceClass: _drop, ...rest } = p.value
  emit('update:modelValue', v ? { ...rest, deviceClass: v as never } : rest)
}

// ── "Any of these" group ────────────────────────────────────────────────────────────────────
const leafTypes = computed(() => PREDICATE_TYPES.filter((x) => x !== 'any').map((x) => ({ value: x, title: t(`automations.predicate.${x}`) })))
function setChild(i: number, child: Predicate) {
  if (p.value.type !== 'any') return
  const of = [...p.value.of]
  of[i] = child as LeafPredicate
  set({ of } as Partial<Predicate>)
}
function addChild(type: Predicate['type']) {
  if (p.value.type !== 'any') return
  set({ of: [...p.value.of, blankPredicate(type) as LeafPredicate] } as Partial<Predicate>)
}
function removeChild(i: number) {
  if (p.value.type !== 'any') return
  set({ of: p.value.of.filter((_, k) => k !== i) } as Partial<Predicate>)
}
</script>

<template>
  <div class="pred">
    <div class="pred__head">
      <button v-if="negatable" type="button" class="pred__not" :data-on="p.not ? '1' : '0'" :aria-pressed="p.not === true"
              :title="$t('automations.predicate.notHint')" @click="set({ not: !p.not })">{{ $t('automations.predicate.notShort') }}</button>
      <span class="pred__type">{{ $t(`automations.predicate.${p.type}`) }}</span>
      <button v-if="removable" type="button" class="key" :title="$t('automations.editor.removeRow')" :aria-label="$t('automations.editor.removeRow')" @click="emit('remove')">
        <StrokeIcon name="trash" :size="15" />
      </button>
    </div>

    <template v-if="p.type === 'device'">
      <v-autocomplete :model-value="p.deviceId || null" :items="deviceOptions(FIELD_KINDS, p.deviceId)" :label="$t('automations.editor.device')"
                density="compact" variant="outlined" hide-details @update:model-value="pickDevice" />
      <div class="pred__line">
        <v-select class="pred__grow" :model-value="p.field || null" :items="fieldItems" :disabled="!fieldItems.length" :label="$t('automations.editor.field')"
                  density="compact" variant="outlined" hide-details @update:model-value="pickField" />
        <v-select class="pred__op" :model-value="p.op" :items="opItems" density="compact" variant="outlined" hide-details
                  :aria-label="$t('automations.editor.op')" @update:model-value="(v: PredicateOp) => set({ op: v })" />
      </div>
      <v-select v-if="field?.type === 'boolean'" :model-value="p.value" :items="[{ value: true, title: $t('automations.yes') }, { value: false, title: $t('automations.no') }]"
                density="compact" variant="outlined" hide-details :aria-label="$t('automations.editor.value')"
                @update:model-value="(v: string | number | boolean) => set({ value: v })" />
      <v-select v-else-if="field?.type === 'enum'" :model-value="p.value" :items="enumItems" density="compact" variant="outlined" hide-details
                :aria-label="$t('automations.editor.value')" @update:model-value="(v: string | number | boolean) => set({ value: v })" />
      <input v-else class="pred__num" type="text" inputmode="decimal" enterkeyhint="done" :value="String(p.value)"
             :aria-label="$t('automations.editor.value')" @change="setNumber(($event.target as HTMLInputElement).value)">
    </template>

    <v-autocomplete v-else-if="p.type === 'deviceOn'" :model-value="p.deviceId || null" :items="deviceOptions(ACTIVE_KINDS, p.deviceId)" :label="$t('automations.editor.device')"
              density="compact" variant="outlined" hide-details @update:model-value="pickDevice" />

    <v-autocomplete v-else-if="p.type === 'vehicleOnSite'" :model-value="p.deviceId || null" :items="deviceOptions(LOCATED_KINDS, p.deviceId)" :label="$t('automations.editor.vehicle')"
              density="compact" variant="outlined" hide-details @update:model-value="pickDevice" />

    <template v-else-if="p.type === 'vehicleParkedAt'">
      <v-autocomplete :model-value="p.deviceId || null" :items="deviceOptions(LOCATED_KINDS, p.deviceId)" :label="$t('automations.editor.vehicle')"
                density="compact" variant="outlined" hide-details @update:model-value="pickDevice" />
      <v-select :model-value="p.parkingId || null" :items="parkingOptions" :label="$t('automations.editor.parking')" :no-data-text="$t('automations.editor.noParking')"
                density="compact" variant="outlined" hide-details @update:model-value="(v: string) => set({ parkingId: v })" />
    </template>

    <template v-else-if="p.type === 'anyInRoom'">
      <v-autocomplete :model-value="p.roomId || null" :items="roomOptions" :label="$t('automations.editor.room')"
                density="compact" variant="outlined" hide-details @update:model-value="(v: string) => set({ roomId: v })" />
      <div class="pred__line">
        <v-select class="pred__grow" :model-value="p.kind" :items="roomKindItems" :label="$t('automations.editor.kind')"
                  density="compact" variant="outlined" hide-details @update:model-value="setRoomKind" />
        <v-select v-if="classItems.length" class="pred__grow" :model-value="p.deviceClass ?? ''" :items="classItems" :label="$t('automations.editor.class')"
                  density="compact" variant="outlined" hide-details @update:model-value="setClass" />
      </div>
    </template>

    <div v-else-if="p.type === 'timeWindow'" class="pred__line">
      <label class="pred__time"><span class="muted">{{ $t('automations.editor.from') }}</span>
        <input type="time" class="pred__input" :value="p.from" @change="set({ from: ($event.target as HTMLInputElement).value || p.from })"></label>
      <label class="pred__time"><span class="muted">{{ $t('automations.editor.to') }}</span>
        <input type="time" class="pred__input" :value="p.to" @change="set({ to: ($event.target as HTMLInputElement).value || p.to })"></label>
    </div>

    <DayPills v-else-if="p.type === 'days'" :model-value="p.days" @update:model-value="(d) => set({ days: d ?? [0, 1, 2, 3, 4, 5, 6] })" />

    <div v-else-if="p.type === 'dateRange'" class="pred__line">
      <label class="pred__time"><span class="muted">{{ $t('automations.editor.from') }}</span>
        <input type="date" class="pred__input" :value="p.from" @change="set({ from: ($event.target as HTMLInputElement).value || p.from })"></label>
      <label class="pred__time"><span class="muted">{{ $t('automations.editor.to') }}</span>
        <input type="date" class="pred__input" :value="p.to" @change="set({ to: ($event.target as HTMLInputElement).value || p.to })"></label>
    </div>

    <template v-else-if="p.type === 'any'">
      <PredicateEditor v-for="(child, i) in p.of" :key="i" class="pred__child" :model-value="child" negatable removable
                       @update:model-value="(c: Predicate) => setChild(i, c)" @remove="removeChild(i)" />
      <AddMenu :label="$t('automations.editor.addToGroup')" :items="leafTypes" @pick="addChild" />
    </template>
  </div>
</template>

<style scoped>
.pred { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 10px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); min-width: 0; }
.pred__head { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.pred__type { flex: 1 1 0; min-width: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* NOT: same box checked or not, readable at a glance */
.pred__not {
  flex: 0 0 auto; width: 44px; height: 26px; border-radius: 999px; border: 1px solid var(--line);
  background: transparent; color: var(--muted); font: 700 11px/1 var(--font); letter-spacing: .04em;
}
.pred__not[data-on='1'] { background: #d38b22; color: #fff; border-color: transparent; }
.pred__line { display: flex; gap: 8px; min-width: 0; }
.pred__grow { flex: 1 1 0; min-width: 0; }
.pred__op { flex: 0 0 76px; }
.pred__time { flex: 1 1 0; min-width: 0; display: grid; gap: 2px; font-size: 11px; }
.pred__input, .pred__num {
  width: 100%; min-width: 0; height: 36px; box-sizing: border-box; padding: 0 8px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text); font: inherit; font-size: 14px;
  font-variant-numeric: tabular-nums; color-scheme: light dark;
}
.pred__child { background: var(--surface2); border: 0; }
.key {
  flex: 0 0 auto; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--muted); transition: background .15s, color .15s;
}
.key:hover { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
</style>
