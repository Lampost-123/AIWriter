// The editor chat's truth check (Adam, 2026-10-19: "I was still getting responses from the chat claiming it had edited
// or proposed a change while it did nothing"): the real agent and the real tool loop (ask/loop.ts in ai/tasks.ts),
// against a scripted provider that claims changes it never made. Each way that could happen is reproduced here; the
// answer kept is never a false claim. Invented words only.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { claimsUnmade, NO_CHANGE_LEAD } from '@shared/askTruth'
import { contractLastWords } from '@shared/askChanges'
import type { AskIntent } from '@shared/askIntent'
import type { ToolCall } from '@shared/types'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { forgetParams } from '../ai/client'
import { runTask, type TaskRequest } from '../ai/tasks'
import { EditorAgent, fieldKey, type AgentPlace } from './agent'
import { chatLoop } from './loop'

type Chunk = Record<string, unknown>
type Sent = { tools?: unknown[]; tool_choice?: unknown; messages: { role: string; content?: unknown }[] }

const text = (t: string): Chunk => ({ choices: [{ delta: { content: t }, finish_reason: null }] })
const call = (name: string, args: unknown, id = `c${Math.random().toString(36).slice(2, 8)}`): Chunk => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }]
})
const finish = (reason: string): Chunk => ({ choices: [{ delta: {}, finish_reason: reason }] })
const says = (t: string): Chunk[] => [text(t), finish('stop')]
const calls = (name: string, args: unknown): Chunk[] => [call(name, args), finish('tool_calls')]
const stream = (chunks: Chunk[]): Response =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })

/** A provider answering each request with the next reply in the list (or, given `refuse`, turning some down first). */
function scripted(replies: Chunk[][], refuse?: (body: Sent) => Response | null): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  let next = 0
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Sent
    sent.push(body)
    const no = refuse?.(body)
    if (no) return no
    return stream(replies[next++] ?? says('(nothing more scripted)'))
  }) as unknown as typeof fetch
  return { fetchImpl, sent }
}

const OPENING = 'The tide came in over the flats.'
const SCENE = [`${OPENING} The gulls went quiet.`, 'Mara waited by the ferry rope.']
const CLAIM = 'I’ve tightened the opening line for you. The change is ready to apply.'
const EDIT = { changes: [{ kind: 'edit', find: OPENING, replace: 'The tide ran in over the flats.', why: 'Tighter.' }] }
const BAD_EDIT = { changes: [{ kind: 'edit', find: 'The lighthouse keeper sang to the gulls.', replace: 'He sang.', why: 'Livelier.' }] }

/** A world with one scene of words and Mara (a character with grey eyes); the agent made with the switches as they are. */
function chat(place: Partial<AgentPlace> = {}) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const doc = { type: 'doc', content: SCENE.map((t, i) => ({ type: 'paragraph', attrs: { pid: `p${i + 1}` }, content: [{ type: 'text', text: t }] })) }
  repo.saveSceneText(db, sceneId, doc, SCENE.join('\n\n'))
  repo.createEntry(db, 'character', { name: 'Mara', summary: 'A ferrywoman.', fields: { eyes: 'grey' } })
  const agent = new EditorAgent(db, { storyId: story.id, sceneId, prefs: defaultWritingPrefs(), ...place }, () => undefined, () => undefined)
  return { db, agent, sceneId }
}

