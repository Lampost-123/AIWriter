// Counting what a briefing's memory lines rest on (World Memory Overhaul B6): how many were the AI's guesses, how
// many were out of date (words edited since, or a summary being updated), how many Adam's own. Only the parts that
// were sent count. Pure, so the window, the main process and the trap harness can all use it.

import type { ContextBlock, MemoryTagCounts } from './types'

export function countMemoryTags(blocks: Pick<ContextBlock, 'dropped' | 'memory'>[]): MemoryTagCounts {
  const out: MemoryTagCounts = { lines: 0, stale: 0, guesses: 0, yours: 0 }
  for (const b of blocks) {
    if (b.dropped) continue
    for (const t of b.memory ?? []) {
      out.lines++
      if (t.health !== 'ok') out.stale++
      if (t.origin === 'guess') out.guesses++
      else if (t.origin === 'yours') out.yours++
    }
  }
  return out
}
