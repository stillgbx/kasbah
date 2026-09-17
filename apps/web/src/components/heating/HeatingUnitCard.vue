<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MelcloudUnit } from '../../api/transport'
import type { IconName } from '../../lib/strokeIcons'
import { formatPercent, formatTemp } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'

// L'état de la MACHINE, par opposition à celui des zones : ce qui tourne, ce qui chauffe en plus du
// compresseur, et si elle va mal. Ces mesures ne sont pas des appareils de la maison — une douzaine
// de capteurs pour des valeurs qu'on ne consulte qu'ici encombrerait l'inventaire, la recherche et
// la scène 3D. Elles viennent du plugin (`GET /api/plugins/melcloud/system`).
//
// Mise en forme : les lignes `icône | libellé | valeur` de la vue Météo (`.wx-detail`), en deux
// colonnes quand la carte est large. La version précédente serrait quatre mesures sur une ligne de
// 14 px et alignait quatre pastilles muettes en dessous : illisible, et surtout elle TAISAIT la
// moitié de ce que la machine dit. Ici la place sert à quelque chose — la température de
// condensation, les circulateurs comptés, et les deux appoints électriques distingués, qui étaient
// fondus en un seul voyant alors qu'ils ne coûtent pas la même chose.
//
// Rien ne bouge : les dix lignes sont TOUJOURS là, dans le même ordre. Une machine qui se met à
// dégivrer allume une ligne déjà présente, elle ne pousse rien vers le bas.

const props = defineProps<{ unit: MelcloudUnit }>()
const { t, locale } = useI18n()

const temp = (v: number | null) => (v === null ? '—' : formatTemp(v, locale.value))

/** Écart départ / retour : ce que la machine cède réellement au circuit. Absent si l'un des deux manque. */
const deltaT = computed(() => {
  const { flowTempC: f, returnTempC: r } = props.unit
  return f === null || r === null ? null : Math.round((f - r) * 10) / 10
})

interface Line { key: string; icon: IconName; label: string; value: string; on: boolean; warn?: boolean }

/**
 * Les mesures d'abord, les états ensuite. Un état inactif garde sa ligne et affiche un tiret :
 * c'est ce qui permet de lire « non, l'appoint électrique ne tourne pas » aussi vite que le
 * contraire — une pastille éteinte, elle, se confond avec une pastille qu'on n'a pas remarquée.
 */
const lines = computed<Line[]>(() => {
  const u = props.unit
  const flag = (on: boolean) => (on ? t('heating.unit.active') : '—')
  const running = u.pumps.filter(Boolean).length
  return [
    { key: 'flow', icon: 'arrowUp', label: t('heating.unit.flow'), value: temp(u.flowTempC), on: u.flowTempC !== null },
    { key: 'return', icon: 'arrowDown', label: t('heating.unit.return'), value: temp(u.returnTempC), on: u.returnTempC !== null },
    { key: 'delta', icon: 'unfold', label: t('heating.unit.delta'), value: deltaT.value === null ? '—' : `${deltaT.value.toLocaleString(locale.value)} °`, on: deltaT.value !== null },
    { key: 'condensing', icon: 'flask', label: t('heating.unit.condensing'), value: temp(u.condensingTempC), on: u.condensingTempC !== null },
    { key: 'demand', icon: 'gauge', label: t('heating.unit.demand'), value: u.demandPercent === null ? '—' : formatPercent(u.demandPercent, locale.value), on: u.demandPercent !== null },
    { key: 'defrost', icon: 'snow', label: t('heating.unit.lamps.defrost'), value: flag(u.defrosting), on: u.defrosting },
    { key: 'booster', icon: 'bolt', label: t('heating.unit.lamps.booster'), value: flag(u.boosterHeater), on: u.boosterHeater, warn: true },
    { key: 'immersion', icon: 'bolt', label: t('heating.unit.lamps.immersion'), value: flag(u.immersionHeater), on: u.immersionHeater, warn: true },
    { key: 'pump', icon: 'waves', label: t('heating.unit.lamps.pump'), value: running ? t('heating.unit.pumpsOf', { n: running, total: u.pumps.length }) : '—', on: running > 0 },
    { key: 'valve', icon: 'wrench', label: t('heating.unit.lamps.valve'), value: flag(u.valve3Way), on: u.valve3Way },
  ]
})

