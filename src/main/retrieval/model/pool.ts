// The search model's worker threads: texts to read are shared out between them, one text per worker at a time, a
// search's texts ahead of the background indexing's (so a draft never waits behind a whole world being read). The
// workers are made by a function passed in (start.ts), so this is tested without threads.

import type { BertConfig, Weights } from './bert'

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
  signal?: AbortSignal
}

type Reply = { type: 'ready' } | { type: 'failed'; error: string } | { type: 'done'; id: number; vec?: Float32Array; error?: string }

/** How long a worker may take to get the model ready. */
const READY_MS = 60_000

export class BertPool {
  private readonly workers: { w: WorkerLike; busy: Job | null; id: number }[] = []
  private readonly now: Job[] = []
  private readonly later: Job[] = []
  private seq = 0
  private closed = false
  private failed: Error | null = null
  /** Resolves once every worker has the model ready (rejects if one can't). */
  readonly ready: Promise<void>

  constructor(start: () => WorkerLike, weights: Weights, config: BertConfig, size: number) {
    const readies: Promise<void>[] = []
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
              if (msg.vec) job.resolve(msg.vec)
              else job.reject(new Error(msg.error ?? 'The search model could not read that'))
              this.pump()
            }
          })
          w.on('error', (e) => {
            clearTimeout(timer)
            this.fail(e instanceof Error ? e : new Error(String(e)))
            reject(e instanceof Error ? e : new Error(String(e)))
          })
          w.on('exit', () => {
            if (!this.closed) this.fail(new Error('The search model stopped'))
          })
        })
      )
      w.unref?.()
      w.postMessage({ type: 'init', config, buffer: weights.buffer, tensors: weights.tensors })
    }
    this.ready = Promise.all(readies).then(() => undefined)
    // A failure to start is told to whoever waits on `ready` (and to every job), never left unhandled.
    this.ready.catch(() => undefined)
  }

  get size(): number {
    return this.workers.length
  }

  /** Each text's vector, in order. `background` texts wait behind any search's. */
  run(ids: number[][], o: { signal?: AbortSignal; background?: boolean } = {}): Promise<Float32Array[]> {
    if (this.failed) return Promise.reject(this.failed)
    if (this.closed) return Promise.reject(new Error('The search model was closed'))
    const queue = o.background ? this.later : this.now
    const jobs = ids.map(
      (x) =>
        new Promise<Float32Array>((resolve, reject) => {
          queue.push({ ids: x, resolve, reject, signal: o.signal })
        })
    )
    this.pump()
    return Promise.all(jobs)
  }

  private next(): Job | undefined {
    for (const q of [this.now, this.later]) {
      while (q.length) {
        const job = q.shift()!
        if (job.signal?.aborted) {
          job.reject(new Error('Stopped'))
          continue
        }
        return job
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

  private fail(e: Error): void {
    if (this.failed) return
    this.failed = e
    for (const slot of this.workers) slot.busy?.reject(e)
    for (const job of [...this.now.splice(0), ...this.later.splice(0)]) job.reject(e)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const gone = new Error('The search model was closed')
    for (const slot of this.workers) {
      slot.busy?.reject(gone)
      slot.busy = null
      void slot.w.terminate()
    }
    for (const job of [...this.now.splice(0), ...this.later.splice(0)]) job.reject(gone)
  }
}
