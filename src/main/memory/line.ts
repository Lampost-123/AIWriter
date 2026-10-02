// The line: which stories, chapters and scenes come before a point, in order, following the
// spec's "Multi-story rules" tab. Pure functions over a WorldShape, so every rule is unit-tested
// (see the test world in tests/unit/testWorld*). Every question about "what came earlier" uses
// buildLine, including block 3's previous scene.
//
// How the walk works. Each story is a fixed list of steps: its start, its start-of-story changes,
// each chapter's scenes followed by that chapter's end, then the story's end. A point in a story
// ("after Ch 3", "after its start-of-story changes") is "just after step i" of that list. A story's
// line is found by following start points back to a story that starts at the beginning of the
// world; the walk then goes from the oldest story to the target, stopping each earlier story just
// after the step where the next one starts. Whenever the walk passes a step that is a side story's
// end point, that side story is added whole, right there.
//
// Readings chosen where the rules are silent (each is tested):
// - "After the last scene of Ch 7" and "after Ch 7" are different points: a side story ending after
//   Ch 7 is added after Ch 7's end step, so a story starting after Ch 7's last scene doesn't see it
//   (adding a scene to Ch 7 later would move it past that story's start anyway).
// - A segment is whole only when the walk reached the story's end; a story cut after its last
//   chapter still reads "Book 2 up to the end of Ch 9", which matches where Adam placed the cut.
// - Side stories ending at the same point: Adam's 'side-order' answer lists some of them; those come
//   first in his order, any he didn't list follow in the usual order.
// - A side story whose end lies before its start (only possible in data the app would refuse) is
//   added at its start.
// - A chapter or scene ref that isn't in the story (it was deleted; loadShape normally moves it to
//   the one before) counts as the story's start, after its start-of-story changes.

import type { EndAt, ID, StartAt } from '@shared/types'
import type { StoryPlacement } from '@shared/api'
import type { ChapterNode, Line, LineSegment, LineStep, LineTarget, StoryNode, WorldShape } from './types'

// ---------- Indexes over a shape ----------

/** A step of a story's own list, before the walk says how it got there. */
type BareStep =
  | { type: 'start'; storyId: ID }
  | { type: 'start-changes'; storyId: ID }
  | { type: 'scene'; storyId: ID; chapterId: ID; sceneId: ID }
  | { type: 'chapter-end'; storyId: ID; chapterId: ID }
  | { type: 'end'; storyId: ID }

interface StoryInfo {
  node: StoryNode
  steps: BareStep[]
  /** Step index of each scene and of each chapter's end. */
  sceneStep: Map<ID, number>
  chapterEndStep: Map<ID, number>
}

interface WorldIndex {
  stories: Map<ID, StoryInfo>
  /** Side stories by host (their start story). */
  sides: Map<ID, StoryNode[]>
  /** Where each live scene and chapter is, with its number (counting live ones from 1). */
  scenes: Map<ID, { storyId: ID; chapterId: ID; chapterNo: number; sceneNo: number }>
  chapters: Map<ID, { storyId: ID; chapterNo: number }>
  answers: WorldShape['answers']
}

function storySteps(s: StoryNode): StoryInfo {
  const steps: BareStep[] = [
    { type: 'start', storyId: s.id },
    { type: 'start-changes', storyId: s.id }
  ]
  const sceneStep = new Map<ID, number>()
  const chapterEndStep = new Map<ID, number>()
  for (const c of s.chapters) {
    for (const sc of c.scenes) {
      sceneStep.set(sc.id, steps.length)
      steps.push({ type: 'scene', storyId: s.id, chapterId: c.id, sceneId: sc.id })
    }
    chapterEndStep.set(c.id, steps.length)
    steps.push({ type: 'chapter-end', storyId: s.id, chapterId: c.id })
  }
  steps.push({ type: 'end', storyId: s.id })
  return { node: s, steps, sceneStep, chapterEndStep }
}

function indexWorld(shape: WorldShape): WorldIndex {
  const stories = new Map<ID, StoryInfo>()
  const sides = new Map<ID, StoryNode[]>()
  const scenes: WorldIndex['scenes'] = new Map()
  const chapters: WorldIndex['chapters'] = new Map()
  for (const s of shape.stories) {
    stories.set(s.id, storySteps(s))
    s.chapters.forEach((c, ci) => {
      chapters.set(c.id, { storyId: s.id, chapterNo: ci + 1 })
      c.scenes.forEach((sc, si) => scenes.set(sc.id, { storyId: s.id, chapterId: c.id, chapterNo: ci + 1, sceneNo: si + 1 }))
    })
  }
  for (const s of shape.stories) {
    if (s.kind !== 'side' || !s.startStoryId || !stories.has(s.startStoryId)) continue
    const list = sides.get(s.startStoryId) ?? []
    list.push(s)
    sides.set(s.startStoryId, list)
  }
  return { stories, sides, scenes, chapters, answers: shape.answers }
}

