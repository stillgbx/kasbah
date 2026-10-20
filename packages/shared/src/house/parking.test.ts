import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import type { Parking } from './schema'
import {
  assignParkings, atRest, fitParkingGap, parkingAccepts, parkingCorners, parkingDistance, parkingGaps, parkingHost,
} from './parking'
import { pointInPolygon as pointIn } from './geometry/vec2'

const house = parseHouse(demo)

/** A 2 × 4 m spot at the wanted point, rotated by `yaw` (0 = front toward +y). */
const bay = (id: string, center: [number, number], yaw = 0, over: Partial<Parking> = {}): Parking =>
  ({ id, accepts: 'vehicle', center, size: [2, 4], yaw, ...over }) as Parking

describe('spot geometry', () => {
  it('places its four corners around the center, rotated by the yaw', () => {
    const [fr, fl, bl, br] = parkingCorners(bay('p', [10, 20]))
    expect(fr).toEqual([11, 22])                // front-right: +x (right), +y (front)
    expect(fl).toEqual([9, 22])
    expect(bl).toEqual([9, 18])
    expect(br).toEqual([11, 18])
    // rotated by a quarter turn, the front faces -x: the spot becomes long along x
    const turned = parkingCorners(bay('p', [0, 0], 90))
    expect(turned[0][0]).toBeCloseTo(-2, 6)
    expect(turned[0][1]).toBeCloseTo(1, 6)
  })

  it('measures 0 inside, and the true distance outside', () => {
    const p = bay('p', [0, 0])
    expect(parkingDistance(p, [0.5, 1])).toBe(0)
    expect(parkingDistance(p, [1, 2])).toBe(0)              // on the corner
    expect(parkingDistance(p, [4, 0])).toBeCloseTo(3, 6)    // 4 − demi-largeur
    expect(parkingDistance(p, [0, -6])).toBeCloseTo(4, 6)   // 6 − demi-longueur
  })
})

describe('who is entitled to which spot', () => {
  it('refuses a kind that is not its own', () => {
    const p = bay('garage-1', [0, 0])
    expect(parkingAccepts(p, 'vehicle', 'tesla:5YJ')).toBe(true)
    expect(parkingAccepts(p, 'mower', 'husq:1')).toBe(false)
  })

  it('reserves the spot that names a device — a base is not shared', () => {
    const base = bay('base-tondeuse', [0, 0], 0, { accepts: 'mower', deviceId: 'husq:1', size: [0.6, 0.8] })
    expect(parkingAccepts(base, 'mower', 'husq:1')).toBe(true)
    expect(parkingAccepts(base, 'mower', 'roborock:2')).toBe(false)
  })
})

describe('at rest', () => {
  const vehicle = (over: Record<string, unknown>) =>
    ({ kind: 'vehicle', soc: 50, rangeKm: 100, pluggedIn: false, charging: false, updatedAt: 0, ...over }) as never

  it('snaps the car that says nothing about its movement (the R5 publishes neither speed nor gear)', () => {
    expect(atRest(vehicle({}))).toBe(true)
    expect(atRest(undefined)).toBe(true)
  })

  it('lets go of the one that SAYS it is driving', () => {
    expect(atRest(vehicle({ speedKmh: 30 }))).toBe(false)
    expect(atRest(vehicle({ gear: 'D' }))).toBe(false)
    expect(atRest(vehicle({ speedKmh: 0, gear: 'P' }))).toBe(true)
  })

  it('only parks the mower at its base, never mowing nor stopped in the garden', () => {
    const mower = (activity: string) => ({ kind: 'mower', activity, battery: 50, updatedAt: 0 }) as never
    expect(atRest(mower('parked'))).toBe(true)
    expect(atRest(mower('charging'))).toBe(true)
    expect(atRest(mower('mowing'))).toBe(false)
    expect(atRest(mower('stopped'))).toBe(false)
  })
})

