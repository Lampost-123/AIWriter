// Whether the phone is allowed, and the code it has to type. Kept in AI Write's settings folder, never in a world.
import { randomInt } from 'node:crypto'
import { join } from 'node:path'
import { makePhoneCode, PHONE_PORT } from '@shared/contracts/phone'
import { userDataDir } from '../paths'
import { readJson, writeFileAtomic } from '../util'

export interface PhoneConfig {
  on: boolean
  port: number
  code: string
}

const file = (): string => join(userDataDir(), 'phone.json')

export function readPhone(): PhoneConfig {
  const stored = readJson<Partial<PhoneConfig>>(file(), {})
  const port = typeof stored.port === 'number' && stored.port > 0 && stored.port < 65536 ? stored.port : PHONE_PORT
  const code = typeof stored.code === 'string' && /^\d{6}$/.test(stored.code) ? stored.code : ''
  return { on: stored.on === true, port, code }
}

export function writePhone(patch: Partial<PhoneConfig>): PhoneConfig {
  const next = { ...readPhone(), ...patch }
  writeFileAtomic(file(), JSON.stringify(next))
  return next
}

export const freshPhoneCode = (): string => makePhoneCode(randomInt(0, 1_000_000))
