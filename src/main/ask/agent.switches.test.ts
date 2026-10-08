// The editor chat's tools under the chat overhaul's lab switches (ANCHOR, TOOLCHOICE, ASKUSER, DRAFT), each switched on
// here; off, agent.test.ts holds them to today's behaviour. Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { AskChoice } from '@shared/contracts/ask'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { EDITOR_TOOLS, EditorAgent, editorTools, toolSwitches, type AgentPlace } from './agent'

const SWITCHES = ['ANCHOR', 'TOOLCHOICE', 'ASKUSER', 'DRAFT'] as const
function switchOn(...names: (typeof SWITCHES)[number][]): void {
  for (const n of SWITCHES) delete process.env[`AIWRITE_EXP_CHAT_${n}`]
  for (const n of names) process.env[`AIWRITE_EXP_CHAT_${n}`] = 'on'
}
afterEach(() => switchOn())

const PARAS = ['Odile closed the tally book.', '“The tide’s late,” Bram said. He opened the tally book.', 'The gulls said nothing.', 'Mara waited.']

/** A scene of paragraphs with ids p1, p2...; the agent is made after the switches are set. */
function paragraphs(paras = PARAS, intent?: AgentPlace['intent']) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const doc = { type: 'doc', content: paras.map((t, i) => ({ type: 'paragraph', attrs: { pid: `p${i + 1}` }, content: [{ type: 'text', text: t }] })) }
  repo.saveSceneText(db, sceneId, doc, paras.join('\n\n'))
  const choices: AskChoice[] = []
  const agent = new EditorAgent(
    db,
    { storyId: story.id, sceneId, prefs: defaultWritingPrefs(), intent },
    () => undefined,
    () => undefined,
    (c) => choices.push(c)
  )
  return { db, sceneId, agent, choices }
}

let n = 0
const call = (agent: EditorAgent, name: string, args: Record<string, unknown>): string =>
  agent.run({ id: `c${++n}`, name, arguments: JSON.stringify(args) }).result

