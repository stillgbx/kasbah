/**
 * TRANSIENT event of a device (not a state): doorbell ring, motion… Arrives through Pub/Sub
 * at Nest. The client reacts on the spot (frame the room, open the live view); nothing is kept.
 *
 * Its own file: the WebSocket protocol and the automations both read it, and the protocol already
 * imports the automations (a cycle would leave the list undefined at load).
 */
export const DEVICE_EVENT_KINDS = ['chime', 'motion', 'person', 'sound'] as const
export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number]
