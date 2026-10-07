// Where things stand: the memory model's reply laid over the state before, only the latest of each kept, Adam's
// edits kept until the words change, and nothing used once the words it came from (or an earlier scene's state)
// changed. The model is a stand-in that answers with the state each test gives it.
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import type { MemoryModel } from '../keeper/model'
import {
  editState,
  keptStateBefore,
  mergeState,
  readState,
  stateAfter,
  stateAtText,
  stateBefore,
  stateMessages,
  stateText,
  storedState,
  type SceneState
} from './tracker'

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
}

/** A stand-in model: each request answers with the next state given, and the requests are counted. */
function answering(...replies: Partial<SceneState>[]): typeof fetch & { asked: string[] } {
  const asked: string[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
    asked.push(body.messages[1].content)
    const reply = replies[Math.min(asked.length - 1, replies.length - 1)]
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: string[] }
  f.asked = asked
  return f
}

function world(): { db: Database.Database; one: ID; two: ID; three: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const one = o.scenes[0].id
  const two = repo.createScene(db, o.chapters[0].id, { title: 'Two' }).id
  const three = repo.createScene(db, o.chapters[0].id, { title: 'Three' }).id
  return { db, one, two, three }
}

function write(db: Database.Database, sceneId: ID, text: string): void {
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text }] }] }
  repo.saveSceneText(db, sceneId, doc, text)
  kdb.noteSceneSaved(db, sceneId)
}

const opts = (db: Database.Database, fetchImpl: typeof fetch) => ({
  db,
  model,
  signal: new AbortController().signal,
  closed: () => false,
  fetchImpl,
  retryDelays: [0]
})

const mara = (more: Partial<SceneState['characters'][number]>) => ({
  name: 'Mara',
  where: '',
  wearing: '',
  posture: '',
  holding: '',
  condition: '',
  mood: '',
  lastAction: '',
  ...more
})

