// Where things stand: the memory model's reply laid over the state before, only the latest of each kept, each value
// with the words that show it (one without is left out), Adam's edits kept until the words change, checkpoints inside
// scenes so only new words are read, and nothing used once the words it came from (or an earlier scene's state)
// changed. The model is a stand-in that answers with the state each test gives it (what someone wears in one line, the
// way models were asked before step 2b; step 2b's own replies, piece by piece, are written out in its tests).
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { clothesOf, layGone, pieceKey, quoteFound, saysGone, thingKey, type CharacterState } from '@shared/continuity'
import { itemKey, MOST_CLOTHES, MOST_THINGS, pieceText } from '@shared/stageItems'
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

/** A character as kept since step 2b: what they wear piece by piece. */
const person = (name: string, more: Partial<CharacterState> = {}): CharacterState => ({
  name,
  where: '',
  posture: '',
  touching: '',
  sees: '',
  holding: '',
  condition: '',
  mood: '',
  lastAction: '',
  clothes: [],
  ...more
})

/** A character as these tests read them: what they wear in one line, each piece as it reads, "; " between. */
const seen = (c: CharacterState | null | undefined) => c && { ...c, wearing: clothesOf(c).map(pieceText).join('; ') }

/** A reply from the memory model, as it comes over the wire. */
const reply = (content: unknown): Response => {
  const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** A stand-in model that answers each request with the next reply given, as it is, and counts the requests. */
function replying(...replies: unknown[]): typeof fetch & { asked: string[] } {
  const asked: string[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
    asked.push(body.messages[1].content)
    return reply(replies[Math.min(asked.length - 1, replies.length - 1)])
  }) as typeof fetch & { asked: string[] }
  f.asked = asked
  return f
}

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16)

