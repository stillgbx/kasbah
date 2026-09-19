import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import type { Parking } from './schema'
import {
  assignParkings, atRest, fitParkingGap, parkingAccepts, parkingCorners, parkingDistance, parkingGaps, parkingHost,
} from './parking'
import { pointInPolygon as pointIn } from './geometry/vec2'

const house = parseHouse(demo)

/** Une place de 2 × 4 m au point voulu, tournée de `yaw` (0 = avant vers +y). */
const bay = (id: string, center: [number, number], yaw = 0, over: Partial<Parking> = {}): Parking =>
  ({ id, accepts: 'vehicle', center, size: [2, 4], yaw, ...over }) as Parking

describe('géométrie de la place', () => {
  it('pose ses quatre coins autour du centre, tournés du yaw', () => {
    const [fr, fl, bl, br] = parkingCorners(bay('p', [10, 20]))
    expect(fr).toEqual([11, 22])                // avant-droit : +x (droite), +y (avant)
    expect(fl).toEqual([9, 22])
    expect(bl).toEqual([9, 18])
    expect(br).toEqual([11, 18])
    // tournée d'un quart de tour, l'avant regarde -x : la place devient longue selon x
    const turned = parkingCorners(bay('p', [0, 0], 90))
    expect(turned[0][0]).toBeCloseTo(-2, 6)
    expect(turned[0][1]).toBeCloseTo(1, 6)
  })

  it('mesure 0 dedans, et la vraie distance dehors', () => {
    const p = bay('p', [0, 0])
    expect(parkingDistance(p, [0.5, 1])).toBe(0)
    expect(parkingDistance(p, [1, 2])).toBe(0)              // sur le coin
    expect(parkingDistance(p, [4, 0])).toBeCloseTo(3, 6)    // 4 − demi-largeur
    expect(parkingDistance(p, [0, -6])).toBeCloseTo(4, 6)   // 6 − demi-longueur
  })
})

describe('qui a droit à quelle place', () => {
  it('refuse un kind qui n est pas le sien', () => {
    const p = bay('garage-1', [0, 0])
    expect(parkingAccepts(p, 'vehicle', 'tesla:5YJ')).toBe(true)
    expect(parkingAccepts(p, 'mower', 'husq:1')).toBe(false)
  })

  it('réserve la place qui nomme un appareil — une base ne se partage pas', () => {
    const base = bay('base-tondeuse', [0, 0], 0, { accepts: 'mower', deviceId: 'husq:1', size: [0.6, 0.8] })
    expect(parkingAccepts(base, 'mower', 'husq:1')).toBe(true)
    expect(parkingAccepts(base, 'mower', 'roborock:2')).toBe(false)
  })
})

