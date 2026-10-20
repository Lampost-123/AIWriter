// The Plan hub's logic (2026-10-20): where the writing has got to, what is written in a line, which parts make sense to
// plan from there, what each asks for and where its suggestions go, the story line's rows, Adam's direction as sent, and
// what each suggestion is called in the line.
import { describe, expect, it } from 'vitest'
import type { Act, Chapter, Outline, SceneMeta, Story } from '@shared/types'
import { outlineTree } from '@/features/outline/tree'
import { parseOutline } from '@/features/outline/parse'
import {
  askFor,
  chaptersHolding,
  chapterToWrite,
  gistLine,
  directionText,
  hubMode,
  pairUpdate,
  pickScope,
  rowForPlace,
  scopesFor,
  storyLine,
  suggestionLabels,
  threadChip,
  updateChanges,
  updateToast,
  whereYouAre,
  writtenLine
} from './hubLogic'

const story = { id: 'b1', title: 'The Salt Road' } as Story
const act = (id: string, title: string, position: number): Act => ({ id, storyId: 'b1', title, purpose: '', position })
const chapter = (id: string, title: string, position: number, actId: string | null = null, goal = ''): Chapter => ({
  id,
  storyId: 'b1',
  title,
  goal,
  position,
  actId
})
const scene = (id: string, chapterId: string, position: number, wordCount: number, title = `Scene ${position + 1}`): SceneMeta => ({
  id,
  chapterId,
  title,
  position,
  status: 'drafted',
  wordCount,
  updatedAt: '',
  acceptedAt: null,
  memoryState: 'ok' as SceneMeta['memoryState']
})

/**
 * Act 1: Ch 1 to Ch 3 written. Act 2: Ch 4 (Sc 1 The ford, Sc 2 The ferry written), Ch 5 to Ch 6 planned. Act 3 has no
 * chapters.
 */
function midStory(): Outline {
  return {
    story,
    acts: [act('a1', 'The Road', 0), act('a2', 'The River', 1), act('a3', 'The Sea', 2)],
    chapters: [
      chapter('c1', 'Salt', 0, 'a1'),
      chapter('c2', 'Rain', 1, 'a1'),
      chapter('c3', 'The rider', 2, 'a1'),
      chapter('c4', 'The Linn', 3, 'a2'),
      chapter('c5', 'Across', 4, 'a2', 'Oskar takes them over.'),
      chapter('c6', 'The gate', 5, 'a2')
    ],
    scenes: [
      scene('s1', 'c1', 0, 1200),
      scene('s2', 'c2', 0, 1500),
      scene('s3', 'c3', 0, 900),
      scene('s4', 'c4', 0, 800, 'The ford'),
      scene('s5', 'c4', 1, 700, 'The ferry below Linmouth'),
      scene('s6', 'c5', 0, 0, 'Fog'),
      scene('s7', 'c5', 1, 0, 'The second fare')
    ]
  }
}

describe('where the writing has got to', () => {
  it('is the last scene with words, labelled as the story index labels it', () => {
    expect(whereYouAre(midStory())).toEqual({
      sceneId: 's5',
      chapterId: 'c4',
      actId: 'a2',
      chapterNo: 4,
      sceneNo: 2,
      label: 'Ch 4, Sc 2',
      title: 'The ferry below Linmouth'
    })
  })

  it('says what is written in a line', () => {
    expect(writtenLine(midStory())).toEqual({ words: 5100, range: 'Ch 1 to Ch 4, Sc 2' })
    const short: Outline = { story, acts: [], chapters: [chapter('c1', 'One', 0)], scenes: [scene('s1', 'c1', 0, 300), scene('s2', 'c1', 1, 200), scene('s3', 'c1', 2, 0)] }
    expect(writtenLine(short)).toEqual({ words: 500, range: 'Ch 1, Sc 1 to Sc 2' })
    expect(writtenLine({ ...short, scenes: [scene('s1', 'c1', 0, 300)] }).range).toBe('Ch 1, Sc 1')
  })

  it('says the last scene written in one line', () => {
    expect(gistLine('Wren and Bryn reach the ferry.')).toBe('Wren and Bryn reach the ferry.')
    const long = 'At low tide Wren leads Iska across the Drowned Steps to Bell Rock, where the Board means to moor its bell buoy. Iska admits she is only a cheap clerk. Wren pulls the rotted bell rope free.'
    expect(gistLine(long)).toBe('At low tide Wren leads Iska across the Drowned Steps to Bell Rock, where the Board means to moor its bell buoy. Iska admits she is only a cheap clerk.')
    expect(gistLine('word '.repeat(80))).toMatch(/^word( word)+…$/)
  })

  it('tells a new story, one planned but not written, and one being written apart', () => {
    const fresh: Outline = { story, acts: [], chapters: [chapter('c1', 'Chapter 1', 0)], scenes: [scene('s1', 'c1', 0, 0)] }
    expect(whereYouAre(fresh)).toBeNull()
    expect(hubMode(fresh, true)).toBe('start')
    expect(hubMode(fresh, false)).toBe('planned')
    expect(hubMode(midStory(), false)).toBe('writing')
  })
})

