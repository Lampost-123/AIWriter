// The editor chat's Phase 4 tools (lab switch EXTRATOOLS): what is true at a point in a scene, the story so far, a
// scene against an earlier version, and replace_all, each read along the story's line as of the open scene. Off, none
// of them is offered. Invented text only.
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { ChatSwitch } from '@shared/askIntent'
import type { Proposal } from '@shared/contracts/ask'
import type { SceneHistory, Snapshot } from '@shared/contracts/history'
import type { SceneState } from '@shared/continuity'
import type { ToolActivity } from '@shared/toolActivity'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { EditorAgent, editorTools, MAX_ITEM_WORDS, toolSwitches } from './agent'
import { paragraphDiff, type SnapshotSource } from './extraTools'
import { proposalLine } from './history'

const switchOn = (...names: ChatSwitch[]): void => chatSwitches(names)
afterEach(() => chatSwitches(null))

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16)

const SC1 = 'Ilse carried the lantern up the hill.\n\nBram waited by the gate with Brom’s old coat.\n\nMarrow Gull watched from the wall.'
const SC2 = 'At the ford Brom said nothing. Brom never did.'

/**
 * The Salt Road: Ch 1 “Low Water” (Sc 1 “Arrival”, the open scene; Sc 2 “The Ford”, later). A second story, “The Far
 * Shore”, has its own Brom. Ilse, Bram, an entry called Brom (a misspelling made an entry), Marrow Gull kept out.
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
  repo.saveSceneText(db, sc1, null, SC1)
  repo.saveSceneText(db, sc2, null, SC2)
  const other = repo.createStory(db, { title: 'The Far Shore', startStoryId: null })
  const otherChapter = repo.getOutline(db, other.id).chapters[0]?.id ?? repo.createChapter(db, other.id, { title: 'Shore' }).id
  const otherScene = repo.getOutline(db, other.id).scenes[0]?.id ?? repo.createScene(db, otherChapter, { title: 'Gorse' }).id
  repo.saveSceneText(db, otherScene, null, 'On the far shore Gorse waited.')
  repo.createEntry(db, 'character', { name: 'Ilse Marrow', aliases: ['Ilse'] })
  const brom = repo.createEntry(db, 'character', { name: 'Brom', summary: 'A ferryman.' })
  const gull = repo.createEntry(db, 'character', { name: 'Marrow Gull' })
  mem.setPin(db, gull.id, 'world', null, 'hide')
  mem.putSummary(db, { level: 'scene', targetId: sc1, text: 'Ilse climbs to the gate where Bram waits.', origin: 'adam' })
  mem.putSummary(db, { level: 'scene', targetId: sc2, text: 'Brom keeps silent at the ford.', origin: 'adam' })
  return { db, story: story.id, ch1, sc1, sc2, other: other.id, otherScene, brom, gull }
}

const STATE: SceneState = {
  time: 'dusk',
  weather: 'rain',
  light: 'lantern light',
  characters: [
    { name: 'Ilse Marrow', where: 'at the gate', posture: 'standing', holding: 'the lantern', condition: '', mood: 'wary', lastAction: 'climbed the hill', clothes: [{ name: 'grey shawl', state: 'wet' }] },
    { name: 'Marrow Gull', where: 'on the wall', posture: 'crouched', holding: '', condition: '', mood: '', lastAction: 'watched' }
  ]
}

/** The tracker's keeping, as Recall leaves it: the end of Sc 1, and a checkpoint after its first paragraph. */
function seedState(w: ReturnType<typeof world>): void {
  repo.setMeta(w.db, 'continuity', JSON.stringify({ [w.sc1]: { hash: hashOf(SC1), base: '', state: STATE } }))
  const first = SC1.split('\n\n')[0]
  const early: SceneState = { ...STATE, characters: [{ ...STATE.characters[0], where: 'on the hill', holding: 'the lantern, unlit' }] }
  repo.setMeta(w.db, 'continuity-points', JSON.stringify({ [w.sc1]: { base: '', points: [{ at: first.length, hash: hashOf(first), state: early }] } }))
}

