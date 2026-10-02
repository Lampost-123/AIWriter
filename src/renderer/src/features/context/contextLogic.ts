// Pure helpers for the Context tab: the token bar, each part's state, the entries in the briefing,
// pins, and finding which summaries the "Story so far" part was built from. No React, no window,
// so they are unit-tested.

import { NOT_READY, plainReason } from '../../lib/reason'
import type { BlockMode, ContextBlock, ContextBudget, ContextEntry, ContextPreview, EntryKind, ID, PinScope, Summary } from '@shared/types'

// ---------- The token bar ----------

export interface BudgetView {
  /** Share of the room for the briefing that it uses: 0 to 1, above 1 when it doesn't fit. */
  share: number
  /** The bar's fill, 0 to 100 (at least 1 when anything is used, so a small briefing still shows). */
  fill: number
  /** "12%", or "No room" when the reply takes all the room the model has. */
  percentText: string
  /** Above 90% of the room: the bar turns amber. */
  tight: boolean
  /** The reply takes all the room the model has, so nothing is left for the briefing. */
  noRoom: boolean
}

export function budgetView(budget: Pick<ContextBudget, 'used' | 'available'>): BudgetView {
  const { used, available } = budget
  if (available <= 0) return { share: used > 0 ? Infinity : 0, fill: 100, percentText: 'No room', tight: true, noRoom: true }
  const share = used / available
  const fill = Math.min(100, Math.max(used > 0 ? 1 : 0, Math.round(share * 100)))
  return { share, fill, percentText: `${Math.round(share * 100)}%`, tight: share > 0.9, noRoom: false }
}

// ---------- Parts of the briefing ----------

export type BlockState = 'full' | 'short' | 'left-out'

export const blockState = (b: ContextBlock): BlockState => (b.dropped ? 'left-out' : b.short ? 'short' : 'full')

export const BLOCK_STATE_WORDS: Record<BlockState, string> = { full: 'Full', short: 'Short', 'left-out': 'Left out' }

/** Why a part is the way it is, in plain words, for its tooltip. */
export function blockStateNote(b: ContextBlock): string {
  const mode = b.mode ?? 'auto'
  if (b.dropped) return "Left out: there wasn't room for it in this model's briefing."
  if (b.short) return mode === 'short' ? 'Sent in its short form, as you chose.' : 'Shortened to fit the room this model has.'
  if (b.hasShort && mode === 'full') return 'Sent in full, as you chose.'
  return 'Sent in full.'
}

/** The parts in the order they matter (priority 1 first), keeping the briefing's order within a priority. */
export function orderBlocks(blocks: ContextBlock[]): ContextBlock[] {
  return blocks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.priority - y.b.priority || x.i - y.i)
    .map((x) => x.b)
}

/** The part with Adam's new choice, shown straight away while the briefing is worked out again. */
export const withMode = (blocks: ContextBlock[], blockId: string, mode: BlockMode): ContextBlock[] =>
  blocks.map((b) => (b.id === blockId ? { ...b, mode } : b))

export const MODE_HINTS: Record<BlockMode, string> = {
  auto: 'In full when there is room, short when space is tight.',
  full: 'Always in full, even if other parts must be shortened or left out.',
  short: 'Always in its short form, leaving room for the rest.'
}

// ---------- Entries in the briefing ----------

/**
 * The entries in the briefing and the ones Adam kept out, from the preview. Older previews that
 * don't list them are read from the parts' entries instead (with `known` for names and kinds).
 */
export function briefingEntries(
  preview: Pick<ContextPreview, 'blocks' | 'entries'>,
  known: Map<ID, { name: string; kind: EntryKind }>
): { included: ContextEntry[]; removed: ContextEntry[] } {
  let list = preview.entries
  if (!list) {
    const seen = new Set<ID>()
    list = []
    for (const b of preview.blocks) {
      if (b.dropped) continue
      for (const id of b.entryIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const k = known.get(id)
        list.push({
          entryId: id,
          name: k?.name ?? 'Unnamed',
          kind: k?.kind ?? 'character',
          blockId: b.id,
          why: b.title,
          pinned: null,
          hidden: false,
          label: null
        })
      }
    }
  }
  return { included: list.filter((e) => !e.hidden), removed: list.filter((e) => e.hidden) }
}

/** Where a removed entry was kept out ("Kept out of this story"): bringing it back clears that. */
export function hiddenScope(entry: Pick<ContextEntry, 'why'>): PinScope {
  if (/every scene/i.test(entry.why)) return 'world'
  if (/this story/i.test(entry.why)) return 'story'
  return 'scene'
}

export const PIN_WORDS: Record<PinScope, string> = { scene: 'this scene', story: 'this story', world: 'every scene' }

/** The scope's id for setPin: the scene, the story, or none for every scene. */
export const scopeIdFor = (scope: PinScope, sceneId: ID, storyId: ID | null): ID | null =>
  scope === 'scene' ? sceneId : scope === 'story' ? storyId : null

