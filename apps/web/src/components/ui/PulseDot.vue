<script setup lang="ts">
// Point pulsant « quelque chose est en cours ». Son ESPACE EST TOUJOURS RÉSERVÉ : éteint, il reste
// un carré transparent de la même taille. Un indicateur qui apparaît et disparaît en occupant de
// la place décale ses voisins — un curseur qui change de largeur, une ligne qui pousse celle du
// dessous. Règle de l'utilisateur, appliquée ici une fois pour les trois endroits qui l'affichent.
//
// Le parent gère l'espacement (une ligne en `flex` a son `gap`, un texte a besoin d'une marge).
defineProps<{ on: boolean; size?: number }>()
</script>

<template>
  <span class="pulse" :data-on="on ? '1' : '0'" :style="{ '--dot': `${size ?? 6}px` }" aria-hidden="true" />
</template>

<style scoped>
.pulse {
  display: inline-block; flex: 0 0 auto; vertical-align: middle;
  width: var(--dot); height: var(--dot); border-radius: 50%; background: transparent;
}
.pulse[data-on='1'] { background: currentColor; animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
</style>
