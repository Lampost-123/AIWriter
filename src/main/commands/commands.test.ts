// Under suggestion: reading a scene for commands (the request, the reply, keeping it), Adam's own changes, and the lines
// the writer is told. Made-up scenes; the memory model's reply is given by each test, so nothing makes a paid call.
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { testWorld, saveParas } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as store from '../db/commands'
import type { MemoryModel } from '../keeper/model'
import { addCommand, changeCommand, peopleAt, underSuggestion, undoStep } from '.'
import { castOf, commandsRequest, readCommandsReply, readSceneCommands, COMMANDS_SYSTEM } from './read'
import { commandLines, commandLinesFor } from './briefing'
import { gatherContextInput } from '../ai/gather'
import { buildBlocks } from '../ai/context'

type DB = Database.Database

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/memory', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
}

/** A fetch that answers the commands request with `reply` (as the model's JSON), and notes what it was asked. */
const answering = (reply: unknown, asked: string[] = []): typeof fetch =>
  (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] }
    asked.push(body.messages[1].content)
    const chunk = { choices: [{ index: 0, delta: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch

function world(): { db: DB; storyId: ID; scenes: ID[]; tam: ID; mara: ID } {
  const w = testWorld(3)
  const tam = repo.createEntry(w.db, 'character', { name: 'Tam Hollis' }).id
  const mara = repo.createEntry(w.db, 'character', { name: 'Mara Venn', aliases: ['the Mistress'] }).id
  store.setTracking(w.db, w.storyId, true)
  return { db: w.db, storyId: w.storyId, scenes: w.scenes, tam, mara }
}

const SOCKS = 'Mara leaned close. “You will never wear socks again,” she whispered, and Tam felt it settle like her own idea.'

describe('the request', () => {
  it('is short: the people, the commands as the scene begins, and the scene', () => {
    const w = world()
    addCommand(w.db, { storyId: w.storyId, sceneId: w.scenes[0], subjectId: w.tam, giverId: w.mara, values: { words: 'No socks', does: 'wears no socks', kind: 'clothing', off: ['socks'] } })
    const before = peopleAt(w.db, w.storyId, w.scenes[1], { asItBegins: true }).people
    const everyone = repo.listEntries(w.db).map((e) => ({ id: e.id, name: e.name, aliases: e.aliases }))
    const cast = castOf('Tam came down.', everyone, { card: [], under: before })
    const req = commandsRequest('Tam came down.', cast, before)
    const user = req.messages[1].content
    expect(user).toContain('E1 Tam Hollis')
    expect(user).toContain('E2 Mara Venn (also the Mistress)')
    expect(user).toContain('C1 E1 Tam Hollis <- E2 Mara Venn: "No socks" · does: wears no socks · in effect')
    expect(req.ids.commands.get('C1')).toBeTruthy()
    expect(COMMANDS_SYSTEM.length).toBeLessThan(2_200)
  })
})

describe('the reply', () => {
  const ids = { people: new Map([['E1', 'tam'], ['E2', 'mara']]), commands: new Map([['C1', 'c1']]) }

  it('keeps what it can use: a given with who and what, other steps with a listed command', () => {
    const steps = readCommandsReply(
      {
        steps: [
          { step: 'given', who: 'E1', by: 'E2', words: 'You will never wear socks again', does: 'wears no socks', kind: 'clothing', off: ['socks'], quote: 'You will never wear socks again', sure: true },
          { step: 'fired', c: 'C1', quote: 'She took them off' },
          { step: 'given', who: 'E9', words: 'Nobody' },
          { step: 'ended', c: 'C7' },
          { step: 'changed', c: 'C1' },
          { step: 'nonsense', c: 'C1' }
        ]
      },
      ids,
      SOCKS
    )
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ kind: 'given', subjectId: 'tam', giverId: 'mara', unsure: false, quote: 'You will never wear socks again' })
    expect(steps[0].values).toMatchObject({ kind: 'clothing', off: ['socks'] })
    // A quote not in the scene is a guess: kept as something the memory isn't sure of, without the quote.
    expect(steps[1]).toMatchObject({ kind: 'fired', commandId: 'c1', unsure: true, quote: '' })
  })

  it('reads nothing from a reply with no steps', () => {
    expect(readCommandsReply({ steps: [] }, ids, SOCKS)).toEqual([])
    expect(readCommandsReply(null, ids, SOCKS)).toEqual([])
  })
})

describe('reading a scene', () => {
  it('keeps the commands the scene gives, and the next scene starts from them', async () => {
    const w = world()
    saveParas(w.db, w.scenes[0], [['p1', SOCKS]], false)
    const asked: string[] = []
    const out = await readSceneCommands(w.db, w.scenes[0], model, {
      closed: () => false,
      fetchImpl: answering(
        { steps: [{ step: 'given', who: 'E2', by: 'E1', words: 'You will never wear socks again', does: 'wears no socks', kind: 'clothing', off: ['socks'], feels: 'like her own idea', quote: 'You will never wear socks again', sure: true }] },
        asked
      )
    })
    expect(out).toBe('read')
    const [tam] = peopleAt(w.db, w.storyId, w.scenes[1], { asItBegins: true }).people
    expect(tam.name).toBe('Tam Hollis')
    expect(tam.wearing).toBe('no socks')
    expect(tam.commands[0]).toMatchObject({ giverName: 'Mara Venn', status: 'in-effect' })
    // Unchanged: not read again.
    expect(await readSceneCommands(w.db, w.scenes[0], model, { closed: () => false, fetchImpl: answering({ steps: [] }, asked) })).toBe('unchanged')
    expect(asked).toHaveLength(1)
  })

  it('puts a new reading in place of the old one, but keeps what Adam answered', async () => {
    const w = world()
    saveParas(w.db, w.scenes[0], [['p1', SOCKS]], false)
    const given = { step: 'given', who: 'E2', by: 'E1', words: 'You will never wear socks again', does: 'wears no socks', kind: 'clothing', off: ['socks'], quote: 'You will never wear socks again' }
    await readSceneCommands(w.db, w.scenes[0], model, { closed: () => false, fetchImpl: answering({ steps: [given] }) })
    const [step] = store.stepsInScene(w.db, w.scenes[0])
    store.setAnswer(w.db, step.id, 'no')
    // The scene changes and is read again: the model says the same, and Adam's no stands.
    saveParas(w.db, w.scenes[0], [['p1', `${SOCKS} Then she left.`]], false)
    await readSceneCommands(w.db, w.scenes[0], model, { closed: () => false, fetchImpl: answering({ steps: [given] }) })
    expect(store.stepsInScene(w.db, w.scenes[0])).toHaveLength(1)
    expect(peopleAt(w.db, w.storyId, null).people).toEqual([])
  })

  it('does nothing for a story that is not tracked', async () => {
    const w = world()
    store.setTracking(w.db, w.storyId, false)
    saveParas(w.db, w.scenes[0], [['p1', SOCKS]], false)
    expect(await readSceneCommands(w.db, w.scenes[0], model, { closed: () => false, fetchImpl: answering({ steps: [] }) })).toBe('off')
  })

  it('gives up on a reply it cannot read, keeping nothing', async () => {
    const w = world()
    saveParas(w.db, w.scenes[0], [['p1', SOCKS]], false)
    expect(await readSceneCommands(w.db, w.scenes[0], model, { closed: () => false, fetchImpl: answering('not json at all') })).toBe('failed')
    expect(store.readHash(w.db, w.scenes[0])).toBeNull()
  })
})

describe('Adam’s own changes', () => {
  it('adds a command, changes it from a later scene, and undoes the change', () => {
    const w = world()
    const id = addCommand(w.db, { storyId: w.storyId, sceneId: w.scenes[0], subjectId: w.tam, giverId: w.mara, values: { words: 'Sleep at the bell', does: 'falls asleep', kind: 'action', trigger: 'hears the bell' } })
    const step = changeCommand(w.db, { commandId: id, sceneId: w.scenes[2], kind: 'changed', values: { trigger: 'hears the bell at night' }, note: 'From here the bell only works at night' })
    expect(underSuggestion(w.db, w.storyId, w.scenes[1]).triggers[0].trigger).toBe('hears the bell')
    expect(underSuggestion(w.db, w.storyId, w.scenes[2]).triggers[0].trigger).toBe('hears the bell at night')
    undoStep(w.db, step)
    expect(underSuggestion(w.db, w.storyId, null).triggers[0].trigger).toBe('hears the bell')
  })

  it('asks for what the command is', () => {
    const w = world()
    expect(() => addCommand(w.db, { storyId: w.storyId, sceneId: w.scenes[0], subjectId: w.tam, giverId: null, values: {} })).toThrow(/Say what the command is/)
  })
})

describe('what the writer is told', () => {
  it('says what holds, what they wear by command, and the triggers waiting, for the people in the scene', () => {
    const w = world()
    addCommand(w.db, { storyId: w.storyId, sceneId: w.scenes[0], subjectId: w.tam, giverId: w.mara, values: { words: 'No socks', does: 'wears no socks', kind: 'clothing', off: ['socks'], feels: 'like her own idea' } })
    addCommand(w.db, { storyId: w.storyId, sceneId: w.scenes[0], subjectId: w.tam, giverId: w.mara, values: { words: 'Be naked', does: 'wears nothing', kind: 'clothing', all: true } })
    addCommand(w.db, { storyId: w.storyId, sceneId: w.scenes[1], subjectId: w.tam, giverId: w.mara, values: { words: 'Banana', does: 'takes her shoes off', kind: 'clothing', off: ['shoes'], trigger: "she hears the word 'banana'", triggerBy: 'giver' } })
    const lines = commandLines(peopleAt(w.db, w.storyId, w.scenes[2], { asItBegins: true }).people, [w.tam])
    expect(lines).toEqual([
      'Tam Hollis: wears nothing ("Be naked", from Mara Venn, since Ch 1, Sc 1).',
      'Tam Hollis wears, by command: nothing; under that, still: no socks.',
      "Tam Hollis, waiting: when she hears the word 'banana', takes her shoes off (only Mara Venn can set it off; once, then it is used up; planted since Ch 1, Sc 2 by Mara Venn)."
    ])
    expect(commandLines(peopleAt(w.db, w.storyId, w.scenes[2]).people, [w.mara])).toEqual([])
  })

  it('goes into the briefing for a scene with them on its card, only while the story is tracked', () => {
    const w = world()
    addCommand(w.db, { storyId: w.storyId, sceneId: w.scenes[0], subjectId: w.tam, giverId: w.mara, values: { words: 'No socks', does: 'wears no socks', kind: 'clothing', off: ['socks'] } })
    const card = repo.getScene(w.db, w.scenes[1]).card
    repo.updateSceneCard(w.db, w.scenes[1], { ...card, povId: w.tam })
    const prefs = { language: 'en-GB' } as never
    const blocks = buildBlocks(gatherContextInput(w.db, w.scenes[1], undefined, { prefs, contextLength: 32000, creativity: 'balanced' }))
    const block = blocks.find((b) => b.id === 'commands')
    expect(block?.title).toBe('Under suggestion')
    expect(block?.text).toContain('- Tam Hollis: wears no socks ("No socks", from Mara Venn, since Ch 1, Sc 1).')
    store.setTracking(w.db, w.storyId, false)
    expect(commandLinesFor(w.db, w.scenes[1])).toEqual([])
  })
})
