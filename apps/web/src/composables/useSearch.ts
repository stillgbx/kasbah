import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { roomKey, type DeviceDescriptor } from '@kasbah/shared'
import { deviceIcon } from '../lib/deviceIcons'
import { visibleNavItems } from '../lib/navItems'
import { useLocalPluginsStore } from '../stores/localPlugins'
import { normalize, queryTerms, scoreQuery } from '../lib/search'
import type { IconName } from '../lib/strokeIcons'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useScenesStore } from '../stores/scenes'

// Ce que la recherche de la vue Maison peut atteindre, et ce que valider un résultat fait. Rien
// n'est indexé : les entités vivent déjà dans les stores, on les aplatit en `SearchEntry` (le
// `computed` ne se refait qu'à un changement de maison, d'appareils ou d'ambiances) et chaque
// frappe balaye la liste. Aucun plugin n'a de champ à déclarer : le contrat appareil porte déjà le
// nom, le kind et la pièce.
//
// Un résultat NAVIGUE, il n'agit jamais : les mêmes setters que le tap dans la scène
// (`selectRoom`, `selectDevice`…), qui cadrent la 3D et ouvrent le bon panneau. Une ambiance
// emmène donc là où sa pastille se touche, elle ne se rappelle pas toute seule.

export type SearchFamily = 'room' | 'zone' | 'level' | 'device' | 'scene' | 'page'

export interface SearchEntry {
  key: string
  label: string
  /** Où la chose se trouve (« 1er étage », « Salon ») ou ce qu'elle est (« Niveau », « Page »). */
  sub: string
  /**
   * Ce qu'on peut taper d'autre pour tomber dessus, et qui ne s'affiche que si c'est par là qu'on
   * est arrivé : la marque et le modèle d'un appareil (« COMAP Proteo V3 »), le nom court d'un
   * niveau (« RDC »). Un appareil porte souvent le nom que le fabricant lui a donné — une Renault
   * s'appelle « GA-123-BX » —, et personne ne cherche une voiture par sa plaque.
   */
  alias?: string
  icon: IconName
  family: SearchFamily
  go: () => void
}

export interface SearchHit extends SearchEntry { score: number }

/** Une lettre ramènerait la maison entière : on attend le deuxième caractère. */
export const MIN_QUERY = 2
/** Au-delà, la liste ne se lit plus — c'est la frappe suivante qui trie, pas le défilement. */
export const MAX_RESULTS = 20

