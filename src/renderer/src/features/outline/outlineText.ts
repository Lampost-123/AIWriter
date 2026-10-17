// The outline helper's suggestions written back out in the AI's own outline form (src/main/outline/prompts.ts), so
// they can be talked over or one of them done again (the Story builder, 2026-10-17). Written so that reading it back
// (parse.ts) gives every act, chapter and scene the same key, which is what lets one suggestion be swapped for a new
// version while Adam's decisions and changes on the others stay where they are. No React, so it is unit-tested.

import { emptySuggestedCard, parseOutline, preambleOf, type ParsedOutline, type SuggestedAct, type SuggestedCard, type SuggestedChapter, type SuggestedScene } from './parse'
import type { Decisions, Edits, NodeKind } from './tree'

const flat = (s: string): string => s.replace(/\s+/g, ' ').trim()

function cardLines(card: SuggestedCard, withWhen: boolean): string[] {
  const out: string[] = []
  if (flat(card.pov)) out.push(`Point of view: ${flat(card.pov)}`)
  const chars = card.characters.map(flat).filter(Boolean)
  if (chars.length) out.push(`Characters: ${chars.join(', ')}`)
  if (flat(card.location)) out.push(`Location: ${flat(card.location)}`)
  if (withWhen && flat(card.when)) out.push(`When: ${flat(card.when)}`)
  if (flat(card.mood)) out.push(`Mood: ${flat(card.mood)}`)
  return out
}

interface Options {
  /** Adam's own words for a suggestion, in place of the AI's. */
  edits?: Edits
  /** Left out (with what it holds). */
  skip?: (key: string) => boolean
}

export function sceneText(s: SuggestedScene, o: Options = {}): string {
  const e = o.edits?.[s.key]
  const title = flat(e?.title ?? s.title) || 'Untitled scene'
  const when = flat(e?.when ?? s.when)
  const summary = flat(e?.text ?? s.summary)
  const beats = (e?.beats ?? s.beats).map(flat).filter(Boolean)
  const lines = [`### Scene: ${title}`]
  if (when) lines.push(`When: ${when}`)
  if (summary) lines.push(`Summary: ${summary}`)
  lines.push(...cardLines(s.card ?? emptySuggestedCard(), false))
  if (s.setsUp?.length) lines.push(`Sets up: ${s.setsUp.join('; ')}`)
  if (s.paysOff?.length) lines.push(`Pays off: ${s.paysOff.join('; ')}`)
  for (const b of beats) lines.push(`- ${b}`)
  return lines.join('\n')
}

export function chapterText(c: SuggestedChapter, o: Options = {}): string {
  const e = o.edits?.[c.key]
  const title = flat(e?.title ?? c.title) || 'Untitled chapter'
  const goal = flat(e?.text ?? c.goal)
  const head = [`## Chapter: ${title}`]
  if (goal) head.push(`Goal: ${goal}`)
  head.push(...cardLines(c.card ?? emptySuggestedCard(), true))
  const scenes = c.scenes.filter((s) => !o.skip?.(s.key)).map((s) => sceneText(s, o))
  return [head.join('\n'), ...scenes].join('\n\n')
}

export function actText(a: SuggestedAct, o: Options = {}): string {
  const e = o.edits?.[a.key]
  const title = flat(e?.title ?? a.title) || 'Untitled act'
  const purpose = flat(e?.text ?? a.purpose)
  const head = [`# Act: ${title}`]
  if (purpose) head.push(`Purpose: ${purpose}`)
  const chapters = a.chapters.filter((c) => !o.skip?.(c.key)).map((c) => chapterText(c, o))
  return [head.join('\n'), ...chapters].join('\n\n')
}

/** A parsed outline in the outline form: its chapters before any act, then its acts. */
export function outlineText(p: ParsedOutline, o: Options = {}): string {
  const parts = [
    ...p.chapters.filter((c) => !o.skip?.(c.key)).map((c) => chapterText(c, o)),
    ...p.acts.filter((a) => !o.skip?.(a.key)).map((a) => actText(a, o))
  ]
  return parts.join('\n\n')
}

/**
 * The suggestions still waiting for a decision, with Adam's changes, for talking them over: what was discarded is left
 * out, and so is what was kept, unless something inside it is still waiting (then it stays, as the place they go).
 */