/** The step a start point sits just after, in the story it starts in. */
function startStep(info: StoryInfo, at: StartAt, refId: ID | null): number {
  const last = info.steps.length - 1
  switch (at) {
    case 'pre':
      return 0
    case 'post':
      return 1
    case 'chapter':
      return (refId ? info.chapterEndStep.get(refId) : undefined) ?? 1
    case 'scene':
      return (refId ? info.sceneStep.get(refId) : undefined) ?? 1
    case 'end':
    default:
      return last
  }
}

/** The step a side story's end point sits just after, in its host. */
function endStep(info: StoryInfo, at: EndAt | null, refId: ID | null): number {
  if (at === 'chapter') return (refId ? info.chapterEndStep.get(refId) : undefined) ?? 1
  return info.steps.length - 1
}

/** Where a side story is added in its host: its end, or its start if the end lies before it. */
function sideAddStep(host: StoryInfo, side: StoryNode): number {
  return Math.max(endStep(host, side.endAt, side.endRefId), startStep(host, side.startAt, side.startRefId))
}

/** The 'side-order' answer key for side stories added after a host's step. */
function sideOrderKey(host: StoryInfo, step: number): string | null {
  const s = host.steps[step]
  if (step === host.steps.length - 1) return `${host.node.id}:end:`
  if (s.type === 'chapter-end') return `${host.node.id}:chapter:${s.chapterId}`
  return null
}

/** The stories a story follows on from, oldest first, ending with the story itself. */
function chainOf(ix: WorldIndex, storyId: ID): StoryInfo[] {
  const chain: StoryInfo[] = []
  const seen = new Set<ID>()
  let info = ix.stories.get(storyId)
  while (info && !seen.has(info.node.id)) {
    seen.add(info.node.id)
    chain.unshift(info)
    info = info.node.startStoryId ? ix.stories.get(info.node.startStoryId) : undefined
  }
  return chain
}

// ---------- The line ----------

/** Every step before the target, in order, and how far the walk went into each story. */
export function buildLine(shape: WorldShape, target: LineTarget): Line {
  const ix = indexWorld(shape)
  const targetInfo = ix.stories.get(target.storyId)
  if (!targetInfo) throw new Error(`No story ${target.storyId} in this world`)
  const chain = chainOf(ix, target.storyId)
  const onChain = new Set(chain.map((c) => c.node.id))

  // Side stories by host and step, in the order they are added there.
  const sidesAt = new Map<ID, Map<number, StoryNode[]>>()
  const sidesEndingAt = (host: StoryInfo, step: number): StoryNode[] => {
    let byStep = sidesAt.get(host.node.id)
    if (!byStep) {
      byStep = new Map()
      for (const side of ix.sides.get(host.node.id) ?? []) {
        const at = sideAddStep(host, side)
        byStep.set(at, [...(byStep.get(at) ?? []), side])
      }
      for (const [at, list] of byStep) byStep.set(at, orderSides(host, at, list, ix))
      sidesAt.set(host.node.id, byStep)
    }
    return byStep.get(step) ?? []
  }

  const steps: LineStep[] = []
  const segments = new Map<ID, LineSegment>()
  const added = new Set<ID>()

  const walk = (info: StoryInfo, upTo: number, via: 'line' | 'side', addedIn: ID | null): void => {
    const last = info.steps.length - 1
    const seg: LineSegment = { storyId: info.node.id, via, addedIn, whole: upTo >= last, stop: null }
    segments.set(info.node.id, seg)
    for (let i = 0; i <= upTo; i++) {
      steps.push({ ...info.steps[i], via } as LineStep)
      for (const side of sidesEndingAt(info, i)) {
        // Never the target itself, a story already on the chain, or one added already.
        if (side.id === target.storyId || onChain.has(side.id) || added.has(side.id)) continue
        const sideInfo = ix.stories.get(side.id)!
        added.add(side.id)
        walk(sideInfo, sideInfo.steps.length - 1, 'side', info.node.id)
      }
    }
    if (!seg.whole) seg.stop = stopAt(info.steps[Math.max(0, upTo)])
  }

  chain.forEach((info, i) => {
    let upTo: number
    if (i < chain.length - 1) {
      const next = chain[i + 1].node
      upTo = startStep(info, next.startAt, next.startRefId)
    } else if ('before' in target) {
      const at = info.sceneStep.get(target.before)
      if (at === undefined) throw new Error(`No scene ${target.before} in story ${target.storyId}`)
      upTo = at - 1
    } else if ('after' in target) {
      const at = info.sceneStep.get(target.after)
      if (at === undefined) throw new Error(`No scene ${target.after} in story ${target.storyId}`)
      upTo = at
    } else {
      upTo = target.through === 'end' ? info.steps.length - 1 : 1
    }
    walk(info, upTo, 'line', null)
  })

  // The target story's segment goes last, after anything added while walking it.
  const targetSeg = segments.get(target.storyId)!
  segments.delete(target.storyId)
  return { target, steps, segments: [...segments.values(), targetSeg] }
}

