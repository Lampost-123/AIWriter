import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RecipeMakerState } from '@shared/contracts/recipes'
import type { JobModel } from '../ai/jobModel'
import { fallbackName, RecipeMaker, type CallOutcome, type CallRequest } from './maker'
import { emptyParts } from './parse'
import { MARKER } from './prompts'
import type { RecipeSource } from './source'
import { RecipeFiles, type StoredRecipe } from './store'

// A made-up story, written for these tests: three chapters, with names the recipe must not keep.
const SOURCE: RecipeSource = {
  version: 1,
  title: 'The Ferry at Varn',
  chapters: [
    { title: 'One', scenes: [['Mara waited on the quay while the ferry came in.', 'She thought of Tobin, who had not come.']] },
    { title: 'Two', scenes: [['The crossing took all night, and the gulls followed them across the dark water.']] },
    { title: 'Three', scenes: [['In the morning, Tobin and Mara stood on the far shore and waved.']] }
  ]
}

const MODEL: JobModel = {
  job: 'recipe',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: null },
  choice: { providerId: 'p1', modelId: 'fake/recipe', label: 'Fake', contextLength: 16000, promptPrice: null, completionPrice: null },
  thinking: 'off'
}

const RECIPE = `Name: A crossing story

## Themes
- Waiting: it surfaces on the quay and is tested at night.

## Tone
Quiet

## Point of view
Close third person

## Tense
Past

## Writing style
Plain sentences.

## Sample passage
The bell rang twice before anyone moved.

## Shape
- Three chapters; the turn at 60%.

## Beats
Chapter 1: the lead waits.

## Cast roles
- The lead, Mara: waits for the friend.
- The friend: comes late.

## Pacing
Short chapters.

## Devices
- The crossing took all night, and the gulls followed them across the dark water.`

interface Fake {
  calls: CallRequest[]
  reply: (req: CallRequest, n: number) => CallOutcome | Promise<CallOutcome>
}

const ok = (text: string): CallOutcome => ({ status: 'complete', text, error: null, cutOff: false })
const stepOf = (req: CallRequest): string => req.system.slice(MARKER.length).trim().split(/\s/)[0]

function defaultReply(req: CallRequest): CallOutcome {
  const step = stepOf(req)
  if (step === 'chapter') return ok('Moves:\n- the lead waits\nStyle: plain.')
  if (step === 'combine') return ok(RECIPE)
  // fix: the cast without the name, the device in other words.
  return ok('## Cast roles\n- The lead: waits for the friend.\n- The friend: comes late.\n\n## Devices\n- A long night crossing, watched by birds.')
}

let dir: string
let files: RecipeFiles
let fake: Fake
let model: JobModel | { error: string }
let held: string | null
let states: RecipeMakerState[]
let maker: RecipeMaker

function newRecipe(id = '00000000-0000-4000-8000-000000000001'): string {
  const r: StoredRecipe = {
    version: 1,
    id,
    name: '',
    nameBy: 'ai',
    status: 'making',
    problem: null,
    words: 0,
    chapters: SOURCE.chapters.length,
    byHand: false,
    createdAt: '2026-10-03T10:00:00.000Z',
    updatedAt: '2026-10-03T10:00:00.000Z',
    parts: emptyParts(),
    edited: []
  }
  files.write(r)
  files.writeSource(id, SOURCE)
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-recipes-'))
  files = new RecipeFiles(join(dir, 'Recipes'))
  files.ensure()
  fake = { calls: [], reply: defaultReply }
  model = MODEL
  held = null
  states = []
  let n = 0
  maker = new RecipeMaker({
    files: () => files,
    model: () => model,
    held: () => held,
    call: async (req) => {
      fake.calls.push(req)
      return fake.reply(req, ++n)
    },
    emit: (s) => states.push(s),
    changed: () => undefined
  })
})

