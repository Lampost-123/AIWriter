// Plan before writing (step 4): the planner's reply read, checked against the stage (positions in the stage's own
// words, guesses left out, changes that are already so or start from what isn't so left out, nothing from the dead),
// what it asks for found in the codex, the plan written as the writer's own notes, and no plan at all when the call
// fails, is stopped or takes too long. The model is a stand-in; invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import type { MemoryModel } from '../keeper/model'
import { assembleContext, prepareContext, type ContextInput } from '../ai/context'
import { countRaw } from '../ai/tokens'
import {
  checkPlan,
  contradicts,
  fieldOf,
  makePlan,
  PLAN_GO,
  PLAN_HEAD,
  PLAN_MARKER,
  PLAN_MOST,
  planMaterial,
  planMessages,
  planText,
  readPlan,
  type CheckWith,
  type PlanMaterial,
  type RawPlan
} from './plan'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `p${++seq}`,
  kind,
  name,
  aliases: [],
  summary: '',
  description: '',
  tags: [],
  notes: '',
  fields: {},
  parentId: null,
  hardRule: false,
  origin: 'adam',
  fieldOrigins: {},
  originStoryId: null,
  originSceneId: null,
  originStart: false,
  byHand: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  happened: [],
  changed: [],
  ...extra
})

const blank = { where: '', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }
const STAND: SceneState = {
  time: 'dusk',
  weather: '',
  light: '',
  characters: [
    { ...blank, name: 'Wren', where: 'the mill loft', wearing: 'linen shirt, boots off by the hatch', posture: 'sitting on a sack', condition: 'left arm in a sling' },
    { ...blank, name: 'Osric Hale', where: 'the foot of the stairs' }
  ]
}

const MATERIAL = '## The scene card\nScene: The hatch\nThe weir is failing and the abbot knows it.\n\n## Must stay true\n- Wren: a burn scar on her right hand'

function world(): Omit<CheckWith, 'material'> & { weir: EntryState; ledger: EntryState; abbot: EntryState; wren: EntryState } {
  const wren = entry('character', 'Wren')
  const weir = entry('place', 'The weir', { aliases: ['the old weir'] })
  const ledger = entry('item', 'The tithe ledger')
  const hidden = entry('item', 'The black ledger')
  const abbot = entry('character', 'Abbot Fen', { happened: [{ note: 'Died of the fever', where: 'The Mill, Ch 2, Sc 1', changeId: 'd' }] })
  const mill = entry('place', 'The mill')
  return {
    stand: STAND,
    entries: [wren, weir, ledger, hidden, abbot, mill],
    inBriefing: new Set([wren.id, mill.id]),
    hidden: new Set([hidden.id]),
    weir,
    ledger,
    abbot,
    wren
  }
}

const raw = (over: Partial<RawPlan>): RawPlan => ({ relies: [], changes: [], needs: [], ...over })

