import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Text colours must stay readable (WCAG AA, 4.5:1 for normal text) on every background they sit on.

const css = readFileSync(join(__dirname, '../../src/renderer/src/styles.css'), 'utf8')

function themeTokens(theme: string): Record<string, string> {
  const start = css.indexOf(`[data-theme='${theme}'] {`)
  if (start < 0) throw new Error(`no ${theme} theme block`)
  const block = css.slice(start, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2]
  return out
}

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
  ai: ['bg', 'surface', 'page', 'ai-soft']
}

describe('theme text contrast', () => {
  for (const theme of ['light', 'dark', 'sepia']) {
    const t = themeTokens(theme)
    for (const [text, bgs] of Object.entries(PAIRS)) {
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
