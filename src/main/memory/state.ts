// What is true at a point: each entry's state, relationships, who knows what, plot threads and
// which entries exist, worked out from baselines plus every change that counts on a Line.
// Pure functions, so every rule is unit-tested.
//
// Order: the entry rows, then changes anchored 'baseline', then the walk's steps in order (a story's
// start-of-story changes at its 'start-changes' step, a scene's changes at its 'scene' step); changes
// at the same place by position, then creation time. A later change wins, except where a side story
// added whole and its host changed the same thing between the side story's start and end: the host
// wins unless Adam answered "Which happened last?" with the side story.
//
// The things that can clash ("aspects"), as used in the 'which-last' answer key
// `${sideStoryId}:${entryId}:${aspect}`: each field key ('hair'), 'description', 'summary',
// `rel:${otherEntryId}` for a relationship (either side's key counts), and 'thread' for a plot
// thread. Knowledge only ever adds, so it never clashes.
//
// Readings chosen where the rules are silent (each is tested):
// - A full description keeps the entry's list of what happened; it replaces the description (and
//   any summary and fields it gives), what the entry knows and its relationships, as the rules say.
// - An entry with no first-exists points at all counts as part of the starting setup, so a damaged
//   or half-made entry is never silently dropped from every briefing.
// - A first-exists point at a deleted scene counts just after the place before it (ExistsAt.after),
//   as the rules say for a start point after a deleted scene, so the entry doesn't vanish.
// - When a clash is settled for the host, the value the thing had just before the side story was
//   added comes back (the host's, or a side story's that ended later in the host).
// - A plot thread is set up where it was first opened on the walk; with no opening change before it
//   was first resolved, where it first exists ('' for the starting setup). It is paid off where it was
//   last resolved, and a later opening change reopens it.

import type { Change, EntryState, FactState, ID, RelationshipPayload, RelationshipState, ThreadState } from '@shared/types'
import type { Line, MemoryData, MemoryState, WorldShape } from './types'
import { hostSpans, labeler } from './line'

/** MemoryState, plus every entry that doesn't exist here, as of this point (for "not in the story yet" labels). */
export interface MemoryStateAll extends MemoryState {
  absent: Map<ID, EntryState>
}

const byPlace = (a: Change, b: Change): number =>
  a.position - b.position || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)

/** Changes by where they are pinned, each list in order. */
export interface ChangeIndex {
  baseline: Change[]
  byStory: Map<ID, Change[]>
  byScene: Map<ID, Change[]>
}

export function indexChanges(changes: Change[]): ChangeIndex {
  const ix: ChangeIndex = { baseline: [], byStory: new Map(), byScene: new Map() }
  const push = (map: Map<ID, Change[]>, id: ID, c: Change): void => {
    const list = map.get(id)
    if (list) list.push(c)
    else map.set(id, [c])
  }
  for (const c of changes) {
    if (c.anchor === 'baseline') ix.baseline.push(c)
    else if (c.anchor === 'story-start' && c.storyId) push(ix.byStory, c.storyId, c)
    else if (c.anchor === 'scene' && c.sceneId) push(ix.byScene, c.sceneId, c)
  }
  ix.baseline.sort(byPlace)
  for (const list of ix.byStory.values()) list.sort(byPlace)
  for (const list of ix.byScene.values()) list.sort(byPlace)
  return ix
}

const pairKey = (a: ID, b: ID): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** The aspects a change sets, as `${entryId}|${aspect}` (a full description touches every relationship: `rel:*`). */
function aspectsOf(c: Change): string[] {
  const e = c.entryId
  switch (c.kind) {
    case 'update': {
      const p = c.payload
      const out = Object.keys(p.fields ?? {}).map((k) => `${e}|${k}`)
      if (p.description !== undefined) out.push(`${e}|description`)
      if (p.summary !== undefined) out.push(`${e}|summary`)
      return out
    }
    case 'full': {
      const p = c.payload
      const out = [`${e}|description`, `${e}|rel:*`, ...Object.keys(p.fields ?? {}).map((k) => `${e}|${k}`)]
      if (p.summary !== undefined) out.push(`${e}|summary`)
      return out
    }
    case 'relationship':
      return c.payload.otherId ? [`${e}|rel:${c.payload.otherId}`, `${c.payload.otherId}|rel:${e}`] : []
    case 'thread':
      return [`${e}|thread`]
    case 'knowledge':
      return []
  }
}

