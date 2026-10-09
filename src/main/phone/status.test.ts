import { describe, expect, it } from 'vitest'
import { lanIpv4, phoneLinkOf } from './status'

const base = { on: true, listening: true, port: 8770, code: '482193', ips: ['192.168.1.20'], bindError: '' }

describe('phone link', () => {
  it('is quiet while it is off', () => {
    expect(phoneLinkOf({ ...base, on: false })).toEqual({ on: false, addresses: [], code: '482193', problem: '' })
  })

  it('gives the phone an address on each network', () => {
    expect(phoneLinkOf({ ...base, ips: ['192.168.1.20', '10.0.0.4'] }).addresses).toEqual([
      'http://192.168.1.20:8770/',
      'http://10.0.0.4:8770/'
    ])
  })

  it('says when this computer is not on a network, or the port is taken', () => {
    expect(phoneLinkOf({ ...base, ips: [] }).problem).toMatch(/Wi-Fi/)
    expect(phoneLinkOf({ ...base, bindError: 'Something else is using the phone port.' }).problem).toMatch(/port/)
    expect(phoneLinkOf({ ...base, listening: false, bindError: '' }).problem).toMatch(/starting/)
  })

  it('keeps addresses on the local network', () => {
    expect(
      lanIpv4({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        wifi: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
        v6: [{ address: 'fe80::1', family: 'IPv6', internal: false }]
      })
    ).toEqual(['192.168.1.20'])
  })
})
