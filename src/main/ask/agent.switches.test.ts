// The editor chat's tools under the chat overhaul's lab switches (ANCHOR, TOOLCHOICE, ASKUSER, DRAFT): all on by
// default; each test here turns on only the ones it names (the rest off). With all off, agent.test.ts holds them to
// the old behaviour. Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { ChatSwitch } from '@shared/askIntent'
import type { AskChoice } from '@shared/contracts/ask'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { EDITOR_TOOLS, EditorAgent, editorTools, toolSwitches, type AgentPlace } from './agent'

/** Only the switches named on, the rest off. */
const switchOn = (...names: ChatSwitch[]): void => chatSwitches(names)
afterEach(() => chatSwitches(null))

describe('the defaults', () => {
  it('are all on, each turned off only by =off', () => {
    chatSwitches(null)
    expect(toolSwitches()).toEqual({ anchor: true, toolChoice: true, askUser: true, draft: true, actFirst: true, textTools: true, storyTools: true })
    process.env.AIWRITE_EXP_CHAT_ANCHOR = 'off'
    process.env.AIWRITE_EXP_CHAT_DRAFT = ' OFF '
    process.env.AIWRITE_EXP_CHAT_ASKUSER = 'on'
    process.env.AIWRITE_EXP_CHAT_ACTFIRST = 'off'
    process.env.AIWRITE_EXP_CHAT_TEXTTOOLS = 'off'
    process.env.AIWRITE_EXP_CHAT_STORYTOOLS = 'off'
    expect(toolSwitches()).toEqual({ anchor: false, toolChoice: true, askUser: true, draft: false, actFirst: false, textTools: false, storyTools: false })
    chatSwitches(null)
    const names = editorTools(toolSwitches()).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['propose_changes', 'ask_user', 'propose_draft', 'list_issues', 'chapter_card', 'list_threads']))
    expect(names).not.toContain('propose_edit')
    expect(names).not.toContain('scene_issues')
  })
})

const PARAS = ['Odile closed the tally book.', '“The tide’s late,” Bram said. He opened the tally book.', 'The gulls said nothing.', 'Mara waited.']

/** A scene of paragraphs with ids p1, p2...; the agent is made after the switches are set. */
function paragraphs(paras = PARAS, intent?: AgentPlace['intent'], more: Partial<AgentPlace> = {}) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const doc = { type: 'doc', content: paras.map((t, i) => ({ type: 'paragraph', attrs: { pid: `p${i + 1}` }, content: [{ type: 'text', text: t }] })) }
  repo.saveSceneText(db, sceneId, doc, paras.join('\n\n'))
  const choices: AskChoice[] = []
  const agent = new EditorAgent(
    db,
    { storyId: story.id, sceneId, prefs: defaultWritingPrefs(), intent, ...more },
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

  it('takes the words sent in the briefing (SCENE’s page) as read: the first request may already be made to propose', () => {
    switchOn('TOOLCHOICE')
    const onPage = paragraphs(PARAS, 'edit', { wordsOnPage: true }).agent
    expect(onPage.knowsWords()).toBe(true)
    expect(onPage.forceTool()).toBe('propose_changes')
    expect(onPage.forceTool()).toBeNull()
    // Not an edit: never made to propose, page or not.
    expect(paragraphs(PARAS, 'unsure', { wordsOnPage: true }).agent.forceTool()).toBeNull()
    // Without the page, as before: only once read.
    const without = paragraphs(PARAS, 'edit').agent
    expect(without.knowsWords()).toBe(false)
    expect(without.forceTool()).toBeNull()
  })
})

