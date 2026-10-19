// The re-ranker experiment (2026-10-19): a cross-encoder (cross-encoder/ms-marco-MiniLM-L6-v2, Apache-2.0, its 23 MB
// quantized ONNX form, read by onnxruntime-node as the search model is) scores each of the search's first 30 finds
// against the search, and the six offered become its best six. Only for measuring: AIWRITE_TEST_RERANKER points at a
// folder holding vocab.txt and onnx/model_quint8_avx2.onnx (never downloaded here). Its vocabulary is BERT's uncased
// one, the very file bge-small has, so the app's own WordPiece reader cuts its words.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WordPiece } from '../../src/main/retrieval/model/wordpiece'
import type { RecalledPassage } from '../../src/main/retrieval/types'

/** The most pieces of the search, and of the search and a passage together, read at once. */
const QUERY_PIECES = 96
const PAIR_PIECES = 320
const BATCH = 8

export interface CrossEncoder {
  /** How well each text answers the query (higher is better; the model's own scale). */
  scores(query: string, texts: string[]): Promise<number[]>
}

export async function crossEncoder(dir: string, threads = 4, file = 'onnx/model_quint8_avx2.onnx'): Promise<CrossEncoder> {
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(join(dir, ...file.split('/')), {
    executionProviders: ['cpu'],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all'
  })
  const tok = new WordPiece(readFileSync(join(dir, 'vocab.txt'), 'utf8'))
  const pieces = (t: string): number[] => tok.encode(t, 512).slice(1, -1)
  const wantsTypes = session.inputNames.includes('token_type_ids')
  return {
    async scores(query, texts) {
      const q = pieces(query).slice(0, QUERY_PIECES)
      const pairs = texts.map((t) => {
        const p = pieces(t).slice(0, PAIR_PIECES - q.length - 3)
        return { ids: [tok.cls, ...q, tok.sep, ...p, tok.sep], qLen: q.length + 2 }
      })
      const out: number[] = []
      for (let i = 0; i < pairs.length; i += BATCH) {
        const batch = pairs.slice(i, i + BATCH)
        const len = Math.max(...batch.map((b) => b.ids.length))
        const ids = new BigInt64Array(batch.length * len)
        const mask = new BigInt64Array(batch.length * len)
        const types = new BigInt64Array(batch.length * len)
        batch.forEach((b, r) => {
          b.ids.forEach((id, c) => {
            ids[r * len + c] = BigInt(id)
            mask[r * len + c] = 1n
            types[r * len + c] = c < b.qLen ? 0n : 1n
          })
        })
        const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {
          input_ids: new ort.Tensor('int64', ids, [batch.length, len]),
          attention_mask: new ort.Tensor('int64', mask, [batch.length, len])
        }
        if (wantsTypes) feeds.token_type_ids = new ort.Tensor('int64', types, [batch.length, len])
        const res = await session.run(feeds)
        const logits = res[session.outputNames[0]].data as Float32Array
        for (let r = 0; r < batch.length; r++) out.push(logits[r])
      }
      return out
    }
  }
}

/** How the search's parts become the re-ranker's query. */
export type RerankQuery = 'joined' | 'best part' | 'direction'

/**
 * Re-orders the finds by the cross-encoder: against the parts joined into one query, against each part (an item's best
 * score), or against Adam's direction alone (else the card's first part). `passagesOnly`: summaries keep their places
 * and only the passages are re-ordered among the passages' places.
 */
export function reranker(ce: CrossEncoder, how: RerankQuery, passagesOnly = false) {
  return async (parts: string[], direction: string, items: RecalledPassage[]): Promise<RecalledPassage[]> => {
    const pick = passagesOnly ? items.filter((p) => p.kind === 'scene') : items
    if (!pick.length) return items
    const texts = pick.map((p) => p.text)
    let best: number[]
    if (how === 'joined') best = await ce.scores(parts.join(' '), texts)
    else if (how === 'direction') best = await ce.scores(direction.trim() || parts[0] || '', texts)
    else {
      best = texts.map(() => -Infinity)
      for (const part of parts) (await ce.scores(part, texts)).forEach((s, i) => (best[i] = Math.max(best[i], s)))
    }
    const sorted = pick
      .map((item, i) => ({ item, s: best[i], i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.item)
    if (!passagesOnly) return sorted
    let k = 0
    return items.map((p) => (p.kind === 'scene' ? sorted[k++] : p))
  }
}
