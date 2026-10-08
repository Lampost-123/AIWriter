// The editor chat's text tools (chat Phase 3, lab switch TEXTTOOLS): find_mentions, and propose_changes' kinds insert,
// cut and beats. Each test turns on only the switches it names (the rest off). Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { ChatSwitch } from '@shared/askIntent'
import type { Proposal } from '@shared/contracts/ask'
import type { ToolSpec } from '@shared/types'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { saveBeatMarks } from '../beats/marks'
import { EditorAgent, editorTools, toolSwitches } from './agent'

const switchOn = (...names: ChatSwitch[]): void => chatSwitches(names)
afterEach(() => chatSwitches(null))

type Run = string | { em: string }
/** The open scene: three paragraphs, a scene break, a fourth (ids p1, p2, p3, p5); a later scene after it. */
const BLOCKS: (Run[] | '---')[] = [
  ['Odile lit the oil lamp.'],
  ['Rain on the slates all night.'],
  ['Bram said nothing about the ', { em: 'oil lamp' }, '.'],
  '---',
  ['Mara waited. The lamps were out.']
]

function world(beats: string[] = []) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const sceneId = outline.scenes[0].id
  const content = BLOCKS.map((b, i) =>
    b === '---'
      ? { type: 'horizontalRule' }
      : {
          type: 'paragraph',
          attrs: { pid: `p${i + 1}` },
          content: b.map((r) => (typeof r === 'string' ? { type: 'text', text: r } : { type: 'text', text: r.em, marks: [{ type: 'italic' }] }))
        }
  )
  const text = BLOCKS.map((b) => (b === '---' ? '* * *' : b.map((r) => (typeof r === 'string' ? r : r.em)).join(''))).join('\n\n')
  repo.saveSceneText(db, sceneId, { type: 'doc', content }, text)
  if (beats.length) repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, beats })
  const later = repo.createScene(db, outline.chapters[0].id, { title: 'The Stair', afterId: sceneId })
  repo.saveSceneText(db, later.id, { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'q1' }, content: [{ type: 'text', text: 'The oil lamp was gone.' }] }] }, 'The oil lamp was gone.')
  const agent = new EditorAgent(db, { storyId: story.id, sceneId, prefs: defaultWritingPrefs(), intent: 'edit' }, () => undefined, () => undefined)
  return { db, sceneId, agent }
}

let n = 0
const run = (agent: EditorAgent, name: string, args: Record<string, unknown>) => agent.run({ id: `c${++n}`, name, arguments: JSON.stringify(args) })
const call = (agent: EditorAgent, name: string, args: Record<string, unknown>): string => run(agent, name, args).result
const change = (agent: EditorAgent, item: Record<string, unknown>): string => call(agent, 'propose_changes', { changes: [{ why: 'x', ...item }] })

const itemKinds = (tools: ToolSpec[]): string[] => {
  const t = tools.find((x) => x.name === 'propose_changes') as unknown as { parameters: { properties: { changes: { items: { properties: { kind: { enum: string[] } } } } } } }
  return t.parameters.properties.changes.items.properties.kind.enum
}

describe('the switch', () => {
  it('off: no find_mentions, and propose_changes has none of the text kinds', () => {
    switchOn('TOOLCHOICE', 'ANCHOR')
    const tools = editorTools(toolSwitches())
    expect(tools.map((t) => t.name)).not.toContain('find_mentions')
    expect(itemKinds(tools)).not.toEqual(expect.arrayContaining(['insert']))
    const { agent } = world()
    expect(change(agent, { kind: 'insert', after_paragraph: 1, text: 'She paused.' })).toMatch(/Not proposed: each change needs `kind`/)
    expect(call(agent, 'find_mentions', { words: 'lamp' })).toMatch(/no tool called/)
  })

  it('on: find_mentions, and the kinds insert and cut with ANCHOR, beats with or without it', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const tools = editorTools(toolSwitches())
    expect(tools.map((t) => t.name)).toContain('find_mentions')
    expect(itemKinds(tools)).toEqual(expect.arrayContaining(['insert', 'cut', 'beats']))
    switchOn('TOOLCHOICE', 'TEXTTOOLS')
    const plain = editorTools(toolSwitches())
    expect(itemKinds(plain)).toContain('beats')
    expect(itemKinds(plain)).not.toContain('insert')
  })
})

