// Ressources CLIP v2 anonymisées d'un bridge : 2 lampes (couleur + blanc réglable) sur 2 appareils
// dans une pièce, une lampe blanche seule hors pièce, connectivité Zigbee.

export const LIGHTS = [
  {
    id: 'l-color', type: 'light', owner: { rid: 'd-color', rtype: 'device' },
    metadata: { name: 'Salon plafonnier', archetype: 'ceiling_round' },
    on: { on: true }, dimming: { brightness: 63.5, min_dim_level: 0.2 },
    color_temperature: { mirek: 366, mirek_valid: true, mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 } },
    color: { xy: { x: 0.4573, y: 0.41 }, gamut_type: 'C' },
  },
  {
    id: 'l-white', type: 'light', owner: { rid: 'd-white', rtype: 'device' },
    metadata: { name: 'Cuisine spot', archetype: 'spot_bulb' },
    on: { on: false }, dimming: { brightness: 100, min_dim_level: 2 },
    color_temperature: { mirek: null, mirek_valid: false, mirek_schema: { mirek_minimum: 153, mirek_maximum: 454 } },
  },
  {
    id: 'l-plain', type: 'light', owner: { rid: 'd-plain', rtype: 'device' },
    metadata: { name: 'Cave' },
    on: { on: true },
  },
]

export const DEVICES = [
  { id: 'd-color', product_data: { product_name: 'Hue color lamp', model_id: 'LCA001', manufacturer_name: 'Signify Netherlands B.V.' }, metadata: { name: 'Salon plafonnier' }, services: [{ rid: 'l-color', rtype: 'light' }, { rid: 'z-color', rtype: 'zigbee_connectivity' }] },
  { id: 'd-white', product_data: { product_name: 'Hue ambiance spot', model_id: 'LTG002', manufacturer_name: 'Signify Netherlands B.V.' }, metadata: { name: 'Cuisine spot' }, services: [{ rid: 'l-white', rtype: 'light' }, { rid: 'z-white', rtype: 'zigbee_connectivity' }] },
  { id: 'd-plain', product_data: { product_name: 'Hue white lamp', model_id: 'LWA001', manufacturer_name: 'Signify Netherlands B.V.' }, metadata: { name: 'Cave' }, services: [{ rid: 'l-plain', rtype: 'light' }, { rid: 'z-plain', rtype: 'zigbee_connectivity' }] },
]

export const ROOMS = [
  { id: 'r-living', metadata: { name: 'Salon', archetype: 'living_room' }, children: [{ rid: 'd-color', rtype: 'device' }, { rid: 'd-white', rtype: 'device' }], services: [{ rid: 'g-living', rtype: 'grouped_light' }] },
]

export const GROUPED_LIGHTS = [
  { id: 'g-living', owner: { rid: 'r-living', rtype: 'room' }, on: { on: true }, dimming: { brightness: 80 } },
]

export const ZIGBEE = [
  { id: 'z-color', owner: { rid: 'd-color', rtype: 'device' }, status: 'connected' },
  { id: 'z-white', owner: { rid: 'd-white', rtype: 'device' }, status: 'connectivity_issue' },
  { id: 'z-plain', owner: { rid: 'd-plain', rtype: 'device' }, status: 'connected' },
]

/** Une trame SSE brute telle que reçue du bridge (2 événements). */
export const SSE_FRAME =
  'id: 1725000000:0\n' +
  'data: [{"creationtime":"2026-09-04T10:00:00Z","id":"e1","type":"update","data":[{"id":"l-color","type":"light","dimming":{"brightness":20}},{"id":"l-color","type":"light","color":{"xy":{"x":0.2,"y":0.3}}}]}]\n' +
  '\n' +
  'id: 1725000001:0\n' +
  'data: [{"creationtime":"2026-09-04T10:00:01Z","id":"e2","type":"update","data":[{"id":"z-white","type":"zigbee_connectivity","owner":{"rid":"d-white","rtype":"device"},"status":"connected"}]}]\n' +
  '\n'

export const PAIR_101 = [{ error: { type: 101, address: '', description: 'link button not pressed' } }]
export const PAIR_OK = [{ success: { username: 'abcdefgh-app-key', clientkey: 'CLIENTKEY' } }]
