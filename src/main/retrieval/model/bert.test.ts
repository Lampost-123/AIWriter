// The search model's forward pass, checked against a plain, slow reading of the same sums on a tiny made-up model
// (random weights: no real model is downloaded for tests), and its weights file reader.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Bert, erf, gelu, linear, loadWeights, readConfig, type BertConfig, type Weights } from './bert'

/** A seeded random number generator, so every run is the same. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

const CONFIG: BertConfig = { hidden: 8, heads: 2, layers: 2, intermediate: 12, eps: 1e-12, maxPositions: 16 }
const VOCAB = 20

/** Tensor names and shapes of a tiny BERT, in a safetensors-like order. */
function shapes(c: BertConfig): [string, number[]][] {
  const out: [string, number[]][] = [
    ['embeddings.word_embeddings.weight', [VOCAB, c.hidden]],
    ['embeddings.position_embeddings.weight', [c.maxPositions, c.hidden]],
    ['embeddings.token_type_embeddings.weight', [2, c.hidden]],
    ['embeddings.LayerNorm.weight', [c.hidden]],
    ['embeddings.LayerNorm.bias', [c.hidden]]
  ]
  for (let i = 0; i < c.layers; i++) {
    const p = `encoder.layer.${i}.`
    for (const n of ['query', 'key', 'value']) out.push([`${p}attention.self.${n}.weight`, [c.hidden, c.hidden]], [`${p}attention.self.${n}.bias`, [c.hidden]])
    out.push(
      [`${p}attention.output.dense.weight`, [c.hidden, c.hidden]],
      [`${p}attention.output.dense.bias`, [c.hidden]],
      [`${p}attention.output.LayerNorm.weight`, [c.hidden]],
      [`${p}attention.output.LayerNorm.bias`, [c.hidden]],
      [`${p}intermediate.dense.weight`, [c.intermediate, c.hidden]],
      [`${p}intermediate.dense.bias`, [c.intermediate]],
      [`${p}output.dense.weight`, [c.hidden, c.intermediate]],
      [`${p}output.dense.bias`, [c.hidden]],
      [`${p}output.LayerNorm.weight`, [c.hidden]],
      [`${p}output.LayerNorm.bias`, [c.hidden]]
    )
  }
  return out
}

/** Random tensors by name (LayerNorm weights near 1). */
function randomTensors(seed = 7): Map<string, { shape: number[]; data: Float32Array }> {
  const r = rng(seed)
  const out = new Map<string, { shape: number[]; data: Float32Array }>()
  for (const [name, shape] of shapes(CONFIG)) {
    const n = shape.reduce((a, b) => a * b, 1)
    const data = new Float32Array(n)
    for (let i = 0; i < n; i++) data[i] = name.endsWith('LayerNorm.weight') ? 1 + r() * 0.2 : r() * 0.8
    out.set(name, { shape, data })
  }
  return out
}

function asWeights(t: Map<string, { shape: number[]; data: Float32Array }>): Weights {
  const total = [...t.values()].reduce((n, x) => n + x.data.length, 0)
  const buffer = new SharedArrayBuffer(total * 4)
  const all = new Float32Array(buffer)
  const tensors: Weights['tensors'] = {}
  let at = 0
  for (const [name, x] of t) {
    all.set(x.data, at)
    tensors[name] = { offset: at, shape: x.shape }
    at += x.data.length
  }
  return { buffer, tensors }
}

