import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { onMicBatch, takeSeconds } from './mic'
import { cancelRecording, finishRecording, limitMessage, startRecording, useDictation, type StartOptions } from './session'

// The microphone, the window's API, its messages and its settings, stood in for: these tests are about
// what a recording does, not the sound. The microphone opens when a test says so (`opened`).
const mic = vi.hoisted(() => ({
  open: false,
  /** Openings still under way, in order. */
  openings: [] as Array<() => void>,
  /** How many of the next recordings find the microphone closed again as it opened. */
  closedAgain: 0
}))
vi.mock('./mic', () => ({
  MIC_BUSY: 'The microphone couldn’t be started.',
  MicError: class MicError extends Error {},
  closeMic: vi.fn(),
  dropTake: vi.fn(),
  finishTake: vi.fn(async () => new Float32Array(16000).fill(0.5)),
  micFellBack: () => false,
  micIsOpen: () => mic.open,
  onMicBatch: vi.fn(),
  onMicEnded: vi.fn(),
  openMic: vi.fn(() => new Promise<void>((resolve) => mic.openings.push(resolve))),
  openMicId: () => (mic.open ? '' : null),
  startTake: vi.fn(() => (mic.closedAgain-- > 0 ? null : { mic: {}, from: 0 })),
  takeSeconds: vi.fn(() => 0)
}))
vi.mock('@/components/ui', () => ({ toast: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { transcribeDictation: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code?: string
    ) {
      super(message)
    }
  }
}))
vi.mock('@/lib/store', () => ({
  useApp: { getState: () => ({ settings: { speech: { microphone: '' } }, view: { kind: 'write' } }), subscribe: vi.fn() }
}))

/** The clock recordings are timed by, moved on by the tests. */
let now = 0

/** The microphone finishes opening (the oldest opening under way), and what waited on it runs. */
async function opened(): Promise<void> {
  mic.openings.shift()?.()
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const recording = (o: Partial<StartOptions> = {}): StartOptions => ({
  owner: 'key',
  deliver: vi.fn(),
  onNothing: vi.fn(),
  onProblem: vi.fn(),
  ...o
})

beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  Object.assign(mic, { open: false, openings: [], closedAgain: 0 })
  vi.mocked(toast).mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  useDictation.setState({ recordings: [] })
})

describe('letting go while the microphone is still starting', () => {
  it('says nothing was recorded when the key was held for more than a tap', async () => {
    const o = recording()
    const id = startRecording(o)!
    expect(useDictation.getState().recordings[0].phase).toBe('starting')
    now = 1200
    finishRecording(id)
    await opened()
    expect(o.onNothing).toHaveBeenCalledWith('not-started')
    expect(useDictation.getState().recordings).toEqual([])
  })

  it('lets a tap go without a word', async () => {
    const o = recording()
    const id = startRecording(o)!
    now = 150
    finishRecording(id)
    await opened()
    expect(o.onNothing).toHaveBeenCalledWith('short')
  })

  it('tells Adam in a message when nothing else will', async () => {
    const id = startRecording(recording({ onNothing: undefined }))!
    now = 900
    finishRecording(id)
    await opened()
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/^The microphone was still starting, so nothing was recorded\. Hold the key again/)
    )
  })
})

describe('a microphone closed again just as it opened (another one was picked)', () => {
  it('is opened once more, and the recording listens', async () => {
    mic.closedAgain = 1
    const id = startRecording(recording())!
    await opened()
    expect(useDictation.getState().recordings[0].phase).toBe('starting')
    await opened()
    expect(useDictation.getState().recordings[0].phase).toBe('listening')
    finishRecording(id)
  })

  it('never leaves a recording stuck listening: it says so, and lets go', async () => {
    mic.closedAgain = 2
    const o = recording()
    startRecording(o)
    await opened()
    await opened()
    expect(o.onProblem).toHaveBeenCalledWith('The microphone couldn’t be started.', 'microphone-busy')
    expect(useDictation.getState().recordings).toEqual([])
    // Dictation can start again straight away.
    mic.open = true
    const again = startRecording(recording())
    expect(again).not.toBeNull()
    cancelRecording(again!)
  })
})

describe('a problem writing the words down', () => {
  it('offers Try again and, when the fix is in Settings, Open Settings, in words that fit beside both', async () => {
    mic.open = true
    vi.mocked(api.transcribeDictation).mockRejectedValueOnce(
      new ApiError('The speech engine isn’t running. Start it in…', 'speech-not-running')
    )
    const id = startRecording(recording({ onProblem: undefined }))!
    now = 1500
    finishRecording(id)
    await vi.waitFor(() => expect(toast).toHaveBeenCalled())
    const [message, opts] = vi.mocked(toast).mock.calls[0]
    expect(message).toBe("The speech engine isn't running. Start it in Settings, then try again.")
    expect(opts).toMatchObject({ tone: 'danger', action: { label: 'Try again' }, secondary: { label: 'Open Settings' } })
  })
})

describe('the limit of about four minutes', () => {
  it('counts down the last 20 seconds, then stops, says why and still types what was said', async () => {
    // The window, so the session watches the microphone's batches (the tests otherwise run without one).
    vi.stubGlobal('window', { addEventListener: vi.fn() })
    try {
      mic.open = true
      vi.mocked(api.transcribeDictation).mockResolvedValueOnce({ text: 'And that was the end of it.' })
      const o = recording()
      startRecording(o)
      const batch = vi.mocked(onMicBatch).mock.calls.at(-1)![0]
      const left = (): number | null | undefined => useDictation.getState().recordings[0]?.left
      vi.mocked(takeSeconds).mockReturnValue(200)
      batch()
      expect(left()).toBeNull()
      vi.mocked(takeSeconds).mockReturnValue(225.5)
      batch()
      expect(left()).toBe(15)
      now = 240_000
      vi.mocked(takeSeconds).mockReturnValue(240)
      batch()
      expect(o.onProblem).toHaveBeenCalledWith(limitMessage('key'), 'limit')
      expect(useDictation.getState().recordings[0].phase).toBe('writing')
      await vi.waitFor(() => expect(o.deliver).toHaveBeenCalledWith('And that was the end of it.'))
      expect(limitMessage('key')).toBe(
        'A recording can run to about 4 minutes, so this one stopped there and what you said is being written down. To say more, let go of the key and hold it again.'
      )
    } finally {
      vi.mocked(takeSeconds).mockReturnValue(0)
      vi.unstubAllGlobals()
    }
  })
})
