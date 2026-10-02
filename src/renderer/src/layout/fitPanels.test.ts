import { describe, expect, it } from 'vitest'
import {
  PAGE_MIN,
  PAGE_PADDING,
  WIDE_PAGE,
  WIDE_PAGE_PADDING,
  binderFloats,
  chosenWidthFor,
  dragMax,
  fitPanels,
  pageMinFor,
  proseMinFor,
  widePageFrom
} from './fitPanels'

const binder = (width = 272, open = true) => ({ open, width, floor: 200 })
const scenePanel = (width = 340, open = true) => ({ open, width, floor: 260 })

describe('fitPanels', () => {
  it('leaves the chosen widths alone when the window has room', () => {
    expect(fitPanels(1440, binder(), scenePanel())).toEqual({ left: 272, right: 340 })
    expect(fitPanels(1280, binder(), scenePanel())).toEqual({ left: 272, right: 340 })
  })

  it('in the smallest window (960 wide) with both panels open, the page keeps its room', () => {
    const { left, right } = fitPanels(960, binder(), scenePanel())
    expect(960 - left - right).toBe(PAGE_MIN)
    expect(left).toBeGreaterThanOrEqual(200)
    expect(right).toBeGreaterThanOrEqual(260)
    // Each gives up width in proportion to what it can spare (72 and 80 px here).
    expect(272 - left).toBeLessThan(340 - right)
  })

  it('a closed panel takes no room and gives none', () => {
    expect(fitPanels(960, binder(272, false), scenePanel())).toEqual({ left: 0, right: 340 })
    expect(fitPanels(960, binder(440), scenePanel(340, false))).toEqual({ left: 440, right: 0 })
  })

  it('never squeezes a panel below its floor', () => {
    const wide = fitPanels(960, binder(440), scenePanel(520))
    expect(960 - wide.left - wide.right).toBe(PAGE_MIN)
    // Asking for more room than both can spare: each stops at its floor.
    expect(fitPanels(960, binder(440), scenePanel(520), 600)).toEqual({ left: 200, right: 260 })
    expect(fitPanels(960, binder(200), scenePanel(260))).toEqual({ left: 200, right: 260 })
  })

  it('gives back the chosen widths as the window grows', () => {
    const small = fitPanels(1000, binder(), scenePanel())
    const big = fitPanels(1200, binder(), scenePanel())
    expect(small.left + small.right).toBe(1000 - PAGE_MIN)
    expect(big).toEqual({ left: 272, right: 340 })
  })
})

describe('dragMax', () => {
  it('stops a drag where the page would get too narrow, but never below the panel’s own minimum', () => {
    expect(dragMax(1440, 340, 220, 440)).toBe(440)
    expect(dragMax(1100, 340, 220, 440)).toBe(1100 - 340 - PAGE_MIN)
    expect(dragMax(960, 340, 220, 440)).toBe(220)
  })
})

