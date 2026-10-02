// Milestone 4's fake replies: each part's AI calls start their system prompt with their own marker,
// "[AIWRITE-<PART> v1] <job>", and that part's module here answers them with deterministic text (or
// returns null for a request that isn't its own). server.mjs asks them after the builder's replies.
// Requests with no marker (Generate, Variants, Beat by beat) get the usual fake prose.
import { editsReply } from './edits.mjs'
import { askReply } from './ask.mjs'
import { outlineReply } from './outline.mjs'
import { readAloudReply } from './readAloud.mjs'
import { worldReply } from './world.mjs'

const PARTS = [editsReply, askReply, outlineReply, readAloudReply, worldReply]

/** The reply for a milestone 4 request, or null when it isn't one. */
export function m4Reply(system, messages, model = '') {
  for (const reply of PARTS) {
    const out = reply(String(system), messages ?? [], model)
    if (out != null) return out
  }
  return null
}
