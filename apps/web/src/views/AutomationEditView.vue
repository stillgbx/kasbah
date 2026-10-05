<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AutomationEditor from '../components/automations/AutomationEditor.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useAutomationsStore } from '../stores/automations'

// Page d'édition d'une automatisation (`/automations/:id`, ou `/automations/new`). L'éditeur a besoin
// de la place d'une page : les exceptions et les actions s'y empilent en colonnes.
//
// Une automatisation neuve reçoit son id ici, une fois (le serveur fait un upsert sur `PUT /:id`) ;
// après son premier enregistrement l'adresse devient la sienne, sans rouvrir l'éditeur.
const props = defineProps<{ id: string }>()
const store = useAutomationsStore()
const router = useRouter()

const isNew = props.id === 'new'
// `crypto.randomUUID` n'existe qu'en contexte sécurisé (https ou localhost) ; servie en http sur le
// réseau local, l'app retombe sur 32 caractères hexadécimaux, admis aussi par `AUTOMATION_ID_RE`.
function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  }
}
const realId = isNew ? newId() : props.id
/** Adresse ouverte directement : la liste peut ne pas être encore arrivée. */
const ready = ref(isNew || !!store.entries[realId])
const found = computed(() => isNew || !!store.entries[realId])

onMounted(async () => {
  if (ready.value) return
  await store.load()
  ready.value = true
})

const back = () => router.push({ name: 'automations' })
function onSaved(id: string) {
  if (isNew) void router.replace({ name: 'automation-edit', params: { id } })
}
</script>

<template>
  <AutomationEditor v-if="ready && found" :id="realId" :is-new="isNew" @close="back" @saved="onSaved" />
  <div v-else-if="ready" class="missing">
    <p class="muted">{{ $t('automations.notFound') }}</p>
    <button type="button" class="pill" @click="back"><StrokeIcon name="back" :size="14" /> {{ $t('nav.automations') }}</button>
  </div>
</template>

<style scoped>
.missing { height: 100%; display: grid; place-content: center; justify-items: center; gap: 12px; }
</style>
