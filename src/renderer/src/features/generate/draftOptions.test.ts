import { describe, expect, it } from 'vitest'
import { BLANK_DRAFT_OPTIONS, patchDraftOptions, resolveDraftOptions } from './draftOptions'

describe('resolveDraftOptions', () => {
  it('uses the card length and the default creativity when Adam chose nothing', () => {
    expect(resolveDraftOptions(undefined, 1500, 'balanced')).toEqual({ direction: '', targetWords: 1500, creativity: 'balanced' })
    expect(resolveDraftOptions(BLANK_DRAFT_OPTIONS, 900, 'steady')).toEqual({ direction: '', targetWords: 900, creativity: 'steady' })
  })

  it("uses Adam's choices, with the direction trimmed", () => {
    expect(
      resolveDraftOptions({ direction: '  end on the knock \n', targetWords: 2500, creativity: 'adventurous' }, 1500, 'balanced')
    ).toEqual({
      direction: 'end on the knock',
      targetWords: 2500,
      creativity: 'adventurous'
    })
  })
})

describe('patchDraftOptions', () => {
  it("changes one scene's options and keeps the rest", () => {
    const a = patchDraftOptions({}, 's1', { direction: 'tense' })
    expect(a.s1).toEqual({ direction: 'tense', targetWords: null, creativity: null })
    const b = patchDraftOptions(a, 's2', { targetWords: 800 })
    expect(b.s1).toBe(a.s1)
    expect(b.s2).toEqual({ direction: '', targetWords: 800, creativity: null })
    const c = patchDraftOptions(b, 's1', { creativity: 'steady' })
    expect(c.s1).toEqual({ direction: 'tense', targetWords: null, creativity: 'steady' })
    expect(a.s1.creativity).toBeNull()
  })
})
