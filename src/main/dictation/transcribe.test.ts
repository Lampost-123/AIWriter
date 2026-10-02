import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { UserError } from '../util'
import { FAILED, NOT_READY, TOO_LONG, transcribeWith } from './transcribe'

interface Heard {
  bytes: number
  sampleRate: number
  channels: number
  bits: number
  seconds: number
  peak: number
}
interface FakeSpeech {
  url: string
  close(): Promise<void>
}
type Options = { dictation?: unknown; dictationFail?: { status: number; detail: string } }

// The fake speech server (tests/fake-speech), loaded without types: its typings belong to the speech engine.
const FAKE_SPEECH: string = '../../../tests/fake-speech/server.mjs'
const options: Options = {}
let fake: FakeSpeech
beforeAll(async () => {
  const { startFakeSpeech } = (await import(FAKE_SPEECH)) as { startFakeSpeech: (o: Options) => Promise<FakeSpeech> }
  fake = await startFakeSpeech(options)
})
afterAll(() => fake.close())
beforeEach(() => {
  delete options.dictation
  delete options.dictationFail
})

/** Reaches the fake server as speechFetch reaches the real one. */
const fetcher = (path: string, init: RequestInit): Promise<Response> => fetch(`${fake.url}${path}`, init)

/** A 16 kHz mono WAV of `seconds` of a quiet tone. */
function wav(seconds: number): Uint8Array {
  const n = Math.round(16000 * seconds)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + n * 2, 4)
  b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24)
  b.writeUInt32LE(32000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2)
  return new Uint8Array(b)
}

const recordings = async (): Promise<Heard[]> => (await fetch(`${fake.url.replace(/\/v1$/, '')}/__dictation`)).json() as Promise<Heard[]>

async function failure(p: Promise<unknown>): Promise<UserError> {
  try {
    await p
  } catch (e) {
    if (e instanceof UserError) return e
    throw e
  }
  throw new Error('expected it to fail')
}

describe('writing down a recording', () => {
  it('sends the WAV as it is and types back the words, tidied', async () => {
    options.dictation = 'Um, the the lantern flickered twice.'
    expect(await transcribeWith(fetcher, wav(1))).toBe('The lantern flickered twice.')
    const last = (await recordings()).at(-1)!
    expect(last).toMatchObject({ sampleRate: 16000, channels: 1, bits: 16 })
    expect(last.seconds).toBeCloseTo(1, 2)
    expect(last.peak).toBeGreaterThan(0.2)
  })

  it('types nothing when nothing was recorded or heard', async () => {
    expect(await transcribeWith(fetcher, new Uint8Array(0))).toBe('')
    expect(await transcribeWith(fetcher, wav(0))).toBe('')
    options.dictation = 'Um.'
    expect(await transcribeWith(fetcher, wav(0.5))).toBe('')
  })

  it('says in plain words when no dictation model is loaded', async () => {
    options.dictationFail = { status: 503, detail: 'No dictation model is loaded. In Settings, pick Whisper or Parakeet.' }
    const e = await failure(transcribeWith(fetcher, wav(0.5)))
    expect(e.message).toBe(NOT_READY)
    expect(e.code).toBe('dictation-not-ready')
  })

  it('says in plain words when the speech engine fails, never its own error', async () => {
    options.dictationFail = { status: 503, detail: 'Dictation failed: CUDA error 700 at 0x7ff' }
    const e = await failure(transcribeWith(fetcher, wav(0.5)))
    expect(e.message).toBe(FAILED)
    expect(e.message).not.toMatch(/CUDA|0x7ff|503/)
    expect(e.code).toBe('dictation-failed')
  })

  it('refuses a recording longer than the speech engine takes, without sending it', async () => {
    const before = (await recordings()).length
    const e = await failure(transcribeWith(fetcher, wav(251)))
    expect(e.message).toBe(TOO_LONG)
    expect((await recordings()).length).toBe(before)
  })

  it("passes on the speech engine's own plain words when it isn't running", async () => {
    const down = (): Promise<Response> => Promise.reject(new UserError("The speech engine isn't running.", 'speech-not-running'))
    const e = await failure(transcribeWith(down, wav(0.5)))
    expect(e.code).toBe('speech-not-running')
  })
})