describe('TOOLCHOICE with ASKUSER: propose_changes can carry the question, alone', () => {
  const question = { kind: 'ask', question: 'Which passage should be tighter?', options: [{ label: 'The opening' }, { label: 'Bram’s line', detail: 'Paragraph 2.' }], recommended: 1 }

  it('offers the ask kind only with ASKUSER on, and says it goes alone', () => {
    switchOn('TOOLCHOICE', 'ASKUSER')
    const spec = paragraphs().agent.tools.find((t) => t.name === 'propose_changes')!
    expect(spec.description).toMatch(/- ask: .*An ask goes alone, as the only item: given with changes, it is not asked/)
    expect(JSON.stringify(spec.parameters)).toContain('"ask"')
    switchOn('TOOLCHOICE')
    const without = paragraphs().agent.tools.find((t) => t.name === 'propose_changes')!
    expect(without.description).not.toMatch(/- ask:/)
    expect(JSON.stringify(without.parameters)).not.toContain('"ask"')
    expect(call(paragraphs().agent, 'propose_changes', { changes: [question] })).toMatch(/Not proposed: each change needs `kind`/)
  })

  it('asks as ask_user does when it is the only item: the choice is kept, the window told, the answer ended', () => {
    switchOn('TOOLCHOICE', 'ASKUSER')
    const { agent, choices } = paragraphs(PARAS, 'edit')
    call(agent, 'read_scene', {})
    expect(agent.forceTool()).toBe('propose_changes')
    const out = call(agent, 'propose_changes', { changes: [{ ...question, why: 'Two passages could be meant.' }] })
    expect(out).toMatch(/^Asked the writer\. Your answer ends here/)
    expect(choices).toEqual([{ question: 'Which passage should be tighter?', options: [{ label: 'The opening' }, { label: 'Bram’s line', detail: 'Paragraph 2.' }], recommended: 0 }])
    expect(agent.ended()).toBe('Which passage should be tighter?\n\n1. The opening (recommended)\n2. Bram’s line — Paragraph 2.')
    expect(agent.extraParams()).toEqual({ choice: choices[0] })
    expect(agent.proposals).toEqual([])
    expect(agent.forceTool()).toBeNull()
    expect(call(agent, 'propose_changes', { changes: [question] })).toMatch(/^Not asked: .*asked the writer a question already/)
  })

  it('checks the question as ask_user does', () => {
    switchOn('TOOLCHOICE', 'ASKUSER')
    const { agent, choices } = paragraphs()
    expect(call(agent, 'propose_changes', { changes: [{ kind: 'ask', question: 'Which?', options: ['Only one'] }] })).toMatch(/^Not asked: .*2 to 4 `options`/)
    expect(call(agent, 'propose_changes', { changes: [{ kind: 'Ask', question: 'Which?', options: ['A', 'B'], recommended: 3 }] })).toMatch(/1 to 2/)
    expect(call(agent, 'propose_changes', { changes: [question, question] })).toMatch(/^Not asked: .*Ask one question only/)
    expect(agent.choice).toBeNull()
    expect(choices).toEqual([])
  })

  it('beside changes, the ask is not asked and the changes are checked as usual', () => {
    switchOn('TOOLCHOICE', 'ASKUSER')
    const { agent, choices } = paragraphs()
    const out = call(agent, 'propose_changes', { changes: [question, { kind: 'edit', find: 'Mara waited.', replace: 'Mara left.', why: 'Sharper.' }] })
    expect(out).toMatch(/^Proposed to the writer: 1 of 1\./)
    expect(out).toContain('1. ask: Not asked: an ask goes alone, never beside changes.')
    expect(out).toContain('2. edit: proposed as change 1.')
    expect(out).not.toMatch(/Fix the ones not proposed/)
    expect(agent.choice).toBeNull()
    expect(choices).toEqual([])
    expect(agent.ended()).toBeNull()
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

describe('ACTFIRST: an edit reads before it asks, and new prose is made to draft', () => {
  const ask = { question: 'Which shawl do you mean?', options: [{ label: 'This scene' }, { label: 'The vigil scene' }] }

  it('sends back an edit’s question asked before any words are read, once; after reading it may ask', () => {
    switchOn('TOOLCHOICE', 'ASKUSER', 'ACTFIRST')
    const { agent, choices } = paragraphs(PARAS, 'edit')
    expect(agent.knowsWords()).toBe(false)
    expect(call(agent, 'ask_user', ask)).toMatch(/^Not asked: the writer hasn't seen it\. Read the words first: read_scene gives the open scene/)
    expect(call(agent, 'propose_changes', { changes: [{ kind: 'ask', ...ask }] })).toMatch(/^Asked the writer\./)
    expect(choices).toHaveLength(1)
    const read = paragraphs(PARAS, 'edit').agent
    call(read, 'read_scene', {})
    expect(read.knowsWords()).toBe(true)
    expect(call(read, 'ask_user', ask)).toMatch(/^Asked the writer\./)
  })

  it('also through propose_changes, and never for a question that isn’t an edit, words quoted, or with the switch off', () => {
    switchOn('TOOLCHOICE', 'ASKUSER', 'ACTFIRST')
    expect(call(paragraphs(PARAS, 'edit').agent, 'propose_changes', { changes: [{ kind: 'ask', ...ask }] })).toMatch(/^Not asked: .*Read the words first/)
    expect(call(paragraphs(PARAS, 'unsure').agent, 'ask_user', ask)).toMatch(/^Asked the writer\./)
    const quoted = paragraphs(PARAS, 'edit', { wordsInQuestion: true }).agent
    expect(quoted.knowsWords()).toBe(true)
    expect(call(quoted, 'ask_user', ask)).toMatch(/^Asked the writer\./)
    switchOn('TOOLCHOICE', 'ASKUSER')
    expect(call(paragraphs(PARAS, 'edit').agent, 'ask_user', ask)).toMatch(/^Asked the writer\./)
  })

  it('makes a request for new prose call propose_draft once the words are read (with DRAFT); other edits propose_changes', () => {
    switchOn('TOOLCHOICE', 'DRAFT', 'ACTFIRST')
    const draft = paragraphs(PARAS, 'edit', { newProse: true }).agent
    expect(draft.forceTool()).toBeNull()
    call(draft, 'read_scene', {})
    expect(draft.forceTool()).toBe('propose_draft')
    expect(draft.forceTool()).toBeNull()
    const edit = paragraphs(PARAS, 'edit').agent
    call(edit, 'read_scene', {})
    expect(edit.forceTool()).toBe('propose_changes')
    switchOn('TOOLCHOICE', 'DRAFT')
    const before = paragraphs(PARAS, 'edit', { newProse: true }).agent
    call(before, 'read_scene', {})
    expect(before.forceTool()).toBe('propose_changes')
    switchOn('TOOLCHOICE', 'ACTFIRST')
    const noDraft = paragraphs(PARAS, 'edit', { newProse: true }).agent
    call(noDraft, 'read_scene', {})
    expect(noDraft.forceTool()).toBe('propose_changes')
  })
})