describe('reading the plan', () => {
  it('reads the JSON wherever it sits in the reply; anything missing is empty', () => {
    const r = readPlan(
      'Here is the plan:\n{"relies": [{"who": "Wren", "what": "wearing", "value": " linen  shirt "}], "changes": [{"who": "Wren", "how": "She stands."}, "junk"], "needs": ["The weir", {"name": "The tithe ledger"}, 4]}\nDone.'
    )
    expect(r).toEqual({
      relies: [{ who: 'Wren', what: 'wearing', value: 'linen shirt' }],
      changes: [{ who: 'Wren', what: '', from: '', to: '', how: 'She stands.' }],
      needs: ['The weir', 'The tithe ledger']
    })
    expect(readPlan('{}')).toEqual({ relies: [], changes: [], needs: [] })
    expect(readPlan('The scene should be tense.')).toBeNull()
    expect(readPlan('[1, 2]')).toBeNull()
  })

  it("knows the stage's fields by other words, and anything else is a fact", () => {
    expect(fieldOf('position')).toBe('posture')
    expect(fieldOf('Clothing')).toBe('wearing')
    expect(fieldOf('location')).toBe('where')
    expect(fieldOf('injury')).toBe('condition')
    expect(fieldOf('time')).toBe('time')
    expect(fieldOf('fact')).toBeNull()
    expect(fieldOf('')).toBeNull()
  })

  it('tells when two descriptions disagree about something both name', () => {
    expect(contradicts('boots on', 'linen shirt, boots off by the hatch')).toBe(true)
    expect(contradicts('the shutters open', 'the shutters closed and barred')).toBe(true)
    expect(contradicts('standing by the hatch', 'sitting on a sack')).toBe(true)
    // Different words that agree, or say nothing against it.
    expect(contradicts('cloak on, boots off', 'boots off, cloak on')).toBe(false)
    expect(contradicts('boots off', 'linen shirt, boots off by the hatch')).toBe(false)
    expect(contradicts('a grey cloak', 'linen shirt, boots off by the hatch')).toBe(false)
    expect(contradicts('in the loft', 'the mill loft')).toBe(false)
  })
})

describe('checking the plan against the stage', () => {
  it("relies on positions in the stage's own words, leaves out guesses, and keeps facts it was given", () => {
    const w = world()
    const p = checkPlan(
      raw({
        relies: [
          { who: 'Wren', what: 'wearing', value: 'a red coat' },
          { who: 'Wren', what: 'position', value: 'sitting on a sack' },
          { who: 'Wren', what: 'holding', value: 'a silver knife' },
          // The stage has her condition: its words win.
          { who: 'Wren', what: 'condition', value: 'a burn scar on her right hand' },
          // Not on the stage, but in what the planner was given.
          { who: 'Osric Hale', what: 'holding', value: 'the abbey keys' },
          { who: '', what: 'time', value: 'midnight' },
          { who: '', what: 'fact', value: 'The weir is failing' },
          { who: '', what: 'fact', value: 'The abbot is secretly alive' },
          { who: 'Osric', what: 'where', value: 'at the foot of the stairs' }
        ]
      }),
      { ...w, material: `${MATERIAL}\nOsric Hale carries the abbey keys.` }
    )
    expect(p.keep).toEqual([
      'Wren is wearing: linen shirt, boots off by the hatch',
      'How Wren is placed: sitting on a sack',
      'Wren: left arm in a sling',
      'Osric Hale is holding: the abbey keys',
      'Time: dusk',
      'The weir is failing',
      'Where Osric Hale is: the foot of the stairs'
    ])
    // Put right: what she wears, her condition, the time and where Osric is; left out: the knife and the abbot alive.
    expect(p.checked).toEqual({ corrected: 4, dropped: 2 })
  })

  it("leaves out a change that is already so, one planned from a picture the stage says isn't so, and the dead's", () => {
    const w = world()
    const p = checkPlan(
      raw({
        changes: [
          { who: 'Wren', what: 'wearing', from: 'boots on', to: 'boots off', how: 'Wren pulls off her boots.' },
          { who: 'Wren', what: 'position', from: 'sitting on a sack', to: 'sitting on a sack', how: 'Wren sits down.' },
          { who: 'Abbot Fen', what: 'where', from: '', to: 'the loft', how: 'The abbot climbs into the loft.' },
          { who: 'Wren', what: 'position', from: 'sitting on a sack', to: 'standing at the hatch', how: 'Wren gets up and goes to the hatch.' },
          { who: 'Osric Hale', what: 'where', from: '', to: 'the loft', how: '' },
          { who: '', what: 'fact', from: '', to: '', how: 'Someone knocks below.' },
          { who: '', what: 'fact', from: '', to: '', how: 'Someone knocks below.' }
        ]
      }),
      { ...w, material: MATERIAL }
    )
    expect(p.changes).toEqual(['Wren gets up and goes to the hatch.', 'Osric Hale: where now the loft', 'Someone knocks below.'])
    expect(p.checked.dropped).toBe(3)
  })

  it('finds what it asks for by name or other name, never what the briefing has or Adam kept out, and only a few', () => {
    const w = world()
    const p = checkPlan(raw({ needs: ['the old weir', 'The mill', 'The black ledger', 'the tithe ledger (an item)', 'Nobody'] }), { ...w, material: '' })
    expect(p.needs).toEqual([w.weir.id, w.ledger.id])
    const many = Array.from({ length: 8 }, (_, i) => entry('place', `Room ${i}`))
    const q = checkPlan(raw({ needs: many.map((e) => e.name) }), { ...w, entries: many, material: '' })
    expect(q.needs).toHaveLength(PLAN_MOST.needs)
  })

  it("is written as the writer's own notes, leading into the prose; nothing when it says nothing", () => {
    const text = planText({ keep: ['Wren: left arm in a sling'], changes: ['Wren gets up.', 'Someone knocks.'] }, false)
    expect(text).toBe(
      `${PLAN_HEAD}\nWhat the scene rests on, as things stand:\n- Wren: left arm in a sling\nWhat happens on the page, in order:\n1. Wren gets up.\n2. Someone knocks.\n${PLAN_GO.start}`
    )
    expect(planText({ keep: [], changes: ['Wren gets up.'] }, true).endsWith(PLAN_GO.here)).toBe(true)
    expect(planText({ keep: [], changes: [] }, false)).toBe('')
  })
})

