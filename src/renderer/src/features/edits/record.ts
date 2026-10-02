// What "What the AI saw" (features/generate/WhatTheAISaw.tsx) says about the record of an AI edit of
// selected words, or of Continue (job 'edit'): it is a change, named for its tool, whose words waited in the
// page to be accepted or rejected, so nothing reached the scene unless Adam accepted it. Pure, so it can be
// tested. Owned by the AI edits part.
import type { GenerationRecord } from '@shared/types'
import { TOOL_NAMES } from './names'

export interface EditRecordWords {
  /** The start of the page's first line, before the date: "The exact briefing for this change (Expand) to “The Drowned Lantern”". */
  intro: string
  /** While the AI is still writing it. */
  streaming: string
  /** It was stopped before the end. */
  stopped: string
  /** The AI reached the most it may write in one reply. */
  cutOff: string
  /** Something went wrong, and the record says no more. */
  error: string
  /** What entries were edited since: "since this change". */
  since: string
  /** The heading over Adam's instruction (Rewrite) or the tone he asked for (Change tone). */
  direction: string
}

/** The words for an edit's record, or null for any other record (a draft, say). */
export function editRecordWords(rec: Pick<GenerationRecord, 'job' | 'params'>, sceneTitle: string | null): EditRecordWords | null {
  if (rec.job !== 'edit') return null
  const tool = rec.params.tool
  const name = tool ? ` (${TOOL_NAMES[tool]})` : ''
  return {
    intro: `The exact briefing for this change${name}${sceneTitle ? ` to “${sceneTitle}”` : ''}`,
    streaming: 'This change is still being written. Its words appear below as they arrive.',
    stopped:
      'This change was stopped before it finished. The words that came were offered to accept or reject; the scene changes only if you accepted them.',
    cutOff:
      tool === 'continue'
        ? 'The model ran out of room before the end: it reached the most it can write in one go, so the new words stop part-way. Try again, or pick a writer model that can write more at once.'
        : 'The model ran out of room before the end: it reached the most it can write in one go, so the new words stop part-way. Try it on fewer words, or pick a writer model that can write more at once.',
    error: 'Something went wrong while this change was written.',
    since: 'this change',
    direction: tool === 'tone' ? 'The tone you asked for' : 'Your instruction'
  }
}
