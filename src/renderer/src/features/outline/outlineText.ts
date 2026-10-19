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
  /** Each heading ends with its key ("[#a0c1s2]"), so a talk's answer can say which one it changed. */
  tag?: boolean
}

const tagged = (key: string, o: Options): string => (o.tag ? ` [#${key}]` : '')

export function sceneText(s: SuggestedScene, o: Options = {}): string {
  const e = o.edits?.[s.key]
  const title = flat(e?.title ?? s.title) || 'Untitled scene'
  const when = flat(e?.when ?? s.when)
  const summary = flat(e?.text ?? s.summary)
  const beats = (e?.beats ?? s.beats).map(flat).filter(Boolean)
  const setsUp = (e?.setsUp ?? s.setsUp ?? []).map(flat).filter(Boolean)
  const paysOff = (e?.paysOff ?? s.paysOff ?? []).map(flat).filter(Boolean)
  const lines = [`### Scene: ${title}${tagged(s.key, o)}`]
  if (when) lines.push(`When: ${when}`)
  if (summary) lines.push(`Summary: ${summary}`)
  lines.push(...cardLines(e?.card ?? s.card ?? emptySuggestedCard(), false))
  if (setsUp.length) lines.push(`Sets up: ${setsUp.join('; ')}`)
  if (paysOff.length) lines.push(`Pays off: ${paysOff.join('; ')}`)
  for (const b of beats) lines.push(`- ${b}`)
  return lines.join('\n')
}

export function chapterText(c: SuggestedChapter, o: Options = {}): string {
  const e = o.edits?.[c.key]
  const title = flat(e?.title ?? c.title) || 'Untitled chapter'
  const goal = flat(e?.text ?? c.goal)
  const head = [`## Chapter: ${title}${tagged(c.key, o)}`]
  if (goal) head.push(`Goal: ${goal}`)
  head.push(...cardLines(e?.card ?? c.card ?? emptySuggestedCard(), true))
  const scenes = c.scenes.filter((s) => !o.skip?.(s.key)).map((s) => sceneText(s, o))
  return [head.join('\n'), ...scenes].join('\n\n')
}