describe('find_mentions', () => {
  it('lists every place in reading order, with paragraph, id and the words around it; later scenes marked later', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent } = world()
    const { result, step } = run(agent, 'find_mentions', { words: 'oil lamp' })
    expect(result).toContain('“oil lamp” in ')
    expect(result).toContain('3 times in 2 scenes')
    expect(result).toContain('- [1] id p1: Odile lit the «oil lamp».')
    expect(result).toContain('- [3] id p3: Bram said nothing about the «oil lamp».')
    expect(result).toMatch(/Sc 2 “The Stair” \(later — after the open scene[^\n]*: 1\n- \[1\] id q1: The «oil lamp» was gone\./)
    expect(result.indexOf('id p1')).toBeLessThan(result.indexOf('id q1'))
    expect(step).toMatchObject({ kind: 'mentions', summary: '“oil lamp”', outcome: '3 times in 2 scenes', status: 'done' })
  })

  it('keeps to one scene with scope scene, and to whole words with whole_word', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent } = world()
    expect(call(agent, 'find_mentions', { words: 'oil lamp', scope: 'scene' })).toContain('2 times in 1 scene')
    expect(call(agent, 'find_mentions', { words: 'lamp' })).toContain('4 times in 2 scenes')
    expect(call(agent, 'find_mentions', { words: 'lamp', whole_word: true })).toContain('3 times in 2 scenes')
    const none = run(agent, 'find_mentions', { words: 'harpoon' })
    expect(none.result).toMatch(/isn't in the words of/)
    expect(none.step.outcome).toBe('not found')
  })

  it('finds an entry by all its names, as whole words', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { db, agent } = world()
    repo.createEntry(db, 'character', { name: 'Mara Venn', aliases: ['Mara'] })
    const out = call(agent, 'find_mentions', { words: 'mara venn' })
    expect(out).toContain('(Mara Venn, by any of its names: Mara Venn, Mara)')
    expect(out).toContain('- [4] id p5: «Mara» waited. The lamps were out.')
    expect(out).toContain('Mara Venn in the memory, scene by scene')
  })
})

describe('insert', () => {
  it('proposes new paragraphs after or before a paragraph, by its number or its id', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent, sceneId } = world()
    expect(change(agent, { kind: 'insert', after_paragraph: 2, text: '[3] She *almost* spoke.\n\n\n\nShe did not.' })).toMatch(/^Proposed to the writer: 1 of 1/)
    expect(agent.proposals[0]).toMatchObject({
      kind: 'insert',
      sceneId,
      where: 'after',
      at: { paragraph: 2, pid: 'p2', offset: 0 },
      near: 'Rain on the slates all night.',
      text: 'She *almost* spoke.\n\nShe did not.'
    })
    expect(change(agent, { kind: 'insert', before_paragraph: 'p3', text: 'Thunder.' })).toMatch(/proposed as change 2/)
    expect(agent.proposals[1]).toMatchObject({ where: 'before', at: { paragraph: 3, pid: 'p3' }, near: 'Bram said nothing about the *oil lamp*.' })
  })

  it('says plainly what is wrong', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent } = world()
    expect(change(agent, { kind: 'insert', text: 'x' })).toMatch(/Give one of `after_paragraph` or `before_paragraph`/)
    expect(change(agent, { kind: 'insert', after_paragraph: 1, before_paragraph: 2, text: 'x' })).toMatch(/Give one of/)
    expect(change(agent, { kind: 'insert', after_paragraph: 9, text: 'x' })).toMatch(/paragraphs are \[1\] to \[4\]/)
    expect(change(agent, { kind: 'insert', after_paragraph: 1, text: '  ' })).toMatch(/Give the new words as `text`/)
    expect(change(agent, { kind: 'insert', after_paragraph: 1, text: 'Odile lit the oil lamp.' })).toMatch(/are paragraph \[1\] as it is/)
    expect(agent.proposals).toHaveLength(0)
  })
})

