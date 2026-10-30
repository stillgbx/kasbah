<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { HaEntities, HaEntityInfo } from '../api/transport'
import { useNotificationsStore } from '../stores/notifications'
import MarqueeText from './ui/MarqueeText.vue'
import StrokeIcon from './ui/StrokeIcon.vue'

// Home Assistant plugin card (Settings → Plugins): which HA entities show up in Kasbah, grouped by
// HA integration — it is the integration (Hue, Somfy…) that makes duplicates, not the kind. All of
// them by default, except those a Kasbah plugin that is on already provides. A switch back to the
// default sends `null`: the entity then follows the native plugin again when it is turned on or off.

const { t } = useI18n()
const notifications = useNotificationsStore()
const data = ref<HaEntities | null>(null)
const busy = ref(false)

const fail = (err: unknown) => notifications.error(t('homeAssistant.error', { message: (err as Error).message }))

async function load() {
  try { data.value = await getTransport().homeAssistantEntities() } catch (err) { fail(err) }
}
async function save(choices: Record<string, boolean | null>) {
  busy.value = true
  try { data.value = await getTransport().setHomeAssistantEntities(choices) } catch (err) { fail(err) } finally { busy.value = false }
}

// The plugin connects on its own: until then, look again now and then.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => { if (data.value && !data.value.connected && !busy.value) void load() }, 5000)
})
onBeforeUnmount(() => clearInterval(timer))

/** The choice to send: `null` when it is what the default would give. */
const choiceFor = (e: HaEntityInfo, shown: boolean) => (shown === !e.duplicateOf ? null : shown)
const setEntity = (e: HaEntityInfo, shown: boolean) => save({ [e.entityId]: choiceFor(e, shown) })
const setGroup = (entities: HaEntityInfo[], shown: boolean) =>
  save(Object.fromEntries(entities.map((e) => [e.entityId, choiceFor(e, shown)])))

const groups = computed(() => {
  const byIntegration = new Map<string, HaEntityInfo[]>()
  for (const e of data.value?.entities ?? []) byIntegration.set(e.integration, [...(byIntegration.get(e.integration) ?? []), e])
  return [...byIntegration].map(([integration, entities]) => ({
    integration,
    entities: [...entities].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    duplicateOf: entities.find((e) => e.duplicateOf)?.duplicateOf,
  // entities without an integration (YAML) last
  })).sort((a, b) => Number(!a.integration) - Number(!b.integration) || a.integration.localeCompare(b.integration))
})
const shownCount = computed(() => data.value?.entities.filter((e) => e.shown).length ?? 0)
const status = computed(() => {
  const d = data.value
  if (!d) return ''
  if (!d.connected) return t('homeAssistant.connecting')
  return t('homeAssistant.status', { shown: shownCount.value, total: d.entities.length })
})
const allShown = (entities: HaEntityInfo[]) => entities.every((e) => e.shown)
const integrationName = (id: string) => (id ? id.replace(/_/g, ' ') : t('homeAssistant.noIntegration'))
const detailOf = (e: HaEntityInfo) => [t(`kinds.${e.kind}`), e.room].filter(Boolean).join(' · ')

// Dozens of entities: each integration folds, closed by default — open when it is the only one.
const folded = ref(new Map<string, boolean>())
const isOpen = (integration: string) => folded.value.get(integration) ?? groups.value.length === 1
function toggleGroup(integration: string) {
  folded.value = new Map(folded.value).set(integration, !isOpen(integration))
}
</script>

<template>
  <div class="ha">
    <!-- reserved space: the status line keeps its height while loading -->
    <div class="ha__row">
      <StrokeIcon name="home" :size="18" class="muted" />
      <div class="ha__status min0">{{ status || ' ' }}</div>
    </div>
    <p class="muted small ha__hint">{{ $t('homeAssistant.hint') }}</p>

    <div v-if="data?.connected && !groups.length" class="muted small">{{ $t('homeAssistant.none') }}</div>
    <div v-for="g in groups" :key="g.integration" class="ha__group">
      <div class="ha__group-head">
        <button type="button" class="ha__toggle min0" :aria-expanded="isOpen(g.integration)" @click="toggleGroup(g.integration)">
          <StrokeIcon :name="isOpen(g.integration) ? 'chevronUp' : 'chevronDown'" :size="16" class="ha__chev" />
          <span class="ha__integration" :data-none="g.integration ? '0' : '1'">{{ integrationName(g.integration) }}</span>
          <span class="muted small ha__count">{{ $t('homeAssistant.count', { shown: g.entities.filter((e) => e.shown).length, total: g.entities.length }) }}</span>
        </button>
        <button type="button" class="pill pill--sm ha__all" :disabled="busy" @click="setGroup(g.entities, !allShown(g.entities))">
          {{ allShown(g.entities) ? $t('homeAssistant.hideAll') : $t('homeAssistant.showAll') }}
        </button>
      </div>
      <div v-if="g.duplicateOf" class="muted small ha__dup">{{ $t('homeAssistant.duplicate', { plugin: g.duplicateOf.replace(/_/g, ' ') }) }}</div>
      <div v-show="isOpen(g.integration)" class="ha__entities">
        <div v-for="e in g.entities" :key="e.entityId" class="ha__entity">
          <div class="min0">
            <MarqueeText class="ha__entity-name" :text="e.name" />
            <div class="muted small ha__detail">{{ detailOf(e) }}</div>
          </div>
          <v-switch :model-value="e.shown" :disabled="busy" hide-details density="compact"
                    :aria-label="$t('homeAssistant.show', { name: e.name })"
                    @update:model-value="(v: boolean | null) => setEntity(e, v === true)" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* minmax(0, …): a long entity name on one line must not widen the card */
.ha { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.ha__row { display: flex; align-items: center; gap: 10px; min-height: 28px; }
.ha__status { flex: 1 1 0; font-size: 14px; line-height: 1.4; }
.ha__hint { margin: 0; line-height: 1.5; }
.ha__group { display: grid; gap: 6px; }
.ha__group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ha__toggle { display: flex; align-items: center; gap: 8px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.ha__chev { flex: 0 0 auto; color: var(--muted); }
.ha__integration { font-size: 14px; font-weight: 500; text-transform: capitalize; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* a sentence, not an integration id: no capital on each word */
.ha__integration[data-none='1'] { text-transform: none; }
.ha__count { white-space: nowrap; font-variant-numeric: tabular-nums; }
/* same width whatever its label: "Show all" and "Hide all" swap in place */
.ha__all { flex: 0 0 auto; min-width: 120px; justify-content: center; }
.ha__dup { margin: -2px 0 0 24px; }
/* the card is full width: the entities take columns rather than one long list */
.ha__entities { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); column-gap: 32px; row-gap: 2px; }
.ha__entity { display: flex; align-items: center; gap: 12px; }
.ha__entity-name { font-size: 14px; }
.ha__detail { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill--sm { height: 32px; padding: 0 12px; font-size: 13px; }
.min0 { flex: 1 1 0; min-width: 0; }
.small { font-size: 12px; }
</style>
