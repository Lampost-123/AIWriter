// A worker thread that runs the search model, so reading passages never holds up the app. Two engines: onnxruntime-node
// (fast; one worker, with a few threads of its own) or, where that can't start, the TypeScript reader (bert.ts; a few
// workers, all reading the same copy of the weights from a shared buffer). One text at a time: its pieces in, its
// unit-length vector out (the first token's, as bge-small reads it).
import { parentPort } from 'node:worker_threads'
import { Bert, type BertConfig, type TensorMap } from './bert'

type Init =
  | { type: 'init'; engine: 'ts'; config: BertConfig; buffer: SharedArrayBuffer; tensors: TensorMap }
  | { type: 'init'; engine: 'onnx'; modelPath: string; threads: number }
type Message = Init | { type: 'embed'; id: number; ids: number[] }

type Embed = (ids: number[]) => Promise<Float32Array>
let embed: Embed | null = null

/** A vector made unit length. */
function unit(v: Float32Array): Float32Array {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

async function onnxEngine(modelPath: string, threads: number): Promise<Embed> {
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: Math.max(1, threads),
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all'
  })
  return async (ids) => {
    const n = ids.length
    const out = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, n]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
      token_type_ids: new ort.Tensor('int64', new BigInt64Array(n), [1, n])
    })
    const hidden = out.last_hidden_state
    const size = hidden.dims[hidden.dims.length - 1]
    return unit((hidden.data as Float32Array).slice(0, size))
  }
}

parentPort?.on('message', (msg: Message) => {
  if (msg.type === 'init') {
    const made: Promise<Embed> =
      msg.engine === 'onnx'
        ? onnxEngine(msg.modelPath, msg.threads)
        : Promise.resolve().then(() => {
            const model = new Bert(msg.config, { buffer: msg.buffer, tensors: msg.tensors })
            return async (ids: number[]) => model.embed(ids)
          })
    made.then(
      (e) => {
        embed = e
        parentPort?.postMessage({ type: 'ready' })
      },
      (e: unknown) => parentPort?.postMessage({ type: 'failed', error: e instanceof Error ? e.message : String(e) })
    )
    return
  }
  const run = embed
  if (!run) {
    parentPort?.postMessage({ type: 'done', id: msg.id, error: 'The search model is not ready' })
    return
  }
  run(msg.ids).then(
    (vec) => parentPort?.postMessage({ type: 'done', id: msg.id, vec }, [vec.buffer as ArrayBuffer]),
    (e: unknown) => parentPort?.postMessage({ type: 'done', id: msg.id, error: e instanceof Error ? e.message : String(e) })
  )
})
