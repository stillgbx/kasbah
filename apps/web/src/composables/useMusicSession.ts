import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import type { MusicRepeat, MusicSession, RadioStation } from '../api/transport'

// Le flux que Kasbah sert à UN lecteur (`GET /api/music/sessions`) : qualité et file d'attente, pour
// le panneau appareil — et, pour un direct, la station que le plugin radio y a lancée (sa qualité).
// La page Musique tient sa propre carte de toutes les sessions ; ici on ne suit que celle d'un
// lecteur, relue quand il change de titre ou d'état, et toutes les 20 s.
// `enabled` : faux pour un lecteur qui ne sait pas recevoir nos flux — aucun appel au serveur.
export function useMusicSession(deviceId: Ref<string>, state: Ref<StateFor<'media_player'>>, enabled: Ref<boolean>) {
  const session = ref<MusicSession | null>(null)
  const station = ref<RadioStation | null>(null)

  async function refresh(): Promise<void> {
    if (!enabled.value) { session.value = null; station.value = null; return }
    const id = deviceId.value
    const api = getTransport()
    // la station n'est demandée que pour un direct : le reste du temps elle ne servirait à rien
    const [sessions, radios] = await Promise.allSettled([
      api.musicSessions(),
      state.value.nowPlaying?.live ? api.radioPlaying() : Promise.resolve({ playing: [] }),
    ])
    if (id !== deviceId.value) return
    // plugin absent ou serveur muet : pas de session, pas de station
    session.value = sessions.status === 'fulfilled' ? sessions.value.sessions.find((s) => s.deviceId === id) ?? null : null
    station.value = radios.status === 'fulfilled' ? radios.value.playing.find((p) => p.deviceId === id)?.station ?? null : null
  }

  /** La file saute (l'enceinte n'a qu'un « fichier ») ; la session est relue pour le titre suivant. */
  async function step(kind: 'next' | 'previous'): Promise<void> {
    const api = getTransport()
    try { await (kind === 'next' ? api.musicQueueNext(deviceId.value) : api.musicQueuePrevious(deviceId.value)) }
    finally { void refresh() }
  }
  async function setRepeat(mode: MusicRepeat): Promise<void> {
    const q = await getTransport().musicQueueRepeat(deviceId.value, mode)
    if (session.value?.queue) session.value = { ...session.value, queue: { length: q.items.length, index: q.index, repeat: q.repeat } }
  }

  // même délai que la page Musique : laisser le serveur finir de lancer le titre qu'il enchaîne
  let soon: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  // un autre lecteur dans le même panneau : ne pas lui prêter la session du précédent
  watch(deviceId, () => { session.value = null; station.value = null })
  watch(() => `${deviceId.value}|${enabled.value}|${state.value.playback}|${state.value.nowPlaying?.title ?? ''}`, () => {
    clearTimeout(soon)
    soon = setTimeout(() => { void refresh() }, 800)
  })
  onMounted(() => {
    void refresh()
    ticker = setInterval(() => { void refresh() }, 20_000)
  })
  onBeforeUnmount(() => { clearTimeout(soon); clearInterval(ticker) })

  return { session, station, step, setRepeat }
}