// ---------- What the planner reads ----------

function draftInput(): ContextInput {
  const wren = entry('character', 'Wren', { summary: 'A miller’s daughter.' })
  const osric = entry('character', 'Osric Hale', { aliases: ['the reeve'] })
  const weir = entry('place', 'The weir')
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
    scene: { title: 'The hatch', card: { ...emptySceneCard(), povId: wren.id, presentIds: [wren.id], beats: ['Osric climbs up'] } },
    memory: {
      storyId: 'mill',
      sceneId: 'here',
      knows: '',
      previous: { sceneId: 'before', title: 'Before', text: 'The sleet came on, and the wheel stopped.', storyId: 'mill', storyTitle: 'The Mill', otherStory: null },
      entries: [wren, osric, weir],
      firstHere: [],
      elsewhere: [],
      relationships: [],
      facts: [],
      threads: [],
      storySoFar: { scenes: [], chapters: [], stories: [], series: [], leadsInto: null },
      bringAbout: []
    },
    pins: [],
    blockModes: {},
    world: { themes: '', tone: '' },
    series: null,
    story: { title: 'The Mill', premise: '', themes: '', tone: '' },
    options: { direction: '', targetWords: 800, creativity: 'balanced' },
    contextLength: 64_000,
    continuity: STAND
  }
}

describe('what the planner reads', () => {
  it('the scene card, what must stay true, where things stand, the words before, what the writer is asked and the codex', () => {
    const input = draftInput()
    const prepared = prepareContext(input, { speakerTags: true })
    const preview = assembleContext(input, countRaw)
    const m = planMaterial(input, preview, prepared)
    expect(m.card).toContain('Beats, in order:\n1. Osric climbs up')
    expect(m.must).toContain('Wren: left arm in a sling')
    expect(m.stand).toContain('- Wren: where: the mill loft')
    expect(m.before).toEqual({ title: 'The end of the previous scene', text: 'The sleet came on, and the wheel stopped.' })
    expect(m.ask.startsWith('Write the scene now.')).toBe(true)
    // Not the reading-aloud tags: the planner writes none of the prose.
    expect(m.ask).not.toContain('curly braces')
    expect(m.inBriefing).toEqual(['Wren (character): A miller’s daughter.'])
    expect(m.others).toEqual(['Osric Hale (character; also the reeve)', 'The weir (place)'])
    const [system, user] = planMessages(m)
    expect(system.content.startsWith(PLAN_MARKER)).toBe(true)
    expect(user.content).toContain('## Also in the world (not in the briefing)\nOsric Hale (character; also the reeve); The weir (place)')
    expect(user.content.trimEnd().endsWith('Plan the scene now, as one JSON object.')).toBe(true)
  })
})

