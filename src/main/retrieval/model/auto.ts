// The search model downloads by itself (Adam, 2026-10-08): with "Find by meaning" on and the model not here, the
// download starts quietly in the background a little after AI Write opens (so opening isn't slowed), or a few seconds
// after the switch is turned on. Adam's Stop or Remove is kept (settings.searchModelAuto false) until he presses
// Download again. A download that fails (offline, a damaged file) is tried again an hour later, then two, up to a day
// apart, and at the next start; never in a tight loop, and Settings shows the problem as before. Never in app tests or
// unit tests (AIWRITE_SEARCH_MODEL_AUTO=off). Everything it uses is passed in (index.ts), so it is tested without
// Electron, timers that wait, or the internet.

import type { Settings } from '@shared/types'
import type { SearchModelState } from '@shared/contracts/searchModel'
import type { DownloadEnd } from './manager'

/** How long after AI Write opens before the download starts. */
export const AUTO_AFTER_START_MS = 45_000
/** How long after "Find by meaning" is turned on. */
export const AUTO_AFTER_SWITCH_MS = 5_000
/** After a failed download: an hour, doubling each time, at most a day. */
export const RETRY_FIRST_MS = 60 * 60_000
export const RETRY_MAX_MS = 24 * 60 * 60_000

export const retryAfter = (failures: number): number => Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, failures - 1))

type Env = Record<string, string | undefined>

/**
 * Not in app tests or unit tests (AIWRITE_SEARCH_MODEL_AUTO=off), nor where step 5 is off (AIWRITE_RECALL=off) or a
 * stand-in model is used (AIWRITE_SEARCH_MODEL=stub).
 */
export const autoAllowed = (env: Env = process.env): boolean =>
  env.AIWRITE_SEARCH_MODEL_AUTO !== 'off' && env.AIWRITE_RECALL !== 'off' && env.AIWRITE_SEARCH_MODEL !== 'stub'

/** "Find by meaning" is on and Adam hasn't stopped or removed the model since he last pressed Download. */
export const autoWanted = (settings: Partial<Pick<Settings, 'findByMeaning' | 'searchModelAuto'>>, env: Env = process.env): boolean =>
  autoAllowed(env) && settings.findByMeaning !== false && settings.searchModelAuto !== false

/** The wait before the first look after start-up: AIWRITE_SEARCH_MODEL_AUTO_MS (app tests), or AUTO_AFTER_START_MS. */
export function startDelay(env: Env = process.env): number {
  const n = Number(env.AIWRITE_SEARCH_MODEL_AUTO_MS)
  return env.AIWRITE_SEARCH_MODEL_AUTO_MS && Number.isFinite(n) && n >= 0 ? n : AUTO_AFTER_START_MS
}

export interface AutoDeps {
  /** autoWanted with the settings as they are now. */
  wanted: () => boolean
  /** The model's state now ('none': not here, and no download under way). */
  state: () => SearchModelState
  /** Starts the download (SearchModel.startDownload). */
  download: () => Promise<DownloadEnd>
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export class AutoDownload {
  private timer: unknown = null
  private due = 0
  private running = false
  private closed = false
  /** Failed downloads in a row, and when the next may start. */
  failures = 0
  private retryAt = 0

  constructor(private readonly deps: AutoDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Looks again in `ms`, or once a failed download may be tried again, whichever is later. */
  soon(ms: number): void {
    if (this.closed || this.running) return
    const now = this.now()
    const at = Math.max(now + ms, this.retryAt)
    // A look already due sooner stands.
    if (this.timer !== null && this.due <= at) return
    this.clear()
    this.due = at
    const set =
      this.deps.setTimer ??
      ((fn: () => void, wait: number) => {
        const t = setTimeout(fn, wait)
        t.unref?.()
        return t
      })
    this.timer = set(() => {
      this.timer = null
      void this.check()
    }, at - now)
  }

  /** Starts the download if it is wanted and needed; on a failure, looks again later. */
  async check(): Promise<DownloadEnd | null> {
    if (this.closed || this.running || this.now() < this.retryAt) return null
    if (!this.deps.wanted() || this.deps.state() !== 'none') return null
    this.running = true
    let end: DownloadEnd
    try {
      end = await this.deps.download()
    } catch {
      end = 'failed'
    } finally {
      this.running = false
    }
    if (this.closed) return end
    if (end === 'failed') {
      this.failures++
      this.retryAt = this.now() + retryAfter(this.failures)
      this.soon(0)
    } else if (end === 'done') {
      this.failures = 0
      this.retryAt = 0
    }
    return end
  }

  private clear(): void {
    if (this.timer === null) return
    ;(this.deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer)
    this.timer = null
  }

  /** Whether a look is waiting (for tests and Settings). */
  get waiting(): boolean {
    return this.timer !== null
  }

  close(): void {
    this.closed = true
    this.clear()
  }
}
