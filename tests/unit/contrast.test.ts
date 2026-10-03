import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCENT_IDS } from '@shared/contracts/look'

// Text colours must stay readable (WCAG AA, 4.5:1 for normal text) on every background they sit on, in every
// theme and with every accent colour Adam can pick (milestone 6).

const css = readFileSync(join(__dirname, '../../src/renderer/src/styles.css'), 'utf8')

function blockTokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block`)
  const block = css.slice(start, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2]
  return out
}

const themeTokens = (theme: string): Record<string, string> => blockTokens(`[data-theme='${theme}']`)

/** A theme with an accent colour picked: its accent tokens over the theme's own. */
const accentTokens = (theme: string, accent: string): Record<string, string> => ({
  ...themeTokens(theme),
  ...blockTokens(`[data-theme='${theme}'][data-accent='${accent}']`)
})

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Each text colour and the backgrounds it is used on. */
const PAIRS: Record<string, string[]> = {
  fg: ['bg', 'surface', 'surface-2', 'page', 'ai-soft'],
  muted: ['bg', 'surface', 'surface-2', 'page', 'ai-soft'],
  faint: ['bg', 'surface', 'surface-2', 'page'],
  ai: ['bg', 'surface', 'surface-2', 'page', 'ai-soft'],
  // Text on a filled amber button (an AI suggestion's Accept).
  'ai-fg': ['ai'],
  danger: ['bg', 'surface', 'page', 'danger-soft'],
  success: ['bg', 'surface', 'page', 'success-soft']
}

/** The accent's text colours and where they sit: links and selected words on the backgrounds, a selected row's words on
 *  its soft wash, and a filled button's words (also while hovered). */
const ACCENT_PAIRS: Record<string, string[]> = {
  accent: ['bg', 'surface', 'surface-2', 'page', 'accent-soft'],
  'accent-fg': ['accent', 'accent-hover']
}

const THEMES = ['light', 'dark', 'sepia']

describe('theme text contrast', () => {
  for (const theme of THEMES) {
    const t = themeTokens(theme)
    for (const [text, bgs] of Object.entries({ ...PAIRS, ...ACCENT_PAIRS })) {
      for (const bg of bgs) {
        it(`${theme}: --${text} on --${bg} is at least 4.5:1`, () => {
          expect(contrast(t[text], t[bg])).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
    it(`${theme}: --faint stays lighter than --muted, so hints read as quieter`, () => {
      expect(contrast(t.faint, t.bg)).toBeLessThan(contrast(t.muted, t.bg))
    })
  }
})

describe('accent colour contrast', () => {
  it('every accent has its colours in every theme', () => {
    for (const theme of THEMES) {
      for (const accent of ACCENT_IDS) {
        expect(Object.keys(blockTokens(`[data-theme='${theme}'][data-accent='${accent}']`)).sort()).toEqual(['accent', 'accent-fg', 'accent-hover', 'accent-soft'])
      }
    }
  })
  for (const theme of THEMES) {
    for (const accent of ACCENT_IDS) {
      const t = accentTokens(theme, accent)
      for (const [text, bgs] of Object.entries(ACCENT_PAIRS)) {
        for (const bg of bgs) {
          it(`${theme} with ${accent}: --${text} on --${bg} is at least 4.5:1`, () => {
            expect(contrast(t[text], t[bg])).toBeGreaterThanOrEqual(4.5)
          })
        }
      }
    }
  }
})

// The New look ("Lamplight", <html data-look='new'>): its own frame, panes, page and raised surfaces in each theme,
// over the theme's colours, and an ink for each kind of thing in the world. The same rules hold, every accent too.
const newLookTokens = (theme: string): Record<string, string> => ({ ...themeTokens(theme), ...blockTokens(`[data-look='new'][data-theme='${theme}']`) })

const NEW_LOOK_PAIRS: Record<string, string[]> = {
  fg: ['bg', 'surface', 'surface-2', 'page', 'raise', 'ai-soft'],
  muted: ['bg', 'surface', 'surface-2', 'page', 'raise', 'ai-soft'],
  faint: ['bg', 'surface', 'surface-2', 'page', 'raise'],
  ai: ['bg', 'surface', 'surface-2', 'page', 'raise', 'ai-soft'],
  'ai-fg': ['ai'],
  danger: ['bg', 'surface', 'page', 'raise', 'danger-soft'],
  success: ['bg', 'surface', 'page', 'raise', 'success-soft']
}
const NEW_LOOK_ACCENT_PAIRS: Record<string, string[]> = {
  accent: ['bg', 'surface', 'surface-2', 'page', 'raise', 'accent-soft'],
  'accent-fg': ['accent', 'accent-hover']
}
const KINDS = ['char', 'place', 'group', 'item', 'lore', 'event', 'thread', 'gloss']

describe('the New look: text contrast', () => {
  for (const theme of THEMES) {
    const t = newLookTokens(theme)
    for (const [text, bgs] of Object.entries({ ...NEW_LOOK_PAIRS, ...NEW_LOOK_ACCENT_PAIRS })) {
      for (const bg of bgs) {
        it(`${theme}: --${text} on --${bg} is at least 4.5:1`, () => {
          expect(contrast(t[text], t[bg])).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
    it(`${theme}: --faint stays lighter than --muted`, () => {
      expect(contrast(t.faint, t.bg)).toBeLessThan(contrast(t.muted, t.bg))
    })
    it(`${theme}: the frame is deepest, the panes a step up, the page lightest`, () => {
      const order = [luminance(t.bg), luminance(t.surface), luminance(t.page)]
      expect(order).toEqual([...order].sort((a, b) => a - b))
    })
  }
})

describe('the New look: kind inks', () => {
  for (const theme of THEMES) {
    const t = newLookTokens(theme)
    for (const kind of KINDS) {
      // A kind's words and icon sit on its own soft tile, and on the page, the panes, the frame and raised cards.
      for (const bg of [`k-${kind}-soft`, 'page', 'surface', 'bg', 'raise']) {
        it(`${theme}: --k-${kind} on --${bg} is at least 4.5:1`, () => {
          expect(t[`k-${kind}`], `--k-${kind} in ${theme}`).toMatch(/^#/)
          expect(contrast(t[`k-${kind}`], t[bg])).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})

describe('the New look: accent colour contrast', () => {
  for (const theme of THEMES) {
    for (const accent of ACCENT_IDS) {
      const t = { ...newLookTokens(theme), ...blockTokens(`[data-theme='${theme}'][data-accent='${accent}']`) }
      for (const [text, bgs] of Object.entries(NEW_LOOK_ACCENT_PAIRS)) {
        for (const bg of bgs) {
          it(`${theme} with ${accent}: --${text} on --${bg} is at least 4.5:1`, () => {
            expect(contrast(t[text], t[bg])).toBeGreaterThanOrEqual(4.5)
          })
        }
      }
    }
  }
})
