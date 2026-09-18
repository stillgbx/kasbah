<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { OPENING_MATERIALS, type DeviceDescriptor, type OpeningMaterial } from '@kasbah/shared'
import { coverLeaves, hasLeaves } from '../../lib/orientation'
import { useHouseStore } from '../../stores/house'

/**
 * Ce que seule la MAISON sait d'un ouvrant : ses vantaux, sa matière, sa couleur. Le fabricant ne
 * dit rien de tout cela — un moteur Somfy publie une course en pourcents, pas un volet bois blanc à
 * deux battants —, et ces trois-là vivent donc dans `house.devices[]`, exactement comme les mêmes
 * réglages vivent dans l'ouverture pour une menuiserie (`OpeningPanel`).
 *
 * Les trois sont FACULTATIFS et le panneau le montre : « Automatique » pour la matière, une croix
 * pour rendre la couleur. Un ouvrant qui n'en dit rien garde ce que le style de rendu lui donne, et
 * une maison relevée hier ne change pas d'aspect parce que ces réglages existent.
 *
 * Les vantaux ne changent pas la COURSE, seulement le dessin : un tablier d'un seul tenant, ou deux
 * panneaux séparés d'un refend — c'est ainsi qu'on lit un volet battant. La course, elle, reste
 * celle que l'état publie.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()

const houseDevice = computed(() => house.houseDeviceFor(props.descriptor.id))
/** Un store banne se déploie : il n'a pas de vantaux à compter (`hasLeaves`). */
const leavesShown = computed(() => !!houseDevice.value && hasLeaves(houseDevice.value, props.descriptor))
const leaves = computed(() => (houseDevice.value ? coverLeaves(houseDevice.value, props.descriptor) : 1))
function setLeaves(raw: string): void {
  const next = raw === '2' ? 2 : 1
  if (next === leaves.value) return
  void house.setDeviceTuning(props.descriptor.id, { leaves: next })
}

/** `''` = automatique : la clé quitte le fichier et le style de rendu reprend la main. */
const material = computed(() => houseDevice.value?.coverMaterial ?? '')
function setMaterial(raw: string): void {
  // `find` plutôt qu'une conversion : ce que le sélecteur rend est une chaîne, et une valeur
  // inconnue retombe sur l'automatique au lieu d'entrer dans le fichier
  const next: OpeningMaterial | '' = OPENING_MATERIALS.find((m) => m === raw) ?? ''
  if (next === material.value) return
  void house.setDeviceTuning(props.descriptor.id, { coverMaterial: next })
}

const color = computed(() => houseDevice.value?.coverColor ?? '')
/**
 * Ce que le sélecteur natif montre quand rien n'est choisi : un gris d'aluminium, pas un noir. La
 * vraie teinte vit dans la palette du style de rendu et ne se lit pas d'ici — mais on peut partir
 * d'une valeur qui ressemble à ce qu'on voit (même convention que `OpeningPanel`).
 */
const DEFAULT_SWATCH = '#b8bcc0'
function setColor(value: string): void {
  if (value === color.value) return
  void house.setDeviceTuning(props.descriptor.id, { coverColor: value })
}
/**
 * La teinte se voit PENDANT qu'on la choisit : le sélecteur natif annonce chaque nuance survolée et
 * la scène la pose tout de suite sur le tablier — c'est comme ça qu'on juge une couleur, volet sous
 * les yeux. Seul le choix validé (`change`) est écrit ; un choix abandonné rend la teinte d'avant.
 */
const preview = (value: string | null) => house.previewBodyColor(props.descriptor.id, value)
onBeforeUnmount(() => preview(null))
</script>

<template>
  <div class="card card--soft tune">
    <label v-if="leavesShown" class="tune__row">
      <span class="muted tune__k">{{ $t('opening.leaves') }}</span>
      <span class="tune__fields">
        <select :value="String(leaves)" @change="setLeaves(($event.target as HTMLSelectElement).value)">
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </span>
    </label>
    <label class="tune__row">
      <span class="muted tune__k">{{ $t('opening.material') }}</span>
      <span class="tune__fields">
        <select :value="material" @change="setMaterial(($event.target as HTMLSelectElement).value)">
          <option value="">{{ $t('opening.materials.auto') }}</option>
          <option v-for="m in OPENING_MATERIALS" :key="m" :value="m">{{ $t(`opening.materials.${m}`) }}</option>
        </select>
      </span>
    </label>
    <!-- `for` EXPLICITE : un label sans `for` active son premier descendant étiquetable, et la croix
         vient avant le champ — cliquer la ligne effacerait le choix qu'on vient de faire. -->
    <label class="tune__row" :for="`cover-color-${descriptor.id}`">
      <span class="muted tune__k">{{ $t('opening.color') }}</span>
      <span class="tune__fields">
        <!-- place RÉSERVÉE : la croix s'efface sans que le sélecteur bouge, elle n'apparaît pas -->
        <button type="button" class="tune__reset" :class="{ 'tune__reset--off': !color }"
                :disabled="!color" :tabindex="color ? 0 : -1"
                :title="$t('opening.colorReset')" :aria-label="$t('opening.colorReset')" @click="setColor('')">×</button>
        <input :id="`cover-color-${descriptor.id}`" type="color" :value="color || DEFAULT_SWATCH"
               @input="preview(($event.target as HTMLInputElement).value)"
               @change="setColor(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
  </div>
</template>

<style scoped>
/* même gabarit que les réglages d'un véhicule : les deux vivent dans la carte pliante du panneau */
.tune { padding: 10px 12px; display: grid; gap: 10px; }
.tune__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.tune__k { flex: 1 1 auto; min-width: 0; }
.tune__fields { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.tune select {
  width: 96px; padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px;
}
/* même gabarit que les sélecteurs : la ligne ne change pas de hauteur d'une section à l'autre */
.tune input[type='color'] { width: 96px; height: 28px; padding: 2px; cursor: pointer; }
.tune__reset {
  width: 22px; height: 22px; padding: 0; line-height: 1;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer;
}
.tune__reset--off { visibility: hidden; }
</style>
