// The fixed test world from the spec's "Multi-story rules" tab, checked on every build.
// It is written once, as plain data (WorldSpec), and built two ways:
// - pureWorld(): a WorldShape and MemoryData with readable ids ('b1.c2.s1'), no database;
// - dbWorld(): an in-memory world database filled through the real repo and memory functions
//   (createStory, setStoryPlacement, createEntry with its default first-exists point, insertChange...).
// testWorld.test.ts checks every story's "knows what happened in" sentence and the state of a few
// entries through both, so the rules and the SQL agree.
//
// What it holds:
// - a four-book series (Book 1 to Book 4, series The Reach);
// - two novellas during Book 2 that end at the same point (Ash from its start, Ember after Ch 1,
//   both ending after Ch 3), and Wolf Winter, during Book 2 from after Ch 5 to its end;
// - Kell's Road (during Book 1, after Ch 1 to after Ch 2) and Kell's Return continuing after it;
// - The Quiet Year, inserted between Book 1 and Book 2 (Book 2 continues after it);
// - a prequel trilogy to Book 1 (Young Mara, then II and III continuing after it);
// - a what-if (Mara Keeps Her Hand, after Book 1 Ch 2 Sc 1) and an own version from the beginning
//   (Another Reach);
// - two side-by-side series: North 1 to 3, and South 1 to 4 (each South book a side story during
//   the North book of the same number, from its start to its end; South 4 continues after North 3
//   so it knows every book in either series that ended before it began);
// - a later series with a time gap (The Long Dark, 200 years after Book 4), a prequel to it (Before
//   the Dark) and a side story from its start (Lantern);
// - a refused loop (checked in the tests).

import type Database from 'better-sqlite3'
import type { ChangeData, EndAt, Entry, EntryKind, ExistsPoint, ID, Origin, StartAt, StoryKind } from '@shared/types'
import type { Line, MemoryData, StoryNode, WorldShape } from '../../src/main/memory/types'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { buildLine, knowsSentence } from '../../src/main/memory/line'
import { stateAt, type MemoryStateAll } from '../../src/main/memory/state'
import { loadMemoryData, loadShape } from '../../src/main/memory/scene'
import { memoryWorld } from './helpers'

// ---------- The spec of a world ----------

export interface StorySpec {
  key: string
  title: string
  series: string
  kind?: StoryKind
  /** Where it starts; left out: the beginning of the world. */
  start?: { story: string; at: StartAt; ref?: string }
  end?: { at: EndAt; ref?: string }
  leadsInto?: string
  /** Scenes in each chapter: [2, 1] is Ch 1 with two scenes and Ch 2 with one. Keys: 'b1.c2', 'b1.c2.s1'. */
  chapters: number[]
}

export type PointSpec = { kind: 'world' } | { kind: 'story-pre' | 'story-post'; story: string } | { kind: 'scene'; scene: string }

export interface EntrySpec {
  key: string
  kind: EntryKind
  name: string
  summary?: string
  description?: string
  fields?: Record<string, string>
  /** How it is made: by whom, while working in which story (or found in which scene), by a start-of-story change. */
  made: { origin: Origin; story?: string; scene?: string; start?: boolean }
  /** Where it first exists: what the defaults must give for how it was made. */
  exists: PointSpec[]
}

export interface ChangeSpec {
  entry: string
  at: 'baseline' | { start: string } | { scene: string }
  /** Ids inside are keys (otherId: 'tobin'); fact ids are kept as they are. */
  data: ChangeData
  origin?: Origin
}

export interface AnswerSpec {
  kind: 'side-order' | 'which-last'
  /** Built from ids, so it works for both worlds. */
  key: (id: (key: string) => ID) => string
  value: (id: (key: string) => ID) => unknown
}

export interface WorldSpec {
  name: string
  series: { key: string; name: string }[]
  stories: StorySpec[]
  entries: EntrySpec[]
  changes: ChangeSpec[]
  answers: AnswerSpec[]
}

const upd = (note: string, fields?: Record<string, string>): ChangeData => ({
  kind: 'update',
  payload: fields ? { note, fields } : { note }
})

