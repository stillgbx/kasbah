<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { OPENING_TYPES, openingLabel, type Opening } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import ParkingRows from './ParkingRows.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau d'une pièce en MODE ÉDITION : ce qu'on peut modifier DE LA PIÈCE, à la place des appareils
// qu'on pilote le reste du temps. Le mode est armé dans Réglages, donc le geste est déjà décidé : on
// relève la maison, on ne l'allume pas — et le même tap sur la même pièce donne toujours la même
// chose, sans onglet à retenir dans le panneau.
//
// Deux matières : les ouvertures de la pièce, et les places de stationnement qu'elle porte — on
// ajoute la place d'un garage DEPUIS le garage, et la place créée prend son niveau. Le nom, la
// hauteur sous plafond et le sol de la pièce ont vocation à venir ici, en sections voisines.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const { t } = useI18n()

const room = computed(() => house.selectedRoom)
const levelName = computed(() => (room.value ? house.index?.levelsById.get(room.value.levelId)?.name ?? '' : ''))
const openings = computed(() => room.value?.openings ?? [])
/** `openingLabel` est LA règle d'affichage d'une ouverture ; la nature et les cotes restent en sous-ligne. */
function row(o: Opening) {
  const dims = o.type === 'roof-window' || o.type === 'skylight'
    ? `${o.height.toFixed(2)} × ${o.width.toFixed(2)} m`
    : `${o.width.toFixed(2)} × ${o.height.toFixed(2)} m`
  return { id: o.id, label: openingLabel(o), sub: `${t(`opening.types.${o.type}`)} · ${dims}` }
}

/** Nature armée, en attente du mur qu'on va taper dans la 3D (`house.placeOpeningAt`). */
const armed = computed(() => house.placingOpening)
/** Les places posées dans cette pièce : elles se règlent là où on les pense. */
const parkings = computed(() => (room.value ? house.parkingsInRoom(room.value.id) : []))
</script>

<template>
  <template v-if="room">
    <!-- collant : le fil d'Ariane et le titre restent en vue quand la liste défile (styles/app.css) -->
    <div class="panel-head">
      <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ levelName }}</button>
      <div class="head">
        <div class="min0">
          <div class="title">{{ room.name }}</div>
          <div class="muted sub">{{ levelName }} · {{ $t('opening.count', { n: openings.length }, openings.length) }}</div>
        </div>
      </div>
    </div>

    <section class="block">
      <div class="section-label">{{ $t('opening.list') }}</div>
      <div v-if="openings.length" class="rows">
        <button v-for="o in openings.map(row)" :key="o.id" type="button" class="op-row" @click="house.selectOpening(o.id)">
          <span class="icon-square"><StrokeIcon name="room" :size="18" /></span>
          <div class="op-row__main">
            <div class="op-row__name">{{ o.label }}</div>
            <div class="muted op-row__sub">{{ o.sub }}</div>
          </div>
          <StrokeIcon name="chevron" :size="18" class="muted" />
        </button>
      </div>
      <p v-else class="muted empty">{{ $t('opening.none') }}</p>

      <!-- Ajouter : le menu donne la NATURE, le tap sur le mur donne la place. Le bouton garde la
           même boîte une fois armé (il devient « Annuler ») : rien ne bouge sous le doigt. -->
      <v-menu v-if="!armed" location="bottom start">
        <template #activator="{ props: menu }">
          <button v-bind="menu" type="button" class="pill add" :disabled="house.savingOpening">
            <StrokeIcon name="plus" :size="16" /> {{ $t('opening.add') }}
          </button>
        </template>
        <div class="add-list card">
          <div class="section-label add-list__title">{{ $t('opening.add') }}</div>
          <button v-for="ty in OPENING_TYPES" :key="ty" type="button" class="add-item" @click="house.startPlacingOpening(ty)">
            {{ $t(`opening.types.${ty}`) }}
          </button>
        </div>
      </v-menu>
      <button v-else type="button" class="pill add add--armed" @click="house.cancelPlacingOpening()">
        {{ $t('opening.cancel') }}
      </button>
      <!-- place réservée : la consigne apparaît sans pousser la liste (hauteur fixe, deux lignes) -->
      <p class="muted hint">{{ armed ? $t(armed.type === 'roof-window' ? 'opening.placeHintRoof' : armed.type === 'skylight' ? 'opening.placeHintFloor' : 'opening.placeHint') : '' }}</p>
    </section>

    <ParkingRows :list="parkings" :level-id="room.levelId" />
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
.head { display: flex; align-items: center; gap: 12px; }
.min0 { flex: 1 1 0; min-width: 0; }
.title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.sub { font-size: 13px; margin-top: 2px; }
.block { display: grid; gap: 8px; }
.rows { display: grid; gap: 8px; }
/* même ligne que dans le panneau des appareils, sans interrupteur : c'est un <button> */
.op-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface2); border: 0; width: 100%; text-align: left; font: inherit; color: inherit;
  cursor: pointer; transition: filter .15s;
}
.op-row:hover { filter: brightness(1.03); }
.op-row__main { flex: 1 1 0; min-width: 0; }
.op-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.op-row__sub { font-size: 12px; font-variant-numeric: tabular-nums; }
.empty { font-size: 13px; margin: 0; }
/* pleine largeur dans les deux états : « Ajouter une ouverture » et « Annuler » occupent la même boîte */
.add { width: 100%; justify-content: center; gap: 8px; }
.add--armed { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
/* deux lignes réservées, occupées ou non : la liste ne remonte pas quand la consigne disparaît */
.hint { margin: 0; font-size: 12px; min-height: 32px; }
.add-list { padding: 8px; display: grid; gap: 2px; min-width: 200px; }
.add-list__title { padding: 2px 8px 4px; }
.add-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
}
.add-item:hover { background: var(--surface2); }
</style>