/** The 'which-last' answer key for a side story, an entry and an aspect. */
export const whichLastKey = (sideStoryId: ID, entryId: ID, aspect: string): string => `${sideStoryId}:${entryId}:${aspect}`

interface Touched {
  entryId: ID
  aspect: string
  /** For a relationship: the other entry. */
  otherId: ID | null
  restore: () => void
}

/** One side story being added whole: what it changed, and what its host changed while it ran. */
interface Frame {
  storyId: ID
  hostAspects: Set<string>
  touched: Map<string, Touched>
}

interface ThreadWork {
  status: 'open' | 'resolved'
  /** Where it was first opened; null before that; FROM_EXISTS when it was resolved before ever being opened. */
  setUp: string | null
  paidOff: string
}
const FROM_EXISTS = '\u0000exists'

/** Applies every change that counts on the line, in line order, to the baselines. */
export function stateAt(
  data: MemoryData,
  shape: WorldShape,
  line: Line,
  changes: ChangeIndex = indexChanges(data.changes)
): MemoryStateAll {
  const label = labeler(shape)
  const spanOf = hostSpans(shape)
  const titles = new Map(shape.stories.map((s) => [s.id, s.title]))
  const segOf = new Map(line.segments.map((s) => [s.storyId, s]))
  const answers = new Set(data.answers.filter((a) => a.kind === 'which-last' && a.value === 'side').map((a) => a.key))

  const states = new Map<ID, EntryState>()
  for (const e of data.entries) states.set(e.id, { ...e, fields: { ...e.fields }, happened: [], changed: [] })
  const rels = new Map<string, RelationshipState>()
  const knows = new Map<ID, Set<ID>>()
  const factText = new Map<ID, string>()
  const threads = new Map<ID, ThreadWork>()

  // ----- The clash rule: remember what each side story added whole changes, and settle clashes when it ends -----
  const frames: Frame[] = []
  const touch = (key: string, entryId: ID, aspect: string, otherId: ID | null, restore: () => void): void => {
    for (const f of frames) if (!f.touched.has(key)) f.touched.set(key, { entryId, aspect, otherId, restore })
  }
  /** Puts back where a value was last set (changedWhere) as it is now, when the host wins a clash. */
  const whereBack = (e: EntryState, k: string): (() => void) => {
    const had = !!e.changedWhere && Object.prototype.hasOwnProperty.call(e.changedWhere, k)
    const was = e.changedWhere?.[k]
    return () => {
      if (had && was !== undefined) (e.changedWhere ??= {})[k] = was
      else if (e.changedWhere) delete e.changedWhere[k]
    }
  }
  const touchValue = <K extends 'description' | 'summary'>(e: EntryState, k: K): void => {
    if (!frames.length) return
    const was = e[k]
    const where = whereBack(e, k)
    touch(`${e.id}|${k}`, e.id, k, null, () => {
      e[k] = was
      where()
    })
  }
  const touchField = (e: EntryState, k: string): void => {
    if (!frames.length) return
    const had = Object.prototype.hasOwnProperty.call(e.fields, k)
    const was = e.fields[k]
    const where = whereBack(e, k)
    touch(`${e.id}|${k}`, e.id, k, null, () => {
      if (had) e.fields[k] = was
      else delete e.fields[k]
      where()
    })
  }
  const touchRel = (a: ID, b: ID): void => {
    if (!frames.length) return
    const pk = pairKey(a, b)
    const was = rels.get(pk)
    touch(`rel|${pk}`, a, `rel:${b}`, b, () => {
      if (was) rels.set(pk, was)
      else rels.delete(pk)
    })
  }
  const touchThread = (id: ID): void => {
    if (!frames.length) return
    const was = threads.get(id)
    touch(`${id}|thread`, id, 'thread', null, () => {
      if (was) threads.set(id, was)
      else threads.delete(id)
    })
  }
  const openFrame = (storyId: ID): void => {
    const span = spanOf(storyId)
    const hostAspects = new Set<string>()
    if (span) {
      const host = [
        ...(span.startChanges ? (changes.byStory.get(span.hostId) ?? []) : []),
        ...span.sceneIds.flatMap((id) => changes.byScene.get(id) ?? [])
      ]
      for (const c of host) for (const a of aspectsOf(c)) hostAspects.add(a)
    }
    frames.push({ storyId, hostAspects, touched: new Map() })
  }
  const closeFrame = (): void => {
    const f = frames.pop()!
    const sideSaid = (entryId: ID, aspect: string): boolean => answers.has(whichLastKey(f.storyId, entryId, aspect))
    for (const t of f.touched.values()) {
      if (t.otherId) {
        const [a, b] = [t.entryId, t.otherId]
        const clash = f.hostAspects.has(`${a}|rel:${b}`) || f.hostAspects.has(`${a}|rel:*`) || f.hostAspects.has(`${b}|rel:*`)
        if (clash && !sideSaid(a, `rel:${b}`) && !sideSaid(b, `rel:${a}`)) t.restore()
      } else if (f.hostAspects.has(`${t.entryId}|${t.aspect}`) && !sideSaid(t.entryId, t.aspect)) t.restore()
    }
  }
  /** The side stories (added whole) a step's story sits inside, outermost first. */
  const sideAncestry = (storyId: ID): ID[] => {
    const out: ID[] = []
    const seen = new Set<ID>()
    let seg = segOf.get(storyId)
    while (seg && seg.via === 'side' && !seen.has(seg.storyId)) {
      seen.add(seg.storyId)
      out.unshift(seg.storyId)
      seg = seg.addedIn ? segOf.get(seg.addedIn) : undefined
    }
    return out
  }

  // ----- Applying changes -----
  /** Where on the walk the change being applied sits (a step index; -1 for the baseline), so views can order history. */
  let at = -1
  const addChanged = (e: EntryState, k: string, where = ''): void => {
    if (!e.changed.includes(k)) e.changed.push(k)
    // Since when it holds, for the writer's "must stay true" list; the starting setup has no place.
    if (where) (e.changedWhere ??= {})[k] = where
    else if (e.changedWhere) delete e.changedWhere[k]
  }
  const learn = (entryId: ID, factId: ID, fact: string | undefined): void => {
    if (!factId) return
    let set = knows.get(entryId)
    if (!set) knows.set(entryId, (set = new Set()))
    set.add(factId)
    if (fact) factText.set(factId, fact)
    else if (!factText.has(factId)) factText.set(factId, '')
  }
  const setRel = (a: ID, p: RelationshipPayload, where: string): void => {
    const b = p.otherId
    if (!b || b === a) return
    touchRel(a, b)
    const pk = pairKey(a, b)
    if (p.ended) rels.delete(pk)
    else rels.set(pk, { aId: a, bId: b, type: p.type ?? '', aFeels: p.feels ?? '', bFeels: p.otherFeels ?? '', where, at })
  }
  const apply = (c: Change, where: string): void => {
    const e = states.get(c.entryId)
    if (!e) return
    switch (c.kind) {
      case 'update': {
        const p = c.payload
        if (p.note) e.happened.push({ note: p.note, where, changeId: c.id, at })
        for (const [k, v] of Object.entries(p.fields ?? {})) {
          touchField(e, k)
          e.fields[k] = v
          addChanged(e, k, where)
        }
        if (p.description !== undefined) {
          touchValue(e, 'description')
          e.description = p.description
          addChanged(e, 'description', where)
        }
        if (p.summary !== undefined) {
          touchValue(e, 'summary')
          e.summary = p.summary
          addChanged(e, 'summary', where)
        }
        break
      }
      case 'full': {
        const p = c.payload
        touchValue(e, 'description')
        e.description = p.description ?? ''
        addChanged(e, 'description', where)
        if (p.summary !== undefined) {
          touchValue(e, 'summary')
          e.summary = p.summary
          addChanged(e, 'summary', where)
        }
        for (const [k, v] of Object.entries(p.fields ?? {})) {
          touchField(e, k)
          e.fields[k] = v
          addChanged(e, k, where)
        }
        // What it knows and its relationships (on both sides) start again from this description.
        knows.delete(e.id)
        for (const [pk, r] of rels) {
          if (r.aId !== e.id && r.bId !== e.id) continue
          touchRel(r.aId, r.bId)
          rels.delete(pk)
        }
        for (const k of p.knows ?? []) learn(e.id, k.factId, k.fact)
        for (const r of p.relationships ?? []) setRel(e.id, r, where)
        break
      }
      case 'relationship':
        setRel(e.id, c.payload, where)
        break
      case 'knowledge': {
        const p = c.payload
        if (p.forgets) knows.get(e.id)?.delete(p.factId)
        else learn(e.id, p.factId, p.fact)
        break
      }
      case 'thread': {
        const p = c.payload
        touchThread(e.id)
        const was = threads.get(e.id) ?? { status: 'open', setUp: null, paidOff: '' }
        threads.set(
          e.id,
          p.status === 'resolved'
            ? { status: 'resolved', setUp: was.setUp ?? FROM_EXISTS, paidOff: where }
            : { status: 'open', setUp: was.setUp ?? where, paidOff: '' }
        )
        if (p.note) e.happened.push({ note: p.note, where, changeId: c.id, at })
        break
      }
    }
  }

  for (const c of changes.baseline) apply(c, '')

  // Where the walk reached each story's start, its start-of-story changes and each scene (step index).
  const prePos = new Map<ID, number>()
  const postPos = new Map<ID, number>()
  const scenePos = new Map<ID, number>()
  const chapterEndPos = new Map<ID, number>()
  line.steps.forEach((step, i) => {
    if (step.type === 'chapter-end') chapterEndPos.set(step.chapterId, i)
    const inside = sideAncestry(step.storyId)
    while (frames.length && !inside.includes(frames[frames.length - 1].storyId)) closeFrame()
    for (const id of inside) if (!frames.some((f) => f.storyId === id)) openFrame(id)
    if (step.type === 'start') prePos.set(step.storyId, i)
    else if (step.type === 'start-changes') {
      postPos.set(step.storyId, i)
      at = i
      const where = `the start of ${titles.get(step.storyId) ?? ''}`
      for (const c of changes.byStory.get(step.storyId) ?? []) apply(c, where)
    } else if (step.type === 'scene') {
      scenePos.set(step.sceneId, i)
      at = i
      const list = changes.byScene.get(step.sceneId)
      if (list) {
        const where = label({ storyId: step.storyId, sceneId: step.sceneId })
        for (const c of list) apply(c, where)
      }
    }
  })
  while (frames.length) closeFrame()

  // ----- Which entries exist here -----
  const target = 'before' in line.target ? line.target.before : null
  const here = line.steps.length
  const pointsOf = new Map<ID, MemoryData['exists']>()
  for (const p of data.exists) {
    const list = pointsOf.get(p.entryId)
    if (list) list.push(p)
    else pointsOf.set(p.entryId, [p])
  }
  /** The earliest point on the walk where an entry exists (-1 for the starting setup), with where in plain words; null if none. */
  const firstExists = (id: ID): { pos: number; where: string } | null => {
    const points = pointsOf.get(id)
    if (!points?.length) return { pos: -1, where: '' }
    let best: { pos: number; where: string } | null = null
    for (const p of points) {
      let pos: number | undefined
      let where = ''
      if (p.kind === 'world') pos = -1
      else if (p.kind === 'story-pre' && p.storyId) pos = prePos.get(p.storyId)
      else if (p.kind === 'story-post' && p.storyId) pos = postPos.get(p.storyId)
      else if (p.kind === 'scene' && p.after) {
        // A deleted scene: just after the place before it, so never "first here".
        const { at, refId } = p.after
        pos =
          at === 'post'
            ? p.storyId
              ? postPos.get(p.storyId)
              : undefined
            : refId
              ? (at === 'chapter' ? chapterEndPos : scenePos).get(refId)
              : undefined
      } else if (p.kind === 'scene' && p.sceneId) pos = p.sceneId === target ? here : scenePos.get(p.sceneId)
      if (pos === undefined || (best && best.pos <= pos)) continue
      if (p.kind === 'scene') where = label({ storyId: p.storyId, sceneId: p.sceneId })
      else if (p.kind !== 'world') where = `the start of ${titles.get(p.storyId!) ?? ''}`
      best = { pos, where }
    }
    return best
  }

  const entries = new Map<ID, EntryState>()
  const absent = new Map<ID, EntryState>()
  const firstHere = new Set<ID>()
  const existsAt = new Map<ID, string>()
  for (const [id, e] of states) {
    const at = firstExists(id)
    if (!at) {
      absent.set(id, e)
      continue
    }
    entries.set(id, e)
    existsAt.set(id, at.where)
    if (at.pos === here) firstHere.add(id)
  }

  const relationships = [...rels.values()].filter((r) => entries.has(r.aId) && entries.has(r.bId))

  const facts = new Map<ID, FactState>()
  for (const id of entries.keys()) {
    for (const factId of knows.get(id) ?? []) {
      let f = facts.get(factId)
      if (!f) facts.set(factId, (f = { factId, fact: factText.get(factId) ?? '', knownBy: [] }))
      f.knownBy.push(id)
    }
  }

  const threadStates: ThreadState[] = []
  for (const [id, e] of entries) {
    const t = threads.get(id)
    if (e.kind !== 'thread' && !t) continue
    threadStates.push({
      entryId: id,
      status: t?.status ?? 'open',
      setUp: t && t.setUp !== null && t.setUp !== FROM_EXISTS ? t.setUp : (existsAt.get(id) ?? ''),
      paidOff: t?.status === 'resolved' ? t.paidOff : ''
    })
  }

  return { entries, firstHere, relationships, facts: [...facts.values()], threads: threadStates, absent }
}