let taskNo = 0
/** Asks a question the way ipc/ask.ts does: the agent's loop (ask/loop.ts) in the task runner. */
async function ask(
  question: string,
  replies: Chunk[][],
  o: { place?: Partial<AgentPlace>; intent?: AskIntent | null; route?: boolean; maxSteps?: number; refuse?: (body: Sent) => Response | null } = {}
) {
  const { db, agent } = chat({ ...(o.intent ? { intent: o.intent } : {}), ...o.place })
  const { fetchImpl, sent } = scripted(replies, o.refuse)
  const loop = chatLoop(agent, { question, intent: o.intent ?? null, route: o.route ?? false, contract: true, readFirst: false })
  const req: TaskRequest = {
    db,
    taskId: `truth-${++taskNo}`,
    job: 'chat',
    model: {
      job: 'chat',
      target: { id: 'p1', name: 'Scripted', kind: 'custom', baseUrl: 'http://scripted.test', apiKey: 'k' },
      choice: { providerId: 'p1', modelId: `scripted/truth-${taskNo}`, label: 'Scripted', contextLength: 64_000, promptPrice: 0.000001, completionPrice: 0.000002 },
      thinking: 'off'
    },
    messages: [
      { role: 'system', content: 'You help a novelist with the ferry scene.' },
      { role: 'user', content: question }
    ],
    reply: 400,
    temperature: 0.7,
    emit: () => undefined,
    retryDelays: [1],
    fetchImpl,
    agent: { ...loop, ...(o.maxSteps ? { maxSteps: o.maxSteps } : {}) }
  }
  const done = await runTask(req)
  const record = gens.getGeneration(db, done.generationId)
  return { done, sent, agent, record }
}

const lastUser = (s: Sent): string => String([...s.messages].reverse().find((m) => m.role === 'user')?.content ?? '')
const NOTE = '[AI Write, not the writer] Your answer gives a change as made'
const FORCED = { type: 'function', function: { name: 'propose_changes' } }

afterEach(() => {
  chatSwitches(null)
  forgetParams()
})

