import { describe, expect, it } from 'vitest'
import { broadcastAddresses, parseDiscovery } from './discovery'
import capture from './__fixtures__/discovery.json'

// Fixture CAPTURÉE sur le Roomba Combo du parc le 19/09/2026 (BLID, MAC et IP anonymisés), pas
// déduite d'une documentation — la règle du projet, et ici elle sert tout de suite : c'est cette
// trame qui a appris `cap.pw: 0`, donc que le mot de passe local n'est plus donné par le robot.

describe('parseDiscovery', () => {
  it('lit la carte d identité d un Roomba Combo réel', () => {
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

  it('annonce que ce robot ne rend plus son mot de passe en local', () => {
    const robot = parseDiscovery(JSON.stringify(capture), '192.168.1.81')
    expect(robot?.cap.pw).toBe(0)
  })

  it('retrouve le BLID d un ancien robot qui ne donne que son hostname', () => {
    const vieux = { hostname: 'Roomba-3A7B0000000000000000000000000000', ip: '192.168.1.90', proto: 'mqtt' }
    expect(parseDiscovery(JSON.stringify(vieux), '192.168.1.90')?.blid).toBe('3A7B0000000000000000000000000000')
  })

  it('préfère l adresse que le robot annonce à celle du datagramme', () => {
    const robot = parseDiscovery(JSON.stringify({ ...capture, ip: '192.168.1.99' }), '192.168.1.81')
    expect(robot?.ip).toBe('192.168.1.99')
  })

  it('ignore notre propre diffusion et tout ce qui n est pas un robot', () => {
    expect(parseDiscovery('irobotmcs', '192.168.1.5')).toBeNull()
    expect(parseDiscovery('pas du json', '192.168.1.5')).toBeNull()
    expect(parseDiscovery(JSON.stringify({ ip: '192.168.1.5' }), '192.168.1.5')).toBeNull()
  })
})

describe('broadcastAddresses', () => {
  it('déduit la diffusion d un /24 et garde la diffusion générale en dernier recours', () => {
    expect(broadcastAddresses({
      Ethernet: [
        { family: 'IPv4', internal: false, address: '192.168.1.68', netmask: '255.255.255.0' } as never,
        { family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::' } as never,
      ],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' } as never],
    })).toEqual(['192.168.1.255', '255.255.255.255'])
  })
})