describe('what makes sense to plan', () => {
  it('mid-story: the next scene, the rest of the chapter, the next chapter and the rest of the act, when each makes sense', () => {
    // Ch 4 has nothing planned after Sc 2; Ch 5 is planned, scenes and all; Act 2 has chapters after Ch 4.
    expect(scopesFor(midStory(), 'writing').map((s) => s.label)).toEqual(['the next scene', 'the rest of Ch 4', 'more of the story'])
    // Ch 5 with no scenes yet: the next chapter plans its scenes.
    const noScenes = { ...midStory(), scenes: midStory().scenes.filter((s) => s.chapterId !== 'c5') }
    expect(scopesFor(noScenes, 'writing').map((s) => s.id)).toEqual(['next-scene', 'rest-of-chapter', 'next-chapter', 'whole-story'])
    // Ch 4 the last chapter of its act: the next chapter (a new one) and the rest of Act 2.
    const last = { ...midStory(), chapters: midStory().chapters.slice(0, 4), scenes: midStory().scenes.slice(0, 5) }
    expect(scopesFor(last, 'writing').map((s) => s.label)).toEqual(['the next scene', 'the rest of Ch 4', 'the next chapter', 'the rest of Act 2', 'more of the story'])
    // Something planned after the last scene written in its chapter: the rest of the chapter carries on after it.
    const planned = { ...last, scenes: [...last.scenes, scene('s8', 'c4', 2, 0, 'Across the Linn')] }
    expect(scopesFor(planned, 'writing').map((s) => s.id)).toEqual(['next-scene', 'rest-of-chapter', 'next-chapter', 'rest-of-act', 'whole-story'])
    expect(askFor(planned, 'rest-of-chapter', { acts: 3, chapters: 9, scenes: 3 })).toMatchObject({ afterSceneId: 's8', place: { at: 'here', afterSceneId: 's8' } })
    expect(askFor(planned, 'next-scene', { acts: 3, chapters: 9, scenes: 3 })).toMatchObject({ afterSceneId: 's5', count: 1 })
    expect(rowForPlace(storyLine(planned), { at: 'here', chapterId: 'c4', afterSceneId: 's8', actId: 'a2', afterChapterId: 'c4' })).toEqual({ rowKey: 'rest:c4' })
  })

  it('a new story: the whole story, the first act when it is planned in acts, and the first chapter', () => {
    const fresh: Outline = { story, acts: [], chapters: [chapter('c1', 'Chapter 1', 0)], scenes: [scene('s1', 'c1', 0, 0)] }
    expect(scopesFor(fresh, 'start', { acts: 3 }).map((s) => s.label)).toEqual(['the whole story', 'the first act', 'the first chapter'])
    expect(scopesFor(fresh, 'start', { acts: 0 }).map((s) => s.label)).toEqual(['the whole story', 'the first chapter'])
  })

  it('starts on the part asked for when it makes sense here, else the first', () => {
    const scopes = scopesFor(midStory(), 'writing')
    expect(pickScope(scopes, 'rest-of-chapter')).toBe('rest-of-chapter')
    expect(pickScope(scopes, 'rest-of-act')).toBe('next-scene')
    expect(pickScope([], 'next-scene')).toBeNull()
  })
})

