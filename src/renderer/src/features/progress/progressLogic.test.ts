import { describe, expect, it } from 'vitest'
import type { ChapterWriterProgress } from '@shared/contracts/chapterWriter'
import type { ModelChoice } from '@shared/types'
import { jobModelName, modelForJob } from '@shared/modelJobs'
import {
  chapterEndWords,
  chapterNames,
  chapterView,
  elapsedWords,
  leftWords,
  sceneEndWords,
  sceneView,
  secondsLeft,
  shortWordsOf,
  spentWords,
  wordsOf,
  type SceneInput
} from './progressLogic'

const m = (label: string): ModelChoice => ({ providerId: 'p', modelId: label.toLowerCase(), label, contextLength: null, promptPrice: null, completionPrice: null })
const FLASH = m('DeepSeek: DeepSeek V4 Flash')
const SONNET = m('Anthropic: Claude Sonnet 4.6')

describe('the words', () => {
  it('says words, time and cost plainly', () => {
    expect(wordsOf(640, 1500)).toBe('640 of about 1,500 words')
    expect(wordsOf(1, null)).toBe('1 word')
    expect(shortWordsOf(1240, 1500)).toBe('1,240 of ~1,500 words')
    expect(shortWordsOf(1240, null)).toBe('1,240 words')
    expect(elapsedWords(40_000)).toBe('40 s so far')
    expect(elapsedWords(250_000)).toBe('4 min 10 s so far')
    expect(elapsedWords(3_900_000)).toBe('1 h 5 min so far')
    expect(leftWords(null)).toBe('')
    expect(leftWords(20)).toBe('less than a minute left')
    expect(leftWords(70)).toBe('about a minute left')
    expect(leftWords(250)).toBe('about 4 minutes left')
    expect(leftWords(80 * 60)).toBe('about 1 hour 20 minutes left')
    expect(spentWords(0)).toBe('')
    expect(spentWords(0.004)).toBe('less than a cent so far')
    expect(spentWords(0.4249)).toBe('$0.42 so far')
  })

  it('estimates what is left only once there is enough to go on, else from the estimate while it has time to run', () => {
    // Too early, and no estimate: nothing.
    expect(secondsLeft({ elapsedMs: 5_000, fraction: 0.5 })).toBeNull()
    expect(secondsLeft({ elapsedMs: 60_000, fraction: 0.02 })).toBeNull()
    // Half done in a minute: about a minute more.
    expect(secondsLeft({ elapsedMs: 60_000, fraction: 0.5 })).toBe(60)
    // Early on, the estimate (6 minutes) less the time taken.
    expect(secondsLeft({ elapsedMs: 60_000, fraction: 0.02, estimateS: 360 })).toBe(300)
    // An estimate already run past is no help.
    expect(secondsLeft({ elapsedMs: 400_000, fraction: 0.02, estimateS: 360 })).toBeNull()
  })
})

describe('the models', () => {
  it('names each job’s model as Settings shows it, by what it is “Same as”', () => {
    const models = { writer: FLASH, memory: null, check: SONNET }
    expect(jobModelName(models, 'writer')).toBe('DeepSeek V4 Flash')
    expect(jobModelName(models, 'memory')).toBe('DeepSeek V4 Flash')
    expect(jobModelName(models, 'check')).toBe('Claude Sonnet 4.6')
    expect(jobModelName(models, 'chapter')).toBe('DeepSeek V4 Flash')
    expect(modelForJob(null, 'writer')).toBeNull()
    expect(jobModelName({}, 'writer')).toBe('')
  })
})

