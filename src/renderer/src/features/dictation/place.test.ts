import { describe, expect, it } from 'vitest'
import { markerSpot, type Anchor } from './place'

const W = 1280
const H = 800
const rect = (left: number, top: number, right: number, bottom: number): Anchor['rect'] => ({ left, top, right, bottom })

describe('where the dictation marker goes', () => {
  it('sits just above the line the cursor is on, starting at the cursor', () => {
    expect(markerSpot({ kind: 'caret', rect: rect(400, 300, 401, 324) }, 100, 24, W, H)).toEqual({ x: 390, y: 270 })
  })

  it('sits just after the cursor at the end of a paragraph, when its line has room', () => {
    expect(markerSpot({ kind: 'caret', rect: rect(400, 300, 401, 324), lineEnd: true }, 100, 24, W, H)).toEqual({ x: 407, y: 300 })
    // Not room enough for its widest words on that line: above it, as usual.
    expect(markerSpot({ kind: 'caret', rect: rect(1100, 300, 1101, 324), lineEnd: true }, 100, 24, W, H)).toEqual({ x: 1090, y: 270 })
  })

  it('sits just below the line at the very end of the scene, where there is nothing to cover', () => {
    const end = { kind: 'caret' as const, lineEnd: true, sceneEnd: true }
    expect(markerSpot({ ...end, rect: rect(1100, 300, 1101, 324) }, 100, 24, W, H)).toEqual({ x: 1090, y: 330 })
    // No room below it in the window: above.
    expect(markerSpot({ ...end, rect: rect(1100, 760, 1101, 784) }, 100, 24, W, H)).toEqual({ x: 1090, y: 730 })
  })

  it('goes below the line when the line is at the top of the window', () => {
    expect(markerSpot({ kind: 'caret', rect: rect(400, 10, 401, 34) }, 100, 24, W, H)).toEqual({ x: 390, y: 40 })
  })

  it('sits across a text box’s top edge at its right-hand end', () => {
    expect(markerSpot({ kind: 'box', rect: rect(900, 200, 1200, 260) }, 100, 24, W, H)).toEqual({ x: 1090, y: 188 })
    // At the very top of the window: across the bottom edge instead.
    expect(markerSpot({ kind: 'box', rect: rect(300, 4, 700, 36) }, 100, 24, W, H)).toEqual({ x: 590, y: 24 })
  })

  it('sits to the left of a microphone button, or above it when there is no room', () => {
    expect(markerSpot({ kind: 'button', rect: rect(600, 100, 628, 128) }, 100, 24, W, H)).toEqual({ x: 494, y: 102 })
    expect(markerSpot({ kind: 'button', rect: rect(20, 100, 48, 128) }, 100, 24, W, H)).toEqual({ x: 8, y: 70 })
  })

  it('stays inside the part of the window it is in, when it fits there', () => {
    const page = rect(272, 92, 940, 800)
    // Near the page's right-hand side: kept off the side panel.
    expect(markerSpot({ kind: 'caret', rect: rect(858, 260, 859, 284), within: page }, 130, 24, W, H)).toEqual({ x: 802, y: 230 })
    // The first line showing, just under the scene's title bar: below the line, not over the bar.
    expect(markerSpot({ kind: 'caret', rect: rect(400, 100, 401, 124), within: page }, 100, 24, W, H)).toEqual({ x: 390, y: 130 })
    // A part too small for it: the window is the limit instead.
    expect(markerSpot({ kind: 'caret', rect: rect(400, 300, 401, 324), within: rect(380, 280, 440, 340) }, 100, 24, W, H)).toEqual({
      x: 390,
      y: 270
    })
  })

  it('stays inside the window, and sits at the bottom middle with nothing to sit by', () => {
    expect(markerSpot({ kind: 'caret', rect: rect(1250, 900, 1251, 924) }, 100, 24, W, H)).toEqual({ x: 1172, y: 768 })
    expect(markerSpot(null, 100, 24, W, H)).toEqual({ x: 590, y: 748 })
  })
})
