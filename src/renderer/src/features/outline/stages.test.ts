// The outline in stages (2026-10-19): reading each level's reply (an act's rough number of chapters, chapters with no
// scenes, scenes with no chapter heading), putting a stage's reply under its act or chapter so every other suggestion
// keeps its key, what a stage is told, and where Adam chose to keep an act or chapter.
import { describe, expect, it } from 'vitest'
import { chapterCountOf, outlineScenes, parseOutline, type SuggestedChapter, type SuggestedScene } from './parse'
import { outlineText } from './outlineText'
import { arrivingKey, canPlanInside, chaptersFor, defaultMode, isUnder, markArriving, planSoFar, spliceStage, stageParts } from './stages'
import { keepPlan, outlineTree, placeKeep, type TreeNode } from './tree'

const ACTS = `Premise: A ferryman owes the Duke.

# Act: The Arrival
Purpose: Mara reaches the city.
Chapters: 3

# Act: The Turning
Purpose: Her loyalties split.
Chapters: about 2`

const CHAPTERS = `## Chapter: Rain on the Narrows
Goal: Mara lands.
Point of view: Mara Venn
Location: Gull Quay

## Chapter: The Ferryman's Price
Goal: The debt comes due.`

const SCENES = `### Scene: Arrival at the docks
When: Day 1, morning
Summary: Mara lands.
- She lands
- She is watched

### Scene: A bargain at the docks
When: Day 1, midday
Summary: Tobin offers a deal.
- He names his price`

const keysOf = (tree: TreeNode[]): string[] => tree.flatMap((n) => [n.key, ...keysOf(n.children)])

describe('reading each level', () => {
  it('reads an act’s rough number of chapters, in figures or words, a range at its most', () => {
    expect(chapterCountOf('about 4')).toBe(4)
    expect(chapterCountOf('3-4 chapters')).toBe(4)
    expect(chapterCountOf('Five')).toBe(5)
    expect(chapterCountOf('none said')).toBeNull()
    const p = parseOutline(ACTS, true)
    expect(p.acts.map((a) => [a.title, a.purpose, a.chapterCount, a.chapters.length])).toEqual([
      ['The Arrival', 'Mara reaches the city.', 3, 0],
      ['The Turning', 'Her loyalties split.', 2, 0]
    ])
    // The tree carries it, and so does the outline form written back out.
    expect(outlineTree(p).map((n) => n.about)).toEqual([3, 2])
    expect(outlineText(p)).toContain('# Act: The Arrival\nPurpose: Mara reaches the city.\nChapters: 3')
  })

  it('reads chapters with no scenes, and scenes with no chapter heading', () => {
    expect((stageParts(CHAPTERS, 'chapters', true) as SuggestedChapter[]).map((c) => [c.title, c.goal, c.scenes.length])).toEqual([
      ['Rain on the Narrows', 'Mara lands.', 0],
      ["The Ferryman's Price", 'The debt comes due.', 0]
    ])
    expect((stageParts(SCENES, 'scenes', true) as SuggestedScene[]).map((s) => [s.title, s.when, s.beats.length])).toEqual([
      ['Arrival at the docks', 'Day 1, morning', 2],
      ['A bargain at the docks', 'Day 1, midday', 1]
    ])
    // Arriving: the last one isn't complete yet.
    const partial = stageParts(`${SCENES.split('\n').slice(0, 5).join('\n')}\n### Scene: A bar`, 'scenes', false)
    expect(partial.map((s) => s.complete)).toEqual([true, false])
    // A reply that is only a chapter heading's holder gives no chapters.
    expect(stageParts('', 'chapters', true)).toEqual([])
  })
})