/** The same model read the plain way: every sum written out, nothing blocked or reused. */
function reference(t: Map<string, { shape: number[]; data: Float32Array }>, c: BertConfig, ids: number[]): number[] {
  const w = (n: string): Float32Array => t.get(n)!.data
  const H = c.hidden
  const n = ids.length
  const lin = (x: number[][], W: Float32Array, b: Float32Array, dout: number): number[][] =>
    x.map((row) => Array.from({ length: dout }, (_, j) => row.reduce((s, v, k) => s + v * W[j * row.length + k], 0) + b[j]))
  const norm = (x: number[][], g: Float32Array, b: Float32Array): number[][] =>
    x.map((row) => {
      const mean = row.reduce((a, v) => a + v, 0) / row.length
      const vr = row.reduce((a, v) => a + (v - mean) ** 2, 0) / row.length
      return row.map((v, k) => ((v - mean) / Math.sqrt(vr + c.eps)) * g[k] + b[k])
    })
  const exactGelu = (x: number): number => 0.5 * x * (1 + erf(x / Math.SQRT2))
  let x = ids.map((id, p) => Array.from({ length: H }, (_, k) => w('embeddings.word_embeddings.weight')[id * H + k] + w('embeddings.position_embeddings.weight')[p * H + k] + w('embeddings.token_type_embeddings.weight')[k]))
  x = norm(x, w('embeddings.LayerNorm.weight'), w('embeddings.LayerNorm.bias'))
  const d = H / c.heads
  for (let l = 0; l < c.layers; l++) {
    const p = `encoder.layer.${l}.`
    const q = lin(x, w(`${p}attention.self.query.weight`), w(`${p}attention.self.query.bias`), H)
    const k = lin(x, w(`${p}attention.self.key.weight`), w(`${p}attention.self.key.bias`), H)
    const v = lin(x, w(`${p}attention.self.value.weight`), w(`${p}attention.self.value.bias`), H)
    const ctx = Array.from({ length: n }, () => new Array<number>(H).fill(0))
    for (let h = 0; h < c.heads; h++) {
      for (let i = 0; i < n; i++) {
        const s = Array.from({ length: n }, (_, j) => {
          let dot = 0
          for (let e = 0; e < d; e++) dot += q[i][h * d + e] * k[j][h * d + e]
          return dot / Math.sqrt(d)
        })
        const m = Math.max(...s)
        const ex = s.map((v2) => Math.exp(v2 - m))
        const z = ex.reduce((a, b) => a + b, 0)
        for (let j = 0; j < n; j++) for (let e = 0; e < d; e++) ctx[i][h * d + e] += (ex[j] / z) * v[j][h * d + e]
      }
    }
    const a = lin(ctx, w(`${p}attention.output.dense.weight`), w(`${p}attention.output.dense.bias`), H).map((row, i) => row.map((v2, j) => v2 + x[i][j]))
    const a1 = norm(a, w(`${p}attention.output.LayerNorm.weight`), w(`${p}attention.output.LayerNorm.bias`))
    const up = lin(a1, w(`${p}intermediate.dense.weight`), w(`${p}intermediate.dense.bias`), c.intermediate).map((row) => row.map(exactGelu))
    const down = lin(up, w(`${p}output.dense.weight`), w(`${p}output.dense.bias`), H).map((row, i) => row.map((v2, j) => v2 + a1[i][j]))
    x = norm(down, w(`${p}output.LayerNorm.weight`), w(`${p}output.LayerNorm.bias`))
  }
  const cls = x[0]
  const len = Math.hypot(...cls)
  return cls.map((v2) => v2 / len)
}

