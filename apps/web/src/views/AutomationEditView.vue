<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AutomationEditor from '../components/automations/AutomationEditor.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { newAutomationId } from '../lib/automations'
import { useAutomationsStore } from '../stores/automations'

// Page d'édition d'une automatisation (`/automations/:id`, ou `/automations/new`). L'éditeur a besoin
// de la place d'une page : les exceptions et les actions s'y empilent en colonnes.
//
// Une automatisation neuve reçoit son id ici, une fois (le serveur fait un upsert sur `PUT /:id`) ;
// après son premier enregistrement l'adresse devient la sienne, sans rouvrir l'éditeur.
//
// La vue n'est pas recréée quand l'id de l'adresse change (« Dupliquer » ouvre la copie) : l'id est
// donc calculé, et l'éditeur, clé sur lui, repart d'un brouillon neuf.
const props = defineProps<{ id: string }>()
const store = useAutomationsStore()
const router = useRouter()

const generated = newAutomationId()
const isNew = computed(() => props.id === 'new')
const realId = computed(() => (isNew.value ? generated : props.id))
/** Adresse ouverte directement : la liste peut ne pas être encore arrivée. */
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
