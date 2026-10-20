<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AutomationEditor from '../components/automations/AutomationEditor.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { newAutomationId } from '../lib/automations'
import { useAutomationsStore } from '../stores/automations'

// Edit page of an automation (`/automations/:id`, or `/automations/new`). The editor needs the
// space of a page: the exceptions and the actions stack up in columns.
//
// A new automation gets its id here, once (the server does an upsert on `PUT /:id`);
// after its first save the address becomes its own, without reopening the editor.
//
// The view is not recreated when the address's id changes ("Duplicate" opens the copy): the id is
// therefore computed, and the editor, keyed on it, starts again from a fresh draft.
const props = defineProps<{ id: string }>()
const store = useAutomationsStore()
const router = useRouter()

const generated = newAutomationId()
const isNew = computed(() => props.id === 'new')
const realId = computed(() => (isNew.value ? generated : props.id))
/** Address opened directly: the list may not have arrived yet. */
const ready = ref(isNew.value || !!store.entries[realId.value])
const found = computed(() => isNew.value || !!store.entries[realId.value])

onMounted(async () => {
  if (ready.value) return
  await store.load()
  ready.value = true
})

const back = () => router.push({ name: 'automations' })
function onSaved(id: string) {
  if (isNew.value) void router.replace({ name: 'automation-edit', params: { id } })
}
const open = (id: string) => router.push({ name: 'automation-edit', params: { id } })
</script>

<template>
  <AutomationEditor v-if="ready && found" :id="realId" :key="realId" :is-new="isNew" @close="back" @saved="onSaved" @open="open" />
  <div v-else-if="ready" class="missing">
    <p class="muted">{{ $t('automations.notFound') }}</p>
    <button type="button" class="pill" @click="back"><StrokeIcon name="back" :size="14" /> {{ $t('nav.automations') }}</button>
  </div>
</template>

<style scoped>
.missing { height: 100%; display: grid; place-content: center; justify-items: center; gap: 12px; }
</style>
