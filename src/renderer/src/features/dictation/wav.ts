// Adapted from Poor-Mans-Holodeck's src/lib/dictate.ts (takeSamples, leadIn and encodeWav): turning what
// the microphone heard into the 16 kHz mono WAV the speech server writes down. The WAV comes back as bytes
// to send to the main process (never a file: dictated audio is never saved). Pure.

/** The samples from `from` up to `to`, counted from the microphone opening. `origin` is where `chunks[0]` starts. */
export function takeSamples(chunks: Float32Array[], origin: number, from: number, to: number): Float32Array {
  const start = Math.max(from, origin)
  const out = new Float32Array(Math.max(0, to - start))
  let at = origin
  let o = 0
  for (const c of chunks) {
    const end = at + c.length
    const a = Math.max(at, start)
    const b = Math.min(end, to)
    if (a < b) {
      out.set(c.subarray(a - at, b - at), o)
      o += b - a
    }
    at = end
    if (at >= to) break
  }
  return out
}

/** How loud the loudest moment was, from 0 (silence) to 1. */
export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  return peak
}

/** A little quiet in front, so the first word isn't the first thing the speech model hears. */
export function leadIn(samples: Float32Array, sampleRate: number, seconds = 0.3): Float32Array {
  const n = Math.floor(sampleRate * seconds)
  const out = new Float32Array(n + samples.length)
  out.set(samples, n)
  return out
}

/** The samples as a 16-bit mono WAV file's bytes. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const n = samples.length
  const bytes = new Uint8Array(44 + n * 2)
  const v = new DataView(bytes.buffer)
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return bytes
}
