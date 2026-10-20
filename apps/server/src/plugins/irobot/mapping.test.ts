import { describe, expect, it } from 'vitest'
import { errorText, readMissionStatus, toActivity, toDescriptor, toRobotCommands, toStatePatch } from './mapping'
import { BIN_FULL, CLEANING, DOCKED, DOCKED_MISSION_OPEN, MOP_ATTACHED, PAUSED, RETURNING, STUCK, TANK_REMOVED } from './__fixtures__/shadows'

const BLID = '1111111111111111111111111111AAAA'

describe('toActivity', () => {
  it('reads the five states of a sequence actually played', () => {
    expect(toActivity(readMissionStatus(PAUSED))).toBe('paused')
    expect(toActivity(readMissionStatus(RETURNING))).toBe('returning')
    expect(toActivity(readMissionStatus(DOCKED))).toBe('docked')
    expect(toActivity(readMissionStatus(CLEANING))).toBe('cleaning')
    expect(toActivity(readMissionStatus(STUCK))).toBe('error')
  })

  /**
   * The test that matters. On arriving at the dock, the robot switches to `phase: "charge"` FOUR
   * SECONDS before closing its mission (`cycle: "none"`) — measured on 09/19 at 14:30:33 then
   * 14:30:37. A mapping that decided on `cycle` first would publish "paused" for a docked robot.
   */
  it('does not publish "paused" for a docked robot whose mission is not closed yet', () => {
    expect(readMissionStatus(DOCKED_MISSION_OPEN)).toMatchObject({ cycle: 'clean', phase: 'charge' })
    expect(toActivity(readMissionStatus(DOCKED_MISSION_OPEN))).toBe('docked')
  })

  it('tells "stopped with an open mission" from "stopped with no mission"', () => {
    expect(toActivity({ phase: 'stop', cycle: 'clean' })).toBe('paused')
    expect(toActivity({ phase: 'stop', cycle: 'none' })).toBe('docked')
  })

  it('an error wins over any phase', () => {
    expect(toActivity({ phase: 'run', cycle: 'clean', error: 17 })).toBe('error')
  })

  it('returns idle rather than throwing on a phase unknown to the vendor', () => {
    expect(toActivity({ phase: 'une-phase-que-le-firmware-inventera', cycle: 'none' })).toBe('docked')
    expect(toActivity({})).toBe('docked')
  })
})

describe('readMissionStatus', () => {
  it('survives an empty or malformed shadow — the robot speaks in deltas', () => {
    expect(readMissionStatus({})).toEqual({})
    expect(readMissionStatus({ cleanMissionStatus: null })).toEqual({})
    expect(readMissionStatus({ cleanMissionStatus: 'bruit' })).toEqual({})
  })

  it('ignores a field of unexpected type instead of losing the others', () => {
    expect(readMissionStatus({ cleanMissionStatus: { phase: 'run', error: 'zéro' } })).toEqual({ phase: 'run' })
  })
})

describe('toStatePatch', () => {
  it('publishes exactly what the `vacuum` contract carries, and nothing more', () => {
    expect(toStatePatch(DOCKED)).toEqual({
      activity: 'docked', battery: 100, binFull: false, errorMessage: null,
      mopAttached: false, tankLevel: 10,
    })
  })

  it('reports the full bin', () => {
    expect(toStatePatch(BIN_FULL)).toMatchObject({ binFull: true })
  })

  it('translates the vendor error code, and clears the message when there is none anymore', () => {
    expect(toStatePatch(STUCK)).toMatchObject({ activity: 'error', errorMessage: 'Path blocked' })
    expect(toStatePatch(CLEANING).errorMessage).toBeNull()
  })

  it('omits the battery until the robot has reported it, rather than inventing a zero', () => {
    expect(toStatePatch({ cleanMissionStatus: { phase: 'run', cycle: 'clean' } })).toEqual({ activity: 'cleaning', errorMessage: null })
  })

  it('clamps the battery to a percentage', () => {
    expect(toStatePatch({ batPct: 140 }).battery).toBe(100)
    expect(toStatePatch({ batPct: -3 }).battery).toBe(0)
    expect(toStatePatch({ batPct: 84.6 }).battery).toBe(85)
  })
})

