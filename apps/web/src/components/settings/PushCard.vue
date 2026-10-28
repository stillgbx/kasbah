<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NOTIFY_CATEGORIES, type NotifyCategory } from '@kasbah/shared'
import { usePushStore } from '../../stores/push'
import { useNotificationsStore } from '../../stores/notifications'

// Push notifications of THIS screen, in Settings: the switch (permission, subscription), the
// categories, and a test. The categories stay shown and greyed while it is off: turning it on
// does not move the card.

const push = usePushStore()
const notifications = useNotificationsStore()
const { t } = useI18n()

/** The line under the switch: why it cannot, or what it does. One line, whatever the state. */
const status = computed(() => {
  if (push.unsupported) return t(`push.unsupported.${push.unsupported}`)
  if (push.permission === 'denied') return t('push.denied')
  return t(push.enabled ? 'push.on' : 'push.off')
})
const canToggle = computed(() => !push.unsupported && push.permission !== 'denied' && !push.busy)

const fail = (err: unknown) => notifications.error(t('push.error', { message: (err as Error).message }))

async function toggle(on: boolean) {
  try { await (on ? push.enable() : push.disable()) } catch (err) { fail(err) }
}
async function setCategory(c: NotifyCategory, on: boolean) {
  try { await push.setCategory(c, on) } catch (err) { fail(err) }
}
async function test() {
  try { await push.test() } catch (err) { fail(err) }
}
</script>

<template>
  <div class="pc">
    <div class="pc__row">
      <div class="min0">
        <div class="pc__name">{{ $t('push.thisDevice') }}</div>
        <div class="muted small pc__status">{{ status }}</div>
      </div>
      <v-switch :model-value="push.enabled" :disabled="!canToggle" hide-details density="compact"
                @update:model-value="(v: boolean | null) => toggle(v === true)" />
    </div>
    <div class="chips" :aria-label="$t('push.categories')">
      <button v-for="c in NOTIFY_CATEGORIES" :key="c" type="button" class="pill pill--sm" :disabled="!push.enabled || push.busy"
              :data-on="push.categories.includes(c) ? '1' : '0'" :aria-pressed="push.categories.includes(c)"
              @click="setCategory(c, !push.categories.includes(c))">
        {{ $t(`push.category.${c}`) }}
      </button>
    </div>
    <div>
      <button type="button" class="pill pill--sm" :disabled="!push.enabled || push.busy" @click="test">{{ $t('push.test') }}</button>
    </div>
  </div>
</template>

<style scoped>
.pc { display: grid; gap: 10px; }
.pc__row { display: flex; align-items: center; gap: 12px; }
.pc__name { font-size: 14px; font-weight: 500; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pill--sm { height: 32px; padding: 0 12px; font-size: 13px; gap: 6px; }
.min0 { flex: 1 1 0; min-width: 0; }
.small { font-size: 12px; }
/* narrow screen: the longer statuses (refused, not available here) take two lines — reserved, so a
   refusal of the permission does not push the categories down */
@media (max-width: 700px) { .pc__status { min-height: 3em; } }
</style>