describe('cut', () => {
  it('proposes whole paragraphs out, with their words as read', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent } = world()
    expect(change(agent, { kind: 'cut', from_paragraph: 2, to_paragraph: 3 })).toMatch(/proposed as change 1/)
    expect(agent.proposals[0]).toMatchObject({
      kind: 'cut',
      from: { paragraph: 2, pid: 'p2', offset: 0 },
      to: { paragraph: 3, pid: 'p3', offset: 37 },
      paragraphs: ['Rain on the slates all night.', 'Bram said nothing about the *oil lamp*.']
    })
    // One paragraph: to_paragraph may be left out.
    expect(change(agent, { kind: 'cut', from_paragraph: 4 })).toMatch(/proposed as change 2/)
    expect(agent.proposals[1]).toMatchObject({ paragraphs: ['Mara waited. The lamps were out.'] })
  })

  it('never runs across a scene break, nor takes the whole scene', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent } = world()
    expect(change(agent, { kind: 'cut', from_paragraph: 3, to_paragraph: 4 })).toMatch(/run across a scene break/)
    expect(change(agent, { kind: 'cut', from_paragraph: 3, to_paragraph: 1 })).toMatch(/comes after `to_paragraph`/)
    expect(agent.proposals).toHaveLength(0)
  })

  it('doesn’t overlap other changes waiting: an edit, an insert beside it, a cut', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent } = world()
    expect(change(agent, { kind: 'edit', paragraph: 2, find: 'all night', replace: 'till dawn' })).toMatch(/proposed as change 1/)
    expect(change(agent, { kind: 'cut', from_paragraph: 1, to_paragraph: 2 })).toMatch(/overlap change 1/)
    expect(change(agent, { kind: 'insert', after_paragraph: 3, text: 'Then quiet.' })).toMatch(/proposed as change 2/)
    expect(change(agent, { kind: 'cut', from_paragraph: 3 })).toMatch(/Change 2 puts new words next to paragraph \[3\]/)
    expect(change(agent, { kind: 'cut', from_paragraph: 1 })).toMatch(/proposed as change 3/)
    expect(change(agent, { kind: 'edit', paragraph: 1, find: 'oil lamp', replace: 'lantern' })).toMatch(/in a paragraph change 3 cuts/)
    expect(change(agent, { kind: 'insert', before_paragraph: 1, text: 'Dusk.' })).toMatch(/one change 3 cuts/)
  })

  it('shows in the call’s summary with the other kinds', () => {
    switchOn('TOOLCHOICE', 'ANCHOR', 'TEXTTOOLS')
    const { agent } = world()
    const { step } = run(agent, 'propose_changes', {
      changes: [
        { kind: 'insert', after_paragraph: 1, text: 'She paused.', why: 'x' },
        { kind: 'cut', from_paragraph: 2, why: 'x' }
      ]
    })
    expect(step).toMatchObject({ summary: '1 insert, 1 cut', outcome: '2 proposed' })
  })
})

describe('beats', () => {
  const beatsOf = (p: Proposal | undefined) => (p?.kind === 'beats' ? p : null)

  it('puts one in, rewords one, takes one out, or replaces the list, on the card as it is', () => {
    switchOn('TOOLCHOICE', 'TEXTTOOLS')
    const { agent } = world(['Odile lights the lamp', '', 'Bram arrives'])
    expect(change(agent, { kind: 'beats', op: 'insert', text: '3. She finds the letter' })).toMatch(/proposed as change 1/)
    expect(beatsOf(agent.proposals[0])).toMatchObject({ op: 'insert', index: 3, before: ['Odile lights the lamp', 'Bram arrives'], beats: ['Odile lights the lamp', 'Bram arrives', 'She finds the letter'] })
    const other = world(['A', 'B', 'C'])
    expect(change(other.agent, { kind: 'beats', op: 'edit', index: 2, text: 'B, louder' })).toMatch(/proposed/)
    expect(beatsOf(other.agent.proposals[0])?.beats).toEqual(['A', 'B, louder', 'C'])
    const third = world(['A', 'B', 'C'])
    expect(change(third.agent, { kind: 'beats', op: 'remove', index: 1 })).toMatch(/proposed/)
    expect(beatsOf(third.agent.proposals[0])).toMatchObject({ op: 'remove', index: 1, beats: ['B', 'C'] })
    const fourth = world(['A'])
    expect(change(fourth.agent, { kind: 'beats', beats: ['X', 'Y'] })).toMatch(/proposed/)
    expect(beatsOf(fourth.agent.proposals[0])).toMatchObject({ op: 'replace', before: ['A'], beats: ['X', 'Y'] })
  })

  it('turns down what makes no sense, and a second change to the same beats', () => {
    switchOn('TOOLCHOICE', 'TEXTTOOLS')
    const { agent } = world(['A', 'B'])
    expect(change(agent, { kind: 'beats', op: 'edit', index: 5, text: 'x' })).toMatch(/`index` is the beat to reword: 1 to 2/)
    expect(change(agent, { kind: 'beats', beats: ['A', 'B'] })).toMatch(/as they are/)
    expect(change(agent, { kind: 'beats' })).toMatch(/Give `beats`/)
    expect(change(agent, { kind: 'beats', op: 'remove', index: 2 })).toMatch(/proposed as change 1/)
    expect(change(agent, { kind: 'beats', op: 'insert', text: 'C' })).toMatch(/Change 1 already changes this scene's beats/)
    expect(change(agent, { kind: 'beats', op: 'insert', text: 'C', revises: '1' })).toMatch(/change 1 now proposes this instead/)
  })

  it('warns when the scene has beat markers on the page', () => {
    switchOn('TOOLCHOICE', 'TEXTTOOLS')
    const { agent, db, sceneId } = world(['A', 'B'])
    saveBeatMarks(db, sceneId, { sceneId, sessionId: 'b1', of: 2, mode: 'whole', beats: [{ index: 1, pids: ['p1'], versions: [] }] })
    expect(change(agent, { kind: 'beats', op: 'insert', index: 1, text: 'Before A' })).toMatch(/beat markers on the page/)
    expect(beatsOf(agent.proposals[0])).toMatchObject({ marks: true, beats: ['Before A', 'A', 'B'] })
  })
})
