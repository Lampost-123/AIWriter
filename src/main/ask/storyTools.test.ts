// The editor chat's story tools (chat Phase 3, lab switch STORYTOOLS): consistency issues, chapter cards and plot
// threads, read along the story's line as of the open scene and proposed as changes the writer applies. Off, none of
// them is offered. Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { ChatSwitch } from '@shared/askIntent'
import type { Proposal } from '@shared/contracts/ask'
import type { ToolActivity } from '@shared/toolActivity'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { EditorAgent, editorTools, toolSwitches } from './agent'

const switchOn = (...names: ChatSwitch[]): void => chatSwitches(names)
afterEach(() => chatSwitches(null))

let issueN = 0
function addIssue(
  db: ReturnType<typeof memoryWorld>,
  o: { sceneId: string | null; storyId: string; kind?: string; severity?: string; status?: string; quote?: string; message: string; payload?: Record<string, unknown> }
): string {
  const id = `issue-${++issueN}-abcdef`
  const t = new Date().toISOString()
  db.prepare(
    'INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, o.sceneId ?? '', o.storyId, o.kind ?? 'continuity', o.severity ?? 'warning', o.status ?? 'open', o.quote ?? '', o.message, JSON.stringify(o.payload ?? {}), t, t)
  return id
}

/**
 * The Salt Road: Ch 1 “Low Water” (Sc 1 “Arrival”, the open scene; Sc 2 “The Ford”, later), Ch 2 “High Water” (Sc 3
 * “The Tower”, later). Ilse, Bram, Saltreach; Marrow Gull kept out (a world 'hide' pin). Plot threads: the lamp oil
 * (opened in Sc 1), the silver key (on Sc 2's card only), the drowned bell (kept out). Issues in Sc 1, Sc 2 and the story.
 */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  repo.updateStory(db, story.id, { title: 'The Salt Road' })
  const o = repo.getOutline(db, story.id)
  const ch1 = o.chapters[0].id
  repo.updateChapter(db, ch1, { title: 'Low Water' })
  const sc1 = o.scenes[0].id
  repo.updateScene(db, sc1, { title: 'Arrival' })
  const sc2 = repo.createScene(db, ch1, { title: 'The Ford' }).id
  const ch2 = repo.createChapter(db, story.id, { title: 'High Water' }).id
  const sc3 = repo.createScene(db, ch2, { title: 'The Tower' }).id
  repo.saveSceneText(db, sc1, null, 'Ilse carried the lantern up the hill. Bram waited by the gate.')
  repo.saveSceneText(db, sc2, null, 'At the ford the water was high.')
  repo.saveSceneText(db, sc3, null, 'The tower bell rang.')
  const ilse = repo.createEntry(db, 'character', { name: 'Ilse Marrow', aliases: ['Ilse'], summary: 'Keeps the tally.' })
  const bram = repo.createEntry(db, 'character', { name: 'Bram Tolley', aliases: ['Bram'] })
  const salt = repo.createEntry(db, 'place', { name: 'Saltreach' })
  const gull = repo.createEntry(db, 'character', { name: 'Marrow Gull' })
  mem.setPin(db, gull.id, 'world', null, 'hide')
  const lamp = repo.createEntry(db, 'thread', { name: 'The lamp oil', fields: { promise: 'Who stole the lamp oil?' } })
  const key = repo.createEntry(db, 'thread', { name: 'The silver key', fields: { promise: 'What does the key open?' } })
  const bell = repo.createEntry(db, 'thread', { name: 'The drowned bell' })
  mem.setPin(db, bell.id, 'world', null, 'hide')
  mem.insertChange(db, { kind: 'thread', payload: { status: 'open', note: '' }, entryId: lamp.id, anchor: 'scene', sceneId: sc1, origin: 'adam' })
  const card2 = repo.getScene(db, sc2).card
  repo.updateSceneCard(db, sc2, { ...card2, setsUpIds: [key.id] })
  const card3 = repo.getScene(db, sc3).card
  repo.updateSceneCard(db, sc3, { ...card3, paysOffIds: [lamp.id] })
  const sid = story.id
  const issues = {
    lantern: addIssue(db, { sceneId: sc1, storyId: sid, quote: 'carried the lantern', message: 'Ilse lost the lantern in the last scene.', payload: { fix: 'carried a torch' } }),
    tally: addIssue(db, {
      sceneId: sc1,
      storyId: sid,
      kind: 'fact',
      severity: 'must-fix',
      quote: 'Bram waited by the gate.',
      message: 'Ilse’s summary says she keeps no tally.',
      payload: { memoryFix: { entryId: ilse.id, field: 'summary', value: 'Keeps no tally.' } }
    }),
    hidden: addIssue(db, { sceneId: sc1, storyId: sid, quote: 'up the hill', message: 'Marrow Gull is not here.', payload: { sources: [{ kind: 'entry', entryId: gull.id, name: 'Marrow Gull', field: null }] } }),
    fixed: addIssue(db, { sceneId: sc1, storyId: sid, status: 'fixed', quote: 'the hill', message: 'An old one.' }),
    later: addIssue(db, { sceneId: sc2, storyId: sid, quote: 'the water was high', message: 'The tide was low that day.' }),
    story: addIssue(db, { sceneId: null, storyId: sid, kind: 'thread', message: 'The silver key is set up but never paid off.' })
  }
  return { db, story: sid, ch1, ch2, sc1, sc2, sc3, ilse, bram, salt, gull, lamp, key, bell, issues }
}

