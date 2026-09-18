<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { HouseScene } from '../../three/HouseScene'
import { TUNING_PRESETS, TUNING_RANGES, type SceneTuning } from '../../three/styles/tuning'
import { useSettingsStore } from '../../stores/settings'

// Le BANC DE RÉGLAGE de la lumière (Réglages → Rendu 3D → « Régler la lumière »). Il flotte sur la
// vue Maison parce qu'un réglage de lumière ne se juge que devant la maison, à l'heure qu'elle a :
// on tire un curseur, l'image change sous les doigts, on garde ce qui plaît.
//
// Trois façons d'arriver à une image : un PRÉRÉGLAGE (quatre partis pris écrits dans
// `three/styles/tuning.ts`), les curseurs, ou les deux — un préréglage est un point de départ, pas
// un verrou. « Enregistrer » écrit le réglage dans la maison, d'où toutes les tablettes le lisent ;
// « Réinitialiser » revient à ce que le style calcule, sans toucher à ce qui est enregistré.
//
// Les curseurs sont des MULTIPLICATEURS du style (voir `three/styles/tuning.ts`) : régler la nuit
// ne casse pas le jour, et changer de style garde le réglage. Les cinq derniers, eux, sont les
// nombres mêmes du trait de la pièce sélectionnée — il ne vient d'aucun style.

const props = defineProps<{ scene: () => HouseScene | null }>()
const settings = useSettingsStore()
const { t } = useI18n()

type SliderKey = keyof typeof TUNING_RANGES
const GROUPS: readonly { titleKey: string; keys: readonly SliderKey[] }[] = [
  { titleKey: 'render.tuning.image', keys: ['exposure', 'bloomStrength', 'bloomThreshold', 'bloomRadius', 'vignette'] },
  { titleKey: 'render.tuning.lamps', keys: ['glowOpacity', 'glowScale', 'lightIntensity', 'emissive'] },
  { titleKey: 'render.tuning.room', keys: ['ringWidth', 'ringBoost', 'ringWhite', 'ringOpacity', 'fillOpacity'] },
  { titleKey: 'render.tuning.tilt', keys: ['tiltShift', 'tiltCenter', 'tiltWidth', 'tiltPills'] },
]
const CURVES: readonly SceneTuning['toneMapping'][] = ['style', 'aces', 'agx', 'neutral', 'linear']

/** Un multiplicateur se lit « × 0,60 » ; les cinq réglages du trait sont des grandeurs, pas des facteurs. */
const PERCENT: readonly SliderKey[] = ['ringWhite', 'ringOpacity', 'fillOpacity', 'tiltShift', 'tiltCenter', 'tiltWidth', 'tiltPills']
function format(key: SliderKey, v: number): string {
  if (key === 'ringWidth') return `${Math.round(v * 100)} cm`
  if (PERCENT.includes(key)) return `${Math.round(v * 100)} %`
  return `× ${v.toFixed(2)}`
}

const tuning = computed(() => settings.sceneTuning)
function set(key: keyof SceneTuning, value: number | string | boolean) { settings.setSceneTuning({ [key]: value } as Partial<SceneTuning>) }

// Ce que la chaîne applique VRAIMENT, style et réglage confondus : le chiffre qu'on ira écrire dans
// le style. Relu à chaque changement de curseur, jamais en boucle — la scène ne rend qu'à la demande.
const effective = computed(() => {
  void tuning.value                         // relu dès qu'un curseur bouge
  const look = props.scene()?.tunedLook()
  if (!look) return null
  const r = (v: number) => Math.round(v * 100) / 100
  return {
    exposure: r(look.post.exposure),
    toneMapping: look.post.toneMapping,
    bloom: look.post.bloom ? { strength: r(look.post.bloom.strength), radius: r(look.post.bloom.radius), threshold: r(look.post.bloom.threshold) } : null,
    vignette: r(look.post.vignette),
    glow: { scale: r(look.glow.scale), opacity: r(look.glow.opacity), lightIntensity: r(look.glow.lightIntensity), emissive: r(look.glow.emissive) },
  }
})

const saving = ref(false)
const saved = ref(false)
async function save() {
  saving.value = true
  const ok = await settings.saveSceneTuning()
  saving.value = false
  if (!ok) return                            // l'erreur est dite par une notification (store maison)
  saved.value = true
  setTimeout(() => { saved.value = false }, 1500)
}
</script>

