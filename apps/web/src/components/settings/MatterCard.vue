<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MatterSettingsPatch, MatterStatus } from '@kasbah/shared'
import { getTransport } from '../../api'
import { useNotificationsStore } from '../../stores/notifications'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// The Matter bridge in Settings: its switch, the pairing code while no assistant holds it, and the
// devices to publish, grouped by plugin. The pairing box keeps its size in every state (code,
// paired, off): turning the bridge on does not push the list down.

const { t } = useI18n()
const notifications = useNotificationsStore()
const status = ref<MatterStatus | null>(null)
const busy = ref(false)

// the transport already words the known refusals (a demo house is read-only)
const fail = (err: unknown) => notifications.error(t('matter.error', { message: (err as Error).message }))

async function load() {
  try { status.value = await getTransport().matterStatus() } catch (err) { fail(err) }
}
async function save(patch: MatterSettingsPatch) {
  busy.value = true
  try { status.value = await getTransport().setMatter(patch) } catch (err) { fail(err) } finally { busy.value = false }
}

// A controller pairs on its own side: while the code is shown, look again now and then.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => { if (status.value?.pairing && !busy.value) void load() }, 5000)
})
onBeforeUnmount(() => clearInterval(timer))

const listed = computed(() => new Set(status.value?.candidates.filter((c) => c.listed).map((c) => c.id) ?? []))
const groups = computed(() => {
  const byPlugin = new Map<string, MatterStatus['candidates']>()
  for (const c of status.value?.candidates ?? []) byPlugin.set(c.pluginId, [...(byPlugin.get(c.pluginId) ?? []), c])
  return [...byPlugin].map(([pluginId, devices]) => ({ pluginId, devices: [...devices].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
})

const state = computed(() => {
  const s = status.value
  if (!s?.enabled) return 'off'
  if (!s.running) return 'failed'
  return s.commissioned ? 'paired' : 'pairing'
})
const qrSrc = computed(() => (status.value?.pairing ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(status.value.pairing.qrSvg)}` : null))
/** 11 digits, read out in the 4-3-4 groups the assistants' apps show. */
const manualCode = computed(() => status.value?.pairing?.manualCode.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1-$2-$3') ?? '')

function setDevice(id: string, on: boolean) {
  const next = new Set(listed.value)
  if (on) next.add(id)
  else next.delete(id)
  void save({ devices: [...next] })
}
function setGroup(ids: string[], on: boolean) {
  const next = new Set(listed.value)
  for (const id of ids) {
    if (on) next.add(id)
    else next.delete(id)
  }
  void save({ devices: [...next] })
}
const allListed = (ids: string[]) => ids.every((id) => listed.value.has(id))

// A real house has dozens of devices: each plugin folds, closed by default — open when it is the
// only one, there is nothing to sort then. What the user opens or closes wins.
const folded = ref(new Map<string, boolean>())
const isOpen = (pluginId: string) => folded.value.get(pluginId) ?? groups.value.length === 1
function toggleGroup(pluginId: string) {
  folded.value = new Map(folded.value).set(pluginId, !isOpen(pluginId))
}
</script>

<template>
  <div class="mc">
    <div class="mc__row">
      <div class="min0">
        <div class="mc__name">{{ $t('matter.bridge') }}</div>
        <div class="muted small">{{ status ? $t(`matter.state.${state}`) : '—' }}</div>
      </div>
      <v-switch :model-value="status?.enabled ?? false" :disabled="!status || busy" hide-details density="compact"
                @update:model-value="(v: boolean | null) => save({ enabled: v === true })" />
    </div>

    <div class="mc__pair" :data-state="state">
      <div class="mc__qr">
        <img v-if="qrSrc" :src="qrSrc" :alt="$t('matter.qrAlt')" width="112" height="112">
        <StrokeIcon v-else :name="state === 'paired' ? 'checkCircle' : 'link'" :size="32" class="mc__qr-icon" />
      </div>
      <div class="min0 small">
        <template v-if="state === 'pairing'">
          <div>{{ $t('matter.pairHow') }}</div>
          <div class="mc__code">{{ manualCode }}</div>
        </template>
        <div v-else class="muted">{{ $t(`matter.pairNote.${state}`) }}</div>
      </div>
    </div>

    <div v-if="status && !groups.length" class="muted small">{{ $t('matter.none') }}</div>
    <div v-for="g in groups" :key="g.pluginId" class="mc__group">
      <div class="mc__group-head">
        <button type="button" class="mc__toggle min0" :aria-expanded="isOpen(g.pluginId)" @click="toggleGroup(g.pluginId)">
          <StrokeIcon :name="isOpen(g.pluginId) ? 'chevronUp' : 'chevronDown'" :size="16" class="mc__chev" />
          <span class="mc__plugin">{{ g.pluginId.replace('_', ' ') }}</span>
          <span class="muted small mc__count">{{ $t('matter.count', { published: g.devices.filter((d) => listed.has(d.id)).length, total: g.devices.length }) }}</span>
        </button>
        <button type="button" class="pill pill--sm" :disabled="busy"
                @click="setGroup(g.devices.map((d) => d.id), !allListed(g.devices.map((d) => d.id)))">
          {{ allListed(g.devices.map((d) => d.id)) ? $t('matter.withdrawAll') : $t('matter.publishAll') }}
        </button>
      </div>
      <div v-show="isOpen(g.pluginId)" class="mc__devices">
        <div v-for="d in g.devices" :key="d.id" class="mc__device">
          <div class="min0">
            <MarqueeText class="mc__device-name" :text="d.name" />
            <div class="muted small">{{ $t(`matter.type.${d.type}`) }}</div>
          </div>
          <v-switch :model-value="listed.has(d.id)" :disabled="busy" hide-details density="compact"
                    :aria-label="$t('matter.publish', { name: d.name })"
                    @update:model-value="(v: boolean | null) => setDevice(d.id, v === true)" />
        </div>
      </div>
    </div>
    <div v-if="status?.skipped.length" class="muted small">
      {{ $t('matter.skipped', { ids: status.skipped.map((s) => s.id).join(', ') }) }}
    </div>
  </div>
</template>

<style scoped>
.mc { display: grid; gap: 12px; }
.mc__row, .mc__device { display: flex; align-items: center; gap: 12px; }
.mc__name { font-size: 14px; font-weight: 500; }
/* same height in every state: the QR tile is always there, a mark stands in for the code */
.mc__pair { display: flex; align-items: center; gap: 14px; min-height: 124px; }
.mc__qr {
  flex: 0 0 auto; width: 124px; height: 124px; border-radius: 10px; display: grid; place-items: center;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.12);
}
/* a QR code is read dark on light, whatever the theme */
.mc__pair[data-state='pairing'] .mc__qr { background: #fff; }
.mc__qr-icon { opacity: 0.45; }
.mc__code { margin-top: 6px; font-size: 18px; font-weight: 500; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
.mc__group { display: grid; gap: 6px; }
/* the card is full width: the devices take columns rather than one long list */
.mc__devices { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); column-gap: 32px; row-gap: 2px; }
.mc__group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mc__toggle { display: flex; align-items: center; gap: 8px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.mc__chev { flex: 0 0 auto; color: var(--muted); }
.mc__plugin { font-size: 14px; font-weight: 500; text-transform: capitalize; white-space: nowrap; }
.mc__count { white-space: nowrap; font-variant-numeric: tabular-nums; }
.mc__device-name { font-size: 14px; }
.pill--sm { height: 32px; padding: 0 12px; font-size: 13px; }
.min0 { flex: 1 1 0; min-width: 0; }
.small { font-size: 12px; }
</style>
