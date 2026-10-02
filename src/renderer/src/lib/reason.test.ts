import { describe, expect, it } from 'vitest'
import { NOT_READY, plainReason } from './reason'

describe('plainReason', () => {
  it('says plainly when a part of AI Write is still to come', () => {
    expect(plainReason(new Error('Something went wrong: Not built yet'))).toBe(NOT_READY)
  })

  it('keeps a plain-words message, ending it as a sentence', () => {
    expect(plainReason(new Error('That scene no longer exists.'))).toBe('That scene no longer exists.')
    expect(plainReason(new Error('The provider is busy '))).toBe('The provider is busy.')
    expect(plainReason('Try again later?')).toBe('Try again later?')
  })

  it('has something to say when there is no message', () => {
    expect(plainReason(undefined)).toBe('Something went wrong.')
    expect(plainReason(new Error(''))).toBe('Something went wrong.')
  })
})
