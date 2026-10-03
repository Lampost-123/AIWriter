// What a WAV file's header says: its format and how long it plays. Spoken clips (Read aloud's audio cache) and the
// sound library's clips are WAV. Pure.

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** The bytes of sound (the data chunk). */
  dataBytes: number
  /** How long it plays, in seconds. */
  seconds: number
}

/** The header of a RIFF/WAVE file, or null when it isn't one. Chunks other than 'fmt ' and 'data' are skipped. */
export function wavInfo(buf: Uint8Array): WavInfo | null {
  if (buf.length < 12) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const tag = (at: number): string => String.fromCharCode(buf[at]!, buf[at + 1]!, buf[at + 2]!, buf[at + 3]!)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let at = 12
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number; byteRate: number } | null = null
  while (at + 8 <= buf.length) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ' && body + 16 <= buf.length) {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        bitsPerSample: view.getUint16(body + 14, true)
      }
    } else if (id === 'data' && fmt) {
      // A server streaming its answer may leave the size unset (0 or 0xFFFFFFFF): what is there is the data.
      const dataBytes = size === 0 || size === 0xffffffff || body + size > buf.length ? buf.length - body : size
      const rate = fmt.byteRate || (fmt.sampleRate * fmt.channels * fmt.bitsPerSample) / 8
      if (!rate) return null
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, dataBytes, seconds: dataBytes / rate }
    }
    // Chunks are padded to an even length.
    at = body + size + (size % 2)
  }
  return null
}

/** How long a WAV plays, in seconds; null when it isn't one. */
export const wavSeconds = (buf: Uint8Array): number | null => wavInfo(buf)?.seconds ?? null

/** A WAV of silence (16-bit PCM), for tests. */
export function silentWav(seconds: number, sampleRate = 24_000, channels = 1): Buffer {
  const dataBytes = Math.round(seconds * sampleRate) * channels * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * 2, 28)
  buf.writeUInt16LE(channels * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  return buf
}
