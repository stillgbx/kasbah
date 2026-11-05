// Late bridge to a light stream (Hue Entertainment today), for the music light sync: the music
// player has no access to a plugin's internals, the plugin registers here when it starts and
// leaves when it stops — the same pattern as `playbackBridge.ts` and the music sources.

export interface ChannelColor {
  /** Channel id of the area (0..255). */
  id: number
  /** 0..1 each. */
  r: number
  g: number
  b: number
}

export interface LightChannel {
  id: number
  /** Position in the area, -1..1 on each axis (x: left → right, y: back → front, z: down → up). */
  x: number
  y: number
  z: number
}

export interface LightArea {
  id: string
  name: string
  channels: LightChannel[]
}

export interface LightStream {
  readonly area: LightArea
  /** One frame for all channels; cheap, meant to be called 25-50 times per second. */
  send(colors: readonly ChannelColor[]): void
  /** Ends the stream; the lights go back to what they were showing. Idempotent. */
  close(): Promise<void>
  /** Called once if the stream ends on its own (bridge gone, taken over by another app). */
  onEnded(cb: (reason: string) => void): void
}

export interface LightStreamer {
  /**
   * The area to stream to for a room, given the room's light device ids: an area whose lights are
   * all in the room (nothing blinks next door), covering most of them. Undefined if none.
   */
  areaFor(lightDeviceIds: readonly string[]): LightArea | undefined
  /** Opens a stream; the bridge streams one area at a time. */
  open(areaId: string): Promise<LightStream>
}

let streamer: LightStreamer | null = null

export function setLightStreamer(next: LightStreamer | null): void {
  streamer = next
}

export function getLightStreamer(): LightStreamer | null {
  return streamer
}
