import { describe, expect, it } from 'vitest'
import type { StoryFillDone, StoryFillEstimate } from '@shared/contracts/storyIndex'
import { fillCostWords, fillDoneWords, fillIntro, fillProgress, fillSoFarWords, fillStarted } from './storyFill'

const est = (e: Partial<StoryFillEstimate>): StoryFillEstimate => ({
  storyId: 'b1',
  total: 60,
  scenes: 42,
  words: 63_200,
  tokens: 150_000,
  cost: 0.12,
  free: false,
  model: 'DeepSeek Flash',
  problem: null,
  ...e
})

const end = (d: Partial<StoryFillDone>): StoryFillDone => ({
  storyId: 'b1',
  title: 'Kestrel Point',
  total: 42,
  filled: 42,
  failed: 0,
  stopped: false,
  problem: null,
  ...d
})

describe('Fill in the whole story’s words (the story index)', () => {
  it('says roughly what it costs before anything is asked, or how many AI calls when the price isn’t known', () => {
    expect(fillCostWords(est({}))).toBe('About $0.12 with DeepSeek Flash, for 42 scenes (about 63,000 words).')
    expect(fillCostWords(est({ scenes: 1, words: 800, cost: 0.002 }))).toBe('Less than a cent with DeepSeek Flash, for 1 scene.')
    expect(fillCostWords(est({ free: true, cost: 0, model: 'llama3' }))).toBe(
      'Free with your local model, llama3. It reads 42 scenes (about 63,000 words).'
    )
    expect(fillCostWords(est({ cost: null }))).toBe(
      'About 42 AI calls with DeepSeek Flash, one for each of 42 scenes (about 63,000 words).'
    )
    expect(fillCostWords(est({ scenes: 0, words: 0 }))).toBe('')
    expect(fillSoFarWords(est({}))).toBe('18 of 60 scenes are filled in already.')
    expect(fillSoFarWords(est({ total: 42 }))).toBe('')
  })

  it('says what it does, how far it has got, and how it went', () => {
    expect(fillIntro('Kestrel Point')).toContain('each scene of “Kestrel Point”')
    expect(fillIntro('')).toContain('each scene of this story')
    expect(fillStarted(42)).toBe('Filling in 42 scenes in the background. You can stop it from the top bar.')
    expect(fillProgress({ storyId: 'b1', title: 'Kestrel Point', done: 2, total: 42 })).toBe('Filling in scene 3 of 42…')
    expect(fillProgress({ storyId: 'b1', title: 'Kestrel Point', done: 0, total: 1 })).toBe('Filling in the scene…')
    expect(fillDoneWords(end({}))).toBe('“Kestrel Point” is filled in: 42 scenes.')
    expect(fillDoneWords(end({ filled: 40, failed: 2 }))).toBe(
      'Filled in 40 of 42 scenes of “Kestrel Point”. The memory model couldn’t read 2; Recall in those scenes can read them again.'
    )
    expect(fillDoneWords(end({ filled: 41, failed: 1 }))).toContain('couldn’t read one; Recall in that scene can read it again.')
    expect(fillDoneWords(end({ problem: 'The memory model didn’t answer.' }))).toBe('The memory model didn’t answer.')
    // Adam's own Stop says so itself.
    expect(fillDoneWords(end({ stopped: true }))).toBe('')
  })
})