function agentAt(w: ReturnType<typeof world>) {
  const tools: ToolActivity[] = []
  const agent = new EditorAgent(
    w.db,
    { storyId: w.story, sceneId: w.sc1, prefs: defaultWritingPrefs() },
    () => undefined,
    () => undefined,
    undefined,
    (phase, c) => {
      if (phase === 'end') tools.push(c)
    }
  )
  return { agent, tools }
}

let n = 0
const call = (agent: EditorAgent, name: string, args: Record<string, unknown>): string => agent.run({ id: `c${++n}`, name, arguments: JSON.stringify(args) }).result
const changes = (agent: EditorAgent, ...items: Record<string, unknown>[]): string => call(agent, 'propose_changes', { changes: items })
const last = (agent: EditorAgent): Proposal => agent.proposals[agent.proposals.length - 1]

describe('STORYTOOLS: which tools are offered', () => {
  it('offers none of the story tools when off: scene_issues as before, no story kinds', () => {
    switchOn('TOOLCHOICE')
    const tools = editorTools(toolSwitches())
    const names = tools.map((t) => t.name)
    expect(names).toContain('scene_issues')
    expect(names).not.toEqual(expect.arrayContaining(['list_issues']))
    expect(names).not.toContain('chapter_card')
    expect(names).not.toContain('list_threads')
    expect(JSON.stringify(tools.find((t) => t.name === 'propose_changes'))).not.toContain('issue_fix')
  })

  it('on, list_issues takes scene_issues’ place, with chapter_card and list_threads, and propose_changes takes the story kinds', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const tools = editorTools(toolSwitches())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_issues', 'chapter_card', 'list_threads', 'propose_changes']))
    expect(names).not.toContain('scene_issues')
    expect(names).not.toContain('propose_issue_fix')
    const items = (tools.find((t) => t.name === 'propose_changes')!.parameters as { properties: { changes: { items: { properties: Record<string, { enum?: string[] }> } } } })
      .properties.changes.items.properties
    expect(items.kind.enum).toEqual(expect.arrayContaining(['issue_fix', 'chapter_card', 'thread']))
    expect(Object.keys(items)).toEqual(expect.arrayContaining(['issue_id', 'how', 'pov', 'characters', 'location', 'thread', 'action', 'list', 'note']))
  })

  it('without TOOLCHOICE, the story kinds are their own propose_ tools', () => {
    switchOn('STORYTOOLS')
    const names = editorTools(toolSwitches()).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_issues', 'propose_issue_fix', 'propose_chapter_card', 'propose_thread']))
    expect(names).not.toContain('propose_changes')
  })
})

describe('list_issues', () => {
  it('lists the open scene’s open issues with ids, severity, the suggested rewrite and the memory fix; never one kept out, nor a fixed one', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'list_issues', {})
    expect(out).toContain(`id ${w.issues.lantern}`)
    expect(out).toContain('Suggested rewrite: “carried a torch”')
    expect(out).toContain(`id ${w.issues.tally} · must fix · facts`)
    expect(out).toContain('Memory fix (how: memory): set Ilse Marrow’s summary to “Keeps no tally.”')
    expect(out).not.toContain(w.issues.hidden)
    expect(out).not.toContain('Marrow Gull')
    expect(out).not.toContain(w.issues.fixed)
    expect(out).not.toContain(w.issues.later)
    expect(tools.at(-1)).toMatchObject({ tool: 'list_issues', kind: 'issues', outcome: '2 open issues', summary: 'Ch 1, Sc 1 “Arrival”' })
  })

  it('lists the whole story’s with scope story: later scenes marked later, story-wide ones too', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'list_issues', { scope: 'story' })
    expect(out).toMatch(new RegExp(`id ${w.issues.later} · worth a look · continuity · Ch 1, Sc 2 “The Ford” \\(later`))
    expect(out).toContain(`id ${w.issues.story} · worth a look · plot thread · the whole story`)
    expect(out).not.toContain(w.issues.hidden)
    expect(tools.at(-1)).toMatchObject({ summary: 'the story', outcome: '4 open issues' })
  })
})

