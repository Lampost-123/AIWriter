// The search model itself (bge-small-en-v1.5, a small BERT): its weights read from a safetensors file and the forward
// pass that turns a text's pieces into one vector (the first token's, as bge does, made unit length). Written fresh in
// plain TypeScript so the search model needs no new package: about 8 ms a piece on one thread of a desktop processor,
// so the app runs it on worker threads (worker.ts). Pure, apart from reading the file (loadWeights).

import { closeSync, openSync, readSync, fstatSync } from 'node:fs'

/** What the model's config.json says, as far as the forward pass needs it. */
export interface BertConfig {
  hidden: number
  heads: number
  layers: number
  intermediate: number
  eps: number
  maxPositions: number
}

export function readConfig(json: unknown): BertConfig {
  const c = (json ?? {}) as Record<string, unknown>
  const num = (k: string, fallback?: number): number => {
    const v = c[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (fallback !== undefined) return fallback
    throw new Error(`The search model's config has no ${k}`)
  }
  const act = c.hidden_act ?? 'gelu'
  if (act !== 'gelu') throw new Error(`The search model uses ${String(act)}, which this reader doesn't know`)
  return {
    hidden: num('hidden_size'),
    heads: num('num_attention_heads'),
    layers: num('num_hidden_layers'),
    intermediate: num('intermediate_size'),
    eps: num('layer_norm_eps', 1e-12),
    maxPositions: num('max_position_embeddings', 512)
  }
}

/** Where each tensor is in the weights buffer (in floats), and its shape. */
export type TensorMap = Record<string, { offset: number; shape: number[] }>

/** The weights: one buffer of 32-bit floats (shared between threads) and where each tensor is in it. */
export interface Weights {
  buffer: SharedArrayBuffer | ArrayBuffer
  tensors: TensorMap
}

/**
 * Reads a safetensors file's float32 tensors into one shared buffer (so worker threads can read the same copy).
 * Other tensors (the position ids some files keep) are skipped. Names lose a leading "bert." so either way of saving
 * the model reads the same.
 */
export function loadWeights(file: string): Weights {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const head = Buffer.alloc(8)
    readSync(fd, head, 0, 8, 0)
    const headerLen = Number(head.readBigUInt64LE(0))
    if (headerLen <= 0 || headerLen > 100_000_000 || 8 + headerLen > size) throw new Error('The search model file is damaged')
    const headerBuf = Buffer.alloc(headerLen)
    readSync(fd, headerBuf, 0, headerLen, 8)
    const header = JSON.parse(headerBuf.toString('utf8')) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>
    const f32 = Object.entries(header).filter(([k, t]) => k !== '__metadata__' && t.dtype === 'F32')
    const total = f32.reduce((n, [, t]) => n + (t.data_offsets[1] - t.data_offsets[0]), 0)
    const buffer = typeof SharedArrayBuffer === 'function' ? new SharedArrayBuffer(total) : new ArrayBuffer(total)
    const bytes = new Uint8Array(buffer)
    const tensors: TensorMap = {}
    let at = 0
    for (const [name, t] of f32) {
      const len = t.data_offsets[1] - t.data_offsets[0]
      const want = t.shape.reduce((a, b) => a * b, 1) * 4
      if (len !== want) throw new Error(`The search model file is damaged (${name})`)
      let read = 0
      while (read < len) {
        const n = readSync(fd, bytes, at + read, Math.min(len - read, 1 << 26), 8 + headerLen + t.data_offsets[0] + read)
        if (n <= 0) throw new Error('The search model file ends early')
        read += n
      }
      tensors[name.replace(/^bert\./, '')] = { offset: at / 4, shape: t.shape }
      at += len
    }
    return { buffer, tensors }
  } finally {
    closeSync(fd)
  }
}

interface Layer {
  q: Float32Array
  qb: Float32Array
  k: Float32Array
  kb: Float32Array
  v: Float32Array
  vb: Float32Array
  o: Float32Array
  ob: Float32Array
  ln1: Float32Array
  ln1b: Float32Array
  up: Float32Array
  upb: Float32Array
  down: Float32Array
  downb: Float32Array
  ln2: Float32Array
  ln2b: Float32Array
}

/** A ready model: the weights as views, by layer. */
export class Bert {
  private readonly word: Float32Array
  private readonly pos: Float32Array
  private readonly type: Float32Array
  private readonly embLn: Float32Array
  private readonly embLnB: Float32Array
  private readonly layers: Layer[]

