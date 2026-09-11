<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize, usePreferredReducedMotion } from '@vueuse/core'
import type { StateFor } from '@kasbah/shared'
import { formatPercent, formatPower } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { IconName } from '../../lib/strokeIcons'

// Schéma des flux d'énergie. La MAISON est au centre, dans un anneau qui montre d'où vient sa
// consommation — soleil, batterie, réseau — et les sources autour, reliées en angles droits. Un
// point parcourt chaque trait dans le sens réel du courant : un chiffre seul ne dit pas si 2,4 kW
// entrent ou sortent. Les MOTS restent — « injection », « décharge » — pour expliquer la flèche.
//
// Le repère SVG est la scène MESURÉE, en pixels : une unité SVG par pixel, donc rien n'est étiré,
// les angles restent droits et le point reste un disque. Mesurer plutôt que figer un rapport
// d'aspect, parce que ni `aspect-ratio` ni un `padding` en pourcentage ne dimensionnent une rangée
// de grille — la carte restait haute de 79 px pendant que le schéma s'étalait sur 467 px.
//
// Rien ne bouge quand une valeur change : les nœuds sont à demeure, les trois parts de l'anneau
// sont toujours listées (même à zéro), et un flux au repos garde son trait, en gris.

const props = defineProps<{ energy: StateFor<'energy'>; charger?: StateFor<'ev_charger'> | undefined }>()
const { t, locale } = useI18n()
/** Identifiants uniques : deux schémas sur une page ne doivent pas partager leurs trajets. */
const uid = useId()
const reduced = usePreferredReducedMotion()

const stage = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(stage)
/** Tant que la scène n'est pas mesurée, il n'y a pas de repère où tracer. */
const measured = computed(() => width.value > 0 && height.value > 0)

/** Ancre de chaque source, en fraction de la scène. La maison occupe le centre. */
const POS = {
  solar: { x: 0.16, y: 0.22 },
  battery: { x: 0.84, y: 0.22 },
  grid: { x: 0.16, y: 0.78 },
  charger: { x: 0.84, y: 0.78 },
} as const
type NodeKey = keyof typeof POS

/** Rayon de l'anneau : une part de la plus petite dimension, pour qu'il tienne dans tous les cadres. */
const radius = computed(() => Math.max(44, Math.min(width.value, height.value) * 0.22))
const centre = computed(() => ({ x: width.value / 2, y: height.value / 2 }))

/** En dessous, il ne passe rien : un fil au repos ne doit pas scintiller. */
const IDLE_W = 20
/** Puissance à laquelle le point file le plus vite. */
const FULL_W = 6000
/** Rayons du point, en pixels puisque le repère l'est aussi. */
const DOT = { halo: 9, core: 4 }

const e = computed(() => props.energy)

interface Flow { key: NodeKey; direction: 'in' | 'out' | 'idle'; watts: number }

/**
 * `in` : le courant va de la source VERS la maison. `out` : il en sort. Le trajet est toujours écrit
 * de la source vers la maison, et `out` fait revenir le point en arrière.
 */
const flows = computed<Flow[]>(() => {
  const s = e.value
  const flow = (key: NodeKey, towardsHouse: number): Flow =>
    Math.abs(towardsHouse) < IDLE_W
      ? { key, direction: 'idle', watts: 0 }
      : { key, direction: towardsHouse > 0 ? 'in' : 'out', watts: Math.abs(towardsHouse) }
  return [
    flow('solar', s.productionW),                     // le solaire alimente, jamais l'inverse
    flow('grid', s.gridW),                            // `gridW` > 0 = soutirage, donc vers la maison
    flow('battery', -(s.batteryW ?? 0)),              // `batteryW` > 0 = charge, donc depuis la maison
    flow('charger', -(props.charger?.powerW ?? 0)),   // la borne consomme
  ]
})

/** Rayon du coude. Un angle vif se lit mal à cette épaisseur de trait. */
const CORNER = 14
/** Écart du segment vertical au centre, en part du rayon : d'où l'arrivée tombe sur l'anneau. */
const APPROACH = 0.45

