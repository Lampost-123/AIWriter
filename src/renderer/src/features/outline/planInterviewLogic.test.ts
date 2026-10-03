import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import { fillOnCard, filledMessage, listNames, planNote, unfill } from './planInterviewLogic'
import { parseOutline } from './parse'
import { keepPlan, outlineTree } from './tree'

describe('Interview me on a scene card', () => {
  const fill = {
    goal: 'Get across the river',
    conflict: 'The ferryman wants more',
    beats: ['She reaches the ferry', 'He names his price'],
    outcome: 'She crosses',
    mood: 'Tense',
    povId: 'mara',
    presentIds: ['mara', 'tobin'],
    locationId: 'docks'
  }

  it('fills only the parts of the card that are empty', () => {
    const card = { ...emptySceneCard(), goal: 'My own goal', beats: ['  '], presentIds: ['wren'], mood: '' }
    const { patch, names } = fillOnCard(card, fill)
    expect(patch).toEqual({
      beats: fill.beats,
      conflict: fill.conflict,
      outcome: fill.outcome,
      mood: 'Tense',
      povId: 'mara',
      locationId: 'docks'
    })
    expect(names).toEqual(['beats', 'conflict', 'outcome', 'mood', 'point of view', 'location'])
    expect(fillOnCard({ ...emptySceneCard(), goal: 'x' }, { goal: 'y', mood: '  ', beats: [] })).toEqual({ patch: {}, names: [] })
  })

  it('takes back on Undo only what is still as it was put in', () => {
    const { patch } = fillOnCard(emptySceneCard(), fill)
    const now = { ...emptySceneCard(), ...patch, goal: 'Changed since', beats: [...fill.beats] }
    expect(unfill(now, patch)).toEqual({ conflict: '', beats: [], outcome: '', mood: '', povId: null, presentIds: [], locationId: null })
  })

  it('says what it filled in plain words', () => {
    expect(listNames(['goal'])).toBe('goal')
    expect(listNames(['beats', 'goal', 'mood'])).toBe('beats, goal and mood')
    expect(filledMessage(['beats', 'goal'])).toBe('Filled in the beats and goal from your answers.')
    expect(filledMessage([])).toBe('Your scene card already had everything your answers covered, so nothing changed.')
    expect(planNote('scene', 0)).toBe('When you’re done, your answers fill in the empty parts of the card.')
    expect(planNote('chapter', 2)).toBe('2 answers so far.')
  })
})

describe('a chapter’s plan', () => {
  // The reply has no chapter heading: the helper reads it after the chapter's own (helperStore.treeOf).
  const lead = '## Chapter: The Ferry\n'
  const reply =
    'Goal: Mara gets the ledger back.\n\n### Scene: A letter at dawn\nWhen: Day 2, morning\nSummary: A letter comes.\n- It comes.\n- She reads it.\n\n### Scene: The market\nSummary: She asks around.\n- A trader knows.'

  it('reads the goal and scene cards under the chapter', () => {
    const tree = outlineTree(parseOutline(lead + reply, true))
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'chapter', title: 'The Ferry', text: 'Mara gets the ledger back.' })
    expect(tree[0].children.map((c) => c.title)).toEqual(['A letter at dawn', 'The market'])
  })

  it('keeps a scene card into the chapter itself, which starts out kept', () => {
    const tree = outlineTree(parseOutline(lead + reply, true))
    const decisions = { [tree[0].key]: { status: 'kept' as const, id: 'ch-1' } }
    const items = keepPlan(tree, decisions, {}, [tree[0].children[1].key])
    expect(items).toEqual([
      {
        key: tree[0].children[1].key,
        kind: 'scene',
        title: 'The market',
        text: 'She asks around.',
        beats: ['A trader knows.'],
        parent: { id: 'ch-1' }
      }
    ])
    expect(keepPlan(tree, decisions, {}, 'all').map((i) => i.kind)).toEqual(['scene', 'scene'])
  })
})
