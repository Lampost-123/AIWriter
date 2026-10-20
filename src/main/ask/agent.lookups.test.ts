// The editor chat with the look-ups every agent shares (overhaul phase 2, LOOKUPS) and the instruction packs (PACKS):
// "what is Wren wearing now?" and "where is the letter?" answered from the story index at no cost, as things stand at
// the open scene, never from a later scene nor about anyone Adam kept out; one get_entry and one search; packs loaded
// by name, once. An invented world, all the chat overhaul's switches on (the default) unless a test names them.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultStyleGuide, defaultWritingPrefs } from '@shared/defaults'
import type { ChatSwitch } from '@shared/askIntent'
import type { ToolActivity } from '@shared/toolActivity'
import type { ToolCall } from '@shared/types'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { buildStoryIndex } from '../storyIndex'
import { packOf } from '../ai/packs'
import { askLookupTools, EditorAgent, editorTools, toolSwitches } from './agent'
import { askInstructions, LOOKUPS_LINE } from './prompts'

afterEach(() => chatSwitches(null))

/** Every switch on but those named. */
const allBut = (...off: ChatSwitch[]): void => {
  chatSwitches(null)
  for (const n of off) process.env[`AIWRITE_EXP_CHAT_${n}`] = 'off'
}

/**
 * Wren and Odile at the lighthouse (Ch 1, Sc 1); Wren hides the letter under the nets in the boathouse (Ch 1, Sc 2); the
 * open scene (Ch 2, Sc 1) has no words yet; later (Ch 2, Sc 2) Wren burns the letter, which nobody knows yet.
 */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ch2 = repo.createChapter(db, story.id, { title: 'Two' }).id
  const s1 = o.scenes[0].id
  repo.updateScene(db, s1, { title: 'The lamp room' })
  const s2 = repo.createScene(db, o.chapters[0].id, { title: 'The boathouse' }).id
  const open = repo.createScene(db, ch2, { title: 'Morning' }).id
  const later = repo.createScene(db, ch2, { title: 'Ashes' }).id
  const wren = repo.createEntry(db, 'character', { name: 'Wren Halloway', summary: 'Keeps the light.' }).id
  const odile = repo.createEntry(db, 'character', { name: 'Odile Varre', summary: 'Keeps the lamp oil.' }).id
  const bram = repo.createEntry(db, 'character', { name: 'Bram', summary: 'A smuggler.' }).id
  const lighthouse = repo.createEntry(db, 'place', { name: 'The Lighthouse' }).id
  const boathouse = repo.createEntry(db, 'place', { name: 'The Boathouse' }).id
  repo.saveSceneText(db, s1, null, 'Wren pulled on her blue oilskin. Odile trimmed the wick and said nothing of the letter.\n\nThe gulls were quiet.')
  repo.saveSceneText(db, s2, null, 'Bram watched from the slipway.\n\nWren pushed the letter under the nets and went back up the hill.')
  repo.saveSceneText(db, later, null, 'Wren burned the letter in the lamp room grate.')
  setCard(db, s1, { povId: wren, presentIds: [odile], locationId: lighthouse, when: 'Day 1, dusk' })
  setCard(db, s2, { povId: wren, presentIds: [bram], locationId: boathouse, when: 'Day 1, night' })
  setCard(db, open, { povId: wren, presentIds: [odile], locationId: lighthouse, when: 'Day 2, morning' })
  setCard(db, later, { povId: wren, presentIds: [], locationId: lighthouse, when: 'Day 3' })
  mem.putSummary(db, { level: 'scene', targetId: s1, text: 'Wren and Odile ready the light.', origin: 'text' })
  mem.putSummary(db, { level: 'scene', targetId: s2, text: 'Wren hides the letter in the boathouse while Bram watches.', origin: 'text' })
  mem.insertChange(db, {
    entryId: bram,
    anchor: 'scene',
    sceneId: s2,
    kind: 'knowledge',
    payload: { factId: 'f-letter', fact: 'Wren hid the letter under the nets', there: [wren, bram] },
    origin: 'text'
  })
  const first = stage(s1, [person('Wren Halloway', { where: 'in the lamp room', clothes: [{ name: 'blue oilskin', state: 'on' }] })], {
    'wren halloway|where': 'Wren pulled on her blue oilskin',
    'wren halloway|clothes:blue oilskin': 'pulled on her blue oilskin'
  })
  const second = stage(s2, [person('Wren Halloway', { where: 'on the hill path', clothes: [{ name: 'blue oilskin', state: 'on' }] })], {
    'wren halloway|where': 'went back up the hill'
  })
  keepStages(db, {
    [s1]: first,
    [s2]: {
      ...second,
      things: [{ name: 'the letter', state: 'under the nets' }],
      said: { ...second.said, '|thing:letter': { quote: 'pushed the letter under the nets', sceneId: s2 } }
    }
  })
  buildStoryIndex(db, story.id)
  return { db, storyId: story.id, s1, s2, open, later, wren, odile, bram }
}

