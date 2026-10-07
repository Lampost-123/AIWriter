import { describe, expect, it } from 'vitest'
import { calmed, emotionOf, isStudioVoice, moodFor } from './emotion'

describe('the feeling a note says', () => {
  it('is the one it names most, the earliest on a tie', () => {
    expect(emotionOf('sharp and irritated')).toBe('angry')
    expect(emotionOf('angry, then quietly sad')).toBe('angry')
    expect(emotionOf('wistful, aching')).toBe('longing')
    expect(emotionOf('')).toBeNull()
    expect(emotionOf('as before')).toBeNull()
  })

  it('picks a studio voice’s acted clip: a whisper, a shout, else the feeling, never for calm or a hint of one', () => {
    expect(moodFor('hushed, afraid')).toBe('whisper')
    expect(moodFor('shouting over the wind')).toBe('loud')
    expect(moodFor('terrified')).toBe('afraid')
    expect(moodFor('calm and even')).toBeUndefined()
    expect(moodFor('slightly annoyed')).toBeUndefined()
    expect(moodFor(undefined)).toBeUndefined()
  })

  it('knows a studio voice by its id', () => {
    expect(isStudioVoice('clip:library/p058.wav')).toBe(true)
    expect(isStudioVoice('clip:mine.wav')).toBe(false)
    expect(isStudioVoice('narrator')).toBe(false)
  })
})

describe('a hurried line', () => {
  it('is read a touch quicker, its words for hurrying taken out', () => {
    expect(calmed('urgent', 'fast')).toEqual({ tone: 'urgent', pace: 'lively' })
    expect(calmed('breathless, quickly and low', undefined)).toEqual({ tone: 'breathless, low', pace: 'lively' })
    expect(calmed('wary', 'slow')).toEqual({ tone: 'wary', pace: 'slow' })
    expect(calmed('wary', undefined)).toEqual({ tone: 'wary', pace: '' })
  })
})