/** The entry list after a pin or a removal, shown straight away while the briefing is worked out again. */
export function withPin(entries: ContextEntry[], entryId: ID, scope: PinScope, action: 'pin' | 'hide' | null): ContextEntry[] {
  return entries.map((e) => {
    if (e.entryId !== entryId) return e
    if (action === 'hide') return { ...e, hidden: true, blockId: null, pinned: null, why: `Kept out of ${PIN_WORDS[scope]}` }
    if (action === 'pin') {
      // An entry already there for another reason keeps it (the pin shows beside it); one there only for a pin, or kept out, is pinned now.
      const why = e.hidden || /^pinned/i.test(e.why) ? `Pinned for ${PIN_WORDS[scope]}` : e.why
      return { ...e, hidden: false, pinned: scope, why }
    }
    // Cleared: the next briefing says why it is (or isn't) there now.
    return e.hidden ? { ...e, hidden: false } : { ...e, pinned: null }
  })
}

/** The list with an entry Adam has just pinned, added at the end if the briefing didn't have it yet. */
export function withNewPin(
  entries: ContextEntry[],
  entry: { entryId: ID; name: string; kind: EntryKind },
  scope: PinScope
): ContextEntry[] {
  if (entries.some((e) => e.entryId === entry.entryId)) return withPin(entries, entry.entryId, scope, 'pin')
  return [...entries, { ...entry, blockId: 'mentioned', why: `Pinned for ${PIN_WORDS[scope]}`, pinned: scope, hidden: false, label: null }]
}

/** One call to setPin. */
export interface PinCall {
  scope: PinScope
  action: 'pin' | 'hide' | null
}

/**
 * The setPin calls that pin an entry for one scope only. The pin it had elsewhere is cleared, so the
 * menu works as a choice of one (the most specific pin decides, so an old scene pin would win).
 */
export function pinCalls(current: PinScope | null, scope: PinScope): PinCall[] {
  const calls: PinCall[] = [{ scope, action: 'pin' }]
  if (current && current !== scope) calls.push({ scope: current, action: null })
  return calls
}

/** What one entry row says under its name: its kind, why it is there, and anything to know. */
export function entryDetail(entry: Pick<ContextEntry, 'why' | 'label' | 'pinned'>, kindWord: string, leftOutForRoom: boolean): string {
  const parts = [kindWord, entry.why]
  // In for another reason as well (named in the beats, say): the pin still shows.
  if (entry.pinned && !/^pinned/i.test(entry.why)) parts.push(`pinned for ${PIN_WORDS[entry.pinned]}`)
  if (entry.label) parts.push(entry.label)
  if (leftOutForRoom) parts.push("left out: there wasn't room")
  return parts.filter(Boolean).join(' · ')
}

export { NOT_READY }

/** A failed change, in plain words, for a quiet note. */
export const quietReason = plainReason

// ---------- Story so far ----------

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

export interface UsedSummary {
  summary: Summary
  /** The label the briefing gives it ("Ch 2", "Book 1", "Meanwhile: Kell's Road"), when there is one. */
  label: string
}

/**
 * The summaries the "Story so far" part was built from, in the order the AI reads them. Each
 * summary goes into the part word for word, after a label line or a "Label: " prefix.
 */
export function usedSummaries(blockText: string, summaries: Summary[]): UsedSummary[] {
  const text = blockText.replace(/\r\n/g, '\n')
  const flat = squash(text)
  const found: { at: number; summary: Summary; label: string }[] = []
  const seen = new Set<string>()
  for (const s of summaries) {
    const want = squash(s.text)
    const key = `${s.level}:${s.targetId}`
    if (want.length < 2 || seen.has(key)) continue
    const at = flat.indexOf(want)
    if (at < 0) continue
    seen.add(key)
    found.push({ at, summary: s, label: labelBefore(text, s.text.trim()) })
  }
  return found.sort((a, b) => a.at - b.at).map(({ summary, label }) => ({ summary, label }))
}

export const summaryKey = (s: Pick<Summary, 'level' | 'targetId'>): string => `${s.level}:${s.targetId}`

/**
 * The summaries to show after the part was worked out again. One Adam has been editing stays in
 * its place even when it no longer matches (he emptied it, or is rewriting it), so the box he is
 * typing in never disappears under him.
 */
export function keepTouched(prev: UsedSummary[], next: UsedSummary[], touched: ReadonlySet<string>): UsedSummary[] {
  const out = [...next]
  const have = new Set(next.map((u) => summaryKey(u.summary)))
  prev.forEach((u, i) => {
    const key = summaryKey(u.summary)
    if (!touched.has(key) || have.has(key)) return
    out.splice(Math.min(i, out.length), 0, u)
    have.add(key)
  })
  return out
}

/** The label just before a summary in the text: "Label: " on its line, or the line above. */
function labelBefore(text: string, summaryText: string): string {
  const first = summaryText.split('\n')[0].trim()
  const at = first ? text.indexOf(first) : -1
  if (at < 0) return ''
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const prefix = text.slice(lineStart, at).trim()
  if (prefix) return prefix.replace(/[:\-–—]\s*$/, '').trim()
  const lines = text.slice(0, lineStart).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line)
      return line
        .replace(/^#+\s*/, '')
        .replace(/:\s*$/, '')
        .trim()
  }
  return ''
}
