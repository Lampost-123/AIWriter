import { describe, expect, it } from 'vitest'
import { encodeWav, leadIn, peakOf, takeSamples } from './wav'

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n))

describe('turning what the microphone heard into a WAV', () => {
  it('writes a 16-bit mono WAV header at the rate given', () => {
    const b = encodeWav(new Float32Array(10), 16000)
    const v = new DataView(b.buffer)
    expect(b.length).toBe(44 + 20)
    expect(ascii(b, 0, 4)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(36 + 20)
    expect(ascii(b, 8, 8)).toBe('WAVEfmt ')
    expect(v.getUint32(16, true)).toBe(16)
    expect(v.getUint16(20, true)).toBe(1) // PCM
    expect(v.getUint16(22, true)).toBe(1) // mono
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(28, true)).toBe(32000) // bytes a second
    expect(v.getUint16(32, true)).toBe(2)
    expect(v.getUint16(34, true)).toBe(16)
    expect(ascii(b, 36, 4)).toBe('data')
    expect(v.getUint32(40, true)).toBe(20)
  })

  it('turns each sample into a 16-bit number, clipping anything too loud', () => {
    const b = encodeWav(Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -3]), 16000)
    const v = new DataView(b.buffer)
    const at = (i: number): number => v.getInt16(44 + i * 2, true)
    expect([at(0), at(1), at(2), at(3), at(4), at(5), at(6)]).toEqual([0, 32767, -32768, 16383, -16384, 32767, -32768])
  })

  it('makes an empty recording a header and nothing else', () => {
    expect(encodeWav(new Float32Array(0), 16000).length).toBe(44)
  })
})

describe('taking the samples of one recording', () => {
  const chunks = [Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6]), Float32Array.from([7, 8])]

  it('takes the samples between two points, across chunks', () => {
    expect([...takeSamples(chunks, 0, 2, 7)]).toEqual([3, 4, 5, 6, 7])
    expect([...takeSamples(chunks, 0, 0, 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('counts from where the first chunk starts, and never before it', () => {
    // The chunks start at sample 100: anything asked for before then has already gone.
    expect([...takeSamples(chunks, 100, 90, 104)]).toEqual([1, 2, 3, 4])
    expect([...takeSamples(chunks, 100, 105, 108)]).toEqual([6, 7, 8])
  })

  it('gives nothing for an empty stretch', () => {
    expect(takeSamples(chunks, 0, 5, 5).length).toBe(0)
    expect(takeSamples(chunks, 0, 6, 2).length).toBe(0)
  })
})

describe('the quiet in front', () => {
  it('puts the given time of silence before the samples', () => {
    const out = leadIn(Float32Array.from([0.5, -0.5]), 10, 0.3)
    expect([...out]).toEqual([0, 0, 0, 0.5, -0.5])
  })
})

describe('how loud a recording was', () => {
  it('gives the loudest sample, either way up', () => {
    expect(peakOf(Float32Array.from([0.1, -0.6, 0.3]))).toBeCloseTo(0.6)
    expect(peakOf(new Float32Array(100))).toBe(0)
    expect(peakOf(new Float32Array(0))).toBe(0)
  })
})