export const theWorld: WorldSpec = {
  name: 'The Reach',
  series: [
    { key: 'reach', name: 'The Reach' },
    { key: 'kell', name: 'Kell' },
    { key: 'north', name: 'North' },
    { key: 'south', name: 'South' },
    { key: 'dark', name: 'The Long Dark' }
  ],
  stories: [
    { key: 'b1', title: 'Book 1', series: 'reach', chapters: [2, 2, 2] },
    {
      key: 'kr',
      title: "Kell's Road",
      series: 'kell',
      kind: 'side',
      start: { story: 'b1', at: 'chapter', ref: 'b1.c1' },
      end: { at: 'chapter', ref: 'b1.c2' },
      chapters: [2]
    },
    { key: 'kret', title: "Kell's Return", series: 'kell', start: { story: 'kr', at: 'end' }, chapters: [1] },
    { key: 'qy', title: 'The Quiet Year', series: 'reach', start: { story: 'b1', at: 'end' }, chapters: [1] },
    { key: 'b2', title: 'Book 2', series: 'reach', start: { story: 'qy', at: 'end' }, chapters: [1, 2, 1, 1, 1, 1] },
    {
      key: 'ash',
      title: 'Ash',
      series: 'reach',
      kind: 'side',
      start: { story: 'b2', at: 'post' },
      end: { at: 'chapter', ref: 'b2.c3' },
      chapters: [2]
    },
    {
      key: 'ember',
      title: 'Ember',
      series: 'reach',
      kind: 'side',
      start: { story: 'b2', at: 'chapter', ref: 'b2.c1' },
      end: { at: 'chapter', ref: 'b2.c3' },
      chapters: [1]
    },
    {
      key: 'wolf',
      title: 'Wolf Winter',
      series: 'reach',
      kind: 'side',
      start: { story: 'b2', at: 'chapter', ref: 'b2.c5' },
      end: { at: 'end' },
      chapters: [1]
    },
    { key: 'b3', title: 'Book 3', series: 'reach', start: { story: 'b2', at: 'end' }, chapters: [2] },
    { key: 'b4', title: 'Book 4', series: 'reach', start: { story: 'b3', at: 'end' }, chapters: [1] },
    { key: 'ym', title: 'Young Mara', series: 'reach', kind: 'prequel', start: { story: 'b1', at: 'pre' }, leadsInto: 'b1', chapters: [2] },
    { key: 'ym2', title: 'Young Mara II', series: 'reach', start: { story: 'ym', at: 'end' }, chapters: [1] },
    { key: 'ym3', title: 'Young Mara III', series: 'reach', start: { story: 'ym2', at: 'end' }, chapters: [1] },
    {
      key: 'keep',
      title: 'Mara Keeps Her Hand',
      series: 'reach',
      kind: 'own',
      start: { story: 'b1', at: 'scene', ref: 'b1.c2.s1' },
      chapters: [1]
    },
    { key: 'other', title: 'Another Reach', series: 'reach', kind: 'own', chapters: [1] },
    { key: 'n1', title: 'North 1', series: 'north', chapters: [1] },
    { key: 's1', title: 'South 1', series: 'south', kind: 'side', start: { story: 'n1', at: 'post' }, end: { at: 'end' }, chapters: [1] },
    { key: 'n2', title: 'North 2', series: 'north', start: { story: 'n1', at: 'end' }, chapters: [1] },
    { key: 's2', title: 'South 2', series: 'south', kind: 'side', start: { story: 'n2', at: 'post' }, end: { at: 'end' }, chapters: [1] },
    { key: 'n3', title: 'North 3', series: 'north', start: { story: 'n2', at: 'end' }, chapters: [1] },
    { key: 's3', title: 'South 3', series: 'south', kind: 'side', start: { story: 'n3', at: 'post' }, end: { at: 'end' }, chapters: [1] },
    { key: 's4', title: 'South 4', series: 'south', start: { story: 'n3', at: 'end' }, chapters: [1] },
    { key: 'ld', title: 'The Long Dark', series: 'dark', start: { story: 'b4', at: 'end' }, chapters: [2] },
    {
      key: 'bd',
      title: 'Before the Dark',
      series: 'dark',
      kind: 'prequel',
      start: { story: 'ld', at: 'pre' },
      leadsInto: 'ld',
      chapters: [1]
    },
    {
      key: 'lan',
      title: 'Lantern',
      series: 'dark',
      kind: 'side',
      start: { story: 'ld', at: 'post' },
      end: { at: 'chapter', ref: 'ld.c1' },
      chapters: [1]
    }
  ],
  entries: [
    {
      key: 'mara',
      kind: 'character',
      name: 'Mara',
      summary: "Heir to the Reach, raised as a smith's daughter.",
      description: "A smith's daughter with a quick temper.",
      fields: { hair: 'long and dark', marks: 'none' },
      made: { origin: 'adam' },
      exists: [{ kind: 'world' }]
    },
    {
      key: 'tobin',
      kind: 'character',
      name: 'Tobin',
      summary: 'A ferryman.',
      description: "Mara's oldest friend, who keeps the ferry.",
      made: { origin: 'adam', story: 'b1' },
      exists: [{ kind: 'world' }]
    },
    {
      key: 'kell',
      kind: 'character',
      name: 'Kell',
      made: { origin: 'text', story: 'kr', scene: 'kr.c1.s1' },
      exists: [{ kind: 'scene', scene: 'kr.c1.s1' }]
    },
    {
      key: 'wren',
      kind: 'character',
      name: 'Wren',
      made: { origin: 'text', story: 'b2', scene: 'b2.c4.s1' },
      exists: [{ kind: 'scene', scene: 'b2.c4.s1' }]
    },
    {
      key: 'mill',
      kind: 'place',
      name: 'Harrow Mill',
      made: { origin: 'text', story: 'b1', scene: 'b1.c1.s2' },
      exists: [{ kind: 'story-pre', story: 'b1' }]
    },
    { key: 'burned', kind: 'thread', name: 'Who burned the mill?', made: { origin: 'adam' }, exists: [{ kind: 'world' }] },
    {
      key: 'ilse',
      kind: 'character',
      name: 'Ilse',
      made: { origin: 'ai', story: 'ld', start: true },
      exists: [{ kind: 'story-post', story: 'ld' }]
    },
    {
      key: 'hal',
      kind: 'character',
      name: 'Hal',
      summary: 'A northern guide.',
      made: { origin: 'adam', story: 'n1' },
      exists: [{ kind: 'story-pre', story: 'n1' }]
    }
  ],
  changes: [
    {
      entry: 'mara',
      at: 'baseline',
      data: { kind: 'relationship', payload: { otherId: 'tobin', type: 'friend', feels: 'trusts him', otherFeels: 'would die for her' } }
    },
    {
      entry: 'burned',
      at: { scene: 'b1.c1.s2' },
      data: { kind: 'thread', payload: { status: 'open', note: 'The mill burns and nobody knows who set the fire.' } }
    },
    { entry: 'mara', at: { scene: 'b1.c2.s2' }, data: upd('lost her left hand', { marks: 'left hand missing' }), origin: 'text' },
    {
      entry: 'tobin',
      at: { scene: 'b1.c3.s1' },
      data: { kind: 'knowledge', payload: { factId: 'f-heir', fact: 'Mara is the heir to the Reach.' } }
    },
    {
      entry: 'kell',
      at: { scene: 'kr.c1.s2' },
      data: { kind: 'knowledge', payload: { factId: 'f-heir', fact: 'Mara is the heir to the Reach.' } }
    },
    { entry: 'mara', at: { scene: 'b2.c2.s1' }, data: upd('cut her hair', { hair: 'cropped short' }) },
    {
      entry: 'tobin',
      at: { scene: 'b2.c2.s2' },
      data: { kind: 'relationship', payload: { otherId: 'mara', type: 'enemy', feels: 'betrayed', otherFeels: 'guilty' } }
    },
    { entry: 'mara', at: { scene: 'ash.c1.s1' }, data: upd('shaved her head', { hair: 'shaved' }) },
    { entry: 'mara', at: { scene: 'ash.c1.s2' }, data: upd('turned nineteen', { age: '19' }) },
    { entry: 'tobin', at: { scene: 'ember.c1.s1' }, data: upd('took the ferry north') },
    { entry: 'mara', at: { scene: 'wolf.c1.s1' }, data: upd('wintered in the north') },
    {
      entry: 'burned',
      at: { scene: 'b3.c1.s2' },
      data: { kind: 'thread', payload: { status: 'resolved', note: 'Kell confesses to the fire.' } }
    },
    {
      entry: 'mara',
      at: { start: 'ym' },
      origin: 'ai',
      data: {
        kind: 'full',
        payload: {
          description: 'A girl of nine who has never left the mill town.',
          fields: { hair: 'in two plaits' },
          knows: [{ factId: 'f-weir', fact: 'The river can be crossed at the weir.' }],
          relationships: [{ otherId: 'tobin', type: 'neighbour', feels: 'curious', otherFeels: 'wary' }]
        }
      }
    },
    { entry: 'mara', at: { scene: 'keep.c1.s1' }, data: upd('learned to fight with both hands') },
    { entry: 'mara', at: { start: 'ld' }, origin: 'ai', data: upd('died long ago') },
    {
      entry: 'ilse',
      at: { start: 'ld' },
      origin: 'ai',
      data: { kind: 'full', payload: { description: "Mara's great-granddaughter, keeper of the lamp.", knows: [], relationships: [] } }
    },
    { entry: 'ilse', at: { scene: 'lan.c1.s1' }, data: upd('left the lamp unlit') }
  ],
  answers: []
}

