// Worker thread that counts tokens, so building the encoder never blocks the app.
import { parentPort } from 'node:worker_threads'
import { countRaw } from './tokens'

parentPort?.on('message', (msg: { id: number; texts: string[] }) => {
  try {
    parentPort?.postMessage({ id: msg.id, counts: msg.texts.map(countRaw) })
  } catch (e) {
    parentPort?.postMessage({ id: msg.id, error: String(e) })
  }
})

// Build the encoder straight away, so the first real count is quick.
countRaw('warm up')
