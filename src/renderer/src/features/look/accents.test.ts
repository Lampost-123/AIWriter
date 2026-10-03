import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCENT_IDS, accentIdOf } from '@shared/contracts/look'
import { ACCENTS } from './accents'

// The swatches (accents.ts) show the colours styles.css paints, and each accent keeps AA contrast in every theme
// (tests/unit/contrast.test.ts checks the stylesheet; this checks the two agree, and the accents' own rules).

const css = readFileSync(join(__dirname, '../../styles.css'), 'utf8')
const THEMES = ['light', 'dark', 'sepia'] as const

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block`)
  const text = css.slice(start, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2].toLowerCase()
  return out
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A colour's hue in degrees (0 red, 120 green, 240 blue) and its saturation (0 to 1). */
function hueOf(hex: string): { hue: number; sat: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let hue = 0
  if (d) hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return { hue: (hue + 360) % 360, sat }
}

describe('accent colours', () => {
  it('offers the theme’s own colour first, then every accent there is, once each', () => {
    expect(ACCENTS[0].id).toBeNull()
    expect(ACCENTS.slice(1).map((a) => a.id)).toEqual([...ACCENT_IDS])
    expect(new Set(ACCENTS.map((a) => a.label)).size).toBe(ACCENTS.length)
  })

  it('shows the colours the stylesheet paints', () => {
    for (const a of ACCENTS) {
      for (const theme of THEMES) {
        const t = a.id ? block(`[data-theme='${theme}'][data-accent='${a.id}']`) : block(`[data-theme='${theme}']`)
        const c = a.colours[theme]
        expect({ accent: t.accent, hover: t['accent-hover'], soft: t['accent-soft'], fg: t['accent-fg'] }).toEqual(c)
      }
    }
  })

  it('keeps AA contrast for its text in every theme', () => {
    for (const a of ACCENTS) {
      for (const theme of THEMES) {
        const t = block(`[data-theme='${theme}']`)
        const c = a.colours[theme]
        for (const bg of [t.bg, t.surface, t['surface-2'], t.page, c.soft]) expect(contrast(c.accent, bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(c.fg, c.accent)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(c.fg, c.hover)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('never reads as amber, red or green, which mean an AI suggestion, a must-fix problem and done', () => {
    for (const a of ACCENTS.filter((x) => x.id)) {
      for (const theme of THEMES) {
        const { hue, sat } = hueOf(a.colours[theme].accent)
        // Greys have no hue to speak of; anything with colour stays clear of red to yellow-green (330° round to 160°).
        if (sat < 0.15) continue
        expect(hue > 160 && hue < 330, `${a.id} in ${theme} (hue ${Math.round(hue)}°)`).toBe(true)
      }
    }
  })

  it('reads the setting safely: anything that isn’t an accent is the theme’s own', () => {
    expect(accentIdOf('teal')).toBe('teal')
    expect(accentIdOf(null)).toBeNull()
    expect(accentIdOf('#ff0000')).toBeNull()
    expect(accentIdOf(42)).toBeNull()
  })
})