/** Adam's answer: Ember happened before Ash (both end after Book 2 Ch 3). */
export const emberFirst: AnswerSpec = {
  kind: 'side-order',
  key: (id) => `${id('b2')}:chapter:${id('b2.c3')}`,
  value: (id) => [id('ember'), id('ash')]
}

/** Adam's answer to "Which happened last?" for Mara's hair: Ash's shaved head. */
export const ashHairLast: AnswerSpec = {
  kind: 'which-last',
  key: (id) => `${id('ash')}:${id('mara')}:hair`,
  value: () => 'side'
}

/** Every story's sentence at its start (story settings), as the spec's examples write them. */
export const KNOWS: Record<string, string> = {
  b1: 'This story knows only the starting setup.',
  kr: 'This story knows what happened in: Book 1 up to the end of Ch 1.',
  kret: "This story knows what happened in: Book 1 up to the end of Ch 1; Kell's Road.",
  qy: "This story knows what happened in: Book 1; Kell's Road.",
  b2: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year.",
  ash: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; the start of Book 2.",
  ember: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 1.",
  wolf: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 5; Ash; Ember.",
  b3: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2; Ash; Ember; Wolf Winter.",
  b4: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2; Ash; Ember; Wolf Winter; Book 3.",
  ym: 'This story knows only the starting setup.',
  ym2: 'This story knows what happened in: Young Mara.',
  ym3: 'This story knows what happened in: Young Mara; Young Mara II.',
  keep: 'This story knows what happened in: Book 1 up to Ch 2, Sc 1.',
  other: 'This story knows only the starting setup.',
  n1: 'This story knows only the starting setup.',
  s1: 'This story knows what happened in: the start of North 1.',
  n2: 'This story knows what happened in: North 1; South 1.',
  s2: 'This story knows what happened in: North 1; South 1; the start of North 2.',
  n3: 'This story knows what happened in: North 1; South 1; North 2; South 2.',
  s3: 'This story knows what happened in: North 1; South 1; North 2; South 2; the start of North 3.',
  s4: 'This story knows what happened in: North 1; South 1; North 2; South 2; North 3; South 3.',
  ld: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2; Ash; Ember; Wolf Winter; Book 3; Book 4.",
  bd: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2; Ash; Ember; Wolf Winter; Book 3; Book 4.",
  lan: "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2; Ash; Ember; Wolf Winter; Book 3; Book 4; the start of The Long Dark."
}

