// Where the desk's pieces go for a window size (the New look's desk layout). The page is a sheet of paper whose text
// column is Adam's page width (Settings › Appearance › Page width, in characters of his text size) with paper either
// side of it. The story's spine runs down the left edge: full (every chapter and scene, the default) while the window
// is wide enough for it and the sheet beside it, the sheet then centred in the room left; slim (the rings) when Adam
// collapses it or the window is narrower, the sheet then centred in the window, clear of the spine.
// Pure, so it is unit-tested; useDeskFrame measures the column and follows the window.
import { useEffect, useLayoutEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { useFocusMode } from '@/features/look/focusMode'

/** The slim spine: a 48px capsule 20px in from the left, 20px under the top bar, 24px above the bottom. */
export const SPINE = { left: 20, top: 20, width: 48, bottom: 24 } as const
/** The full spine: the same capsule opened out to hold the whole story. */
export const STORY = { left: 20, width: 320 } as const
/** The flyout beside the slim spine. */
export const FLYOUT = { left: 76, width: 300 } as const
/** The sheet never comes nearer the left edge than this (clear of the spine), nor the right edge than GUTTER. */
export const SHEET_LEFT_MIN = SPINE.left + SPINE.width + 16
export const GUTTER = 16
/** Where the room beside the full spine starts. */
export const STORY_RIGHT = STORY.left + STORY.width
/** The full spine stays beside the page in a window at least this wide; narrower, it shows as the slim one. */
export const FULL_FROM = 1280

/** The paper either side of the text: 58px on a large window, less on a small one (as the panels' page does). */
export function sheetPadding(windowW: number): number {
  return windowW >= 1000 ? 58 : windowW >= 800 ? 40 : 24
}

export interface DeskFrame {
  /** The window's width. */
  windowW: number
  /** The paper either side of the text column. */
  padX: number
  /** The sheet's full width at Adam's page width (it narrows if the window is smaller). */
  sheetW: number
  /** The window is wide enough for the full spine beside the page. */
  fullRoom: boolean
  /** The full spine shows: Adam hasn't collapsed it, and there is room. */
  full: boolean
  /** Where the room for the sheet starts: right of the full spine, or 0 (the whole window, clear of the slim spine). */
  roomLeft: number
  /** The least room left of the sheet, clear of the spine. */
  leftMin: number
}

/**
 * The desk for a window `windowW` wide whose text column is `columnW` px (Adam's page width), with the spine full or
 * slim as Adam last left it (`wantsFull`: it only shows full when there is room for it).
 */
export function deskFit(windowW: number, columnW: number, wantsFull: boolean): DeskFrame {
  const padX = sheetPadding(windowW)
  const sheetW = Math.round(columnW + 2 * padX)
  const fullRoom = windowW >= FULL_FROM
  const full = wantsFull && fullRoom
  return { windowW, padX, sheetW, fullRoom, full, roomLeft: full ? STORY_RIGHT : 0, leftMin: full ? STORY_RIGHT + GUTTER : SHEET_LEFT_MIN }
}

/**
 * The sheet's sides (the padding of the page's scroller, in px so it glides cleanly as the spine changes shape): centred
 * in its room, never nearer the spine than leftMin nor the window's right edge than GUTTER.
 */
export function sheetSides(frame: DeskFrame): { left: number; right: number } {
  const { windowW: w, sheetW: sheet } = frame
  if (frame.full) {
    // Centred in the room right of the full spine.
    const side = Math.max(GUTTER, (w - frame.roomLeft - sheet) / 2)
    return { left: frame.roomLeft + side, right: side }
  }
  return { left: Math.max(frame.leftMin, (w - sheet) / 2), right: Math.max(GUTTER, Math.min((w - sheet) / 2, w - sheet - frame.leftMin)) }
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

/** The spine as Adam last left it: full unless he collapsed it (Settings' layout.deskStory). */
export const useWantsFullSpine = (): boolean => useApp((s) => s.settings?.layout.deskStory !== 'slim')

/** The desk's frame now: the sheet's size and padding, and whether the spine shows full. */
export function useDeskFrame(): DeskFrame {
  const fontSize = useApp((s) => s.settings?.editor.fontSize ?? 19)
  const pageWidth = useApp((s) => s.settings?.editor.pageWidth ?? 70)
  const wantsFull = useWantsFullSpine()
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
  // In focus mode the spine steps away: the sheet is centred in the window.
  const focus = useFocusMode((s) => s.on)
  return deskFit(windowW, columnW, wantsFull && !focus)
}
