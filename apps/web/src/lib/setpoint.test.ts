import { describe, expect, it } from 'vitest'
import { stepSetpoint, typedSetpoint } from './setpoint'

const RANGE = [10, 30] as const

describe('stepSetpoint', () => {
  it('moves on the grid of degrees and half-degrees, from a typed tenth too', () => {
    expect(stepSetpoint(19.8, 1, RANGE)).toBe(20)
    expect(stepSetpoint(19.8, -1, RANGE)).toBe(19.5)
    expect(stepSetpoint(20, 1, RANGE)).toBe(20.5)
    expect(stepSetpoint(20, -1, RANGE)).toBe(19.5)
  })

  it('stays within the range', () => {
    expect(stepSetpoint(30, 1, RANGE)).toBe(30)
    expect(stepSetpoint(10.2, -1, RANGE)).toBe(10)
  })

  it('follows a device that only holds whole degrees', () => {
    expect(stepSetpoint(19.5, 1, RANGE, 1)).toBe(20)
    expect(stepSetpoint(20, 1, RANGE, 1)).toBe(21)
  })
})

describe('typedSetpoint', () => {
  it('reads a comma as well as a point, to the tenth', () => {
    expect(typedSetpoint('19,8', RANGE)).toBe(19.8)
    expect(typedSetpoint(' 19.8 ', RANGE)).toBe(19.8)
    expect(typedSetpoint('19.84', RANGE)).toBe(19.8)
  })

  it('rounds to the step the device holds and keeps to its range', () => {
    expect(typedSetpoint('19,8', RANGE, 0.5)).toBe(20)
    expect(typedSetpoint('19.7', RANGE, 0.5)).toBe(19.5)
    expect(typedSetpoint('45', RANGE)).toBe(30)
  })

  it('gives nothing for a text that is not a number', () => {
    expect(typedSetpoint('', RANGE)).toBeNull()
    expect(typedSetpoint('abc', RANGE)).toBeNull()
  })
})
