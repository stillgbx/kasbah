<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry } from '@kasbah/shared'
import { inverterGroups, isInverter, type InverterCell, type InverterGroup } from '../../lib/energy'
import { formatPower } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'

// Ce que produit chaque micro-onduleur, à l'instant, DESSINÉ COMME LE CHAMP : une case par
// emplacement, rangées et colonnes de la grille déclarée dans la maison — la même vue que la scène
// 3D, en texte. La case du haut à gauche est le module du haut à gauche du toit, et sa jauge de fond
// dit sa part de crête : le panneau à l'ombre, sous une feuille ou en panne se voit d'un coup d'œil,
// à sa place. En liste à plat, il aurait fallu lire vingt numéros de série pour le retrouver.
const props = defineProps<{ site: DeviceEntry }>()
const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()

/** Les onduleurs de CETTE installation : capteurs de puissance publiés par le même plugin que le site. */
const inverters = computed(() => devices.list.filter((e) => isInverter(e.descriptor, props.site.descriptor.pluginId)))
const groups = computed(() => inverterGroups(house.arraysOf(props.site.descriptor.id), inverters.value))

/** Même nom que dans la carte « Champs de panneaux » : celui du JSON, sinon « Champ n ». */
function label(g: InverterGroup): string {
  return g.name ?? (g.index === null ? t('energy.invertersLoose') : t('arrays.field', { n: g.index + 1 }))
}
/** Ce que dit la case au survol : l'onduleur, sa place, sa puissance — ce que la case ne tient pas. */
function cellTitle(g: InverterGroup, c: InverterCell): string {
  const place = g.index === null ? t('energy.noSlot') : t('arrays.slot', { r: c.row, c: c.col })
  if (!c.id) return place
  const watts = c.available ? formatPower(c.watts, locale.value) : t('common.unavailable')
  const out = at(g, g.maxOutputW) ? ` · ${t('arrays.maxOutput')} ${formatPower(g.maxOutputW, locale.value)}` : ''
  const rec = at(g, c.maxW) ? ` · ${t('energy.maxReported')} ${formatPower(c.maxW, locale.value)}` : ''
  return `${c.name} · ${place} · ${watts}${out}${rec}`
}
/** Jauge d'une case : sa puissance rapportée à l'échelle du champ (`scaleW`). */
const fill = (g: InverterGroup, c: InverterCell) => Math.min(1, Math.max(0, c.watts / g.scaleW))
/**
 * Où poser un repère sur la jauge (0 = valeur inconnue, donc pas de repère). L'échelle contient
 * toujours les deux repères : aucun n'est écarté pour dépasser, c'est l'échelle qui s'ouvre.
 */
const at = (g: InverterGroup, watts: number) => (watts > 0 ? Math.min(1, watts / g.scaleW) : 0)
</script>

