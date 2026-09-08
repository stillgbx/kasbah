<script setup lang="ts">
import { computed } from 'vue'
import type { PluginSceneEntry } from '@kasbah/shared'
import { useScenesStore } from '../../stores/scenes'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Pastilles des scènes d'un fabricant : aperçu de la palette, scène en cours mise en avant,
// bouton « animer » pour les scènes à palette (le pont fait défiler les couleurs lui-même).
const props = defineProps<{
  scenes: PluginSceneEntry[]
  label?: string
  /** Groupe du fabricant auquel on peut AJOUTER une ambiance (nom de la pièce ou de la zone). */
  addTo?: string
}>()
const store = useScenesStore()

/** Dégradé de l'aperçu : une seule couleur reste un aplat. */
function preview(swatches: string[]): string {
  if (swatches.length === 0) return 'var(--surface2)'
  if (swatches.length === 1) return swatches[0]!
  return `linear-gradient(135deg, ${swatches.join(', ')})`
}

const rows = computed(() => props.scenes.map((e) => ({
  id: e.scene.id,
  name: e.scene.name,
  dynamic: e.scene.dynamic,
  active: e.state.active,
  background: preview(e.scene.swatches),
  /** Mode joué au tap : dépend du réglage du fabricant et de la préférence de la tablette. */
  tapMode: store.tapMode(e),
})))

// Les deux boutons sont des bascules. La pastille : éteindre le groupe si l'ambiance tourne, jouer
// l'ambiance sinon (animée si le fabricant l'a réglée ainsi, cf. `tapMode`). Le bouton ✨ : arrêter
// l'animation en revenant au fixe (la scène reste allumée), ou la lancer.
type Row = { id: string; active: string; tapMode: 'static' | 'dynamic' }
const toggle = (r: Row) => store.recall(r.id, r.active === 'inactive' ? r.tapMode : 'off')
const toggleDynamic = (r: Row) => store.recall(r.id, r.active === 'dynamic' ? 'static' : 'dynamic')

/** Ambiances présentes ailleurs chez le fabricant et absentes ici : on peut les recopier. */
const addable = computed(() => (props.addTo ? store.clonableFor(props.addTo) : []).map((e) => ({
  id: e.scene.id,
  name: e.scene.name,
  from: e.scene.group?.name ?? '',
  dynamic: e.scene.dynamic,
  background: preview(e.scene.swatches),
})))
</script>

<template>
  <section v-if="rows.length || addable.length" class="block">
    <div v-if="label" class="section-label">{{ label }}</div>
    <div class="chips">
      <div v-for="r in rows" :key="r.id" class="chip" :data-on="r.active === 'inactive' ? '0' : '1'">
        <button type="button" class="chip__main" :disabled="store.isPending(r.id)"
                :title="r.active === 'inactive' ? r.name : $t('scenes.turnOff', { name: r.name })" @click="toggle(r)">
          <span class="chip__swatch" :style="{ background: r.background }" />
          <span class="chip__name">{{ r.name }}</span>
        </button>
        <button v-if="r.dynamic" type="button" class="chip__dyn" :data-on="r.active === 'dynamic' ? '1' : '0'"
                :disabled="store.isPending(r.id)" :aria-pressed="r.active === 'dynamic'"
                :title="$t(r.active === 'dynamic' ? 'scenes.stopAnimate' : 'scenes.animate')"
                :aria-label="$t(r.active === 'dynamic' ? 'scenes.stopAnimate' : 'scenes.animate')"
                @click="toggleDynamic(r)">
          <StrokeIcon name="sparkle" :size="14" />
        </button>
      </div>

      <v-menu v-if="addable.length" location="bottom start">
        <template #activator="{ props: menu }">
          <button v-bind="menu" type="button" class="chip chip--add" :disabled="store.isCreating(addTo!)"
                  :title="$t('scenes.add')" :aria-label="$t('scenes.add')">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </template>
        <div class="add-list card">
          <div class="section-label add-list__title">{{ $t('scenes.add') }}</div>
          <button v-for="a in addable" :key="a.id" type="button" class="add-item" @click="store.createScene(a.id, addTo!)">
            <span class="chip__swatch" :style="{ background: a.background }" />
            <span class="min0">
              <span class="add-item__name">{{ a.name }}</span>
              <span class="muted add-item__from">{{ $t('scenes.copiedFrom', { group: a.from }) }}</span>
            </span>
            <StrokeIcon v-if="a.dynamic" name="sparkle" :size="13" class="muted" />
          </button>
        </div>
      </v-menu>
    </div>
  </section>
</template>

<style scoped>
.block { display: grid; gap: 8px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: stretch; height: 40px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface); overflow: hidden; max-width: 100%;
  transition: background .15s, border-color .15s;
}
.chip[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); }
.chip__main {
  display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; border: 0; background: transparent;
  color: var(--text); font-weight: 500; font-size: 14px; min-width: 0;
}
.chip__main:disabled, .chip__dyn:disabled { opacity: .45; cursor: default; }
.chip__swatch { width: 18px; height: 18px; border-radius: 6px; flex: 0 0 auto; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
.chip__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip__dyn {
  display: grid; place-items: center; width: 34px; border: 0; border-left: 1px solid var(--line);
  background: transparent; color: var(--muted);
}
.chip__dyn[data-on='1'] { background: var(--accent); color: var(--on-accent); border-left-color: transparent; }

/* Le survol ne doit JAMAIS reprendre le fond ni la couleur d'un bouton allumé : ce fond EST le
   signal « en cours ». Éteint → fond de survol ; allumé → on reste dans la famille d'accent
   (le tint se superpose) ou on éclaircit, comme les lignes de pièce et d'appareil. */
.chip[data-on='0'] .chip__main:hover:not(:disabled) { background: var(--surface2); }
.chip[data-on='1'] .chip__main:hover:not(:disabled) { background: var(--accent-soft); }
.chip__dyn[data-on='0']:hover:not(:disabled) { background: var(--surface2); color: var(--text); }
.chip__dyn[data-on='1']:hover:not(:disabled) { filter: brightness(1.08); }

.chip--add { width: 40px; padding: 0; align-items: center; justify-content: center; color: var(--muted); }
.chip--add:hover:not(:disabled) { background: var(--surface2); color: var(--text); }
.chip--add:disabled { opacity: .45; }
.add-list { padding: 10px; display: grid; gap: 2px; min-width: 240px; max-height: 320px; overflow-y: auto; }
.add-list__title { padding: 2px 6px 6px; }
.add-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 6px; border: 0; border-radius: 10px;
  background: transparent; color: var(--text); text-align: left; width: 100%;
}
.add-item:hover { background: var(--surface2); }
.add-item__name { display: block; font-size: 14px; font-weight: 500; }
.add-item__from { display: block; font-size: 11px; }
.min0 { flex: 1 1 0; min-width: 0; }
</style>
