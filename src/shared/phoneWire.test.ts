import { describe, expect, it } from 'vitest'
import { makePhoneCode, normalizePhoneCode, showPhoneCode } from './contracts/phone'
import { decodeWire, encodeWire } from './phoneWire'

describe('phone wire', () => {
  it('keeps bytes, missing values and portrait addresses through JSON', () => {
    const value = {
      clip: new Uint8Array([0, 1, 255]),
      missing: undefined,
      portrait: 'aiwrite-image://entry/mara?v=2',
      nested: [undefined, 'plain']
    }
    const back = decodeWire(JSON.parse(JSON.stringify(encodeWire(value)))) as typeof value
    expect(Array.from(back.clip)).toEqual([0, 1, 255])
    expect(back.missing).toBeUndefined()
    expect(back.portrait).toBe('aiwrite-image://entry/mara?v=2')
    expect(back.nested).toEqual([undefined, 'plain'])
  })

  it('shows a code in two groups and reads one typed with a space', () => {
    expect(makePhoneCode(482193)).toBe('482193')
    expect(makePhoneCode(7)).toBe('000007')
    expect(showPhoneCode('482193')).toBe('482 193')
    expect(normalizePhoneCode('482 193')).toBe('482193')
    expect(normalizePhoneCode('48219')).toBe('')
  })
})
