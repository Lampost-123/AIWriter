// Making the library's sounds (AI sound effects under Read aloud): a queue of the sounds wanted, made one at a time
// by the speech server on this computer (`POST /v1/sounds/generate`: Stable Audio Open, the best of a few takes as
// CLAP ranks them), nearest the reading first (Listen now in the Sounds view before everything). It waits while
// sound effects are off, while the sound model isn't downloaded or the server isn't answering, and while a reading
// plays when the server says sounds can't be made beside the voices (not enough graphics memory). A sound that fails
// is tried again later, and after a few failures it is left as 'failed' until Adam asks for it again. Never holds a
// reading up: a sound that isn't ready in time simply doesn't play.
//
// No Electron imports: index.ts gives it the library, the settings and the speech server.
import type { SoundKind } from '@shared/contracts/sounds'
import type { Fetcher } from '../readAloud/speak'
import type { SoundLibrary } from './library'
import { wavSeconds } from './wav'

/** What the speech server is asked for. */
export interface MakeRequest {
  prompt: string
  kind: SoundKind
  seconds: number
  /** Takes made; the server keeps the one CLAP ranks best. */
  takes: number
}

/** A sound made; or why not, and whether to wait and ask again (`hold`: the server can't now) rather than count a failure. */
export type MakeResult =
  | { ok: true; wav: Buffer; seconds: number; score: number | null }
  | {
      ok: false
      hold: boolean
      error: string
      /** How long to wait first, for a hold. */
      waitMs?: number
      /** It will never be made (the server turned the description down): given up on at once. */
      final?: boolean
      /** The server can't make any sound (not downloaded there, won't load): the whole queue rests a while. */
      serverWide?: boolean
    }

export interface MakerDeps {
  library: Pick<SoundLibrary, 'get' | 'setState' | 'failed' | 'saveClip'>
  /** Sound effects are on. */
  enabled(): boolean
  /** The sound model is downloaded and the server answers. */
  ready(): Promise<boolean>
  /** The server can make sounds while it speaks (a reading is playing). */
  beside(): Promise<boolean>
  generate(req: MakeRequest): Promise<MakeResult>
  /** A sound was made (ok) or given up on. */
  made(soundId: string, ok: boolean): void
  /** What Settings shows changed (the one being made, how many wait). */
  changed(): void
  now?: () => number
}

/** Takes per sound. */
export const TAKES = 3
/** A sound that failed is tried again after this long... */
export const RETRY_MS = 10 * 60_000
/** ...and given up on after this many failures. */
export const GIVE_UP_AFTER = 3
/** While it waits (not ready, a reading playing), it looks again this often (the server is asked every 10 s). */
export const HOLD_CHECK_MS = 10_000
/** A sound the server can't make now waits this long, doubling each time, up to MAX_HOLD_MS. */
export const HOLD_MS = 15_000
export const MAX_HOLD_MS = 5 * 60_000
/** After the server failed to make any sound, the queue rests this long, doubling each time, up to RETRY_MS. */
export const PAUSE_MS = 60_000
/** A reading counts as playing this long after it last planned, unless it stopped (the window says when it stops). */
export const PLAYING_MS = 120_000

/** Ranks: lower is made first. Listen now; the reading's, by how far ahead (0, 1, 2...); then the rest, oldest first. */
const NOW_RANK = -1
const BACKGROUND_RANK = 1_000_000

interface Wanted {
  rank: number
  /** The reading it was ranked for ('<world>:<scene>'); null in the background. */
  scope: string | null
  /** Not before this time (after a failure, or while the server couldn't make it). */
  notBefore: number
  /** Times the server said it couldn't make it now, in a row. */
  holds: number
  seq: number
}

export class SoundMaker {
  private queue = new Map<string, Wanted>()
  private seq = 0
  private making: string | null = null
  private running: Promise<void> | null = null
  /** Something changed since the queue was last looked at: it is looked at again. */
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private playingUntil = 0
  /** The server failed to make any sound this many times in a row; the queue rests until this time. */
  private serverFailures = 0
  private pausedUntil = 0

  constructor(private readonly deps: MakerDeps) {}

  private now = (): number => (this.deps.now ?? Date.now)()

  /**
   * The sounds a reading wants, nearest first (`ids` in the order it reaches them). They go before the rest; the ones
   * this reading wanted before and wants no longer go back to the background.
   */
  forReading(scope: string, ids: string[]): void {
    for (const w of this.queue.values()) {
      if (w.scope === scope) {
        w.scope = null
        w.rank = BACKGROUND_RANK + w.seq
      }
    }
    ids.forEach((id, i) => {
      const w = this.queue.get(id)
      if (w && w.rank <= i) return
      if (w) Object.assign(w, { rank: i, scope })
      else this.queue.set(id, { rank: i, scope, notBefore: 0, holds: 0, seq: ++this.seq })
    })
    this.kick()
  }