  constructor(
    readonly config: BertConfig,
    weights: Weights
  ) {
    const t = (name: string, size?: number): Float32Array => {
      const x = weights.tensors[name] ?? weights.tensors[name.replace(/\.weight$/, '.gamma').replace(/\.bias$/, '.beta')]
      if (!x) throw new Error(`The search model file has no ${name}`)
      const n = x.shape.reduce((a, b) => a * b, 1)
      if (size !== undefined && n !== size) throw new Error(`The search model file's ${name} isn't the size expected`)
      return new Float32Array(weights.buffer, x.offset * 4, n)
    }
    const { hidden: H, intermediate: I } = config
    this.word = t('embeddings.word_embeddings.weight')
    this.pos = t('embeddings.position_embeddings.weight', config.maxPositions * H)
    this.type = t('embeddings.token_type_embeddings.weight')
    this.embLn = t('embeddings.LayerNorm.weight', H)
    this.embLnB = t('embeddings.LayerNorm.bias', H)
    this.layers = Array.from({ length: config.layers }, (_, i) => {
      const p = `encoder.layer.${i}.`
      return {
        q: t(`${p}attention.self.query.weight`, H * H),
        qb: t(`${p}attention.self.query.bias`, H),
        k: t(`${p}attention.self.key.weight`, H * H),
        kb: t(`${p}attention.self.key.bias`, H),
        v: t(`${p}attention.self.value.weight`, H * H),
        vb: t(`${p}attention.self.value.bias`, H),
        o: t(`${p}attention.output.dense.weight`, H * H),
        ob: t(`${p}attention.output.dense.bias`, H),
        ln1: t(`${p}attention.output.LayerNorm.weight`, H),
        ln1b: t(`${p}attention.output.LayerNorm.bias`, H),
        up: t(`${p}intermediate.dense.weight`, I * H),
        upb: t(`${p}intermediate.dense.bias`, I),
        down: t(`${p}output.dense.weight`, H * I),
        downb: t(`${p}output.dense.bias`, H),
        ln2: t(`${p}output.LayerNorm.weight`, H),
        ln2b: t(`${p}output.LayerNorm.bias`, H)
      }
    })
    if (this.word.length % H !== 0) throw new Error("The search model file's word table isn't the size expected")
  }

  /** How many pieces the vocabulary has (ids at or past it are unknown to the model). */
  get vocabSize(): number {
    return this.word.length / this.config.hidden
  }

  /** The unit-length vector for one text's pieces ([CLS] ... [SEP]): the first token's, as bge-small reads it. */
  embed(ids: number[]): Float32Array {
    const { hidden: H, heads, eps } = this.config
    const n = Math.min(ids.length, this.config.maxPositions)
    let x: Float32Array = new Float32Array(n * H)
    for (let t = 0; t < n; t++) {
      const id = ids[t] >= 0 && ids[t] < this.vocabSize ? ids[t] : 0
      for (let k = 0; k < H; k++) x[t * H + k] = this.word[id * H + k] + this.pos[t * H + k] + this.type[k]
    }
    layerNorm(x, n, H, this.embLn, this.embLnB, eps)
    const dHead = H / heads
    const scale = 1 / Math.sqrt(dHead)
    const scores = new Float32Array(n)
    for (const l of this.layers) {
      const q = linear(x, n, H, l.q, l.qb, H)
      const k = linear(x, n, H, l.k, l.kb, H)
      const v = linear(x, n, H, l.v, l.vb, H)
      const ctx = new Float32Array(n * H)
      for (let h = 0; h < heads; h++) {
        const off = h * dHead
        for (let i = 0; i < n; i++) {
          let max = -Infinity
          const qi = i * H + off
          for (let j = 0; j < n; j++) {
            const kj = j * H + off
            let s = 0
            for (let d = 0; d < dHead; d++) s += q[qi + d] * k[kj + d]
            s *= scale
            scores[j] = s
            if (s > max) max = s
          }
          let sum = 0
          for (let j = 0; j < n; j++) {
            const e = Math.exp(scores[j] - max)
            scores[j] = e
            sum += e
          }
          const ci = i * H + off
          for (let j = 0; j < n; j++) {
            const p = scores[j] / sum
            const vj = j * H + off
            for (let d = 0; d < dHead; d++) ctx[ci + d] += p * v[vj + d]
          }
        }
      }
      const attn = linear(ctx, n, H, l.o, l.ob, H)
      for (let i = 0; i < attn.length; i++) attn[i] += x[i]
      layerNorm(attn, n, H, l.ln1, l.ln1b, eps)
      const up = linear(attn, n, H, l.up, l.upb, this.config.intermediate)
      for (let i = 0; i < up.length; i++) up[i] = gelu(up[i])
      const down = linear(up, n, this.config.intermediate, l.down, l.downb, H)
      for (let i = 0; i < down.length; i++) down[i] += attn[i]
      layerNorm(down, n, H, l.ln2, l.ln2b, eps)
      x = down
    }
    const out = x.slice(0, H)
    let norm = 0
    for (let k = 0; k < H; k++) norm += out[k] * out[k]
    norm = Math.sqrt(norm) || 1
    for (let k = 0; k < H; k++) out[k] /= norm
    return out
  }
}