export function openText(text: string, decisions: Decisions, edits: Edits): string {
  const p = parseOutline(text, true)
  const waiting = (key: string, inside: string[]): boolean => !decisions[key] || inside.some((k) => !decisions[k])
  const keysIn = (c: SuggestedChapter): string[] => c.scenes.map((s) => s.key)
  const skip = (key: string): boolean => {
    const d = decisions[key]
    if (d?.status === 'discarded') return true
    if (d?.status !== 'kept') return false
    const act = p.acts.find((a) => a.key === key)
    if (act) return !act.chapters.some((c) => waiting(c.key, keysIn(c)))
    const chapter = [...p.chapters, ...p.acts.flatMap((a) => a.chapters)].find((c) => c.key === key)
    if (chapter) return !waiting(chapter.key, keysIn(chapter))
    return true
  }
  return outlineText(p, { edits, skip })
}

type Found = { kind: 'act'; node: SuggestedAct } | { kind: 'chapter'; node: SuggestedChapter } | { kind: 'scene'; node: SuggestedScene }

function find(p: ParsedOutline, key: string): Found | null {
  for (const a of p.acts) if (a.key === key) return { kind: 'act', node: a }
  for (const c of [...p.chapters, ...p.acts.flatMap((a) => a.chapters)]) {
    if (c.key === key) return { kind: 'chapter', node: c }
    for (const s of c.scenes) if (s.key === key) return { kind: 'scene', node: s }
  }
  return null
}

/** One suggestion (and what it holds) in the outline form, with Adam's changes, for doing it again; '' when it isn't there. */
export function nodeText(text: string, key: string, edits: Edits): string {
  const f = find(parseOutline(text, true), key)
  if (!f) return ''
  return f.kind === 'act' ? actText(f.node, { edits }) : f.kind === 'chapter' ? chapterText(f.node, { edits }) : sceneText(f.node, { edits })
}

/** The first act, chapter or scene of this kind in a reply, read as a whole one. */
export function firstOfKind(reply: string, kind: NodeKind): SuggestedAct | SuggestedChapter | SuggestedScene | null {
  const p = parseOutline(reply, true)
  if (kind === 'act') {
    if (p.acts[0]) return p.acts[0]
    // An act's chapters with no act heading: they are its chapters.
    const chapters = p.chapters
    return chapters.length ? { key: 'a0', title: '', purpose: '', chapters, complete: true } : null
  }
  const chapters = [...p.chapters, ...p.acts.flatMap((a) => a.chapters)]
  if (kind === 'chapter') return chapters.find((c) => c.title || c.scenes.length) ?? null
  return chapters.flatMap((c) => c.scenes)[0] ?? null
}

/**
 * The reply with one suggestion swapped for a new version (`fresh`, of the same kind): every other one, and anything
 * before the first heading (a premise), stays as it was, so their keys and Adam's decisions on them still hold.
 * Null when the suggestion isn't there any more.
 */
export function spliceText(text: string, key: string, fresh: SuggestedAct | SuggestedChapter | SuggestedScene): string | null {
  const p = parseOutline(text, true)
  const f = find(p, key)
  if (!f) return null
  if (f.kind === 'act') Object.assign(f.node, { title: (fresh as SuggestedAct).title || f.node.title, purpose: (fresh as SuggestedAct).purpose, chapters: (fresh as SuggestedAct).chapters })
  else if (f.kind === 'chapter') {
    const c = fresh as SuggestedChapter
    Object.assign(f.node, { title: c.title || f.node.title, goal: c.goal, card: c.card, scenes: c.scenes })
  } else {
    const s = fresh as SuggestedScene
    Object.assign(f.node, { title: s.title || f.node.title, summary: s.summary, beats: s.beats, when: s.when, card: s.card, setsUp: s.setsUp, paysOff: s.paysOff })
  }
  const lead = preambleOf(text)
  const body = outlineText(p)
  return lead ? `${lead}\n\n${body}` : body
}

const PLAN_LINE = /^[#*\s]*=*\s*revised plan\s*=*[*\s:]*$/im

/** A talk's answer and the revised plan after its line ("=== Revised plan ==="; null when it only answered). */
export function splitPlanAnswer(text: string): { answer: string; plan: string | null } {
  const m = PLAN_LINE.exec(text)
  if (!m) return { answer: text.trim(), plan: null }
  return { answer: text.slice(0, m.index).trim(), plan: text.slice(m.index + m[0].length).trim() || null }
}

/** The keys a suggestion holds (itself, and what is inside it), so its old decisions and changes can be cleared. */
export function keysUnder(key: string, all: string[]): string[] {
  return all.filter((k) => k === key || (k.startsWith(key) && /^[acs]/.test(k.slice(key.length))))
}