describe('putting a stage under its act or chapter', () => {
  it('adds an act’s chapters after what it holds, and every other suggestion keeps its key', () => {
    const before = outlineTree(parseOutline(ACTS, true))
    const joined = spliceStage(ACTS, 'a0', 'chapters', CHAPTERS)!
    expect(joined.startsWith('Premise: A ferryman owes the Duke.')).toBe(true)
    const tree = outlineTree(parseOutline(joined, true))
    expect(keysOf(tree)).toEqual(['a0', 'a0c0', 'a0c1', 'a1'])
    expect(tree[0].children[0].card?.location).toBe('Gull Quay')
    expect(tree[0].about).toBe(3)
    expect(tree[1].title).toBe(before[1].title)
    // Then a chapter's scenes, as many as came.
    const again = spliceStage(joined, 'a0c1', 'scenes', SCENES)!
    const t2 = outlineTree(parseOutline(again, true))
    expect(keysOf(t2)).toEqual(['a0', 'a0c0', 'a0c1', 'a0c1s0', 'a0c1s1', 'a1'])
    expect(outlineScenes(parseOutline(again, true)).map((s) => s.title)).toEqual(['Arrival at the docks', 'A bargain at the docks'])
    // A stage for an act or chapter that isn't there, or isn't that kind, goes nowhere.
    expect(spliceStage(ACTS, 'a5', 'chapters', CHAPTERS)).toBeNull()
    expect(spliceStage(ACTS, 'a0', 'scenes', SCENES)).toBeNull()
  })

  it('shows a stage still arriving with its last part not complete, and the caret on it', () => {
    const joined = spliceStage(ACTS, 'a0', 'chapters', `${CHAPTERS}\n\n## Chapter: Lanterns`, false)!
    const tree = markArriving(outlineTree(parseOutline(joined, true)), 'a0', 0)
    expect(tree[0].children.map((c) => c.complete)).toEqual([true, true, false])
    expect(arrivingKey(tree, 'a0')).toBe('a0c2')
    expect(arrivingKey(tree, 'a1')).toBeNull()
  })

  it('tells the stage the outline as it stands, marking what is in the story and where to plan', () => {
    const text = spliceStage(ACTS, 'a0', 'chapters', CHAPTERS)!
    const plan = planSoFar(text, { a0: { status: 'kept', id: 'act-1' }, a0c1: { status: 'discarded' } }, { a1: { title: 'The Split', text: 'She turns.', beats: [] } }, 'a0c0')
    expect(plan).toContain('# Act: The Arrival (in the story)')
    expect(plan).toContain('## Chapter: Rain on the Narrows (plan this one)')
    expect(plan).not.toContain("The Ferryman's Price")
    expect(plan).toContain('# Act: The Split\nPurpose: She turns.\nChapters: 2')
  })

  it('offers to plan inside an act or chapter only while it holds nothing (or only what was discarded)', () => {
    const tree = outlineTree(parseOutline(spliceStage(ACTS, 'a0', 'chapters', CHAPTERS)!, true))
    expect(canPlanInside(tree[0], {})).toBe(false)
    expect(canPlanInside(tree[0], { a0c0: { status: 'discarded' }, a0c1: { status: 'discarded' } })).toBe(true)
    expect(canPlanInside(tree[0].children[0], {})).toBe(true)
    expect(canPlanInside(tree[1], {})).toBe(true)
    expect(chaptersFor(tree[1])).toBe(2)
    expect(chaptersFor(tree[1], { about: 40 })).toBe(15)
    expect(chaptersFor({ about: undefined })).toBe(3)
  })

  it('knows what is inside what by key', () => {
    expect(isUnder('a1c2s0', 'a1c2')).toBe(true)
    expect(isUnder('a1c2s0', 'a1')).toBe(true)
    expect(isUnder('a10c0', 'a1')).toBe(false)
    expect(isUnder('a1', 'a1c2')).toBe(false)
  })

  it('plans a long story in stages unless Adam picks', () => {
    expect(defaultMode(9)).toBe('whole')
    expect(defaultMode(12)).toBe('whole')
    expect(defaultMode(24)).toBe('stages')
  })
})

describe('keeping where Adam chose', () => {
  const tree = outlineTree(parseOutline(spliceStage(ACTS, 'a0', 'chapters', CHAPTERS)!, true))

  it('puts a chapter after a chosen chapter, in that chapter’s act, leaving its suggested act a suggestion', () => {
    const natural = keepPlan(tree, {}, {}, ['a0c1'])
    expect(natural.map((i) => i.key)).toEqual(['a0', 'a0c1'])
    const placed = placeKeep(natural, 'a0c1', { at: 'after', id: 'ch-3', actId: 'act-2' })
    expect(placed).toEqual([{ key: 'a0c1', kind: 'chapter', title: "The Ferryman's Price", text: 'The debt comes due.', parent: { id: 'act-2' }, after: { id: 'ch-3' } }])
    // Among the chapters with no act, or first in an act, or at the end of the story.
    expect(placeKeep(natural, 'a0c1', { at: 'after', id: 'ch-1', actId: null })[0].parent).toEqual({ id: null })
    expect(placeKeep(natural, 'a0c1', { at: 'first', actId: 'act-2', beforeId: 'ch-4' })[0]).toMatchObject({ parent: { id: 'act-2' }, before: { id: 'ch-4' } })
    expect(placeKeep(natural, 'a0c1', { at: 'end' })[0].parent).toBeUndefined()
  })

  it('puts an act after a chosen act, at the start, or at the end; its chapters come with it', () => {
    const natural = keepPlan(tree, {}, {}, ['a0'])
    expect(natural.map((i) => i.key)).toEqual(['a0', 'a0c0', 'a0c1'])
    const after = placeKeep(natural, 'a0', { at: 'after', id: 'act-1' })
    expect(after[0]).toMatchObject({ key: 'a0', after: { id: 'act-1' } })
    expect(after[1]).toMatchObject({ key: 'a0c0', parent: { key: 'a0' } })
    expect(placeKeep(natural, 'a0', { at: 'first', actId: null, beforeId: 'act-1' })[0]).toMatchObject({ before: { id: 'act-1' } })
    expect(placeKeep(natural, 'a0', { at: 'end' })[0].after).toBeUndefined()
  })
})
