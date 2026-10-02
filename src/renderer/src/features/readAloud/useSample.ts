// Adapted from mcreader-v2, src/components/speech/useSample.ts (reading aloud's own text-to-speech code; Adam's
// rule, 2 October 2026). MCreader fetched one clip from its web route; here the main process plans the sample's
// clips exactly as reading will sound (sampleReading) and each comes over IPC (speakClip). One sample plays at a
// time anywhere in the window, and starting one pauses a reading.
//
// Plays one sample at a time: Sample, Hear this voice, a character's Hear and "Say it as" › Listen. A newer
// sample, or Stop, drops any older one still being spoken (request tokens), so a slow answer never starts
// playing over a newer choice.
import { create } from 'zustand'
import type { SampleRequest } from '@shared/contracts/readAloud'
import { api, ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import { ClipPlayer, clipAudio, playRate, PLAY_FAILED } from './audio'

export interface SampleProblem {
  /** The button it was for. */
  label: string
  /** Plain words, from the main process. */
  message: string
  /** The error's code ('speech-not-running', 'voices-not-ready', 'speech-failed'...), when it has one. */
  code: string | undefined
  /** The speech engine isn't running or its voices aren't ready: the fix is in the speech settings. */
  engine: boolean
}

interface SampleState {
  playing: string | null
  loading: string | null
  error: SampleProblem | null
}

const useSampleState = create<SampleState>(() => ({ playing: null, loading: null, error: null }))

let token = 0
const player = new ClipPlayer()
/** Pauses a reading when a sample starts (set by control.ts, so the two never talk over each other). */
let beforeSample: () => void = () => undefined
export const onSampleStart = (fn: () => void): void => {
  beforeSample = fn
}

/** Stops any sample playing or on its way. */
export function stopSample(): void {
  token++
  player.stop()
  useSampleState.setState({ playing: null, loading: null })
}

/** Plays a sample for the button `label`; pressing the same button again while it plays stops it. */
export async function playSample(label: string, req: SampleRequest): Promise<void> {
  const now = useSampleState.getState()
  if (now.playing === label || now.loading === label) return stopSample()
  const mine = ++token
  player.stop()
  beforeSample()
  useSampleState.setState({ playing: null, loading: label, error: null })
  try {
    const clips = await api.sampleReading(req)
    for (const [i, c] of clips.entries()) {
      const url = await clipAudio(c.key, c.clip)
      if (mine !== token) return
      if (i === 0) useSampleState.setState({ loading: null, playing: label })
      const end = await player.play(url, playRate(useApp.getState().settings?.speech.speed), () => undefined)
      if (mine !== token || end === 'stopped') return
      if (end === 'failed') throw new Error(PLAY_FAILED)
      if (c.restMs && i < clips.length - 1) await new Promise((r) => setTimeout(r, c.restMs))
    }
    if (mine === token) useSampleState.setState({ playing: null, loading: null })
  } catch (e) {
    if (mine !== token) return
    const code = e instanceof ApiError ? e.code : undefined
    useSampleState.setState({
      playing: null,
      loading: null,
      error: {
        label,
        message: e instanceof Error && e.message ? e.message : "That couldn't be played. Try again.",
        code,
        engine: code === 'speech-not-running' || code === 'voices-not-ready'
      }
    })
  }
}

/** The sample state for a set of buttons: which of them is playing or getting ready, and a problem with one of them. */
export function useSample(owns: (label: string) => boolean): {
  playing: string | null
  loading: string | null
  error: SampleProblem | null
  play: typeof playSample
  stop: typeof stopSample
} {
  const playing = useSampleState((s) => (s.playing && owns(s.playing) ? s.playing : null))
  const loading = useSampleState((s) => (s.loading && owns(s.loading) ? s.loading : null))
  const error = useSampleState((s) => (s.error && owns(s.error.label) ? s.error : null))
  return { playing, loading, error, play: playSample, stop: stopSample }
}

/** Forgets a problem shown for these buttons (Adam changed something, so it may work now). */
export function clearSampleError(owns: (label: string) => boolean): void {
  const e = useSampleState.getState().error
  if (e && owns(e.label)) useSampleState.setState({ error: null })
}
