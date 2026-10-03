import { describe, expect, it } from 'vitest'
import { markerSpot, type Anchor } from './place'

const W = 1280
const H = 800
const rect = (left: number, top: number, right: number, bottom: number): Anchor['rect'] => ({ left, top, right, bottom })
/** The full marker ("Listening") and the small one (just the level). */
const full = [100, 24] as const
const small = [28, 16] as const

describe('where the dictation marker goes', () => {
  it('sits just after the end of the cursor’s line when that is the last line of its paragraph', () => {
    // The cursor at the end of the paragraph.
    expect(markerSpot({ kind: 'caret', rect: rect(400, 300, 401, 324), lineEnd: 401 }, ...full, W, H)).toEqual({
      x: 407,
      y: 300,
      small: false
    })
    // The cursor in the middle of that line: after the line's last word, not over the words after the cursor.
    expect(markerSpot({ kind: 'caret', rect: rect(400, 300, 401, 324), lineEnd: 620 }, ...full, W, H)).toEqual({
      x: 626,
      y: 300,
      small: false
    })
  })

  it('sits just below the scene’s last line, where there is nothing to cover', () => {
    const end = { kind: 'caret' as const, lineEnd: 1101, sceneEnd: true }
    // No room after the line for its widest words: below it.
    expect(markerSpot({ ...end, rect: rect(1100, 300, 1101, 324) }, ...full, W, H)).toEqual({ x: 1090, y: 330, small: false })
  })

  it('sits in the page’s margin beside the cursor’s line, when the margin is wide enough', () => {
    expect(markerSpot({ kind: 'caret', rect: rect(700, 300, 701, 324), textLeft: 460 }, ...full, W, H)).toEqual({
      x: 354,
      y: 300,
      small: false
    })
    // A narrow margin (the page next to the side panels): not there.
    const page = rect(272, 92, 940, 800)
    expect(markerSpot({ kind: 'caret', rect: rect(700, 300, 701, 324), textLeft: 296, within: page }, ...small, W, H).small).toBe(true)
  })

  it('shows small in the middle of a paragraph, in the gap above the cursor’s line, covering next to nothing', () => {
    // Its middle on the top of the cursor's line, half way between its words and those of the line above.
    expect(markerSpot({ kind: 'caret', rect: rect(400, 300, 401, 324), lineTop: 295 }, ...small, W, H)).toEqual({
      x: 387,
      y: 287,
      small: true
    })
    // The line at the top of the page, just under the scene's title bar: the gap below it instead.
    const page = rect(272, 92, 940, 800)
    expect(markerSpot({ kind: 'caret', rect: rect(400, 100, 401, 124), lineTop: 95, within: page }, ...small, W, H)).toEqual({
      x: 387,
      y: 121,
      small: true
    })
  })

  it('works out full or small the same whatever its size now, so it never switches back and forth', () => {
    const middle: Anchor = { kind: 'caret', rect: rect(400, 300, 401, 324), lineTop: 295 }
    expect(markerSpot(middle, ...full, W, H).small).toBe(true)
    expect(markerSpot(middle, ...small, W, H).small).toBe(true)
    const end: Anchor = { kind: 'caret', rect: rect(400, 300, 401, 324), lineEnd: 401 }
    expect(markerSpot(end, ...full, W, H).small).toBe(false)
    expect(markerSpot(end, ...small, W, H).small).toBe(false)
  })

  it('shows a countdown in full, just above the cursor’s line, when it can’t be small', () => {
    const middle: Anchor = { kind: 'caret', rect: rect(400, 300, 401, 324), lineTop: 295 }
    expect(markerSpot(middle, 150, 24, W, H, false)).toEqual({ x: 390, y: 270, small: false })
    // At the top of the window: below the line.
    expect(markerSpot({ ...middle, rect: rect(400, 10, 401, 34) }, 150, 24, W, H, false)).toEqual({ x: 390, y: 40, small: false })
  })

  it('sits across a text box’s top edge at its right-hand end', () => {
    expect(markerSpot({ kind: 'box', rect: rect(900, 200, 1200, 260) }, ...full, W, H)).toEqual({ x: 1090, y: 188, small: false })
    // At the very top of the window: across the bottom edge instead.
    expect(markerSpot({ kind: 'box', rect: rect(300, 4, 700, 36) }, ...full, W, H)).toEqual({ x: 590, y: 24, small: false })
  })

  it('sits to the left of a microphone button, or above it when there is no room', () => {
    expect(markerSpot({ kind: 'button', rect: rect(600, 100, 628, 128) }, ...full, W, H)).toEqual({ x: 494, y: 102, small: false })
    expect(markerSpot({ kind: 'button', rect: rect(20, 100, 48, 128) }, ...full, W, H)).toEqual({ x: 8, y: 70, small: false })
  })

  it('stays inside the part of the window it is in, when it fits there', () => {
    const page = rect(272, 92, 940, 800)
    // The scene's last line near the page's right-hand side: kept off the side panel.
    expect(
      markerSpot({ kind: 'caret', rect: rect(858, 260, 859, 284), lineEnd: 900, sceneEnd: true, within: page }, 130, 24, W, H)
    ).toEqual({
      x: 802,
      y: 290,
      small: false
    })
    // A part too small for it: the window is the limit instead.
    expect(
      markerSpot({ kind: 'caret', rect: rect(400, 300, 401, 324), lineEnd: 401, within: rect(380, 280, 440, 340) }, ...full, W, H)
    ).toEqual({
      x: 407,
      y: 300,
      small: false
    })
  })

  it('stays inside the window, and sits at the bottom middle with nothing to sit by', () => {
    expect(markerSpot({ kind: 'caret', rect: rect(1250, 900, 1251, 924) }, ...full, W, H)).toEqual({ x: 1172, y: 768, small: true })
    expect(markerSpot(null, ...full, W, H)).toEqual({ x: 590, y: 748, small: false })
  })
})
