// How long work Adam isn't watching waits on a provider that has stopped answering (overhaul Phase 6): the memory
// keeper reading a scene, the summaries and where things stand. streamChat's own patience (two minutes for a first
// answer, asked again four times) is for a draft Adam watches, which says it is waiting and has Stop: in the background
// it looked like the app had frozen for over ten minutes a call. Here a provider that hasn't started answering in half
// a minute is given up on and asked once more, so about a minute in all; the work is tried again later as before
// (the memory on its next turn and at the next start). Pure.

import { isLocalUrl } from './errors'
import type { ChatTarget, StreamChatOptions } from './client'

/** How long background work waits for a provider to start answering. */
export const BACKGROUND_FIRST_REPLY_MS = 30_000
/** How many times background work asks again a provider that didn't answer in time. */
export const BACKGROUND_TIMEOUT_RETRIES = 1

export type Patience = Pick<StreamChatOptions, 'headersTimeoutMs' | 'timeoutRetries'>

/**
 * streamChat's options for work Adam isn't watching. A program on this computer (LM Studio, Ollama) may still be
 * loading its model, which can take longer than half a minute, so it keeps the usual wait for a first answer; it is
 * still asked again only once.
 */
export function backgroundPatience(target: Pick<ChatTarget, 'baseUrl'>): Patience {
  if (isLocalUrl(target.baseUrl)) return { timeoutRetries: BACKGROUND_TIMEOUT_RETRIES }
  return { headersTimeoutMs: BACKGROUND_FIRST_REPLY_MS, timeoutRetries: BACKGROUND_TIMEOUT_RETRIES }
}