afterEach(() => {
  maker.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('making a recipe', () => {
  it('reads each chapter, writes the recipe, and keeps none of the story’s names or sentences', async () => {
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    const steps = fake.calls.map(stepOf)
    expect(steps).toEqual(['chapter', 'chapter', 'chapter', 'combine', 'fix'])
    // Each chapter is sent with what code counted about it.
    expect(fake.calls[1].user).toContain('This is chapter 2 of 3')
    expect(fake.calls[1].user).toContain('The crossing took all night')
    // The fix is told what to leave out.
    expect(fake.calls[4].user).toContain('Leave out these names: Mara.')
    const r = files.read(id)!
    expect(r.status).toBe('ready')
    expect(r.name).toBe('A crossing story')
    expect(r.parts.cast).toBe('- The lead: waits for the friend.\n- The friend: comes late.')
    expect(r.parts.devices).toBe('- A long night crossing, watched by birds.')
    expect(r.parts.pov).toBe('Close third person')
    expect(r.words).toBeGreaterThan(20)
    expect(JSON.stringify(r.parts)).not.toMatch(/Mara|Tobin|Varn/)
    // Its notes go once it is made; the story's text stays, to read again.
    expect(files.making(id)).toBeNull()
    expect(files.hasSource(id)).toBe(true)
    expect(states[states.length - 1].finished).toMatchObject({ recipeId: id, name: 'A crossing story', removed: 0 })
  })

  it('writes genre and content in the app’s own labels, leaving out what it doesn’t know', async () => {
    fake.reply = (req) =>
      stepOf(req) === 'combine' ? ok(`${RECIPE}

## Genre and content
genres: mystery, Western. romance: FADE TO BLACK. Violence: gory.`) : defaultReply(req)
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    expect(files.read(id)!.parts.feel).toBe('Genre: Mystery. Romance: Fade to black.')
  })

  it('takes out what still leaks when the fix doesn’t help, and never keeps a name that gives the story away', async () => {
    fake.reply = (req) => (stepOf(req) === 'fix' ? ok('Sorry, I can’t.') : stepOf(req) === 'combine' ? ok(RECIPE.replace('A crossing story', 'The Ferry at Varn, retold')) : defaultReply(req))
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    const r = files.read(id)!
    expect(r.parts.cast).toBe('- The friend: comes late.')
    expect(r.parts.devices).toBe('')
    expect(r.name).toBe(fallbackName(3))
    expect(states[states.length - 1].finished?.removed).toBe(2)
  })

  it('carries on after a restart from the chapters already read, and keeps Adam’s name and his parts', async () => {
    const id = newRecipe()
    files.writeMaking(id, { version: 1, queuedAt: '2026-10-03T10:00:00.000Z', notes: ['Moves:\n- read before', null, null], held: null })
    files.write({ ...files.read(id)!, name: 'My own name', nameBy: 'adam', parts: { ...emptyParts(), tone: 'Mine' }, edited: ['tone'] })
    maker.resume()
    await maker.whenIdle()
    expect(fake.calls.map(stepOf).slice(0, 2)).toEqual(['chapter', 'chapter'])
    expect(fake.calls[0].user).toContain('This is chapter 2 of 3')
    expect(fake.calls.find((c) => stepOf(c) === 'combine')!.user).toContain('- read before')
    const r = files.read(id)!
    expect(r.name).toBe('My own name')
    expect(r.parts.tone).toBe('Mine')
  })

  it('pauses with the reason when there is no model, and carries on by itself when the settings change', async () => {
    model = { error: 'Choose a writer model first, in Settings › Models.' }
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    expect(fake.calls).toHaveLength(0)
    expect(files.read(id)).toMatchObject({ status: 'paused', problem: 'Choose a writer model first, in Settings › Models.' })
    expect(maker.state().running).toMatchObject({ recipeId: id, status: 'paused' })
    model = MODEL
    maker.settingsChanged()
    await maker.whenIdle()
    expect(files.read(id)!.status).toBe('ready')
  })

  it('waits while the monthly spending limit holds AI calls', async () => {
    held = 'This month’s AI spending has reached your $20 limit.'
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    expect(fake.calls).toHaveLength(0)
    expect(files.read(id)!.problem).toContain('$20 limit')
  })

  it('asks once more after a failure, and pauses after two in a row until Try again', async () => {
    fake.reply = (req, n) => (n <= 2 ? { status: 'error', text: '', error: 'The provider is busy.', cutOff: false } : defaultReply(req))
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    expect(fake.calls).toHaveLength(2)
    expect(files.read(id)).toMatchObject({ status: 'paused', problem: 'The provider is busy.' })
    // Not by itself: this one waits for Adam.
    maker.settingsChanged()
    await maker.whenIdle()
    expect(fake.calls).toHaveLength(2)
    maker.carryOn(id)
    await maker.whenIdle()
    expect(files.read(id)!.status).toBe('ready')
  })

  it('stops when asked, keeping what was read, and makes recipes one at a time in order', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    fake.reply = async (req, n) => {
      if (n === 2) await gate
      return defaultReply(req)
    }
    const a = newRecipe('00000000-0000-4000-8000-00000000000a')
    const b = newRecipe('00000000-0000-4000-8000-00000000000b')
    maker.start(a)
    maker.start(b)
    await new Promise((r) => setTimeout(r, 10))
    expect(maker.state().running).toMatchObject({ recipeId: a, chapter: 2, waiting: 1 })
    const stopping = maker.stop(a)
    release()
    await stopping
    await maker.whenIdle()
    expect(files.read(a)).toMatchObject({ status: 'paused' })
    expect(files.making(a)!.notes[0]).not.toBeNull()
    expect(files.read(b)!.status).toBe('ready')
  })
})

describe('reading a finished recipe again', () => {
  it('goes back to how it was when stopped, and only a new recipe can’t', async () => {
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    const made = files.read(id)!
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    fake.reply = async (req) => {
      await gate
      return defaultReply(req)
    }
    maker.start(id)
    await new Promise((r) => setTimeout(r, 10))
    expect(files.read(id)!.status).toBe('making')
    const stopping = maker.stop(id)
    release()
    await stopping
    expect(maker.backToReady(id)).toBe(true)
    expect(files.making(id)).toBeNull()
    expect(files.read(id)).toMatchObject({ status: 'ready', problem: null, parts: made.parts, name: made.name })
    // A new recipe has nothing to go back to.
    const fresh = newRecipe('00000000-0000-4000-8000-0000000000ff')
    files.writeMaking(fresh, { version: 1, queuedAt: 'x', notes: [null, null, null], held: 'adam' })
    expect(maker.backToReady(fresh)).toBe(false)
  })
})

describe('when something goes wrong', () => {
  it('pauses a recipe left “being made” with no notes, rather than leaving it busy for ever', async () => {
    const id = newRecipe()
    expect(files.making(id)).toBeNull()
    maker.resume()
    await maker.whenIdle()
    expect(files.read(id)).toMatchObject({ status: 'paused' })
    expect(files.making(id)?.notes).toEqual([null, null, null])
    expect(fake.calls).toHaveLength(0)
  })

  it('pauses the recipe it was making when something unexpected breaks, saying so', async () => {
    fake.reply = () => {
      throw new Error('disk gone')
    }
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    expect(files.read(id)).toMatchObject({ status: 'paused', problem: 'Something went wrong while making this recipe. Try again.' })
  })

  it('asks again, without counting a failure, when a call is stopped by something else', async () => {
    fake.reply = (req, n) => (n === 1 ? { status: 'stopped', text: 'Moves:', error: null, cutOff: false } : n === 2 ? { status: 'error', text: '', error: 'Busy.', cutOff: false } : defaultReply(req))
    const id = newRecipe()
    maker.start(id)
    await maker.whenIdle()
    expect(files.read(id)!.status).toBe('ready')
  })
})

describe('the recipe library’s files', () => {
  it('removes a recipe with its Undo, and deletes it for good once that has gone', () => {
    const id = newRecipe()
    files.remove(id)
    expect(files.ids()).toEqual([])
    expect(files.restore(id)).toBe(true)
    expect(files.read(id)).not.toBeNull()
    files.remove(id)
    files.purgeRemoved(Date.now() + 60 * 60 * 1000)
    expect(files.restore(id)).toBe(false)
  })

  it('forgets the story’s text with an Undo', () => {
    const id = newRecipe()
    files.removeSource(id)
    expect(files.hasSource(id)).toBe(false)
    expect(files.restoreSource(id)).toBe(true)
    expect(files.source(id)?.title).toBe('The Ferry at Varn')
  })
})
