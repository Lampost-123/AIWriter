// The search model's worker threads: texts to read are shared out between them, one text per worker at a time, a
// search's texts ahead of the background reading (so a draft never waits behind a whole world being read). A text
// whose search is stopped (or ran out of time) is taken out of the queue at once. The workers are made by a function
// passed in (start.ts), so this is tested without threads.

/** What the pool needs of a worker thread (node:worker_threads' Worker has it). */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: readonly ArrayBuffer[]): void
  on(event: 'message', fn: (msg: unknown) => void): unknown
  on(event: 'error', fn: (e: unknown) => void): unknown
  on(event: 'exit', fn: (code: number) => void): unknown
  terminate(): unknown
  unref?(): void
}

interface Job {
  ids: number[]
  resolve: (v: Float32Array) => void
  reject: (e: Error) => void
  /** Settled already (stopped): a late answer from its worker is dropped. */
  settled: boolean
}

type Reply = { type: 'ready' } | { type: 'failed'; error: string } | { type: 'done'; id: number; vec?: Float32Array; error?: string }

/** How long a worker may take to get the model ready. */
const READY_MS = 60_000

/** Said for a text whose search was stopped. */
export class Stopped extends Error {
  constructor() {
    super('Stopped')
  }
}

export class BertPool {
  private readonly workers: { w: WorkerLike; busy: Job | null; id: number }[] = []
  private readonly now: Job[] = []
  private readonly later: Job[] = []
  private seq = 0
  private closed = false
  private failed: Error | null = null
  /** Resolves once every worker has the model ready (rejects if one can't). */
  readonly ready: Promise<void>

  /**
   * `init` is the message that gets each worker's model ready (worker.ts). `onFail` hears once if a worker stops or
   * breaks after starting (every text waiting is rejected then).
   */
  constructor(
    start: () => WorkerLike,
    init: object,
    size: number,
    private readonly onFail?: (e: Error) => void
  ) {
    const readies: Promise<void>[] = []
    let started = false
    for (let i = 0; i < Math.max(1, size); i++) {
      const w = start()
      const slot = { w, busy: null as Job | null, id: 0 }
      this.workers.push(slot)
      readies.push(
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('The search model took too long to start')), READY_MS)
          w.on('message', (raw) => {
            const msg = raw as Reply
            if (msg.type === 'ready') {
              clearTimeout(timer)
              resolve()
              this.pump()
            } else if (msg.type === 'failed') {
              clearTimeout(timer)
              reject(new Error(msg.error))
            } else if (msg.type === 'done' && slot.busy && msg.id === slot.id) {
              const job = slot.busy
              slot.busy = null
              if (!job.settled) {
                job.settled = true
                if (msg.vec) job.resolve(msg.vec)
                else job.reject(new Error(msg.error ?? 'The search model could not read that'))
              }
              this.pump()
            }
          })
          w.on('error', (e) => {
            clearTimeout(timer)
            const err = e instanceof Error ? e : new Error(String(e))
            reject(err)
            this.fail(err, started)
          })
          w.on('exit', () => {
            clearTimeout(timer)
            reject(new Error('The search model stopped'))
            if (!this.closed) this.fail(new Error('The search model stopped'), started)
          })
        })
      )
      w.unref?.()
      w.postMessage({ type: 'init', ...init })
    }
    this.ready = Promise.all(readies).then(() => {
      started = true
    })
    // A failure to start is told to whoever waits on `ready` (and to every job), never left unhandled.
    this.ready.catch(() => undefined)
  }

  get size(): number {
    return this.workers.length
  }

  /** Whether it still works (not closed, no worker lost). */
  get working(): boolean {
    return !this.closed && !this.failed
  }

  /** How many texts wait (a search's, and the background's). */
  get waiting(): { now: number; later: number } {
    return { now: this.now.length, later: this.later.length }
  }

  /** Each text's vector, in order. `background` texts wait behind any search's. Stopping takes them out at once. */
  run(ids: number[][], o: { signal?: AbortSignal; background?: boolean } = {}): Promise<Float32Array[]> {
    if (this.failed) return Promise.reject(this.failed)
    if (this.closed) return Promise.reject(new Error('The search model was closed'))
    if (o.signal?.aborted) return Promise.reject(new Stopped())
    const queue = o.background ? this.later : this.now
    const jobs: Job[] = []
    const all = Promise.all(
      ids.map(
        (x) =>
          new Promise<Float32Array>((resolve, reject) => {
            const job: Job = { ids: x, resolve, reject, settled: false }
            jobs.push(job)
            queue.push(job)
          })
      )
    )
    if (o.signal) {
      const signal = o.signal
      const stop = (): void => {
        for (const job of jobs) {
          if (job.settled) continue
          job.settled = true
          const at = queue.indexOf(job)
          if (at >= 0) queue.splice(at, 1)
          job.reject(new Stopped())
        }
      }
      signal.addEventListener('abort', stop, { once: true })
      const done = (): void => signal.removeEventListener('abort', stop)
      all.then(done, done)
    }
    this.pump()
    return all
  }

  private next(): Job | undefined {
    for (const q of [this.now, this.later]) {
      while (q.length) {
        const job = q.shift()!
        if (!job.settled) return job
      }
    }
    return undefined
  }

  private pump(): void {
    if (this.closed || this.failed) return
    for (const slot of this.workers) {
      if (slot.busy) continue
      const job = this.next()
      if (!job) return
      slot.busy = job
      slot.id = ++this.seq
      slot.w.postMessage({ type: 'embed', id: slot.id, ids: job.ids })
    }
  }

  private rejectAll(e: Error): void {
    const reject = (job: Job | null): void => {
      if (!job || job.settled) return
      job.settled = true
      job.reject(e)
    }
    for (const slot of this.workers) {
      reject(slot.busy)
      slot.busy = null
    }
    for (const job of [...this.now.splice(0), ...this.later.splice(0)]) reject(job)
  }

  private fail(e: Error, afterStart: boolean): void {
    if (this.failed || this.closed) return
    this.failed = e
    this.rejectAll(e)
    for (const slot of this.workers) void slot.w.terminate()
    if (afterStart) this.onFail?.(e)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.rejectAll(new Error('The search model was closed'))
    for (const slot of this.workers) void slot.w.terminate()
  }
}
