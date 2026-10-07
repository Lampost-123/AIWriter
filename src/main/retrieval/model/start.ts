// Starting the downloaded search model in the app. The fast engine (onnxruntime-node) runs on one worker thread with a
// few threads of its own; where it can't start (its native files won't load on this computer), that is noted in
// installed.json and the TypeScript reader takes over (the weights read once into a buffer its workers share), if its
// file is here; otherwise the model needs downloading again in that form.
import { cpus } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import createWorker from './worker?nodeWorker'
import { loadWeights, readConfig } from './bert'
import { BgeEmbedder } from './embedder'
import { filePath, installed, onnxShipped, readManifest, WEIGHTS, writeManifest, type Engine } from './files'
import { BertPool, type WorkerLike } from './pool'
import { WordPiece } from './wordpiece'

/** How many threads read for the search model on this computer: a quarter of the processor's, 1 to 4. */
export const poolSize = (threads = cpus().length): number => Math.max(1, Math.min(4, Math.floor(threads / 4)))

/** The downloaded model can't run here in the form it was downloaded in: download it again (the other form). */
export class OtherFormNeeded extends Error {}

/** The engines that can run here, of those downloaded (fast one first). */
export function usableEngines(dir: string, shipped = onnxShipped()): Engine[] {
  const m = installed(dir)
  if (!m) return []
  return m.engines.filter((e) => e === 'ts' || (shipped && !m.onnxFailed))
}

const newWorker = (): WorkerLike => createWorker({}) as Worker as unknown as WorkerLike

/** Starts a pool and waits until it is ready (closing it if it can't start). */
async function started(pool: BertPool): Promise<BertPool> {
  try {
    await pool.ready
    return pool
  } catch (e) {
    pool.close()
    throw e
  }
}

/**
 * The search model, ready to use, and which engine runs it; null when it isn't downloaded. `onFail` hears if its
 * threads stop after starting. Throws OtherFormNeeded when the fast engine can't start and the other form isn't here.
 */
export async function startModel(dir: string, onFail?: (e: Error) => void): Promise<{ embedder: BgeEmbedder; engine: Engine } | null> {
  const engines = usableEngines(dir)
  if (!engines.length) {
    if (installed(dir)) throw new OtherFormNeeded('the fast engine couldn’t start on this computer')
    return null
  }
  const config = readConfig(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')))
  const tokenizer = new WordPiece(readFileSync(join(dir, 'vocab.txt'), 'utf8'))
  const make = (pool: BertPool, engine: Engine) => ({ embedder: new BgeEmbedder(tokenizer, (ids, o) => pool.run(ids, o), () => pool.close()), engine })
  if (engines.includes('onnx')) {
    try {
      return make(await started(new BertPool(newWorker, { engine: 'onnx', modelPath: filePath(dir, WEIGHTS.onnx), threads: poolSize() }, 1, onFail)), 'onnx')
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      console.warn('The fast search engine could not start; the slower one takes over', why)
      const m = readManifest(dir)
      if (m) writeManifest(dir, { ...m, onnxFailed: { at: new Date().toISOString(), why } })
      if (!engines.includes('ts')) throw new OtherFormNeeded(why)
    }
  }
  const weights = loadWeights(filePath(dir, WEIGHTS.ts))
  return make(await started(new BertPool(newWorker, { engine: 'ts', config, buffer: weights.buffer, tensors: weights.tensors }, poolSize(), onFail)), 'ts')
}
