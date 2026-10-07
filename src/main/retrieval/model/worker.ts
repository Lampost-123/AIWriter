// A worker thread that runs the search model (bert.ts), so reading passages never holds up the app. Every worker reads
// the same copy of the weights (a shared buffer). One text at a time: its pieces in, its vector out.
import { parentPort } from 'node:worker_threads'
import { Bert, type BertConfig, type TensorMap } from './bert'

let model: Bert | null = null

type Message =
  | { type: 'init'; config: BertConfig; buffer: SharedArrayBuffer; tensors: TensorMap }
  | { type: 'embed'; id: number; ids: number[] }

parentPort?.on('message', (msg: Message) => {
  if (msg.type === 'init') {
    try {
      model = new Bert(msg.config, { buffer: msg.buffer, tensors: msg.tensors })
      parentPort?.postMessage({ type: 'ready' })
    } catch (e) {
      parentPort?.postMessage({ type: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
    return
  }
  if (!model) {
    parentPort?.postMessage({ type: 'done', id: msg.id, error: 'The search model is not ready' })
    return
  }
  try {
    const vec = model.embed(msg.ids)
    parentPort?.postMessage({ type: 'done', id: msg.id, vec }, [vec.buffer as ArrayBuffer])
  } catch (e) {
    parentPort?.postMessage({ type: 'done', id: msg.id, error: e instanceof Error ? e.message : String(e) })
  }
})
