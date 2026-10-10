<script setup lang="ts">
import { computed } from 'vue'
import type { PropertySummary } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { usePropertiesStore } from '../../stores/properties'

// Les propriétés entre lesquelles basculer, une ligne chacune : la courante cochée, celle qu'on
// rejoint annoncée pendant le rechargement. Sert au menu du rail et à la carte des Réglages.
// Le serveur ne liste que les propriétés du MODE montré (démos ou réelles) ; il y ajoute deux gestes :
// créer une propriété neuve, ou dupliquer la démo montrée pour la modifier.
const properties = usePropertiesStore()
const all = computed<PropertySummary[]>(() => properties.info?.properties ?? [])
</script>

<template>
  <div class="props">
    <div class="props__group" role="list">
      <button v-for="p in all" :key="p.id" type="button" class="props__item" role="listitem"
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
    <div v-if="properties.canCreate" class="props__actions">
      <button type="button" class="props__action" :disabled="!!properties.switching || properties.busy" @click="properties.creating = true">
        <StrokeIcon name="plus" :size="16" /> <span class="props__name">{{ $t('properties.create') }}</span>
      </button>
      <button v-if="properties.isDemo" type="button" class="props__action" :disabled="!!properties.switching || properties.busy" @click="properties.duplicateActive()">
        <StrokeIcon name="pencil" :size="16" /> <span class="props__name">{{ $t('properties.duplicate', { name: properties.active?.name ?? '' }) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.props { display: grid; gap: 8px; }
.props__group { display: grid; gap: 2px; }
.props__item {
  display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 18px; align-items: center; gap: 10px;
  width: 100%; padding: 9px 10px; border: 0; border-radius: 10px; background: transparent;
  color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer;
}
.props__item:hover:not(:disabled) { background: var(--surface2); }
.props__item[data-on='1'] { color: var(--accent); }
.props__item:disabled { cursor: progress; }
.props__name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; min-width: 0; }
.props__kind { font-size: 12px; white-space: nowrap; }
.props__mark { display: grid; place-items: center; width: 18px; height: 18px; }
.props__actions { display: grid; gap: 2px; padding-top: 6px; border-top: 1px solid var(--line); }
.props__action {
  display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 10px; justify-items: start;
  width: 100%; padding: 9px 10px; border: 0; border-radius: 10px; background: transparent;
  color: var(--muted); font: inherit; font-size: 14px; text-align: left; cursor: pointer;
}
.props__action:hover:not(:disabled) { background: var(--surface2); color: var(--text); }
.props__action .props__name { font-weight: 500; }
.props__action:disabled { cursor: progress; opacity: .6; }
</style>
