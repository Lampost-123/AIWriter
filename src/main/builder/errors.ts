// What went wrong talking to the character builder model (the writer model unless Adam picked another
// in Settings › Models), in plain words that fit the builder (drafting's own messages talk about scenes
// and draft options). Pure.

import type { ThinkingLevel } from '@shared/types'
import type { ChatTarget } from '../ai/client'
import {
  describeFailure,
  looksLikeContextTooLong,
  looksLikeRefusal,
  looksLikeReplyLimitRejected,
  providerWho,
  type Failure
} from '../ai/errors'

const SETTINGS = 'Settings › Models'
/** What Settings › Models calls the builder's model. */
const MODEL = 'character builder model'

export function builderFailure(f: Failure, target: ChatTarget, modelId: string, thinking: ThinkingLevel = 'off'): string {
  const who = providerWho(target)
  switch (f.type) {
    case 'refused':
      return `The ${MODEL} turned this down. Try different words, or pick another ${MODEL} in ${SETTINGS}.`
    case 'empty':
      // A model that thinks before answering can spend the whole reply on thinking, which is hidden.
      if (f.thinking && thinking === 'off') {
        return `The ${MODEL} thinks even with Thinking off, and used up its room before it answered. Pick another ${MODEL} in ${SETTINGS}.`
      }
      if (f.thinking) {
        return `The ${MODEL} used up its room thinking and didn't answer. Set the character builder's Thinking to Off in ${SETTINGS}, or pick another ${MODEL}.`
      }
      return `${who} sent back an empty reply. Try again, or pick another ${MODEL} in ${SETTINGS}.`
    case 'dropped':
      return `The connection to ${who} dropped before the AI had finished. Try again in a moment.`
    case 'http':
      if ((f.status === 400 || f.status === 422) && looksLikeRefusal(f.message) && !looksLikeContextTooLong(f.message)) {
        return `The ${MODEL} turned this down. Try different words, or pick another ${MODEL} in ${SETTINGS}.`
      }
      if (f.status === 413 || ((f.status === 400 || f.status === 422) && looksLikeContextTooLong(f.message))) {
        return `This is more than the ${MODEL} can read at once. Shorten your notes, or pick a model that can read more in ${SETTINGS}.`
      }
      if (looksLikeReplyLimitRejected(f.status, f.message) && f.status !== 402) {
        return `This model can't write that much in one reply. Pick another ${MODEL} in ${SETTINGS}.`
      }
  }
  const provider = { name: target.name, kind: target.kind, baseUrl: target.baseUrl, hasKey: !!target.apiKey }
  return describeFailure(f, provider, { during: 'draft', modelId })
    .replace(/ The text that arrived is kept\.$/, '')
    .replace(/This model refused the scene\./, `The ${MODEL} turned this down.`)
    .replace(/writer model/g, MODEL)
}

/** The reply could be read, but held nothing the builder could use, even when asked again. */
export const UNUSABLE = `The AI's reply wasn't something AI Write could use. Try again, or pick another ${MODEL} in ${SETTINGS}.`