function agentAt(w: ReturnType<typeof world>, history?: SnapshotSource | null) {
  const tools: ToolActivity[] = []
  const agent = new EditorAgent(
    w.db,
    { storyId: w.story, sceneId: w.sc1, prefs: defaultWritingPrefs(), ...(history !== undefined ? { history } : {}) },
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

describe('EXTRATOOLS: which tools are offered', () => {
  it('offers none of them when off', () => {
    switchOn('TOOLCHOICE', 'TEXTTOOLS', 'STORYTOOLS')
    const tools = editorTools(toolSwitches())
    const names = tools.map((t) => t.name)
    for (const t of ['scene_state', 'story_so_far', 'compare_version', 'propose_replace_all']) expect(names).not.toContain(t)
    expect(JSON.stringify(tools.find((t) => t.name === 'propose_changes'))).not.toContain('replace_all')
  })

  it('on, offers the three look-ups and propose_changes takes replace_all with its fields', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const tools = editorTools(toolSwitches())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['scene_state', 'story_so_far', 'compare_version', 'propose_changes']))
    expect(names).not.toContain('propose_replace_all')
    const items = (tools.find((t) => t.name === 'propose_changes')!.parameters as { properties: { changes: { items: { properties: Record<string, { enum?: string[] }> } } } })
      .properties.changes.items.properties
    expect(items.kind.enum).toContain('replace_all')
    expect(Object.keys(items)).toEqual(expect.arrayContaining(['whole_word', 'match_case', 'scope', 'find', 'replace']))
  })

  it('without TOOLCHOICE, replace_all is its own propose_replace_all', () => {
    switchOn('EXTRATOOLS')
    const names = editorTools(toolSwitches()).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['propose_replace_all', 'scene_state']))
  })

  it('off, a call to one of them is no tool at all', () => {
    switchOn('TOOLCHOICE')
    const { agent } = agentAt(world())
    expect(call(agent, 'scene_state', {})).toContain('There is no tool called “scene_state”')
    expect(changes(agent, { kind: 'replace_all', find: 'Brom', replace: 'Bram', why: 'x' })).toContain('Not proposed')
  })
})

describe('scene_state', () => {
  it('says what is true at the end of the open scene, as Recall keeps it, leaving out someone kept out', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    seedState(w)
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'scene_state', {})
    expect(out).toContain('Where things stand at the end of Ch 1, Sc 1 “Arrival” (the open scene):')
    expect(out).toContain('Time: dusk')
    expect(out).toContain('Ilse Marrow')
    expect(out).toContain('the lantern')
    expect(out).toContain('grey shawl')
    expect(out).not.toContain('Marrow Gull')
    expect(out).toContain('keeps out here is left out')
    expect(tools.at(-1)).toMatchObject({ tool: 'scene_state', kind: 'state', status: 'done', summary: 'the end of Ch 1, Sc 1 “Arrival”', outcome: '1 person' })
  })

  it('at a paragraph: the checkpoint there, and the row says “[1]”', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    seedState(w)
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'scene_state', { at_paragraph: 1 })
    expect(out).toContain('just after paragraph [1]')
    expect(out).toContain('on the hill')
    expect(out).toContain('the lantern, unlit')
    expect(tools.at(-1)).toMatchObject({ kind: 'state', summary: '[1]' })
    // After paragraph 2 there is no checkpoint: the nearest before it is used, and said so.
    expect(call(agent, 'scene_state', { at_paragraph: 2 })).toContain('as worked out at the nearest point before it')
    expect(call(agent, 'scene_state', { at_paragraph: 9 })).toContain('There is no paragraph 9')
  })

  it('never a ghost: once the words change, nothing is shown, and no model is asked', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    seedState(w)
    repo.saveSceneText(w.db, w.sc1, null, `${SC1}\n\nIlse put the lantern down.`)
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'scene_state', {})
    expect(out).toContain('Nothing is worked out for the end of Ch 1, Sc 1 “Arrival”')
    expect(out).not.toContain('dusk')
    expect(tools.at(-1)).toMatchObject({ outcome: 'nothing worked out yet', status: 'done' })
  })

  it('a later scene is labelled later', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const { agent } = agentAt(world())
    expect(call(agent, 'scene_state', { scene: 'The Ford' })).toMatch(/Ch 1, Sc 2 “The Ford” \(later/)
  })
})