/** Changes pinned to a scene (never facts while drafting that scene). */
export function changesInScene(data: MemoryData, sceneId: ID): Change[] {
  return data.changes.filter((c) => c.anchor === 'scene' && c.sceneId === sceneId).sort(byPlace)
}

/**
 * Where a side story and its host both change the same thing between the side story's start and end
 * (for the "Which happened last?" question): each entry and aspect, and what Adam answered, if anything.
 */
export function sideClashes(
  data: MemoryData,
  shape: WorldShape,
  sideStoryId: ID
): { entryId: ID; aspect: string; answer: 'host' | 'side' | null }[] {
  const span = hostSpans(shape)(sideStoryId)
  const side = shape.stories.find((s) => s.id === sideStoryId)
  if (!span || !side) return []
  const ix = indexChanges(data.changes)
  const hostChanges = [
    ...(span.startChanges ? (ix.byStory.get(span.hostId) ?? []) : []),
    ...span.sceneIds.flatMap((id) => ix.byScene.get(id) ?? [])
  ]
  const host = new Set(hostChanges.flatMap(aspectsOf))
  const sideChanges = [
    ...(ix.byStory.get(sideStoryId) ?? []),
    ...side.chapters.flatMap((c) => c.scenes.flatMap((s) => ix.byScene.get(s.id) ?? []))
  ]
  const out = new Map<string, { entryId: ID; aspect: string; answer: 'host' | 'side' | null }>()
  for (const c of sideChanges) {
    for (const key of aspectsOf(c)) {
      const [entryId, aspect] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]
      if (aspect === 'rel:*') continue
      const other = aspect.startsWith('rel:') ? aspect.slice(4) : null
      const clash = other
        ? host.has(key) || host.has(`${other}|rel:${entryId}`) || host.has(`${entryId}|rel:*`) || host.has(`${other}|rel:*`)
        : host.has(key)
      if (!clash || (other && out.has(`${other}|rel:${entryId}`))) continue
      const answer = data.answers.find((a) => a.kind === 'which-last' && a.key === whichLastKey(sideStoryId, entryId, aspect))?.value
      out.set(key, { entryId, aspect, answer: answer === 'side' || answer === 'host' ? answer : null })
    }
  }
  return [...out.values()]
}