describe('mop', () => {
  it('reads the pad on the TWO values observed on the real robot', () => {
    expect(toStatePatch(DOCKED).mopAttached).toBe(false)          // detectedPad: "invalid"
    expect(toStatePatch(MOP_ATTACHED).mopAttached).toBe(true)     // detectedPad: "reusableWet"
  })

  /**
   * Deliberately permissive reading rule: only `invalid` means "no pad". The dry or disposable
   * pad values have not been observed, and a guessed allowlist would reject a pad that is really
   * there.
   */
  it('treats any value other than `invalid` as a pad', () => {
    expect(toStatePatch({ detectedPad: 'dispDry' }).mopAttached).toBe(true)
    expect(toStatePatch({ detectedPad: 'une-valeur-que-le-firmware-inventera' }).mopAttached).toBe(true)
  })

  it('returns the water level as a percentage', () => {
    expect(toStatePatch(MOP_ATTACHED).tankLevel).toBe(10)
    expect(toStatePatch({ tankLvl: 140 }).tankLevel).toBe(100)
    expect(toStatePatch({ tankLvl: 63.4 }).tankLevel).toBe(63)
  })

  it('CLEARS the level when the tank is removed, instead of keeping a stale value', () => {
    expect(toStatePatch(TANK_REMOVED).tankLevel).toBeNull()
  })

  it('says nothing about the mop when the robot does not mention it', () => {
    const patch = toStatePatch({ batPct: 50 })
    expect(patch.mopAttached).toBeUndefined()
    expect(patch.tankLevel).toBeUndefined()
  })
})

describe('canMop', () => {
  it('declares `mop` for a robot that announces it can mop', () => {
    expect(toDescriptor({ blid: BLID }, MOP_ATTACHED).capabilities).toEqual(['clean', 'dock', 'battery', 'locate', 'mop'])
  })

  it('does not declare it for a dry Roomba — its card would have nothing to put there', () => {
    expect(toDescriptor({ blid: BLID, cap: { scrub: 0 } }).capabilities).toEqual(['clean', 'dock', 'battery', 'locate'])
    expect(toDescriptor({ blid: BLID }).capabilities).toEqual(['clean', 'dock', 'battery', 'locate'])
  })
})

describe('toDescriptor', () => {
  it('names the robot as it names itself, and declares its four capabilities', () => {
    expect(toDescriptor({ blid: BLID, name: 'nom du compte', sku: null }, DOCKED)).toEqual({
      id: `irobot:${BLID}`,
      pluginId: 'irobot',
      externalId: BLID,
      kind: 'vacuum',
      name: 'Robby',
      capabilities: ['clean', 'dock', 'battery', 'locate', 'mop'],
      meta: { manufacturer: 'iRobot', model: 'c755840' },
    })
  })

  it('keeps the account name until the robot has spoken — a switched-off robot stays named', () => {
    expect(toDescriptor({ blid: BLID, name: 'Robby', sku: 'c755840' })).toMatchObject({ name: 'Robby', meta: { model: 'c755840' } })
  })

  it('falls back to a generic name when nobody knows', () => {
    expect(toDescriptor({ blid: BLID }).name).toBe('Roomba')
  })
})

describe('toRobotCommands', () => {
  it('translates the contract single button into `start` or `resume` depending on the activity', () => {
    expect(toRobotCommands('vacuum.start', 'docked')).toEqual(['start'])
    expect(toRobotCommands('vacuum.start', 'paused')).toEqual(['resume'])
  })

  /**
   * The robot ACCEPTS a `dock` mid-mission and does nothing — measured on Robby on 09/19 at
   * 14:58: `lastCommand` recorded, `phase: "run"` two and a half minutes later. It has to be
   * stopped first. Without this test, the "Return to dock" button would silently break again.
   */
  it('stops the robot BEFORE sending it home, because a `dock` mid-mission is ignored', () => {
    expect(toRobotCommands('vacuum.dock', 'cleaning')).toEqual(['pause', 'dock'])
  })

  it('stops nothing when the robot is not cleaning: a single `dock` is enough', () => {
    expect(toRobotCommands('vacuum.dock', 'paused')).toEqual(['dock'])
    expect(toRobotCommands('vacuum.dock', 'returning')).toEqual(['dock'])
    expect(toRobotCommands('vacuum.dock', 'error')).toEqual(['dock'])
  })

  it('translates the two remaining actions', () => {
    expect(toRobotCommands('vacuum.pause', 'cleaning')).toEqual(['pause'])
    expect(toRobotCommands('vacuum.locate', 'docked')).toEqual(['find'])
  })

  it('refuses what the robot cannot do', () => {
    expect(toRobotCommands('light.on', 'docked')).toBeNull()
    expect(toRobotCommands('mower.park', 'docked')).toBeNull()
  })
})

describe('errorText', () => {
  it('returns the vendor text when it is known', () => {
    expect(errorText(17)).toBe('Path blocked')
  })

  it('returns the NUMBER rather than an invented label for an unknown code', () => {
    expect(errorText(199)).toBe('Error 199')
  })
})