export function actText(a: SuggestedAct, o: Options = {}): string {
  const e = o.edits?.[a.key]
  const title = flat(e?.title ?? a.title) || 'Untitled act'
  const purpose = flat(e?.text ?? a.purpose)
  const head = [`# Act: ${title}${tagged(a.key, o)}`]
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
 * Every act, chapter and scene of a parsed outline in reading order, with the key reading its outline form back
 * would give it (parse.ts: "c1", "a0", "a0c1", "a0c1s2"), whatever its own `key` says.
 */
export function walkKeyed(p: ParsedOutline, fn: (node: AnyNode, kind: NodeKind, key: string, parent: AnyNode | null) => void): void {
  const chapters = (list: SuggestedChapter[], prefix: string, parent: SuggestedAct | null): void =>
    list.forEach((c, i) => {
      const key = `${prefix}c${i}`
      fn(c, 'chapter', key, parent)
      c.scenes.forEach((s, j) => fn(s, 'scene', `${key}s${j}`, c))
    })
  chapters(p.chapters, '', null)
  p.acts.forEach((a, i) => {
    fn(a, 'act', `a${i}`, null)
    chapters(a.chapters, `a${i}`, a)
  })
}

/**
 * The suggestions still waiting for a decision, as a parsed outline (its parts keep their own keys): what was discarded
 * is left out, and so is what was kept, unless something inside it is still waiting (then it stays, as the place they go).
 */
function openOutline(text: string, decisions: Decisions): ParsedOutline {
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
  const chapters = (list: SuggestedChapter[]): SuggestedChapter[] =>
    list.filter((c) => !skip(c.key)).map((c) => ({ ...c, scenes: c.scenes.filter((s) => !skip(s.key)) }))
  return { chapters: chapters(p.chapters), acts: p.acts.filter((a) => !skip(a.key)).map((a) => ({ ...a, chapters: chapters(a.chapters) })) }
}

/** The suggestions still waiting for a decision, with Adam's changes, for talking them over (see openOutline). */
export function openText(text: string, decisions: Decisions, edits: Edits): string {
  return outlineText(openOutline(text, decisions), { edits })
}

/**
 * Where each part of openText's form is among the suggestions (2026-10-19): the key reading it back gives, to its key
 * in the suggestions themselves. A talk's revision goes by it, so what was kept stays kept and Adam's changes stay his.
 */
export function openKeys(text: string, decisions: Decisions): Record<string, string> {
  const out: Record<string, string> = {}
  walkKeyed(openOutline(text, decisions), (node, _kind, key) => {
    out[key] = node.key
  })
  return out
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
const CHANGES_LINE = /^[#*\s]*=*\s*(?:changes|changed parts|plan changes)\s*=*[*\s:]*$/im

/** A talk's answer and the revised plan after its line ("=== Revised plan ==="; null when it only answered). */
export function splitPlanAnswer(text: string): { answer: string; plan: string | null } {
  const m = PLAN_LINE.exec(text)
  if (!m) return { answer: text.trim(), plan: null }
  return { answer: text.slice(0, m.index).trim(), plan: text.slice(m.index + m[0].length).trim() || null }
}

/**
 * A talk's answer, and what came after its line: only the changed parts ("=== Changes ===", the usual way), or the
 * whole plan again ("=== Revised plan ===", for a big rework). Both null when it only answered.
 */
export function splitPlanReply(text: string): { answer: string; changes: string | null; plan: string | null } {
  const c = CHANGES_LINE.exec(text)
  const p = PLAN_LINE.exec(text)
  if (c && (!p || c.index <= p.index)) return { answer: text.slice(0, c.index).trim(), changes: text.slice(c.index + c[0].length).trim() || null, plan: null }
  const { answer, plan } = splitPlanAnswer(text)
  return { answer, changes: null, plan }
}

const TAG = /[ \t]*\[[ \t]*(?:(new)(?:[ \t]+after[ \t]+#[ \t]*([acs0-9]+))?|#[ \t]*([acs0-9]+))[ \t]*\][ \t]*:?/i
const TAGS = new RegExp(TAG.source, 'gi')

/** A heading's title without its tag, and what the tag says: the one it changes, or where a new one goes. */
function tagOf(title: string): { title: string; key: string | null; after: string | null } {
  const m = TAG.exec(title)
  if (!m) return { title, key: null, after: null }
  const rest = `${title.slice(0, m.index)} ${title.slice(m.index + m[0].length)}`.replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').replace(/\s+/g, ' ')
  return { title: rest, key: m[3]?.toLowerCase() ?? null, after: m[2]?.toLowerCase() ?? null }
}

/** The plan's tags taken out (a whole revised plan may keep them). */
export const stripTags = (text: string): string => text.replace(TAGS, '')

/** The suggestions with each heading tagged with its key, for talking them over (see applyPlanChanges). */
export const taggedText = (current: string): string => outlineText(parseOutline(current, true), { tag: true })

type AnyNode = SuggestedAct | SuggestedChapter | SuggestedScene
type Place = { kind: NodeKind; node: AnyNode; list: AnyNode[]; chapter?: SuggestedChapter }

function locate(p: ParsedOutline, key: string): Place | null {
  const act = p.acts.find((a) => a.key === key)
  if (act) return { kind: 'act', node: act, list: p.acts }
  for (const list of [p.chapters, ...p.acts.map((a) => a.chapters)])
    for (const c of list) {
      if (c.key === key) return { kind: 'chapter', node: c, list }
      const s = c.scenes.find((x) => x.key === key)
      if (s) return { kind: 'scene', node: s, list: c.scenes, chapter: c }
    }
  return null
}

const keep = (next: string, was: string): string => (next.trim() ? next : was)
const mergeCard = (was: SuggestedCard, next: SuggestedCard): SuggestedCard => ({
  pov: keep(next.pov, was.pov),
  characters: next.characters.length ? next.characters : was.characters,
  location: keep(next.location, was.location),
  when: keep(next.when, was.when),
  mood: keep(next.mood, was.mood)
})

/** A chapter the reader made up to hold scenes given with no chapter heading. */
const holder = (c: SuggestedChapter): boolean => {
  const t = tagOf(c.title)
  return !t.key && !t.after && !c.goal && /^Chapter \d+$/.test(c.title) && !c.card.pov && !c.card.location && !c.card.mood && !c.card.characters.length
}

function untag<T extends AnyNode>(n: T): T {
  const title = tagOf(n.title).title
  if ('chapters' in n) return { ...n, title, chapters: n.chapters.map(untag) }
  if ('scenes' in n) return { ...n, title, scenes: n.scenes.map(untag) }
  return { ...n, title }
}

const TOUCHES = /^\W*touches\b\s*:?(.*)$/im
const TAG_REFS = /#\s*([acs][acs0-9]*)/gi

/** The tags a reply's "Touches:" line lists: every part it said has to change for what was asked. */
export function touchesOf(text: string): string[] {
  const m = TOUCHES.exec(text)
  return m ? [...new Set([...m[1].matchAll(TAG_REFS)].map((x) => x[1].toLowerCase()))] : []
}

/** The title of the part a tag names in the suggestions, for asking the AI about it again ('' when it isn't there). */
export function titleOfTag(current: string, key: string): string {
  return locate(parseOutline(current, true), key)?.node.title ?? ''
}

/** One part a talk's changes made: new, changed (with how it was) or taken out; `where`: the title of what holds it. */
export interface PlanChange {
  kind: NodeKind
  mark: 'new' | 'changed' | 'removed'
  where: string
  before: AnyNode | null
  after: AnyNode | null
}

/** A part's own words, without what it holds: the same means a part given only to hold changed ones didn't change. */
function own(kind: NodeKind, n: AnyNode): string {
  const card = (c?: SuggestedCard): string => (c ? [c.pov, c.characters.join(','), c.location, c.when, c.mood].join('|') : '')
  if (kind === 'scene') {
    const s = n as SuggestedScene
    return [s.title, s.summary, s.when, s.beats.join('|'), card(s.card), (s.setsUp ?? []).join('|'), (s.paysOff ?? []).join('|')].join('\u0001')
  }
  if (kind === 'chapter') {
    const c = n as SuggestedChapter
    return [c.title, c.goal, card(c.card)].join('\u0001')
  }
  const a = n as SuggestedAct
  return [a.title, a.purpose].join('\u0001')
}

/**
 * Puts a talk's changes into the suggestions (`current`, as sent, untagged): each part given with its tag ("[#c1s2]")
 * takes that part's place, keeping what it leaves out (an act or chapter given without some of its scenes keeps them);
 * one tagged "[new after #c1s2]" goes after that one (or first inside it, when it is the one above); "Remove: #c1s2"
 * takes one out. `done`: the tags it changed or took out. Null when nothing in it could be used.
 */
export function applyPlanChanges(current: string, changes: string): (PlanChanges & { lost: number; done: Set<string>; changes: PlanChange[] }) | null {
  const base = parseOutline(current, true)
  // Each part as it was, so what it became can be told apart from what is new, and what changed from what didn't.
  const before = new Map<AnyNode, { key: string; own: string }>()
  walkKeyed(base, (node, kind, key) => before.set(node, { key, own: own(kind, node) }))
  const removes = new Set<string>()
  const lines: string[] = []
  for (const line of changes.split(/\r?\n/)) {
    if (/^\W*touches\b/i.test(line)) continue
    if (/^\W*(remove|removed|delete|cut)\b/i.test(line) && /#\s*[acs]\d/i.test(line)) {
      for (const m of line.matchAll(TAG_REFS)) removes.add(m[1].toLowerCase())
    } else lines.push(line)
  }
  const reply = parseOutline(lines.join('\n'), true)
  let count = 0
  let lost = 0
  const done = new Set<string>()
  const edited = new Map<string, PlanChange>()
  const made: PlanChange[] = []
  const whereOf = (at: Place): string => {
    if (at.kind === 'scene') return at.chapter?.title ?? ''
    if (at.kind === 'chapter') return base.acts.find((a) => a.chapters.includes(at.node as SuggestedChapter))?.title ?? ''
    return ''
  }
  type Home = { list: AnyNode[]; at: number; owner: string }

  /** Puts a new one after the part `after` names; the title of what now holds it, or null when it can't go there. */
  const insertAfter = (kind: NodeKind, fresh: AnyNode, after: string, home: Home | null): string | null => {
    const at = locate(base, after)
    if (!at) return null
    if (at.kind === kind) {
      const i = at.list.indexOf(at.node) + 1
      at.list.splice(i, 0, fresh)
      if (home?.list === at.list) home.at = i + 1
      return whereOf(at)
    }
    if (kind === 'scene' && at.kind === 'chapter') {
      ;(at.node as SuggestedChapter).scenes.unshift(fresh as SuggestedScene)
      return at.node.title
    }
    if (kind === 'chapter' && at.kind === 'act') {
      ;(at.node as SuggestedAct).chapters.unshift(fresh as SuggestedChapter)
      return at.node.title
    }
    if (kind === 'chapter' && at.kind === 'scene' && at.chapter) return insertAfter(kind, fresh, at.chapter.key, home)
    return null
  }

  const children = (kind: NodeKind, was: AnyNode, next: AnyNode): void => {
    if (kind === 'act') {
      const list = (was as SuggestedAct).chapters
      const home: Home = { list, at: list.length, owner: was.title }
      for (const c of (next as SuggestedAct).chapters) handle('chapter', c, home)
    } else if (kind === 'chapter') {
      const list = (was as SuggestedChapter).scenes
      const home: Home = { list, at: list.length, owner: was.title }
      for (const s of (next as SuggestedChapter).scenes) handle('scene', s, home)
    }
  }

  const edit = (kind: NodeKind, was: AnyNode, next: AnyNode): void => {
    const title = keep(tagOf(next.title).title, was.title)
    if (kind === 'scene') {
      const w = was as SuggestedScene
      const n = next as SuggestedScene
      Object.assign(w, {
        title,
        summary: keep(n.summary, w.summary),
        when: keep(n.when, w.when),
        beats: n.beats.length ? n.beats : w.beats,
        card: mergeCard(w.card, n.card),
        setsUp: n.setsUp ?? w.setsUp,
        paysOff: n.paysOff ?? w.paysOff
      })
    } else if (kind === 'chapter') {
      const w = was as SuggestedChapter
      const n = next as SuggestedChapter
      Object.assign(w, { title, goal: keep(n.goal, w.goal), card: mergeCard(w.card, n.card) })
    } else {
      const w = was as SuggestedAct
      Object.assign(w, { title, purpose: keep((next as SuggestedAct).purpose, w.purpose) })
    }
    children(kind, was, next)
  }

  function handle(kind: NodeKind, next: AnyNode, home: Home | null): void {
    if (kind === 'chapter' && holder(next as SuggestedChapter)) {
      for (const s of (next as SuggestedChapter).scenes) handle('scene', s, null)
      return
    }
    const t = tagOf(next.title)
    if (t.key) {
      const at = locate(base, t.key)
      if (!at || at.kind !== kind) {
        lost++
        return
      }
      if (!edited.has(t.key)) edited.set(t.key, { kind, mark: 'changed', where: whereOf(at), before: structuredClone(at.node), after: at.node })
      edit(kind, at.node, next)
      if (home?.list === at.list) home.at = at.list.indexOf(at.node) + 1
      done.add(t.key)
      count++
      return
    }
    const fresh = untag(next)
    let where: string | null = null
    if (t.after) where = insertAfter(kind, fresh, t.after, home)
    else if (home) {
      home.list.splice(home.at++, 0, fresh)
      where = home.owner
    }
    if (where === null) {
      lost++
      return
    }
    made.push({ kind, mark: 'new', where, before: null, after: fresh })
    count++
  }

  for (const c of reply.chapters) handle('chapter', c, null)
  for (const a of reply.acts) handle('act', a, null)
  for (const key of removes) {
    const at = locate(base, key)
    if (!at) continue
    made.push({ kind: at.kind, mark: 'removed', where: whereOf(at), before: structuredClone(at.node), after: null })
    at.list.splice(at.list.indexOf(at.node), 1)
    done.add(key)
    count++
  }
  if (!count) return null
  // A part given only to hold changed ones, its own words the same, isn't one of the changes.
  const changed = [...edited.values()].filter((c) => c.before && c.after && own(c.kind, c.before) !== own(c.kind, c.after))
  const origin: Record<string, string> = {}
  const touched: string[] = []
  walkKeyed(base, (node, kind, key) => {
    const was = before.get(node)
    if (was) origin[key] = was.key
    if (!was || was.own !== own(kind, node)) touched.push(key)
  })
  return { text: outlineText(base), lost, done, changes: [...changed, ...made], origin, changed: touched }
}

/**
 * A revised plan's parts against the plan it was made from (2026-10-19): `origin`, the part each one was (its key in the
 * revised plan, to its key in the plan sent); `changed`, the ones the talk changed or added (by their revised keys).
 */
export interface PlanChanges {
  text: string
  origin: Record<string, string>
  changed: string[]
}

const sameTitle = (a: string, b: string): boolean => flat(a).toLowerCase() === flat(b).toLowerCase()

/**
 * A whole plan sent again ("=== Revised plan ===", its headings perhaps still tagged) against the plan sent: each part
 * is the one its tag names, else the one with its title in the same place (the same act or chapter), else new.
 */
export function wholePlanChanges(current: string, plan: string): PlanChanges {
  const base = parseOutline(current, true)
  const reply = parseOutline(plan, true)
  const was = new Map<string, { node: AnyNode; kind: NodeKind; parent: string | null }>()
  walkKeyed(base, (node, kind, key, parent) => was.set(key, { node, kind, parent: parent?.key ?? null }))
  const origin: Record<string, string> = {}
  const used = new Set<string>()
  const changed: string[] = []
  const parentOf = new Map<AnyNode, string | null>()
  walkKeyed(reply, (node, kind, key, parent) => {
    const t = tagOf(node.title)
    const under = parent ? (parentOf.get(parent) ?? null) : null
    let from: string | null = null
    if (t.key && was.get(t.key)?.kind === kind && !used.has(t.key)) from = t.key
    else {
      for (const [k, w] of was)
        if (!used.has(k) && w.kind === kind && w.parent === under && sameTitle(w.node.title, t.title)) {
          from = k
          break
        }
    }
    parentOf.set(node, from)
    if (from) {
      used.add(from)
      origin[key] = from
    }
    if (!from || own(kind, untag(node)) !== own(kind, was.get(from)!.node)) changed.push(key)
  })
  return { text: stripTags(plan), origin, changed }
}

/** The keys a suggestion holds (itself, and what is inside it), so its old decisions and changes can be cleared. */
export function keysUnder(key: string, all: string[]): string[] {
  return all.filter((k) => k === key || (k.startsWith(key) && /^[acs]/.test(k.slice(key.length))))
}