describe('assignParkings', () => {
  const car = (key: string, point: [number, number], over: Partial<Parking> = {}) =>
    ({ key, kind: 'vehicle' as const, point, atRest: true, ...over })

  it('parks the resting vehicle whose reading falls near a spot, and gives it its heading', () => {
    const fix = assignParkings([bay('garage-1', [10, 10], 96)], [car('tesla', [11, 11.5])])
    expect(fix.get('tesla')).toEqual({ parkingId: 'garage-1', position: [10, 10], yaw: 96 })
  })

  it('leaves where it is the one that is too far away, or that is driving', () => {
    const p = [bay('garage-1', [10, 10])]
    expect(assignParkings(p, [car('tesla', [20, 20])]).size).toBe(0)
    expect(assignParkings(p, [{ ...car('tesla', [10, 10]), atRest: false }]).size).toBe(0)
  })

  it('does not put two cars in the same garage: the closest is served first', () => {
    const parkings = [bay('garage-1', [0, 0]), bay('garage-2', [4, 0])]
    const fix = assignParkings(parkings, [car('a', [0.5, 0]), car('b', [1, 0])])
    expect(fix.get('a')?.parkingId).toBe('garage-1')
    expect(fix.get('b')?.parkingId).toBe('garage-2')
    // the second has nowhere to go if the only spot is taken
    const one = assignParkings([parkings[0]!], [car('a', [0.5, 0]), car('b', [1, 0])])
    expect(one.get('a')?.parkingId).toBe('garage-1')
    expect(one.has('b')).toBe(false)
  })

  it('respects the margin specific to the spot', () => {
    const large = bay('allee', [0, 0], 0, { margin: 6 })
    expect(assignParkings([large], [car('a', [7, 0])]).size).toBe(1)     // 7 − 1 = 6 m from the edge
    expect(assignParkings([bay('allee', [0, 0])], [car('a', [7, 0])]).size).toBe(0)
  })
})

describe('the four dimensions', () => {
  // a 10 × 10 m square centered at (5, 5): the dimensions can be read at a glance
  const host: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]

  it('measures what separates each edge from the outline of the host', () => {
    const gaps = parkingGaps(host, bay('p', [5, 5]))
    expect(gaps).toEqual({ front: 3, back: 3, left: 4, right: 4 })
  })

  it('follows the rotation: a spot across swaps its dimensions', () => {
    const gaps = parkingGaps(host, bay('p', [5, 5], 90))
    expect(gaps).toEqual({ front: 3, back: 3, left: 4, right: 4 })
    const off = parkingGaps(host, bay('p', [3, 5], 90))
    expect(off.front).toBe(1)      // front toward -x: 3 − 2
    expect(off.back).toBe(5)
  })

  it('says nothing of the side that does not meet the outline', () => {
    expect(parkingGaps(host, bay('p', [15, 5])).right).toBeNull()
  })

  it('SLIDES the spot by what is missing, without touching the other dimensions', () => {
    const p = bay('p', [5, 5])
    const center = fitParkingGap(host, p, 'front', 1)!
    expect(center).toEqual([5, 7])
    expect(parkingGaps(host, { ...p, center })).toEqual({ front: 1, back: 5, left: 4, right: 4 })
    expect(fitParkingGap(host, p, 'right', 1)).toEqual([8, 5])
  })
})

describe('parkingHost', () => {
  it('finds the room under the spot, otherwise the zone, otherwise the terrain', () => {
    const salon = house.rooms.find((r) => r.id === 'salon')!
    const inSalon = parkingHost(house, bay('p', [salon.polygon[0]![0] + 1, salon.polygon[0]![1] + 1]))
    expect(inSalon).toMatchObject({ kind: 'room', id: 'salon' })
    expect(parkingHost(house, bay('p', [9999, 9999]))).toBeNull()
  })

  /**
   * A spot carries its LEVEL: the same ground point falls in the living room on the ground floor and in
   * a bedroom upstairs, and a spot on the first floor has nothing to measure from the room below.
   */
  it('looks for its room IN its level, not in the one below', () => {
    const point: [number, number] = [6, 2]                      // living room (ground floor) AND bedroom 2 (upper floor)
    expect(parkingHost(house, bay('p', point))).toMatchObject({ kind: 'room', id: 'salon' })
    const upstairs = house.rooms.find((r) => r.levelId !== 'rdc' && pointIn(point, r.polygon))!
    expect(parkingHost(house, bay('p', point, 0, { levelId: upstairs.levelId }))).toMatchObject({ kind: 'room', id: upstairs.id })
  })

  it('measures nothing on a level that has neither a room under the point nor a footprint', () => {
    expect(parkingHost(house, bay('p', [-30, -30], 0, { levelId: 'rdc' }))).toBeNull()
  })
})