function agentIn(w: ReturnType<typeof world>, where: { storyId?: string | null; sceneId?: string | null } = {}) {
  const told: ToolActivity[] = []
  const agent = new EditorAgent(
    w.db,
    { storyId: where.storyId === undefined ? w.storyId : where.storyId, sceneId: where.sceneId === undefined ? w.open : where.sceneId, prefs: defaultWritingPrefs() },
    () => undefined,
    () => undefined,
    undefined,
    (phase, call) => (phase === 'end' ? told.push({ ...call }) : undefined)
  )
  return { agent, told }
}

let n = 0
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: `c${++n}`, name, arguments: JSON.stringify(args) })

/** One call through the agent loop's way in (runAll), its result and its row. */
async function ask(agent: EditorAgent, name: string, args: Record<string, unknown> = {}): Promise<{ result: string; step: ToolActivity }> {
  const r = await agent.runAll([call(name, args)])
  return { result: String(r.results[0].content), step: r.steps[0] }
}

describe('LOOKUPS: which look-ups the chat is offered', () => {
  it('the shared ones, with one get_entry and one search: the chat’s own', () => {
    chatSwitches(null)
    const names = editorTools(toolSwitches()).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['state_of', 'last_seen', 'where_is', 'who_knows', 'who_was_there', 'timeline', 'read_passage']))
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((x) => x === 'get_entry')).toHaveLength(1)
    expect(names).toContain('search')
    expect(names).not.toContain('find_in_story')
    // story_so_far and list_threads are offered (EXTRATOOLS, STORYTOOLS): what_happened and open_threads would say the same.
    expect(names).not.toContain('what_happened')
    expect(names).not.toContain('open_threads')
    // The chat's get_entry, which shows the field keys its entry changes use.
    expect(editorTools(toolSwitches()).find((t) => t.name === 'get_entry')?.description).toMatch(/^Read a character, place/)
  })

  it('what_happened and open_threads where the chat has nothing of its own for them; none at all with LOOKUPS off', () => {
    allBut('EXTRATOOLS', 'STORYTOOLS')
    expect(askLookupTools(toolSwitches()).map((t) => t.name)).toEqual(expect.arrayContaining(['what_happened', 'open_threads']))
    allBut('LOOKUPS')
    const names = editorTools(toolSwitches()).map((t) => t.name)
    for (const t of ['state_of', 'where_is', 'who_knows', 'last_seen', 'who_was_there', 'timeline', 'read_passage']) expect(names).not.toContain(t)
  })
})