describe('ANCHOR: paragraphs by number, words matched as the page does', () => {
  it('is off unless switched on: no numbers, and loosely copied words are turned down as before', () => {
    switchOn()
    const { agent } = paragraphs()
    expect(call(agent, 'read_scene', {})).not.toContain('[1]')
    expect(call(agent, 'propose_edit', { find: `"The tide's late," Bram said.`, replace: 'x', why: '' })).toMatch(/^Not proposed: .*not in the scene as written/)
    expect(agent.tools).toEqual(EDITOR_TOOLS)
  })

  it('numbers read_scene’s paragraphs', () => {
    switchOn('ANCHOR')
    const out = call(paragraphs().agent, 'read_scene', {})
    expect(out).toContain('[1] Odile closed the tally book.\n\n[2] “The tide’s late,”')
    expect(out).toContain('[4] Mara waited.')
  })

  it('takes loosely copied words at the scene’s exact words, with where they are', () => {
    switchOn('ANCHOR')
    const { agent } = paragraphs()
    expect(call(agent, 'propose_edit', { find: `"The tide's late," Bram said.`, replace: '“Late again,” Bram said.', why: 'x' })).toMatch(/^Proposed/)
    expect(agent.proposals[0]).toMatchObject({ kind: 'text', find: '“The tide’s late,” Bram said.', at: { paragraph: 2, pid: 'p2', offset: 0 } })
  })

  it('finds words in the paragraph named, widening them until the page finds them there first', () => {
    switchOn('ANCHOR')
    const { agent } = paragraphs()
    expect(call(agent, 'propose_edit', { find: 'the tally book', replace: 'the ledger', why: 'x' })).toMatch(
      /^Not proposed: .*occur 2 times \(in \[1\], \[2\]\)\. Give `paragraph`/
    )
    expect(call(agent, 'propose_edit', { paragraph: 2, find: 'the tally book', replace: 'the ledger', why: 'x' })).toMatch(/^Proposed/)
    expect(agent.proposals[0]).toMatchObject({ find: 'opened the tally book.', replace: 'opened the ledger.', at: { paragraph: 2, pid: 'p2', offset: 33 } })
  })

  it('offers the closest words when they aren’t there, and steers words across paragraphs to a rewrite', () => {
    switchOn('ANCHOR')
    const { agent } = paragraphs()
    expect(call(agent, 'propose_edit', { find: 'The seagulls said nothing at all', replace: 'x', why: '' })).toMatch(
      /Did you mean «The gulls said nothing\.» in \[3\]\? Call again/
    )
    expect(call(agent, 'propose_edit', { find: 'said nothing. Mara waited', replace: 'x', why: '' })).toMatch(
      /run across paragraphs \[3\] to \[4\].*replace_paragraphs`: \[3, 4\]/
    )
    expect(agent.proposals).toHaveLength(0)
  })

  it('rewrites whole paragraphs by number, and revises an edit with a rewrite', () => {
    switchOn('ANCHOR')
    const { agent } = paragraphs()
    expect(call(agent, 'propose_edit', { find: 'Mara waited.', replace: 'Mara waited, cold.', why: 'x' })).toMatch(/change 1\./)
    const rewrite = { replace_paragraphs: [3, 4], replace: 'The gulls hushed.\n\nMara waited, cold and still.', why: 'x' }
    expect(call(agent, 'propose_rewrite', rewrite)).toMatch(/overlaps change 1/)
    expect(call(agent, 'propose_rewrite', { ...rewrite, revises: '1' })).toMatch(/^Change 1 now proposes/)
    expect(agent.proposals).toEqual([
      expect.objectContaining({
        id: '1',
        kind: 'passage',
        start: 'The gulls said nothing.',
        end: 'Mara waited.',
        original: 'The gulls said nothing.\n\nMara waited.',
        at: { start: { paragraph: 3, pid: 'p3', offset: 0 }, end: { paragraph: 4, pid: 'p4', offset: 12 } }
      })
    ])
    expect(call(agent, 'propose_rewrite', { replace_paragraphs: [1, 9], replace: 'x', why: '' })).toMatch(/paragraphs are \[1\] to \[4\]/)
  })

  it('finds a rewrite’s start in its paragraph and its end after it, loosely copied', () => {
    switchOn('ANCHOR')
    const { agent } = paragraphs()
    expect(call(agent, 'propose_rewrite', { paragraph: 2, start: 'he opened', end: 'Mara waited', replace: 'He shut it.\n\nMara left.', why: 'x' })).toMatch(/^Proposed/)
    expect(agent.proposals[0]).toMatchObject({ kind: 'passage', original: 'He opened the tally book.\n\nThe gulls said nothing.\n\nMara waited' })
  })
})

describe('TOOLCHOICE: one propose_changes tool, and one request made to propose', () => {
  it('offers propose_changes instead of the separate tools, the same list every time', () => {
    switchOn('TOOLCHOICE')
    const { agent } = paragraphs()
    const names = agent.tools.map((t) => t.name)
    expect(names.filter((x) => x.startsWith('propose_'))).toEqual(['propose_changes'])
    expect(JSON.stringify(editorTools(toolSwitches()))).toBe(JSON.stringify(agent.tools))
  })

  it('checks each change on its own and says which were proposed', () => {
    switchOn('TOOLCHOICE')
    const { agent } = paragraphs()
    const out = call(agent, 'propose_changes', {
      changes: [
        { kind: 'edit', find: 'Mara waited.', replace: 'Mara waited, cold.', why: 'Detail.' },
        { kind: 'new_entry', entry_kind: 'character', name: 'Odile Varre', summary: 'Keeps the tally.', why: 'New.' },
        { kind: 'rename', why: 'x' },
        { kind: 'poem', why: 'x' }
      ]
    })
    expect(out).toMatch(/^Proposed to the writer: 2 of 4\./)
    expect(out).toContain('1. edit: proposed as change 1.')
    expect(out).toContain('2. new_entry: proposed as change 2.')
    expect(out).toMatch(/3\. rename: Not proposed\. Give the new title\./)
    expect(out).toMatch(/4\. Not proposed: each change needs `kind`/)
    expect(agent.proposals.map((p) => p.kind)).toEqual(['text', 'newEntry'])
    expect(call(agent, 'propose_changes', { changes: [] })).toMatch(/^Not proposed: nothing is waiting/)
  })

  it('takes anchored edits too when ANCHOR is on', () => {
    switchOn('TOOLCHOICE', 'ANCHOR')
    const { agent } = paragraphs()
    expect(call(agent, 'propose_changes', { changes: [{ kind: 'edit', paragraph: 2, find: 'the tally book', replace: 'the ledger', why: 'x' }] })).toMatch(
      /^Proposed to the writer: 1 of 1/
    )
    expect(agent.proposals[0]).toMatchObject({ at: { paragraph: 2 } })
  })

  it('asks for a proposal once, for an edit, once the scene’s words are known and nothing is proposed', () => {
    switchOn('TOOLCHOICE')
    const edit = paragraphs(PARAS, 'edit').agent
    expect(edit.forceTool()).toBeNull()
    call(edit, 'read_scene', {})
    expect(edit.forceTool()).toBe('propose_changes')
    expect(edit.forceTool()).toBeNull()
    const brainstorm = paragraphs(PARAS, 'brainstorm').agent
    call(brainstorm, 'read_scene', {})
    expect(brainstorm.forceTool()).toBeNull()
    const proposed = paragraphs(PARAS, 'edit').agent
    call(proposed, 'read_scene', {})
    call(proposed, 'propose_changes', { changes: [{ kind: 'edit', find: 'Mara waited.', replace: 'Mara left.', why: 'x' }] })
    expect(proposed.forceTool()).toBeNull()
    switchOn()
    const off = paragraphs(PARAS, 'edit').agent
    call(off, 'read_scene', {})
    expect(off.forceTool()).toBeNull()
  })
})

describe('ASKUSER: one question with options, which ends the answer', () => {
  it('keeps the question, tells the window, and ends the answer with it as numbered options', () => {
    switchOn('ASKUSER')
    const { agent, choices } = paragraphs()
    expect(agent.tools.map((t) => t.name)).toContain('ask_user')
    expect(agent.ended()).toBeNull()
    const out = call(agent, 'ask_user', {
      question: 'Which way should the scene turn?',
      options: [{ label: 'Bram lies' }, { label: 'Bram confesses', detail: 'He knew all along.' }],
      recommended: 2
    })
    expect(out).toMatch(/^Asked the writer\./)
    expect(choices).toEqual([
      { question: 'Which way should the scene turn?', options: [{ label: 'Bram lies' }, { label: 'Bram confesses', detail: 'He knew all along.' }], recommended: 1 }
    ])
    expect(agent.ended()).toBe('Which way should the scene turn?\n\n1. Bram lies\n2. Bram confesses — He knew all along. (recommended)')
    expect(agent.extraParams()).toEqual({ choice: choices[0] })
    expect(call(agent, 'ask_user', { question: 'And?', options: ['a', 'b'] })).toMatch(/^Not asked: .*asked the writer a question already/)
  })

  it('turns down a question it can’t show, as a tool result', () => {
    switchOn('ASKUSER')
    const { agent } = paragraphs()
    expect(call(agent, 'ask_user', { question: 'Which?', options: [{ label: 'Only one' }] })).toMatch(/^Not asked: .*2 to 4 `options`/)
    expect(call(agent, 'ask_user', { question: 'Which?', options: ['Same', 'same'] })).toMatch(/say the same thing/)
    expect(call(agent, 'ask_user', { question: 'Which?', options: ['A', 'B'], recommended: 3 })).toMatch(/1 to 2/)
    expect(agent.choice).toBeNull()
    switchOn()
    expect(call(paragraphs().agent, 'ask_user', { question: 'Which?', options: ['A', 'B'] })).toMatch(/There is no tool called “ask_user”/)
  })
})

describe('DRAFT: new prose proposed for the writer’s own drafting', () => {
  it('proposes a draft, checked against the scene and its card', () => {
    switchOn('DRAFT')
    const { db, sceneId, agent } = paragraphs()
    repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, beats: ['Odile counts', '', 'Bram arrives late'] })
    expect(call(agent, 'propose_draft', { mode: 'add_below', direction: 'Bram admits the barrels are gone.', length: 400 })).toMatch(/^Proposed to the writer as change 1/)
    expect(agent.proposals[0]).toMatchObject({ kind: 'draft', sceneId, mode: 'add_below', direction: 'Bram admits the barrels are gone.', length: 400, status: 'pending' })
    expect(call(agent, 'propose_draft', { mode: 'redo_beat', beat: 2, direction: 'Make him later.' })).toMatch(/change 2/)
    expect(agent.proposals[1]).toMatchObject({ beat: { index: 3, text: 'Bram arrives late' } })
    expect(call(agent, 'propose_draft', { mode: 'redo_beat', beat: 5, direction: 'x' })).toMatch(/^Not proposed: .*1 to 2/)
    expect(call(agent, 'propose_draft', { mode: 'continue', at_paragraph: 3, direction: 'Carry on.' })).toMatch(/change 3/)
    expect(agent.proposals[2]).toMatchObject({ atParagraph: { paragraph: 3, pid: 'p3', offset: 23 } })
    expect(call(agent, 'propose_draft', { mode: 'continue', at_paragraph: 7, direction: 'x' })).toMatch(/paragraphs are \[1\] to \[4\]/)
    expect(call(agent, 'propose_draft', { mode: 'poem', direction: 'x' })).toMatch(/`mode` must be one of/)
    expect(call(agent, 'propose_draft', { mode: 'generate', direction: ' ' })).toMatch(/Give the `direction`/)
    expect(call(agent, 'propose_draft', { mode: 'add_below', direction: 'x', length: 9 })).toMatch(/50 to 5,000/)
  })

  it('has nothing to carry on from in an empty scene', () => {
    switchOn('DRAFT')
    const { agent } = paragraphs([])
    expect(call(agent, 'propose_draft', { mode: 'continue', direction: 'x' })).toMatch(/no words yet.*use mode generate/)
    expect(call(agent, 'propose_draft', { mode: 'generate', direction: 'Odile counts the barrels.' })).toMatch(/^Proposed/)
  })
})
