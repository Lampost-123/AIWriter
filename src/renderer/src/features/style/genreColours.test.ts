import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GENRES } from '@shared/genres'

// The genre tiles (Story feel) colour each tile from its preset's hue, with lightness and chroma set per theme
// in styles.css. Every hue must stay readable in every theme: the label (--fg) on the tile in each state, the
// icon and ring (the tile's ink) on the tile and on the page, and the Main/Blend mark's words on the ink.

const css = readFileSync(join(__dirname, '../../styles.css'), 'utf8')
const tiles = css.slice(css.indexOf('/* genre-tiles'))

function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block`)
  return source.slice(start, source.indexOf('}', start))
}

/** The theme's genre numbers: --genre-tile-l and so on. */
function genreTokens(theme: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of block(tiles, `[data-theme='${theme}']`).matchAll(/--genre-([\w-]+):\s*([\d.]+)\s*;/g)) out[m[1]] = Number(m[2])
  return out
}

function hexTokens(theme: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block(css, `[data-theme='${theme}']`).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2]
  return out
}

/** OKLCH to linear sRGB (Björn Ottosson's matrices). */
function oklchLinear(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
  ]
}

const linLuminance = ([r, g, b]: number[]): number => {
  const [cr, cg, cb] = [r, g, b].map((x) => Math.min(1, Math.max(0, x)))
  return 0.2126 * cr + 0.7152 * cg + 0.0722 * cb
}

function hexLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const ratio = (a: number, b: number): number => {
  const [hi, lo] = [a, b].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEMES = ['light', 'dark', 'sepia']

describe('genre tile colours', () => {
  for (const theme of THEMES) {
    const g = genreTokens(theme)
    const hex = hexTokens(theme)
    it(`${theme}: has every genre colour`, () => {
      expect(Object.keys(g).sort()).toEqual(
        ['badge-c', 'badge-l', 'hover-c', 'hover-l', 'ink-c', 'ink-l', 'line-c', 'line-l', 'on-c', 'on-l', 'tile-c', 'tile-l'].sort()
      )
    })
    for (const genre of GENRES) {
      const col = (k: string): [number, number, number] => oklchLinear(g[`${k}-l`], g[`${k}-c`], genre.hue)
      it(`${theme}: ${genre.label} stays inside the screen's colours`, () => {
        for (const k of ['tile', 'hover', 'on', 'line', 'ink', 'badge'])
          for (const ch of col(k)) {
            expect(ch).toBeGreaterThan(-0.01)
            expect(ch).toBeLessThan(1.01)
          }
      })
      it(`${theme}: ${genre.label} label and icon are readable`, () => {
        const ink = linLuminance(col('ink'))
        for (const k of ['tile', 'hover', 'on']) {
          const bg = linLuminance(col(k))
          expect(ratio(hexLuminance(hex.fg), bg)).toBeGreaterThanOrEqual(4.5)
          // The icon, and the World's mark's words on a story using the world's picks.
          expect(ratio(ink, bg)).toBeGreaterThanOrEqual(4.5)
        }
        expect(ratio(ink, hexLuminance(hex.bg))).toBeGreaterThanOrEqual(4.5)
        expect(ratio(linLuminance(col('badge')), ink)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
