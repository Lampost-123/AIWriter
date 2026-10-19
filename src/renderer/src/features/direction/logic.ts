// The direction composer's workings (features/direction/DirectionComposer.tsx), pure so they are unit-tested: the quick
// asks ("chips") and how they go into the box and come out again, the directions given before merged with those given
// this session and searched, and ↑/↓ stepping back through them in the box. See contracts/direction.ts.
import type { DirectionSource, RecentDirection } from '@shared/contracts/direction'
import { directionKey, tidyDirection } from '@shared/directions'

// ---------- Quick asks ----------

export type ChipId = 'shorter' | 'longer' | 'dialogue' | 'description' | 'slower' | 'faster' | 'thoughts' | 'tenser' | 'hook'

export interface Chip {
  id: ChipId
  /** Its name on the chip. */
  label: string
  /** The short ask it puts in the box, as Adam would write it. */
  ask: string
  /** The ask it takes the place of (Shorter and Longer, Slower and Faster can't both be asked). */
  opposite?: ChipId
}

/** Every quick ask, in the order they show: the first few on the row, the rest behind More. */
export const CHIPS: readonly Chip[] = [
  { id: 'shorter', label: 'Shorter', ask: 'Keep it shorter.', opposite: 'longer' },
  { id: 'longer', label: 'Longer', ask: 'Make it longer.', opposite: 'shorter' },
  { id: 'dialogue', label: 'More dialogue', ask: 'More dialogue.' },
  { id: 'description', label: 'Less description', ask: 'Less description.' },
  { id: 'slower', label: 'Slower', ask: 'Slow the pace down.', opposite: 'faster' },
  { id: 'faster', label: 'Faster', ask: 'Pick up the pace.', opposite: 'slower' },
  { id: 'thoughts', label: 'Inner thoughts', ask: 'Show more of their inner thoughts.' },
  { id: 'tenser', label: 'Tenser', ask: 'Make it tenser.' },
  { id: 'hook', label: 'End on a hook', ask: 'End on a hook.' }
]

/** At most this many quick asks show on the row at once; the rest are behind More. */
export const CHIPS_SHOWN = 4

export const chipById = (id: ChipId): Chip => CHIPS.find((c) => c.id === id)!

/** An ask's words, as looked for in the box: lower case, single spaces, no closing full stop. */
const askWords = (ask: string): string => directionKey(ask)

/** Where an ask's words are in the box (ignoring case and runs of spaces), or null. */
function findAsk(text: string, ask: string): { from: number; to: number } | null {
  const words = askWords(ask)
    .split(' ')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length || !words[0]) return null
  const m = new RegExp(`(^|[^\\p{L}\\p{N}'])(${words.join('\\s+')})(?![\\p{L}\\p{N}])`, 'iu').exec(text)
  if (!m) return null
  const from = m.index + m[1].length
  return { from, to: from + m[2].length }
}

/** The box asks this already (the chip shows pressed). */
export const hasAsk = (text: string, chip: Chip): boolean => findAsk(text, chip.ask) !== null

/** The box with an ask added at its end, as its own sentence. */
export function addAsk(text: string, ask: string): string {
  const t = text.replace(/\s+$/u, '')
  if (!t) return ask
  // After a sentence's end (or a comma, colon or dash) a space will do; otherwise the last words get their full stop.
  const sep = /[.!?…,:;–—-]["'”’)\]]*$/u.test(t) ? ' ' : '. '
  return `${t}${sep}${ask}`
}

/** The box with an ask taken out (its full stop and the space after it too), the rest as it was. */
export function removeAsk(text: string, ask: string): string {
  const at = findAsk(text, ask)
  if (!at) return text
  let to = at.to
  while (to < text.length && /[.!…]/u.test(text[to])) to++
  const before = text.slice(0, at.from).replace(/[ \t]+$/u, '')
  let after = text.slice(to).replace(/^[ \t]+/u, '')
  // An ask on a line of its own takes its line with it.
  if (/\n$/u.test(before) && /^\n/u.test(after)) after = after.slice(1)
  // Whatever space was between the ask and its neighbours closes up to one (none at the start of a line).
  const glue = after && before.trim() && !/\n$/u.test(before) && !/^\n/u.test(after) ? ' ' : ''
  return `${before}${glue}${after}`.replace(/\s+$/u, '').replace(/^\s+/u, '')
}

/** The box after the chip is pressed: its ask goes (pressed again), or comes in, in place of its opposite's. */
export function toggleChip(text: string, chip: Chip): string {
  if (hasAsk(text, chip)) return removeAsk(text, chip.ask)
  const other = chip.opposite ? chipById(chip.opposite) : null
  const without = other ? removeAsk(text, other.ask) : text
  return addAsk(without, chip.ask)
}

// ---------- Directions given before ----------

/** A direction given in this session, before its record is read back (a draft still getting ready has none yet). */
export interface UsedDirection {
  text: string
  at: string
  source: DirectionSource
}

/** The directions given before (from the records) and this session, newest first, the same words once. */
export function mergeRecents(fromRecords: readonly RecentDirection[], used: readonly UsedDirection[], limit = 40): RecentDirection[] {
  const all: RecentDirection[] = [...used.map((u) => ({ ...u, text: tidyDirection(u.text), uses: 1 })), ...fromRecords]
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const seen = new Map<string, RecentDirection>()
  for (const d of all) {
    const key = directionKey(d.text)
    if (!key) continue
    const had = seen.get(key)
    if (had) had.uses = Math.max(had.uses, d.uses)
    else seen.set(key, { ...d })
  }
  return [...seen.values()].slice(0, limit)
}

/** The directions whose words hold every word searched for (any order, any case). */
export function searchDirections<T extends { text: string }>(items: readonly T[], query: string): T[] {
  const words = directionKey(query).split(' ').filter(Boolean)
  if (!words.length) return [...items]
  return items.filter((d) => {
    const key = directionKey(d.text)
    return words.every((w) => key.includes(w))
  })
}

/** What the list says a direction came from. */
export const SOURCE_WORDS: Record<DirectionSource, string> = {
  draft: 'Draft',
  variants: 'Variants',
  beat: 'Beat',
  continue: 'Continue',
  rewrite: 'Rewrite'
}

// ---------- ↑ and ↓ in the box ----------

/** Where ↑ has got to in the directions given before: none yet (-1), or the one showing, and what the box held first. */
export interface HistoryState {
  index: number
  shown: string
  before: string
}

export const NO_HISTORY: HistoryState = { index: -1, shown: '', before: '' }

/**
 * ↑ (older) or ↓ (newer) in the box: the next direction to show from `list` (newest first), or null when the key isn't
 * the box's to take (it has words of its own, or there is nothing to step to), so it does what it otherwise would.
 * ↑ starts from an empty box; once stepping, the box shows each in turn while it is left as shown, and ↓ past the newest
 * gives back what the box held. At the oldest, ↑ stays there.
 */
export function historyStep(
  state: HistoryState,
  value: string,
  dir: 'older' | 'newer',
  list: readonly string[]
): { state: HistoryState; value: string } | null {
  const stepping = state.index >= 0 && value === state.shown
  if (dir === 'older') {
    if (!stepping && value.trim() !== '') return null
    if (!list.length) return null
    const index = stepping ? Math.min(state.index + 1, list.length - 1) : 0
    const before = stepping ? state.before : value
    return { state: { index, shown: list[index], before }, value: list[index] }
  }
  if (!stepping) return null
  if (state.index === 0) return { state: NO_HISTORY, value: state.before }
  const index = state.index - 1
  return { state: { ...state, index, shown: list[index] }, value: list[index] }
}