describe('issue_fix', () => {
  it('proposes the check’s rewrite for the issue’s words, or the memory fix where it has one; turns down what can’t be', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    expect(changes(agent, { kind: 'issue_fix', issue_id: w.issues.lantern, how: 'text', why: 'Lost lantern.' })).toMatch(/^Proposed to the writer: 1 of 1/)
    expect(last(agent)).toMatchObject({ kind: 'issueFix', issueId: w.issues.lantern, how: 'text', quote: 'carried the lantern', fix: 'carried a torch', sceneId: w.sc1 })
    expect(tools.at(-1)).toMatchObject({ summary: '1 issue fix', outcome: '1 proposed' })
    // By the start of its id, too.
    expect(changes(agent, { kind: 'issue_fix', issue_id: w.issues.tally.slice(0, 9), how: 'memory', why: 'The text is right.' })).toMatch(/^Proposed/)
    expect(last(agent)).toMatchObject({ how: 'memory', memory: { entryId: w.ilse.id, name: 'Ilse Marrow', field: 'summary', from: 'Keeps the tally.', to: 'Keeps no tally.' } })
    const no = (item: Record<string, unknown>): string => changes(agent, { kind: 'issue_fix', why: 'x', ...item })
    expect(no({ issue_id: w.issues.lantern, how: 'memory' })).toMatch(/no memory fix/)
    expect(no({ issue_id: w.issues.lantern, how: 'text' })).toMatch(/Change 1 already fixes that issue/)
    expect(no({ issue_id: w.issues.fixed, how: 'text' })).toMatch(/fixed already/)
    expect(no({ issue_id: w.issues.hidden, how: 'text' })).toMatch(/no issue .* in this story/)
    expect(no({ issue_id: 'nope', how: 'text' })).toMatch(/There is no issue “nope”/)
    expect(no({ issue_id: w.issues.story, how: 'text' })).toMatch(/quotes no words in a scene/)
    expect(agent.proposals).toHaveLength(2)
  })

  it('says when a text fix has no suggested rewrite', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent } = agentAt(w)
    const out = call(agent, 'propose_changes', { changes: [{ kind: 'issue_fix', issue_id: w.issues.later, how: 'text', why: 'x' }] })
    expect(out).toContain('no suggested rewrite')
    expect(last(agent)).toMatchObject({ kind: 'issueFix', fix: null, sceneLabel: 'Ch 1, Sc 2 “The Ford”' })
  })
})

