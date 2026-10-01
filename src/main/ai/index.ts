// Model connection, context assembly and generation records live in this folder:
//   client.ts     streaming OpenAI-compatible chat (with sse.ts, think.ts, retry.ts, errors.ts)
//   providers.ts  OpenRouter and custom providers, model lists, connection tests
//   context.ts    the briefing, in the spec's fixed priority order, fitted to the model
//   drafts.ts     running a draft: record, stream, save as it arrives, finish
import { onWorldClosing, onWorldOpened } from '../world'
import { stopInterrupted } from '../db/generations'
import { now } from '../util'
import { stopDraftsFor } from './drafts'
import { warmTokens } from './tokenService'

export function initAi(): void {
  // A draft still marked as being written when a world opens was cut off by a
  // crash or a forced quit: it keeps its text and counts as stopped.
  onWorldOpened((w) => {
    try {
      stopInterrupted(w.db, now())
    } catch (e) {
      console.error('Could not tidy unfinished drafts', e)
    }
  })
  // Closing a world stops its drafts and finishes their records first.
  onWorldClosing((w) => stopDraftsFor(w.db))
  warmTokens()
}