describe('where things stand', () => {
  it('lays what a scene changes over the state before, keeping only the latest of each', () => {
    const before: SceneState = { time: 'dusk', weather: 'rain', light: '', characters: [mara({ wearing: 'a grey cloak', holding: 'a lamp' })] }
    const after = mergeState(before, { time: 'night', characters: [mara({ wearing: 'a dry shirt', posture: 'sitting by the fire' })] })
    expect(after.time).toBe('night')
    expect(after.weather).toBe('rain')
    expect(seen(after.characters[0])).toMatchObject({ wearing: 'a dry shirt', holding: 'a lamp', posture: 'sitting by the fire' })
    expect(stateText(after)).toBe(
      'Time: night. Weather: rain\n- Mara: position: sitting by the fire; holding: a lamp\n  - wearing: a dry shirt'
    )
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
      {
        name: 'Tobin',
        where: 'the dock',
        wearing: 'a coat, collar up',
        posture: 'standing',
        touching: '',
        sees: '',
        holding: '',
        condition: '',
        mood: '',
        lastAction: ''
      }
    ])
    expect(read.said?.['tobin|wearing']).toEqual({ quote: 'pulled his COLLAR up!', sceneId: 's1' })
    // Carried on: the words stay with the value until a new value replaces it.
    const before: SceneState = { time: '', weather: '', light: '', characters: [mara({ holding: 'a lamp' })], said: { 'mara|holding': { quote: 'took the lamp', sceneId: 's0' } } }
    const after = mergeState(before, read)
    expect(after.said).toMatchObject({ 'mara|holding': { quote: 'took the lamp' }, 'tobin|where': { quote: 'Tobin stood on the dock' } })
    expect(mergeState(after, { characters: [mara({ holding: 'nothing' })] }).said?.['mara|holding']).toBeUndefined()
  })

  it('an empty hand clears what was held, words or no words (the trap run’s survey case)', () => {
    // The trap run (Adam, 2026-10-07): after Wren put the survey case on the sill and Ash hung Cinder's lead on the
    // mantel and went out, the memory model said so with no words. The values were left out, "holding: the survey case"
    // carried on, and the writer put the case back under her hand.
    const words =
      'She set the case on the sill where she could see it from the settle, and lay down with her feet to the fire. He hung the lead on the corner of the mantel, set his hat on the table and pulled his boots off by the hearth.'
    const reply = `{
      "time": {"value": "morning, the twentieth, after six", "quote": ""},
      "characters": [
        {"name": "Wren Hollis",
         "holding": {"value": "nothing", "quote": ""},
         "posture": {"value": "lying on the settle", "quote": "lay down with her feet to the fire"}},
        {"name": "Ash Penrose",
         "holding": {"value": "Cinder's lead, hung on the corner of the mantel", "quote": ""},
         "wearing": {"value": "hat off, set on the table brim up; boots off, set by the hearth", "quote": "he took his hat off"}}
      ]}`
    const read = readChanges(reply, words, 'inn')!
    // Without words, only what says something is gone counts: no time, but an empty hand.
    expect(read.time).toBe('')
    expect(read.characters?.find((c) => c.name === 'Wren Hollis')).toMatchObject({ holding: 'nothing', posture: 'lying on the settle' })
    expect(read.gone.sort()).toEqual(['ash penrose|holding', 'ash penrose|wearing', 'wren hollis|holding'])
    const before: SceneState = {
      time: 'morning, the twentieth, after six; the sun has come up',
      weather: '',
      light: '',
      characters: [
        { ...mara({ holding: 'the survey case, against her thigh', posture: 'sitting on the settle' }), name: 'Wren Hollis' },
        { ...mara({ holding: "Cinder's lead, wound round his fist", wearing: 'a coat with a knife-hole in the collar, collar up; hat down against the wind; boots' }), name: 'Ash Penrose' }
      ],
      said: {
        'wren hollis|holding': { quote: 'the case against her thigh', sceneId: 'inn' },
        'ash penrose|holding': { quote: "took Cinder's lead down", sceneId: 'inn' },
        'ash penrose|wearing': { quote: 'pulled his collar up', sceneId: 'inn' }
      }
    }
    const after = mergeState(before, read)
    const wren = after.characters.find((c) => c.name === 'Wren Hollis')!
    const ash = after.characters.find((c) => c.name === 'Ash Penrose')!
    expect(wren.holding).toBe('nothing')
    expect(ash.holding).toBe('nothing')
    // What he still wears stays; what came off says so, in place of how it was.
    expect(seen(ash)!.wearing).toBe(
      'a coat with a knife-hole in the collar, collar up; hat off, set on the table brim up; boots off, set by the hearth'
    )
    // The old words go with the old values: none are left standing behind an empty hand.
    expect(after.said?.['wren hollis|holding']).toBeUndefined()
    expect(after.said?.['ash penrose|holding']).toBeUndefined()
    expect(after.said?.['ash penrose|wearing']).toBeUndefined()
    expect(stateText(after, ['Wren Hollis'])).toContain('holding: nothing')
    expect(stateText(after)).not.toContain('survey case')
    // A value that doesn't say something is gone still needs its words; the same empty hand again changes nothing.
    const again = mergeState(after, readChanges('{"characters": [{"name": "Wren Hollis", "holding": {"value": "the survey case, against her thigh", "quote": ""}}]}', words, 'inn')!)
    expect(again.characters.find((c) => c.name === 'Wren Hollis')!.holding).toBe('nothing')
    const withWords = { ...after, said: { ...after.said, 'wren hollis|holding': { quote: 'set the case on the sill', sceneId: 'inn' } } }
    expect(mergeState(withWords, readChanges('{"characters": [{"name": "Wren Hollis", "holding": {"value": "Nothing.", "quote": ""}}]}', words, 'inn')!).said?.['wren hollis|holding']).toEqual({
      quote: 'set the case on the sill',
      sceneId: 'inn'
    })
    // With the words of the act, they are kept.
    const quoted = mergeState(before, readChanges('{"characters": [{"name": "Wren Hollis", "holding": {"value": "nothing; the case on the sill", "quote": "She set the case on the sill"}}]}', words, 'inn')!)
    expect(quoted.characters[0].holding).toBe('nothing; the case on the sill')
    expect(quoted.said?.['wren hollis|holding']).toEqual({ quote: 'She set the case on the sill', sceneId: 'inn' })
  })

  it('knows what says something is gone, and what doesn’t', () => {
    for (const v of ['nothing', 'Nothing in her hands', 'none', 'empty-handed', 'nothing; the compass given away', 'the survey case, set on the bench beside the settle', "Cinder's lead, hung on the corner of the mantel; the lamp, given to Rook"])
      expect(saysGone('holding', v), v).toBe(true)
    for (const v of ['the survey case, against her thigh', 'the lamp in her left hand by the window', 'his stick over his shoulder; a pot of grease, set on the stone', 'the case, on her lap', 'the knife, not put down and not lifted', ''])
      expect(saysGone('holding', v), v).toBe(false)
    for (const v of ['barefoot', 'nothing on her feet', 'hat off; boots off, by the door', 'naked', 'coat taken off, over the chair'])
      expect(saysGone('wearing', v), v).toBe(true)
    for (const v of ['hat off; boots still on', 'boots on', 'a white shirt, dark trousers, boots off', 'boots never taken off'])
      expect(saysGone('wearing', v), v).toBe(false)
    expect(saysGone('time', 'nothing')).toBe(false)
    // Bare feet: whatever was on them goes; the rest stays.
    expect(layGone('wearing', 'a grey cloak; boots, laced', 'barefoot')).toBe('a grey cloak; barefoot')
    // Something put down that wasn't known to be held: still not known.
    expect(layGone('holding', '', 'the lamp, set on the table')).toBeNull()
    expect(layGone('holding', 'the lamp; a knife', 'the lamp, set on the table')).toBe('a knife')
  })

  it('is asked for once for the same words, again when they change, and builds on the scene before', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat by the fire.')
    const f = answering({ characters: [mara({ wearing: 'a grey cloak' })] }, { characters: [mara({ posture: 'sitting by the fire' })] })
    const start = await stateBefore(opts(w.db, f), w.three)
    expect(seen(start?.characters[0])).toMatchObject({ wearing: 'a grey cloak', posture: 'sitting by the fire' })
    expect(f.asked).toHaveLength(2)
    // The second scene was told how the first ended.
    expect(f.asked[1]).toContain('wearing: a grey cloak')
    await stateBefore(opts(w.db, f), w.three)
    expect(f.asked).toHaveLength(2)
    expect(seen(keptStateBefore(w.db, w.three)?.characters[0])?.wearing).toBe('a grey cloak')
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
    expect(seen(start?.characters[0])).toMatchObject({ wearing: 'no cloak', posture: 'sitting' })
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
    expect(edited.state.characters.map((c) => [c.name, seen(c)!.wearing])).toEqual([['Mara', 'a red cloak']])
    expect(edited.state.weather).toBe('snow')
    // The scene after starts from Adam's version.
    expect(seen(keptStateBefore(w.db, w.two)?.characters[0])?.wearing).toBe('a red cloak')
    // New words: read afresh, his edits go with the old words.
    write(w.db, w.one, 'Mara took her cloak off.')
    await stateAfter(opts(w.db, answering({ characters: [mara({ wearing: 'a shirt' })] })), w.one)
    expect(storedState(w.db, w.one)).toMatchObject({ edited: false })
    expect(storedState(w.db, w.one)!.state.characters.map((c) => seen(c)!.wearing)).toEqual(['a shirt'])
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
    expect(seen(here?.characters[0])).toMatchObject({ wearing: 'a wet shirt; boots off (by the door)', posture: 'sitting on the bed' })
    expect(f.asked).toHaveLength(2)
    // Told how the scene before ended, and that this is the scene so far, not a finished scene.
    expect(f.asked[1]).toContain('  - wearing: a grey cloak\n  - wearing: boots')
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
    expect(seen(keptStateBefore(w.db, w.two)?.characters[0])?.wearing).toBe('a shirt, unbuttoned')
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
    expect(seen(end?.characters[0])).toMatchObject({
      wearing: 'a wet shirt; cloak over the chair; boots off',
      posture: 'lying on the bed, eyes closed'
    })
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
    expect(seen(end?.characters[0])).toMatchObject({ wearing: 'a red cloak', posture: 'sitting' })
  })

  it('leaves out a value whose words aren’t in the scene: it carries on from before instead', async () => {
    const w = world()
    write(w.db, w.one, 'Mara pulled on her grey cloak.')
    write(w.db, w.two, 'Mara sat by the fire.')
    await stateAfter(opts(w.db, answering({ characters: [mara({ wearing: 'a grey cloak' })] })), w.one)
    const guess = answering({ characters: [mara({ wearing: 'a blue dress' })], quote: 'in her blue dress' })
    const end = await stateAfter(opts(w.db, guess), w.two)
    expect(seen(end?.characters[0])?.wearing).toBe('a grey cloak')
    expect(end?.said?.[pieceKey('Mara', 'a grey cloak')]).toEqual({ quote: 'Mara pulled on', sceneId: w.one })
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
    expect(seen(keptStateBefore(w.db, five)?.characters[0])).toMatchObject({ wearing: 'a grey cloak', where: 'upstairs' })
    expect(f.asked[4]).toContain('wearing: a grey cloak')
    expect(seen(here?.characters[0])).toMatchObject({ wearing: 'a grey cloak', where: 'upstairs', posture: 'sitting on the bed' })
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
    expect(seen(end?.characters[0])).toMatchObject({ wearing: 'a red cloak', posture: 'sitting by the fire', mood: 'tired' })
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

  it('asks for every piece of clothing and how it sits, the things in the place, and the whole pose', () => {
    const [system] = stateMessages(null, 'Words.', ['Mara'])
    expect(system.content).toContain(
      'one entry for each piece of clothing the scene shows them wearing, putting on, taking off or changing'
    )
    expect(system.content).toContain('boots taken off is one entry, and the coat carries on from before')
    expect(system.content).toContain('"things": [{"thing": "", "state": "", "quote": ""}]')
    expect(system.content).toContain('When someone picks it up or carries it off, its state is "gone"')
    expect(system.content).toContain('touching: who they are touching and how, only when the words say so')
    expect(system.content).toContain('Never work it out from where people are')
    expect(system.content).toContain('what their hands, arms and legs are doing')
    expect(system.content).toContain('Never guess')
    // Something put down or taken off: the words of the act.
    expect(system.content).toContain('say "nothing" (or what they still hold), and quote the words where they put it down')
  })

  it('a new time starts fresh: the time, light and weather carry into the next scene only with the same When', async () => {
    // The trap run (Adam, 2026-10-07): "morning, the sun has come up" from a Day 23 scene carried through the next,
    // "Day 23, night, rain", and the writer had a man say "Morning".
    const w = world()
    const when = (id: ID, v: string): void => void repo.updateSceneCard(w.db, id, { ...repo.getScene(w.db, id).card, when: v })
    when(w.one, 'Day 23')
    when(w.two, 'Day 23, night, rain')
    write(w.db, w.one, 'The sun came up over the coast road. Mara rode on.')
    write(w.db, w.two, 'Mara sat by the fire at the inn. Later she slept.')
    const f = answering({ time: 'morning', light: 'sunrise', weather: 'dry', characters: [mara({ where: 'on the coast road' })] }, { characters: [mara({ posture: 'sitting by the fire' })] })
    const here = await stateAtText(opts(w.db, f), w.two, 'Mara sat by the fire at the inn.')
    expect(f.asked).toHaveLength(2)
    // Not told to the memory model as how the scene starts, nor kept for it; the people carry on.
    expect(f.asked[1]).not.toContain('morning')
    expect(here).toMatchObject({ time: '', light: '', weather: '' })
    expect(here?.characters[0]).toMatchObject({ where: 'on the coast road', posture: 'sitting by the fire' })
    expect(here?.said?.['|time']).toBeUndefined()
    expect(keptStateBefore(w.db, w.two)).toMatchObject({ time: '', light: '', weather: '' })
    // The scene before keeps its own.
    expect(storedState(w.db, w.one)?.state).toMatchObject({ time: 'morning', light: 'sunrise', weather: 'dry' })
    // The same When on both cards: they carry on, and the scene so far is read again from that start.
    when(w.two, 'Day 23')
    expect(keptStateBefore(w.db, w.two)).toMatchObject({ time: 'morning', light: 'sunrise', weather: 'dry' })
    expect(storedStateAt(w.db, w.two, 'Mara sat by the fire at the inn.')).toBeNull()
    const again = await stateAtText(opts(w.db, f), w.two, 'Mara sat by the fire at the inn.')
    expect(f.asked).toHaveLength(3)
    expect(f.asked[2]).toContain('Time: morning')
    expect(again?.time).toBe('morning')
    // A scene with no When after one with a time: unknown how long has passed, so it starts fresh too.
    when(w.two, '')
    expect(keptStateBefore(w.db, w.two)?.time).toBe('')
  })

  // ---------- Piece by piece (step 2b, Adam 2026-10-07) ----------

  it('changes one piece of clothing at a time, each with its own words: boots off never touches the coat', () => {
    const words = 'Mara came in out of the rain. She kicked off her boots by the hearth and hung her hat on the peg.'
    const read = readChanges(
      JSON.stringify({
        characters: [
          {
            name: 'Mara',
            clothes: [
              { item: 'boots', state: 'off, by the hearth', quote: 'kicked off her boots by the hearth' },
              // Words the scene doesn't have: left out. Taken off with no words: kept, as an empty hand is.
              { item: 'scarf', state: 'on, wound twice', quote: 'her scarf wound twice' },
              { item: 'hat', state: 'off, on the peg', quote: '' }
            ]
          }
        ]
      }),
      words,
      'inn'
    )!
    expect(read.characters?.[0].clothes).toEqual([
      { name: 'boots', state: 'off, by the hearth' },
      { name: 'hat', state: 'off, on the peg' }
    ])
    expect(read.said[pieceKey('Mara', 'boots')]).toEqual({ quote: 'kicked off her boots by the hearth', sceneId: 'inn' })
    expect(read.said[pieceKey('Mara', 'hat')]).toBeUndefined()
    const before: SceneState = {
      time: '',
      weather: '',
      light: '',
      characters: [
        person('Mara', {
          clothes: [
            { name: 'grey coat', state: 'on, buttoned to the throat' },
            { name: 'boots', state: 'on' },
            { name: 'hat', state: 'on' }
          ]
        })
      ],
      said: {
        [pieceKey('Mara', 'grey coat')]: { quote: 'buttoned her grey coat', sceneId: 'road' },
        [pieceKey('Mara', 'hat')]: { quote: 'jammed her hat on', sceneId: 'road' }
      }
    }
    const after = mergeState(before, read)
    expect(after.characters[0].clothes).toEqual([
      { name: 'grey coat', state: 'on, buttoned to the throat' },
      { name: 'boots', state: 'off, by the hearth' },
      { name: 'hat', state: 'off, on the peg' }
    ])
    // The coat keeps its own words; the boots have theirs; the hat's old words go with the old value.
    expect(after.said?.[pieceKey('Mara', 'grey coat')]).toEqual({ quote: 'buttoned her grey coat', sceneId: 'road' })
    expect(after.said?.[pieceKey('Mara', 'boots')]?.quote).toBe('kicked off her boots by the hearth')
    expect(after.said?.[pieceKey('Mara', 'hat')]).toBeUndefined()
    expect(stateText(after)).toBe(
      '- Mara\n  - wearing: grey coat on, buttoned to the throat\n  - wearing: boots off, by the hearth\n  - wearing: hat off, on the peg'
    )
    // Given away: off the list, and its words with it.
    const gone = mergeState(after, { characters: [person('Mara', { clothes: [{ name: 'hat', state: 'gone' }] })] })
    expect(gone.characters[0].clothes!.map((p) => p.name)).toEqual(['grey coat', 'boots'])
  })

  it('keeps the things in the place: a door barred then opened from outside, a case put down then picked up', () => {
    const one = 'Ash dropped the bar across the door. Wren set the case on the windowsill and sat down.'
    const first = readChanges(
      JSON.stringify({
        things: [
          { thing: 'the door', state: 'shut and barred from inside', quote: 'dropped the bar across the door' },
          { thing: 'the survey case', state: 'on the windowsill', quote: 'set the case on the windowsill' },
          // Not in the words: left out.
          { thing: 'the lamp', state: 'lit', quote: 'the lamp glowed' }
        ],
        characters: [{ name: 'Wren', holding: { value: 'nothing', quote: '' } }]
      }),
      one,
      'inn'
    )!
    const before: SceneState = { time: '', weather: '', light: '', characters: [person('Wren', { holding: 'the survey case' })] }
    const barred = mergeState(before, first)
    expect(barred.things).toEqual([
      { name: 'the door', state: 'shut and barred from inside' },
      { name: 'the survey case', state: 'on the windowsill' }
    ])
    expect(barred.characters[0].holding).toBe('nothing')
    expect(barred.said?.[thingKey('the door')]).toEqual({ quote: 'dropped the bar across the door', sceneId: 'inn' })
    expect(stateText(barred)).toContain('Things here:\n- the door: shut and barred from inside\n- the survey case: on the windowsill')
    const two = 'Someone lifted the bar from outside, and the door swung open. Wren snatched up the case.'
    const second = readChanges(
      JSON.stringify({
        things: [
          { thing: 'the door', state: 'unbarred and open', quote: 'the door swung open' },
          // Picked up: gone from the place (now held), words or none.
          { thing: 'the case', state: 'gone', quote: '' }
        ],
        characters: [{ name: 'Wren', holding: { value: 'the survey case', quote: 'Wren snatched up the case' } }]
      }),
      two,
      'inn'
    )!
    const open = mergeState(barred, second)
    expect(open.things).toEqual([{ name: 'the door', state: 'unbarred and open' }])
    expect(open.characters[0].holding).toBe('the survey case')
    expect(open.said?.[thingKey('the door')]?.quote).toBe('the door swung open')
    expect(open.said?.[thingKey('the survey case')]).toBeUndefined()
  })

  it('says who touches whom and who can see or hear whom only when the words say so', () => {
    const words = 'Tobin took her hand. From the stairs, Ash watched them.'
    const read = readChanges(
      JSON.stringify({
        characters: [
          {
            name: 'Mara',
            touching: { value: "holding Tobin's hand", quote: 'Tobin took her hand' },
            sees: { value: 'can see Ash on the stairs', quote: '' }
          },
          { name: 'Ash', sees: { value: 'watching Mara and Tobin from the stairs', quote: 'From the stairs, Ash watched them' } }
        ]
      }),
      words,
      'inn'
    )!
    expect(read.characters?.map((c) => [c.name, c.touching, c.sees])).toEqual([
      ['Mara', "holding Tobin's hand", ''],
      ['Ash', '', 'watching Mara and Tobin from the stairs']
    ])
    const text = stateText(mergeState(null, read))
    expect(text).toContain("- Mara: touching: holding Tobin's hand")
    expect(text).toContain('- Ash: sees or hears: watching Mara and Tobin from the stairs')
  })

  it('keeps at most so many pieces a person and things in the place, letting go of those changed longest ago', () => {
    const many = (n: number, what: string) => Array.from({ length: n }, (_, i) => ({ name: `${what} ${i + 1}`, state: 'on' }))
    const after = mergeState(null, {
      things: many(MOST_THINGS + 2, 'stone'),
      characters: [person('Mara', { clothes: many(MOST_CLOTHES + 3, 'ring') })]
    })
    expect(after.things).toHaveLength(MOST_THINGS)
    expect(after.characters[0].clothes).toHaveLength(MOST_CLOTHES)
    expect(after.characters[0].clothes!.at(-1)!.name).toBe(`ring ${MOST_CLOTHES + 3}`)
  })

  it('reads a state kept before step 2b, all that was worn in one line, as pieces with nothing lost, and it still stands', async () => {
    const w = world()
    const words = 'Mara hung her cloak over the chair and kicked her boots off by the door.'
    write(w.db, w.one, words)
    write(w.db, w.two, 'Mara sat by the fire.')
    // As a version before step 2b kept them: one line of what she wore, and Adam's own line in place of it.
    const old = {
      time: '',
      weather: '',
      light: '',
      characters: [
        {
          name: 'Mara',
          where: 'her room',
          wearing: 'a wet shirt, cloak over the chair',
          posture: '',
          holding: '',
          condition: '',
          mood: '',
          lastAction: ''
        }
      ],
      said: { 'mara|wearing': { quote: 'hung her cloak over the chair', sceneId: w.one } }
    }
    const edits = { characters: { mara: { wearing: 'a wet shirt, cloak over the chair, boots off (by the door)' } } }
    // As that version laid Adam's line over it (and with it, the words of the line it replaced gone).
    const oldEnd = { ...old, characters: [{ ...old.characters[0], wearing: edits.characters.mara.wearing }], said: {} }
    const twoState = { time: '', weather: '', light: '', characters: [{ ...oldEnd.characters[0], posture: 'sitting by the fire' }] }
    repo.setMeta(
      w.db,
      'continuity',
      JSON.stringify({
        [w.one]: { hash: hashOf(words), base: '', state: old, edits },
        [w.two]: { hash: hashOf('Mara sat by the fire.'), base: hashOf(JSON.stringify(oldEnd)), state: twoState }
      })
    )
    // It still stands: nothing is read again.
    expect(storedState(w.db, w.two)?.current).toBe(true)
    const end = storedState(w.db, w.one)!.state
    expect(clothesOf(end.characters[0])).toEqual([
      { name: 'a wet shirt', state: '' },
      { name: 'cloak over the chair', state: '' },
      { name: 'boots', state: 'off (by the door)' }
    ])
    expect(stateText(end)).toBe(
      '- Mara: where: her room\n  - wearing: a wet shirt\n  - wearing: cloak over the chair\n  - wearing: boots off (by the door)'
    )
    // A change to one piece finds it by its own word; the line's words stay with the rest.
    const later = mergeState(end, { characters: [person('Mara', { clothes: [{ name: 'boots', state: 'on, laced' }] })], said: {} })
    expect(clothesOf(later.characters[0]).map(pieceText)).toEqual(['a wet shirt', 'cloak over the chair', 'boots on, laced'])
    expect(later.characters[0].wearing).toBeUndefined()
    expect(later.said?.['mara|wearing']).toBeUndefined()
    // The old line's words were Adam's own: none are kept with them.
    expect(later.said?.[pieceKey('Mara', 'a wet shirt')]).toBeUndefined()
    // Read before Adam's line, its words go with each piece.
    const fromWords = mergeState(old as SceneState, { characters: [person('Mara', { posture: 'standing' })], said: {} })
    expect(fromWords.said?.[pieceKey('Mara', 'cloak over the chair')]).toEqual({ quote: 'hung her cloak over the chair', sceneId: w.one })
    // Adam puts one piece right in Recall: only that piece is his.
    editState(w.db, w.one, (e) => {
      e.characters = { ...e.characters, mara: { ...e.characters?.mara, clothes: { [itemKey('boots')]: { name: 'boots', state: 'on' } } } }
      e.things = { [itemKey('the door')]: { name: 'the door', state: 'locked' } }
    })
    const mine = storedState(w.db, w.one)!.state
    expect(clothesOf(mine.characters[0]).map(pieceText)).toEqual(['a wet shirt', 'cloak over the chair', 'boots on'])
    expect(mine.things).toEqual([{ name: 'the door', state: 'locked' }])
    // Taken out by Adam: gone.
    editState(w.db, w.one, (e) => {
      e.characters!.mara.clothes![itemKey('cloak over the chair')] = null
      e.things![itemKey('the door')] = null
    })
    expect(clothesOf(storedState(w.db, w.one)!.state.characters[0]).map(pieceText)).toEqual(['a wet shirt', 'boots on'])
    expect(storedState(w.db, w.one)!.state.things).toEqual([])
  })

  it('a new scene starts without who touched whom, and with the things in the place only in the same place', async () => {
    const w = world()
    const inn = repo.createEntry(w.db, 'place', { name: 'The Gull' }).id
    const yard = repo.createEntry(w.db, 'place', { name: 'The yard' }).id
    const place = (id: ID, at: ID): void => void repo.updateSceneCard(w.db, id, { ...repo.getScene(w.db, id).card, locationId: at })
    place(w.one, inn)
    place(w.two, inn)
    write(w.db, w.one, 'Ash barred the door. Tobin took her hand.')
    write(w.db, w.two, 'Mara sat by the fire.')
    const f = replying(
      {
        things: [{ thing: 'the door', state: 'barred', quote: 'Ash barred the door' }],
        characters: [{ name: 'Mara', touching: { value: "holding Tobin's hand", quote: 'Tobin took her hand' } }]
      },
      { characters: [{ name: 'Mara', posture: { value: 'sitting by the fire', quote: 'Mara sat by the fire' } }] }
    )
    const here = await stateAtText(opts(w.db, f), w.two, 'Mara sat by the fire.')
    // The scene after, in the same place: the door is still barred; her hand in his was that moment's.
    expect(f.asked[1]).toContain('- the door: barred')
    expect(f.asked[1]).not.toContain('touching')
    expect(here?.things).toEqual([{ name: 'the door', state: 'barred' }])
    expect(here?.characters[0]).toMatchObject({ touching: '', posture: 'sitting by the fire' })
    expect(storedState(w.db, w.one)?.state.characters[0].touching).toBe("holding Tobin's hand")
    // Somewhere else: none of the things there.
    place(w.two, yard)
    expect(keptStateBefore(w.db, w.two)?.things).toEqual([])
    // No place on a card: not known to be the same place.
    place(w.two, '')
    expect(keptStateBefore(w.db, w.two)?.things).toEqual([])
  })
})
