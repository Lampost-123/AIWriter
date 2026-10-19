// Applying a revised plan from talking the suggestions over (2026-10-19, after "Talk it over wipes work"): the revision
// takes the place of the suggestions, and what Adam did with them carries over. Each revised part is matched to the one
// it was (by where the talk's answer says it came from, else by its title in the same act or chapter); what was kept
// stays kept and is never offered to keep twice, what he discarded since stays discarded, and his own changes stay his
// wherever the talk didn't change that part. What was kept but not sent to the talk (it had nothing left to decide in
// it) is put back in its place, so the list still shows it as kept. No React, so it is unit-tested.

import { parseOutline, preambleOf, type ParsedOutline, type SuggestedAct, type SuggestedChapter, type SuggestedScene } from './parse'
import { outlineText, walkKeyed } from './outlineText'
import type { Decisions, Edits, NodeKind } from './tree'

type AnyNode = SuggestedAct | SuggestedChapter | SuggestedScene

/** What a revision knows about where its parts came from (see planTalk.ts PlanRevision). */
export interface RevisionTrail {
  /** Its parts' keys among the suggestions as they were when it was asked for (revised key to key then). */
  from?: Record<string, string> | null
  /** The parts (revised keys) the talk changed or added. Left out: not known, so the words are compared. */
  changed?: string[] | null
  /** The suggestions' keys that were sent to the talk. Left out: not known (only what was kept is put back). */
  sent?: string[] | null
}

export interface Carried {
  text: string
  decisions: Decisions
  edits: Edits
  /** The titles of kept parts the talk would have changed: they are in the story already, so they stay as they are. */
  keptAsWas: string[]
}

const flat = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** A part's own words (not what it holds), for telling whether the talk changed it. */
function ownWords(kind: NodeKind, n: AnyNode): string {
  if (kind === 'act') {
    const a = n as SuggestedAct
    return [a.title, a.purpose].map(flat).join('\u0001')
  }
  const card = (n as SuggestedChapter | SuggestedScene).card
  const cardWords = card ? [card.pov, card.characters.join(','), card.location, card.when, card.mood].map(flat).join('|') : ''
  if (kind === 'chapter') {
    const c = n as SuggestedChapter
    return [c.title, c.goal, cardWords].map(flat).join('\u0001')
  }
  const s = n as SuggestedScene
  return [s.title, s.summary, s.when, s.beats.join('|'), cardWords, (s.setsUp ?? []).join('|'), (s.paysOff ?? []).join('|')].map(flat).join('\u0001')
}

/** A part with Adam's changes on it, as it would read (for comparing with a revised one). */
function withEdit(kind: NodeKind, n: AnyNode, edits: Edits): AnyNode {
  const e = edits[n.key]
  if (!e) return n
  if (kind === 'act') return { ...(n as SuggestedAct), title: e.title, purpose: e.text }
  if (kind === 'chapter') return { ...(n as SuggestedChapter), title: e.title, goal: e.text, card: e.card ?? (n as SuggestedChapter).card }
  const s = n as SuggestedScene
  return { ...s, title: e.title, summary: e.text, beats: e.beats, when: e.when ?? s.when, card: e.card ?? s.card, setsUp: e.setsUp ?? s.setsUp, paysOff: e.paysOff ?? s.paysOff }
}

/** A kept part's own words put back as they were kept (it is in the story already: the talk can't change it there). */
function restoreOwn(kind: NodeKind, into: AnyNode, was: AnyNode): void {
  if (kind === 'act') Object.assign(into, { title: was.title, purpose: (was as SuggestedAct).purpose })
  else if (kind === 'chapter') Object.assign(into, { title: was.title, goal: (was as SuggestedChapter).goal, card: (was as SuggestedChapter).card })
  else {
    const s = was as SuggestedScene
    Object.assign(into, { title: s.title, summary: s.summary, beats: s.beats, when: s.when, card: s.card, setsUp: s.setsUp, paysOff: s.paysOff })
  }
}

const childrenOf = (kind: NodeKind, n: AnyNode): AnyNode[] =>
  kind === 'act' ? (n as SuggestedAct).chapters : kind === 'chapter' ? (n as SuggestedChapter).scenes : []

interface OldPart {
  node: AnyNode
  kind: NodeKind
  parent: string | null
  /** The parts of its kind beside it, in order (its own list). */
  siblings: AnyNode[]
}

/**
 * The suggestions after a revision: `text` (the suggestions now), `decisions` and `edits` (Adam's, on them), `revised`
 * (the revised plan, in the outline form) and what is known of where its parts came from.
 */