describe('LOOKUPS: answered from the story index, as things stand at the open scene', () => {
  it('“What is Wren wearing now?”: state_of', async () => {
    const w = world()
    const { agent } = agentIn(w)
    const { result, step } = await ask(agent, 'state_of', { name: 'Wren' })
    expect(result).toContain('Wren Halloway: wearing blue oilskin (since Ch 1, Sc 1)')
    // Where the open scene's card has her, as its words so far end.
    expect(result).toContain('Wren Halloway: at The Lighthouse (since Ch 2, Sc 1)')
    expect(step).toMatchObject({ tool: 'state_of', kind: 'lookup', status: 'done', summary: 'what’s true of Wren', label: 'Looking up Wren Halloway' })
  })

  it('“Where is the letter?”: where_is, never what a later scene does with it', async () => {
    const w = world()
    const { agent } = agentIn(w)
    const { result, step } = await ask(agent, 'where_is', { thing: 'the letter' })
    expect(result).toBe('Now: the letter under the nets, at The Boathouse (since Ch 1, Sc 2).')
    expect(result).not.toMatch(/burn/i)
    expect(step).toMatchObject({ kind: 'lookup', summary: 'where “the letter” is', status: 'done' })
  })

  it('who_knows, last_seen, who_was_there and timeline, each in a line or a few', async () => {
    const w = world()
    const { agent } = agentIn(w)
    expect((await ask(agent, 'who_knows', { fact: 'the letter' })).result).toContain('Wren hid the letter under the nets: known by')
    expect((await ask(agent, 'last_seen', { name: 'Bram' })).result).toBe(
      'Bram was last there in Ch 1, Sc 2, at The Boathouse: Wren hides the letter in the boathouse while Bram watches.'
    )
    const there = (await ask(agent, 'who_was_there', { scene: 'The boathouse' })).result
    expect(there).toContain('There: Wren Halloway, Bram')
    const dates = (await ask(agent, 'timeline')).result
    expect(dates).toContain('Ch 1, Sc 2: Day 1')
    expect(dates).not.toContain('Day 3')
  })

  it('read_passage reads part of an earlier scene; a later one stays unread', async () => {
    const w = world()
    const { agent } = agentIn(w)
    const { result, step } = await ask(agent, 'read_passage', { scene: 'Ch 1, Sc 2', around: 'under the nets' })
    expect(result).toContain('Wren pushed the letter under the nets')
    expect(step).toMatchObject({ kind: 'read', summary: 'Ch 1, Sc 2' })
    const later = (await ask(agent, 'read_passage', { scene: 'Ch 2, Sc 2' })).result
    expect(later).toContain("There's no Ch 2, Sc 2 before this scene")
    expect(later).not.toMatch(/burn/i)
  })

  it('with no scene open, as the story so far ends; with no story open, says so plainly', async () => {
    const w = world()
    const end = agentIn(w, { sceneId: null }).agent
    // The story's last scene, as it ends: the story so far, all of it.
    expect((await ask(end, 'timeline')).result).toContain('Ch 2, Sc 1: Day 2')
    const none = agentIn(w, { storyId: null, sceneId: null }).agent
    const { result, step } = await ask(none, 'state_of', { name: 'Wren' })
    expect(result).toBe('No story is open, so there is no story to look things up in.')
    expect(step).toMatchObject({ status: 'failed', outcome: 'no story is open, so there is no story to look things up in' })
  })

  it('never tells anything about someone Adam kept out of the scene', async () => {
    const w = world()
    mem.setPin(w.db, w.bram, 'scene', w.open, 'hide')
    const { agent } = agentIn(w)
    expect((await ask(agent, 'state_of', { name: 'Bram' })).result).toBe('Nothing can be looked up about “Bram” for this scene.')
    expect((await ask(agent, 'who_was_there', { scene: 'Ch 1, Sc 2' })).result).not.toContain('Bram')
  })

  it('a name it doesn’t know points to the chat’s own search, not a tool it lacks', async () => {
    const w = world()
    const { agent } = agentIn(w)
    const { result, step } = await ask(agent, 'state_of', { name: 'Gale' })
    expect(result).toContain('No one or nothing called “Gale” is known at this point. People in this scene: Wren Halloway, Odile Varre.')
    expect(result).toContain('or search to search the words')
    expect(result).not.toContain('find_in_story')
    expect(step).toMatchObject({ status: 'done', outcome: expect.stringMatching(/^no one or nothing called “Gale”/) })
    // Arguments that aren't JSON are said back as for any tool.
    const bad = await agent.runAll([{ id: 'x1', name: 'where_is', arguments: '{not json' }])
    expect(bad.results[0].content).toBe('The arguments were not valid JSON. Call the tool again with valid JSON.')
  })

  it('answers the chat’s own tools as before, in the same round', async () => {
    const w = world()
    const { agent } = agentIn(w)
    const r = await agent.runAll([call('get_entry', { name: 'Odile Varre' }), call('where_is', { thing: 'the letter' }), call('outline')])
    expect(r.results.map((x) => x.toolCallId)).toEqual(r.steps.map((s) => r.results[r.steps.indexOf(s)].toolCallId))
    expect(String(r.results[0].content)).toContain('Character: Odile Varre')
    expect(String(r.results[1].content)).toContain('the letter under the nets')
    expect(String(r.results[2].content)).toContain('Ch 1: ')
    expect(r.steps.map((s) => s.kind)).toEqual(['entry', 'lookup', 'outline'])
  })
})