describe('pageMinFor', () => {
  it('keeps room for about 55 characters a line at the text size, plus the padding', () => {
    expect(pageMinFor(19)).toBeGreaterThanOrEqual(600)
    expect(pageMinFor(19)).toBeLessThanOrEqual(630)
    // Larger text needs a wider page, smaller text less.
    expect(pageMinFor(24)).toBeGreaterThan(pageMinFor(19))
    expect(pageMinFor(15)).toBeLessThan(pageMinFor(19))
  })

  it('never asks for more than the page uses at its chosen width', () => {
    expect(pageMinFor(19, 40)).toBeLessThan(pageMinFor(19, 70))
    expect(pageMinFor(19, 100)).toBe(pageMinFor(19, 70))
  })

  it('leaves the words their room with whichever padding the page has at that width', () => {
    for (let size = 15; size <= 24; size++) {
      const min = pageMinFor(size)
      const wideFrom = widePageFrom(size)
      // At its narrowest the page has the narrow padding (24 px either side), and the words their room.
      expect(min - PAGE_PADDING).toBe(proseMinFor(size))
      expect(wideFrom).toBeGreaterThan(min)
      // The wide padding (40 px) only from 700 px, and only once the words keep their room beside it.
      expect(wideFrom).toBeGreaterThanOrEqual(WIDE_PAGE)
      for (let page = min; page <= min + 200; page++) {
        const padding = page >= wideFrom ? WIDE_PAGE_PADDING : PAGE_PADDING
        expect(page - padding).toBeGreaterThanOrEqual(proseMinFor(size))
      }
    }
    expect(widePageFrom(19)).toBe(WIDE_PAGE)
    expect(widePageFrom(22)).toBe(proseMinFor(22) + WIDE_PAGE_PADDING)
  })

  it('large text in the smallest window: a page squeezed below its minimum keeps the narrow padding', () => {
    // 22 px text at 960 px: the binder floats and the scene panel is at its narrowest, so the page is 700 px.
    const pageMin = pageMinFor(22)
    expect(binderFloats(960, 200, scenePanel(), pageMin)).toBe(true)
    const page = 960 - fitPanels(960, binder(272, false), scenePanel(), pageMin).right
    expect(page).toBe(700)
    expect(page).toBeLessThan(widePageFrom(22))
    // So the words get 642 px, about as much as they need (644), not 610.
    expect(page - PAGE_PADDING).toBeGreaterThanOrEqual(proseMinFor(22) - 2)
  })
})

describe('the binder floats over the page', () => {
  const pageMin = pageMinFor(19)

  it('in the smallest window with the scene panel open, as both panels at their narrowest leave too little room', () => {
    expect(binderFloats(960, 200, scenePanel(), pageMin)).toBe(true)
  })

  it('not when there is room for both at their narrowest, nor without the scene panel', () => {
    // A 1366 px laptop at 125% is 1093 px wide: both panels are squeezed, and the page keeps its room.
    expect(binderFloats(1093, 200, scenePanel(), pageMin)).toBe(false)
    const fit = fitPanels(1093, binder(), scenePanel(), pageMin)
    expect(1093 - fit.left - fit.right).toBe(pageMin)
    expect(binderFloats(960, 200, scenePanel(340, false), pageMin)).toBe(false)
  })

  it('leaves the page its room beside the scene panel alone', () => {
    const fit = fitPanels(960, binder(272, false), scenePanel(), pageMin)
    expect(960 - fit.right).toBeGreaterThanOrEqual(pageMin)
  })
})

describe('chosenWidthFor', () => {
  it('is the width dragged to when the window has room', () => {
    expect(chosenWidthFor(300, 1440, 'left', { open: true, floor: 200 }, scenePanel(), 440, 614)).toBe(300)
  })

  it('in a small window, saves a width that shows exactly where Adam let go', () => {
    const W = 1240
    const other = scenePanel(400)
    for (const shown of [221, 230, 247, 260]) {
      const chosen = chosenWidthFor(shown, W, 'left', { open: true, floor: 200 }, other, 440, 614)
      expect(fitPanels(W, binder(chosen), other, 614).left).toBe(shown)
    }
    for (const shown of [262, 280, 300]) {
      const chosen = chosenWidthFor(shown, W, 'right', { open: true, floor: 260 }, binder(300), 520, 614)
      expect(Math.abs(fitPanels(W, binder(300), scenePanel(chosen), 614).right - shown)).toBeLessThanOrEqual(1)
    }
  })

  it('what shows never falls as the chosen width grows (so the search is sound)', () => {
    for (const W of [960, 1000, 1093, 1200, 1300]) {
      let last = 0
      for (let c = 200; c <= 440; c++) {
        const shown = fitPanels(W, binder(c), scenePanel(), 614).left
        expect(shown).toBeGreaterThanOrEqual(last)
        last = shown
      }
    }
  })

  it('stops at the panel’s widest', () => {
    expect(chosenWidthFor(500, 1000, 'left', { open: true, floor: 200 }, scenePanel(), 440, 614)).toBe(440)
  })
})