// ---------- Built two ways ----------

export interface TestWorld {
  shape: WorldShape
  data: MemoryData
  /** The id of a story, chapter, scene or entry key ('b1', 'b1.c2', 'b1.c2.s1', 'mara'). */
  id: (key: string) => ID
  /** The line up to a scene (by key), or to a story's start or end. */
  line: (story: string, at: string | 'start' | 'end') => Line
  knows: (story: string, at?: string | 'start' | 'end') => string
  state: (story: string, at?: string | 'start' | 'end') => MemoryStateAll
}

function handle(shape: WorldShape, data: MemoryData, id: (key: string) => ID): TestWorld {
  const line = (story: string, at: string): Line =>
    at === 'start' || at === 'end'
      ? buildLine(shape, { storyId: id(story), through: at })
      : buildLine(shape, { storyId: id(story), before: id(at) })
  return {
    shape,
    data,
    id,
    line,
    knows: (story, at = 'start') => knowsSentence(shape, line(story, at)),
    state: (story, at = 'start') => stateAt(data, shape, line(story, at))
  }
}

const chapterKeys = (s: StorySpec): { key: string; scenes: string[] }[] =>
  s.chapters.map((n, ci) => ({
    key: `${s.key}.c${ci + 1}`,
    scenes: Array.from({ length: n }, (_, si) => `${s.key}.c${ci + 1}.s${si + 1}`)
  }))