describe("the search model's sums", () => {
  it('has an error function good to about 1e-7', () => {
    expect(erf(0)).toBeCloseTo(0, 7)
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 6)
    expect(erf(1)).toBeCloseTo(0.8427007929, 6)
    expect(erf(-2)).toBeCloseTo(-0.995322265, 6)
    expect(gelu(1)).toBeCloseTo(0.8413447, 5)
  })

  it('multiplies by a weight table the same blocked as plainly, whatever the sizes', () => {
    const r = rng(3)
    for (const [n, din, dout] of [
      [1, 3, 5],
      [4, 8, 8],
      [7, 6, 9],
      [9, 5, 2]
    ]) {
      const x = Float32Array.from({ length: n * din }, r)
      const w = Float32Array.from({ length: dout * din }, r)
      const b = Float32Array.from({ length: dout }, r)
      const y = linear(x, n, din, w, b, dout)
      for (let t = 0; t < n; t++)
        for (let j = 0; j < dout; j++) {
          let s = b[j]
          for (let k = 0; k < din; k++) s += x[t * din + k] * w[j * din + k]
          expect(y[t * dout + j]).toBeCloseTo(s, 5)
        }
    }
  })

  it('gives the same unit vector as the plain reading, for short and longer texts', () => {
    const t = randomTensors()
    const bert = new Bert(CONFIG, asWeights(t))
    for (const ids of [
      [2, 5, 3],
      [2, 7, 8, 9, 10, 11, 12, 13, 3],
      [2, 19, 4, 4, 4, 1, 3]
    ]) {
      const got = Array.from(bert.embed(ids))
      const want = reference(t, CONFIG, ids)
      expect(Math.hypot(...got)).toBeCloseTo(1, 5)
      got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 4))
    }
  })

  it('says plainly when the weights are not the model it expects', () => {
    const t = randomTensors()
    t.delete('encoder.layer.1.output.dense.bias')
    expect(() => new Bert(CONFIG, asWeights(t))).toThrow(/encoder.layer.1.output.dense.bias/)
    expect(() => readConfig({ hidden_size: 8, num_attention_heads: 2, num_hidden_layers: 1, intermediate_size: 4, hidden_act: 'relu' })).toThrow(/relu/)
    expect(readConfig({ hidden_size: 384, num_attention_heads: 12, num_hidden_layers: 12, intermediate_size: 1536, hidden_act: 'gelu', layer_norm_eps: 1e-12, max_position_embeddings: 512 })).toEqual({
      hidden: 384,
      heads: 12,
      layers: 12,
      intermediate: 1536,
      eps: 1e-12,
      maxPositions: 512
    })
  })
})

describe('the weights file (safetensors)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('reads float tensors into one shared buffer, skipping others and a "bert." prefix', () => {
    const t = randomTensors(11)
    const header: Record<string, unknown> = { __metadata__: { format: 'pt' } }
    const parts: Buffer[] = []
    let at = 0
    // Position ids, as some files keep them: not floats, skipped.
    const ids = Buffer.alloc(16 * 8)
    header['bert.embeddings.position_ids'] = { dtype: 'I64', shape: [1, 16], data_offsets: [at, at + ids.length] }
    parts.push(ids)
    at += ids.length
    for (const [name, x] of t) {
      const b = Buffer.from(x.data.buffer, x.data.byteOffset, x.data.byteLength)
      header[`bert.${name}`] = { dtype: 'F32', shape: x.shape, data_offsets: [at, at + b.length] }
      parts.push(b)
      at += b.length
    }
    const json = Buffer.from(JSON.stringify(header))
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(json.length))
    const dir = mkdtempSync(join(tmpdir(), 'aiwrite-weights-'))
    dirs.push(dir)
    const file = join(dir, 'model.safetensors')
    writeFileSync(file, Buffer.concat([len, json, ...parts]))
    const w = loadWeights(file)
    expect(w.buffer).toBeInstanceOf(SharedArrayBuffer)
    expect(Object.keys(w.tensors)).not.toContain('embeddings.position_ids')
    const word = w.tensors['embeddings.word_embeddings.weight']
    expect(word.shape).toEqual([VOCAB, CONFIG.hidden])
    expect(Array.from(new Float32Array(w.buffer, word.offset * 4, 4))).toEqual(Array.from(t.get('embeddings.word_embeddings.weight')!.data.slice(0, 4)))
    // Read from the file, the model gives what it gives from memory.
    expect(Array.from(new Bert(CONFIG, w).embed([2, 5, 3]))).toEqual(Array.from(new Bert(CONFIG, asWeights(t)).embed([2, 5, 3])))
  })

  it('refuses a file that is not one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiwrite-weights-'))
    dirs.push(dir)
    const file = join(dir, 'model.safetensors')
    writeFileSync(file, Buffer.from('this is not a weights file'))
    expect(() => loadWeights(file)).toThrow()
  })
})
