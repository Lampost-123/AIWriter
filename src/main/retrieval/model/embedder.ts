// The search model as recall uses it (the Embedder contract): bge-small-en-v1.5's tokenizer and forward pass, run by
// whatever reads the pieces (the worker pool in the app, the model itself in tests), and the check a downloaded model
// must pass before it is used. Pure, apart from what it is given.

import type { Embedder } from '../types'
import { SEARCH_MODEL } from './files'
import type { WordPiece } from './wordpiece'

/** bge-small's instruction before a search (passages are read as they are). */
export const QUERY_INSTRUCTION = 'Represent this sentence for searching relevant passages: '
/** The most pieces a text is read with (the model's own limit). */
export const MAX_PIECES = 512
/** How alike a passage must be to a search to count as a find, on bge-small's scale. */
export const BGE_FLOOR = 0.5

export type ReadPieces = (ids: number[][], o: { signal?: AbortSignal; background?: boolean }) => Promise<Float32Array[]>

export class BgeEmbedder implements Embedder {
  readonly model = SEARCH_MODEL
  readonly floor = BGE_FLOOR

  constructor(
    private readonly tokenizer: WordPiece,
    private readonly read: ReadPieces,
    private readonly onClose?: () => void
  ) {}

  embed(texts: string[], kind: 'query' | 'passage', signal?: AbortSignal): Promise<Float32Array[]> {
    if (!texts.length) return Promise.resolve([])
    const ids = texts.map((t) => this.tokenizer.encode(kind === 'query' ? QUERY_INSTRUCTION + t : t, MAX_PIECES))
    return this.read(ids, { signal })
  }

  /** The background indexing's reading: it waits behind any search's. */
  embedLater(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (!texts.length) return Promise.resolve([])
    return this.read(
      texts.map((t) => this.tokenizer.encode(t, MAX_PIECES)),
      { signal, background: true }
    )
  }

  close(): void {
    this.onClose?.()
  }
}

/**
 * Sentences a working model tells apart: each first one is closer in meaning to the second than to the third (made up
 * for this check). A model read wrongly gives vectors with no sense in them, and fails.
 */
export const CHECK_SENTENCES: [string, string, string][] = [
  ['The dog barked at the stranger by the gate.', 'A hound growled at someone it did not know near the fence.', 'Interest rates rose again in the spring budget.'],
  ['She promised to come back before winter.', 'He swore he would return before the snow fell.', 'The recipe needs two cups of flour.'],
  ['The ship sank in the storm.', 'A vessel went down in heavy seas.', 'He tuned the old piano in the hall.'],
  ['Her brother waited outside the tavern.', 'Outside the inn, her sibling was waiting.', 'The orchard trees were white with blossom.'],
  ['The king was poisoned at the feast.', 'Someone put venom in the monarch’s wine at the banquet.', 'The children built a castle of sand.'],
  ['If you tell anyone, I will kill you.', 'He threatened to murder her if she gave the secret away.', 'The library closes at six on Sundays.'],
  ['The old wound in his side ached in the cold.', 'His scar from the battle hurt when the weather turned.', 'They painted the kitchen a pale yellow.'],
  ['She hid the letter under the floorboards.', 'The note was concealed beneath a loose board in the floor.', 'The train to the coast was late.']
]

/** How much closer the related sentence must be than the unrelated one. */
const CHECK_MARGIN = 0.05

/** Whether the model tells related sentences from unrelated ones; why not, when it doesn't. */
export async function checkModel(e: Embedder): Promise<{ ok: boolean; why?: string }> {
  const flat = CHECK_SENTENCES.flat()
  const vecs = await e.embed(flat, 'passage')
  const dot = (a: Float32Array, b: Float32Array): number => {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i] * b[i]
    return s
  }
  for (let i = 0; i < CHECK_SENTENCES.length; i++) {
    const [a, near, far] = [vecs[i * 3], vecs[i * 3 + 1], vecs[i * 3 + 2]]
    if (!a || !near || !far || a.some((x) => !Number.isFinite(x))) return { ok: false, why: 'it gave no usable answer' }
    if (dot(a, near) < dot(a, far) + CHECK_MARGIN) return { ok: false, why: `it couldn't tell “${CHECK_SENTENCES[i][1]}” from “${CHECK_SENTENCES[i][2]}”` }
  }
  return { ok: true }
}