<template>
  <section class="tune" :aria-label="t('render.tuning.title')">
    <header class="tune__head">
      <div class="tune__title">{{ t('render.tuning.title') }}</div>
      <button type="button" class="tune__close" :aria-label="t('common.close')" @click="settings.setSceneTuningOpen(false)">
        <StrokeIcon name="close" :size="16" />
      </button>
    </header>

    <div class="tune__scroll">
      <div class="tune__group">{{ t('render.tuning.presets') }}</div>
      <div class="tune__chips">
        <button v-for="p in TUNING_PRESETS" :key="p.id" type="button" class="chip" :data-on="settings.sceneTuningPreset === p.id ? '1' : '0'"
                :title="t(`render.tuning.presetHints.${p.id}`)" @click="settings.applySceneTuningPreset(p.id)">{{ t(`render.tuning.presetNames.${p.id}`) }}</button>
      </div>

      <div class="tune__group">{{ t('render.tuning.curve') }}</div>
      <div class="tune__chips">
        <button v-for="c in CURVES" :key="c" type="button" class="chip" :data-on="tuning.toneMapping === c ? '1' : '0'"
                @click="set('toneMapping', c)">{{ t(`render.tuning.curves.${c}`) }}</button>
      </div>

      <template v-for="g in GROUPS" :key="g.titleKey">
        <div class="tune__group">{{ t(g.titleKey) }}</div>
        <div v-for="key in g.keys" :key="key" class="row">
          <div class="row__label">{{ t(`render.tuning.fields.${key}`) }}</div>
          <v-slider :model-value="tuning[key]" :min="TUNING_RANGES[key].min" :max="TUNING_RANGES[key].max" :step="TUNING_RANGES[key].step"
                    hide-details density="compact" @update:model-value="(v: number) => set(key, v)" />
          <div class="row__value">{{ format(key, tuning[key]) }}</div>
        </div>
      </template>

      <button type="button" class="chip chip--wide" :data-on="tuning.ringThrough ? '1' : '0'" @click="set('ringThrough', !tuning.ringThrough)">
        {{ t('render.tuning.fields.ringThrough') }}
      </button>

      <div v-if="effective" class="tune__out">
        <div>exposure {{ effective.exposure }} · {{ effective.toneMapping }}</div>
        <div v-if="effective.bloom">bloom {{ effective.bloom.strength }} / {{ effective.bloom.radius }} / {{ effective.bloom.threshold }}</div>
        <div>vignette {{ effective.vignette }}</div>
        <div>glow {{ effective.glow.opacity }} · {{ effective.glow.scale }} · {{ effective.glow.lightIntensity }} · {{ effective.glow.emissive }}</div>
      </div>
    </div>

    <!-- « Réinitialiser » ne disparaît jamais : c'est la sortie de secours d'un réglage qu'on ne
         retrouve plus. « Enregistrer » ne s'éteint que lorsqu'il n'a rien à écrire. -->
    <footer class="tune__foot">
      <button type="button" class="chip" @click="settings.resetSceneTuning()">{{ t('render.tuning.reset') }}</button>
      <button type="button" class="chip chip--go" :disabled="!settings.sceneTuningDirty || saving" @click="save()">
        {{ saved ? t('render.tuning.saved') : t('render.tuning.save') }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
/* Colle au rail, sous l'en-tête de la vue Maison, et laisse le centre de l'image libre : c'est la
   maison qu'on regarde pendant qu'on règle. Largeur FIXE et cellule de valeur de largeur fixe : rien
   ne bouge quand un nombre passe de « × 1,00 » à « × 0,75 ». */
.tune {
  position: absolute; left: calc(var(--rail-w) + 12px); top: 96px; z-index: 4;
  width: 320px; max-height: min(640px, calc(100% - 220px));
  display: flex; flex-direction: column;
  border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--surface);
  box-shadow: var(--shadow);
}
.tune__head { display: flex; align-items: center; gap: 8px; padding: 10px 8px 6px 12px; border-bottom: 1px solid var(--line); }
.tune__title { flex: 1; font-weight: 600; font-size: 13px; }
.tune__close {
  display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 6px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.tune__close:hover { background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--text); }
.tune__scroll { overflow: auto; padding: 4px 12px 8px; }
.tune__group { margin: 10px 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.tune__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); background: transparent;
  color: var(--muted); font-size: 11px; cursor: pointer;
}
.chip[data-on='1'] { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); color: var(--text); }
.chip--wide { width: 100%; margin-top: 8px; }
.row { display: grid; grid-template-columns: 84px 1fr 52px; align-items: center; gap: 6px; }
.row__label { font-size: 11px; color: var(--muted); }
.row__value { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; font-variant-numeric: tabular-nums; }
.tune__out {
  margin-top: 10px; padding: 6px 8px; border-radius: 6px; background: color-mix(in srgb, var(--text) 6%, transparent);
  font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
}
.tune__foot { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line); }
.tune__foot .chip { flex: 1; text-align: center; padding: 5px 8px; }
/* le bouton qui ÉCRIT : teinté d'accent tant qu'il a quelque chose à écrire, éteint sinon — mais
   toujours là, à la même place, comme son voisin (rien ne bouge) */
.chip--go[data-on='0'], .chip--go { border-color: var(--accent); color: var(--text); }
.chip--go:disabled { border-color: var(--line); color: var(--muted); cursor: default; opacity: .6; }
/* le curseur Vuetify tient dans une ligne de 24 px : le panneau reste dense */
.row :deep(.v-slider) { margin-inline: 0; }
.row :deep(.v-input__control) { min-height: 24px; }
</style>
