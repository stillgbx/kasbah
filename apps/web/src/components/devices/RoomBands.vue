<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry, DeviceKind } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { deviceIcon } from '../../lib/deviceIcons'
import { isDeviceOn, statusLabel } from '../../lib/deviceState'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'

// Tous les appareils d'un même kind remontés par les plugins, groupés par pièce et rangés en
// BANDES : une par niveau (du haut vers le bas, `levelsSorted`) puis une bande « Hors maison ».
// Une bande = sa propre grille, donc chaque niveau repart à la ligne.
//
// Partagé par les vues Lumières et Ouvrants : d'une vue à l'autre, SEUL le contrôle d'une ligne
// change — il vient du slot `control`. Tout le reste est commun : le groupement, l'ordre des
// pièces et son réglage à la poignée, la pastille de liaison au JSON, la carte des liaisons
// mortes. C'est aussi ce qui garantit qu'une correction profite aux deux vues. Un second slot,
// `status-badge`, permet d'ajouter une pastille devant le libellé d'état (vide par défaut).
const props = defineProps<{ kind: DeviceKind }>()

const devices = useDevicesStore()
const house = useHouseStore()
const { t, locale } = useI18n()

type Origin = 'json' | 'auto' | 'unplaced'
interface Row { entry: DeviceEntry; name: string; origin: Origin; on: boolean; status: string }
/** `roomId` = pièce de la maison, null pour une pièce de plugin sans équivalent (non réordonnable). */
interface Group { key: string; roomId: string | null; title: string; rows: Row[] }
interface Band { key: string; levelId: string | null; title: string; groups: Group[] }

const entries = computed(() => devices.list.filter((e) => e.state.kind === props.kind))
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

// ---- réordonner les pièces d'une bande -------------------------------------------------------
// Le glissement part de la POIGNÉE, jamais de la carte entière : les cartes portent des
// interrupteurs, des boutons et des curseurs qu'on manipule au doigt, et un geste d'appoint ne
// doit pas réécrire house.json. La liste se réorganise sous le doigt ; l'ordre part au relâchement.
const reorder = ref<{ levelId: string; roomId: string; ids: string[]; from: string[] } | null>(null)

const bands = computed<Band[]>(() => {
  const idx = house.index
  const byRoom = new Map<string, Row[]>()
  const loose = new Map<string, Row[]>()   // pièce de plugin (nom brut, '' = aucune) → appareils
  for (const e of entries.value) {
    const hd = idx?.devicesByBinding.get(e.descriptor.id)
    const room = hd?.roomId ? idx?.roomsById.get(hd.roomId) : undefined
    const row: Row = {
      entry: e,
      name: hd?.name ?? e.descriptor.name,
      origin: hd ? (hd.meta?.autoPlaced ? 'auto' : 'json') : 'unplaced',
      on: isDeviceOn(e.state),
      status: statusLabel(e.descriptor, e.state, t, locale.value),
    }
    const bucket = room ? byRoom : loose
    const key = room ? room.id : e.descriptor.meta.room ?? ''
    const arr = bucket.get(key)
    if (arr) arr.push(row)
    else bucket.set(key, [row])
  }

  const out: Band[] = []
  for (const level of idx?.levelsSorted ?? []) {
    const groups = (idx?.roomsByLevel.get(level.id) ?? [])
      .filter((r) => byRoom.has(r.id))
      .map((r) => ({ key: `room:${r.id}`, roomId: r.id as string | null, title: r.name, rows: byRoom.get(r.id)!.sort(byName) }))
    if (groups.length === 0) continue
    // pendant le glissement, l'ordre affiché est celui du brouillon (le JSON n'est écrit qu'au relâchement)
    const ids = reorder.value?.levelId === level.id ? reorder.value.ids : null
    if (ids) groups.sort((a, b) => ids.indexOf(a.roomId!) - ids.indexOf(b.roomId!))
    out.push({ key: `level:${level.id}`, levelId: level.id, title: level.name, groups })
  }

  const looseGroups = [...loose.entries()]
    .map(([name, rows]) => ({ key: `plugin:${name}`, roomId: null, title: name || t('rooms.noRoom'), rows: rows.sort(byName) }))
    .sort((a, b) => a.title.localeCompare(b.title))
  if (looseGroups.length) out.push({ key: 'loose', levelId: null, title: t('rooms.notInHouse'), groups: looseGroups })
  return out
})

/** Appareils du JSON dont le `deviceId` n'est remonté par aucun plugin. */
const dangling = computed(() => {
  const h = house.effective
  if (!h) return []
  // un `kind` absent du JSON vaut `light` (le kind d'origine du format), d'où le second test
  return h.devices.filter((d) => d.deviceId && !devices.descriptors[d.deviceId]
    && (d.kind === props.kind || (props.kind === 'light' && d.kind === undefined)))
})