describe('the truth check in the chat’s tool loop', () => {
  it('a claim made without any tool call goes back once with propose_changes forced; the change then proposed stands', async () => {
    const { done, sent, agent } = await ask('Tighten the opening line.', [says(CLAIM), calls('propose_changes', EDIT), says('I’ve proposed a tighter opening as change 1.')], {
      place: { wordsInQuestion: true }
    })
    expect(sent).toHaveLength(3)
    expect(sent[0].tool_choice).toBeUndefined()
    expect(lastUser(sent[1])).toMatch(new RegExp(`^\\${NOTE.slice(0, 1)}`))
    expect(lastUser(sent[1]).startsWith(NOTE)).toBe(true)
    expect(lastUser(sent[1])).toContain(`“${CLAIM.split('. ')[0]}.”`)
    expect(lastUser(sent[1])).toContain('No change was made')
    expect(sent[1].tool_choice).toEqual(FORCED)
    expect(agent.proposals).toHaveLength(1)
    // The claim the note sent back is out of the reply; what is left is true.
    expect(done.text).toBe('I’ve proposed a tighter opening as change 1.')
    expect(claimsUnmade(done.text, agent.proposals)).toBe(false)
  })

  it('a model that goes on claiming: the claim is never shown, the answer says no change was made', async () => {
    const { done, record, agent } = await ask('Tighten the opening line.', [says(CLAIM), says(CLAIM), says(CLAIM), says(CLAIM)], { place: { wordsInQuestion: true } })
    expect(agent.proposals).toHaveLength(0)
    expect(done.status).toBe('complete')
    expect(done.text).toBe(`${NO_CHANGE_LEAD}, so there’s nothing to apply. Here’s what I’d suggest:\n\nI’d tighten the opening line for you.`)
    expect(record.response).toBe(done.text)
    expect(claimsUnmade(done.text, [])).toBe(false)
  })

  it('a proposal turned down (its words aren’t in the scene) and a claim: the answer says why, in plain words', async () => {
    const claim = 'I’ve fixed the first sentence.'
    const { done, agent, sent } = await ask(
      'Fix the first sentence.',
      [calls('propose_changes', BAD_EDIT), says(claim), calls('propose_changes', BAD_EDIT), says(claim), says(claim)],
      { place: { wordsInQuestion: true } }
    )
    expect(agent.proposals).toHaveLength(0)
    expect(agent.lastFailure()).toMatch(/not in the scene as written/)
    // The note names what the tool said, so the model can fix it.
    expect(sent.map(lastUser).find((u) => u.startsWith(NOTE))).toMatch(/Your last proposal was turned down: those words are not in the scene as written/)
    expect(done.text).toBe(
      `${NO_CHANGE_LEAD}: I couldn’t make it because the words it meant to change aren’t in the scene as written. Here’s what I’d suggest:\n\nI’d fix the first sentence.`
    )
  })

  it('checks the last answer too: at the last step a claim buys one more go with the tools, then a last request', async () => {
    const { done, sent, agent } = await ask(
      'Tighten the opening line.',
      [calls('read_scene', {}), says(CLAIM), calls('propose_changes', EDIT), says('Proposed as change 1: a tighter opening.')],
      { maxSteps: 2 }
    )
    expect(sent).toHaveLength(4)
    // Request 2 was the last (no tools); the truth check's note comes with the tools, forced; the model may still use
    // them once more (up to three requests more in all), then answers.
    expect(sent[1].tools).toBeUndefined()
    expect(lastUser(sent[2]).startsWith(NOTE)).toBe(true)
    expect(sent[2].tool_choice).toEqual(FORCED)
    expect(sent[3].tool_choice).toBeUndefined()
    expect(agent.proposals).toHaveLength(1)
    expect(done.text).toBe('Proposed as change 1: a tighter opening.')
  })

  it('a question routed as an answer: the note takes the claim back and forces no change', async () => {
    const { done, sent, agent } = await ask('Is the opening line too long?', [says(CLAIM), says('It reads well as it is.')], {
      intent: 'answer',
      route: true,
      place: { wordsInQuestion: true }
    })
    expect(sent).toHaveLength(2)
    expect(lastUser(sent[1])).toMatch(/asked a question, not for a change/)
    expect(sent[1].tool_choice).toBeUndefined()
    expect(agent.proposals).toHaveLength(0)
    expect(done.text).toBe('It reads well as it is.')
  })

  it('a provider that turns tool_choice down: the note still goes, and a claim left standing is put right', async () => {
    const refuse = (body: Sent): Response | null =>
      body.tool_choice ? new Response(JSON.stringify({ error: { message: 'tool_choice is not supported for this model' } }), { status: 400 }) : null
    const { done, record, sent } = await ask('Tighten the opening line.', [says(CLAIM), says(CLAIM), says(CLAIM)], { place: { wordsInQuestion: true }, refuse })
    // The forced request was turned down and asked again without tool_choice (the note was this answer's one nudge).
    expect(sent.map((s) => !!s.tool_choice)).toEqual([false, true, false])
    expect((record.params as { toolChoice?: { dropped?: boolean } }).toolChoice?.dropped).toBe(true)
    expect(done.text.startsWith(NO_CHANGE_LEAD)).toBe(true)
    expect(claimsUnmade(done.text, [])).toBe(false)
  })

  it('a change proposed beside a claim of another kind: only what was proposed is said to be ready', async () => {
    const { done, agent } = await ask(
      'Tighten the opening and give Mara green eyes.',
      [calls('propose_changes', EDIT), says('I’ve tightened the opening. I’ve also updated Mara’s entry.'), says('I’ve tightened the opening. I’ve also updated Mara’s entry.'), says('I’ve tightened the opening. I’ve also updated Mara’s entry.')],
      { place: { wordsInQuestion: true } }
    )
    expect(agent.proposals.map((p) => p.kind)).toEqual(['text'])
    expect(done.text).toBe('Only change 1 is ready to apply; nothing else was changed.\n\nI’d tighten the opening. I’d also update Mara’s entry.')
  })

  it('leaves a true answer alone; an answer that ends with a question is not sent back, but its words are still put right', async () => {
    const { done, sent } = await ask('Is the opening line too long?', [says('It reads well; I’d keep it.')])
    expect(sent).toHaveLength(1)
    expect(done.text).toBe('It reads well; I’d keep it.')
    const { agent } = chat({ intent: 'edit', wordsInQuestion: true })
    agent.run({ id: 'q1', name: 'ask_user', arguments: JSON.stringify({ question: 'Which line?', options: ['The first', 'The last'] }) })
    expect(agent.recheck(CLAIM)).toBeNull()
    // Edge case 2: "Done." then a question for Adam: the claim is put right, the question and its options kept whole.
    const closing = agent.ended() ?? ''
    const settled = agent.settle(`Done. I’ve tightened the opening line.\n\n${closing}`)
    expect(settled).toBe(`${NO_CHANGE_LEAD}, so there’s nothing to apply. Here’s what I’d suggest:\n\nI’d tighten the opening line.\n\n${closing}`)
  })

  it('sends its note once an answer at most', () => {
    const { agent } = chat({ wordsInQuestion: true })
    expect(agent.recheck(CLAIM)).not.toBeNull()
    expect(agent.forceTool()).toBe('propose_changes')
    expect(agent.forceTool()).toBeNull()
    expect(agent.recheck(CLAIM)).toBeNull()
    expect(agent.recheck('Her eyes are grey.')).toBeNull()
  })

  it('never forces a change to words before they were read: it asks for them to be read first', () => {
    const { agent } = chat({ intent: 'edit' })
    const note = agent.recheck(CLAIM)
    expect(note).toMatch(/Read the words first with read_scene/)
    expect(agent.forceTool()).toBeNull()
    // A claim about an entry needs no words read: it is forced.
    const other = chat({ intent: 'edit' }).agent
    expect(other.recheck('I’ve updated Mara’s entry.')).not.toBeNull()
    expect(other.forceTool()).toBe('propose_changes')
  })
})

