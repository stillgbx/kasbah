<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { openingLabel, type DeviceEntry, type HouseDevice, type StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import CoversMaster from '../components/devices/CoversMaster.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import CoverPill from '../components/covers/CoverPill.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { coverActivity, coverWords, fromClosure, toClosure } from '../lib/cover'
import { formatPercent, formatSensor } from '../lib/format'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Vue Ouvrants : volets, stores, portails, fenêtres et portes de garage — tout ce qui est du kind
// `cover`. La liste par pièce et son diagnostic de liaison viennent de `RoomBands` (partagé avec
// la vue Lumières) ; il ne reste ici que le contrôle propre à un ouvrant.
//
// Ouvrir / Stop / Fermer sont conditionnés aux capacités, parce que le parc est hétérogène : un
// moteur io-homecontrol sait viser une position (curseur), une radio RTS unidirectionnelle ne sait
// que tout ou rien — lui afficher un curseur promettrait une commande qu'elle refuserait.
//
// Le pourcentage est une FERMETURE (0 % = ouvert, voir `lib/cover.ts`) et le curseur montre la
// position VISÉE tant que le store la tient : un moteur qui ne publie sa position qu'en fin de
// course ferait sinon revenir la poignée en arrière juste après le geste.
const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()

const covers = computed(() => devices.list.filter((e) => e.state.kind === 'cover'))

// ---- résumé de l'en-tête : une NATURE à la fois, décrite par l'état qui se remarque — « 16 volets
// ouverts · 2 stores déployés · 1 portail ouvert ». Un seul compte « ouverts » mélangeait des choses
// qui ne se lisent pas dans le même sens : d'un volet on retient qu'il est OUVERT, d'un store qu'il
// est DÉPLOYÉ (`coverActivity`, la même règle que les jauges de ligne et les marqueurs 3D).
//
// Une nature absente de la maison n'a pas de groupe ; une nature présente garde le sien même à zéro,
// sinon le libellé sauterait dès qu'un volet s'ouvre (règle « rien ne bouge »). L'ordre est fixe, et
// jamais celui des comptes, pour la même raison. Position inconnue = pas comptée : on n'affirme rien
// d'un moteur muet.
const SUMMARY_ORDER = ['shutter', 'blind', 'awning', 'curtain', 'window', 'gate', 'garage', 'other']
const summary = computed(() => {
  const counts = new Map<string, number>()
  for (const e of covers.value) {
    const cls = e.descriptor.meta.cover?.deviceClass ?? ''
    const key = SUMMARY_ORDER.includes(cls) ? cls : 'other'
    // la position VISÉE quand le store en tient une, comme les jauges : le compte suit le geste
    const active = e.state.available
      && coverActivity(e.descriptor, devices.targetPosition(e.descriptor.id) ?? (e.state as StateFor<'cover'>).position) > 0
    counts.set(key, (counts.get(key) ?? 0) + (active ? 1 : 0))
  }
  return [...counts.entries()]
    .sort((a, b) => SUMMARY_ORDER.indexOf(a[0]) - SUMMARY_ORDER.indexOf(b[0]))
    // le nombre passe en 3e argument et rien d'autre : `n` interpolé écraserait l'accord du pluriel
    .map(([key, n]) => t(`covers.counts.${key}`, n))
    .join(' · ')
})

// ---- ouvrants SANS OUVERTURE : la liste de travail qui apparaît après la découverte d'un plugin
// (Somfy des mois après avoir dessiné la maison, six volets d'un coup sans savoir où ils vont).
// `house.coversWithoutOpening` porte la règle (attend une ouverture, natures gate/garage exclues) ;
// ici on l'affiche et on affecte, ligne par ligne. À ne pas confondre avec un appareil « non lié »
// (sans `deviceId`) : la liaison au fabricant existe déjà, seule la place dans la maison manque.
const waitingIds = computed(() => new Set(house.coversWithoutOpening.map((d) => d.id)))
const waiting = (hd: HouseDevice | undefined) => !!hd && waitingIds.value.has(hd.id)

/** Chaque ouverture de la maison, avec sa pièce et l'ouvrant qui l'occupe déjà (s'il y en a un). */
interface OpeningOption { id: string; label: string; roomId: string; roomName: string; occupantId: string | null; occupantName: string }
const openingIndex = computed<OpeningOption[]>(() => {
  const h = house.effective
  if (!h) return []
  const occupants = new Map<string, HouseDevice>()
  for (const d of h.devices) if (d.openingId) occupants.set(d.openingId, d)
  return h.rooms.flatMap((r) => r.openings.map((o) => {
    const occ = occupants.get(o.id)
    return {
      id: o.id, label: openingLabel(o), roomId: r.id, roomName: r.name,
      occupantId: occ?.id ?? null,
      occupantName: occ ? occ.name ?? (occ.deviceId ? devices.descriptors[occ.deviceId]?.name : undefined) ?? occ.id : '',
    }
  }))
})
/**
 * Options du sélecteur, pour l'ouvrant `hd` : les ouvertures de SA PIÈCE d'abord (c'est là qu'il
 * habite, donc le geste le plus probable), puis le reste de la maison — jamais masquées, seulement
 * reléguées, parce que la liste complète reste parfois nécessaire (un volet posé au mauvais endroit
 * par le plugin). Une ouverture déjà prise se distingue (« pris par … ») sans disparaître : la
 * reprendre est un geste voulu (`setCoverOpening` libère l'ancien).
 */
function assignOptions(hd: HouseDevice) {
  const sorted = [...openingIndex.value].sort((a, b) => Number(b.roomId === hd.roomId) - Number(a.roomId === hd.roomId))
  return [
    { value: '', title: t('covers.assignNone') },
    ...sorted.map((o) => ({
      value: o.id,
      title: o.occupantId && o.occupantId !== hd.id
        ? t('covers.assignTaken', { room: o.roomName, opening: o.label, name: o.occupantName })
        : t('covers.assignFree', { room: o.roomName, opening: o.label }),
    })),
  ]
}

// Volet solaire : son panneau est un capteur de luminosité à part (`meta.linkedTo` vers le volet).
// Indexé une fois par volet, plutôt que cherché ligne par ligne à chaque rendu.
const lightByCover = computed(() => {
  const map = new Map<string, DeviceEntry>()
  for (const e of devices.list) {
    const to = e.descriptor.meta.linkedTo
    if (to && e.descriptor.kind === 'sensor' && e.descriptor.meta.sensor?.deviceClass === 'illuminance') map.set(to, e)
  }
  return map
})
const lightText = (coverId: string) => {
  const e = lightByCover.value.get(coverId)
  return e && e.state.kind === 'sensor' ? formatSensor(e.descriptor, e.state.value, locale.value) : undefined
}
const batteryText = (s: StateFor<'cover'>) => (s.batteryPct === undefined ? '—' : formatPercent(s.batteryPct, locale.value))

// Valeur locale pendant le glissement seulement ; ensuite c'est la cible du store qui s'affiche.
const draft = ref<Record<string, number>>({})
// Fermeture montrée par la vignette : le glissement, sinon la position VISÉE quand le store en tient
// une (le tablier suit le geste, même d'un moteur qui ne publie qu'en fin de course), sinon la
// position publiée. Inconnue = `undefined` : la vignette n'affirme rien d'un moteur muet.
const pillClosure = (e: DeviceEntry) => {
  const id = e.descriptor.id
  const p = devices.targetPosition(id) ?? (e.state as StateFor<'cover'>).position
  return draft.value[id] ?? (p === undefined ? undefined : toClosure(p))
}

// Position favorite du moteur : repère sur la vignette, et valeur dans le libellé accessible de la
// touche (une ligne de liste n'a pas la place de l'écrire).
const presetClosure = (s: StateFor<'cover'>) => s.presetPosition === undefined ? undefined : toClosure(s.presetPosition)
function drag(id: string, v: number) { draft.value = { ...draft.value, [id]: v } }
function commit(id: string, v: number) {
  void devices.sendCommand(id, { type: 'cover.set_position', position: fromClosure(Math.round(v)) })
  const next = { ...draft.value }
  delete next[id]
  draft.value = next
}
</script>

<template>
  <div class="page">
    <PageHeader>
      <!-- tout fermer ou tout ouvrir : deux gestes nommés plutôt qu'un interrupteur, parce que le
           parc est rarement tout ouvert ou tout fermé ; « fermer » remonte un store (`CoversMaster`) -->
      <div class="head">
        <div class="muted count">{{ summary }}</div>
        <!-- place réservée : toujours affiché, même à 0, pour que rien ne saute d'apparence quand
             la découverte d'un plugin fait passer le compte de 0 à six -->
        <div class="muted count count--waiting" :data-zero="house.coversWithoutOpening.length === 0 ? '1' : '0'">
          {{ $t('covers.waitingCount', { n: house.coversWithoutOpening.length }, house.coversWithoutOpening.length) }}
        </div>
        <CoversMaster :entries="covers" :label="$t('covers.all')" />
      </div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="covers.length === 0" class="card card--soft empty muted">{{ $t('covers.none') }}</div>
      <RoomBands kind="cover">
        <!-- l'ouvrant vu de face, à la place de l'icône : se lit OUVERT sans lire la ligne, et se
             manœuvre dans le sens où il bouge (voir `CoverPill`). Glissable seulement pour un moteur
             qui sait viser une position, et une fois son ouverture connue. -->
        <template #leading="{ entry }">
          <CoverPill :closure="pillClosure(entry)" :preset="presetClosure(entry.state as StateFor<'cover'>)"
                     :interactive="entry.state.available && entry.descriptor.capabilities.includes('position')
                       && !waiting(house.houseDeviceFor(entry.descriptor.id))"
                     :device-class="entry.descriptor.meta.cover?.deviceClass"
                     :label="$t(`cover.${coverWords(entry.descriptor)}.level`)"
                     :class="{ 'pill--off': !entry.state.available }"
                     @drag="(v: number) => drag(entry.descriptor.id, v)"
                     @commit="(v: number) => commit(entry.descriptor.id, v)" />
        </template>
        <!-- le point pulsant accompagne le libellé (« Fermeture en cours »), qui est déjà dans le
             statut : posé avant le curseur, il en changerait la largeur à chaque mouvement -->
        <template #status-badge="{ entry }">
          <!-- ouvrant sans ouverture : le mot avant le statut, pour qu'il se voie sans lire chaque
               ligne (c'est la liste de travail qui suit la découverte d'un plugin) -->
          <span v-if="waiting(house.houseDeviceFor(entry.descriptor.id))" class="waiting-badge" :title="$t('covers.waitingHint')">
            <StrokeIcon name="linkOff" :size="12" />{{ $t('covers.waitingBadge') }}
          </span>
          <PulseDot :on="(entry.state as StateFor<'cover'>).motion !== 'stopped'" class="dot" />
        </template>
        <!-- volet solaire : luminosité du panneau et batterie du moteur, au bout de la ligne d'état.
             Largeurs MINIMALES réservées : un chiffre qui s'allonge ne pousse pas le statut. -->
        <template #status-after="{ entry }">
          <span v-if="lightText(entry.descriptor.id) !== undefined" class="fact fact--lux" :title="$t('lightHistory.title')">
            <StrokeIcon name="sun" :size="12" />{{ lightText(entry.descriptor.id) }}
          </span>
          <span v-if="entry.descriptor.capabilities.includes('battery')" class="fact fact--battery"
                :class="{ 'fact--low': ((entry.state as StateFor<'cover'>).batteryPct ?? 100) < 20 }" :title="$t('cover.battery')">
            <StrokeIcon name="battery" :size="12" />{{ batteryText(entry.state as StateFor<'cover'>) }}
          </span>
        </template>
        <template #control="{ entry }">
          <!-- ouvrant sans ouverture : c'est ICI qu'on l'affecte — pas de sens à montrer Ouvrir/Fermer
               tant qu'on ne sait pas quelle fenêtre il habille -->
          <div v-if="waiting(house.houseDeviceFor(entry.descriptor.id))" class="assign">
            <span class="muted assign__label">{{ $t('covers.assign') }}</span>
            <v-select class="assign__select" :model-value="''" :items="assignOptions(house.houseDeviceFor(entry.descriptor.id)!)"
                      item-title="title" item-value="value" density="compact" variant="outlined" hide-details
                      :disabled="house.savingOpening" :aria-label="$t('covers.assign')"
                      @update:model-value="(id: string) => house.setCoverOpening(house.houseDeviceFor(entry.descriptor.id)!.id, id || null)" />
          </div>
          <!-- une ligne à part : trois boutons dans la 4e colonne écraseraient le nom de l'ouvrant -->
          <div v-else class="controls">
            <div class="keys">
              <button type="button" class="key" :disabled="!entry.state.available"
                      :title="$t(`cover.${coverWords(entry.descriptor)}.actionOpen`)"
                      :aria-label="$t(`cover.${coverWords(entry.descriptor)}.actionOpen`)"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.open' })">
                <StrokeIcon name="collapseUp" :size="18" />
              </button>
              <button v-if="entry.descriptor.capabilities.includes('stop')" type="button" class="key"
                      :disabled="!entry.state.available" :title="$t('common.stop')" :aria-label="$t('common.stop')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.stop' })">
                <StrokeIcon name="stop" :size="18" />
              </button>
              <button type="button" class="key" :disabled="!entry.state.available"
                      :title="$t(`cover.${coverWords(entry.descriptor)}.actionClose`)"
                      :aria-label="$t(`cover.${coverWords(entry.descriptor)}.actionClose`)"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.close' })">
                <StrokeIcon name="collapseDown" :size="18" />
              </button>
              <!-- les RÉGLAGES (position perso, mode discret) poussés à droite, loin des manœuvres -->
              <span class="keys__gap" aria-hidden="true" />
              <!-- la valeur ne tient pas dans une touche : elle passe par le libellé -->
              <button v-if="entry.descriptor.capabilities.includes('preset')" type="button" class="key"
                      :disabled="!entry.state.available"
                      :title="presetClosure(entry.state as StateFor<'cover'>) !== undefined
                        ? $t('cover.presetAt', { pct: `${Math.round(presetClosure(entry.state as StateFor<'cover'>)!)} %` })
                        : $t('cover.preset')"
                      :aria-label="$t('cover.preset')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.preset' })">
                <StrokeIcon name="crosshair" :size="18" />
              </button>
              <!-- mode discret : une BASCULE (pas une manœuvre), allumée à la teinte d'accent -->
              <button v-if="entry.descriptor.capabilities.includes('quiet')" type="button" class="key key--toggle"
                      :disabled="!entry.state.available" :aria-pressed="!!(entry.state as StateFor<'cover'>).quiet"
                      :title="$t('cover.quietHint')" :aria-label="$t('cover.quiet')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.set_quiet', on: !(entry.state as StateFor<'cover'>).quiet })">
                <StrokeIcon name="moon" :size="18" />
              </button>
            </div>
          </div>
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.head { display: flex; align-items: center; gap: 14px; }
.count { font-size: 13px; }
/* estompé à 0 plutôt que masqué : le compteur ne saute pas d'apparence à la découverte d'un plugin */
.count--waiting[data-zero='1'] { opacity: .55; }
.empty { padding: 24px; text-align: center; }
/* Les touches sur leur propre ligne, SOUS le nom et à droite de la vignette (qui occupe la 1re
   colonne sur les deux lignes, voir `CoverPill`) : trois boutons dans la 4e colonne écraseraient le
   nom. La position se règle sur la vignette, dans le sens où l'ouvrant bouge : plus de curseur
   horizontal, qui se lisait à l'envers d'un volet. */
/* `min-width: 0` : sans lui, cinq touches élargiraient la colonne `1fr` au-delà de la carte (375 px) */
.controls { grid-column: 2 / -1; display: grid; margin-top: 8px; min-width: 0; }
/* même empreinte que `.controls` : une ligne à part, pour ne pas écraser le nom de l'ouvrant */
.assign { grid-column: 2 / -1; display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.assign__label { font-size: 12px; flex: 0 0 auto; }
.assign__select { flex: 1 1 auto; min-width: 0; }
/* pastille « sans ouverture » : même couleur que le badge « non placé » de `RoomBands` — un ouvrant
   qui n'habille encore rien est le même genre d'inachevé */
.waiting-badge {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; margin-right: 6px;
  font-size: 11px; font-weight: 600; color: #d38b22;
}
.dot { margin-right: 6px; color: var(--accent); }
/* moteur injoignable : la vignette garde sa place et son dernier état connu, estompée comme les touches */
.pill--off { opacity: .4; }
/* retour à la ligne sur un téléphone : à côté de la vignette, cinq touches de 40 px n'y tiennent
   plus, et les réglages passent sous les manœuvres. Cela ne dépend que de la largeur, jamais de l'état. */
.keys { display: flex; flex-wrap: wrap; gap: 6px; }
.keys__gap { flex: 1 1 auto; }
.key {
  display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
.key--toggle[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.fact { display: inline-flex; align-items: center; justify-content: flex-end; gap: 3px; flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fact--lux { min-width: 8ch; }
.fact--battery { min-width: 6ch; }
.fact--low { color: rgb(var(--v-theme-error)); }
</style>
