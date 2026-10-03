// Sound effects during one reading (readAloud/session.ts drives it): as each clip shows, the ambience is set to the
// one the clip starts in (so Back one line and Next line put the right one on), and the clip's sounds are timed to its
// words. Their times come from the speech server (api.soundCueTimes, asked as the clip's audio is got ahead); until
// they come, the share of the words before each is the estimate. While a clip plays, its audio's own clock is looked
// at every 30 ms, and a sound due within a moment is handed to the audio clock so it lands on its word, at any speed
// and across a pause. A 'fire' plays the effect, a 'start' puts its ambience on, an 'end' fades it out.
//
// Only while Settings' "Sound effects and ambience" is on; otherwise none of it does anything. Sounds never hold the
// reading up and never show an error: one not ready in time is skipped.
import type { ClipSound, PlannedClip } from '@shared/contracts/readAloud'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { clipAudio, hasAudio } from '@/features/readAloud/audio'
import { mixer } from './mixer'
import { bedAfterEdge, dueEdges, estimateTimes, leftAtEnd } from './mixerLogic'

/** How often a playing clip's place is looked at, in ms. */
const TICK_MS = 30

/** Sound effects are on in Settings. */
export const soundsOn = (): boolean => !!useApp.getState().settings?.speech.soundEffects

interface Edge {
  sound: ClipSound
  at: number | null
  done: boolean
}

/** Where a clip's sounds are in its words, as asked of the speech server. */
const timesKey = (clip: PlannedClip): string => `${clip.key}|${clip.pid}|${clip.from}|${clip.to}|${(clip.sounds ?? []).map((s) => s.at).join(',')}`

export class ReadingSounds {
  /** When each clip's sounds are heard: by timesKey; null when they couldn't be had. */
  private readonly times = new Map<string, Promise<{ seconds: number[]; aligned: boolean } | null>>()
  private clip: PlannedClip | null = null
  private edges: Edge[] = []
  /** The times are the estimate (the speech server's haven't come). */
  private estimated = true
  private media: HTMLAudioElement | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** The scene's words were all read: the ambience is left for the next scene to keep or end. */
  private finished = false

  /** `texts`: each paragraph's words as the reading's plan has them. */
  constructor(private readonly texts: () => ReadonlyMap<string, string>) {}

  /**
   * Gets the next clips' sounds ready: their audio, and their times for the clips whose speech the reading already has
   * or is getting (never one waiting for the AI's marks, or one whose speech couldn't be had: nothing here asks for
   * speech of its own). `failed`: the reading's clips whose speech couldn't be had, by key.
   */
  prepare(clips: readonly PlannedClip[], failed: ReadonlySet<string> = new Set()): void {
    if (!soundsOn()) return
    for (const clip of clips) {
      if (clip.bed) void mixer.load(clip.bed)
      for (const s of clip.sounds ?? []) if (s.soundId && s.edge !== 'end') void mixer.load(s.soundId)
      if (clip.sounds?.length && !clip.waits && !failed.has(clip.key)) void this.timesOf(clip)
    }
  }

  /**
   * When a clip's sounds are heard; asked once the clip's audio is there or on its way (the server times them from it).
   * Null, and not kept, while the reading hasn't asked for its audio.
   */
  private timesOf(clip: PlannedClip, again = false): Promise<{ seconds: number[]; aligned: boolean } | null> {
    const key = timesKey(clip)
    const have = this.times.get(key)
    if (have && !again) return have
    if (!hasAudio(clip.key)) return Promise.resolve(null)
    const text = this.texts().get(clip.pid)
    const sounds = clip.sounds ?? []
    const got =
      text == null || !sounds.length
        ? Promise.resolve(null)
        : clipAudio(clip.key, clip.clip)
            .catch(() => null)
            .then(() => api.soundCueTimes({ clip: clip.clip, text, from: clip.from, to: clip.to, at: sounds.map((s) => s.at) }))
            .then((r) => (r && r.seconds.length === sounds.length ? r : null))
            .catch(() => null)
    this.times.set(key, got)
    if (this.times.size > 200) this.times.delete(this.times.keys().next().value as string)
    return got
  }