describe('au repos', () => {
  const vehicle = (over: Record<string, unknown>) =>
    ({ kind: 'vehicle', soc: 50, rangeKm: 100, pluggedIn: false, charging: false, updatedAt: 0, ...over }) as never

  it('accroche la voiture qui ne dit rien de son mouvement (la R5 ne publie ni vitesse ni rapport)', () => {
    expect(atRest(vehicle({}))).toBe(true)
    expect(atRest(undefined)).toBe(true)
  })

  it('lâche celle qui DIT qu elle roule', () => {
    expect(atRest(vehicle({ speedKmh: 30 }))).toBe(false)
    expect(atRest(vehicle({ gear: 'D' }))).toBe(false)
    expect(atRest(vehicle({ speedKmh: 0, gear: 'P' }))).toBe(true)
  })

  it('ne range la tondeuse qu à sa base, jamais en tonte ni arrêtée dans le jardin', () => {
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

  it('range l engin au repos dont le relevé tombe près d une place, et lui donne son cap', () => {
    const fix = assignParkings([bay('garage-1', [10, 10], 96)], [car('tesla', [11, 11.5])])
    expect(fix.get('tesla')).toEqual({ parkingId: 'garage-1', position: [10, 10], yaw: 96 })
  })

  it('laisse où il est celui qui est trop loin, ou qui roule', () => {
    const p = [bay('garage-1', [10, 10])]
    expect(assignParkings(p, [car('tesla', [20, 20])]).size).toBe(0)
    expect(assignParkings(p, [{ ...car('tesla', [10, 10]), atRest: false }]).size).toBe(0)
  })

  it('ne met pas deux voitures dans le même garage : le plus près sert le premier', () => {
    const parkings = [bay('garage-1', [0, 0]), bay('garage-2', [4, 0])]
    const fix = assignParkings(parkings, [car('a', [0.5, 0]), car('b', [1, 0])])
    expect(fix.get('a')?.parkingId).toBe('garage-1')
    expect(fix.get('b')?.parkingId).toBe('garage-2')
    // la seconde n'a nulle part où aller si la seule place est prise
    const one = assignParkings([parkings[0]!], [car('a', [0.5, 0]), car('b', [1, 0])])
    expect(one.get('a')?.parkingId).toBe('garage-1')
    expect(one.has('b')).toBe(false)
  })

  it('respecte la marge propre à la place', () => {
    const large = bay('allee', [0, 0], 0, { margin: 6 })
    expect(assignParkings([large], [car('a', [7, 0])]).size).toBe(1)     // 7 − 1 = 6 m du bord
    expect(assignParkings([bay('allee', [0, 0])], [car('a', [7, 0])]).size).toBe(0)
  })
})

describe('les quatre cotes', () => {
  // un carré de 10 × 10 m centré en (5, 5) : les cotes se lisent de tête
  const host: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]]

  it('mesure ce qui sépare chaque bord du contour de l hôte', () => {
    const gaps = parkingGaps(host, bay('p', [5, 5]))
    expect(gaps).toEqual({ front: 3, back: 3, left: 4, right: 4 })
  })

  it('suit la rotation : une place en travers échange ses cotes', () => {
    const gaps = parkingGaps(host, bay('p', [5, 5], 90))
    expect(gaps).toEqual({ front: 3, back: 3, left: 4, right: 4 })
    const off = parkingGaps(host, bay('p', [3, 5], 90))
    expect(off.front).toBe(1)      // avant vers -x : 3 − 2
    expect(off.back).toBe(5)
  })

  it('ne dit rien du côté qui ne rencontre pas le contour', () => {
    expect(parkingGaps(host, bay('p', [15, 5])).right).toBeNull()
  })

  it('fait GLISSER la place de ce qui manque, sans toucher aux autres cotes', () => {
    const p = bay('p', [5, 5])
    const center = fitParkingGap(host, p, 'front', 1)!
    expect(center).toEqual([5, 7])
    expect(parkingGaps(host, { ...p, center })).toEqual({ front: 1, back: 5, left: 4, right: 4 })
    expect(fitParkingGap(host, p, 'right', 1)).toEqual([8, 5])
  })
})

describe('parkingHost', () => {
  it('trouve la pièce sous la place, sinon la zone, sinon le terrain', () => {
    const salon = house.rooms.find((r) => r.id === 'salon')!
    const inSalon = parkingHost(house, bay('p', [salon.polygon[0]![0] + 1, salon.polygon[0]![1] + 1]))
    expect(inSalon).toMatchObject({ kind: 'room', id: 'salon' })
    expect(parkingHost(house, bay('p', [9999, 9999]))).toBeNull()
  })

  /**
   * Une place porte son NIVEAU : le même point au sol tombe dans le salon au rez-de-chaussée et dans
   * une chambre à l'étage, et une place du premier n'a rien à mesurer depuis la pièce du dessous.
   */
  it('cherche sa pièce DANS son niveau, pas dans celui du dessous', () => {
    const point: [number, number] = [6, 2]                      // salon (rdc) ET chambre 2 (étage)
    expect(parkingHost(house, bay('p', point))).toMatchObject({ kind: 'room', id: 'salon' })
    const upstairs = house.rooms.find((r) => r.levelId !== 'rdc' && pointIn(point, r.polygon))!
    expect(parkingHost(house, bay('p', point, 0, { levelId: upstairs.levelId }))).toMatchObject({ kind: 'room', id: upstairs.id })
  })

  it('ne cote rien sur un niveau qui n a ni pièce sous le point ni emprise', () => {
    expect(parkingHost(house, bay('p', [-30, -30], 0, { levelId: 'rdc' }))).toBeNull()
  })
})
