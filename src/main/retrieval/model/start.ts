// Starting the downloaded search model in the app: its files read once (the weights into a buffer every worker shares,
// about 130 MB), and a few worker threads to run it (a quarter of the processor's threads, 1 to 4).
import { cpus } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import createWorker from './worker?nodeWorker'
import { loadWeights, readConfig } from './bert'
import { BgeEmbedder } from './embedder'
import { installed } from './files'
import { BertPool, type WorkerLike } from './pool'
import { WordPiece } from './wordpiece'

/** How many worker threads read for the search model on this computer. */
export const poolSize = (threads = cpus().length): number => Math.max(1, Math.min(4, Math.floor(threads / 4)))

/** The search model, ready to use, or null when it isn't downloaded. Throws when its files can't be read. */
export async function startModel(dir: string): Promise<BgeEmbedder | null> {
  if (!installed(dir)) return null
  const config = readConfig(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')))
  const tokenizer = new WordPiece(readFileSync(join(dir, 'vocab.txt'), 'utf8'))
  const weights = loadWeights(join(dir, 'model.safetensors'))
  const pool = new BertPool(() => createWorker({}) as Worker as unknown as WorkerLike, weights, config, poolSize())
  try {
    await pool.ready
  } catch (e) {
    pool.close()
    throw e
  }
  return new BgeEmbedder(tokenizer, (ids, o) => pool.run(ids, o), () => pool.close())
}