describe('chapter cards', () => {
  it('reads the open scene’s chapter card and which scenes follow it', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    repo.saveChapterCard(w.db, w.ch1, { ...repo.getChapterCard(w.db, w.ch1), mood: 'Grey and cold' })
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'chapter_card', {})
    expect(out).toContain('Chapter card of Ch 1 “Low Water”')
    expect(out).toContain('Mood or tone: Grey and cold')
    expect(out).toContain('Point of view: (empty)')
    expect(out).toMatch(/Sc 1 Arrival \(the open scene\): follows the chapter's point of view, .*mood or tone, length, notes for the AI/)
    expect(out).toMatch(/Sc 2 The Ford \(later\)/)
    expect(tools.at(-1)).toMatchObject({ tool: 'chapter_card', kind: 'chapter', summary: 'Ch 1 “Low Water”', outcome: '1 part' })
    expect(call(agent, 'chapter_card', { chapter: 'Ch 2' })).toContain(`Chapter card of Ch 2 “High Water” (later`)
  })

  it('proposes parts by name, saying how many scenes it updates; turns down a name it doesn’t know and a card that already says it', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    const out = changes(agent, { kind: 'chapter_card', chapter: 'Ch 1', pov: 'Ilse', characters: ['Bram'], location: 'Saltreach', mood: 'Tense', why: 'As asked.' })
    expect(out).toMatch(/^Proposed to the writer: 1 of 1/)
    expect(out).toContain('updates 2 scenes')
    expect(last(agent)).toMatchObject({
      kind: 'chapterCard',
      chapterId: w.ch1,
      chapterLabel: 'Ch 1 “Low Water”',
      patch: { povId: w.ilse.id, presentIds: [w.ilse.id, w.bram.id], locationId: w.salt.id, mood: 'Tense' },
      scenes: 2
    })
    expect((last(agent) as Extract<Proposal, { kind: 'chapterCard' }>).lines).toEqual([
      { label: 'Point of view', from: '', to: 'Ilse Marrow' },
      { label: 'Characters present', from: '', to: 'Ilse Marrow, Bram Tolley' },
      { label: 'Location', from: '', to: 'Saltreach' },
      { label: 'Mood or tone', from: '', to: 'Tense' }
    ])
    expect(tools.at(-1)).toMatchObject({ summary: '1 chapter card change' })
    expect(changes(agent, { kind: 'chapter_card', chapter: 'Ch 2', pov: 'Corvin', why: 'x' })).toMatch(/no character called “Corvin”/)
    // Kept out: only by its exact name (part of it finds the one the story sees).
    expect(changes(agent, { kind: 'chapter_card', chapter: 'Ch 2', pov: 'Gull', why: 'x' })).toMatch(/no character called “Gull”/)
    expect(changes(agent, { kind: 'chapter_card', chapter: 'Ch 2', pov: 'Marrow', why: 'x' })).toContain('Using Ilse Marrow for “Marrow”. Applied, it updates 1 scene that follows')
    expect(changes(agent, { kind: 'chapter_card', chapter: 'Ch 2', when: 'Dusk', pov: 'Marrow Gull', why: 'x' })).toMatch(/^Proposed/)
    expect(last(agent)).toMatchObject({ patch: { povId: w.gull.id, when: 'Dusk' } })
    repo.saveChapterCard(w.db, w.ch2, { ...repo.getChapterCard(w.db, w.ch2), mood: 'Calm' })
    expect(changes(agent, { kind: 'chapter_card', chapter: 'Ch 2', mood: 'Calm', why: 'x' })).toMatch(/already says that/)
  })

  it('lets a scene card change set the point of view and who is present by name', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent } = agentAt(w)
    expect(changes(agent, { kind: 'card', pov: 'Bram', goal: 'Get home.', why: 'x' })).toMatch(/^Proposed/)
    expect(last(agent)).toMatchObject({ kind: 'card', patch: { povId: w.bram.id, goal: 'Get home.' }, names: [{ label: 'Point of view', from: '', to: 'Bram Tolley' }] })
  })
})

describe('plot threads', () => {
  it('lists them as of the open scene, with the scenes whose cards set up or pay off each (later ones marked); never one kept out', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'list_threads', {})
    expect(out).toContain('- The lamp oil (open): Who stole the lamp oil?')
    expect(out).toContain('Scene cards: pays off in Ch 2, Sc 1 “The Tower” (later)')
    expect(out).toContain('- The silver key (planned, not opened in the story yet): What does the key open?')
    expect(out).toContain('Scene cards: set up in Ch 1, Sc 2 “The Ford” (later)')
    expect(out).not.toContain('drowned bell')
    expect(tools.at(-1)).toMatchObject({ kind: 'threads', summary: 'plot threads', outcome: '2 plot threads' })
    expect(call(agent, 'list_threads', { status: 'open' })).not.toContain('silver key')
    expect(tools.at(-1)).toMatchObject({ summary: 'open plot threads', outcome: '1 open plot thread' })
  })

  it('proposes a thread on a scene’s card (a new one when no thread has the name); turns down what can’t be', () => {
    switchOn('TOOLCHOICE', 'STORYTOOLS')
    const w = world()
    const { agent } = agentAt(w)
    expect(changes(agent, { kind: 'thread', thread: 'lamp oil', action: 'resolve', why: 'Paid off here.' })).toMatch(/^Proposed/)
    expect(last(agent)).toMatchObject({ kind: 'thread', threadId: w.lamp.id, name: 'The lamp oil', action: 'resolve', list: 'paysOff', sceneId: w.sc1 })
    const made = changes(agent, { kind: 'thread', thread: 'The torn page', action: 'open', note: 'Who tore it out?', why: 'x' })
    expect(made).toContain('new plot thread')
    expect(last(agent)).toMatchObject({ threadId: null, name: 'The torn page', list: 'setsUp', note: 'Who tore it out?' })
    expect(changes(agent, { kind: 'thread', thread: 'The silver key', action: 'link', list: 'setsUp', scene: 'The Ford', why: 'x' })).toMatch(/already sets up The silver key/)
    expect(changes(agent, { kind: 'thread', thread: 'The silver key', action: 'link', why: 'x' })).toMatch(/give `list`/)
    expect(changes(agent, { kind: 'thread', thread: 'Bram Tolley', action: 'open', why: 'x' })).toMatch(/is a character, not a plot thread/)
    expect(changes(agent, { kind: 'thread', thread: 'lamp oil', action: 'resolve', why: 'x' })).toMatch(/Change 1 already does that/)
    expect(agent.proposals).toHaveLength(2)
  })
})