/**
 * Trajet en L : on quitte la source par le CÔTÉ, à l'horizontale, puis on descend ou on monte pour
 * arriver sur le HAUT ou le BAS de l'anneau. Le point d'arrivée est calculé par Pythagore, pour
 * toucher le cercle exactement — une distance approchée mordrait dessus ou s'arrêterait dans le vide.
 * Le départ est pris au centre de la source : sa boîte, opaque, cache le bout qui la traverse.
 */
function path(key: NodeKey): string {
  const p = POS[key]
  const c = centre.value, r = radius.value
  const x0 = p.x * width.value, y0 = p.y * height.value
  const dx = (p.x < 0.5 ? -1 : 1) * r * APPROACH
  const xv = c.x + dx
  const yIn = c.y + (p.y < 0.5 ? -1 : 1) * Math.sqrt(Math.max(1, r * r - dx * dx))
  const sx = Math.sign(xv - x0), sy = Math.sign(yIn - y0)
  const k = Math.min(CORNER, Math.abs(xv - x0) / 2, Math.abs(yIn - y0) / 2)
  const n = (v: number) => v.toFixed(1)
  return `M ${n(x0)} ${n(y0)} H ${n(xv - sx * k)} Q ${n(xv)} ${n(y0)} ${n(xv)} ${n(y0 + sy * k)} V ${n(yIn)}`
}

/**
 * Un tour complet du point. Volontairement LENT : le schéma se regarde, il ne court pas. Neuf
 * secondes quand il ne passe presque rien, cinq à pleine puissance.
 */
const duration = (watts: number) => `${(9 - 4 * Math.min(1, watts / FULL_W)).toFixed(1)}s`
const pathId = (key: NodeKey) => `flow-${uid}-${key}`

/**
 * D'où vient ce que la maison consomme. Le bilan du contrat se lit
 * `consommation = production + réseau − batterie`, donc ce qui l'alimente est le soutirage, la
 * décharge, et le solaire pour le reste. Une charge ou une injection ne sont PAS des parts de la
 * consommation : elles en sortent.
 */
const mix = computed(() => {
  const s = e.value
  // même seuil que les traits : une source sous `IDLE_W` ne fait pas bouger de point, elle ne doit
  // donc pas revendiquer une part de l'anneau — « 1 % batterie » sans électron était déroutant
  const over = (w: number) => (w >= IDLE_W ? w : 0)
  const fromGrid = over(Math.max(0, s.gridW))
  const fromBattery = over(Math.max(0, -(s.batteryW ?? 0)))
  const fromSolar = Math.max(0, s.consumptionW - fromGrid - fromBattery)
  const total = fromSolar + fromGrid + fromBattery
  const share = (w: number) => (total > 0 ? w / total : 0)
  return [
    { key: 'solar' as const, label: t('home.solar'), part: share(fromSolar) },
    { key: 'battery' as const, label: t('energy.battery'), part: share(fromBattery) },
    { key: 'grid' as const, label: t('energy.grid'), part: share(fromGrid) },
  ]
})

/** Anneau dans son propre repère CARRÉ : aucune déformation à corriger. */
const RING = { r: 44, w: 9 }
const CIRC = 2 * Math.PI * RING.r
/** Chaque part démarre où la précédente s'arrête ; la rotation CSS place le départ en haut. */
const arcs = computed(() => {
  let start = 0
  return mix.value.map((m) => {
    const len = m.part * CIRC
    const arc = { key: m.key, len, offset: -start }
    start += len
    return arc
  })
})

interface NodeView { key: NodeKey; icon: IconName; value: string; label: string; hint: string; shown: boolean }

const nodes = computed<NodeView[]>(() => {
  const s = e.value
  const battW = s.batteryW ?? 0
  return [
    { key: 'solar', icon: 'solar', value: formatPower(s.productionW, locale.value), label: t('energy.production'), hint: '', shown: true },
    {
      key: 'battery', icon: 'battery',
      value: s.batterySoc !== undefined ? formatPercent(s.batterySoc, locale.value) : '—',
      label: t('energy.battery'),
      hint: s.batteryW !== undefined ? `${t(battW >= 0 ? 'energy.charging' : 'energy.discharging')} ${formatPower(Math.abs(battW), locale.value)}` : '',
      shown: s.batterySoc !== undefined || s.batteryW !== undefined,
    },
    {
      key: 'grid', icon: 'grid', value: formatPower(Math.abs(s.gridW), locale.value),
      label: t('energy.grid'), hint: t(s.gridW >= 0 ? 'energy.import' : 'energy.export'), shown: true,
    },
    {
      key: 'charger', icon: 'charger', value: formatPower(props.charger?.powerW ?? 0, locale.value),
      label: t('energy.charger'), hint: props.charger ? t(`charger.status.${props.charger.status}`) : '', shown: !!props.charger,
    },
  ]
})