function startDrag(ev: PointerEvent, band: Band, roomId: string) {
  ev.preventDefault()
  const ids = band.groups.map((g) => g.roomId!)
  reorder.value = { levelId: band.levelId!, roomId, ids, from: ids }
  // Écouteurs sur la FENÊTRE, pas sur la poignée : Vue déplace la carte (donc le bouton) à chaque
  // réorganisation, ce qui relâche la capture de pointeur — le `pointerup` n'arriverait jamais.
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}
function moveDrag(ev: PointerEvent) {
  const d = reorder.value
  if (!d) return
  const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
  const card = el?.closest<HTMLElement>('[data-room]')
  if (!card || card.dataset.level !== d.levelId) return
  const over = card.dataset.room!
  const from = d.ids.indexOf(d.roomId)
  const to = d.ids.indexOf(over)
  if (to < 0 || to === from) return
  const ids = [...d.ids]
  ids.splice(from, 1)
  ids.splice(to, 0, d.roomId)   // to > from → après la cible (le retrait a décalé) : pas d'oscillation
  reorder.value = { ...d, ids }
}
function endDrag() {
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  const d = reorder.value
  reorder.value = null
  if (d && d.ids.join() !== d.from.join()) void house.setRoomOrder(d.levelId, d.ids)
}
onBeforeUnmount(endDrag)   // quitter la vue en plein glissement ne doit pas laisser d'écouteurs

defineExpose({ count: computed(() => entries.value.length) })
</script>

<template>
  <div>
    <section v-for="b in bands" :key="b.key" class="band">
      <h2 class="band__title muted">{{ b.title }}</h2>
      <div class="cards">
        <section v-for="g in b.groups" :key="g.key" class="card group"
                 :data-room="g.roomId ?? undefined" :data-level="b.levelId ?? undefined"
                 :data-dragged="reorder && reorder.roomId === g.roomId ? '1' : '0'">
          <div class="group__head">
            <div class="group__title">{{ g.title }}</div>
            <button v-if="g.roomId && b.levelId && b.groups.length > 1" type="button" class="grip"
                    :title="$t('rooms.reorder')" :aria-label="$t('rooms.reorder')"
                    @pointerdown="startDrag($event, b, g.roomId)">
              <StrokeIcon name="grip" :size="16" />
            </button>
          </div>
          <div v-for="r in g.rows" :key="r.entry.descriptor.id" class="row">
            <span class="icon-square" :data-on="r.on ? '1' : '0'">
              <StrokeIcon :name="deviceIcon(r.entry.descriptor, r.entry.state)" :size="18" />
            </span>
            <div class="min0">
              <div class="row__name">{{ r.name }}</div>
              <div class="muted row__status">
                <!-- devant le STATUT et non devant le contrôle : un élément qui apparaît à côté
                     d'un curseur en change la largeur, et le curseur saute sous le doigt -->
                <slot name="status-badge" :entry="r.entry" />{{ r.status }}
              </div>
            </div>
            <span class="badge" :data-kind="r.origin" :title="$t(`rooms.origins.${r.origin}Hint`)">
              {{ $t(`rooms.origins.${r.origin}`) }}
            </span>
            <slot name="control" :entry="r.entry" :on="r.on" />
          </div>
        </section>
      </div>
    </section>

    <section v-if="dangling.length" class="band">
      <div class="cards">
        <section class="card group">
          <div class="group__head">
            <div class="group__title">{{ $t('rooms.dangling') }}</div>
          </div>
          <div class="muted group__sub">{{ $t('rooms.danglingHint') }}</div>
          <div v-for="d in dangling" :key="d.id" class="row row--dead">
            <span class="icon-square"><StrokeIcon name="link" :size="18" /></span>
            <div class="min0">
              <div class="row__name">{{ d.name ?? d.id }}</div>
              <div class="muted row__status mono">{{ d.deviceId }}</div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.band + .band { margin-top: 24px; }
.band__title { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 8px 2px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; align-items: start; }
.group { padding: 16px 20px; display: grid; gap: 2px; align-content: start; }
.group__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.group__title { font-weight: 600; font-size: 15px; }
.group__sub { font-size: 12px; margin-bottom: 8px; }
.group[data-dragged='1'] { outline: 2px solid var(--accent); opacity: .65; }
.grip {
  flex: 0 0 auto; display: grid; place-items: center; width: 28px; height: 28px; margin: -4px -6px -4px 0;
  border: 0; background: none; color: var(--muted); border-radius: 8px; cursor: grab; touch-action: none;
}
.grip:hover { background: var(--accent-soft); color: var(--accent); }
.grip:active { cursor: grabbing; }
/* Le contenu du slot `control` arrive ici en éléments de grille : une vue peut donc poser un
   contrôle en 4e colonne et, au besoin, un curseur en `grid-column: 1 / -1` sur sa propre ligne. */
.row {
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; column-gap: 12px;
  padding: 10px 0; border-top: 1px solid var(--line);
}
.row--dead { opacity: .7; }
.row__name { font-weight: 500; font-size: 14px; }
.row__status { font-size: 12px; }
.min0 { min-width: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.badge {
  font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 3px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
}
.badge[data-kind='auto'] { border-color: transparent; background: var(--accent-soft); color: var(--accent); }
.badge[data-kind='unplaced'] { border-color: #d38b22; color: #d38b22; }
</style>
