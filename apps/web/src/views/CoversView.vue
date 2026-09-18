<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { openingLabel, type DeviceEntry, type HouseDevice, type StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import CoversMaster from '../components/devices/CoversMaster.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import PulseDot from '../components/ui/PulseDot.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { coverActivity, coverWords, fromClosure, toClosure } from '../lib/cover'
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
const { t } = useI18n()

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

// Valeur locale pendant le glissement seulement ; ensuite c'est la cible du store qui s'affiche.
const draft = ref<Record<string, number>>({})
// le curseur n'existe que pour un ouvrant qui sait viser une position, donc qui la publie ; le
// repli à 100 ne sert qu'à donner un nombre au composant si les deux se désaccordaient
const shownClosure = (id: string, position?: number) => draft.value[id] ?? toClosure(devices.targetPosition(id) ?? position ?? 100)

// Jauge peinte en fond de ligne (slot `backdrop` de `RoomBands`, comme la teinte d'une lampe allumée
// ou la pochette d'un lecteur) : la part de l'ouvrant qui SE REMARQUE, de 0 (rien) à 1 (toute la
// ligne). Un volet se remarque ouvert, un store DÉPLOYÉ — c'est l'inverse, et c'est voulu (voir
// `coverActivity`). Position inconnue = pas de jauge : on n'affirme rien d'un moteur muet.
// On lit la position VISÉE quand le store en tient une : la jauge suit le geste, comme le curseur.
const openFraction = (e: DeviceEntry) => {
  const s = e.state as StateFor<'cover'>
  if (!s.available) return 0
  return coverActivity(e.descriptor, devices.targetPosition(e.descriptor.id) ?? s.position)
}

// Position favorite du moteur : repère sur la piste du curseur, et valeur dans le libellé
// accessible de la touche (une ligne de liste n'a pas la place de l'écrire).
const presetClosure = (s: StateFor<'cover'>) => s.presetPosition === undefined ? undefined : toClosure(s.presetPosition)
const presetTicks = (s: StateFor<'cover'>) => { const c = presetClosure(s); return c === undefined ? undefined : [c] }
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
        <!-- ce qui manquait le plus dans cette vue : voir OUVERT sans lire chaque ligne -->
        <template #backdrop="{ entry }">
          <div class="row-open" aria-hidden="true"
               :style="{ '--open': openFraction(entry) }" />
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
              <!-- la valeur ne tient pas dans une touche de 36 px : elle passe par le libellé -->
              <button v-if="entry.descriptor.capabilities.includes('preset')" type="button" class="key"
                      :disabled="!entry.state.available"
                      :title="presetClosure(entry.state as StateFor<'cover'>) !== undefined
                        ? $t('cover.presetAt', { pct: `${Math.round(presetClosure(entry.state as StateFor<'cover'>)!)} %` })
                        : $t('cover.preset')"
                      :aria-label="$t('cover.preset')"
                      @click="devices.sendCommand(entry.descriptor.id, { type: 'cover.preset' })">
                <StrokeIcon name="crosshair" :size="18" />
              </button>
            </div>
            <!-- pas de 1 % : Vuetify aligne le pouce sur le pas, et à 5 % il ne pouvait pas se
                 poser sur le repère de position favorite du moteur (voir `CoverControl.vue`) -->
            <v-slider v-if="entry.descriptor.capabilities.includes('position')"
                      :model-value="shownClosure(entry.descriptor.id, (entry.state as StateFor<'cover'>).position)"
                      :min="0" :max="100" :step="1" :disabled="!entry.state.available"
                      :ticks="presetTicks(entry.state as StateFor<'cover'>)"
                      :show-ticks="presetTicks(entry.state as StateFor<'cover'>) ? 'always' : false"
                      density="compact" hide-details class="controls__slider cover-slider"
                      @update:model-value="(v: number) => drag(entry.descriptor.id, v)"
                      @end="(v: number) => commit(entry.descriptor.id, v)" />
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
.controls { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; margin: 2px 4px 0; }
.controls__slider { flex: 1 1 auto; }
/* même empreinte que `.controls` : une ligne à part, pour ne pas écraser le nom de l'ouvrant */
.assign { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; margin: 2px 4px 0; }
.assign__label { font-size: 12px; flex: 0 0 auto; }
.assign__select { flex: 1 1 auto; min-width: 0; }
/* pastille « sans ouverture » : même couleur que le badge « non placé » de `RoomBands` — un ouvrant
   qui n'habille encore rien est le même genre d'inachevé */
.waiting-badge {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; margin-right: 6px;
  font-size: 11px; font-weight: 600; color: #d38b22;
}
/* le repere de position favorite est style globalement, voir `styles/app.css` (`.cover-slider`) */
.dot { margin-right: 6px; color: var(--accent); }
/* Jauge d'ouverture : une bande d'accent doux qui part du bord gauche et s'étire avec l'ouverture,
   fondue sur sa fin pour qu'elle ne se lise pas comme une seconde piste de curseur. Absolue et en
   z-index négatif (contexte posé par `.row`) : elle ne décale rien, et une ligne fermée n'a
   simplement rien à montrer. Déborde de 4 px de chaque côté, comme la teinte des lampes. */
.row-open {
  position: absolute; left: -4px; top: 0; bottom: 0; z-index: -1; pointer-events: none;
  width: calc(var(--open) * (100% + 8px));
  background: var(--accent-soft);
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 60%, transparent 100%);
  mask-image: linear-gradient(90deg, #000 0, #000 60%, transparent 100%);
  transition: width .4s ease;
}
@media (prefers-reduced-motion: reduce) { .row-open { transition: none; } }
.keys { display: flex; gap: 4px; flex: 0 0 auto; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
