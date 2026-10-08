// Which notes the desk's margin shows for a scene (UI overhaul, phase 3). Pure, so it is unit-tested; MarginLayer
// gathers what it needs (the scene's names, where each is first named, the scene's open issues found in the text, the
// memory's latest run) and places what comes back.
//
// - The scene card, always, pinned beside the title.
// - Entities (characters, places, items, groups, lore and events; never plot threads or glossary terms) named in the
//   text and in the story at this point, that are on the scene card or carry something worth a note: a one-liner,
//   something that has happened to them, or (for a character) how they speak. Each scores by why it is here (the point
//   of view 3, present or where the scene happens 2, only named 1), plus 1 when its fact line is from this chapter and
//   2 for a lore rule never to break. At most two to a paragraph and six in all (the lower scores go), shown in the
//   order they are first named.
// - Checks: the scene's open issues whose words are in the text, must-fix first, three at most; the last one says how
//   many more there are in the Issues tab.
// - Memory: one note after the memory has read the scene, saying how many facts it updated.
// - Nothing Adam has put away this session.
import type { Issue, IssueSeverity } from '@shared/contracts/checks'
import type { NamedEntry, SceneNames, StateLine } from '@shared/contracts/manuscript'
import type { EntryKind, ID } from '@shared/types'
import type { Anchor, EntitySlipData, MemorySlipData, PlacedSlip, SlipKind } from './anchors'

/** The kinds that get a note of their own. */
export const ENTITY_KINDS: readonly EntryKind[] = ['character', 'place', 'item', 'group', 'lore', 'event']
/** At most this many entity notes in a scene, and this many beside one paragraph. */
export const MAX_ENTITIES = 6
export const PER_PARAGRAPH = 2
/** At most this many check notes. */
export const MAX_CHECKS = 3

/** Where something is in the page: its anchor, and its paragraph's place in reading order. */
export interface Placed {
  anchor: Anchor
  /** The paragraph's index in the page (0 for the first). */
  block: number
}

export interface SlipInput {
  names: SceneNames | null
  /** Where each entry is first named in the page. */
  firstMentions: ReadonlyMap<ID, Placed>
  /** The scene's open issues whose words were found in the page, with where. */
  issues: readonly (Placed & { issue: Issue })[]
  /** How many of the scene's open issues there are in all (found in the text or not). */
  openIssues: number
  /** The memory's latest run on this scene, while it is new. */
  memory: (MemorySlipData & { at: Placed | null }) | null
  /** Notes Adam has put away this session. */
  dismissed: readonly string[]
}

const KIND_OF: Record<string, SlipKind> = {
  character: 'character',
  place: 'place',
  item: 'item',
  group: 'group',
  lore: 'lore',
  event: 'event'
}

const SEVERITY: Record<IssueSeverity, number> = { 'must-fix': 0, warning: 1, minor: 2 }

/** "Book 1, Ch 2, Sc 3" → "Book 1, Ch 2": the chapter part of a place in plain words ('' when it has none). */
export function chapterPart(where: string): string {
  const m = /^(.*?\bCh \d+)\b/.exec(where)
  return m ? m[1] : ''
}

/** "Book 1, Ch 2, Sc 3" → "Ch 2" (the short form a note's tag uses), or ''. */
export function chapterTag(where: string): string {
  const m = /\bCh (\d+)\b/.exec(where)
  return m ? `Ch ${m[1]}` : ''
}

/** The latest thing that happened to an entry before this scene (its fact line), or null. */
export function factLine(state: readonly StateLine[]): StateLine | null {
  for (let i = state.length - 1; i >= 0; i--) {
    const l = state[i]
    if (l.kind === 'happened' && !l.here && l.text.trim()) return l
  }
  return null
}

/** The note for an entry named in the page, or null when it doesn't get one. */
export function entityFor(e: NamedEntry, cast: SceneNames['cast'], chapter: string): EntitySlipData | null {
  if (!ENTITY_KINDS.includes(e.kind) || e.absent) return null
  const role: EntitySlipData['role'] =
    cast.povId === e.id ? 'pov' : cast.presentIds.includes(e.id) ? 'present' : cast.locationId === e.id ? 'location' : 'named'
  const fact = factLine(e.state)
  const worth = role !== 'named' || !!e.summary.trim() || !!fact || !!e.voice || (e.kind === 'lore' && !!e.hardRule)
  if (!worth) return null
  const fromChapter = !!fact && !!chapter && (fact.where === chapter || fact.where.startsWith(`${chapter},`))
  const rule = e.kind === 'lore' && !!e.hardRule
  const score = (role === 'pov' ? 3 : role === 'named' ? 1 : 2) + (fromChapter ? 1 : 0) + (rule ? 2 : 0)
  const since = fact ? chapterTag(fact.where) : ''
  const tag = e.kind === 'lore' ? 'In memory' : since ? `Since ${since}` : null
  return { entry: e, role, tag, fact, score }
}

const before = (a: Placed, b: Placed): number => a.block - b.block || a.anchor.offset - b.anchor.offset

/** The notes for a scene, in the order they are about (the scene card first). */
export function pickSlips(input: SlipInput): PlacedSlip[] {
  const gone = new Set(input.dismissed)
  const out: PlacedSlip[] = []
  if (!gone.has('card')) out.push({ id: 'card', kind: 'card', anchor: 'top', pinned: true })

  // Entities.
  const names = input.names
  if (names) {
    const chapter = chapterPart(names.label)
    const candidates: (EntitySlipData & { at: Placed; id: string })[] = []
    for (const e of names.entries) {
      const at = input.firstMentions.get(e.id)
      if (!at) continue
      const id = `entity:${e.id}`
      if (gone.has(id)) continue
      const data = entityFor(e, names.cast, chapter)
      if (data) candidates.push({ ...data, at, id })
    }
    const better = (a: (typeof candidates)[number], b: (typeof candidates)[number]): number => b.score - a.score || before(a.at, b.at)
    // Two to a paragraph at most: the higher scores stay.
    const byBlock = new Map<number, typeof candidates>()
    for (const c of candidates) byBlock.set(c.at.block, [...(byBlock.get(c.at.block) ?? []), c])
    const kept = [...byBlock.values()].flatMap((list) => list.sort(better).slice(0, PER_PARAGRAPH))
    const shown = kept.sort(better).slice(0, MAX_ENTITIES).sort((a, b) => before(a.at, b.at))
    for (const c of shown) {
      const { at, id, ...entity } = c
      out.push({ id, kind: KIND_OF[c.entry.kind], anchor: at.anchor, entity })
    }
  }

  // Checks: must-fix first, then in reading order.
  const issues = input.issues
    .filter((i) => i.issue.status === 'open' && !gone.has(`issue:${i.issue.id}`))
    .sort((a, b) => SEVERITY[a.issue.severity] - SEVERITY[b.issue.severity] || before(a, b))
  const checks = issues.slice(0, MAX_CHECKS).sort(before)
  // Everything else open (put away here, or with words not found) is still in the Issues tab.
  const more = Math.max(0, input.openIssues - checks.length)
  checks.forEach((c, i) => {
    out.push({ id: `issue:${c.issue.id}`, kind: 'issue', anchor: c.anchor, check: { issue: c.issue, more: i === checks.length - 1 ? more : 0 } })
  })

  // Memory.
  const m = input.memory
  if (m && m.at && m.count > 0 && !gone.has(`memory:${m.runId}`)) {
    const { at, ...memory } = m
    out.push({ id: `memory:${m.runId}`, kind: 'memory', anchor: at.anchor, memory })
  }
  return out
}