  /** Sounds wanted some time (marked ahead of a reading, Adam's own, waiting from before). */
  background(ids: string[]): void {
    for (const id of ids) {
      if (this.queue.has(id)) continue
      const seq = ++this.seq
      this.queue.set(id, { rank: BACKGROUND_RANK + seq, scope: null, notBefore: 0, holds: 0, seq })
    }
    this.kick()
  }

  /** Listen now: before everything, and at once even after it failed. */
  first(id: string): void {
    const w = this.queue.get(id)
    if (w) Object.assign(w, { rank: NOW_RANK, notBefore: 0, holds: 0 })
    else this.queue.set(id, { rank: NOW_RANK, scope: null, notBefore: 0, holds: 0, seq: ++this.seq })
    this.kick()
  }

  /** A reading planned: it is playing for a little while. */
  playing(): void {
    this.playingUntil = this.now() + PLAYING_MS
  }

  /** A reading stopped: sounds can be made again (if they had to wait for it). */
  stopped(): void {
    this.playingUntil = 0
    this.kick()
  }

  /** The world closed: its readings' order no longer counts, but the sounds are still wanted (the library is the app's). */
  dropReadings(): void {
    for (const w of this.queue.values()) {
      if (w.scope === null) continue
      w.scope = null
      w.rank = BACKGROUND_RANK + w.seq
    }
    this.playingUntil = 0
    this.kick()
  }

  /** The library was emptied: nothing waits. */
  clear(): void {
    this.queue.clear()
    this.deps.changed()
  }

  /** The sound being made now, and how many wait. */
  status(): { making: string | null; waiting: number } {
    const waiting = [...this.queue.keys()].filter((id) => id !== this.making).length
    return { making: this.making, waiting }
  }

  /** Looks at the queue again soon (something it waits for may have changed). */
  kick(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.dirty = true
    void this.run()
  }