  /** A clip shows: its ambience goes on (or stays), and its sounds wait for their words. */
  shown(clip: PlannedClip): void {
    this.finished = false
    this.stopTicking()
    this.clip = clip
    this.edges = []
    if (!soundsOn()) return
    mixer.setBed(clip.bed ?? null)
    const sounds = clip.sounds ?? []
    if (!sounds.length) return
    this.edges = sounds.map((sound) => ({ sound, at: null, done: false }))
    this.estimated = true
    const fill = (r: { seconds: number[]; aligned: boolean } | null): boolean => {
      if (!r || this.clip !== clip) return false
      this.edges.forEach((e, i) => {
        if (!e.done) e.at = r.seconds[i]
      })
      this.estimated = false
      return true
    }
    void this.timesOf(clip).then((r) => {
      // Timed by the words' share only (the clip wasn't heard by the dictation engine yet): asked once more now.
      if (fill(r) && r && !r.aligned) void this.timesOf(clip, true).then((again) => again?.aligned && fill(again))
    })
  }

  /** The clip's audio starts: the ambience dips under the voice, and its sounds are watched for. */
  playing(clip: PlannedClip, media: HTMLAudioElement | null): void {
    if (!soundsOn() || this.clip !== clip) return
    this.media = media
    // The voice plays, so the sounds' clock runs too (whatever paused it before: a step, or the end of a scene).
    mixer.resume()
    mixer.duck(true)
    if (this.edges.length && media) {
      this.stopTicking()
      this.timer = setInterval(() => this.tick(), TICK_MS)
      this.tick()
    }
  }

  private tick(): void {
    const media = this.media
    const clip = this.clip
    if (!media || !clip) return
    if (this.estimated && Number.isFinite(media.duration) && media.duration > 0) {
      const guess = estimateTimes(clip, this.edges.map((e) => e.sound.at), media.duration)
      this.edges.forEach((e, i) => {
        if (!e.done) e.at = guess[i]
      })
    }
    // Paused: nothing moves (the audio clock is suspended too).
    if (media.paused) return
    for (const { index, delay } of dueEdges(this.edges, media.currentTime, media.playbackRate || 1)) this.act(index, delay)
  }

  private act(index: number, delay: number): void {
    const e = this.edges[index]
    if (!e || e.done) return
    e.done = true
    if (e.sound.edge === 'fire') return mixer.fire(e.sound, delay)
    const bed = bedAfterEdge(mixer.bedWanted, e.sound)
    if (bed !== undefined) mixer.bedEdge(e.sound, bed, delay)
  }

  /** The clip's audio ended (`ended`: played to its end) or was cut off (a step, Stop). */
  done(ended: boolean): void {
    this.stopTicking()
    if (!soundsOn()) return
    // Played to its end: anything its words still owed is heard now, a moment late rather than not at all.
    if (ended) for (const i of leftAtEnd(this.edges)) this.act(i, 0)
    this.media = null
    mixer.duck(false)
  }

  pause(): void {
    mixer.pause()
  }

  resume(): void {
    mixer.resume()
  }

  /** Read to the end of the scene: the ambience is left playing for Keep reading's next scene to keep or end. */
  ended(): void {
    this.stopTicking()
    this.finished = true
    this.clip = null
    // The scene's last breath may have been paused: the ambience is left running for the next scene, or to fade out.
    mixer.resume()
    mixer.duck(false)
  }

  /** Reading stopped (Stop, a problem, another scene): the sounds fade out quickly. */
  stop(): void {
    this.stopTicking()
    this.clip = null
    if (!this.finished) mixer.stop()
  }

  /** Settings changed: turned off, the sounds go now. */
  settingsChanged(): void {
    if (soundsOn()) return
    this.stopTicking()
    this.edges = []
    mixer.stop()
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