<template>
  <section v-if="groups.length > 0" class="band">
    <h2 class="band__title muted">{{ $t('arrays.inverters') }}</h2>
    <div class="cards">
      <section v-for="g in groups" :key="g.id || 'loose'" class="card group">
        <div class="group__head">
          <div class="group__title">{{ label(g) }}</div>
          <!-- chiffres tabulaires et largeur minimale : le total change tout seul sans déplacer le titre -->
          <div class="muted group__total">{{ formatPower(g.totalW, locale) }}</div>
        </div>
        <!-- l'échelle de temps sous le titre, comme les autres blocs de la vue -->
        <div class="muted group__sub">{{ $t('energy.instant') }}</div>
        <!-- La grille du champ : autant de colonnes qu'il en déclare, rangée 1 en haut (celle de
             l'origine, cf. `panelArrayDevices`). Elle défile à l'horizontale plutôt que de serrer
             ses cases quand un champ est plus large que la carte. -->
        <div class="grid__scroll">
          <div class="grid" :style="{ '--cols': g.cols }">
            <div v-for="c in g.cells" :key="c.key" class="cell" :data-on="c.id ? '1' : '0'" :title="cellTitle(g, c)">
              <span class="cell__fill" aria-hidden="true" :style="{ '--k': fill(g, c) }" />
              <!-- Deux repères au pied de la jauge. Le RECORD d'abord (ce que cet onduleur a déjà
                   sorti un jour), le PLAFOND par-dessus (ce que sa fiche technique lui accorde) :
                   quand les deux coïncident — l'onduleur a déjà tapé dans son maximum — il ne reste
                   que le plafond, et c'est bien ce qu'il y a à dire. Sans eux, une jauge qui
                   s'arrête aux trois quarts par beau temps se lit comme un module qui faiblit. -->
              <span v-if="c.id && at(g, c.maxW)" class="cell__mark cell__mark--record" aria-hidden="true" :style="{ '--at': at(g, c.maxW) }" />
              <span v-if="c.id && at(g, g.maxOutputW)" class="cell__mark cell__mark--max" aria-hidden="true" :style="{ '--at': at(g, g.maxOutputW) }" />
              <span class="cell__id">{{ c.label }}</span>
              <!-- un onduleur muet ne vaut pas 0 W : il ne rapporte rien, et le tiret le dit -->
              <span v-if="c.id" class="cell__w">{{ c.available ? formatPower(c.watts, locale) : '—' }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.band__title { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 8px 2px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; align-items: start; }
/* `min-width: 0` : sans lui, une carte s'élargirait pour contenir la grille d'un champ très large,
   et c'est la page entière qui déborderait au lieu de la grille qui défile. */
.group { padding: 16px 20px; min-width: 0; }
.group__head { display: flex; align-items: baseline; gap: 12px; }
.group__title { flex: 1 1 0; min-width: 0; font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group__total { flex: 0 0 auto; min-width: 68px; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }
.group__sub { font-size: 12px; margin-bottom: 10px; }
.grid__scroll { overflow-x: auto; }
.grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(52px, 1fr)); gap: 5px; }
/* Hauteur FIXE, pas un rapport de forme : une cellule de grille qui tire sa hauteur de son contenu
   (ou d'un `aspect-ratio`) ne dimensionne pas sa rangée, et la grille s'écrase (cf. FAQ outillage). */
.cell {
  position: relative; isolation: isolate; overflow: hidden;
  height: 44px; display: grid; align-content: center; justify-items: center; gap: 2px;
  border-radius: 9px; border: 1px solid var(--line); padding: 0 3px; text-align: center;
}
/* case sans onduleur : l'emplacement existe sur le toit, il n'a juste rien à dire */
.cell[data-on='0'] { border-style: dashed; opacity: .6; }
/* Jauge de la case : une bande qui part du bord gauche, à bord FRANC — c'est ce bord qu'on compare
   au trait d'écrêtage, un fondu le rendrait illisible. Sous le texte (z-index négatif) : rien ne
   bouge quand la production change. */
.cell__fill {
  position: absolute; left: 0; top: 0; bottom: 0; z-index: -1; pointer-events: none;
  width: calc(var(--k) * 100%); background: var(--accent); opacity: .38;
  transition: width .4s ease;
}
/* Repères du pied de jauge : quelques pixels de haut, posés sur la ligne du bas, pour ne pas barrer
   la case ni gêner la lecture du chiffre. Par-dessus la jauge (mais sous le texte) : ils restent
   visibles qu'elle les ait atteints ou non. */
.cell__mark {
  position: absolute; bottom: 0; z-index: -1; pointer-events: none;
  /* la course s'arrête à la largeur du repère : à fond d'échelle il reste ENTIER dans la case,
     là où un repère centré sur 100 % se serait fait couper en deux par le bord */
  left: calc(var(--at) * (100% - 2px)); width: 2px; height: 7px; border-radius: 1px 1px 0 0;
}
/* la couleur du repère de position favorite d'un ouvrant : dans cette maison, un repère se pose en `warning` */
.cell__mark--max { background: rgb(var(--v-theme-warning)); }
/* le record est un fait passé, pas une limite : une teinte plus froide, et il passe DERRIÈRE le plafond */
.cell__mark--record { background: rgb(var(--v-theme-success)); }
@media (prefers-reduced-motion: reduce) { .cell__fill { transition: none; } }
.cell__id { font-size: 10px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; line-height: 1; }
.cell__w { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
</style>