describe('story_so_far', () => {
  it('gives the stored summaries up to the open scene, nothing later', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    const out = call(agent, 'story_so_far', {})
    expect(out).toContain('Ilse climbs to the gate where Bram waits.')
    expect(out).toContain('(the open scene)')
    expect(out).not.toContain('Brom keeps silent')
    expect(tools.at(-1)).toMatchObject({ kind: 'sofar', summary: 'up to the open scene', outcome: '1 summary' })
  })

  it('reaches a later scene only when asked, labelled later', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const { agent } = agentAt(world())
    const out = call(agent, 'story_so_far', { to_scene: 'Ch 1, Sc 2' })
    expect(out).toMatch(/Ch 1, Sc 2 “The Ford” \(later[^)]*\): Brom keeps silent/)
  })

  it('says which scenes have no summary yet', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    mem.putSummary(w.db, { level: 'scene', targetId: w.sc1, text: '', origin: 'text' })
    const { agent } = agentAt(w)
    expect(call(agent, 'story_so_far', {})).toContain('(no summary yet)')
  })
})

describe('compare_version', () => {
  const snap = (w: ReturnType<typeof world>, text: string, over: Partial<Snapshot> = {}): Snapshot => ({
    id: 'snap-000111',
    sceneId: w.sc1,
    kind: 'ai',
    label: 'Before an edit from Ask the world',
    generationId: null,
    words: text.split(/\s+/).length,
    createdAt: '2026-10-09T10:00:00.000Z',
    doc: null,
    text,
    ...over
  })
  const source = (snaps: Snapshot[], sameAsNow: string[] = []): SnapshotSource => ({
    listSnapshots: (sceneId): SceneHistory => ({
      available: true,
      problem: null,
      notice: null,
      snapshots: snaps.filter((s) => s.sceneId === sceneId).map(({ doc: _d, text: _t, ...info }) => info),
      sameAsNow
    }),
    getSnapshot: (id) => {
      const s = snaps.find((x) => x.id === id)
      if (!s) throw new Error('gone')
      return s
    }
  })

  it('shows the paragraphs that changed, before and now, against the latest version that differs', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    const older = SC1.replace('Bram waited by the gate', 'Bram stood by the gate')
    const { agent, tools } = agentAt(w, source([snap(w, SC1, { id: 'snap-same01', label: 'While writing' }), snap(w, older, { createdAt: '2026-10-08T09:00:00.000Z' })], ['snap-same01']))
    const out = call(agent, 'compare_version', {})
    expect(out).toContain('against “Before an edit from Ask the world”')
    expect(out).toContain('- Changed at [2]:')
    expect(out).toContain('was: Bram stood by the gate')
    expect(out).toContain('now: Bram waited by the gate')
    expect(out).toContain('the same as now')
    expect(tools.at(-1)).toMatchObject({ kind: 'compare', outcome: '1 changed paragraph', summary: 'Ch 1, Sc 1 “Arrival” with “Before an edit from Ask the world”' })
  })

  it('with no History, or an id of another scene, it says so plainly', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    const none = agentAt(w, null)
    expect(call(none.agent, 'compare_version', {})).toContain('History isn’t open')
    expect(none.tools.at(-1)).toMatchObject({ status: 'failed' })
    const other = agentAt(w, source([snap(w, 'x', { id: 'snap-ford01', sceneId: w.sc2 })]))
    expect(call(other.agent, 'compare_version', { snapshot: 'snap-ford01' })).toContain('History has kept no earlier versions')
  })

  it('paragraphDiff keeps what is the same and pairs what changed', () => {
    expect(paragraphDiff('A.\n\nB.\n\nC.', 'A.\n\nB2.\n\nC.\n\nD.')).toEqual([
      { before: ['B.'], after: ['B2.'], at: 2 },
      { before: [], after: ['D.'], at: 4 }
    ])
    expect(paragraphDiff('A.\n\nB.', 'B.')).toEqual([{ before: ['A.'], after: [], at: 1 }])
    expect(paragraphDiff('Same.', 'Same.')).toEqual([])
  })
})

