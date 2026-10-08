import { describe, expect, it } from 'vitest'
import { deskFit, GUTTER, MARGIN_RESERVE, PINNED_LEFT_MIN, SHEET_LEFT_MIN, sheetPadding } from './deskFit'

/** Adam's default page: 70 characters of 19px Literata, about 660px. */
const COLUMN = 660

describe('where the desk’s pieces go for a window size', () => {
  it('gives the sheet 58px of paper either side on a large window, less on a small one', () => {
    expect(sheetPadding(1920)).toBe(58)
    expect(sheetPadding(1000)).toBe(58)
    expect(sheetPadding(999)).toBe(40)
    expect(sheetPadding(800)).toBe(40)
    expect(sheetPadding(799)).toBe(24)
    expect(deskFit(1440, COLUMN, false).sheetW).toBe(776)
    expect(deskFit(900, COLUMN, false).sheetW).toBe(740)
  })

  it('puts the margin notes in a column beside the sheet from about 1180px, and in tabs below that', () => {
    for (const w of [1920, 1440, 1280, 1180]) {
      const f = deskFit(w, COLUMN, false)
      expect(f.margin, `${w}`).toBe('column')
      expect(f.rightMin).toBe(MARGIN_RESERVE)
      expect(f.leftMin).toBe(SHEET_LEFT_MIN)
    }
    for (const w of [1170, 1100, 960]) {
      const f = deskFit(w, COLUMN, false)
      expect(f.margin, `${w}`).toBe('tabs')
      expect(f.rightMin).toBe(GUTTER)
    }
  })

  it('at 1440 the sheet, centred, still leaves the margin its column', () => {
    const f = deskFit(1440, COLUMN, false)
    const scroller = 1440 - 12
    const left = Math.max(f.leftMin, Math.min((scroller - f.sheetW) / 2, scroller - f.sheetW - f.rightMin))
    expect(left).toBe(326)
    expect(scroller - left - f.sheetW).toBeGreaterThanOrEqual(MARGIN_RESERVE)
  })

  it('follows Adam’s page width: wider text needs a wider window for the column', () => {
    expect(deskFit(1280, 860, false).margin).toBe('tabs')
    expect(deskFit(1440, 860, false).margin).toBe('column')
  })

  it('keeps the flyout pinned only when the sheet still fits after it; the margin then needs more room', () => {
    const pinned = deskFit(1440, COLUMN, true)
    expect(pinned.pinRoom).toBe(true)
    expect(pinned.leftMin).toBe(PINNED_LEFT_MIN)
    expect(pinned.margin).toBe('tabs')
    expect(deskFit(1920, COLUMN, true).margin).toBe('column')
    const small = deskFit(1100, COLUMN, true)
    expect(small.pinRoom).toBe(false)
    expect(small.leftMin).toBe(SHEET_LEFT_MIN)
  })
})
