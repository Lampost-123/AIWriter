// Token counting with the o200k_base encoding. Building the encoder takes a
// moment (about half a second), so the app does it in a worker thread
// (tokenWorker.ts); this module is the counting itself.

import { Tiktoken } from 'js-tiktoken/lite'
import o200k from 'js-tiktoken/ranks/o200k_base'

let enc: Tiktoken | null = null

/** Plain token count (no allowance added). */
export function countRaw(text: string): number {
  if (!text) return 0
  enc ??= new Tiktoken(o200k)
  // Special-token strings in Adam's text are counted as ordinary text.
  return enc.encode(text, [], []).length
}
