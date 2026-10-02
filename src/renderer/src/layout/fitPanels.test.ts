import { describe, expect, it } from 'vitest'
import { PAGE_MIN, dragMax, fitPanels } from './fitPanels'

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