function stopAt(step: BareStep): LineSegment['stop'] {
  switch (step.type) {
    case 'start':
      return { at: 'pre', refId: null }
    case 'start-changes':
      return { at: 'post', refId: null }
    case 'scene':
      return { at: 'scene', refId: step.sceneId }
    case 'chapter-end':
      return { at: 'chapter', refId: step.chapterId }
    case 'end':
      return { at: 'end', refId: null }
  }
}

/** Side stories ending at the same point: where they start in the host, then creation order; Adam's answer overrides. */
function orderSides(host: StoryInfo, at: number, list: StoryNode[], ix: WorldIndex): StoryNode[] {
  const sorted = [...list].sort(
    (a, b) => startStep(host, a.startAt, a.startRefId) - startStep(host, b.startAt, b.startRefId) || a.createdOrder - b.createdOrder
  )
  const key = sideOrderKey(host, at)
  const answer = key ? ix.answers.find((a) => a.kind === 'side-order' && a.key === key) : undefined
  const order = Array.isArray(answer?.value) ? (answer.value as unknown[]).filter((v): v is ID => typeof v === 'string') : []
  if (!order.length) return sorted
  const rank = (s: StoryNode): number => {
    const i = order.indexOf(s.id)
    return i < 0 ? order.length : i
  }
  return sorted
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map((x) => x.s)
}

// ---------- Placement ----------

const placeVerb = (p: Pick<StoryPlacement, 'kind' | 'startAt'>): string =>
  p.startAt === 'end' ? 'continue after' : p.kind === 'prequel' ? 'be a prequel to' : 'start during'
const followsVerb = (s: Pick<StoryNode, 'kind' | 'startAt'>): string =>
  s.startAt === 'end' ? 'continues after' : s.kind === 'prequel' ? 'is a prequel to' : 'starts during'

/**
 * Null when the placement is allowed; otherwise why not, in plain words:
 * "Book 2 can't start during Kell's Road, because Kell's Road starts during Book 2."
 */
export function placementProblem(shape: WorldShape, storyId: ID, placement: StoryPlacement): string | null {
  const ix = indexWorld(shape)
  const me = ix.stories.get(storyId)
  if (!me) return 'That story no longer exists.'
  const title = me.node.title
  const { kind, startStoryId } = placement

  if (kind === 'side' && !startStoryId) return 'A side story needs a story to run alongside.'
  if (kind === 'prequel' && !startStoryId) return 'A prequel needs the book it comes before.'
  if (kind !== 'side' && placement.endAt) return 'Only a side story can end partway through another story.'
  if (placement.leadsIntoId) {
    if (placement.leadsIntoId === storyId) return `${title} can't lead into itself.`
    if (!ix.stories.has(placement.leadsIntoId)) return 'The book it leads into no longer exists.'
  }
  if (!startStoryId) return null

  if (startStoryId === storyId) return `${title} can't ${placeVerb(placement)} itself.`
  const start = ix.stories.get(startStoryId)
  if (!start) return 'The story it starts in no longer exists.'

  // A story can never follow on from itself, however long the chain.
  const seen = new Set<ID>()
  let s: StoryNode | undefined = start.node
  while (s && !seen.has(s.id)) {
    seen.add(s.id)
    if (s.startStoryId === storyId) {
      const why = s.id === start.node.id ? `${followsVerb(s)} ${title}` : `follows on from ${title}`
      return `${title} can't ${placeVerb(placement)} ${start.node.title}, because ${start.node.title} ${why}.`
    }
    s = s.startStoryId ? ix.stories.get(s.startStoryId)?.node : undefined
  }

  if (placement.startAt === 'chapter') {
    if (!placement.startRefId) return 'Pick the chapter it starts after.'
    if (!start.chapterEndStep.has(placement.startRefId)) return `That chapter isn't in ${start.node.title}.`
  }
  if (placement.startAt === 'scene') {
    if (!placement.startRefId) return 'Pick the scene it starts after.'
    if (!start.sceneStep.has(placement.startRefId)) return `That scene isn't in ${start.node.title}.`
  }
  if (kind === 'side') {
    const endAt = placement.endAt ?? 'end'
    if (endAt === 'chapter') {
      if (!placement.endRefId) return 'Pick the chapter it ends after.'
      if (!start.chapterEndStep.has(placement.endRefId)) return `That chapter isn't in ${start.node.title}.`
    }
    if (endStep(start, endAt, placement.endRefId) < startStep(start, placement.startAt, placement.startRefId)) {
      return `${title} can't end before it starts.`
    }
  }
  return null
}