/** y = x W^T + b for `n` rows: x is n x din, W is dout x din (as PyTorch keeps it). Four rows by four outputs at a time. */
export function linear(x: Float32Array, n: number, din: number, w: Float32Array, b: Float32Array, dout: number): Float32Array {
  const y = new Float32Array(n * dout)
  let t = 0
  for (; t + 3 < n; t += 4) {
    const x0 = t * din
    const x1 = x0 + din
    const x2 = x1 + din
    const x3 = x2 + din
    let j = 0
    for (; j + 3 < dout; j += 4) {
      const w0 = j * din
      const w1 = w0 + din
      const w2 = w1 + din
      const w3 = w2 + din
      let a00 = 0, a01 = 0, a02 = 0, a03 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0
      let a20 = 0, a21 = 0, a22 = 0, a23 = 0, a30 = 0, a31 = 0, a32 = 0, a33 = 0
      for (let k = 0; k < din; k++) {
        const u0 = x[x0 + k]
        const u1 = x[x1 + k]
        const u2 = x[x2 + k]
        const u3 = x[x3 + k]
        const v0 = w[w0 + k]
        const v1 = w[w1 + k]
        const v2 = w[w2 + k]
        const v3 = w[w3 + k]
        a00 += u0 * v0
        a01 += u0 * v1
        a02 += u0 * v2
        a03 += u0 * v3
        a10 += u1 * v0
        a11 += u1 * v1
        a12 += u1 * v2
        a13 += u1 * v3
        a20 += u2 * v0
        a21 += u2 * v1
        a22 += u2 * v2
        a23 += u2 * v3
        a30 += u3 * v0
        a31 += u3 * v1
        a32 += u3 * v2
        a33 += u3 * v3
      }
      const r0 = t * dout + j
      const r1 = r0 + dout
      const r2 = r1 + dout
      const r3 = r2 + dout
      y[r0] = a00 + b[j]
      y[r0 + 1] = a01 + b[j + 1]
      y[r0 + 2] = a02 + b[j + 2]
      y[r0 + 3] = a03 + b[j + 3]
      y[r1] = a10 + b[j]
      y[r1 + 1] = a11 + b[j + 1]
      y[r1 + 2] = a12 + b[j + 2]
      y[r1 + 3] = a13 + b[j + 3]
      y[r2] = a20 + b[j]
      y[r2 + 1] = a21 + b[j + 1]
      y[r2 + 2] = a22 + b[j + 2]
      y[r2 + 3] = a23 + b[j + 3]
      y[r3] = a30 + b[j]
      y[r3 + 1] = a31 + b[j + 1]
      y[r3 + 2] = a32 + b[j + 2]
      y[r3 + 3] = a33 + b[j + 3]
    }
    for (; j < dout; j++) {
      for (let r = 0; r < 4; r++) {
        let s = 0
        const xo = (t + r) * din
        const wo = j * din
        for (let k = 0; k < din; k++) s += x[xo + k] * w[wo + k]
        y[(t + r) * dout + j] = s + b[j]
      }
    }
  }
  for (; t < n; t++) {
    const xo = t * din
    for (let j = 0; j < dout; j++) {
      const wo = j * din
      let s = 0
      for (let k = 0; k < din; k++) s += x[xo + k] * w[wo + k]
      y[t * dout + j] = s + b[j]
    }
  }
  return y
}

/** Layer normalisation of each of `n` rows, in place. */
export function layerNorm(x: Float32Array, n: number, H: number, g: Float32Array, b: Float32Array, eps: number): void {
  for (let t = 0; t < n; t++) {
    const o = t * H
    let mean = 0
    for (let k = 0; k < H; k++) mean += x[o + k]
    mean /= H
    let v = 0
    for (let k = 0; k < H; k++) {
      const d = x[o + k] - mean
      v += d * d
    }
    const r = 1 / Math.sqrt(v / H + eps)
    for (let k = 0; k < H; k++) x[o + k] = (x[o + k] - mean) * r * g[k] + b[k]
  }
}

/** The error function (Abramowitz and Stegun 7.1.26, good to about 1e-7), for BERT's exact GELU. */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}

/** GELU as BERT has it: x times the normal distribution's CDF at x. */
export const gelu = (x: number): number => 0.5 * x * (1 + erf(x / Math.SQRT2))
