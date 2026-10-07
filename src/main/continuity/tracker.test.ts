// Where things stand: the memory model's reply laid over the state before, only the latest of each kept, each value
// with the words that show it (one without is left out), Adam's edits kept until the words change, checkpoints inside
// scenes so only new words are read, and nothing used once the words it came from (or an earlier scene's state)
// changed. The model is a stand-in that answers with the state each test gives it.
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { quoteFound } from '@shared/continuity'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import type { MemoryModel } from '../keeper/model'
import {
  editState,
  keptStateBefore,
  mergeState,
  readChanges,
  stateAfter,
  stateAtText,
  stateBefore,
  stateMessages,
  stateText,
  storedState,
  storedStateAt,
  type SceneState
} from './tracker'

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
}

/** The words a request gives to be read (the scene, or the rest of it from a checkpoint). */
const wordsAsked = (content: string): string => /The scene[^\n]*:\n"""\n([\s\S]*?)\n"""/.exec(content)?.[1] ?? ''

/**
 * A stand-in model: each request answers with the next state given, each value backed by the first words of what it
 * was given to read (or by `quote`, when a test gives one), and the requests are counted.
 */
function answering(...replies: (Partial<SceneState> & { quote?: string })[]): typeof fetch & { asked: string[] } {
  const asked: string[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
    asked.push(body.messages[1].content)
    const { quote: given, ...reply } = replies[Math.min(asked.length - 1, replies.length - 1)]
    const quote = given ?? wordsAsked(body.messages[1].content).split(/\s+/).slice(0, 3).join(' ')
    const backed = (v: unknown) => (typeof v === 'string' && v ? { value: v, quote } : undefined)
    const said = {
      time: backed(reply.time),
      weather: backed(reply.weather),
      light: backed(reply.light),
      characters: (reply.characters ?? []).map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === 'name' ? v : backed(v)])))
    }
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(said) }, finish_reason: 'stop' }] }
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
    expect(readChanges('not json', '', 's1')).toBeNull()
  })

  it('keeps a value only with the words that show it, and keeps those words with it', () => {
    const words = 'Tobin stood on the dock. “Not yet,” he said, and pulled his collar up.'
    const read = readChanges(
      `Here: {"time": {"value": "noon", "quote": "the sun was high"}, "characters": [
        {"name": "Tobin", "where": {"value": "the dock", "quote": "Tobin stood on the dock"},
         "wearing": {"value": "a coat, collar up", "quote": "pulled  his COLLAR up!"}, "mood": "wary",
         "posture": {"value": "standing", "quote": "Tobin stood … his collar"}},
        {"where": {"value": "nobody", "quote": "on the dock"}}]}`,
      words,
      's1'
    )!
    // No such words: no time. A value given without words: left out. Case, spacing and punctuation don't matter.
    expect(read.time).toBe('')
    expect(read.characters).toEqual([
      { name: 'Tobin', where: 'the dock', wearing: 'a coat, collar up', posture: 'standing', holding: '', condition: '', mood: '', lastAction: '' }
    ])
    expect(read.said?.['tobin|wearing']).toEqual({ quote: 'pulled his COLLAR up!', sceneId: 's1' })
    // Carried on: the words stay with the value until a new value replaces it.
    const before: SceneState = { time: '', weather: '', light: '', characters: [mara({ holding: 'a lamp' })], said: { 'mara|holding': { quote: 'took the lamp', sceneId: 's0' } } }
    const after = mergeState(before, read)
    expect(after.said).toMatchObject({ 'mara|holding': { quote: 'took the lamp' }, 'tobin|where': { quote: 'Tobin stood on the dock' } })
    expect(mergeState(after, { characters: [mara({ holding: 'nothing' })] }).said?.['mara|holding']).toBeUndefined()
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

  it('keeps checkpoints inside a scene and reads on from the latest, only the new words', async () => {
    const w = world()
    const first = 'Mara came in out of the rain and hung her cloak over the chair.'
    const second = `${first}\n\nShe sat on the bed and pulled off her boots.`
    const all = `${second}\n\nThen she lay back and closed her eyes.`
    write(w.db, w.one, all)
    const f = answering(
      { characters: [mara({ wearing: 'a wet shirt; cloak over the chair', where: 'her room' })] },
      { characters: [mara({ wearing: 'a wet shirt; cloak over the chair; boots off', posture: 'sitting on the bed' })] },
      { characters: [mara({ posture: 'lying on the bed, eyes closed' })] }
    )
    await stateAtText(opts(w.db, f), w.one, first)
    const here = await stateAtText(opts(w.db, f), w.one, second)
    expect(here?.characters[0]).toMatchObject({ where: 'her room', posture: 'sitting on the bed' })
    // The second reading started from the first checkpoint: only the new paragraph to read, the one before to lead in.
    expect(wordsAsked(f.asked[1])).toBe('\n\nShe sat on the bed and pulled off her boots.')
    expect(f.asked[1]).toContain('already counted')
    expect(f.asked[1]).toContain('where: her room')
    // The scene's end reads on from the second checkpoint; asked again, nothing is read again.
    const end = await stateAfter(opts(w.db, f), w.one)
    expect(wordsAsked(f.asked[2])).toBe('\n\nThen she lay back and closed her eyes.')
    expect(end?.characters[0]).toMatchObject({ wearing: 'a wet shirt; cloak over the chair; boots off', posture: 'lying on the bed, eyes closed' })
    await stateAtText(opts(w.db, f), w.one, second)
    expect(f.asked).toHaveLength(3)
    // Kept, without asking: at the end, at a checkpoint, and after one (the nearest before, not exact).
    expect(storedStateAt(w.db, w.one, all)).toMatchObject({ exact: true, current: true })
    expect(storedStateAt(w.db, w.one, second)?.state.characters[0].posture).toBe('sitting on the bed')
    expect(storedStateAt(w.db, w.one, `${second}\n\nThen she lay`)).toMatchObject({ exact: false })
    expect(storedStateAt(w.db, w.one, 'Mara came')).toBeNull()
  })

  it('never reads on from a checkpoint whose words changed, or whose scene now starts differently', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat by the fire. She warmed her hands.')
    const f = answering({ characters: [mara({ wearing: 'a grey cloak' })] }, { characters: [mara({ posture: 'sitting by the fire' })] })
    await stateAtText(opts(w.db, f), w.two, 'Mara sat by the fire.')
    // Words before the checkpoint edited: read from the start of the scene.
    await stateAtText(opts(w.db, f), w.two, 'Mara knelt by the fire. She warmed her hands.')
    expect(wordsAsked(f.asked.at(-1)!)).toBe('Mara knelt by the fire. She warmed her hands.')
    // The scene before changed: its checkpoints are set aside too.
    write(w.db, w.one, 'Mara left her cloak behind.')
    const g = answering({ characters: [mara({ wearing: 'no cloak' })] }, { characters: [mara({ posture: 'sitting by the fire' })] })
    expect(storedStateAt(w.db, w.two, 'Mara sat by the fire.')).toBeNull()
    await stateAtText(opts(w.db, g), w.two, 'Mara sat by the fire. She warmed')
    expect(wordsAsked(g.asked.at(-1)!)).toBe('Mara sat by the fire. She warmed')
  })

  it('carries what Adam put right into the words that follow', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    await stateAfter(opts(w.db, answering({ characters: [mara({ wearing: 'a grey cloak' })] })), w.one)
    editState(w.db, w.one, (e) => {
      e.characters = { mara: { wearing: 'a red cloak' } }
    })
    // The scene goes on: read from his version, and what the new words don't change stays his.
    write(w.db, w.one, 'Mara pulled on her grey cloak.\n\nShe sat down.')
    const f = answering({ characters: [mara({ posture: 'sitting' })] })
    const end = await stateAfter(opts(w.db, f), w.one)
    expect(f.asked[0]).toContain('wearing: a red cloak')
    expect(end?.characters[0]).toMatchObject({ wearing: 'a red cloak', posture: 'sitting' })
  })

  it('leaves out a value whose words aren’t in the scene: it carries on from before instead', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat by the fire.')
    await stateAfter(opts(w.db, answering({ characters: [mara({ wearing: 'a grey cloak' })] })), w.one)
    const guess = answering({ characters: [mara({ wearing: 'a blue dress' })], quote: 'in her blue dress' })
    const end = await stateAfter(opts(w.db, guess), w.two)
    expect(end?.characters[0].wearing).toBe('a grey cloak')
    expect(end?.said?.['mara|wearing']).toEqual({ quote: 'Mara pulled on', sceneId: w.one })
  })

  it('carries on into the scene so far while a scene far back waits to be read again', async () => {
    const w = world()
    const chapter = repo.getOutline(w.db, repo.listStories(w.db)[0].id).chapters[0].id
    const four = repo.createScene(w.db, chapter, { title: 'Four' }).id
    const five = repo.createScene(w.db, chapter, { title: 'Five' }).id
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara walked to the inn.')
    write(w.db, w.three, 'Mara ate her supper.')
    write(w.db, four, 'Mara climbed the stairs.')
    const f = answering(
      { characters: [mara({ wearing: 'a grey cloak' })] },
      { characters: [mara({ where: 'the inn' })] },
      { characters: [mara({ mood: 'full' })] },
      { characters: [mara({ where: 'upstairs' })] },
      { characters: [mara({ posture: 'sitting on the bed' })] },
      { characters: [mara({ posture: 'lying down' })] }
    )
    await stateAfter(opts(w.db, f), w.one)
    await stateBefore(opts(w.db, f), five)
    expect(f.asked).toHaveLength(4)
    // The first scene changes: more than three back from the fifth, so it isn't read again before a draft there.
    write(w.db, w.one, 'Mara pulled on her grey cloak and smiled.')
    const soFar = 'Mara sat on the bed.'
    write(w.db, five, `${soFar}\n\nThen she lay down.`)
    const here = await stateAtText(opts(w.db, f), five, soFar)
    // The scenes before are kept at their ends (no new reading), and the scene so far builds on them; so does a
    // draft of the scene from its start, and a check of it.
    expect(f.asked).toHaveLength(5)
    expect(keptStateBefore(w.db, five)?.characters[0]).toMatchObject({ wearing: 'a grey cloak', where: 'upstairs' })
    expect(f.asked[4]).toContain('wearing: a grey cloak')
    expect(here?.characters[0]).toMatchObject({ wearing: 'a grey cloak', where: 'upstairs', posture: 'sitting on the bed' })
    // Recall at the cursor finds that checkpoint, and the scene's end reads on from it.
    expect(storedStateAt(w.db, five, soFar)?.state.characters[0].posture).toBe('sitting on the bed')
    await stateAfter(opts(w.db, f), five)
    expect(wordsAsked(f.asked[5])).toBe('\n\nThen she lay down.')
  })

  it('never takes a value from the words before a checkpoint: they are already counted', async () => {
    const w = world()
    const first = 'Mara sat on the bed.'
    write(w.db, w.one, `${first}\n\nShe yawned and stretched.`)
    const f = answering({ characters: [mara({ posture: 'sitting on the bed' })] }, { characters: [mara({ posture: 'standing' })], quote: 'Mara sat on the bed' })
    await stateAtText(opts(w.db, f), w.one, first)
    const end = await stateAfter(opts(w.db, f), w.one)
    expect(f.asked[1]).toContain('already counted')
    expect(end?.characters[0].posture).toBe('sitting on the bed')
  })

  it('needs at least two words in each place a quote is taken from', () => {
    const words = 'Mara came in. She hung her grey cloak on the peg.'
    expect(quoteFound('Mara came', words)).toBe(true)
    expect(quoteFound('Mara came … grey cloak', words)).toBe(true)
    expect(quoteFound('Mara … cloak', words)).toBe(false)
    expect(quoteFound('cloak', words)).toBe(false)
  })

  it('keeps what Adam put right while the model was reading', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat by the fire.')
    await stateBefore(opts(w.db, answering({ characters: [mara({ wearing: 'a grey cloak' })] }, { characters: [mara({ posture: 'sitting' })] })), w.three)
    write(w.db, w.one, 'Mara pulled on her red cloak.')
    await stateAfter(opts(w.db, answering({ characters: [mara({ wearing: 'a red cloak' })] })), w.one)
    // The second scene is read again (it built on the old first); Adam puts a value right while it is.
    const inner = answering({ characters: [mara({ posture: 'sitting by the fire' })] })
    const f = (async (input: unknown, init?: RequestInit) => {
      editState(w.db, w.two, (e) => {
        e.characters = { mara: { mood: 'tired' } }
      })
      return inner(input as string, init)
    }) as typeof fetch
    const end = await stateAfter(opts(w.db, f), w.two)
    expect(end?.characters[0]).toMatchObject({ wearing: 'a red cloak', posture: 'sitting by the fire', mood: 'tired' })
    expect(storedState(w.db, w.two)).toMatchObject({ edited: true, current: true })
  })

  it('keeps the latest checkpoints of a scene, the oldest going first', async () => {
    const w = world()
    const words = Array.from({ length: 10 }, (_, i) => `Mara took step number ${i + 1}.`)
    write(w.db, w.one, words.join('\n\n'))
    const f = answering({ characters: [mara({ posture: 'walking' })] })
    for (let i = 1; i < words.length; i++) await stateAtText(opts(w.db, f), w.one, words.slice(0, i).join('\n\n'))
    // Nine read, eight kept: the first is gone, the second and later are still there.
    expect(storedStateAt(w.db, w.one, words[0])).toBeNull()
    expect(storedStateAt(w.db, w.one, words.slice(0, 2).join('\n\n'))).toMatchObject({ exact: true })
  })

  it('asks for every piece of clothing and how it sits, and the whole pose', () => {
    const [system] = stateMessages(null, 'Words.', ['Mara'])
    expect(system.content).toContain('everything they have on, item by item')
    expect(system.content).toContain('Always the whole outfit as it is now')
    expect(system.content).toContain('what their hands, arms and legs are doing')
    expect(system.content).toContain('Never guess')
  })
})
