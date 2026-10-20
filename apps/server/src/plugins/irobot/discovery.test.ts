import { describe, expect, it } from 'vitest'
import { broadcastAddresses, parseDiscovery } from './discovery'
import capture from './__fixtures__/discovery.json'

// Fixture CAPTURED on the device set's Roomba Combo on 09/19/2026 (BLID, MAC and IP anonymized),
// not inferred from documentation — the project's rule, and here it pays off right away: this is
// the frame that taught us `cap.pw: 0`, i.e. that the robot no longer gives out its local password.

describe('parseDiscovery', () => {
  it('reads the identity card of a real Roomba Combo', () => {
    const robot = parseDiscovery(JSON.stringify(capture), '192.168.1.81')
    expect(robot).toEqual({
      blid: '1111111111111111111111111111AAAA',
      ip: '192.168.1.81',
      name: 'Robby',
      sku: 'c755840',
      sw: 'stingray+24.29.5+2024-11-22-e0a36542cf4+Firmware-Production+246',
      proto: 'mqtt',
      cap: expect.objectContaining({ scrub: 1, pw: 0, pmaps: 9 }),
    })
  })

  it('announces that this robot no longer hands out its password locally', () => {
    const robot = parseDiscovery(JSON.stringify(capture), '192.168.1.81')
    expect(robot?.cap.pw).toBe(0)
  })

  it('recovers the BLID of an older robot that only gives its hostname', () => {
    const vieux = { hostname: 'Roomba-3A7B0000000000000000000000000000', ip: '192.168.1.90', proto: 'mqtt' }
    expect(parseDiscovery(JSON.stringify(vieux), '192.168.1.90')?.blid).toBe('3A7B0000000000000000000000000000')
  })

  it('prefers the address the robot announces over the datagram one', () => {
    const robot = parseDiscovery(JSON.stringify({ ...capture, ip: '192.168.1.99' }), '192.168.1.81')
    expect(robot?.ip).toBe('192.168.1.99')
  })

  it('ignores our own broadcast and anything that is not a robot', () => {
    expect(parseDiscovery('irobotmcs', '192.168.1.5')).toBeNull()
    expect(parseDiscovery('pas du json', '192.168.1.5')).toBeNull()
    expect(parseDiscovery(JSON.stringify({ ip: '192.168.1.5' }), '192.168.1.5')).toBeNull()
  })
})

describe('broadcastAddresses', () => {
  it('derives the broadcast of a /24 and keeps the general broadcast as a last resort', () => {
    expect(broadcastAddresses({
      Ethernet: [
        { family: 'IPv4', internal: false, address: '192.168.1.68', netmask: '255.255.255.0' } as never,
        { family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::' } as never,
      ],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' } as never],
    })).toEqual(['192.168.1.255', '255.255.255.255'])
  })
})
