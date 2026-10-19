// Plain waits (the calm overhaul): each step before a draft's first word is named, and the line keeps calm.
import { describe, expect, it } from 'vitest'
import { calmStep, CALM_MS, draftWaitWords } from './waitWords'

describe('what a draft says before its first word', () => {
  it('names each step', () => {
    const memory = { catchingUp: [{ sceneId: 's1', done: 2, total: 5, stage: 'earlier' as const }], reading: null }
    expect(draftWaitWords({ step: 'memory' }, memory, 's1').words).toBe('Catching up the memory: scene 3 of 5')
    // In fewer words, for the scene header's small room.
    expect(draftWaitWords({ step: 'memory' }, memory, 's1').short).toBe('Memory: 3 of 5')
    expect(draftWaitWords({ step: 'gathering' }, null, 's1').short).toBe('Gathering notes…')
    expect(draftWaitWords({ step: 'gathering' }, null, 's1').words).toBe('Gathering what the scene needs…')
    expect(draftWaitWords({ step: 'plan' }, null, 's1').words).toBe('Planning the scene…')
    expect(draftWaitWords({ step: 'lookups', count: 3 }, null, 's1').words).toBe('Looking up 3 things…')
    expect(draftWaitWords({ step: 'lookups', count: 1 }, null, 's1').words).toBe('Looking up 1 thing…')
    expect(draftWaitWords({ step: 'writing' }, null, 's1').words).toBe('Writing…')
  })

  it('says getting ready before the first step, unless the memory is already reading', () => {
    expect(draftWaitWords(null, null, 's1').words).toBe('Getting ready…')
    expect(draftWaitWords(null, { reading: { sceneId: 's0', title: 'Before' } }, 's1').words).toBe('Catching up the memory…')
  })

  it('counts only the memory’s catching up for this scene', () => {
    const memory = { catchingUp: [{ sceneId: 'other', done: 0, total: 9, stage: 'earlier' as const }], reading: null }
    expect(draftWaitWords({ step: 'memory' }, memory, 's1').words).toBe('Catching up the memory…')
  })
})

describe('a calm status line', () => {
  it('shows the first words at once', () => {
    expect(calmStep(null, 'Getting ready…', 0)).toEqual({ shown: 'Getting ready…', next: null })
  })

  it('never shows a step over in less than the calm time', () => {
    let c = calmStep(null, 'Getting ready…', 0)
    c = calmStep(c, 'Gathering what the scene needs…', 100)
    expect(c.shown).toBe('Getting ready…')
    c = calmStep(c, 'Planning the scene…', 250)
    expect(c.shown).toBe('Getting ready…')
    c = calmStep(c, 'Planning the scene…', 250 + CALM_MS - 1)
    expect(c.shown).toBe('Getting ready…')
    c = calmStep(c, 'Planning the scene…', 250 + CALM_MS)
    expect(c).toEqual({ shown: 'Planning the scene…', next: null })
  })

  it('stays put when the words go back to what shows', () => {
    let c = calmStep(null, 'Planning the scene…', 0)
    c = calmStep(c, 'Looking up 2 things…', 10)
    c = calmStep(c, 'Planning the scene…', 20)
    expect(c).toEqual({ shown: 'Planning the scene…', next: null })
  })
})