describe('replace_all', () => {
  it('proposes every place in this story, with the count, a few examples and the entry rename offered', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    const out = changes(agent, { kind: 'replace_all', find: 'Brom', replace: 'Bram', why: 'The name is Bram.' })
    expect(out).toContain('Proposed to the writer: 1 of 1')
    expect(out).toContain('3 times in 2 scenes')
    expect(out).toContain('1 of them after the open scene')
    const p = last(agent)
    expect(p).toMatchObject({ kind: 'replaceAll', storyId: w.story, find: 'Brom', replace: 'Bram', wholeWord: true, matchCase: true, sceneId: null, count: 3, scenes: 2 })
    if (p.kind !== 'replaceAll') throw new Error('not a replace all')
    expect(p.examples).toHaveLength(3)
    expect(p.examples[0]).toMatchObject({ sceneLabel: 'Ch 1, Sc 1 “Arrival”', text: 'Brom' })
    expect(p.rename).toMatchObject({ entryId: w.brom.id, name: 'Brom' })
    // Nothing changed yet: the scene still has its words.
    expect(repo.getScene(w.db, w.sc1).text).toBe(SC1)
    expect(tools.at(-1)).toMatchObject({ kind: 'propose', status: 'done', summary: '1 replace all' })
    expect(proposalLine(p)).toBe('change 1: replace all "Brom" → "Bram" (3 in 2 scenes) (pending)')
  })

  it('in one scene with scope scene; whole words only by default; refuses words only another story has', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    const { agent } = agentAt(w)
    changes(agent, { kind: 'replace_all', find: 'Brom', replace: 'Bram', scope: 'scene', scene: 'The Ford', why: 'x' })
    expect(last(agent)).toMatchObject({ sceneId: w.sc2, sceneLabel: 'Ch 1, Sc 2 “The Ford”', count: 2, scenes: 1 })
    expect(changes(agent, { kind: 'replace_all', find: 'Bro', replace: 'Bra', why: 'x' })).toContain('isn\'t in this story (whole words, exact case)')
    expect(changes(agent, { kind: 'replace_all', find: 'Gorse', replace: 'Gorst', why: 'x' })).toContain('“Gorse” isn\'t in this story')
    expect(agent.proposals).toHaveLength(1)
  })

  it('keeps to the runaway guard and refuses a second one for the same words', () => {
    switchOn('TOOLCHOICE', 'EXTRATOOLS')
    const w = world()
    const { agent } = agentAt(w)
    const long = Array.from({ length: MAX_ITEM_WORDS + 5 }, () => 'word').join(' ')
    expect(changes(agent, { kind: 'replace_all', find: 'Brom', replace: long, why: 'x' })).toContain(`keep each change under about ${MAX_ITEM_WORDS} words`)
    changes(agent, { kind: 'replace_all', find: 'Brom', replace: 'Bram', why: 'x' })
    expect(changes(agent, { kind: 'replace_all', find: 'brom', replace: 'Brann', match_case: false, why: 'x' })).toContain('Change 1 already replaces')
  })

  it('without TOOLCHOICE, propose_replace_all does the same', () => {
    switchOn('EXTRATOOLS')
    const w = world()
    const { agent, tools } = agentAt(w)
    expect(call(agent, 'propose_replace_all', { find: 'lantern', replace: 'lamp', why: 'x' })).toContain('Proposed to the writer as change 1')
    expect(last(agent)).toMatchObject({ kind: 'replaceAll', count: 1, rename: null })
    expect(tools.at(-1)).toMatchObject({ summary: 'a replace of “lantern” in the story', outcome: 'proposed' })
  })
})