/**
 * « Injoignable » se lit dans `stale`, jamais dans `offline` : sur cette machine, le fabricant coche
 * `Offline` alors qu'elle remonte toutes les minutes. Le serveur tranche sur la fraîcheur.
 */
const seen = computed(() => (props.unit.lastSeen === null ? null : new Date(props.unit.lastSeen)))
</script>

<template>
  <section class="card unit">
    <div class="unit__head">
      <span class="icon-square" :data-on="unit.power && !unit.stale ? '1' : '0'">
        <StrokeIcon name="heatpump" :size="18" />
      </span>
      <div class="unit__main">
        <div class="unit__name">{{ unit.name }}</div>
        <div class="muted unit__sub">
          {{ unit.stale ? $t('heating.unit.offline') : unit.power ? $t('heating.unit.on') : $t('heating.unit.standby') }}
          <template v-if="unit.wifi"> · {{ unit.wifi }}</template>
        </div>
      </div>
      <div class="unit__stat">
        <div class="unit__value">{{ temp(unit.outdoorTempC) }}</div>
        <div class="muted unit__status">{{ $t('heating.unit.outdoor') }}</div>
      </div>
    </div>

    <!-- `hasError` et jamais le code : chez ce fabricant, 8000 est la valeur du BON fonctionnement -->
    <p v-if="unit.error.hasError" class="unit__alert small">
      <StrokeIcon name="alert" :size="14" />
      {{ unit.error.message ?? $t('heating.unit.errorCode', { code: unit.error.code ?? '?' }) }}
    </p>

    <dl class="unit__rows">
      <div v-for="l in lines" :key="l.key" class="line" :data-on="l.on ? '1' : '0'" :data-warn="l.warn ? '1' : '0'">
        <StrokeIcon :name="l.icon" :size="18" class="line__icon" />
        <dt class="line__label">{{ l.label }}</dt>
        <dd class="line__value">{{ l.value }}</dd>
      </div>
    </dl>

    <p class="muted small unit__seen">
      {{ seen ? $t('heating.unit.lastSeen', { time: seen.toLocaleTimeString($i18n.locale, { hour: '2-digit', minute: '2-digit' }) }) : $t('heating.unit.neverSeen') }}
      <template v-if="!unit.energyMeter"> · {{ $t('heating.unit.noMeter') }}</template>
    </p>
  </section>
</template>

<style scoped>
/* `space-between` : étirée à la hauteur de l'historique voisin, la carte répartit ses blocs au lieu
   de les tasser en haut et de laisser un trou sous le dernier. */
.unit { padding: 14px 16px; display: grid; gap: 12px; min-width: 0; align-content: space-between; }
.unit__head { display: flex; align-items: center; gap: 12px; }
.unit__main { flex: 1 1 auto; min-width: 0; }
.unit__name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit__sub { font-size: 12px; margin-top: 2px; min-height: 1em; }
.unit__stat { flex: 0 0 auto; text-align: right; }
.unit__value { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.unit__status { font-size: 12px; margin-top: 2px; }
.unit__alert { display: flex; align-items: center; gap: 8px; margin: 0; color: #d24a43; }

/* Deux colonnes dès que la carte est assez large : dix lignes en une seule colonne feraient une
   carte deux fois plus haute que l'historique voisin. */
.unit__rows { display: grid; gap: 2px 24px; margin: 0; grid-template-columns: 1fr; }
@media (min-width: 520px) { .unit__rows { grid-template-columns: 1fr 1fr; } }
/* la ligne de la vue Météo : icône, libellé, valeur, hauteur fixe */
.line { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 10px; height: 30px; min-width: 0; }
.line__icon { color: var(--muted); }
.line__label { margin: 0; font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line__value { margin: 0; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted); }
/* ce qui tourne se voit : la valeur reprend l'encre du texte, l'icône passe à l'accent */
.line[data-on="1"] .line__value { color: var(--text); }
.line[data-on="1"] .line__icon { color: var(--accent); }
/* un appoint ÉLECTRIQUE qui tourne est ce qui coûte cher sur cette carte : il s'annonce en orange */
.line[data-on="1"][data-warn="1"] .line__icon,
.line[data-on="1"][data-warn="1"] .line__value { color: #d38b22; }
.unit__seen { margin: 0; }
.small { font-size: 12px; }
</style>
