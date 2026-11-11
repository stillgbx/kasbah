import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../core/paths'
import { checkHouseText } from './house-check'

// `npm run check:house`: the pure check, on the demo house and in-memory variants of it.

const demoText = readFileSync(resolve(REPO_ROOT, 'house/demo-house.json'), 'utf8')
const demo = () => JSON.parse(demoText) as {
  rooms: { id: string; openings: { segment?: number }[] }[]
  devices: { roomId?: string }[]
}

describe('checkHouseText', () => {
  it('accepts the demo house as is', () => {
    expect(checkHouseText(demoText, 'demo').ok).toBe(true)
  })

  it('rejects truncated JSON with the parser message', () => {
    const r = checkHouseText(demoText.slice(0, 200), 'demo')
    expect(r.ok).toBe(false)
    let message = ''
    try { JSON.parse(demoText.slice(0, 200)) } catch (e) { message = (e as Error).message }
    expect(r.lines.some((l) => l.includes(message))).toBe(true)
  })

  it('rejects an opening on a missing edge with its path', () => {
    const house = demo()
    const room = house.rooms.find((r) => r.openings.some((o) => o.segment !== undefined))!
    room.openings.find((o) => o.segment !== undefined)!.segment = 99
    const r = checkHouseText(JSON.stringify(house), 'demo')
    expect(r.ok).toBe(false)
    expect(r.lines.some((l) => l.startsWith('  - rooms['))).toBe(true)
  })

  it('stays valid but warns about a room emptied of its devices', () => {
    const house = demo()
    house.devices = house.devices.filter((d) => d.roomId !== 'salon')
    const r = checkHouseText(JSON.stringify(house), 'demo')
    expect(r.ok).toBe(true)
    expect(r.lines.some((l) => l.includes('ROOM_WITHOUT_DEVICE'))).toBe(true)
  })
})
