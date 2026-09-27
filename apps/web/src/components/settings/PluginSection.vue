<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PluginHealth, PluginInfo } from '@kasbah/shared'
import AgendaLinkCard from '../AgendaLinkCard.vue'
import EnphasePairingCard from '../EnphasePairingCard.vue'
import HuePairingCard from '../HuePairingCard.vue'
import IrobotLinkCard from '../IrobotLinkCard.vue'
import MelcloudLinkCard from '../MelcloudLinkCard.vue'
import MixcloudLinkCard from '../MixcloudLinkCard.vue'
import PetkitLinkCard from '../PetkitLinkCard.vue'
import NestLinkCard from '../NestLinkCard.vue'
import RenaultLinkCard from '../RenaultLinkCard.vue'
import TeslaLinkCard from '../TeslaLinkCard.vue'
import YtmusicLinkCard from '../YtmusicLinkCard.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { usePluginsStore } from '../../stores/plugins'
import { useScenesStore } from '../../stores/scenes'

// Un plugin dans les Réglages : une ligne toujours lisible (nom, santé, interrupteur) et, sous
// elle, TOUT ce qui le concerne — ce que le serveur en dit, sa carte de mise en route (lier,
// délier, appairer), ses ambiances, ses sous-items, ses clés .env. Avant, les cartes vivaient
// au-dessus de la liste et décidaient seules de s'afficher : celle de Renault restait donc là, à
// annoncer un compte lié dont personne n'avait rien à faire.
//
// Le panneau s'ouvre TOUT SEUL quand le serveur RÉCLAME quelque chose : `needs_pairing` (à
// appairer, à lier) et `error`. Pas `degraded` : un fabricant qui répond mal se plaint souvent sans
// rien demander — Cast attend un appareil éteint — et ouvrir la section n'y changerait rien. Le
// statut et son détail restent lisibles dans la ligne repliée.

const props = defineProps<{ plugin: PluginInfo }>()
const plugins = usePluginsStore()
const scenes = useScenesStore()

// Les ambiances d'un fabricant sont un réglage DE CE FABRICANT : le concept est commun, les
// réglages non. Elles vivaient dans une carte à part des Réglages, une par plugin ; elles sont
// maintenant dans le panneau du plugin, avec le reste de ce qui le concerne.
const pluginScenes = computed(() => scenes.scenesByPlugin.find((g) => g.pluginId === props.plugin.id)?.scenes ?? [])

// Suppression d'une ambiance : premier appui arme, second confirme, et on désarme tout seul.
const armed = ref<string | null>(null)
let armTimer: ReturnType<typeof setTimeout> | null = null
function arm(sceneId: string) {
  armed.value = sceneId
  if (armTimer) clearTimeout(armTimer)
  armTimer = setTimeout(() => { armed.value = null }, 5000)
}
function confirmDelete(sceneId: string) {
  armed.value = null
  if (armTimer) clearTimeout(armTimer)
  void scenes.deleteScene(sceneId)
}

/** La carte de mise en route du fabricant, pour ceux qui en ont une. */
const SETUP_CARDS = {
  hue: HuePairingCard,
  nest: NestLinkCard,
  enphase: EnphasePairingCard,
  tesla: TeslaLinkCard,
  renault: RenaultLinkCard,
  melcloud: MelcloudLinkCard,
  petkit: PetkitLinkCard,
  irobot: IrobotLinkCard,
  ytmusic: YtmusicLinkCard,
  mixcloud: MixcloudLinkCard,
  agenda: AgendaLinkCard,
} as const
const setupCard = computed(() => SETUP_CARDS[props.plugin.id as keyof typeof SETUP_CARDS] ?? null)

const DOT: Record<PluginHealth['status'], string> = { ok: 'var(--accent)', degraded: '#d38b22', needs_pairing: '#d38b22', error: '#d24a43', not_implemented: 'var(--muted)', disabled: 'var(--muted)' }