  /** Makes what it can now; resolves when it has to wait or nothing is left. */
  run(): Promise<void> {
    this.running ??= (async () => {
      do {
        this.dirty = false
        await this.loop()
      } while (this.dirty)
    })()
      .catch((e: unknown) => console.warn('[sounds] making sounds stopped', e))
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  private later(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, ms)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  /** The next sound to make: the lowest rank that may be tried now. */
  private next(): string | null {
    const now = this.now()
    let best: [string, Wanted] | null = null
    for (const [id, w] of this.queue) {
      if (w.notBefore > now) continue
      if (!best || w.rank < best[1].rank || (w.rank === best[1].rank && w.seq < best[1].seq)) best = [id, w]
    }
    return best?.[0] ?? null
  }

  private async loop(): Promise<void> {
    for (;;) {
      // Off: nothing is made, and nothing is looked at again until something asks (a reading, the Sounds view).
      if (!this.deps.enabled()) return
      // The server failed to make sounds at all lately (not downloaded there, can't load): it gets a rest first.
      if (this.pausedUntil > this.now()) return this.later(this.pausedUntil - this.now())
      const id = this.next()
      if (!id) {
        // Only sounds waiting after a failure: looked at again when the first may be tried.
        const soonest = Math.min(...[...this.queue.values()].map((w) => w.notBefore))
        if (Number.isFinite(soonest)) this.later(Math.max(1000, soonest - this.now()))
        return
      }
      const e = this.deps.library.get(id)
      if (!e || e.state === 'ready') {
        this.queue.delete(id)
        continue
      }
      const listenNow = this.queue.get(id)!.rank === NOW_RANK
      // A sound that failed for good is made again only for Listen now.
      if (e.state === 'failed' && !listenNow) {
        this.queue.delete(id)
        continue
      }
      if (!(await this.deps.ready())) return this.later(HOLD_CHECK_MS)
      if (this.playingUntil > this.now() && !(await this.deps.beside())) return this.later(HOLD_CHECK_MS)
      // Turned off, asked for again meanwhile, something nearer wanted, or the library cleared: looked at afresh.
      if (!this.deps.enabled() || this.deps.library.get(id) !== e || this.next() !== id) continue
      this.making = id
      this.deps.library.setState(id, 'making')
      this.deps.changed()
      let res: MakeResult
      try {
        res = await this.deps.generate({ prompt: e.description, kind: e.kind, seconds: e.want, takes: TAKES })
      } catch (err) {
        res = { ok: false, hold: false, error: err instanceof Error ? err.message : String(err) }
      }
      this.making = null
      const w = this.queue.get(id)
      if (res.ok) {
        this.serverFailures = 0
        const kept = await this.deps.library.saveClip(id, res.wav, res.seconds, res.score).catch((err: unknown) => {
          console.warn('[sounds] could not keep a sound', err)
          return false
        })
        this.queue.delete(id)
        if (kept) this.deps.made(id, true)
        this.deps.changed()
        continue
      }
      if (res.hold) {
        // The server can't make it now (not answering, or the voices need the graphics card): nothing is held against
        // it, but it waits a while, longer each time, so the others get a turn.
        this.deps.library.setState(id, 'waiting')
        if (w) {
          w.holds++
          w.notBefore = this.now() + Math.min(MAX_HOLD_MS, (res.waitMs ?? HOLD_MS) * 2 ** (w.holds - 1))
        }
        this.deps.changed()
        continue
      }
      console.warn(`[sounds] a sound couldn't be made: ${res.error.slice(0, 300)}`)
      if (res.serverWide) {
        // Not this sound's fault (the sound effects aren't downloaded there, or won't load): the queue rests, longer
        // each time, so a broken install doesn't load the model again and again.
        this.serverFailures++
        this.pausedUntil = this.now() + Math.min(RETRY_MS, PAUSE_MS * 2 ** (this.serverFailures - 1))
      }
      const now = this.deps.library.get(id)
      const giveUp = !!res.final || (now?.failures ?? 0) + 1 >= GIVE_UP_AFTER
      this.deps.library.failed(id, giveUp)
      if (giveUp || !w) {
        this.queue.delete(id)
        this.deps.made(id, false)
      } else {
        w.notBefore = this.now() + RETRY_MS
        if (w.rank === NOW_RANK) w.rank = BACKGROUND_RANK + w.seq
      }
      this.deps.changed()
    }
  }
}

// ---------- The speech server ----------

/** Waits this long for a sound: the first one loads the model (a minute or two at worst), then three takes are made. */
export const GENERATE_TIMEOUT_MS = 300_000

/**
 * Asks the speech server for a sound. Never throws. `answering`: whether the server answered its last health check,
 * so a request cut off while it was making the sound counts as a failure, and one it never answered only waits.
 */
export async function generateSound(
  fetcher: Fetcher,
  req: MakeRequest,
  answering: () => boolean = () => false,
  timeoutMs = GENERATE_TIMEOUT_MS
): Promise<MakeResult> {
  const timeout = AbortSignal.timeout(timeoutMs)
  let res: Response
  try {
    res = await fetcher('/sounds/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: timeout,
      // Its own timeout says when the time ran out; this one only backs it up.
      timeoutMs: timeoutMs + 30_000
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    // The time ran out while it was making the sound: a failure (asked again later, and given up on after a few).
    if (timeout.aborted) return { ok: false, hold: false, error: `no sound after ${Math.round(timeoutMs / 1000)} s` }
    // Not answering at all (stopped, starting): it waits. Cut off while the server was up: a failure.
    return answering() ? { ok: false, hold: false, error: `cut off: ${error}` } : { ok: false, hold: true, error }
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    const error = `${res.status} ${detail}`
    // Try again later: the voices are reading, it was interrupted for them, or it ran out of memory.
    if (res.status === 503 && res.headers.get('x-sound-retry') === '1') return { ok: false, hold: true, error, waitMs: HOLD_MS }
    // A description it won't make: given up on at once.
    if (res.status === 400 || res.status === 413 || res.status === 422) return { ok: false, hold: false, final: true, error }
    // Not downloaded there, can't load, failed, or a server without sounds: counted, and the queue rests.
    return { ok: false, hold: false, serverWide: res.status === 503 || res.status === 404, error }
  }
  let wav: Buffer
  try {
    wav = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    return { ok: false, hold: false, error: `cut off: ${e instanceof Error ? e.message : String(e)}` }
  }
  const length = wavSeconds(wav)
  if (wav.length <= 44 || length === null) return { ok: false, hold: false, error: 'not a WAV' }
  const said = Number(res.headers.get('x-sound-seconds'))
  const score = Number(res.headers.get('x-sound-score'))
  return {
    ok: true,
    wav,
    seconds: Number.isFinite(said) && said > 0 ? said : length,
    score: res.headers.has('x-sound-score') && Number.isFinite(score) ? score : null
  }
}