describe('where things stand', () => {
  it('lays what a scene changes over the state before, keeping only the latest of each', () => {
    const before: SceneState = { time: 'dusk', weather: 'rain', light: '', characters: [mara({ wearing: 'a grey cloak', holding: 'a lamp' })] }
    const after = mergeState(before, { time: 'night', characters: [mara({ wearing: 'a dry shirt', posture: 'sitting by the fire' })] })
    expect(after.time).toBe('night')
    expect(after.weather).toBe('rain')
    expect(after.characters[0]).toMatchObject({ wearing: 'a dry shirt', holding: 'a lamp', posture: 'sitting by the fire' })
    expect(stateText(after)).toBe('Time: night. Weather: rain\n- Mara: wearing: a dry shirt; position: sitting by the fire; holding: a lamp')
    expect(readState('not json')).toBeNull()
    expect(readState('Here: {"time": "noon", "characters": [{"name": "Tobin", "where": "the dock"}, {"where": "nobody"}]}')).toEqual({
      time: 'noon',
      weather: '',
      light: '',
      characters: [{ name: 'Tobin', where: 'the dock', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }]
    })
  })

  it('is asked for once for the same words, again when they change, and builds on the scene before', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat by the fire.')
    const f = answering({ characters: [mara({ wearing: 'a grey cloak' })] }, { characters: [mara({ posture: 'sitting by the fire' })] })
    const start = await stateBefore(opts(w.db, f), w.three)
    expect(start?.characters[0]).toMatchObject({ wearing: 'a grey cloak', posture: 'sitting by the fire' })
    expect(f.asked).toHaveLength(2)
    // The second scene was told how the first ended.
    expect(f.asked[1]).toContain('wearing: a grey cloak')
    await stateBefore(opts(w.db, f), w.three)
    expect(f.asked).toHaveLength(2)
    expect(keptStateBefore(w.db, w.three)?.characters[0].wearing).toBe('a grey cloak')
  })

  it('never tells a ghost: an edit to the words, or to an earlier scene, sets the state aside until it is read again', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat by the fire.')
    await stateBefore(opts(w.db, answering({ characters: [mara({ wearing: 'a grey cloak' })] }, { characters: [mara({ posture: 'sitting' })] })), w.three)
    // The cloak goes from the first scene: the second scene's state built on it no longer stands.
    write(w.db, w.one, 'Mara left her cloak behind.')
    expect(storedState(w.db, w.two)?.current).toBe(false)
    expect(keptStateBefore(w.db, w.three)).toBeNull()
    // Read again, it carries no cloak.
    const f = answering({ characters: [mara({ wearing: 'no cloak' })] }, { characters: [mara({ posture: 'sitting' })] })
    const start = await stateBefore(opts(w.db, f), w.three)
    expect(f.asked).toHaveLength(2)
    expect(start?.characters[0]).toMatchObject({ wearing: 'no cloak', posture: 'sitting' })
  })

  it('keeps Adam’s edits until the words change, then reads them afresh', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak. Tobin waited.')
    await stateAfter(opts(w.db, answering({ characters: [mara({ wearing: 'a grey cloak' }), { ...mara({ where: 'the door' }), name: 'Tobin' }] })), w.one)
    editState(w.db, w.one, (e) => {
      e.characters = { mara: { wearing: 'a red cloak' } }
      e.removed = ['tobin']
      e.scene = { weather: 'snow' }
    })
    const edited = storedState(w.db, w.one)!
    expect(edited).toMatchObject({ current: true, edited: true })
    expect(edited.state.characters.map((c) => [c.name, c.wearing])).toEqual([['Mara', 'a red cloak']])
    expect(edited.state.weather).toBe('snow')
    // The scene after starts from Adam's version.
    expect(keptStateBefore(w.db, w.two)?.characters[0].wearing).toBe('a red cloak')
    // New words: read afresh, his edits go with the old words.
    write(w.db, w.one, 'Mara took her cloak off.')
    await stateAfter(opts(w.db, answering({ characters: [mara({ wearing: 'a shirt' })] })), w.one)
    expect(storedState(w.db, w.one)).toMatchObject({ edited: false })
    expect(storedState(w.db, w.one)!.state.characters.map((c) => c.wearing)).toEqual(['a shirt'])
  })

  it('works out where things stand at the end of the scene so far, built on the scene before, once for the same words', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara came in out of the rain. She hung her cloak over the chair and kicked off her boots. Later she left.')
    const f = answering(
      { characters: [mara({ wearing: 'a grey cloak, boots' })] },
      { characters: [mara({ wearing: 'a wet shirt, boots off (by the door)', posture: 'sitting on the bed' })] }
    )
    const soFar = 'Mara came in out of the rain. She hung her cloak over the chair and kicked off her boots.'
    const here = await stateAtText(opts(w.db, f), w.two, soFar)
    expect(here?.characters[0]).toMatchObject({ wearing: 'a wet shirt, boots off (by the door)', posture: 'sitting on the bed' })
    expect(f.asked).toHaveLength(2)
    // Told how the scene before ended, and that this is the scene so far, not a finished scene.
    expect(f.asked[1]).toContain('wearing: a grey cloak, boots')
    expect(f.asked[1]).toContain('this is the scene so far')
    expect(f.asked[1]).toContain(soFar)
    // The same words again: not asked for again; and the scene's own state (for the scene after) is untouched.
    await stateAtText(opts(w.db, f), w.two, soFar)
    expect(f.asked).toHaveLength(2)
    expect(storedState(w.db, w.two)).toBeNull()
  })

  it('at the end of the scene’s saved words, is the scene’s own state, kept for the scene after', async () => {
    const w = world()
    write(w.db, w.one, 'Mara sat on the bed and unbuttoned her shirt.')
    const f = answering({ characters: [mara({ wearing: 'a shirt, unbuttoned', posture: 'sitting on the bed' })] })
    const here = await stateAtText(opts(w.db, f), w.one, 'Mara sat on the bed and unbuttoned her shirt.')
    expect(here?.characters[0].posture).toBe('sitting on the bed')
    expect(f.asked).toHaveLength(1)
    expect(f.asked[0]).not.toContain('this is the scene so far')
    expect(keptStateBefore(w.db, w.two)?.characters[0].wearing).toBe('a shirt, unbuttoned')
  })

  it('says nothing rather than the state before when the model can’t say', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat down.')
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    await stateBefore(opts(w.db, answering({ characters: [mara({ wearing: 'a grey cloak' })] })), w.two)
    expect(await stateAtText(opts(w.db, failing), w.two, 'Mara sat')).toBeNull()
  })

  it('asks for every piece of clothing and how it sits, and the whole pose', () => {
    const [system] = stateMessages(null, 'Words.', ['Mara'])
    expect(system.content).toContain('everything they have on, item by item')
    expect(system.content).toContain('Always the whole outfit as it is now')
    expect(system.content).toContain('what their hands, arms and legs are doing')
    expect(system.content).toContain('Never guess')
  })
})
