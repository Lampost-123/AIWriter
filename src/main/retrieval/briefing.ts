// Where step 5 meets the briefing (ai/context.ts): the entries it adds to the selection (sticky ones, and those found
// by searching) and its two blocks, what was said word for word and earlier passages found by searching. Everything
// still goes through the briefing's priority order and budget: these only add candidates. Pure.

import type { EntryState, ID } from '@shared/types'
import type { RecallInput, RecalledPassage, SaidLine } from './types'
import { saidText } from './said'

/** Why an entry is in the briefing, as the Context tab shows it. */
export const RECALL_WHY = {
  sticky: 'In one of the last two scenes',
  found: 'Found by searching for what the scene is about'
} as const

/** What was said sits with relationships and who knows what (block 6), shortened and left out before them. */
export const SAID_PRIORITY = 6
/** Earlier passages sit with the other entries named (block 9), shortened and left out before them. */
export const RECALLED_PRIORITY = 9

/** How many passages each form of the passages block holds: full, short, smaller. */
export const PASSAGES_SHOWN = { full: 5, short: 2, smaller: 1 }
/** How many lines each form of the said block holds: short and smaller (the full form holds them all). */
export const SAID_SHOWN = { short: 4, smaller: 2 }

/**
 * The entries step 5 adds to the selection, in order: those from the last two scenes, then those found by searching.
 * `take` adds one for a reason, or returns null (already chosen, kept out by Adam, or not in the story here).
 */
export function recalledEntries(recall: RecallInput | null | undefined, take: (id: ID, why: string) => EntryState | null): EntryState[] {
  if (!recall) return []
  const out: EntryState[] = []
  for (const id of recall.sticky) {
    const e = take(id, RECALL_WHY.sticky)
    if (e) out.push(e)
  }
  for (const id of recall.found) {
    const e = take(id, RECALL_WHY.found)
    if (e) out.push(e)
  }
  return out
}

export interface RecallBlock {
  id: 'said' | 'recalled'
  priority: number
  title: string
  text: string
  short: string | null
  smaller: string[]
}

const SAID_LEAD = 'Promises, threats and secrets told earlier, in the exact words. Keep to them: what was said, by whom, and who heard it.'
const PASSAGES_LEAD =
  'Found by searching the story so far for what this scene is about. Given word for word so the details stay the same; for reference, not to repeat.'

function saidBlock(lines: SaidLine[]): RecallBlock | null {
  if (!lines.length) return null
  const write = (list: SaidLine[]): string => `${SAID_LEAD}\n${list.map(saidText).join('\n')}`
  // The short forms keep the lines said or heard by someone in the scene first (they are first already).
  return {
    id: 'said',
    priority: SAID_PRIORITY,
    title: 'What was said, word for word',
    text: write(lines),
    short: lines.length > SAID_SHOWN.short ? write(lines.slice(0, SAID_SHOWN.short)) : null,
    smaller: lines.length > SAID_SHOWN.smaller ? [write(lines.slice(0, SAID_SHOWN.smaller))] : []
  }
}

function passagesBlock(found: RecalledPassage[]): RecallBlock | null {
  const best = found.slice(0, PASSAGES_SHOWN.full)
  if (!best.length) return null
  // The best few are kept as the block shrinks; each form lists its passages oldest first, as the story tells them.
  const write = (list: RecalledPassage[]): string =>
    [PASSAGES_LEAD, ...[...list].sort((a, b) => a.order - b.order).map((p) => `### ${p.where}${p.kind === 'summary' ? ' (in short)' : ''}\n${p.text.trim()}`)].join(
      '\n\n'
    )
  return {
    id: 'recalled',
    priority: RECALLED_PRIORITY,
    title: 'Earlier passages that may matter',
    text: write(best),
    short: best.length > PASSAGES_SHOWN.short ? write(best.slice(0, PASSAGES_SHOWN.short)) : null,
    smaller: best.length > PASSAGES_SHOWN.smaller ? [write(best.slice(0, PASSAGES_SHOWN.smaller))] : []
  }
}

/** Step 5's blocks for this briefing (none when it is switched off or found nothing). */
export function recallBlocks(recall: RecallInput | null | undefined): RecallBlock[] {
  if (!recall) return []
  return [saidBlock(recall.said), passagesBlock(recall.passages)].filter((b): b is RecallBlock => !!b)
}