let n = 0
const run = (agent: EditorAgent, name: string, args: Record<string, unknown>): string => agent.run({ id: `t${++n}`, name, arguments: JSON.stringify(args) } as ToolCall).result

describe('tool errors say what to fix', () => {
  it('a field given by its label is taken as its key; one the entry hasn’t got lists the fields there are', () => {
    expect(fieldKey('character', 'eyes')).toBe('eyes')
    expect(fieldKey('character', 'Eye colour')).toBe('eyes')
    expect(fieldKey('character', 'Hair colour')).toBe('hair')
    expect(fieldKey('character', 'What they want')).toBe('wants')
    expect(fieldKey('character', 'Favourite colour')).toBeNull()
    const { agent } = chat()
    const ok = run(agent, 'propose_changes', { changes: [{ kind: 'entry', name: 'Mara', fields: { 'Eye colour': 'green' }, why: 'As asked.' }] })
    expect(ok).toMatch(/^Proposed to the writer: 1 of 1/)
    expect(agent.proposals[0]).toMatchObject({ kind: 'entry', patch: { fields: { eyes: 'green' } } })
    const bad = run(agent, 'propose_changes', { changes: [{ kind: 'entry', name: 'Mara', fields: { 'Favourite colour': 'green' }, why: 'As asked.' }] })
    expect(bad).toContain('“Favourite colour” isn\'t one of Mara\'s fields. Give fields by key; Mara\'s are: pronouns (Pronouns), age (Age or birth date)')
    expect(bad).toContain('eyes (Eyes)')
  })

  it('a name no entry has suggests the names like it', () => {
    const { agent } = chat()
    expect(run(agent, 'propose_changes', { changes: [{ kind: 'entry', name: 'Marra Vell', summary: 'x', why: 'y' }] })).toMatch(/There is no entry called “Marra Vell” in this story's memory\. Names like it: Mara\./)
  })

  it('a kind given by its tool’s name is taken as that kind', () => {
    const { agent } = chat()
    expect(run(agent, 'propose_changes', { changes: [{ kind: 'propose_entry_change', name: 'Mara', summary: 'A ferrywoman with green eyes.', why: 'As asked.' }] })).toMatch(/^Proposed to the writer/)
    expect(run(agent, 'propose_changes', { changes: [{ kind: 'scene_card', goal: 'Cross before the tide.', why: 'As asked.' }] })).toMatch(/^Proposed to the writer/)
  })

  it('an unknown propose tool names the one to use', () => {
    const { agent } = chat()
    expect(run(agent, 'update_entry', { name: 'Mara' })).toMatch(/There is no tool called “update_entry”\. To propose a change, use propose_changes\./)
  })

  it('a kind whose details wait in a pack is usable without loading it: a mistake brings its full line', () => {
    const { agent } = chat()
    const out = run(agent, 'propose_changes', { changes: [{ kind: 'issue_fix', issue_id: 'nope', why: 'As asked.' }] })
    expect(out).toMatch(/How to give a change of kind issue_fix: `issue_id` \(from list_issues\) and `how`: text/)
    const thread = run(agent, 'propose_changes', { changes: [{ kind: 'thread', why: 'As asked.' }] })
    expect(thread).toMatch(/How to give a change of kind thread: `thread`/)
    // Once the pack is loaded, its lines aren't repeated.
    run(agent, 'load_instructions', { name: 'fix-a-slip' })
    expect(run(agent, 'propose_changes', { changes: [{ kind: 'issue_fix', issue_id: 'nope', why: 'As asked.' }] })).not.toMatch(/How to give a change/)
    // The full schema is always in the tool, packs or not.
    const tool = agent.tools.find((t) => t.name === 'propose_changes')!
    const props = Object.keys(((tool.parameters as { properties: { changes: { items: { properties: Record<string, unknown> } } } }).properties.changes.items.properties))
    expect(props).toEqual(expect.arrayContaining(['issue_id', 'how', 'thread', 'action', 'list', 'note', 'pov', 'characters', 'location', 'find', 'replace', 'fields']))
  })

  it('keeps why each change was turned down, for the last words and for Adam', () => {
    const { agent } = chat()
    run(agent, 'propose_changes', BAD_EDIT)
    expect(agent.failures).toHaveLength(1)
    const words = contractLastWords([], 'edit', agent.lastFailure())
    expect(words).toMatch(/A proposal was turned down: Those words are not in the scene as written/)
    // The last words never suggest a refusal that didn't happen ("the scene you couldn't read").
    expect(contractLastWords([], 'edit')).not.toMatch(/the scene you couldn’t read/)
    expect(contractLastWords([], 'edit')).toMatch(/never say you couldn’t read, find or reach something no tool turned down/)
  })
})

describe('chat-truth: claims matched to their targets, said as waiting, and earlier changes checked (tasks 13-16)', () => {
  it('a claim backed by a proposal is still never said as made: it is said as waiting', async () => {
    const { done } = await ask('Tighten the opening line.', [calls('propose_changes', EDIT), says('I’ve tightened the opening line.')], { place: { wordsInQuestion: true } })
    expect(done.text).toBe('Change 1 is ready to apply: tighten the opening line.')
  })

  it('a claim naming a scene no proposal changes is put right (edge case 1)', () => {
    const { agent } = chat({ wordsInQuestion: true })
    run(agent, 'propose_changes', EDIT)
    expect(agent.settle('I’ve tightened the opening of scene 1.')).toBe('Change 1 is ready to apply: tighten the opening of scene 1.')
    expect(agent.settle('I’ve tightened the openings of scenes 1 and 2.')).toBe(
      'Only change 1 is ready to apply; nothing else was changed.\n\nI’d tighten the openings of scenes 1 and 2.'
    )
  })

  it('a claim about an earlier change stands only when Adam applied it (edge case 5)', () => {
    const earlier = (status: 'pending' | 'applied' | 'declined') =>
      chat({ earlier: [{ id: '1', status, why: '', kind: 'text', sceneId: 's', sceneLabel: 'Ch 1, Sc 1', find: 'a', replace: 'b' }] }).agent
    const said = 'As I changed earlier, the opening is tighter.'
    expect(earlier('applied').settle(said)).toBe(said)
    expect(earlier('pending').settle(said)).toBe('That earlier change isn’t in the story: it hasn’t been applied.\n\nAs I suggested earlier, the opening is tighter.')
    // Such a claim is never sent back to the model (nothing this answer could propose makes it true).
    expect(earlier('pending').recheck(said)).toBeNull()
  })
})
