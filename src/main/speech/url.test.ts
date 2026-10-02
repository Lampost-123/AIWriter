import { describe, expect, it } from 'vitest'
import { isLoopbackUrl, speechBase, speechUrl } from './url'

describe('the speech server address', () => {
  it('is on this computer only', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8766/v1')).toBe(true)
    expect(isLoopbackUrl('http://localhost:8766/v1')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:8766/v1')).toBe(true)
    expect(isLoopbackUrl('http://192.168.1.4:8766/v1')).toBe(false)
    expect(isLoopbackUrl('https://example.com/v1')).toBe(false)
    expect(isLoopbackUrl('file:///c:/x')).toBe(false)
    expect(isLoopbackUrl('not an address')).toBe(false)
  })

  it('falls back to AI Write’s own server for anything else', () => {
    expect(speechBase('http://127.0.0.1:9000/v1/')).toBe('http://127.0.0.1:9000/v1')
    expect(speechBase('http://example.com:8766/v1')).toBe('http://127.0.0.1:8766/v1')
    expect(speechBase('')).toBe('http://127.0.0.1:8766/v1')
    expect(speechUrl('http://127.0.0.1:9000/v1', 'audio/speech')).toBe('http://127.0.0.1:9000/v1/audio/speech')
  })
})
