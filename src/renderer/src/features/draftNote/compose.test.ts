// One note per draft (the calm overhaul): everything a draft has to say in one line, with the buttons that matter most.
import { describe, expect, it } from 'vitest'
import type { ModelChoice } from '@shared/types'
import { anotherModel, composeDraftNote, modelName, type DraftNoteParts } from './compose'

const written: DraftNoteParts = { end: { kind: 'written' }, away: null }
const model = (providerId: string, modelId: string, label = modelId): ModelChoice => ({
  providerId,
  modelId,
  label,
  contextLength: null,
  promptPrice: null,
  completionPrice: null
})

describe('the note after a draft', () => {
  it('says nothing for a draft written here with nothing found: the page shows it', () => {
    expect(composeDraftNote(written)).toBeNull()
    expect(composeDraftNote({ ...written, questions: 0, mended: { count: 0, why: null } })).toBeNull()
  })

  it('gathers what check and repair did and found into one line', () => {
    const note = composeDraftNote({ ...written, mended: { count: 2, why: null }, questions: 1 })
    expect(note).toEqual({ message: 'Draft written · 2 small slips fixed in amber · 1 question in Issues', tone: 'neutral', buttons: ['undo', 'issues'] })
  })

  it('adds the phrases underlined and what the check after it found', () => {
    const note = composeDraftNote({ ...written, questions: 1, checkFound: 2, phrases: { phrase: 1, ai: 3 } })
    expect(note?.message).toBe('Draft written · 1 question in Issues · 2 more things to look at · 1 phrase to avoid and 3 common AI phrases underlined')
    expect(note?.buttons).toEqual(['issues', 'phrases'])
    expect(composeDraftNote({ ...written, checkFound: 1 })?.message).toBe('Draft written · 1 thing to look at in Issues')
    expect(composeDraftNote({ ...written, phrases: { phrase: 0, ai: 2 } })).toEqual({
      message: 'Draft written · 2 common AI phrases underlined',
      tone: 'neutral',
      buttons: ['phrases']
    })
  })

  it('names the scene of a draft written while Adam was elsewhere, with Show', () => {
    expect(composeDraftNote({ ...written, away: '“The Ferry”' })).toEqual({ message: 'Draft of “The Ferry” written', tone: 'neutral', buttons: ['scene'] })
    expect(composeDraftNote({ end: { kind: 'written', stopped: true }, away: '“The Ferry”' })?.message).toBe('Drafting “The Ferry” stopped · the text so far is kept')
    expect(composeDraftNote({ end: { kind: 'written', unpolished: true }, away: '“The Ferry”' })?.message).toBe(
      'Draft of “The Ferry” written · not polished, as you were in another scene when it finished'
    )
    // Show in Issues opens the scene too: no second Show.
    expect(composeDraftNote({ ...written, away: '“The Ferry”', questions: 1 })?.buttons).toEqual(['issues'])
  })

  it('says how it was briefed, and how to have the old text back', () => {
    const note = composeDraftNote({ ...written, startNote: 'Written without where things stood as the scene before ended', oldText: 'Ctrl+Z puts the scene’s old text back.' })
    expect(note?.message).toBe('Draft written. Written without where things stood as the scene before ended. Ctrl+Z puts the scene’s old text back.')
    // While it is still being written, only that.
    expect(composeDraftNote({ end: null, away: null, startNote: 'Written without where things stood.' })?.message).toBe('Written without where things stood.')
  })

  it('says a problem in full, in red, with the way to its fix', () => {
    const note = composeDraftNote({ end: { kind: 'error', message: 'Out of credit. Add some in Settings › Models.' }, away: null, fixes: ['settings'] })
    expect(note).toEqual({ message: 'Out of credit. Add some in Settings › Models.', tone: 'danger', buttons: ['settings'] })
    // With what else was found after it.
    expect(composeDraftNote({ end: { kind: 'error', message: 'The connection dropped.' }, away: null, fixes: ['continue', 'record'], questions: 1 })?.message).toBe(
      'The connection dropped. 1 question in Issues'
    )
    const cut = composeDraftNote({ end: { kind: 'cutOff' }, away: null, fixes: ['continue', 'record'] })
    expect(cut?.message).toMatch(/^The model ran out of room before the end of the scene/)
    expect(cut?.buttons).toEqual(['continue', 'record'])
  })

  it('offers another of Adam’s models after a refusal, in one click', () => {
    const note = composeDraftNote({ end: { kind: 'refused', message: 'This model turned the request down. Try another model.' }, away: null, retryWith: 'Fake writer' })
    expect(note).toEqual({ message: 'This model turned the request down. Try another model.', tone: 'danger', buttons: ['retry', 'settings'] })
    // With no other model: Settings.
    expect(composeDraftNote({ end: { kind: 'refused', message: null }, away: null, retryWith: null })).toEqual({
      message: 'The writer model turned this scene down.',
      tone: 'danger',
      buttons: ['settings', 'record']
    })
  })
})

describe('another of Adam’s models', () => {
  it('offers the first model he set up that isn’t the one that refused, nor one tried already', () => {
    const models = { writer: model('p', 'w'), chat: model('p', 'c'), memory: model('p', 'm') }
    expect(anotherModel(models, [models.writer])?.modelId).toBe('c')
    expect(anotherModel(models, [models.writer, models.chat])?.modelId).toBe('m')
    // The same model chosen for two jobs counts once.
    expect(anotherModel({ writer: model('p', 'w'), chat: model('p', 'w') }, [model('p', 'w')])).toBeNull()
    // For the memory: the writer first.
    expect(anotherModel(models, [models.memory])?.modelId).toBe('w')
    expect(anotherModel(null, [])).toBeNull()
  })

  it('names a model as Settings › Models shows it, shortly', () => {
    expect(modelName(model('or', 'anthropic/claude-sonnet-4.6', 'Anthropic: Claude Sonnet 4.6'))).toBe('Claude Sonnet 4.6')
    expect(modelName(model('f', 'fake/refuse', ''))).toBe('fake/refuse')
  })
})
