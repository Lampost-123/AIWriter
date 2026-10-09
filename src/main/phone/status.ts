// What Settings shows for the phone. Pure, so it is unit-tested.
import type { PhoneLink } from '@shared/contracts/phone'

export interface PhoneFacts {
  /** The switch in Settings is on. */
  on: boolean
  /** The page is being served. */
  listening: boolean
  port: number
  code: string
  /** This computer's own addresses on the local network. */
  ips: string[]
  /** Why listening failed, in plain words. '' when it didn't. */
  bindError: string
}

/** The link Settings and the phone are told about. */
export function phoneLinkOf(facts: PhoneFacts): PhoneLink {
  if (!facts.on) return { on: false, addresses: [], code: facts.code, problem: '' }
  if (facts.bindError) return { on: true, addresses: [], code: facts.code, problem: facts.bindError }
  if (!facts.listening) return { on: true, addresses: [], code: facts.code, problem: 'The phone link is starting.' }
  if (facts.ips.length === 0) {
    return {
      on: true,
      addresses: [],
      code: facts.code,
      problem: 'This computer doesn’t seem to be on a network. Connect to Wi-Fi, then turn this off and on again.'
    }
  }
  return {
    on: true,
    addresses: facts.ips.map((ip) => `http://${ip}:${facts.port}/`),
    code: facts.code,
    problem: ''
  }
}

export interface NetFace {
  address: string
  family: string | number
  internal: boolean
}

/** IPv4 addresses on the local network, not this computer's own loopback. */
export function lanIpv4(ifaces: Record<string, NetFace[] | undefined>): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const face of list ?? []) {
      const v4 = face.family === 'IPv4' || face.family === 4
      if (!v4 || face.internal) continue
      out.push(face.address)
    }
  }
  return out
}