function mapIds(data: ChangeData, id: (key: string) => ID): ChangeData {
  if (data.kind === 'relationship') return { kind: 'relationship', payload: { ...data.payload, otherId: id(data.payload.otherId) } }
  if (data.kind === 'full') {
    return {
      kind: 'full',
      payload: { ...data.payload, relationships: data.payload.relationships.map((r) => ({ ...r, otherId: id(r.otherId) })) }
    }
  }
  return data
}

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const time = (i: number): string => new Date(T0 + i * 1000).toISOString()

/** The world as plain data: readable ids, no database. */
export function pureWorld(spec: WorldSpec = theWorld, answers: AnswerSpec[] = spec.answers): TestWorld {
  const id = (k: string): ID => k
  const stories: StoryNode[] = spec.stories.map((s, i) => ({
    id: s.key,
    title: s.title,
    kind: s.kind ?? 'continues',
    seriesId: s.series,
    startStoryId: s.start?.story ?? null,
    startAt: s.start?.at ?? 'end',
    startRefId: s.start?.ref ?? null,
    endAt: s.kind === 'side' ? (s.end?.at ?? 'end') : null,
    endRefId: s.end?.ref ?? null,
    leadsIntoId: s.leadsInto ?? null,
    leadsIn: false,
    position: i,
    createdOrder: i,
    chapters: chapterKeys(s).map((c, ci) => ({
      id: c.key,
      title: `Chapter ${ci + 1}`,
      scenes: c.scenes.map((sc, si) => ({ id: sc, title: `Scene ${si + 1}` }))
    }))
  }))
  const storyOfScene = new Map(spec.stories.flatMap((s) => chapterKeys(s).flatMap((c) => c.scenes.map((sc) => [sc, s.key] as const))))
  const entries: Entry[] = spec.entries.map((e, i) => ({
    id: e.key,
    kind: e.kind,
    name: e.name,
    aliases: [],
    summary: e.summary ?? '',
    description: e.description ?? '',
    tags: [],
    notes: '',
    fields: { ...(e.fields ?? {}) },
    parentId: null,
    hardRule: false,
    origin: e.made.origin,
    fieldOrigins: {},
    originStoryId: e.made.story ?? null,
    originSceneId: e.made.scene ?? null,
    originStart: !!e.made.start,
    byHand: e.made.origin === 'adam',
    createdAt: time(i),
    updatedAt: time(i)
  }))
  const exists: ExistsPoint[] = spec.entries.flatMap((e) =>
    e.exists.map((p, i) => ({
      id: `${e.key}.p${i}`,
      entryId: e.key,
      kind: p.kind,
      storyId:
        p.kind === 'story-pre' || p.kind === 'story-post' ? p.story : p.kind === 'scene' ? (storyOfScene.get(p.scene) ?? null) : null,
      sceneId: p.kind === 'scene' ? p.scene : null,
      byHand: false
    }))
  )
  const positions = new Map<string, number>()
  const changes = spec.changes.map((c, i) => {
    const place = c.at === 'baseline' ? 'baseline' : 'start' in c.at ? `start:${c.at.start}` : `scene:${c.at.scene}`
    const position = positions.get(place) ?? 0
    positions.set(place, position + 1)
    return {
      ...mapIds(c.data, id),
      id: `ch${i}`,
      entryId: c.entry,
      anchor: c.at === 'baseline' ? 'baseline' : 'start' in c.at ? 'story-start' : 'scene',
      storyId: c.at === 'baseline' ? null : 'start' in c.at ? c.at.start : (storyOfScene.get(c.at.scene) ?? null),
      sceneId: c.at !== 'baseline' && 'scene' in c.at ? c.at.scene : null,
      position,
      origin: c.origin ?? 'adam',
      runId: null,
      createdAt: time(100 + i),
      updatedAt: time(100 + i)
    } as MemoryData['changes'][number]
  })
  const answerRows = answers.map((a, i) => ({ id: `a${i}`, kind: a.kind, key: a.key(id), value: a.value(id) }))
  return handle({ stories, answers: answerRows }, { entries, changes, exists, answers: answerRows }, id)
}