export function carryRevision(text: string, decisions: Decisions, edits: Edits, revised: string, trail: RevisionTrail = {}): Carried {
  const old = parseOutline(text, true)
  const rev: ParsedOutline = parseOutline(revised, true)
  const parts = new Map<string, OldPart>()
  const listOf = (kind: NodeKind, parent: AnyNode | null): AnyNode[] => (parent ? childrenOf(kind === 'scene' ? 'chapter' : 'act', parent) : kind === 'act' ? old.acts : old.chapters)
  walkKeyed(old, (node, kind, key, parent) => parts.set(key, { node, kind, parent: parent?.key ?? null, siblings: listOf(kind, parent) }))

  const kept = (key: string): boolean => decisions[key]?.status === 'kept'
  /** Each revised part's key among the suggestions, and which revised part each of those is now. */
  const origin = new Map<AnyNode, string>()
  const rep = new Map<string, AnyNode>()
  const changed = trail.changed ? new Set(trail.changed) : null
  /** The revised parts the talk changed, as it said (their keys move once kept parts go back in). */
  const touched = new Set<AnyNode>()
  /** Kept parts the talk sent again as new ones. */
  const twice: { node: AnyNode; list: AnyNode[] }[] = []

  walkKeyed(rev, (node, kind, key, parent) => {
    if (changed?.has(key)) touched.add(node)
    let from = trail.from?.[key] ?? null
    if (from && (parts.get(from)?.kind !== kind || rep.has(from))) from = null
    if (!from) {
      // By its title in the same place: the act or chapter it is in is the one that was (or the story, for an act or a
      // chapter outside any act). Never one Adam discarded: that stays left out.
      const under = parent ? (origin.get(parent) ?? null) : null
      for (const [k, p] of parts)
        if (p.kind === kind && p.parent === under && !rep.has(k) && decisions[k]?.status !== 'discarded' && flat(p.node.title) === flat(node.title)) {
          from = k
          break
        }
      // Taken for a new one, unless it is one kept already (the AI sent it again): that is the kept one, never a second.
      if (from && !kept(from) && trail.from) from = null
      // A kept scene (or an empty act or chapter) sent again as new goes; the kept one goes back where it was, below.
      if (from && trail.from && childrenOf(kind, node).length === 0) {
        twice.push({ node, list: parent ? childrenOf(kind === 'scene' ? 'chapter' : 'act', parent) : kind === 'act' ? rev.acts : rev.chapters })
        return
      }
    }
    if (!from) return
    origin.set(node, from)
    rep.set(from, node)
  })
  for (const { node, list } of twice) list.splice(list.indexOf(node), 1)

  // What was kept (or never sent to the talk) and isn't in the revision goes back in its place, in reading order, so
  // a kept act or chapter is back before what was kept inside it.
  const sent = trail.sent ? new Set(trail.sent) : null
  for (const [key, p] of parts) {
    if (rep.has(key) || decisions[key]?.status === 'discarded') continue
    if (!kept(key) && (!sent || sent.has(key))) continue
    const home: AnyNode[] | null = p.parent ? (rep.has(p.parent) ? childrenOf(parts.get(p.parent)!.kind, rep.get(p.parent)!) : null) : p.kind === 'act' ? rev.acts : rev.chapters
    if (!home) continue
    const copy = { ...p.node, ...(p.kind === 'act' ? { chapters: [] } : p.kind === 'chapter' ? { scenes: [] } : {}) } as AnyNode
    // After the nearest one before it that is in the revision, else before the nearest after it, else where it was.
    const at = p.siblings.indexOf(p.node)
    const beforeIt = p.siblings
      .slice(0, at)
      .reverse()
      .map((s) => rep.get(s.key))
      .find((r) => !!r && home.includes(r))
    const afterIt = beforeIt ? undefined : p.siblings
      .slice(at + 1)
      .map((s) => rep.get(s.key))
      .find((r) => !!r && home.includes(r))
    const index = beforeIt ? home.indexOf(beforeIt) + 1 : afterIt ? home.indexOf(afterIt) : Math.min(at, home.length)
    home.splice(index, 0, copy)
    origin.set(copy, key)
    rep.set(key, copy)
  }

  const nextDecisions: Decisions = {}
  const nextEdits: Edits = {}
  const keptAsWas: string[] = []
  walkKeyed(rev, (node, kind, key) => {
    const from = origin.get(node)
    if (!from) return
    const d = decisions[from]
    const was = parts.get(from)!.node
    if (d) nextDecisions[key] = d
    // Kept: as it was kept, with Adam's words on it (the story has it so).
    if (d?.status === 'kept') {
      if (ownWords(kind, withEdit(kind, was, edits)) !== ownWords(kind, node)) keptAsWas.push((edits[from]?.title ?? was.title).trim())
      restoreOwn(kind, node, was)
    }
    const e = edits[from]
    if (!e) return
    // His changes stay his where the talk didn't change the part (by what it says, else by its words).
    const untouched = d?.status === 'kept' || (changed ? !touched.has(node) : ownWords(kind, withEdit(kind, was, edits)) === ownWords(kind, node))
    if (untouched) nextEdits[key] = e
  })
  const lead = preambleOf(text)
  const body = outlineText(rev)
  return { text: lead ? `${lead}\n\n${body}` : body, decisions: nextDecisions, edits: nextEdits, keptAsWas }
}
