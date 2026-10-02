// When to save the open scene. Saves half a second after typing pauses, and at
// least every five seconds while typing continues. One save runs at a time; a
// failed save retries with backoff until it succeeds (unless what it saves into
// has gone). Timers are injectable so the schedule is unit-tested.

export type AutosaveState = 'saving' | 'saved' | 'error'

export interface Timers {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
  now: () => number
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now()
}

export interface AutosaverOptions {
  /** Saves the content as it is right now. */
  save: () => Promise<void>
  /** Called when the visible save state changes. */
  onState?: (state: AutosaveState) => void
  /** Called after a save succeeds; `clean` is true when nothing changed during it. */
  onSaved?: (clean: boolean) => void
  delay?: number
  maxWait?: number
  /** Waits before each retry after a failure; the last value repeats. */
  retryDelays?: number[]
  /**
   * A failure that saving again can't put right (what it saves into has gone): there are no more tries,
   * the unsaved changes are let go, and `onGone` is called. Every other failure is retried.
   */
  isGone?: (error: unknown) => boolean
  onGone?: () => void
  /** "Saving…" only shows if a save takes longer than this, so quick saves don't flicker. */
  showSavingAfter?: number
  timers?: Timers
}

export class Autosaver {
  private version = 0
  private savedVersion = 0
  private firstUnsavedAt: number | null = null
  private timer: unknown = null
  private savingTimer: unknown = null
  private inFlight: Promise<boolean> | null = null
  private failures = 0
  private disposed = false
  private readonly t: Timers
  private readonly delay: number
  private readonly maxWait: number
  private readonly retryDelays: number[]
  private readonly showSavingAfter: number

  constructor(private readonly opts: AutosaverOptions) {
    this.t = opts.timers ?? realTimers
    this.delay = opts.delay ?? 500
    this.maxWait = opts.maxWait ?? 5000
    this.retryDelays = opts.retryDelays ?? [1000, 2000, 4000, 8000, 15000, 30000]
    this.showSavingAfter = opts.showSavingAfter ?? 300
  }

  /** True when there are changes that haven't been saved yet. */
  get dirty(): boolean {
    return this.version > this.savedVersion
  }

  get saving(): boolean {
    return this.inFlight !== null
  }

  /** Call on every edit. */
  changed(): void {
    if (this.disposed) return
    this.version++
    const now = this.t.now()
    if (this.firstUnsavedAt === null) this.firstUnsavedAt = now
    if (this.failures > 0) return // a retry is already scheduled
    this.schedule(Math.max(0, Math.min(this.delay, this.firstUnsavedAt + this.maxWait - now)))
  }

  /** Saves now if anything is unsaved. Resolves once the content is saved (true) or the attempt failed (false). */
  async flush(): Promise<boolean> {
    this.clearTimer()
    // Wait for a save already running, then save again if more changed meanwhile.
    for (let i = 0; i < 3; i++) {
      if (this.inFlight) await this.inFlight
      if (!this.dirty) return true
      const ok = await this.run()
      if (!ok) return false
    }
    return !this.dirty
  }

  /** Forgets unsaved changes and stops all timers (used after they were saved elsewhere, or on teardown). */
  dispose(): void {
    this.disposed = true
    this.clearTimer()
    if (this.savingTimer !== null) this.t.clear(this.savingTimer)
  }

  private schedule(ms: number): void {
    this.clearTimer()
    this.timer = this.t.set(() => {
      this.timer = null
      void this.run()
    }, ms)
  }

  private clearTimer(): void {
    if (this.timer !== null) this.t.clear(this.timer)
    this.timer = null
  }

  private run(): Promise<boolean> {
    if (this.inFlight) return this.inFlight
    if (!this.dirty || this.disposed) return Promise.resolve(true)
    const v = this.version
    let gone = false
    this.firstUnsavedAt = null
    this.clearTimer()
    if (this.failures > 0) this.opts.onState?.('saving')
    else this.savingTimer = this.t.set(() => this.opts.onState?.('saving'), this.showSavingAfter)
    const p = this.opts
      .save()
      .then(
        () => {
          this.savedVersion = Math.max(this.savedVersion, v)
          this.failures = 0
          return true
        },
        (e: unknown) => {
          this.failures++
          gone = !!this.opts.isGone?.(e)
          return false
        }
      )
      .then((ok) => {
        if (this.savingTimer !== null) this.t.clear(this.savingTimer)
        this.savingTimer = null
        this.inFlight = null
        if (this.disposed) return ok
        if (ok) {
          this.opts.onState?.('saved')
          this.opts.onSaved?.(!this.dirty)
          // Changes made during the save get their own save.
          if (this.dirty) {
            if (this.firstUnsavedAt === null) this.firstUnsavedAt = this.t.now()
            this.schedule(this.delay)
          }
        } else if (gone) {
          this.failures = 0
          this.dispose()
          this.opts.onGone?.()
        } else {
          this.opts.onState?.('error')
          const wait = this.retryDelays[Math.min(this.failures - 1, this.retryDelays.length - 1)]
          this.schedule(wait)
        }
        return ok
      })
    this.inFlight = p
    return p
  }
}

/**
 * One save state for the top bar when several scenes are saving at once (the open
 * scene, plus any scene just left whose last save hasn't landed): a problem anywhere
 * shows, then work in progress, else "saved". Null when there's nothing to report.
 */
export function combineSaveStates(states: (AutosaveState | null | undefined)[]): AutosaveState | null {
  if (states.includes('error')) return 'error'
  if (states.includes('saving')) return 'saving'
  return states.includes('saved') ? 'saved' : null
}

/** Calls `fn` after `wait` ms of quiet, and at least every `maxWait` ms while calls keep coming. */
export function debounce(fn: () => void, wait: number, maxWait: number, timers: Timers = realTimers): { call: () => void; cancel: () => void; flush: () => void } {
  let timer: unknown = null
  let first: number | null = null
  const fire = (): void => {
    if (timer !== null) timers.clear(timer)
    timer = null
    first = null
    fn()
  }
  return {
    call() {
      const now = timers.now()
      if (first === null) first = now
      if (timer !== null) timers.clear(timer)
      timer = timers.set(fire, Math.max(0, Math.min(wait, first + maxWait - now)))
    },
    cancel() {
      if (timer !== null) timers.clear(timer)
      timer = null
      first = null
    },
    flush() {
      if (timer !== null) fire()
    }
  }
}