/** The same world in an in-memory database, made through the real repo and memory functions. */
export function dbWorld(
  spec: WorldSpec = theWorld,
  answers: AnswerSpec[] = spec.answers
): TestWorld & { db: Database.Database; reload: () => TestWorld } {
  const db = memoryWorld(spec.name)
  const ids = new Map<string, ID>()
  const id = (k: string): ID => {
    const v = ids.get(k)
    if (!v) throw new Error(`No id for ${k}`)
    return v
  }

  // Series: the world's own first series, then the rest.
  const [firstSeries] = repo.listSeries(db)
  spec.series.forEach((s, i) => {
    if (i === 0) {
      ids.set(s.key, firstSeries.id)
      return
    }
    const sid = `series-${s.key}`
    db.prepare('INSERT INTO series (id, name, position, created_at) VALUES (?, ?, ?, ?)').run(sid, s.name, i, new Date().toISOString())
    ids.set(s.key, sid)
  })

  // Stories, chapters and scenes, in creation order. The world's first story is Book 1.
  const [book1] = repo.listStories(db)
  spec.stories.forEach((s, i) => {
    const story = i === 0 ? book1 : repo.createStory(db, { title: s.title, seriesId: id(s.series), startStoryId: null })
    if (i === 0) repo.updateStory(db, story.id, { title: s.title, seriesId: id(s.series) })
    ids.set(s.key, story.id)
    const existing = repo.getOutline(db, story.id)
    chapterKeys(s).forEach((c, ci) => {
      const chapter = i === 0 && ci === 0 ? existing.chapters[0] : repo.createChapter(db, story.id, { title: `Chapter ${ci + 1}` })
      ids.set(c.key, chapter.id)
      c.scenes.forEach((sc, si) => {
        const scene = i === 0 && ci === 0 && si === 0 ? existing.scenes[0] : repo.createScene(db, chapter.id, { title: `Scene ${si + 1}` })
        ids.set(sc, scene.id)
      })
    })
  })
  // Then where each starts (every start point refers to stories made above).
  for (const s of spec.stories) {
    if (!s.start && !s.kind) continue
    mem.setStoryPlacement(db, id(s.key), {
      kind: s.kind ?? 'continues',
      startStoryId: s.start ? id(s.start.story) : null,
      startAt: s.start?.at ?? 'end',
      startRefId: s.start?.ref ? id(s.start.ref) : null,
      endAt: s.kind === 'side' ? (s.end?.at ?? 'end') : null,
      endRefId: s.end?.ref ? id(s.end.ref) : null,
      leadsIntoId: s.leadsInto ? id(s.leadsInto) : null
    })
  }

  for (const e of spec.entries) {
    const entry = repo.createEntry(
      db,
      e.kind,
      { name: e.name, summary: e.summary ?? '', description: e.description ?? '', fields: e.fields ?? {} },
      {
        origin: e.made.origin,
        originStoryId: e.made.story ? id(e.made.story) : null,
        originSceneId: e.made.scene ? id(e.made.scene) : null,
        originStart: !!e.made.start
      }
    )
    ids.set(e.key, entry.id)
  }

  for (const c of spec.changes) {
    mem.insertChange(db, {
      ...mapIds(c.data, id),
      entryId: id(c.entry),
      anchor: c.at === 'baseline' ? 'baseline' : 'start' in c.at ? 'story-start' : 'scene',
      storyId: c.at !== 'baseline' && 'start' in c.at ? id(c.at.start) : null,
      sceneId: c.at !== 'baseline' && 'scene' in c.at ? id(c.at.scene) : null,
      origin: c.origin ?? 'adam'
    })
  }
  for (const a of answers) mem.setAnswer(db, a.kind, a.key(id), a.value(id))

  const reload = (): TestWorld => handle(loadShape(db), loadMemoryData(db), id)
  return { ...reload(), db, reload }
}

/** The points an entry should have, as ids (to compare with what the database gave it). */
export function expectedPoints(
  spec: WorldSpec,
  w: TestWorld,
  entryKey: string
): { kind: string; storyId: ID | null; sceneId: ID | null }[] {
  const storyOfScene = new Map(spec.stories.flatMap((s) => chapterKeys(s).flatMap((c) => c.scenes.map((sc) => [sc, s.key] as const))))
  return spec.entries
    .find((e) => e.key === entryKey)!
    .exists.map((p) => ({
      kind: p.kind,
      storyId:
        p.kind === 'story-pre' || p.kind === 'story-post' ? w.id(p.story) : p.kind === 'scene' ? w.id(storyOfScene.get(p.scene)!) : null,
      sceneId: p.kind === 'scene' ? w.id(p.scene) : null
    }))
}
