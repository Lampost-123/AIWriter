import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/contracts/checks'
import type { NamedEntry, SceneNames, StateLine } from '@shared/contracts/manuscript'
import { chapterPart, chapterTag, factLine, MAX_CHECKS, MAX_ENTITIES, pickSlips, type Placed, type SlipInput } from './pickSlips'

const line = (text: string, where: string, here = false): StateLine => ({ kind: 'happened', text, where, here })

function entry(id: string, over: Partial<NamedEntry> = {}): NamedEntry {
  return { id, kind: 'character', name: id, aliases: [], summary: `${id} summary`, image: null, absent: null, state: [], voice: null, ...over }
}

function names(entries: NamedEntry[], cast: Partial<SceneNames['cast']> = {}): SceneNames {
  return { sceneId: 's', storyId: 'st', label: 'Book 1, Ch 2, Sc 1', entries, cast: { povId: null, presentIds: [], locationId: null, ...cast }, relationships: [] }
}

const at = (block: number, offset = 0): Placed => ({ anchor: { pid: `p${block}`, offset }, block })

function issue(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id,
    sceneId: 's',
    storyId: 'st',
    kind: 'continuity',
    severity: 'warning',
    status: 'open',
    quote: 'long white arm',
    message: 'The same image in Ch 2, Sc 1.',
    sources: [],
    fix: null,
    memoryFix: null,
    createdAt: '',
    updatedAt: '',
    ...over
  } as Issue
}

function input(over: Partial<SlipInput> = {}): SlipInput {
  return { names: null, firstMentions: new Map(), issues: [], openIssues: 0, memory: null, dismissed: [], ...over }
}

const ids = (i: SlipInput): string[] => pickSlips(i).map((s) => s.id)

