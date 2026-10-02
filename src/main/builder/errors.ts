// What went wrong talking to the writer model, in plain words that fit the builder (drafting's own
// messages talk about scenes and draft options). Pure.

import type { ChatTarget } from '../ai/client'
import { describeFailure, looksLikeContextTooLong, looksLikeRefusal, looksLikeReplyLimitRejected, providerWho, type Failure } from '../ai/errors'

const SETTINGS = 'Settings › Models'

export function builderFailure(f: Failure, target: ChatTarget, modelId: string): string {
  const who = providerWho(target)
  switch (f.type) {
    case 'refused':
      return `The writer model turned this down. Try different words, or pick another writer model in ${SETTINGS}.`
    case 'empty':
      // Models that think before answering can spend the whole reply on thinking, which is hidden.
      return `${who} sent back an empty reply. Models that think before answering sometimes use all their room for thinking. Try again, or pick another writer model in ${SETTINGS}.`
    case 'dropped':
      return `The connection to ${who} dropped before the AI had finished. Try again in a moment.`
    case 'http':
      if ((f.status === 400 || f.status === 422) && looksLikeRefusal(f.message) && !looksLikeContextTooLong(f.message)) {
        return `The writer model turned this down. Try different words, or pick another writer model in ${SETTINGS}.`
      }
      if (f.status === 413 || ((f.status === 400 || f.status === 422) && looksLikeContextTooLong(f.message))) {
        return `This is more than the writer model can read at once. Shorten your notes, or pick a model that can read more in ${SETTINGS}.`
      }
      if (looksLikeReplyLimitRejected(f.status, f.message) && f.status !== 402) {
        return `This model can't write that much in one reply. Pick another writer model in ${SETTINGS}.`
      }
  }
  return describeFailure(f, { name: target.name, kind: target.kind, baseUrl: target.baseUrl, hasKey: !!target.apiKey }, { during: 'draft', modelId })
    .replace(/ The text that arrived is kept\.$/, '')
    .replace(/This model refused the scene\./, 'The writer model turned this down.')
}

/** The reply could be read, but held nothing the builder could use, even when asked again. */
export const UNUSABLE = `The AI's reply wasn't something AI Write could use. Try again, or pick another writer model in ${SETTINGS}.`