const NOW = 1_000_000_000
const base = (o: Partial<ChapterWriterProgress> = {}): ChapterWriterProgress => ({
  runId: 'r',
  chapterId: 'c3',
  stage: 'drafting',
  sceneId: 's2',
  note: 'Writing Sc 2 “The ferry” (2 of 4)',
  round: 0,
  cost: 0.04,
  sceneIds: ['s1', 's2', 's3', 's4'],
  doing: 'draft',
  startedMs: NOW - 300_000,
  writingMs: NOW - 120_000,
  waitedMs: 60_000,
  scenes: [
    { sceneId: 's1', label: 'Sc 1 “Morning Confrontation”', state: 'written', words: 1500, target: 1500 },
    { sceneId: 's2', label: 'Sc 2 “The ferry”', state: 'writing', words: 640, target: 1500 },
    { sceneId: 's3', label: 'Sc 3 “The inn”', state: 'waiting', words: 0, target: 1500 },
    { sceneId: 's4', label: 'Sc 4 “Night”', state: 'waiting', words: 0, target: 1500 }
  ],
  ...o
})
const CH = { short: 'Ch 3', name: 'The Far Bank' }

describe('a chapter being written', () => {
  it('names the chapter from where it is in the story, and leaves out a name that is only its number', () => {
    const chapters = [
      { id: 'c1', title: 'Chapter 1' },
      { id: 'c2', title: '' },
      { id: 'c3', title: 'The Far Bank' }
    ]
    expect(chapterNames(chapters, 'c1')).toEqual({ short: 'Ch 1', name: '' })
    expect(chapterNames(chapters, 'c2')).toEqual({ short: 'Ch 2', name: '' })
    expect(chapterNames(chapters, 'c3')).toEqual({ short: 'Ch 3', name: 'The Far Bank' })
    expect(chapterNames(null, 'c3')).toEqual({ short: 'the chapter', name: '' })
  })

  it('says in the pill where it has got, never cutting the numbers, and in the card each scene, the step and the model', () => {
    const v = chapterView({ progress: base(), chapter: CH, now: NOW, models: { writer: FLASH, check: SONNET } })
    expect(v.lead).toBe('Writing Ch 3')
    expect(v.tail).toBe('scene 2 of 4 · 2,140 words')
    expect(v.title).toBe('Ch 3 · The Far Bank')
    expect(v.hover).toBe('Ch 3 · The Far Bank: Writing Sc 2 “The ferry” (scene 2 of 4). Model: DeepSeek V4 Flash. Click to see how it is going, or stop it.')
    expect(v.steps.map((s) => `${s.label}:${s.state}:${s.model}`)).toEqual([
      'The plan:done:DeepSeek V4 Flash',
      'Writing:now:DeepSeek V4 Flash',
      'Checking and fixing:next:Claude Sonnet 4.6'
    ])
    // Two models: each step says its own, so there is no one model line.
    expect(v.oneModel).toBe('')
    expect(v.scenes.map((s) => `${s.state}: ${s.words}`)).toEqual(['written: 1,500 words', 'writing: 640 of about 1,500 words', 'waiting: waiting', 'waiting: waiting'])
    expect(v.doing).toBe('Writing Sc 2 “The ferry” (scene 2 of 4)')
    expect(v.doingModel).toBe('DeepSeek V4 Flash')
    expect(v.barLabel).toBe('2,140 of about 6,000 words · 1 of 4 scenes written')
    // The time Adam took over the plan isn't the run's.
    expect(v.elapsed).toBe('4 min 0 s so far')
    expect(v.left).toMatch(/^about \d+ minutes left$/)
    expect(v.cost).toBe('$0.04 so far')
    expect(v.fraction).toBeGreaterThan(0.2)
    expect(v.fraction).toBeLessThan(0.75)
    expect(v.sceneId).toBe('s2')
  })

  it('says each thing a run does in plain words', () => {
    const say = (o: Partial<ChapterWriterProgress>, extra: Partial<Parameters<typeof chapterView>[0]> = {}) =>
      chapterView({ progress: base(o), chapter: CH, now: NOW, models: { writer: FLASH }, ...extra })
    expect(say({ stage: 'planning', doing: 'plan', writingMs: null }).doing).toBe('Planning the chapter: reading the cards and looking up what the story’s memory says')
    expect(say({ stage: 'planning', doing: 'plan', writingMs: null }).lead).toBe('Planning Ch 3')
    expect(say({ stage: 'planning', doing: 'plan', writingMs: null }).left).toBe('')
    expect(say({ doing: 'memory' }).doing).toBe('Waiting for the story’s memory to catch up before writing Sc 2 “The ferry”')
    // Before its first words, the step its draft is on.
    const fresh = base().scenes!.map((s) => (s.sceneId === 's2' ? { ...s, words: 0 } : s))
    expect(say({ scenes: fresh }, { step: { step: 'lookups', about: ['state_of', 'who_knows'] } }).doing).toBe('Looking up where everyone is and who knows what for Sc 2 “The ferry”')
    expect(say({ scenes: fresh }, { step: { step: 'plan' } }).doing).toBe('Planning the scene for Sc 2 “The ferry”')
    expect(say({ stage: 'checking', doing: 'check', round: 1 }).doing).toBe('Checking Sc 2 “The ferry” against the plan and the story so far')
    expect(say({ stage: 'checking', doing: 'check', round: 1 }).lead).toBe('Checking Ch 3')
    expect(say({ stage: 'checking', doing: 'check', round: 1 }).tail).toBe('round 1')
    expect(say({ stage: 'checking', doing: 'critic', sceneId: null, round: 1 }).doing).toBe('The critic is reading the chapter')
    const fixing = say({ stage: 'fixing', doing: 'fix', round: 1, fixAt: { at: 2, of: 5 }, note: 'Fixing Sc 2 “The ferry”: The middle slows' })
    expect(fixing.doing).toBe('Fixing problem 2 of 5, in Sc 2 “The ferry”')
    expect(fixing.detail).toBe('The middle slows')
    expect(fixing.lead).toBe('Fixing Ch 3')
    expect(fixing.tail).toBe('2 of 5')
    expect(fixing.steps.map((s) => s.state)).toEqual(['done', 'done', 'now'])
    const retry = say({ retrying: 'OpenRouter is busy' })
    expect(retry.doing).toBe('Trying again: OpenRouter is busy')
    expect(retry.tail).toBe('trying again')
    expect(retry.retrying).toBe(true)
  })

  it('reads a run from before the card (no scenes or times) without showing anything it doesn’t know', () => {
    const v = chapterView({
      progress: { runId: 'r', chapterId: 'c', stage: 'drafting', sceneId: null, note: '', round: 0, cost: 0, sceneIds: [] },
      chapter: { short: 'Ch 1', name: '' },
      now: NOW,
      models: { writer: FLASH }
    })
    expect(v.lead).toBe('Writing Ch 1')
    expect(v.tail).toBe('')
    expect(v.elapsed).toBe('')
    expect(v.left).toBe('')
    expect(v.cost).toBe('')
    expect(v.oneModel).toBe('DeepSeek V4 Flash')
  })

  it('says how a run ended and what was kept', () => {
    expect(chapterEndWords({ status: 'done', message: '', rounds: 2, left: [] })).toEqual({ text: 'Written and checked: 2 rounds of checks, clean at the end.', tone: 'done' })
    expect(chapterEndWords({ status: 'stopped', message: '', rounds: 0, left: [] }).text).toBe('Stopped. The words written so far are kept; Undo puts the chapter back as it was.')
    expect(chapterEndWords({ status: 'error', message: 'Fake is down.', rounds: 0, left: [] })).toEqual({ text: 'Fake is down.', tone: 'problem' })
  })
})

