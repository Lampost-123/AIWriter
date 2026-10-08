// Where the desk's pieces go for a window size (the New look's desk layout). The page is a sheet of paper whose text
// column is Adam's page width (Settings › Appearance › Page width, in characters of his text size) with paper either
// side of it; the story's spine runs down the left edge, and its flyout, when pinned open, takes the room beside it; the
// margin notes take a column on the right when the window has room for one, and fold into tabs on the sheet's edge when
// it hasn't.
// Pure, so it is unit-tested; useDeskFrame measures the column and follows the window.
import { useEffect, useLayoutEffect, useState } from 'react'
import { useApp } from '@/lib/store'

/** The spine: a 48px capsule 20px in from the left, 20px under the top bar, 24px above the bottom. */
export const SPINE = { left: 20, top: 20, width: 48, bottom: 24 } as const
/** The flyout beside the spine. */
export const FLYOUT = { left: 76, width: 288 } as const
/** The sheet never comes nearer the left edge than this (clear of the spine), nor the right edge than GUTTER. */
export const SHEET_LEFT_MIN = SPINE.left + SPINE.width + 16
export const GUTTER = 16
/** With the flyout pinned, the sheet starts after it. */
export const PINNED_LEFT_MIN = FLYOUT.left + FLYOUT.width + 16
/**
 * The margin notes' column (phase 3): 300px slips overlapping the sheet's right edge by 16px, with the gutter after them.
 * The room the page keeps on its right for them is RESERVE; without it the notes fold into tabs on the sheet's edge.
 */
export const MARGIN = { width: 300, overlap: 16 } as const
export const MARGIN_RESERVE = MARGIN.width - MARGIN.overlap + GUTTER
/** The window's own scrollbar room inside the desk's scroll area (kept whether it scrolls or not). */
const SCROLLBAR = 12

/** The paper either side of the text: 58px on a large window, less on a small one (as the panels' page does). */
export function sheetPadding(windowW: number): number {
  return windowW >= 1000 ? 58 : windowW >= 800 ? 40 : 24
}

export interface DeskFrame {
  /** The paper either side of the text column. */
  padX: number
  /** The sheet's full width at Adam's page width (it narrows if the window is smaller). */
  sheetW: number
  /** The flyout can stay pinned open beside the page: the sheet still fits at its full width after it. */
  pinRoom: boolean
  /** The least room left of the sheet, clear of the spine (and of the pinned flyout). */
  leftMin: number
  /**
   * Where the margin notes go: a column beside the sheet when there is room for it (about 1180px and up), else tabs on
   * the sheet's right edge that open each note as a pop-up.
   */
  margin: 'column' | 'tabs'
  /** The least room right of the sheet: the margin column's, or the gutter's. */
  rightMin: number
}

/**
 * The desk for a window `windowW` wide whose text column is `columnW` px (Adam's page width), with the flyout pinned
 * open or not (`pinned`, the saved setting: it only takes room when there is room for it).
 */
export function deskFit(windowW: number, columnW: number, pinned: boolean): DeskFrame {
  const padX = sheetPadding(windowW)
  const sheetW = Math.round(columnW + 2 * padX)
  const pinRoom = windowW - PINNED_LEFT_MIN - GUTTER >= sheetW
  const leftMin = pinned && pinRoom ? PINNED_LEFT_MIN : SHEET_LEFT_MIN
  const margin = windowW - SCROLLBAR >= leftMin + sheetW + MARGIN_RESERVE ? 'column' : 'tabs'
  return { padX, sheetW, pinRoom, leftMin, margin, rightMin: margin === 'column' ? MARGIN_RESERVE : GUTTER }
}

/** How wide `chars` characters of the page's text are at `fontSize` (Literata, as the page draws it). */
function measureColumn(fontSize: number, chars: number): number {
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap;font-family:var(--serif-font);font-size:${fontSize}px;width:${chars}ch`
  document.body.appendChild(probe)
  const w = probe.getBoundingClientRect().width
  probe.remove()
  return w || chars * fontSize * 0.55
}

/** The window's width, followed as it changes. */
export function useWindowW(): number {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = (): void => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

/** The desk's frame now: the sheet's size and padding, and whether the flyout is pinned beside the page. */
export function useDeskFrame(): DeskFrame & { pinned: boolean } {
  const fontSize = useApp((s) => s.settings?.editor.fontSize ?? 19)
  const pageWidth = useApp((s) => s.settings?.editor.pageWidth ?? 70)
  const pinnedSetting = useApp((s) => !!s.settings?.layout.binderOpen)
  const windowW = useWindowW()
  const [columnW, setColumnW] = useState(() => pageWidth * fontSize * 0.55)
  useLayoutEffect(() => {
    setColumnW(measureColumn(fontSize, pageWidth))
    // Once the page's font has loaded, its true width.
    let live = true
    void document.fonts?.ready.then(() => live && setColumnW(measureColumn(fontSize, pageWidth)))
    return () => {
      live = false
    }
  }, [fontSize, pageWidth])
  const frame = deskFit(windowW, columnW, pinnedSetting)
  return { ...frame, pinned: pinnedSetting && frame.pinRoom }
}
