// Milestone 5's fake replies: each part's AI calls start their system prompt with their own marker, and that
// part's module here answers them with deterministic text (or returns null for a request that isn't its
// own). server.mjs asks them after milestone 4's.
import { checkReply } from './check.mjs'

const PARTS = [checkReply]

/** The reply for a milestone 5 request, or null when it isn't one. */
export function m5Reply(system, messages, model = '') {
  for (const reply of PARTS) {
    const out = reply(String(system), messages ?? [], model)
    if (out != null) return out
  }
  return null
}
