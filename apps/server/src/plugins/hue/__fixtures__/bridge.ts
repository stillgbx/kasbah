// Anonymized CLIP v2 resources of a bridge: 2 lights (color + tunable white) on 2 devices in a
// room, a lone white light outside any room (with effects), Zigbee connectivity, a zone, two
// scenes (a static one on the room, one with an animated palette on the zone).

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
    effects: { status: 'no_effect', effect_values: ['no_effect', 'candle', 'fire'], status_values: ['no_effect', 'candle', 'fire'] },
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

export const ZONES = [
  { id: 'z-evening', metadata: { name: 'Soirée' }, children: [{ rid: 'd-color', rtype: 'device' }], services: [] },
]

export const SCENES = [
  {
    id: 's-relax', type: 'scene', metadata: { name: 'Détente' }, group: { rid: 'r-living', rtype: 'room' },
    actions: [
      { target: { rid: 'l-color', rtype: 'light' }, action: { on: { on: true }, dimming: { brightness: 40 }, color_temperature: { mirek: 400 } } },
      { target: { rid: 'l-white', rtype: 'light' }, action: { on: { on: true }, dimming: { brightness: 60 }, color_temperature: { mirek: 400 } } },
    ],
    palette: { color: [], dimming: [], color_temperature: [{ color_temperature: { mirek: 366 }, dimming: { brightness: 80 } }], effects: [] },
    speed: 0.5, auto_dynamic: false, status: { active: 'inactive', last_recall: '2026-09-01T18:00:00.000Z' },
  },
  {
    id: 's-tropical', type: 'scene', metadata: { name: 'Crépuscule tropical', image: { rid: 'img-1', rtype: 'public_image' } },
    group: { rid: 'z-evening', rtype: 'zone' },
    actions: [{ target: { rid: 'l-color', rtype: 'light' }, action: { on: { on: true }, dimming: { brightness: 44 }, color: { xy: { x: 0.4731, y: 0.3723 } } } }],
    palette: {
      color: [
        { color: { xy: { x: 0.2412, y: 0.1171 } }, dimming: { brightness: 44 } },
        { color: { xy: { x: 0.5813, y: 0.3636 } }, dimming: { brightness: 44 } },
      ],
      dimming: [], color_temperature: [], effects: [],
    },
    speed: 0.63, auto_dynamic: true, status: { active: 'dynamic_palette' },
  },
]

export const GROUPED_LIGHTS = [
  { id: 'g-living', owner: { rid: 'r-living', rtype: 'room' }, on: { on: true }, dimming: { brightness: 80 } },
]

export const ZIGBEE = [
  { id: 'z-color', owner: { rid: 'd-color', rtype: 'device' }, status: 'connected' },
  { id: 'z-white', owner: { rid: 'd-white', rtype: 'device' }, status: 'connectivity_issue' },
  { id: 'z-plain', owner: { rid: 'd-plain', rtype: 'device' }, status: 'connected' },
]

/** A raw SSE frame as received from the bridge (4 events). */
export const SSE_FRAME =
  'id: 1725000000:0\n' +
  'data: [{"creationtime":"2026-09-04T10:00:00Z","id":"e1","type":"update","data":[{"id":"l-color","type":"light","dimming":{"brightness":20}},{"id":"l-color","type":"light","color":{"xy":{"x":0.2,"y":0.3}}}]}]\n' +
  '\n' +
  'id: 1725000001:0\n' +
  'data: [{"creationtime":"2026-09-04T10:00:01Z","id":"e2","type":"update","data":[{"id":"z-white","type":"zigbee_connectivity","owner":{"rid":"d-white","rtype":"device"},"status":"connected"}]}]\n' +
  '\n' +
  'id: 1725000002:0\n' +
  'data: [{"creationtime":"2026-09-04T10:00:02Z","id":"e3","type":"update","data":[{"id":"s-relax","type":"scene","status":{"active":"static"}}]}]\n' +
  '\n' +
  'id: 1725000003:0\n' +
  'data: [{"creationtime":"2026-09-04T10:00:03Z","id":"e4","type":"update","data":[{"id":"s-tropical","type":"scene","auto_dynamic":false}]}]\n' +
  '\n'

export const PAIR_101 = [{ error: { type: 101, address: '', description: 'link button not pressed' } }]
export const PAIR_OK = [{ success: { username: 'abcdefgh-app-key', clientkey: 'CLIENTKEY' } }]