// ---------- The call ----------

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/memory', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null },
  thinking: 'off'
}

/** A stand-in model that answers every request with `reply`. */
function answering(reply: string): typeof fetch & { asked: { model: string; system: string }[] } {
  const asked: { model: string; system: string }[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model: string; messages: { content: string }[] }
    asked.push({ model: body.model, system: body.messages[0].content })
    const chunk = { choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: { model: string; system: string }[] }
  f.asked = asked
  return f
}

/** A stand-in model that never answers until it is stopped. */
const silent = (async (_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })))
  })) as typeof fetch

function call(fetchImpl: typeof fetch, over: { signal?: AbortSignal; limitMs?: number } = {}) {
  const db = memoryWorld()
  const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
  const material: PlanMaterial = { ask: 'Write the scene now.', card: 'Scene: The hatch', must: MATERIAL, stand: '', before: null, inBriefing: [], others: ['The weir (place)'] }
  const w = world()
  return {
    db,
    sceneId,
    done: makePlan({
      db,
      model,
      sceneId,
      material,
      check: { stand: w.stand, entries: w.entries, inBriefing: w.inBriefing, hidden: w.hidden },
      carryingOn: false,
      closed: () => false,
      fetchImpl,
      retryDelays: [],
      ...over
    }),
    w
  }
}

describe('making the plan', () => {
  it('asks the memory model once, keeps the call in a memory record, and gives back the checked plan', async () => {
    const reply = JSON.stringify({
      relies: [{ who: 'Wren', what: 'wearing', value: 'a red coat' }],
      changes: [{ who: 'Wren', what: 'position', from: 'sitting on a sack', to: 'standing', how: 'Wren stands to meet him.' }],
      needs: ['The weir']
    })
    const f = answering(reply)
    const { db, sceneId, done, w } = call(f)
    const plan = await done
    expect(f.asked).toHaveLength(1)
    expect(f.asked[0].system.startsWith(PLAN_MARKER)).toBe(true)
    expect(plan).toEqual({
      needs: [w.weir.id],
      text: `${PLAN_HEAD}\nWhat the scene rests on, as things stand:\n- Wren is wearing: linen shirt, boots off by the hatch\nWhat happens on the page, in order:\n1. Wren stands to meet him.\n${PLAN_GO.start}`,
      checked: { corrected: 1, dropped: 0 }
    })
    expect(db.prepare('SELECT job, scene_id, status FROM generations').all()).toEqual([{ job: 'memory', scene_id: sceneId, status: 'complete' }])
  })

  it('no plan when the reply is no use, the call fails, takes too long or is stopped', async () => {
    expect(await call(answering('The scene should be tense.')).done).toBeNull()
    expect(await call(answering('{"relies": [], "changes": [], "needs": []}')).done).toBeNull()
    const failing = (async () => new Response(JSON.stringify({ error: { message: 'No endpoints found' } }), { status: 404 })) as typeof fetch
    expect(await call(failing).done).toBeNull()
    // Too long: stopped at the limit, and the draft goes on without it.
    const started = Date.now()
    const late = call(silent, { limitMs: 80 })
    expect(await late.done).toBeNull()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(late.db.prepare('SELECT status FROM generations').get()).toEqual({ status: 'stopped' })
    // Adam stopped the draft before it began.
    const stop = new AbortController()
    const stopped = call(silent, { signal: stop.signal, limitMs: 60_000 })
    setTimeout(() => stop.abort(), 20)
    expect(await stopped.done).toBeNull()
    const already = new AbortController()
    already.abort()
    const f = answering('{}')
    expect(await call(f, { signal: already.signal }).done).toBeNull()
    expect(f.asked).toHaveLength(0)
  })
})
