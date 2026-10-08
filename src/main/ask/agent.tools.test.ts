// The editor chat's tool calls as records (chat Phase 2b: "a way to see when the chat called a tool"): each call is
// told as it starts and ends, with what it was asked for, how it went and what came back in a few words, and which
// request of the answer it was in. Invented text only; all the chat overhaul's switches on (the default).
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { ToolActivity } from '@shared/toolActivity'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { EditorAgent } from './agent'

afterEach(() => chatSwitches(null))

const PARAS = ['The ferry left at dusk with no lamp lit.', 'Odile counted the lamp oil twice.', 'Mara waited.']

function setup(): { agent: EditorAgent; told: { phase: 'start' | 'end'; call: ToolActivity }[] } {
  chatSwitches(null)
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const sceneId = outline.scenes[0].id
  repo.updateScene(db, sceneId, { title: 'The Ford' })
  const doc = { type: 'doc', content: PARAS.map((t, i) => ({ type: 'paragraph', attrs: { pid: `p${i + 1}` }, content: [{ type: 'text', text: t }] })) }
  repo.saveSceneText(db, sceneId, doc, PARAS.join('\n\n'))
  repo.createEntry(db, 'character', { name: 'Odile Varre', summary: 'Keeps the lamp oil.' })
  const told: { phase: 'start' | 'end'; call: ToolActivity }[] = []
  const agent = new EditorAgent(
    db,
    { storyId: story.id, sceneId, prefs: defaultWritingPrefs() },
    () => undefined,
    () => undefined,
    undefined,
    (phase, call) => told.push({ phase, call: { ...call } })
  )
  return { agent, told }
}

let n = 0
const run = (agent: EditorAgent, name: string, args: Record<string, unknown> | string): ToolActivity =>
  agent.run({ id: `c${++n}`, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }).step as ToolActivity

describe('each tool call as a record', () => {
  it('says what it read, and how many words came back', () => {
    const { agent, told } = setup()
    const s = run(agent, 'read_scene', {})
    expect(s).toMatchObject({ tool: 'read_scene', kind: 'read', status: 'done', summary: 'Ch 1, Sc 1 “The Ford”', outcome: '17 words' })
    expect(s.label).toBe('Reading Ch 1, Sc 1 “The Ford”')
    expect(s.id).toMatch(/^t\d+$/)
    expect(s.startedAt).toBeTypeOf('number')
    expect(s.endedAt).toBeGreaterThanOrEqual(s.startedAt ?? 0)
    // Told as it started (running) and as it ended, the same call.
    expect(told.map((t) => [t.phase, t.call.status])).toEqual([
      ['start', 'running'],
      ['end', 'done']
    ])
    expect(told[0].call.id).toBe(s.id)
  })

  it('says what it searched for and how many hits, and who it looked up', () => {
    const { agent } = setup()
    expect(run(agent, 'search', { query: 'lamp oil' })).toMatchObject({ kind: 'search', summary: '“lamp oil”', status: 'done', outcome: expect.stringMatching(/^\d+ hits?$/) })
    expect(run(agent, 'search', { query: 'zzqx' })).toMatchObject({ outcome: 'nothing found' })
    expect(run(agent, 'get_entry', { name: 'Odile Varre' })).toMatchObject({ kind: 'entry', summary: 'Odile Varre', outcome: 'character' })
    expect(run(agent, 'outline', {})).toMatchObject({ kind: 'outline', summary: '', outcome: '1 chapter, 1 scene' })
    expect(run(agent, 'style_guide', {})).toMatchObject({ kind: 'style', status: 'done' })
    expect(run(agent, 'scene_issues', {})).toMatchObject({ kind: 'issues', summary: 'Ch 1, Sc 1 “The Ford”', outcome: 'none open' })
  })

  it('says a look-up that went wrong failed, and why, in a few words', () => {
    const { agent } = setup()
    expect(run(agent, 'get_entry', { name: 'Nobody Here' })).toMatchObject({
      status: 'failed',
      summary: 'Nobody Here',
      outcome: expect.stringMatching(/^there is no entry called “Nobody Here”/)
    })
    expect(run(agent, 'read_scene', '{not json')).toMatchObject({ status: 'failed', outcome: 'the arguments weren’t valid JSON' })
  })

  it('counts the changes it proposed by kind, and says which weren’t proposed and why', () => {
    const { agent } = setup()
    const s = run(agent, 'propose_changes', {
      changes: [
        { kind: 'edit', paragraph: 3, find: 'Mara waited.', replace: 'Mara waited, cold.', why: 'Detail.' },
        { kind: 'edit', paragraph: 2, find: 'not in the scene', replace: 'x', why: 'x' },
        { kind: 'card', goal: 'Get the lamp lit.', why: 'x' }
      ]
    })
    expect(s).toMatchObject({ kind: 'propose', status: 'done', summary: '2 edits, 1 card change' })
    expect(s.outcome).toMatch(/^2 proposed, 1 not proposed: \S/)
    const none = run(agent, 'propose_changes', { changes: [{ kind: 'edit', find: 'nowhere at all', replace: 'x', why: 'x' }] })
    expect(none).toMatchObject({ status: 'not-proposed', summary: '1 edit' })
    expect(none.outcome).toMatch(/^not proposed: /)
  })

  it('shows a question asked through propose_changes, or ask_user, as asking the writer', () => {
    const { agent } = setup()
    const asked = run(agent, 'ask_user', { question: 'Which lamp?', options: ['The old one', 'The new one'] })
    expect(asked).toMatchObject({ kind: 'ask', status: 'done', summary: 'Which lamp?', outcome: 'asked, 2 options' })
    const again = run(agent, 'ask_user', { question: 'And then?', options: ['A', 'B'] })
    expect(again).toMatchObject({ kind: 'ask', status: 'failed', outcome: expect.stringMatching(/^not asked: /) })
  })

  it('says what a single proposal was from its own words, and a draft as proposed', () => {
    const { agent } = setup()
    const d = run(agent, 'propose_draft', { mode: 'continue', direction: 'Odile lights the lamp.' })
    expect(d).toMatchObject({ kind: 'draft', status: 'done', summary: 'a draft for Ch 1, Sc 1 “The Ford”', outcome: 'proposed' })
  })
})

describe('a call shown from the moment the model starts asking for it', () => {
  it('is the same call when it ends, with its request, and one never finished ends as not run', async () => {
    const { agent, told } = setup()
    agent.callStarted(0, 'read_scene', 2)
    agent.callStarted(0, 'read_scene', 2) // the request tried again: the same call
    agent.callStarted(1, 'search', 2)
    agent.callStarted(2, 'outline', 2)
    expect(told.filter((t) => t.phase === 'start').map((t) => t.call.tool)).toEqual(['read_scene', 'search', 'outline'])
    const { steps } = await agent.runAll(
      [
        { id: 'a', name: 'read_scene', arguments: '{}' },
        { id: 'b', name: 'search', arguments: JSON.stringify({ query: 'lamp' }) }
      ],
      2
    )
    const started = told.filter((t) => t.phase === 'start').map((t) => t.call.id)
    expect(steps.map((s) => s.id)).toEqual(started.slice(0, 2))
    expect(steps.every((s) => s.step === 2)).toBe(true)
    // The third never came whole: it ends as not run.
    expect(told.at(-1)).toMatchObject({ phase: 'end', call: { id: started[2], status: 'stopped' } })
    // A call not told of beforehand starts when it is run, in the request given.
    const later = await agent.runAll([{ id: 'c', name: 'outline', arguments: '{}' }], 3)
    expect(later.steps[0]).toMatchObject({ step: 3, status: 'done' })
  })
})
