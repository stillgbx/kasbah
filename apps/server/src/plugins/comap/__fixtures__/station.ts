// Response CAPTURED from the real Proteo 2 station (192.168.1.92:23), request
// `{"1234567":{"msgId":5,"read":["status","about","alert","config","consumption","flow","lamp","rtc","wear"]}}`.
// Written from the real response and not from the manual: `alert` carries the 21 codes D001-D021,
// whose meaning is documented nowhere (the manual refers to after-sales service) — Kasbah does not
// decode them, and `D005`/`D017` being 1 while `status.warning`/`status.defect` are 0 confirms it:
// `[0]` does not mean "active".

export const STATION_READ = {
  '1234567': {
    msgId: 5,
    read: {
      status: { warning: 0, defect: 0, uvc: 1, mode: 1 },
      about: { hw: 'V8.00.000', fw: 'V1.21', mod: 'Proteo V3', sn: 'A00000000' },
      alert: {
        D001: [0, 436540352, 0, 437945175],
        D002: [0, 0, 0, 0],
        D003: [0, 0, 0, 0],
        D004: [0, 0, 0, 0],
        D005: [1, 421073709, 0, 421073710],
        D006: [0, 0, 0, 0],
        D007: [0, 0, 0, 0],
        D008: [0, 0, 0, 0],
        D009: [0, 0, 0, 0],
        D010: [0, 0, 0, 0],
        D011: [0, 0, 0, 0],
        D012: [0, 0, 0, 0],
        D013: [0, 0, 0, 0],
        D014: [0, 0, 0, 0],
        D015: [0, 0, 0, 0],
        D016: [0, 0, 0, 0],
        D017: [1, 436437870, 0, 437945176],
        D018: [0, 0, 0, 0],
        D019: [0, 0, 0, 0],
        D020: [0, 0, 0, 0],
        D021: [0, 0, 0, 0],
      },
      config: { lang: '00_fr', waterQ: 0, prefilt: 0, waterT: 1 },
      consumption: { day: 412, week: 1210, month: 6980, year: [10500, 9800, 10200, 11900, 10400, 10100, 11600, 7500, 0, 0, 0, 0] },
      flow: { inst: 0, max: 2556, avge: 346 },
      lamp: { p1: [0, 0, 7, 0], p2: [0, 0, 0, 0], p3: [0, 0, 0, 0] },
      rtc: { date: [16, 9, 2026], time: [22, 51] },
      wear: { prefilt: 95, filt1: 95, filt2: 95, lamp: 96 },
    },
  },
} as const