// ---------- Plain words ----------

/** Where a place is in plain words, with the lookups built once for many calls. */
export function labeler(shape: WorldShape): (place: { storyId: ID | null; chapterId?: ID | null; sceneId?: ID | null }) => string {
  const ix = indexWorld(shape)
  const titles = new Map(shape.stories.map((s) => [s.id, s.title]))
  return (place) => {
    if (place.sceneId) {
      const at = ix.scenes.get(place.sceneId)
      if (at) return `${titles.get(at.storyId)}, Ch ${at.chapterNo}, Sc ${at.sceneNo}`
      const title = place.storyId ? titles.get(place.storyId) : undefined
      return title ? `a deleted scene in ${title}` : 'a deleted scene'
    }
    if (place.chapterId) {
      const at = ix.chapters.get(place.chapterId)
      if (at) return `${titles.get(at.storyId)}, Ch ${at.chapterNo}`
    }
    const title = place.storyId ? titles.get(place.storyId) : undefined
    return title ? `the start of ${title}` : ''
  }
}

/** Where a scene, chapter or story start is, in plain words: "Book 1, Ch 12, Sc 3", "the start of Book 2". */
export function placeLabel(shape: WorldShape, place: { storyId: ID; chapterId?: ID | null; sceneId?: ID | null }): string {
  return labeler(shape)(place)
}

/** One part of the sentence for a segment, or null when it contributes nothing (cut before its start-of-story changes). */
function segmentWords(
  seg: LineSegment,
  story: StoryNode,
  chapterNo: (id: ID) => number,
  sceneAt: (id: ID) => [number, number]
): string | null {
  if (seg.whole || !seg.stop || seg.stop.at === 'end') return story.title
  switch (seg.stop.at) {
    case 'pre':
      return null
    case 'post':
      return `the start of ${story.title}`
    case 'chapter':
      return `${story.title} up to the end of Ch ${chapterNo(seg.stop.refId!)}`
    case 'scene': {
      const [c, s] = sceneAt(seg.stop.refId!)
      return `${story.title} up to Ch ${c}, Sc ${s}`
    }
  }
}

/**
 * "This story knows what happened in: Book 1; Kell's Road; Book 2 up to the end of Ch 5." For a side
 * story, other side stories of the same book still running where it starts are named too: "Does not
 * know: Ash, which is still running here."
 */
export function knowsSentence(shape: WorldShape, line: Line): string {
  const ix = indexWorld(shape)
  const chapterNo = (id: ID): number => ix.chapters.get(id)?.chapterNo ?? 0
  const sceneAt = (id: ID): [number, number] => {
    const at = ix.scenes.get(id)
    return at ? [at.chapterNo, at.sceneNo] : [0, 0]
  }
  const parts = line.segments
    .filter((seg) => seg.storyId !== line.target.storyId)
    .map((seg) => {
      const story = ix.stories.get(seg.storyId)?.node
      return story ? segmentWords(seg, story, chapterNo, sceneAt) : null
    })
    .filter((p): p is string => !!p)
  const knows = parts.length ? `This story knows what happened in: ${parts.join('; ')}.` : 'This story knows only the starting setup.'
  const running = stillRunning(ix, line).map((s) => s.title)
  if (!running.length) return knows
  return `${knows} Does not know: ${joinAnd(running)}, which ${running.length === 1 ? 'is' : 'are'} still running here.`
}