const shown = (key: NodeKey) => nodes.value.find((n) => n.key === key)!.shown
const flowOf = (key: NodeKey) => flows.value.find((f) => f.key === key)!
</script>

<template>
  <section class="flow card" :aria-label="$t('energy.flowTitle')">
    <!-- Ce que le bloc montre, dit en toutes lettres : ici l'instant, à côté la journée. Les deux
         blocs de la ligne ne parlent pas de la même échelle de temps, et rien ne le disait. -->
    <div class="flow__head">
      <div class="flow__title">{{ $t('energy.flowTitle') }}</div>
      <div class="muted flow__scale">{{ $t('energy.instant') }}</div>
    </div>
    <!-- Le cadre découpe, la scène garde sa largeur minimale : en dessous, les quatre nœuds et
         l'anneau ne peuvent PAS tenir côte à côte, et se chevauchaient au lieu de se lire. -->
    <div class="flow__viewport">
      <div ref="stage" class="flow__stage">
        <svg v-if="measured" class="flow__links" :viewBox="`0 0 ${Math.round(width)} ${Math.round(height)}`" aria-hidden="true">
          <template v-for="f in flows" :key="f.key">
            <path v-if="shown(f.key)" :id="pathId(f.key)" class="flow__wire" :d="path(f.key)" />
          </template>
          <!-- un seul point par trajet actif, lent : il part de la source vers la maison, ou l'inverse -->
          <template v-for="f in flows" :key="`dot-${f.key}`">
            <g v-if="shown(f.key) && f.direction !== 'idle'" class="flow__dot">
              <circle class="flow__halo" :r="DOT.halo" />
              <circle class="flow__core" :r="DOT.core" />
              <animateMotion v-if="reduced !== 'reduce'" :dur="duration(f.watts)" repeatCount="indefinite"
                             calcMode="linear" :keyPoints="f.direction === 'out' ? '1;0' : '0;1'" keyTimes="0;1">
                <mpath :href="`#${pathId(f.key)}`" />
              </animateMotion>
            </g>
          </template>
        </svg>

        <!-- La maison, au centre, dans l'anneau de l'origine de sa consommation. -->
        <div class="hub" :style="{ width: `${radius * 2}px`, height: `${radius * 2}px` }">
          <svg class="hub__ring" viewBox="0 0 100 100" :aria-label="$t('energy.mix')">
            <circle class="hub__track" cx="50" cy="50" :r="RING.r" :stroke-width="RING.w" />
            <circle v-for="a in arcs" :key="a.key" class="hub__arc" :data-part="a.key"
                    cx="50" cy="50" :r="RING.r" :stroke-width="RING.w"
                    :stroke-dasharray="`${a.len.toFixed(2)} ${(CIRC - a.len).toFixed(2)}`"
                    :stroke-dashoffset="a.offset.toFixed(2)" />
          </svg>
          <div class="hub__inner">
            <StrokeIcon class="hub__icon" name="home" :size="18" />
            <span class="hub__value">{{ formatPower(e.consumptionW, locale) }}</span>
            <span class="muted hub__label">{{ $t('energy.house') }}</span>
          </div>
        </div>

        <!-- Les trois parts, TOUJOURS listées, même à zéro : une part qui apparaît ne doit pas
             décaler ses voisines. -->
        <div class="legend">
          <span v-for="m in mix" :key="m.key" class="legend__item" :data-part="m.key" :data-on="m.part > 0 ? '1' : '0'">
            <span class="legend__dot" />{{ formatPercent(Math.round(m.part * 100), locale) }}
            <span class="muted legend__label">{{ m.label }}</span>
          </span>
        </div>

        <div v-for="n in nodes" v-show="n.shown" :key="n.key" class="node"
             :data-on="flowOf(n.key).direction !== 'idle' ? '1' : '0'"
             :style="{ left: `${POS[n.key].x * 100}%`, top: `${POS[n.key].y * 100}%` }">
          <span class="node__icon"><StrokeIcon :name="n.icon" :size="16" /></span>
          <span class="node__value">{{ n.value }}</span>
          <span class="muted node__label">{{ n.label }}</span>
          <!-- place tenue même vide : un flux qui s'inverse ne doit pas redimensionner son nœud -->
          <span class="muted node__hint">{{ n.hint || ' ' }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* PAS d'`overflow` sur la carte : une cellule de grille qui découpe son contenu ne contribue plus à
   la hauteur de sa rangée, et la carte restait haute de 79 px par-dessus le graphique du dessous. La
   découpe vit sur la scène, qui n'est pas une cellule de grille.
   La largeur vient de la colonne qui l'accueille (`energy__top`), pas de la carte. */
/* `min-width: 0` : sans lui, une cellule de grille prend la largeur MINIMALE de son contenu, et la
   largeur plancher de la scène remontait jusqu'à faire déborder la page entière. */
.flow { padding: 0; min-width: 0; }
/* Le titre est en retrait, le schéma touche les bords : c'est déjà le parti pris de la carte.
   L'échelle est SOUS le titre, et non à côté : à côté, elle entrait en concurrence avec le total du
   bloc voisin, dont la longueur varie avec la valeur — l'en-tête changeait alors de hauteur. */
.flow__head { padding: 18px 20px 0; }
.flow__title { font-weight: 600; font-size: 14px; }
.flow__scale { font-size: 12px; }
/* Le cadre découpe et défile à l'horizontale ; la hauteur DÉFINIE vit sur la scène, seule à
   dimensionner vraiment la rangée de grille. */
.flow__viewport { overflow-x: auto; overflow-y: hidden; border-radius: var(--radius); }
/* 380 px : en dessous, le nœud de gauche mord sur l'anneau (mesuré, pas estimé). */
.flow__stage { position: relative; width: 100%; min-width: 380px; height: clamp(320px, 40vh, 420px); }
.flow__links { position: absolute; inset: 0; width: 100%; height: 100%; }
.flow__wire { fill: none; stroke: var(--line); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.flow__halo { fill: var(--accent); opacity: 0.18; }
.flow__core { fill: var(--accent); }

.hub {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: grid; place-items: center; border-radius: 50%; background: var(--surface2);
}
.hub__ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.hub__track, .hub__arc { fill: none; }
.hub__track { stroke: var(--line); }
.hub__arc { stroke-linecap: butt; transition: stroke-dasharray .4s ease, stroke-dashoffset .4s ease; }
/* Trois parts tirées du SEUL accent : pleine pour le soleil, à demi pour la batterie, gris neutre
   pour le réseau. Aucune couleur nouvelle, donc les quatre accents du réglage restent respectés. */
.hub__arc[data-part='solar'] { stroke: var(--accent); }
.hub__arc[data-part='battery'] { stroke: var(--accent); opacity: 0.45; }
.hub__arc[data-part='grid'] { stroke: var(--muted); }
.legend__item[data-part='solar'] .legend__dot { background: var(--accent); }
.legend__item[data-part='battery'] .legend__dot { background: var(--accent); opacity: 0.45; }
.legend__item[data-part='grid'] .legend__dot { background: var(--muted); }
.hub__inner { display: grid; justify-items: center; text-align: center; z-index: 1; }
.hub__icon { color: var(--accent); }
.hub__value { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hub__label { font-size: 12px; }

/* Au BAS de la scène, et non juste sous l'anneau : centrée là, elle mordait sur le nœud Réseau. */
.legend { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 12px; white-space: nowrap; font-size: 11px; }
.legend__item { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
.legend__item[data-on='0'] { opacity: 0.4; }
.legend__dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.legend__label { font-size: 11px; }

.node {
  position: absolute; transform: translate(-50%, -50%);
  display: grid; justify-items: center; gap: 1px;
  padding: 8px 10px; border-radius: var(--radius);
  background: var(--surface); border: 1px solid var(--line);
  min-width: 96px; text-align: center;
}
.node[data-on='1'] { border-color: var(--accent); }
.node__icon { display: inline-flex; color: var(--muted); }
.node[data-on='1'] .node__icon { color: var(--accent); }
.node__value { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.node__label { font-size: 12px; }
.node__hint { font-size: 11px; min-height: 1.2em; white-space: nowrap; }
</style>
