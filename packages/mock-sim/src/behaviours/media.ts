import type { MediaPlayerClass } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor } from './common'

const PLAYLIST = [
  { title: 'Morning Light', artist: 'The Kasbah Ensemble', album: 'Courtyard', durationS: 214 },
  // a title flagged explicit: the simulation must be able to show that badge, no speaker reports it
  { title: 'Terracotta', artist: 'Mira Solano', album: 'Ochre', durationS: 187, explicit: true },
  { title: 'Riad at Dusk', artist: 'Nour Quartet', album: 'Lanterns', durationS: 256 },
  { title: 'Tiles', artist: 'The Kasbah Ensemble', album: 'Courtyard', durationS: 198 },
  { title: 'Fountain Loop', artist: 'Ambient Souk', album: 'Water', durationS: 302 },
  { title: 'Saffron', artist: 'Mira Solano', album: 'Ochre', durationS: 176 },
]

export interface MediaOptions {
  name: string
  volume?: number
  playing?: boolean
  /** Kind of the player (speaker by default): decides the icon and the 3D marker. */
  deviceClass?: MediaPlayerClass
  /** Announced model ("Soundbar", "Smart TV"); default based on the kind. */
  model?: string
}

const MODELS: Record<MediaPlayerClass, string> = { speaker: 'Speaker', tv: 'Smart TV', display: 'Smart display' }

export function mediaPlayer(externalId: string, o: MediaOptions): SimDevice<'media_player'> {
  let track = 0
  const now = (positionS: number) => ({ ...PLAYLIST[track]!, positionS, source: 'Mock Music' })
  const dev: SimDevice<'media_player'> = {
    descriptor: descriptor(externalId, 'media_player', o.name, ['playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek', 'play_url'], { manufacturer: 'Mock', model: o.model ?? MODELS[o.deviceClass ?? 'speaker'], mediaPlayer: { deviceClass: o.deviceClass ?? 'speaker' } }),
    state: {
      kind: 'media_player', updatedAt: 0, available: true,
      playback: o.playing ? 'playing' : 'idle', volume: o.volume ?? 35, muted: false,
      ...(o.playing ? { nowPlaying: now(0) } : {}),
    },
    tick(ctx) {
      if (dev.state.playback !== 'playing' || !dev.state.nowPlaying) return
      let pos = (dev.state.nowPlaying.positionS ?? 0) + ctx.dtS
      while (pos >= PLAYLIST[track]!.durationS) { pos -= PLAYLIST[track]!.durationS; track = (track + 1) % PLAYLIST.length }
      dev.state.nowPlaying = now(Math.floor(pos))
      ctx.world.loadsW += 8
    },
    apply(cmd) {
      switch (cmd.type) {
        case 'media_player.play':
          dev.state.playback = 'playing'
          if (!dev.state.nowPlaying) dev.state.nowPlaying = now(0)
          break
        case 'media_player.pause': dev.state.playback = 'paused'; break
        case 'media_player.stop': dev.state.playback = 'idle'; delete dev.state.nowPlaying; break
        case 'media_player.next': track = (track + 1) % PLAYLIST.length; dev.state.nowPlaying = now(0); break
        case 'media_player.previous':
          // like a remote control: past 3 s, back to the start of the track; otherwise the previous one
          if ((dev.state.nowPlaying?.positionS ?? 0) > 3) { dev.state.nowPlaying = now(0); break }
          track = (track - 1 + PLAYLIST.length) % PLAYLIST.length; dev.state.nowPlaying = now(0); break
        case 'media_player.set_volume': dev.state.volume = clamp(Math.round(cmd.volume), 0, 100); break
        case 'media_player.set_mute': dev.state.muted = cmd.muted; break
        case 'media_player.seek':
          if (dev.state.nowPlaying) dev.state.nowPlaying = now(clamp(Math.floor(cmd.positionS), 0, PLAYLIST[track]!.durationS))
          break
        case 'media_player.play_url': {
          let title = cmd.title
          if (!title) {
            title = cmd.url
            try { title = new URL(cmd.url).hostname || cmd.url } catch { /* */ }
          }
          dev.state.playback = 'playing'
          dev.state.nowPlaying = {
            title,
            ...(cmd.artist ? { artist: cmd.artist } : {}),
            ...(cmd.artUrl ? { artUrl: cmd.artUrl } : {}),
            source: cmd.url,
          }
          break
        }
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on media_player`)
      }
    },
  }
  return dev
}
