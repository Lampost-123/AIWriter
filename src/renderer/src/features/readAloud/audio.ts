// Spoken clips in the window, and the one voice that plays them. Each clip's audio comes from the main
// process (speakClip, which also keeps it on disk) and is held here for a while by its key, so a clip that
// comes again, or one prepared ahead, plays at once. Speed is the player's: the pitch is kept.
import type { ClipRequest } from '@shared/contracts/readAloud'
import { api } from '@/lib/api'

/** Clips held in the window; older ones are let go (the disk keeps them). */
const KEEP = 40
const urls = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
/** The clip playing now: never let go while it plays. */
let inUse: string | null = null

/** One clip's audio, as a URL the player can play. Throws the main process's plain-words error. */
export function clipAudio(key: string, clip: ClipRequest): Promise<string> {
  const have = urls.get(key)
  if (have) {
    // Used again: the newest keeps it longest.
    urls.delete(key)
    urls.set(key, have)
    return Promise.resolve(have)
  }
  let got = pending.get(key)
  if (!got) {
    got = api
      .speakClip(clip)
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }))
        urls.set(key, url)
        prune()
        return url
      })
      .finally(() => pending.delete(key))
    pending.set(key, got)
  }
  return got
}

/** True when a clip's audio is here, or on its way. */
export const hasAudio = (key: string): boolean => urls.has(key) || pending.has(key)

function prune(): void {
  for (const [key, url] of urls) {
    if (urls.size <= KEEP) return
    if (url === inUse) continue
    URL.revokeObjectURL(url)
    urls.delete(key)
  }
}

/** Speed as Settings has it, kept between 0.5× and 2×. */
export const playRate = (speed: number | undefined): number => Math.max(0.5, Math.min(2, Number.isFinite(speed) ? (speed as number) : 1))

/** How a clip's playing came to an end. */
export type PlayEnd = 'ended' | 'stopped' | 'failed'

/** Plain words for audio the window couldn't play (two lines of the reading bar, beside its buttons). */
export const PLAY_FAILED =
  "The audio for this line couldn't be played. If it keeps happening, check the speech engine in Settings › Read aloud and dictation."

/**
 * Plays clips one at a time. `play` resolves 'ended' when the clip has played to its end, 'stopped' when it was
 * stopped first, and 'failed' when the audio couldn't be played; `onTime` reports how far through it is (0 to 1).
 */
export class ClipPlayer {
  private el: HTMLAudioElement | null = null
  private finish: ((end: PlayEnd) => void) | null = null

  play(url: string, rate: number, onTime: (progress: number) => void): Promise<PlayEnd> {
    this.stop()
    const el = new Audio(url)
    el.preservesPitch = true
    el.playbackRate = rate
    el.defaultPlaybackRate = rate
    this.el = el
    inUse = url
    return new Promise<PlayEnd>((resolve) => {
      let done = false
      const finish = (end: PlayEnd): void => {
        if (done) return
        done = true
        el.onended = el.ontimeupdate = el.onerror = null
        if (this.finish === finish) this.finish = null
        resolve(end)
      }
      this.finish = finish
      el.ontimeupdate = () => {
        if (el.duration > 0 && Number.isFinite(el.duration)) onTime(Math.min(1, el.currentTime / el.duration))
      }
      el.onended = () => {
        onTime(1)
        finish('ended')
      }
      el.onerror = () => finish('failed')
      el.play().catch((e: unknown) => {
        // Paused or stopped before it began: pause() leaves it to resume(), and stop() has finished it already.
        if ((e as Error)?.name !== 'AbortError') finish('failed')
      })
    })
  }

  pause(): void {
    this.el?.pause()
  }

  resume(): void {
    void this.el?.play().catch(() => undefined)
  }

  setRate(rate: number): void {
    if (this.el) this.el.playbackRate = rate
  }

  /** Stops the clip playing now (its `play` resolves 'stopped'). */
  stop(): void {
    const el = this.el
    this.el = null
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    const finish = this.finish
    this.finish = null
    finish?.('stopped')
    inUse = null
  }
}