/** Other side stories of a side story's book that started at or before its start and end after it, in the order they start. */
function stillRunning(ix: WorldIndex, line: Line): StoryNode[] {
  const me = ix.stories.get(line.target.storyId)?.node
  const host = me?.kind === 'side' && me.startStoryId ? ix.stories.get(me.startStoryId) : undefined
  if (!me || !host) return []
  const at = startStep(host, me.startAt, me.startRefId)
  const walked = new Set(line.segments.map((s) => s.storyId))
  return (ix.sides.get(host.node.id) ?? [])
    .filter((s) => s.id !== me.id && !walked.has(s.id))
    .filter((s) => startStep(host, s.startAt, s.startRefId) <= at && at < sideAddStep(host, s))
    .sort((a, b) => startStep(host, a.startAt, a.startRefId) - startStep(host, b.startAt, b.startRefId) || a.createdOrder - b.createdOrder)
}

const joinAnd = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** The last scene step on the line itself (never a side story added whole), or null. */
export function previousSceneStep(line: Line): Extract<LineStep, { type: 'scene' }> | null {
  for (let i = line.steps.length - 1; i >= 0; i--) {
    const s = line.steps[i]
    if (s.type === 'scene' && s.via === 'line') return s
  }
  return null
}

/**
 * Every scene whose changes count for this scene, in walk order: earlier scenes of its own story, of
 * the stories it follows on from, and of side stories added whole. The memory keeper brings these up
 * to date before a draft. Empty when the scene isn't in the world.
 */
export function scenesBefore(shape: WorldShape, sceneId: ID): ID[] {
  const story = storyOfScene(shape, sceneId)
  if (!story) return []
  return buildLine(shape, { storyId: story.id, before: sceneId })
    .steps.filter((s): s is Extract<LineStep, { type: 'scene' }> => s.type === 'scene')
    .map((s) => s.sceneId)
}

// ---------- Helpers other parts of the memory core use ----------

/** The chapter a scene is in, and the chapters of a story, by id. */
export function findChapter(shape: WorldShape, chapterId: ID): { story: StoryNode; chapter: ChapterNode; index: number } | null {
  for (const story of shape.stories) {
    const index = story.chapters.findIndex((c) => c.id === chapterId)
    if (index >= 0) return { story, chapter: story.chapters[index], index }
  }
  return null
}

/** The live story a scene is in, or null. */
export function storyOfScene(shape: WorldShape, sceneId: ID): StoryNode | null {
  for (const story of shape.stories) for (const c of story.chapters) if (c.scenes.some((s) => s.id === sceneId)) return story
  return null
}

/**
 * A sort key that puts changes (and anything else pinned to a place) in story order: a story's
 * places in order, each story placed just after the point it starts at in its start story, stories
 * starting at the same point by creation order. Places that aren't in the world sort last.
 */
export function storyOrder(shape: WorldShape): (place: { storyId: ID | null; sceneId?: ID | null }) => number[] {
  const ix = indexWorld(shape)
  const paths = new Map<ID, number[]>()
  const pathOf = (id: ID, seen: Set<ID> = new Set()): number[] => {
    const known = paths.get(id)
    if (known) return known
    const info = ix.stories.get(id)
    if (!info) return [Infinity]
    const n = info.node
    const start = n.startStoryId && !seen.has(id) ? ix.stories.get(n.startStoryId) : undefined
    const path = start
      ? [...pathOf(start.node.id, new Set([...seen, id])), startStep(start, n.startAt, n.startRefId) + 0.5, n.createdOrder]
      : [-0.5, n.createdOrder]
    paths.set(id, path)
    return path
  }
  return (place) => {
    if (!place.storyId) return [-1]
    const info = ix.stories.get(place.storyId)
    if (!info) return [Infinity]
    const step = place.sceneId ? info.sceneStep.get(place.sceneId) : 1
    return step === undefined ? [Infinity] : [...pathOf(place.storyId), step]
  }
}

/**
 * For the clash rule: a side story's host, and the host's own places between the side story's start
 * and the point it is added (its start-of-story changes count when the side story starts before them).
 */
export function hostSpans(shape: WorldShape): (sideId: ID) => { hostId: ID; startChanges: boolean; sceneIds: ID[] } | null {
  const ix = indexWorld(shape)
  return (sideId) => {
    const side = ix.stories.get(sideId)?.node
    const host = side?.kind === 'side' && side.startStoryId ? ix.stories.get(side.startStoryId) : undefined
    if (!side || !host) return null
    const span = { hostId: host.node.id, startChanges: false, sceneIds: [] as ID[] }
    for (let i = startStep(host, side.startAt, side.startRefId) + 1; i <= sideAddStep(host, side); i++) {
      const s = host.steps[i]
      if (s.type === 'start-changes') span.startChanges = true
      else if (s.type === 'scene') span.sceneIds.push(s.sceneId)
    }
    return span
  }
}

/** Compares two keys from storyOrder. */
export function compareOrder(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return a.length - b.length
}