describe('what Plan it asks for, and where its suggestions go', () => {
  const size = { acts: 3, chapters: 9, scenes: 3 }

  it('the next scene: one scene in the chapter being written, right after its last scene written', () => {
    expect(askFor(midStory(), 'next-scene', size)).toEqual({
      kind: 'scenes',
      chapterId: 'c4',
      chapterTitle: 'The Linn',
      afterSceneId: 's5',
      count: 1,
      place: { at: 'here', chapterId: 'c4', afterSceneId: 's5', actId: 'a2', afterChapterId: 'c4' }
    })
    expect(askFor(midStory(), 'rest-of-chapter', size)).toMatchObject({ kind: 'scenes', chapterId: 'c4', afterSceneId: 's5' })
    expect(askFor(midStory(), 'rest-of-chapter', size)).not.toHaveProperty('count')
  })

  it('the next chapter: its scenes when it is planned without any, else a new chapter after this one', () => {
    const noScenes = { ...midStory(), scenes: midStory().scenes.filter((s) => s.chapterId !== 'c5') }
    expect(askFor(noScenes, 'next-chapter', size)).toMatchObject({ kind: 'scenes', chapterId: 'c5', place: { at: 'chapter', chapterId: 'c5' } })
    const last = { ...midStory(), chapters: midStory().chapters.slice(0, 4), scenes: midStory().scenes.slice(0, 5) }
    const ask = askFor(last, 'next-chapter', size)
    expect(ask).toMatchObject({ kind: 'outline', size: { acts: 0, chapters: 1, scenes: 3 }, place: { at: 'here', actId: 'a2', afterChapterId: 'c4', chapterId: null } })
    expect(ask?.kind === 'outline' ? ask.part : '').toContain('right after Ch 4 “The Linn”')
    // One planned with its scenes already: nothing to ask (the story changed since it was chosen).
    expect(askFor(midStory(), 'next-chapter', size)).toBeNull()
  })

  it('the rest of the act: chapters in it after the chapter being written', () => {
    expect(askFor(midStory(), 'rest-of-act', size)).toMatchObject({
      kind: 'chapters',
      actId: 'a2',
      afterChapterId: 'c4',
      place: { at: 'here', actId: 'a2', afterChapterId: 'c4' }
    })
  })

  it('a new story: the whole plan as sized, the first act or the first chapter only', () => {
    const fresh: Outline = { story, acts: [], chapters: [chapter('c1', 'Chapter 1', 0)], scenes: [scene('s1', 'c1', 0, 0)] }
    expect(askFor(fresh, 'whole-story', size)).toEqual({ kind: 'whole' })
    expect(askFor(fresh, 'first-act', size)).toMatchObject({ kind: 'outline', size: { acts: 1, chapters: 3, scenes: 3 }, place: { at: 'end' } })
    expect(askFor(fresh, 'first-chapter', size)).toMatchObject({ kind: 'outline', size: { acts: 0, chapters: 1, scenes: 3 } })
  })
})

describe('Adam’s direction, as it goes to the AI', () => {
  it('is his words, then the threads he ticked, then which part of a new story', () => {
    expect(directionText('Oskar sells word of the case.', [{ name: 'Bryn’s debt', since: 'Ch 2' }, { name: 'Who sent the rider', since: '' }])).toBe(
      'Oskar sells word of the case.\n\nBring back these plot threads: Bryn’s debt (open since Ch 2); Who sent the rider.'
    )
    expect(directionText('', [{ name: 'Bryn’s debt', since: 'Ch 2' }])).toBe('Bring back this plot thread: Bryn’s debt (open since Ch 2).')
    expect(directionText('  ', [], 'Plan only the first chapter.')).toBe('Plan only the first chapter.')
    expect(threadChip({ name: 'Bryn’s debt to the salt houses', since: 'Ch 2' })).toBe('Bryn’s debt to the salt houses (since Ch 2)')
  })
})