const ATTENTION: PluginHealth['status'][] = ['needs_pairing', 'error']
const needsAction = computed(() => props.plugin.enabled && ATTENTION.includes(props.plugin.health.status))
/** `null` : on suit le serveur. Un booléen : l'utilisateur a tranché et garde la main. */
const manual = ref<boolean | null>(null)
const open = computed(() => manual.value ?? needsAction.value)
/** Noms des variables d'environnement lues par le plugin (jamais leurs valeurs). */
const envKeys = computed(() => props.plugin.health.keys ?? [])
/** Un squelette non implémenté n'a ni clé, ni détail, ni carte : rien à déplier. */
const expandable = computed(() => !!setupCard.value || props.plugin.parts.length > 0
  || !!props.plugin.health.detail || envKeys.value.length > 0 || pluginScenes.value.length > 0)
</script>

<template>
  <div class="plugin">
    <div class="plugin__row">
      <!-- le chevron garde sa place même quand il n'y a rien à déplier : les noms restent alignés -->
      <button type="button" class="plugin__toggle min0" :disabled="!expandable" :aria-expanded="open"
              :title="$t('settings.pluginDetails')" @click="manual = !open">
        <StrokeIcon :name="open ? 'chevronUp' : 'chevronDown'" :size="16" class="plugin__chev" :data-on="expandable ? '1' : '0'" />
        <span class="plugin__name">{{ plugin.id.replace('_', ' ') }}</span>
      </button>
      <div class="plugin__status muted">
        <span class="dot" :style="{ background: DOT[plugin.health.status] }" />{{ $t(`settings.pluginStatus.${plugin.health.status}`) }}<span v-if="plugin.health.deviceCount"> · {{ $t('settings.devicesCount', { n: plugin.health.deviceCount }, plugin.health.deviceCount) }}</span>
      </div>
      <!-- un squelette n'a rien à démarrer : interrupteur grisé, pas caché -->
      <v-switch :model-value="plugin.enabled" :disabled="!plugin.implemented || plugins.isBusy(plugin.id)" hide-details density="compact" class="plugin__switch"
                :title="plugin.implemented ? $t('settings.pluginEnable') : $t('settings.pluginStatus.not_implemented')"
                :aria-label="$t('settings.pluginEnable')"
                @update:model-value="(v: boolean | null) => plugins.setEnabled(plugin.id, v === true)" />
    </div>

    <!-- `v-show` et non `v-if` : les cartes interrogent leur fabricant au montage et gardent où en
         est la mise en route ; replier la section ne doit pas tout redemander -->
    <div v-show="open" class="plugin__body">
      <p v-if="plugin.health.detail" class="muted small plugin__detail">{{ plugin.health.detail }}</p>

      <component :is="setupCard" v-if="setupCard && plugin.enabled" />

      <!-- ambiances du fabricant : l'écran de GESTION (le geste courant reste la pastille du
           panneau pièce). Comme les sous-items, seulement quand le plugin est allumé. -->
      <div v-if="plugin.enabled && pluginScenes.length" class="scenes">
        <div class="scenes__title muted small">{{ $t('settings.scenes') }}</div>
        <div class="auto-row auto-row--default">
          <div class="min0">
            <div class="auto-row__name">{{ $t('settings.sceneAutoDynamicNew') }}</div>
            <div class="muted small">{{ $t('settings.sceneAutoDynamicNewHint') }}</div>
          </div>
          <v-switch :model-value="plugin.autoDynamicForNewScenes === true" hide-details density="compact"
                    @update:model-value="(v: boolean | null) => plugins.setAutoDynamicForNewScenes(plugin.id, v === true)" />
        </div>
        <div class="muted small">{{ $t('settings.sceneAutoDynamicHint') }}</div>
        <div class="auto-rows">
          <div v-for="e in pluginScenes" :key="e.scene.id" class="auto-row">
            <div class="min0">
              <div class="auto-row__name">{{ e.scene.name }}</div>
              <div class="muted small">{{ e.scene.group?.name ?? '—' }}</div>
            </div>
            <v-switch :model-value="e.scene.autoDynamic" :disabled="!e.scene.dynamic" hide-details density="compact"
                      :title="e.scene.dynamic ? $t('settings.sceneAutoDynamic') : $t('settings.sceneNoPalette')"
                      @update:model-value="(v: boolean | null) => scenes.setAutoDynamic(e.scene.id, v === true)" />
            <!-- destructif et visible depuis l'app du fabricant : deux temps, jamais un seul appui -->
            <v-btn v-if="armed === e.scene.id" color="error" variant="flat" size="small" class="del-confirm"
                   @click="confirmDelete(e.scene.id)">
              {{ $t('scenes.deleteConfirm') }}
            </v-btn>
            <v-btn v-else icon variant="text" size="small" color="error" class="del"
                   :title="$t('scenes.delete')" :aria-label="$t('scenes.delete')" @click="arm(e.scene.id)">
              <StrokeIcon name="trash" :size="16" />
            </v-btn>
          </div>
        </div>
      </div>

      <!-- sous-items : visibles seulement quand le plugin est allumé, sinon ils ne veulent rien dire -->
      <div v-if="plugin.enabled && plugin.parts.length" class="parts">
        <div class="parts__title muted small">{{ $t('settings.pluginParts') }}</div>
        <!-- pastille à bascule plutôt qu'une case : le jeu d'icônes maison n'a pas
             d'alias $checkboxOn, et une pastille garde la même empreinte allumée ou non -->
        <button v-for="part in plugin.parts" :key="part.id" type="button" class="part" :data-on="part.enabled ? '1' : '0'"
                :disabled="plugins.isBusy(plugin.id)" :aria-pressed="part.enabled"
                @click="plugins.setPart(plugin.id, part.id, !part.enabled)">
          {{ $t(part.labelKey) }}
        </button>
      </div>

      <div v-if="envKeys.length" class="plugin__env">
        <div class="muted small">{{ $t('settings.keys') }}</div>
        <div class="plugin__keys mono muted">{{ envKeys.join('  ') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin { padding: 10px 0; border-bottom: 1px solid var(--line); }
.plugin:last-child { border-bottom: 0; }
.plugin__row { display: flex; align-items: center; gap: 12px; }
.plugin__toggle { display: flex; align-items: center; gap: 8px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.plugin__toggle:disabled { cursor: default; }
.plugin__chev { flex: 0 0 auto; color: var(--muted); }
.plugin__chev[data-on='0'] { visibility: hidden; }
.plugin__switch { flex: 0 0 auto; }
.plugin__body { display: grid; gap: 10px; justify-items: start; padding: 8px 0 4px 24px; }
.plugin__detail { margin: 0; }
.plugin__body > :deep(.card) { width: 100%; }
/* la liste des ambiances prend toute la largeur du panneau (qui aligne ses enfants à gauche) */
.scenes { width: 100%; display: grid; gap: 4px; }
.scenes__title { margin-bottom: 2px; }
.auto-rows { display: grid; gap: 2px; margin-top: 4px; }
.auto-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; border-top: 1px solid var(--line); }
.auto-row--default { border-top: 0; }
.auto-row__name { font-size: 14px; font-weight: 500; }
.del { flex: 0 0 auto; color: var(--muted); }
.del:hover { color: rgb(var(--v-theme-error)); }
.del-confirm { flex: 0 0 auto; }
.parts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.parts__title { flex: 0 0 100%; margin-bottom: 2px; }
.part { font-size: 12px; line-height: 1; padding: 6px 10px; border-radius: 999px; cursor: pointer;
        border: 1px solid var(--line); background: transparent; color: var(--muted); transition: color .15s, border-color .15s, background .15s; }
.part[data-on='1'] { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.part:disabled { opacity: .5; cursor: default; }
.plugin__env { display: grid; gap: 2px; }
.plugin__keys { font-size: 11px; white-space: pre-wrap; }
.min0 { min-width: 0; flex: 1 1 0; }
.plugin__name { font-weight: 500; font-size: 14px; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin__status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
</style>
