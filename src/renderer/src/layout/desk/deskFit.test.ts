import { describe, expect, it } from 'vitest'
import { deskFit, GUTTER, MARGIN, MARGIN_RESERVE, SHEET_LEFT_MIN, sheetPadding, sheetSides, STORY_RIGHT } from './deskFit'

/** The default page: 70 characters of 19px Literata, about 660px (Adam's machine measures nearer 760). */
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

  it('with the slim spine, puts the margin notes in a column from about 1180px, and in tabs below that', () => {
    for (const w of [1440, 1280, 1180]) {
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

  it('with the whole story beside the page, the column needs a wider window', () => {
    expect(deskFit(1440, COLUMN, true).full).toBe(true)
    expect(deskFit(1440, COLUMN, true).margin).toBe('tabs')
    expect(deskFit(1460, COLUMN, true).margin).toBe('column')
    expect(deskFit(1920, COLUMN, true).margin).toBe('column')
    // Narrower than the full spine's room, the spine is slim whatever was asked, and the column comes back.
    const narrow = deskFit(1240, COLUMN, true)
    expect(narrow.full).toBe(false)
    expect(narrow.margin).toBe('column')
  })

  it('follows Adam’s page width: wider text needs a wider window for the column', () => {
    expect(deskFit(1280, 860, false).margin).toBe('tabs')
    expect(deskFit(1440, 860, false).margin).toBe('column')
  })

  it('centres the sheet, moving it left only as far as the margin column needs', () => {
    // Plenty of room: centred, and the column fits on its right.
    const wide = deskFit(1920, COLUMN, false)
    const ws = sheetSides(wide)
    expect(ws.left).toBe((1920 - 776) / 2)
    expect(ws.right).toBeGreaterThanOrEqual(MARGIN_RESERVE)
    // Tight: the sheet moves left of the centre to keep the column's room, never nearer the spine than its minimum.
    const tight = deskFit(1200, COLUMN, false)
    const ts = sheetSides(tight)
    expect(ts.right).toBe(MARGIN_RESERVE)
    expect(ts.left).toBe(1200 - 776 - MARGIN_RESERVE)
    expect(ts.left).toBeGreaterThanOrEqual(SHEET_LEFT_MIN)
    // The column's note fits inside the window: the sheet's right edge, less the overlap, plus the note's width.
    expect(ts.left + 776 - MARGIN.overlap + MARGIN.width).toBeLessThanOrEqual(1200 - GUTTER)
    // Tabs: centred in the window as before.
    const tabs = sheetSides(deskFit(1100, COLUMN, false))
    expect(tabs.left).toBe((1100 - 776) / 2)
    // The full spine: centred in the room right of it.
    const full = sheetSides(deskFit(1920, COLUMN, true))
    expect(full.left).toBe(STORY_RIGHT + (1920 - STORY_RIGHT - 776) / 2)
  })
})