describe('the story line', () => {
  it('folds what is written away, marks where you are, and lists what is planned and the acts with no chapters', () => {
    const rows = storyLine(midStory())
    expect(rows.map((r) => r.kind)).toEqual(['written-act', 'current', 'here', 'planned', 'acts-only'])
    expect(rows[0]).toMatchObject({ kind: 'written-act', actNo: 1, range: 'Ch 1 to Ch 3' })
    expect(rows[1].kind === 'current' && rows[1].scenes.map((s) => s.title)).toEqual(['The ford', 'The ferry below Linmouth'])
    expect(rows[3]).toMatchObject({ kind: 'planned', range: 'Ch 5 to Ch 6' })
    expect(rows[4]).toMatchObject({ kind: 'acts-only', label: 'Act 3' })
  })

  it('lists the chapter’s scenes planned after the last one written, and chapters written before it in the same act', () => {
    const o = midStory()
    o.chapters = [...o.chapters.slice(0, 3), chapter('c3b', 'The weir', 3, 'a2'), ...o.chapters.slice(3).map((c) => ({ ...c, position: c.position + 1 }))]
    o.scenes = [...o.scenes, scene('s9', 'c3b', 0, 400), scene('s10', 'c4', 2, 0, 'Across the Linn')]
    const rows = storyLine(o)
    expect(rows.map((r) => r.kind)).toEqual(['written-act', 'written-chapters', 'current', 'here', 'planned-scenes', 'planned', 'acts-only'])
    expect(rows[1]).toMatchObject({ range: 'Ch 4' })
    expect(rows[4].kind === 'planned-scenes' && rows[4].scenes.map((s) => s.title)).toEqual(['Across the Linn'])
  })

  it('shows a story planned but not written as its plan, and puts each batch where it belongs', () => {
    const o = midStory()
    const planned = { ...o, scenes: o.scenes.map((s) => ({ ...s, wordCount: 0 })) }
    expect(storyLine(planned).map((r) => r.kind)).toEqual(['planned', 'acts-only'])
    const rows = storyLine(o)
    expect(rowForPlace(rows, { at: 'here', chapterId: 'c4', afterSceneId: 's5', actId: 'a2', afterChapterId: 'c4' })).toEqual({ rowKey: 'here' })
    expect(rowForPlace(rows, { at: 'chapter', chapterId: 'c6' })).toEqual({ rowKey: 'planned', chapterId: 'c6' })
    expect(rowForPlace(rows, { at: 'act', actId: 'a3' })).toEqual({ rowKey: 'acts:a3', actId: 'a3' })
    expect(rowForPlace(rows, { at: 'end' })).toBeNull()
    expect(rowForPlace(rows, undefined)).toBeNull()
    expect(chaptersHolding(rows, ['s7'])).toEqual({ rowKeys: ['planned'], chapterIds: ['c5'] })
    // More scenes for a chapter written already go under it, among the written chapters; for the chapter being written, at its end.
    expect(rowForPlace(rows, { at: 'chapter', chapterId: 'c2' })).toEqual({ rowKey: 'act:a1', chapterId: 'c2' })
    expect(rowForPlace(rows, { at: 'chapter', chapterId: 'c4' })).toEqual({ rowKey: 'current:c4', chapterId: 'c4' })
  })
})

describe('what each suggestion is called in the line', () => {
  it('counts on from where its batch goes, leaving out what was discarded', () => {
    const tree = outlineTree(parseOutline('## Chapter: The Linn\n### Scene: Across\nSummary: x\n### Scene: The gate\nSummary: y\n### Scene: Night\nSummary: z', true))
    const scenes = tree[0].children
    const labels = suggestionLabels(scenes, { [scenes[0].key]: { status: 'discarded' } }, { acts: 0, chapters: 0, lead: { chapterNo: 4, scenes: 2 } })
    expect([...labels.values()]).toEqual(['Ch 4 · Sc 3', 'Ch 4 · Sc 4'])
    const acts = outlineTree(parseOutline('# Act: The Sea\n## Chapter: Out\n### Scene: Sail\nSummary: s\n## Chapter: Back\n', true))
    expect([...suggestionLabels(acts, {}, { acts: 2, chapters: 6 }).values()]).toEqual(['Act 3', 'Ch 7', 'Ch 7 · Sc 1', 'Ch 8'])
  })
})

