// Counts tokens in a worker thread. If the worker can't start (or crashes), counting falls back to this thread for the
// rest of the session so drafting still works; a call it is slow to answer falls back for that call only (review #41).
import type { Worker } from 'node:worker_threads'
import createTokenWorker from './tokenWorker?nodeWorker'

let worker: Worker | null = null
let broken = false
let seq = 0
const waiting = new Map<number, { resolve: (n: number[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function failAll(err: Error): void {
  broken = true
  for (const [, w] of waiting) {
    clearTimeout(w.timer)
    w.reject(err)
  }
  waiting.clear()
  worker = null
}

function getWorker(): Worker {
  if (worker) return worker
  const w = createTokenWorker({})
  w.on('message', (msg: { id: number; counts?: number[]; error?: string }) => {
    const p = waiting.get(msg.id)
    if (!p) return
    waiting.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.counts) p.resolve(msg.counts)
    else p.reject(new Error(msg.error ?? 'Token counting failed'))
  })
  w.on('error', (e) => failAll(e instanceof Error ? e : new Error(String(e))))
  w.on('exit', () => {
    if (worker === w) failAll(new Error('Token worker stopped'))
  })
  w.unref()
  worker = w
  return w
}

function viaWorker(texts: string[]): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const id = ++seq
    // The first call may include building the encoder; allow for a slow computer.
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error('Token counting timed out'))
    }, 15_000)
    waiting.set(id, { resolve, reject, timer })
    try {
      getWorker().postMessage({ id, texts })
    } catch (e) {
      // It couldn't be started or sent to: not used again this session.
      clearTimeout(timer)
      waiting.delete(id)
      broken = true
      reject(e as Error)
    }
  })
}

/** Plain token counts for each text, in order. */
export async function countTokens(texts: string[]): Promise<number[]> {
  if (!broken) {
    try {
      return await viaWorker(texts)
    } catch (e) {
      // A timeout, or texts it couldn't count, falls back for this call only; a crash (failAll) or a worker that
      // couldn't start has already set `broken`.
      console.warn(broken ? 'Token worker unavailable, counting in the main thread' : 'Token worker slow or failed, counting this in the main thread', e)
      if (broken) {
        const w = worker
        worker = null
        w?.terminate().catch(() => undefined)
      }
    }
  }
  const { countRaw } = await import('./tokens')
  return texts.map(countRaw)
}

/** Starts the worker early, so the first draft doesn't wait for it. */
export function warmTokens(): void {
  if (broken) return
  try {
    getWorker()
  } catch (e) {
    console.warn('Could not start the token worker', e)
    broken = true
  }
}
