<script setup lang="ts" generic="T extends string">
import type { IconName } from '../../lib/strokeIcons'
import StrokeIcon from './StrokeIcon.vue'

// Contrôle segmenté en pilule : conteneur surface + bordure, segment actif sur l'accent.
// `label` nomme le groupe pour les lecteurs d'écran, quand rien à côté ne dit sur quoi il agit.
// `disabled` par option : un segment peut n'avoir rien à commander alors que l'autre en a encore
// (les commandes d'ensemble des ouvrants — voir `CoversMaster.vue`).
// `fill` : occupe la largeur du parent et coupe les libellés plutôt que de déborder.
// `icon` : à la place du texte (le `label` reste l'infobulle et le nom accessible).
// `sublabel` : seconde ligne plus petite (ex. « 2700 K » sous « Chaud »).
// `count` : pastille (ex. devoirs à faire). Après un libellé, sa place reste réservée à 0 pour que le
// segment ne rétrécisse pas — et ne pousse pas ses voisins — quand le nombre tombe à zéro. Sur une
// icône, elle est posée en exposant, hors du flux : aucune place à réserver.
defineProps<{
  modelValue: T
  options: { value: T; label: string; sublabel?: string; icon?: IconName; disabled?: boolean; count?: number }[]
  dense?: boolean
  fill?: boolean
  label?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div class="segmented" :class="{ 'segmented--dense': dense, 'segmented--fill': fill, 'segmented--stack': options.some((o) => o.sublabel) }" role="tablist" :aria-label="label">
    <button v-for="o in options" :key="o.value" type="button" role="tab" class="segmented__item" :data-on="o.value === modelValue ? '1' : '0'"
            :disabled="o.disabled" :aria-selected="o.value === modelValue" :aria-label="o.sublabel ? `${o.label}, ${o.sublabel}` : o.label" :title="o.sublabel ? `${o.label} · ${o.sublabel}` : o.label"
            @click="emit('update:modelValue', o.value)">
      <StrokeIcon v-if="o.icon" :name="o.icon" :size="dense ? 16 : 18" />
      <span v-else-if="o.sublabel" class="segmented__stack">
        <span class="segmented__main">{{ o.label }}</span>
        <span class="segmented__sub">{{ o.sublabel }}</span>
      </span>
      <template v-else>{{ o.label }}</template>
      <span v-if="o.count !== undefined" class="segmented__count" :class="{ 'segmented__count--over': o.icon }"
            :data-empty="o.count ? '0' : '1'" aria-hidden="true">{{ o.count || '' }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); }
.segmented__item {
  display: inline-flex; align-items: center; justify-content: center;
  height: 36px; padding: 0 16px; border-radius: 999px; border: 0; background: transparent; color: var(--muted);
  font: 500 14px/1 var(--font); transition: background .15s, color .15s; white-space: nowrap;
}
.segmented--dense .segmented__item { height: 32px; padding: 0 12px; font-size: 13px; }
/* icône seule : padding plus serré — quatre silhouettes tiennent à côté d'un libellé court */
.segmented--dense .segmented__item:has(svg):not(:has(.segmented__stack)) { padding: 0 8px; }
/* pleine largeur du parent : les segments se partagent l'espace et se coupent plutôt que de déborder
   (un `min-content` de libellés longs a déjà fait défiler le panneau — voir doc 4_1). */
.segmented--fill { display: flex; width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; }
.segmented--fill .segmented__item { flex: 1 1 0; min-width: 0; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; }
.segmented--fill.segmented--dense .segmented__item { padding: 0 6px; font-size: 12px; }
/* Deux lignes (libellé + K) : un peu plus haut, texte centré, pas de nowrap qui écraserait le sous-libellé. */
.segmented--stack .segmented__item { height: auto; min-height: 40px; padding-block: 6px; white-space: normal; }
.segmented--stack.segmented--dense .segmented__item { min-height: 36px; padding-block: 4px; }
.segmented__stack {
  display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; line-height: 1.15;
}
.segmented__main { overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.segmented__sub { font-size: 10px; font-weight: 400; opacity: .72; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.segmented__item:hover:not(:disabled) { color: var(--text); }
.segmented__item:disabled { opacity: .4; }
.segmented__item[data-on='1'] { background: var(--accent); color: var(--on-accent); }
.segmented__item svg { flex: 0 0 auto; }
.segmented__count {
  flex: 0 0 auto; min-width: 20px; height: 20px; margin-left: 8px; padding: 0 6px; border-radius: 999px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;
  background: var(--accent); color: var(--on-accent);
}
.segmented__item[data-on='1'] .segmented__count { background: var(--on-accent); color: var(--accent); }
.segmented__count[data-empty='1'] { visibility: hidden; }
.segmented__item:has(.segmented__count--over) { position: relative; }
.segmented__count--over { position: absolute; top: 1px; right: 2px; margin: 0; min-width: 17px; height: 17px; padding: 0 4px; font-size: 11px; }
</style>