describe('the chapter to write once a batch is all decided (2026-10-20)', () => {
  const o = {
    chapters: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] as Chapter[],
    scenes: [
      { id: 's1', chapterId: 'c1', wordCount: 900 },
      { id: 's0', chapterId: 'c1', wordCount: 0 },
      { id: 's2', chapterId: 'c2', wordCount: 0 },
      { id: 's3', chapterId: 'c2', wordCount: 0 },
      { id: 's4', chapterId: 'c3', wordCount: 0 }
    ] as SceneMeta[]
  }
  it('is the chapter of the first scene kept, by its number, saying whether every scene kept is in it', () => {
    expect(chapterToWrite(o, ['s2', 's3'])).toEqual({ id: 'c2', no: 2, all: true })
    expect(chapterToWrite(o, ['s3', 's4'])).toEqual({ id: 'c2', no: 2, all: false })
  })
  it('is none when nothing was kept or the scene has left the story', () => {
    expect(chapterToWrite(o, [])).toBeNull()
    expect(chapterToWrite(o, ['gone'])).toBeNull()
  })
  it('is none for a chapter with words already: writing it whole would write those scenes again', () => {
    expect(chapterToWrite(o, ['s0'])).toBeNull()
  })
})

describe('Update the plan: each card on its own scene (chat truth R10)', () => {
  const c = (title: string, summary = ''): { title: string; summary: string; when: string; beats: string[] } => ({ title, summary, when: '', beats: [] })

  it('pairs each card with the scene main asked about at its place, not the window’s own list', () => {
    // The window asked for s1, s2, s3; s2 was written meanwhile, so main sent s1 and s3 only.
    expect(pairUpdate(['s1', 's3'], [c('A'), c('C')])).toEqual([
      { sceneId: 's1', card: c('A') },
      { sceneId: 's3', card: c('C') }
    ])
  })

  it('leaves the scenes with no card out when fewer cards came, and drops cards beyond the scenes', () => {
    expect(pairUpdate(['s1', 's2', 's3'], [c('A')]).map((p) => p.sceneId)).toEqual(['s1'])
    expect(pairUpdate(['s1'], [c('A'), c('B')]).map((p) => p.sceneId)).toEqual(['s1'])
    expect(pairUpdate(null, [c('A')])).toEqual([])
  })

  it('a card that says what the old one did changes nothing', () => {
    const card = { goal: 'Wren climbs.', beats: ['Steps'], when: 'Day 1' }
    expect(updateChanges({ title: 'Up', summary: 'Wren climbs.', when: 'Day 1', beats: ['Steps'] }, card, 'Up')).toBe(false)
    // Empty parts of the new card keep the old ones.
    expect(updateChanges({ title: '', summary: '', when: '', beats: [] }, card, 'Up')).toBe(false)
    expect(updateChanges({ title: 'Up', summary: 'Wren falls.', when: '', beats: [] }, card, 'Up')).toBe(true)
    expect(updateChanges({ title: 'Down', summary: '', when: '', beats: [] }, card, 'Up')).toBe(true)
  })

  it('counts only the cards that really changed', () => {
    expect(updateToast({ changed: 2, sent: 2, arrived: 2, written: [] })).toBe('Updated the plan: 2 scene cards now follow what you’ve written.')
    expect(updateToast({ changed: 1, sent: 1, arrived: 1, written: [] })).toBe('Updated the plan: 1 scene card now follows what you’ve written.')
    expect(updateToast({ changed: 0, sent: 2, arrived: 2, written: [] })).toBe('Nothing in the plan changed: the new cards say what the old ones did.')
  })

  it('says plainly when some scenes got no new card', () => {
    expect(updateToast({ changed: 4, sent: 6, arrived: 4, written: [] })).toBe(
      'Updated the plan: 4 scene cards now follow what you’ve written. 4 of 6 scenes got new cards.'
    )
  })

  it('says when a scene was written meanwhile and its card left alone (edge case 9)', () => {
    expect(updateToast({ changed: 1, sent: 2, arrived: 2, written: ['Ch 2, Sc 1'] })).toBe(
      'Updated the plan: 1 scene card now follows what you’ve written. Ch 2, Sc 1 was written meanwhile, so its card was left as it was.'
    )
    expect(updateToast({ changed: 0, sent: 2, arrived: 2, written: ['Ch 2, Sc 1', 'Ch 2, Sc 2'] })).toBe(
      'Ch 2, Sc 1 and Ch 2, Sc 2 were written meanwhile, so their cards were left as they were.'
    )
  })
})
