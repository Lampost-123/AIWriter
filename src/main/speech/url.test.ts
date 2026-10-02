import { describe, expect, it } from 'vitest'
import { isLoopbackUrl, normaliseAddress, SPEECH_HEADER, speechBase, speechUrl } from './url'

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

  it('is reached with AI Write’s own header, which the server asks of anything that changes something', () => {
    expect(SPEECH_HEADER).toEqual(['X-AIWrite', 'speech'])
  })

  it('is tidied as typed in Settings', () => {
    expect(normaliseAddress('127.0.0.1:8766')).toBe('http://127.0.0.1:8766/v1')
    expect(normaliseAddress('  localhost:9000/ ')).toBe('http://localhost:9000/v1')
    expect(normaliseAddress('http://[::1]:8766/v1/')).toBe('http://[::1]:8766/v1')
    expect(normaliseAddress('http://127.0.0.1:8766/speech')).toBe('http://127.0.0.1:8766/speech')
    expect(normaliseAddress('')).toBe('http://127.0.0.1:8766/v1')
  })

  it('is refused, in plain words, when it isn’t on this computer', () => {
    for (const elsewhere of [
      'http://192.168.1.4:8766/v1',
      '192.168.1.4:8766',
      'https://speech.example.com/v1',
      'ftp://127.0.0.1/v1',
      'http://127.0.0.1.example.com/v1'
    ]) {
      expect(() => normaliseAddress(elsewhere)).toThrow(
        'That address isn’t on this computer. Use localhost, 127.0.0.1 or ::1, like http://127.0.0.1:8766/v1.'
      )
    }
    // Something that isn't an address at all is told so.
    for (const typo of ['not an address', 'http://', 'http://127.0.0.1:99999/v1']) {
      expect(() => normaliseAddress(typo)).toThrow('That isn’t an address. Type one like http://127.0.0.1:8766/v1.')
    }
    let code = ''
    try {
      normaliseAddress('10.0.0.2')
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('speech-address')
  })
})
