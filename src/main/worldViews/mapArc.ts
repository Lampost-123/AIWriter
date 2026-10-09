// The desk's relationship map (UI overhaul): the arc of every relationship between two characters along a story's
// line, each change to it in order, so the map can say since when two characters are tied, show a relationship's
// history across scenes and say what changed between one stop of the slider and the next. Pure: index.ts reads the
// world and passes it in. Tested in mapArc.test.ts.
//
// It reads the changes the way the memory does (memory/state.ts): a relationship change sets or ends one pair, and a
// full description of a character starts its relationships again (pairs it no longer lists end). The clash rule for a
// side story added whole is left out: the history says what the memory noted, in the order the line meets it.
import type { AsOfStop, Change, ID, RelationshipPayload } from '@shared/types'
import type { MapChangeNote, MapStopInfo, MapTieEvent, MapTieHistory } from '@shared/contracts/worldViews'
import type { Line, MemoryData, WorldShape } from '../memory/types'
import { walkOf, type Walk } from './walk'

const pairKey = (a: ID, b: ID): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Where on the line each stop is (a step index of the walk). */
export function stopSteps(stops: AsOfStop[], w: Walk): number[] {
  return stops.map((s) => {
    const at = s.at
    if (at.kind === 'scene') return w.scene.get(at.sceneId) ?? Infinity
    if (at.kind === 'start') return w.post.get(at.storyId) ?? w.start.get(at.storyId) ?? -1
    return w.end.get(at.storyId) ?? w.steps.length
  })
}

/** The first stop at or after a step (-1 for the starting setup: before any stop). */
function stopOf(step: number, steps: number[]): number {
  if (step < 0) return -1
  for (let i = 0; i < steps.length; i++) if (steps[i] >= step) return i
  return steps.length
}

/** Each stop's scene and chapter titles. */
export function stopTitles(stops: AsOfStop[], shape: WorldShape): MapStopInfo[] {
  const scenes = new Map<ID, MapStopInfo>()
  for (const s of shape.stories)
    for (const c of s.chapters) for (const sc of c.scenes) scenes.set(sc.id, { title: sc.title, chapterId: c.id, chapter: c.title })
  return stops.map((s) => (s.sceneId ? (scenes.get(s.sceneId) ?? { title: '', chapterId: null, chapter: '' }) : { title: '', chapterId: null, chapter: '' }))
}

/**
 * Every relationship between two characters along the line, with each change to it in the order the line meets them
 * (the starting setup first). `stops` are the slider's stops; each change is given the first stop that shows it.
 */
export function tieHistory(
  line: Line,
  data: MemoryData,
  stops: AsOfStop[],
  label: (place: { storyId: ID | null; sceneId?: ID | null }) => string
): MapTieHistory[] {
  const w = walkOf(line)
  const steps = stopSteps(stops, w)
  const kinds = new Map(data.entries.map((e) => [e.id, e.kind]))
  const isChar = (id: ID): boolean => kinds.get(id) === 'character'
  const scenes = new Set<ID>()
  const starts = new Set<ID>()
  for (const s of line.steps) {
    if (s.type === 'scene') scenes.add(s.sceneId)
    else if (s.type === 'start-changes') starts.add(s.storyId)
  }
  const placed: { c: Change; step: number }[] = []
  for (const c of data.changes) {
    if (c.kind !== 'relationship' && c.kind !== 'full') continue
    if (!isChar(c.entryId)) continue
    let step: number | undefined
    if (c.anchor === 'baseline') step = -1
    else if (c.anchor === 'story-start' && c.storyId && starts.has(c.storyId)) step = w.post.get(c.storyId)
    else if (c.anchor === 'scene' && c.sceneId && scenes.has(c.sceneId)) step = w.scene.get(c.sceneId)
    if (step === undefined) continue
    placed.push({ c, step })
  }
  placed.sort(
    (p, q) =>
      p.step - q.step || p.c.position - q.c.position || (p.c.createdAt < q.c.createdAt ? -1 : p.c.createdAt > q.c.createdAt ? 1 : 0)
  )

  const out = new Map<string, MapTieHistory>()
  const active = new Set<string>()
  const push = (a: ID, b: ID, e: MapTieEvent): void => {
    const key = pairKey(a, b)
    let h = out.get(key)
    if (!h) out.set(key, (h = { aId: a < b ? a : b, bId: a < b ? b : a, events: [] }))
    h.events.push(e)
  }
  for (const { c, step } of placed) {
    const where = step < 0 ? '' : c.anchor === 'scene' ? label({ storyId: c.storyId, sceneId: c.sceneId }) : label({ storyId: c.storyId })
    const stop = stopOf(step, steps)
    const sceneId = c.anchor === 'scene' ? c.sceneId : null
    const set = (x: ID, r: RelationshipPayload): void => {
      const y = r.otherId
      if (!y || y === x || !isChar(y)) return
      const key = pairKey(x, y)
      const [aFeels, bFeels] = x < y ? [r.feels ?? '', r.otherFeels ?? ''] : [r.otherFeels ?? '', r.feels ?? '']
      if (r.ended) {
        if (!active.has(key)) return
        active.delete(key)
        push(x, y, { stop, sceneId, where, type: (r.type ?? '').trim(), aFeels: aFeels.trim(), bFeels: bFeels.trim(), ended: true })
        return
      }
      active.add(key)
      push(x, y, { stop, sceneId, where, type: (r.type ?? '').trim(), aFeels: aFeels.trim(), bFeels: bFeels.trim(), ended: false })
    }
    if (c.kind === 'relationship') set(c.entryId, c.payload)
    else if (c.kind === 'full') {
      const listed = new Set((c.payload.relationships ?? []).map((r) => r.otherId))
      for (const key of [...active]) {
        const [a, b] = key.split('|')
        if (a !== c.entryId && b !== c.entryId) continue
        const other = a === c.entryId ? b : a
        if (listed.has(other)) continue
        active.delete(key)
        const last = out.get(key)?.events.at(-1)
        push(a, b, { stop, sceneId, where, type: last?.type ?? '', aFeels: '', bFeels: '', ended: true })
      }
      for (const r of c.payload.relationships ?? []) set(c.entryId, r)
    }
  }
  return [...out.values()].sort((p, q) => (p.aId < q.aId ? -1 : p.aId > q.aId ? 1 : p.bId < q.bId ? -1 : p.bId > q.bId ? 1 : 0))
}

/**
 * What changed at a stop, since the one before it: relationships that begin, change their words or end there. A
 * relationship set again with the same words and feelings is no change.
 */
export function changesAt(history: MapTieHistory[], stop: number): MapChangeNote[] {
  const out: MapChangeNote[] = []
  for (const h of history) {
    let before: MapTieEvent | null = null
    let now: MapTieEvent | null = null
    for (const e of h.events) {
      if (e.stop < stop) before = e.ended ? null : e
      else if (e.stop === stop) now = e
    }
    // The last word at this stop decides (two changes in one scene are one change).
    if (!now) continue
    const was = before
    if (now.ended) {
      if (was) out.push({ aId: h.aId, bId: h.bId, what: 'ended', type: was.type, before: was.type })
    } else if (!was) out.push({ aId: h.aId, bId: h.bId, what: 'new', type: now.type, before: '' })
    else if (was.type !== now.type || was.aFeels !== now.aFeels || was.bFeels !== now.bFeels)
      out.push({ aId: h.aId, bId: h.bId, what: 'changed', type: now.type, before: was.type })
  }
  return out
}