/** « COMAP Proteo V3 », « Tesla Model S », « Renault » : ce qu'un appareil est, pour qui le cherche par là. */
function madeBy(descriptor: DeviceDescriptor | undefined): string | undefined {
  const parts = [descriptor?.meta.manufacturer, descriptor?.meta.model].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

/** À score égal, l'ordre des familles : la pièce avant la lampe qui la nomme, la page en dernier. */
const FAMILY_RANK: Record<SearchFamily, number> = { room: 0, zone: 1, level: 2, device: 3, scene: 4, page: 5 }

/** Le nom passe AVANT la marque, toujours : la moindre correspondance de nom vaut mieux que « Tesla ». */
const NAME_WEIGHT = 10

/**
 * Un choix fait par la palette Ctrl+K qui vise la maison : la vue Maison, gardée en vie, ouvre
 * son panneau à chaque incrément — c'est elle seule qui sait s'il est replié (fenêtre étroite).
 */
export const homePanelRequest = ref(0)

/** `withHome` : la palette vit sur toutes les pages, la page Maison y est donc une destination. */
export function useSearch(query: Ref<string>, { withHome = false } = {}) {
  const house = useHouseStore()
  const devices = useDevicesStore()
  const scenes = useScenesStore()
  const router = useRouter()
  const localPlugins = useLocalPluginsStore()
  const { t } = useI18n()

  const entries = computed<SearchEntry[]>(() => {
    const out: SearchEntry[] = []
    const index = house.index

    for (const level of house.levels) {
      out.push({ key: `level:${level.id}`, label: level.name, sub: t('search.level'), alias: level.shortName, icon: 'layers', family: 'level', go: () => house.selectLevel(level.id) })
    }
    for (const room of index?.roomsById.values() ?? []) {
      const level = index?.levelsById.get(room.levelId)
      out.push({ key: `room:${room.id}`, label: room.name, sub: level?.name ?? t('search.room'), icon: 'room', family: 'room', go: () => house.selectRoom(room.id) })
    }
    for (const zone of house.zones) {
      out.push({ key: `zone:${zone.id}`, label: zone.name, sub: t('home.garden'), icon: 'room', family: 'zone', go: () => house.selectRoom(zone.id) })
    }

    // Appareils de la maison : ceux du JSON et ceux que l'auto-placement y a mis. Leur nom vient
    // du descripteur quand le JSON n'en donne pas (c'est le cas général) ; une liaison morte n'en
    // a aucun et se cherche alors par son id, qui est parlant (« light.cube-salon »).
    for (const hd of house.effective?.devices ?? []) {
      const descriptor = hd.deviceId ? devices.descriptors[hd.deviceId] : undefined
      const room = hd.roomId ? index?.roomsById.get(hd.roomId) : undefined
      const zone = hd.zoneId ? index?.zonesById.get(hd.zoneId) : undefined
      const level = hd.levelId ? index?.levelsById.get(hd.levelId) : undefined
      out.push({
        key: `device:${hd.id}`,
        label: hd.name ?? descriptor?.name ?? hd.id,
        sub: room?.name ?? zone?.name ?? level?.name ?? '',
        alias: madeBy(descriptor),
        icon: deviceIcon(descriptor),
        family: 'device',
        go: () => house.selectDevice(hd.id),
      })
    }
    // Appareils qu'aucune pièce de la maison ne réclame : absents de la scène, mais leur panneau
    // s'ouvre quand même (`resolveDevice` accepte un id de plugin comme clé) — et c'est de là qu'on
    // les place. Les cacher de la recherche ferait un appareil « introuvable » sans dire pourquoi.
    for (const descriptor of Object.values(devices.descriptors)) {
      if (index?.devicesByBinding.has(descriptor.id)) continue
      out.push({
        key: `device:${descriptor.id}`,
        label: descriptor.name,
        sub: t('rooms.origins.unplaced'),
        alias: madeBy(descriptor),
        icon: deviceIcon(descriptor),
        family: 'device',
        go: () => house.selectDevice(descriptor.id),
      })
    }

    // Une ambiance de pièce mène à sa pièce, les autres (zone du fabricant, pièce inconnue) au
    // panneau maison : dans les deux cas, là où sa pastille se trouve.
    const rooms = [...(index?.roomsById.values() ?? [])]
    for (const e of scenes.list) {
      const group = e.scene.group
      const room = group?.kind === 'room' ? rooms.find((r) => roomKey(r.name) === roomKey(group.name)) : undefined
      out.push({
        key: `scene:${e.scene.id}`,
        label: e.scene.name,
        sub: room?.name ?? group?.name ?? t('search.scene'),
        icon: 'sparkle',
        family: 'scene',
        go: () => (room ? house.selectRoom(room.id) : house.backToHome()),
      })
    }

    for (const item of visibleNavItems(localPlugins.isEnabled)) {
      if (item.name === 'home' && !withHome) continue    // on y est déjà : la recherche vit dessus
      out.push({ key: `page:${item.name}`, label: t(item.label), sub: t('search.page'), icon: item.icon, family: 'page', go: () => { void router.push({ name: item.name }) } })
    }
    return out
  })

  /** Noms et alias normalisés, dans l'ordre des entrées : calculés une fois, pas à chaque frappe. */
  const haystacks = computed(() => entries.value.map((e) => [normalize(e.label), e.alias ? normalize(e.alias) : '']))

  const results = computed<SearchHit[]>(() => {
    const terms = queryTerms(query.value)
    if (terms.join('').length < MIN_QUERY) return []
    const hits: SearchHit[] = []
    const list = entries.value, hay = haystacks.value
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!, [name, alias] = hay[i]!
      const byName = scoreQuery(name!, terms)
      if (byName !== null) { hits.push({ ...entry, score: byName * NAME_WEIGHT }); continue }
      // trouvé par la marque : on le DIT à la place du lieu, sinon la ligne paraît sortie de nulle part
      const byAlias = alias ? scoreQuery(alias, terms) : null
      if (byAlias !== null) hits.push({ ...entry, sub: entry.alias!, score: byAlias })
    }
    hits.sort((a, b) => b.score - a.score || FAMILY_RANK[a.family] - FAMILY_RANK[b.family] || a.label.localeCompare(b.label))
    return hits.slice(0, MAX_RESULTS)
  })

  return { results }
}
