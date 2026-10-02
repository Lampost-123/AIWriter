// Debounced, ordered autosave. Each change replaces the pending value; it is
// written after a quiet pause, or straight away on flush (blur, navigation,
// window close). Writes never overlap and never run out of order. A failed
// write is retried a few times, then reported once.

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface SaverOptions {
  /** Quiet pause before writing, in ms. */
  delay?: number
  /** Waits between retries after a failed write. Its length is the number of retries. */
  retryDelays?: number[]
  onStatus?: (status: SaveStatus, error: string | null) => void
  /** Called once when every retry has failed. */
  onGiveUp?: (message: string) => void
}

export class Saver<T> {
  private pending: { value: T } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private failures = 0
  private gaveUp = false
  private readonly delay: number
  private readonly retryDelays: number[]
  status: SaveStatus = 'idle'

  constructor(
    private save: (value: T) => Promise<unknown>,
    private readonly opts: SaverOptions = {}
  ) {
    this.delay = opts.delay ?? 500
    this.retryDelays = opts.retryDelays ?? [1000, 3000, 8000]
  }

  /** Swaps in the latest save function (React closures change between renders). */
  setSave(save: (value: T) => Promise<unknown>): void {
    this.save = save
  }

  /** True while there is a change that hasn't been handed to the save function yet. */
  get dirty(): boolean {
    return this.pending !== null
  }

  /** Records a change; it is written after the quiet pause. */
  schedule(value: T): void {
    this.pending = { value }
    this.failures = 0
    this.gaveUp = false
    this.arm(this.delay)
  }

  /** Writes any pending change now. Resolves once every write so far has finished (it never rejects). */
  flush(): Promise<void> {
    this.clearTimer()
    const p = this.pending
    if (!p) return this.chain
    this.pending = null
    this.setStatus('saving', null)
    this.chain = this.chain.then(() => this.write(p))
    return this.chain
  }

  /** Drops any pending change without writing it. */
  cancel(): void {
    this.clearTimer()
    this.pending = null
  }

  private async write(p: { value: T }): Promise<void> {
    try {
      await this.save(p.value)
      this.failures = 0
      if (!this.pending) this.setStatus('saved', null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // Keep the value for the next try, unless a newer change has replaced it.
      if (!this.pending) this.pending = p
      this.failures++
      this.setStatus('error', message)
      const wait = this.retryDelays[this.failures - 1]
      if (wait !== undefined) this.arm(wait)
      else if (!this.gaveUp) {
        this.gaveUp = true
        this.opts.onGiveUp?.(message)
      }
    }
  }

  private arm(ms: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, ms)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private setStatus(status: SaveStatus, error: string | null): void {
    this.status = status
    this.opts.onStatus?.(status, error)
  }
}
