import { describe, expect, it } from 'vitest'
import { announcedOf, othersNeedToKnow, type Announced } from './saveAnnounce'

const mara: Announced = { name: 'Mara', aliases: ['the Fox'], parentId: null, hardRule: false, tags: ['crew'] }

describe('othersNeedToKnow', () => {
  it('stays quiet for a save that changes nothing other screens show', () => {
    // A field, the summary or the description typed: the copy other screens know has the same names.
    expect(othersNeedToKnow(mara, { ...mara, aliases: ['the Fox'], tags: ['crew'] })).toBe(false)
  })

  it('tells them when the names it goes by change', () => {
    expect(othersNeedToKnow(mara, { ...mara, name: 'Mara Vell' })).toBe(true)
    expect(othersNeedToKnow(mara, { ...mara, aliases: ['the Fox', 'Red'] })).toBe(true)
    expect(othersNeedToKnow(mara, { ...mara, aliases: [] })).toBe(true)
  })

  it('tells them when a place moves, the hard rule flips or the tags change', () => {
    expect(othersNeedToKnow(mara, { ...mara, parentId: 'house' })).toBe(true)
    expect(othersNeedToKnow(mara, { ...mara, hardRule: true })).toBe(true)
    expect(othersNeedToKnow(mara, { ...mara, tags: ['crew', 'pilot'] })).toBe(true)
  })

  it('compares against the copy last announced, not the one before it', () => {
    const renamed = { ...mara, name: 'Mara Vell' }
    expect(othersNeedToKnow(announcedOf(renamed), { ...renamed })).toBe(false)
  })
})
