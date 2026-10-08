<script setup lang="ts">
import StrokeIcon from '../ui/StrokeIcon.vue'
import { usePropertiesStore } from '../../stores/properties'

// Les propriétés entre lesquelles basculer, une ligne chacune : la courante cochée, celle qu'on
// rejoint annoncée pendant le rechargement. Sert au menu du rail et à la carte des Réglages.
const properties = usePropertiesStore()
</script>

<template>
  <div class="props" role="list">
    <button v-for="p in properties.info?.properties ?? []" :key="p.id" type="button" class="props__item" role="listitem"
            :data-on="p.id === properties.info?.activeId ? '1' : '0'" :disabled="!!properties.switching"
            :aria-current="p.id === properties.info?.activeId ? 'true' : undefined" @click="properties.select(p.id)">
      <StrokeIcon :name="p.kind === 'apartment' ? 'layers' : 'home'" :size="18" />
      <span class="props__name">{{ p.name }}</span>
      <span class="props__kind muted">{{ $t(`properties.kinds.${p.kind}`) }}</span>
      <!-- une place réservée à droite : coche ou sablier s'y posent sans rien décaler -->
      <span class="props__mark">
        <v-progress-circular v-if="properties.switching === p.id" indeterminate size="16" width="2" />
        <StrokeIcon v-else-if="p.id === properties.info?.activeId" name="check" :size="16" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.props { display: grid; gap: 2px; }
.props__item {
  display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 18px; align-items: center; gap: 10px;
  width: 100%; padding: 9px 10px; border: 0; border-radius: 10px; background: transparent;
  color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer;
}
.props__item:hover:not(:disabled) { background: var(--surface2); }
.props__item[data-on='1'] { color: var(--accent); }
.props__item:disabled { cursor: progress; }
.props__name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.props__kind { font-size: 12px; white-space: nowrap; }
.props__mark { display: grid; place-items: center; width: 18px; height: 18px; }
</style>