describe('PACKS: instruction packs in the chat', () => {
  it('lists them in the instructions, with the look-ups said, and offers load_instructions; off, neither', () => {
    chatSwitches(null)
    const on = askInstructions(defaultStyleGuide())
    expect(on).toContain('Instruction packs')
    expect(on).toContain('- plan-a-scene: ')
    expect(on).toContain(LOOKUPS_LINE.trim())
    expect(editorTools(toolSwitches()).at(-1)?.name).toBe('load_instructions')
    allBut('PACKS', 'LOOKUPS')
    const off = askInstructions(defaultStyleGuide())
    expect(off).not.toContain('Instruction packs')
    expect(off).not.toContain(LOOKUPS_LINE.trim())
    expect(editorTools(toolSwitches()).map((t) => t.name)).not.toContain('load_instructions')
  })

  it('loads a pack by name, with the chat’s own fields for its changes, once an answer', async () => {
    const w = world()
    const { agent } = agentIn(w)
    const { result, step } = await ask(agent, 'load_instructions', { name: 'fix-a-slip' })
    expect(result.startsWith(packOf('fix-a-slip')!.text)).toBe(true)
    expect(result).toContain('In this chat, propose these with propose_changes:\n- issue_fix: `issue_id` (from list_issues)')
    expect(result).toContain('- replace_all: every place some words stand')
    expect(step).toMatchObject({ kind: 'instructions', summary: 'fixing a slip', status: 'done', label: 'Reading the instructions for fixing a slip' })
    expect((await ask(agent, 'load_instructions', { name: 'fix-a-slip' })).result).toBe('The fix-a-slip pack is already loaded above: follow it.')
    const wrong = await ask(agent, 'load_instructions', { name: 'write-a-poem' })
    expect(wrong.step.status).toBe('failed')
    expect(wrong.result).toContain('The packs are: plan-a-scene, write-dialogue')
  })

  it('propose_changes carries the rarer kinds in a line each, their details in the packs, and still proposes them', () => {
    chatSwitches(null)
    const packed = JSON.stringify(editorTools(toolSwitches()).find((t) => t.name === 'propose_changes'))
    allBut('PACKS')
    const full = JSON.stringify(editorTools(toolSwitches()).find((t) => t.name === 'propose_changes'))
    expect(packed.length).toBeLessThan(full.length - 600)
    expect(packed).toContain('the fix-a-slip pack has the details')
    expect(packed).toContain('the plan-a-scene pack has the details of both')
    // The kinds and their fields are all still there.
    for (const k of ['issue_fix', 'chapter_card', 'thread', 'replace_all', 'issue_id', 'whole_word']) expect(packed).toContain(k)
    chatSwitches(null)
    const w = world()
    const { agent } = agentIn(w)
    const out = agent.run(call('propose_changes', { changes: [{ kind: 'replace_all', find: 'Odile', replace: 'Odila', why: 'A new spelling.' }] })).result
    expect(out).toMatch(/^Proposed/)
    expect(agent.proposals[0]).toMatchObject({ kind: 'replaceAll' })
  })
})
