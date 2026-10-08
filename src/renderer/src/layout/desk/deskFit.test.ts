import { describe, expect, it } from 'vitest'
import { DRAWER, deskFit, drawerWidth, GUTTER, MARGIN, MARGIN_RESERVE, MARGIN_SHIFT, SHEET_LEFT_MIN, SHEET_MIN, sheetPadding, sheetSides, STORY_RIGHT } from './deskFit'

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

  it('with the slim spine, puts the margin notes in a column from about 1310px, and in tabs below that', () => {
    for (const w of [1440, 1320]) {
      const f = deskFit(w, COLUMN, false)
      expect(f.margin, `${w}`).toBe('column')
      expect(f.rightMin).toBe(MARGIN_RESERVE)
      expect(f.leftMin).toBe(SHEET_LEFT_MIN)
    }
    for (const w of [1300, 1180, 1100, 960]) {
      const f = deskFit(w, COLUMN, false)
      expect(f.margin, `${w}`).toBe('tabs')
      expect(f.rightMin).toBe(GUTTER)
    }
  })

  it('never moves the sheet more than a little left of the middle for the column: tabs instead', () => {
    // 1200px would hold the column, but only with the sheet 100px left of the middle.
    expect(deskFit(1200, COLUMN, false).margin).toBe('tabs')
    const f = deskFit(1320, COLUMN, false)
    const s = sheetSides(f)
    expect((1320 - 776) / 2 - s.left).toBeLessThanOrEqual(MARGIN_SHIFT)
  })

  it('with the whole story beside the page, the column needs a wider window', () => {
    expect(deskFit(1440, COLUMN, true).full).toBe(true)
    expect(deskFit(1440, COLUMN, true).margin).toBe('tabs')
    expect(deskFit(1660, COLUMN, true).margin).toBe('column')
    expect(deskFit(1920, COLUMN, true).margin).toBe('column')
    // Adam's wider page (about 760px of text) still has its column at 1920.
    expect(deskFit(1920, 760, true).margin).toBe('column')
    // Narrower than the full spine's room, the spine is slim whatever was asked.
    expect(deskFit(1240, COLUMN, true).full).toBe(false)
  })

  it('follows Adam’s page width: wider text needs a wider window for the column', () => {
    expect(deskFit(1440, 860, false).margin).toBe('tabs')
    expect(deskFit(1600, 860, false).margin).toBe('column')
  })

  it('centres the sheet, moving it left only as far as the margin column needs', () => {
    // Plenty of room: centred, and the column fits on its right.
    const wide = deskFit(1920, COLUMN, false)
    const ws = sheetSides(wide)
    expect(ws.left).toBe((1920 - 776) / 2)
    expect(ws.right).toBeGreaterThanOrEqual(MARGIN_RESERVE)
    // Tight: the sheet moves left of the centre to keep the column's room, never nearer the spine than its minimum.
    const tight = deskFit(1320, COLUMN, false)
    const ts = sheetSides(tight)
    expect(ts.right).toBe(MARGIN_RESERVE)
    expect(ts.left).toBe(1320 - 776 - MARGIN_RESERVE)
    expect(ts.left).toBeGreaterThanOrEqual(SHEET_LEFT_MIN)
    // The column's note fits inside the window: the sheet's right edge, less the overlap, plus the note's width.
    expect(ts.left + 776 - MARGIN.overlap + MARGIN.width).toBeLessThanOrEqual(1320 - GUTTER)
    // Tabs: centred in the window as before.
    const tabs = sheetSides(deskFit(1100, COLUMN, false))
    expect(tabs.left).toBe((1100 - 776) / 2)
    // The full spine: centred in the room right of it.
    const full = sheetSides(deskFit(1920, COLUMN, true))
    expect(full.left).toBe(STORY_RIGHT + (1920 - STORY_RIGHT - 776) / 2)
  })

  it('with the scene drawer docked beside the page, the notes step away and the sheet keeps clear of the drawer', () => {
    const f = deskFit(1920, COLUMN, true, true)
    expect(f.drawerDocked).toBe(true)
    expect(f.margin).toBe('tabs')
    expect(f.rightMin).toBe(f.roomRight + GUTTER)
    const s = sheetSides(f)
    expect(s.left + 776 + s.right).toBe(1920)
    expect(s.right).toBeGreaterThanOrEqual(f.roomRight + GUTTER)
  })

  it('makes room for the open drawer instead of lying over the words: the sheet narrows first', () => {
    // 1440 with the whole story beside the page (Adam's maximised window): the sheet narrows, the spine stays full.
    const f = deskFit(1440, 760, true, true)
    expect(f.drawerDocked).toBe(true)
    expect(f.drawerOver).toBe(false)
    expect(f.full).toBe(true)
    expect(f.spineYields).toBe(false)
    expect(f.sheetNarrowed).toBe(true)
    expect(f.sheetW).toBeGreaterThanOrEqual(SHEET_MIN)
    const s = sheetSides(f)
    expect(s.left).toBeGreaterThanOrEqual(STORY_RIGHT + GUTTER)
    // The sheet's right edge keeps a gutter from the drawer's left edge.
    expect(s.left + f.sheetW).toBeLessThanOrEqual(1440 - DRAWER.right - drawerWidth(1440) - GUTTER)
  })

  it('then shows the full spine slim for now (Adam’s choice kept), and only then lies over a dimmed page', () => {
    // 1366: no room even for the narrowest sheet beside the full spine: the spine yields, the sheet fits beside the drawer.
    const f = deskFit(1366, 760, true, true)
    expect(f.full).toBe(false)
    expect(f.spineYields).toBe(true)
    expect(f.fullRoom).toBe(true)
    expect(f.drawerDocked).toBe(true)
    const s = sheetSides(f)
    expect(s.left).toBeGreaterThanOrEqual(SHEET_LEFT_MIN)
    expect(s.left + f.sheetW).toBeLessThanOrEqual(1366 - DRAWER.right - drawerWidth(1366) - GUTTER)
    // Closing the drawer gives the full spine back.
    expect(deskFit(1366, 760, true, false).full).toBe(true)
    // 1280 too.
    expect(deskFit(1280, 760, true, true).spineYields).toBe(true)
    // A small window: even the slim spine and the narrowest sheet don't fit beside the drawer, so it lies over the page.
    const small = deskFit(1100, 760, true, true)
    expect(small.drawerDocked).toBe(false)
    expect(small.drawerOver).toBe(true)
    expect(small.sheetNarrowed).toBe(false)
    expect(deskFit(1100, 760, true, false).drawerOver).toBe(false)
  })

  it('leaves a large window as it was: the full sheet beside the full spine and the drawer', () => {
    const f = deskFit(1920, 760, true, true)
    expect(f.full).toBe(true)
    expect(f.drawerDocked).toBe(true)
    expect(f.sheetNarrowed).toBe(false)
    expect(f.spineYields).toBe(false)
  })

  it('docks beside a page narrower than SHEET_MIN (small text) without narrowing it', () => {
    const f = deskFit(1140, 480, false, true)
    expect(f.drawerDocked).toBe(true)
    expect(f.sheetNarrowed).toBe(false)
  })
})
