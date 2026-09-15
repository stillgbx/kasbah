<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import Stats from 'three/addons/libs/stats.module.js'
import type { HouseScene, SceneDebugStats } from '../../three/HouseScene'

// Voile de débogage du rendu 3D (Réglages → Rendu 3D → Débogage). Deux étages :
//
//  - les courbes de `stats.js` (FPS, ms, mémoire) — celles de three, telles quelles. Elles sont
//    branchées en SONDE autour de chaque image rendue (`HouseScene.setProbe`) et non sur une boucle
//    à part : le rendu est à la demande, une boucle indépendante compterait des images qui n'existent
//    pas. Les trois panneaux sont montrés ensemble plutôt qu'à tour de rôle au clic ;
//  - un relevé chiffré que la scène tient déjà pendant qu'elle dessine, relu deux fois par seconde.
//    Un panneau qui se redessine à chaque image fausserait ce qu'il prétend mesurer.
//
// Ce qu'il faut savoir lire :
//  - « img/s » (et la courbe FPS) à 0 au repos est NORMAL : le rendu est à la demande
//    (`three/core/renderLoop.ts`). Le chiffre qui compte se lit pendant qu'on tourne autour de la maison.
//  - « rendu » est le temps passé DANS `render()`. Ce n'est pas du CPU pur : quand la file de
//    commandes du GPU est pleine, le pilote bloque à l'envoi et cette attente s'y retrouve. À lire
//    avec « img/s » : à 60 Hz, une image qui dépasse 16,7 ms tombe mécaniquement à 30 — autrement
//    dit, entre 28 et 30 images par seconde, il ne manque souvent que deux ou trois millisecondes.
//  - « appels » et « triangles » sont des totaux d'IMAGE, toutes passes comprises.
//  - « passes » : 1 (la matière) + une par niveau qui a quelque chose de plus à montrer (une lampe
//    allumée, un décor). Sur une maison de trente pièces, chaque passe redessine tout le bâti.
//  - « ombres ✓ » signifie que la carte d'ombre vient d'être refaite. Pendant une orbite, elle doit
//    rester à ✗ : rien de ce qui porte une ombre n'a bougé.

const props = defineProps<{ scene: () => HouseScene | null }>()

const stats = ref<SceneDebugStats | null>(null)
const graphs = useTemplateRef<HTMLDivElement>('graphs')
let timer: ReturnType<typeof setInterval> | null = null
let probe: InstanceType<typeof Stats> | null = null
let attached = false

onMounted(() => {
  // `stats.module.js` est une fabrique qui rend son objet ; `new` la satisfait comme son appel nu,
  // et c'est la forme que ses types déclarent.
  probe = new Stats()
  probe.dom.style.cssText = 'position:static;display:flex;gap:2px;cursor:default'
  for (const child of probe.dom.children) (child as HTMLElement).style.display = 'block'
  graphs.value?.append(probe.dom)
  // La sonde se pose au PREMIER relevé où la scène existe, pas au montage : Vue monte les enfants
  // avant d'exécuter le `onMounted` du parent, et c'est là que `useHouseScene` construit la scène.
  // Posée au montage, elle l'était sur `null` — les courbes restaient figées pendant que les
  // chiffres, eux, se mettaient à jour (ils relisent la scène à chaque fois).
  timer = setInterval(() => {
    const scene = props.scene()
    if (scene && !attached) { scene.setProbe(probe); attached = true }
    stats.value = scene?.debugStats() ?? null
  }, 500)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (attached) props.scene()?.setProbe(null)
  probe?.dom.remove()
})

const n = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))
</script>

<template>
  <div class="dbg" aria-hidden="true">
    <div ref="graphs" class="dbg__graphs" />
    <template v-if="stats">
      <div class="dbg__row"><span>img/s</span><b>{{ stats.fps }}</b></div>
      <div class="dbg__row"><span>rendu</span><b>{{ stats.cpuMs }} ms</b></div>
      <div class="dbg__row"><span>appels</span><b>{{ n(stats.calls) }}</b></div>
      <div class="dbg__row"><span>triangles</span><b>{{ n(stats.triangles) }}</b></div>
      <div class="dbg__row"><span>passes</span><b>{{ stats.passes }}</b></div>
      <div class="dbg__row"><span>ombres</span><b>{{ stats.shadowsRebuilt ? '✓' : '✗' }} · {{ stats.pointShadows }} pt</b></div>
      <div class="dbg__row"><span>marqueurs</span><b>{{ stats.markers }}</b></div>
      <div class="dbg__row"><span>qualité</span><b>{{ stats.quality }} · ×{{ stats.pixelRatio }}</b></div>
      <div class="dbg__row dbg__row--dim"><span>mémoire</span><b>{{ stats.geometries }}g · {{ stats.textures }}t · {{ stats.programs }}p</b></div>
    </template>
  </div>
</template>

<style scoped>
.dbg {
  position: absolute; left: calc(var(--rail-w) + 12px); bottom: 12px; z-index: 3;
  display: grid; gap: 1px; padding: 8px 10px; border-radius: var(--radius-sm);
  /* Opaque et sans filtre de fond : un instrument de mesure ne doit rien coûter à ce qu'il mesure. */
  background: var(--surface); border: 1px solid var(--line);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text);
  pointer-events: none; min-width: 168px;
}
.dbg__graphs { margin-bottom: 6px; }
.dbg__row { display: flex; justify-content: space-between; gap: 12px; }
.dbg__row span { color: var(--muted); }
.dbg__row--dim { opacity: .7; }
</style>
