// The real search model (bge-small-en-v1.5), when its files are on this computer: set AIWRITE_TEST_SEARCH_MODEL to a
// folder holding config.json, vocab.txt, model.safetensors and onnx/model.onnx (as Hugging Face has them at the pinned
// revision). Skipped otherwise: the weights are never in git or downloaded by tests. fixtures/bge-reference.json holds
// the fast engine's numbers for a few made-up sentences (made once with the real model, 2026-10-07), so the
// TypeScript reader is checked against the real model's own output, and both engines against each other.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bert, loadWeights, readConfig } from './bert'
import { checkModel } from './embedder'
import { WordPiece } from './wordpiece'
import type { Embedder } from '../types'
import reference from './fixtures/bge-reference.json'

const DIR = process.env.AIWRITE_TEST_SEARCH_MODEL ?? ''
const here = !!DIR && existsSync(join(DIR, 'model.safetensors')) && existsSync(join(DIR, 'onnx', 'model.onnx'))

/** Twenty made-up sentences to compare the two engines on. */
const SENTENCES = [
  'Mara swore she would come back before the snow.',
  'The ferry crossed the grey river at dawn.',
  'Kell counted the stolen coins twice.',
  'Her brother waited outside the tavern in the rain.',
  'The old wound in his side ached when the weather turned.',
  'A letter was hidden beneath the floorboards.',
  'If you tell anyone, I will drown you myself.',
  'The healer boiled bandages over the fire.',
  'They argued about the debt until midnight.',
  'The copper ring had a hidden catch.',
  'Snow fell on the empty market square.',
  'He whispered the secret of the heir to her.',
  'The bell in the chapel tower rang three times.',
  'She cut her hair short and dressed as a boy.',
  'Wolves howled beyond the wall.',
  'The captain promised to pay them in silver.',
  'Nobody had opened the archive door in years.',
  'A storm drove the fishing boats home early.',
  'The prince is alive, and he is hiding in the mill.',
  'Café owners argued over the naïve tourists’ bill.'
]

describe.skipIf(!here)('the real search model', () => {
  const vocab = here ? new WordPiece(readFileSync(join(DIR, 'vocab.txt'), 'utf8')) : null
  const bert = here ? new Bert(readConfig(JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8'))), loadWeights(join(DIR, 'model.safetensors'))) : null

  it('cuts words as BERT does ("Hello, world!" is [CLS] 7592 1010 2088 999 [SEP])', () => {
    expect(vocab!.encode('Hello, world!')).toEqual([101, 7592, 1010, 2088, 999, 102])
    for (const r of reference.vectors) expect(vocab!.encode(r.text)).toEqual(r.ids)
  })

  it('gives the real model’s numbers with the TypeScript reader', () => {
    for (const r of reference.vectors) {
      const v = bert!.embed(r.ids)
      r.first8.forEach((x, i) => expect(v[i]).toBeCloseTo(x, 4))
    }
  })

  it('gives the same vectors with both engines, and both pass the check', async () => {
    const ort = await import('onnxruntime-node')
    const session = await ort.InferenceSession.create(join(DIR, 'onnx', 'model.onnx'), { intraOpNumThreads: 2 })
    const onnx = async (ids: number[]): Promise<Float32Array> => {
      const n = ids.length
      const out = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, n]),
        attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
        token_type_ids: new ort.Tensor('int64', new BigInt64Array(n), [1, n])
      })
      const v = (out.last_hidden_state.data as Float32Array).slice(0, 384)
      const norm = Math.hypot(...v)
      return v.map((x) => x / norm)
    }
    for (const text of SENTENCES) {
      const ids = vocab!.encode(text)
      const a = bert!.embed(ids)
      const b = await onnx(ids)
      let dot = 0
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
      expect(dot).toBeGreaterThanOrEqual(0.999)
    }
    const ts: Embedder = { model: 'ts', floor: 0, embed: async (t) => t.map((x) => bert!.embed(vocab!.encode(x))) }
    const fast: Embedder = { model: 'onnx', floor: 0, embed: async (t) => Promise.all(t.map((x) => onnx(vocab!.encode(x)))) }
    expect(await checkModel(ts)).toEqual({ ok: true })
    expect(await checkModel(fast)).toEqual({ ok: true })
  }, 120_000)
})
