<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatPercent } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'

/**
 * La CIBLE DE CHARGE, partagée par la carte de la vue Véhicules et le panneau d'un véhicule dans la
 * vue Maison. Une valeur, deux gestes : les paliers, qui se touchent sans viser (80 % est le réglage
 * de tous les jours), et le curseur, qui va au pour cent près pour qui veut 73.
 *
 * La piste montre la BATTERIE ENTIÈRE, de 0 à 100 : c'est d'elle qu'on règle une part, et un curseur
 * qui commencerait à 50 ferait lire une cible de 50 % comme un réservoir vide. Le pouce, lui, ne
 * descend pas sous 50 — aucun constructeur n'accepte moins (Tesla annonce `charge_limit_soc_min` à
 * 50) — et la part hors d'atteinte se voile plutôt que de disparaître.
 *
 * Le parent garde la valeur : `preview` pendant qu'on glisse (il la TIENT, sinon le curseur
 * reviendrait à celle du véhicule à chaque image), `change` quand la commande peut partir.
 */
const LIMIT_MIN = 50
const LIMIT_MAX = 100
const LIMIT_STEPS = [50, 60, 70, 80, 90, 100] as const
/** Les traits dessinés sur la piste : 100 est la fin de la piste, un trait y serait à moitié rogné. */
const MARKS = LIMIT_STEPS.filter((p) => p < LIMIT_MAX)

/** `watermark` : la batterie en filigrane, comme les autres sections de la carte de la vue Véhicules. */
defineProps<{ value: number; disabled?: boolean; hint?: string; watermark?: boolean }>()
const emit = defineEmits<{ preview: [percent: number]; change: [percent: number] }>()
const { locale } = useI18n()

/**
 * La piste descend à 0, la valeur non : on repousse l'input à la borne au lieu de le laisser
 * afficher un 20 que personne n'appliquera.
 */
function clamped(el: HTMLInputElement): number {
  const wanted = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(Number(el.value))))
  if (Number(el.value) !== wanted) el.value = String(wanted)
  return wanted
}
</script>

<template>
  <div class="card card--soft limit">
    <StrokeIcon v-if="watermark" class="limit__wm" name="battery" :size="80" />
    <div class="limit__head">
      <span class="muted limit__k">{{ $t('vehicle.chargeLimit') }}</span>
      <span class="limit__v">{{ formatPercent(value, locale) }}</span>
    </div>
    <div class="limit__steps">
      <button v-for="p in LIMIT_STEPS" :key="p" type="button" class="limit__step"
              :data-on="value === p ? '1' : '0'" :disabled="disabled" :title="hint"
              @click="emit('change', p)">{{ p }}</button>
    </div>
    <!-- la piste est dessinée à part, en retrait d'un demi-pouce de chaque côté : c'est la seule
         façon d'aligner exactement les traits sur le centre du pouce, qui ne va pas jusqu'aux bords -->
    <div class="limit__slider" :data-off="disabled ? '1' : '0'">
      <div class="limit__track">
        <div class="limit__fill" :style="{ width: `${value}%` }" />
        <div class="limit__dead" :style="{ width: `${LIMIT_MIN}%` }" />
        <span v-for="p in MARKS" :key="p" class="limit__mark" :style="{ left: `${p}%` }" />
      </div>
      <input class="limit__range" type="range" min="0" :max="LIMIT_MAX" step="1" :value="value"
             :disabled="disabled" :aria-label="$t('vehicle.chargeLimit')" :title="hint"
             @input="emit('preview', clamped($event.target as HTMLInputElement))"
             @change="emit('change', clamped($event.target as HTMLInputElement))" />
    </div>
  </div>
</template>

<style scoped>
/* Hauteurs FIXES — la ligne ne bouge pas quand la voiture change d'avis, et les six paliers gardent
   leur place quel que soit le chiffre. */
.limit { padding: 10px 12px; display: grid; gap: 8px; }
/* le filigrane de la carte de la vue Véhicules (`.wm` de VehiclesView) : sous le contenu, rogné d'un
   quart de sa surface en bas à droite, aucune place prise */
.limit { position: relative; overflow: hidden; isolation: isolate; }
/* la batterie DEBOUT (borne en haut) : couchée, elle tombait au niveau du curseur et le prolongeait.
   Le corps est au tiers central de l'icône, d'où les décalages : collé au bord droit, rogné en bas */
.limit__wm {
  position: absolute; right: -18px; bottom: -25px; z-index: -1; transform: rotate(-90deg);
  color: var(--text); opacity: .07; pointer-events: none;
}
.limit__head { display: flex; align-items: baseline; justify-content: space-between; }
.limit__k { font-size: 11px; }
.limit__v { font-weight: 500; font-size: 14px; font-variant-numeric: tabular-nums; }
.limit__steps { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.limit__step {
  height: 34px; padding: 0; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); color: var(--text); cursor: pointer;
  font: inherit; font-size: 13px; font-variant-numeric: tabular-nums;
}
.limit__step:hover:not(:disabled) { border-color: var(--accent); }
.limit__step[data-on='1'] { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.limit__step:disabled { opacity: .45; cursor: default; }
/* le curseur : même piste que la jauge du haut, pouce accrochable au doigt */
.limit__slider { position: relative; height: 24px; --thumb: 16px; }
.limit__slider[data-off='1'] { opacity: .45; }
.limit__track {
  position: absolute; inset: 50% calc(var(--thumb) / 2) auto; height: 6px;
  transform: translateY(-50%); border-radius: 999px; background: var(--line); overflow: hidden;
}
.limit__fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); }
/* 0–50 % : la part de batterie qu'aucun constructeur ne laisse viser. Montrée — c'est la batterie —
   mais voilée de la couleur de la carte, pour qu'on lise qu'on n'ira pas là. */
.limit__dead { position: absolute; left: 0; top: 0; bottom: 0; background: var(--surface2); opacity: .62; }
.limit__mark {
  position: absolute; top: 0; bottom: 0; width: 2px;
  transform: translateX(-1px); background: var(--surface2);
}
/* l'input, transparent, posé PAR-DESSUS la piste dessinée : il n'apporte que le pouce et le geste */
.limit__range {
  position: relative; display: block; width: 100%; height: 24px; margin: 0;
  appearance: none; background: none; cursor: pointer;
}
.limit__range:disabled { cursor: default; }
.limit__range::-webkit-slider-runnable-track { height: var(--thumb); background: none; }
.limit__range::-webkit-slider-thumb {
  appearance: none; box-sizing: border-box; width: var(--thumb); height: var(--thumb);
  border-radius: 50%; border: 2px solid var(--surface2); background: var(--accent);
}
.limit__range::-moz-range-track { height: var(--thumb); background: none; border: 0; }
.limit__range::-moz-range-thumb {
  box-sizing: border-box; width: var(--thumb); height: var(--thumb);
  border-radius: 50%; border: 2px solid var(--surface2); background: var(--accent);
}
</style>