describe('which notes the margin shows', () => {
  it('always has the scene card first, pinned at the top, unless it is put away', () => {
    expect(pickSlips(input())).toEqual([{ id: 'card', kind: 'card', anchor: 'top', pinned: true }])
    expect(ids(input({ dismissed: ['card'] }))).toEqual([])
  })

  it('reads chapters and tags from places in plain words', () => {
    expect(chapterPart('Book 1, Ch 12, Sc 3')).toBe('Book 1, Ch 12')
    expect(chapterPart('')).toBe('')
    expect(chapterTag('Book 1, Ch 1, Sc 2')).toBe('Ch 1')
    // The latest thing that happened before this scene: not one from this scene, nor a field.
    const state: StateLine[] = [line('Old', 'Book 1, Ch 1, Sc 1'), line('Newer', 'Book 1, Ch 1, Sc 2'), line('Here', 'Book 1, Ch 2, Sc 1', true), { kind: 'field', text: 'Hair: grey', where: '', here: false }]
    expect(factLine(state)?.text).toBe('Newer')
  })

  it('gives an entity a note only when it is named, in the story now, and has something worth showing', () => {
    const e = [
      entry('named'),
      entry('absent', { absent: 'Not in the story yet at this point' }),
      entry('blank', { summary: '' }),
      entry('unmentioned'),
      entry('thread', { kind: 'thread' }),
      entry('term', { kind: 'glossary' }),
      entry('onCard', { summary: '' })
    ]
    const m = new Map(['named', 'absent', 'blank', 'thread', 'term', 'onCard'].map((id, i) => [id, at(i)]))
    expect(ids(input({ names: names(e, { presentIds: ['onCard'] }), firstMentions: m }))).toEqual(['card', 'entity:named', 'entity:onCard'])
  })

  it('never gives the point-of-view character a note (the scene card names them); scores the card, a fact from this chapter, and lore rules', () => {
    const e = [
      entry('pov'),
      entry('present'),
      entry('named'),
      entry('recent', { state: [line('Lost her hand', 'Book 1, Ch 2, Sc 0')] }),
      entry('rule', { kind: 'lore', hardRule: true }),
      entry('place', { kind: 'place' })
    ]
    const m = new Map(e.map((x, i) => [x.id, at(i)]))
    const slips = pickSlips(input({ names: names(e, { povId: 'pov', presentIds: ['present'], locationId: 'place' }), firstMentions: m }))
    const score = Object.fromEntries(slips.filter((s) => s.entity).map((s) => [s.entity!.entry.id, s.entity!.score]))
    expect(score).toEqual({ present: 2, named: 1, recent: 2, rule: 3, place: 2 })
    expect(slips.map((s) => s.id)).not.toContain('entity:pov')
    // The tags: when the fact happened, and "In memory" for lore.
    const tags = Object.fromEntries(slips.filter((s) => s.entity).map((s) => [s.entity!.entry.id, s.entity!.tag]))
    expect(tags.recent).toBe('Since Ch 2')
    expect(tags.rule).toBe('In memory')
    expect(tags.named).toBeNull()
    expect(slips.find((s) => s.id === 'entity:place')?.kind).toBe('place')
    expect(slips.find((s) => s.id === 'entity:rule')?.kind).toBe('lore')
  })

  it('keeps two notes to a paragraph at most (the lower score goes) and six in all, shown in the order first named', () => {
    // Three in paragraph 0: the one only named goes.
    const crowd = [entry('a'), entry('b'), entry('c', { state: [line('Lost her hand', 'Book 1, Ch 2, Sc 0')] })]
    const m1 = new Map([
      ['a', at(0, 5)],
      ['b', at(0, 20)],
      ['c', at(0, 40)]
    ])
    expect(ids(input({ names: names(crowd, { presentIds: ['b', 'c'] }), firstMentions: m1 }))).toEqual(['card', 'entity:b', 'entity:c'])
    // Ten in ten paragraphs: six, the highest scores, in reading order.
    const many = Array.from({ length: 10 }, (_, i) => entry(`e${i}`))
    const m2 = new Map(many.map((x, i) => [x.id, at(9 - i)]))
    const slips = pickSlips(input({ names: names(many, { presentIds: ['e0', 'e1'] }), firstMentions: m2 }))
    const shown = slips.filter((s) => s.entity)
    expect(shown).toHaveLength(MAX_ENTITIES)
    expect(shown.map((s) => s.entity!.entry.id)).toContain('e0')
    expect(shown.map((s) => s.entity!.entry.id)).toContain('e1')
    const blocks = shown.map((s) => m2.get(s.entity!.entry.id)!.block)
    expect(blocks).toEqual([...blocks].sort((a, b) => a - b))
  })

  it('gives the same notes in the same order each time (ties by where they are first named)', () => {
    const e = [entry('x'), entry('y'), entry('z')]
    const m = new Map([
      ['z', at(1, 0)],
      ['x', at(2, 0)],
      ['y', at(1, 10)]
    ])
    const once = ids(input({ names: names(e), firstMentions: m }))
    expect(once).toEqual(['card', 'entity:z', 'entity:y', 'entity:x'])
    expect(ids(input({ names: names([...e].reverse()), firstMentions: m }))).toEqual(once)
  })

  it('leaves out what Adam put away, and lets the next one in', () => {
    const many = Array.from({ length: 7 }, (_, i) => entry(`e${i}`))
    const m = new Map(many.map((x, i) => [x.id, at(i)]))
    expect(ids(input({ names: names(many), firstMentions: m })).length).toBe(1 + MAX_ENTITIES)
    const left = ids(input({ names: names(many), firstMentions: m, dismissed: ['entity:e0'] }))
    expect(left).not.toContain('entity:e0')
    expect(left.length).toBe(1 + MAX_ENTITIES)
  })

  it('shows three checks at most, must-fix first, and says how many more are in the Issues tab', () => {
    const list = [
      { ...at(4), issue: issue('i1') },
      { ...at(1), issue: issue('i2', { severity: 'minor' }) },
      { ...at(3), issue: issue('i3', { severity: 'must-fix' }) },
      { ...at(2), issue: issue('i4') },
      { ...at(0), issue: issue('i5', { status: 'ignored' }) }
    ]
    const slips = pickSlips(input({ issues: list, openIssues: 5 })).filter((s) => s.check)
    expect(slips).toHaveLength(MAX_CHECKS)
    // Must-fix and the two warnings, in reading order; the minor one is left to the Issues tab.
    expect(slips.map((s) => s.id)).toEqual(['issue:i4', 'issue:i3', 'issue:i1'])
    expect(slips.map((s) => s.check!.more)).toEqual([0, 0, 2])
    // Put away: the next one takes its place.
    const after = pickSlips(input({ issues: list, openIssues: 5, dismissed: ['issue:i3'] })).filter((s) => s.check)
    expect(after.map((s) => s.id)).toEqual(['issue:i2', 'issue:i4', 'issue:i1'])
  })

  it('shows the memory’s note where its first fact’s words are, once it has updated something', () => {
    const memory = { runId: 'r1', count: 2, lines: ['The night ferry is in early', 'Iska Vey is aboard'], at: at(5) }
    const slips = pickSlips(input({ memory }))
    expect(slips.map((s) => s.id)).toEqual(['card', 'memory:r1'])
    expect(slips[1].anchor).toEqual(at(5).anchor)
    expect(slips[1].memory).toEqual({ runId: 'r1', count: 2, lines: memory.lines })
    expect(ids(input({ memory: { ...memory, count: 0 } }))).toEqual(['card'])
    expect(ids(input({ memory: { ...memory, at: null } }))).toEqual(['card'])
    expect(ids(input({ memory, dismissed: ['memory:r1'] }))).toEqual(['card'])
  })
})
