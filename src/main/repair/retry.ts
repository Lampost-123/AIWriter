// Asking again after a reply that couldn't be used (2026-10-19, the checks' cost), for the JSON jobs that ask once more:
// the consistency checks (checks/run.ts, checks/stories.ts), the story flows (storyFlows/call.ts), the builders
// (builder/jobs.ts) and the critic (critique/run.ts). The same request goes again with a short line on what was wrong at
// the end of its last message, never the failed reply, as the memory keeper's own (keeper/run.ts withCorrection): a
// provider that keeps the start of a prompt it has seen (DeepSeek, OpenAI) then reads all of it but that line from its
// cache, where sending the reply back paid for the whole request again and the reply on top. Pure.

import type { ChatMessage } from '@shared/types'

/** The request asked once more: the same messages, with `correction` after the last one's words. */
export function withCorrection(messages: ChatMessage[], correction: string): ChatMessage[] {
  const last = messages.length - 1
  return messages.map((m, i) => (i === last ? { ...m, content: `${m.content}\n\n${correction}` } : m))
}
