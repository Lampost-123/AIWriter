// An AI edit as the window sends it, checked and cut to size before the briefing is made from it. Pure (no
// database), so it can be tested.

import type { EditInput } from '@shared/contracts/edits'
import type { EditTool } from '@shared/types'
import { UserError } from '../util'

const TOOLS: EditTool[] = ['rewrite', 'expand', 'condense', 'vivid', 'tone', 'voice', 'alternatives', 'continue']

/** Longest text taken from the window for each part (a whole scene is far smaller). */
export const MAX_CHARS = 400_000

/**
 * At most MAX_CHARS of a text from the window: its start, or (for the text before the selected words, whose
 * end is what the briefing needs: the words just before them, or the scene so far for Continue) its end.
 */
const text = (v: unknown, keep: 'start' | 'end' = 'start'): string =>
  typeof v !== 'string' ? '' : keep === 'end' ? v.slice(-MAX_CHARS) : v.slice(0, MAX_CHARS)

/** The edit, checked. Throws (plain words) when the tool is unknown, or Rewrite or Change tone has nothing to go on. */
export function editInput(raw: EditInput): EditInput {
  const tool = raw?.tool
  if (!TOOLS.includes(tool)) throw new UserError('Something went wrong starting that. Try again.')
  const input: EditInput = {
    taskId: String(raw.taskId ?? ''),
    sceneId: String(raw.sceneId ?? ''),
    tool,
    direction: text(raw.direction).trim().slice(0, 2000),
    selection: text(raw.selection),
    before: text(raw.before, 'end'),
    after: text(raw.after),
    continueAs: raw.continueAs === 'inline' ? 'inline' : 'paragraph'
  }
  if ((tool === 'rewrite' || tool === 'tone') && !input.direction) {
    throw new UserError(tool === 'rewrite' ? 'Say how to rewrite the words first.' : 'Pick a tone first.')
  }
  return input
}
