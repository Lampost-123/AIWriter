import { describe, expect, it } from 'vitest'
import { STYLE_PRESETS, presetOf, stylePresetById, withPreset } from './stylePresets'
import { cleanGenres } from './genres'
import { cleanIntensity } from './intensity'

describe('writing style presets', () => {
  it('each has its own id, genres the app knows and levels on its scales', () => {
    expect(new Set(STYLE_PRESETS.map((p) => p.id)).size).toBe(STYLE_PRESETS.length)
    for (const p of STYLE_PRESETS) {
      expect(cleanGenres(p.style.genres)).toEqual(p.style.genres)
      expect(cleanIntensity(p.style.intensity)).toEqual(p.style.intensity)
      expect(p.style.proseStyle.length).toBeGreaterThan(40)
    }
  })

  it('has presets for adult readers that go further, and ones for everyone that don’t', () => {
    const adult = STYLE_PRESETS.filter((p) => p.adult)
    expect(adult.length).toBeGreaterThanOrEqual(6)
    expect(adult.every((p) => Math.max(p.style.intensity.romance ?? 0, p.style.intensity.violence ?? 0, p.style.intensity.language ?? 0) >= 3)).toBe(true)
    expect(STYLE_PRESETS.filter((p) => !p.adult).every((p) => (p.style.intensity.romance ?? 0) <= 2)).toBe(true)
  })

  it('sets a style and is known from it again, keeping what it doesn’t set', () => {
    const p = stylePresetById('noir')!
    const style = withPreset({ notes: 'Mine', contentLimits: 'No harm to animals' }, p)
    expect(style).toMatchObject({ notes: 'Mine', contentLimits: 'No harm to animals', pov: p.style.pov, genres: p.style.genres })
    expect(presetOf(style)?.id).toBe('noir')
    expect(presetOf({ ...style, proseStyle: 'Changed' })).toBeNull()
  })
})
