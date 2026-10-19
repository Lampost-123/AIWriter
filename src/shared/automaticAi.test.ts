import { describe, expect, it } from 'vitest'
import { AUTOMATIC_AI_KEYS, AUTOMATIC_AI_LEVELS, automaticAiLevel, automaticAiSettings } from './automaticAi'
import { defaultSettings } from './defaults'

describe('Automatic AI', () => {
  it('reads the app as it ships, every switch on, as Full', () => {
    expect(automaticAiLevel(defaultSettings('lib'))).toBe('full')
  })

  it('reads settings saved before the switches existed (missing means on) as Full', () => {
    expect(automaticAiLevel({})).toBe('full')
  })

  it('gives back the level each set of switches was made from', () => {
    for (const level of ['off', 'light', 'full'] as const) {
      expect(automaticAiLevel({ ...defaultSettings('lib'), ...automaticAiSettings(level) })).toBe(level)
    }
  })

  it('calls any other mix Custom', () => {
    expect(automaticAiLevel({ ...defaultSettings('lib'), ...automaticAiSettings('light'), checkAfterDraft: true })).toBe('custom')
  })

  it('keeps Light cheaper than Full: the whole-book brief, the check after each draft and second opinions are off', () => {
    const light = AUTOMATIC_AI_LEVELS.light
    expect(light.continuityBrief).toBe(false)
    expect(light.checkAfterDraft).toBe(false)
    expect(light.checkSecondOpinion).toBe(false)
    expect(light.planFirst).toBe(true)
    expect(AUTOMATIC_AI_KEYS.every((k) => AUTOMATIC_AI_LEVELS.off[k] === false)).toBe(true)
    expect(AUTOMATIC_AI_KEYS.every((k) => AUTOMATIC_AI_LEVELS.full[k] === true)).toBe(true)
  })
})