describe('a scene being drafted', () => {
  const input = (o: Partial<SceneInput> = {}): SceneInput => ({
    sceneId: 's',
    sceneTitle: 'Morning Confrontation',
    now: NOW,
    phase: 'streaming',
    words: 640,
    target: 1500,
    startedAt: NOW - 60_000,
    firstWordAt: NOW - 40_000,
    checking: false,
    retrying: null,
    step: null,
    review: false,
    planFirst: true,
    checkNewWords: true,
    model: 'DeepSeek V4 Flash',
    memoryModel: 'Claude Haiku 4.5',
    ...o
  })

  it('says in the pill the words against the length it aims for, with the full title on the hover', () => {
    const v = sceneView(input())
    expect(v.lead).toBe('Writing “Morning Confrontation”')
    expect(v.tail).toBe('640 of ~1,500 words')
    expect(v.hover).toBe('“Morning Confrontation”: Writing the scene. Model: DeepSeek V4 Flash. Click to see how it is going, or stop it.')
    expect(v.steps.map((s) => `${s.label}:${s.state}:${s.model}`)).toEqual([
      'The memory:done:Claude Haiku 4.5',
      'The plan:done:Claude Haiku 4.5',
      'Writing:now:DeepSeek V4 Flash',
      'Checking:next:Claude Haiku 4.5'
    ])
    expect(v.barLabel).toBe('640 of about 1,500 words')
    expect(v.elapsed).toBe('1 min 0 s so far')
    // 640 words in 40 s: 860 more at 16 a second, about 54 s.
    expect(v.left).toBe('about a minute left')
    expect(v.cost).toBe('')
  })

  it('leaves out Checking when the new words are not checked, and never says it is checking them', () => {
    expect(sceneView(input({ checkNewWords: false })).steps.map((s) => s.label)).toEqual(['The memory', 'The plan', 'Writing'])
    // The draft has ended and the check said at once it won't run: still the last step, never "Checking".
    const ended = sceneView(input({ checkNewWords: false, phase: 'idle', checking: true }))
    expect(ended.lead).toBe('Writing “Morning Confrontation”')
    expect(ended.steps.at(-1)).toMatchObject({ label: 'Writing', state: 'now' })
  })

  it('leaves out the plan when Plan before writing is off, and names each step before the first words', () => {
    expect(sceneView(input({ planFirst: false })).steps.map((s) => s.label)).toEqual(['The memory', 'Writing', 'Checking'])
    const memory = sceneView(input({ phase: 'starting', words: 0, firstWordAt: null, step: { step: 'memory' } }))
    expect(memory.doing).toBe('Waiting for the story’s memory to catch up')
    expect(memory.doingModel).toBe('Claude Haiku 4.5')
    expect(memory.tail).toBe('memory catching up')
    expect(memory.steps[0].state).toBe('now')
    expect(memory.left).toBe('')
    const looking = sceneView(input({ phase: 'starting', words: 0, firstWordAt: null, step: { step: 'lookups', about: ['state_of'] } }))
    expect(looking.doing).toBe('Looking up where everyone is')
    expect(looking.steps.map((s) => s.state)).toEqual(['done', 'now', 'next', 'next'])
    const review = sceneView(input({ phase: 'starting', words: 0, review: true }))
    expect(review.doing).toBe('The plan is ready for you to read')
    expect(sceneView(input({ retrying: 'OpenRouter is busy' })).doing).toBe('Trying again: OpenRouter is busy')
    expect(sceneView(input({ stretch: { at: 2, of: 5 } })).doing).toBe('Writing the scene (stretch 2 of 5)')
  })

  it('shows Auto’s words without a length, and the check after the draft', () => {
    const auto = sceneView(input({ target: null }))
    expect(auto.tail).toBe('640 words')
    expect(auto.left).toBe('')
    const checking = sceneView(input({ phase: 'idle', checking: true, words: 1480 }))
    expect(checking.lead).toBe('Checking “Morning Confrontation”')
    expect(checking.doing).toBe('Checking the new words against the story so far')
    expect(checking.steps.at(-1)?.state).toBe('now')
  })

  it('says how a draft ended and what was kept', () => {
    expect(sceneEndWords({ status: 'complete', words: 1480, error: null, cutOff: false })).toEqual({ text: 'Written: 1,480 words.', tone: 'done' })
    expect(sceneEndWords({ status: 'stopped', words: 640, error: null, cutOff: false }).text).toBe('Stopped. The 640 words written so far stay in the scene.')
    expect(sceneEndWords({ status: 'error', words: 0, error: 'Fake is down.', cutOff: false })).toEqual({
      text: 'Fake is down. Nothing was written, so the scene is as it was.',
      tone: 'problem'
    })
  })
})
