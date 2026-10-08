// Where the desk's pieces go for a window size (the New look's desk layout). The page is a sheet of paper whose text
// column is Adam's page width (Settings › Appearance › Page width, in characters of his text size) with paper either
// side of it. The story's spine runs down the left edge: full (every chapter and scene, the default) while the window
// is wide enough for it, slim (the rings) when Adam collapses it or the window is narrower. The scene drawer runs down
// the right edge when open: beside the page while the spine, the sheet and the drawer all fit, else over the page's
// edge. The sheet is centred in the room between them, never nearer the spine than leftMin. The margin notes (phase 3)
// take a column right of the sheet when the window has room for one with the page still about in the middle (it moves
// left of its centre by MARGIN_SHIFT at most); without that room they fold into tabs on the sheet's edge.
// Pure, so it is unit-tested; useDeskFrame measures the column and follows the window.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/store'
import { useFocusMode } from '@/features/look/focusMode'
import { keyboardDriven } from '@/features/look/motion'

/** The slim spine: a 48px capsule 20px in from the left, 20px under the top bar, 24px above the bottom. */
export const SPINE = { left: 20, top: 20, width: 48, bottom: 24 } as const
/** The full spine: the same capsule opened out to hold the whole story. */
export const STORY = { left: 20, width: 320 } as const
/** The flyout beside the slim spine. */
export const FLYOUT = { left: 76, width: 300 } as const
/** The scene drawer: down the right edge, with the spine's insets, so the two read as a pair. */
export const DRAWER = { right: 20, top: 20, bottom: 24 } as const
/** The sheet never comes nearer the left edge than this (clear of the spine), nor the right edge than GUTTER. */
export const SHEET_LEFT_MIN = SPINE.left + SPINE.width + 16
export const GUTTER = 16
/** Where the room beside the full spine starts. */
export const STORY_RIGHT = STORY.left + STORY.width
/** The full spine stays beside the page in a window at least this wide; narrower, it shows as the slim one. */
export const FULL_FROM = 1280

/**
 * The margin notes' column (phase 3): 300px slips overlapping the sheet's right edge by 16px, with the gutter after them.
 * The room the page keeps on its right for them is MARGIN_RESERVE; without it the notes fold into tabs on the sheet's edge.
 */
export const MARGIN = { width: 300, overlap: 16 } as const
export const MARGIN_RESERVE = MARGIN.width - MARGIN.overlap + GUTTER
/** The furthest the sheet moves left of its centre to make room for the margin column. */
export const MARGIN_SHIFT = 32
/** The page's scrollbar room inside the desk's scroll area (kept whether it scrolls or not). */
const SCROLLBAR = 12

/** The paper either side of the text: 58px on a large window, less on a small one (as the panels' page does). */
export function sheetPadding(windowW: number): number {
  return windowW >= 1000 ? 58 : windowW >= 800 ? 40 : 24
}

/** The drawer's width: wider on a larger window (440px at 1920, 480 at most), never under 380 (its five tabs). */
export function drawerWidth(windowW: number): number {
  return Math.max(380, Math.min(480, Math.round(windowW * 0.23)))
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
  /** The scene drawer's width. */
  drawerW: number
  /** The drawer is open beside the page (the sheet keeps clear of it); open but not docked, it lies over the page. */
  drawerDocked: boolean
  /** How much of the window's right the docked drawer takes (0 when it isn't docked). */
  roomRight: number
  /**
   * Where the margin notes go: a column beside the sheet when there is room for it, else tabs on the sheet's right edge
   * that open each note as a pop-up. (With the drawer docked beside the page the notes step away: tabs.)
   */
  margin: 'column' | 'tabs'
  /** The least room right of the sheet: the margin column's, the docked drawer's and its gutter, or the gutter's. */
  rightMin: number
}

/**
 * The desk for a window `windowW` wide whose text column is `columnW` px (Adam's page width), with the spine full or
 * slim as Adam last left it (`wantsFull`: it only shows full when there is room for it), and the drawer open or not.
 */
export function deskFit(windowW: number, columnW: number, wantsFull: boolean, drawerOpen = false): DeskFrame {
  const padX = sheetPadding(windowW)
  const sheetW = Math.round(columnW + 2 * padX)
  const fullRoom = windowW >= FULL_FROM
  const full = wantsFull && fullRoom
  const leftMin = full ? STORY_RIGHT + GUTTER : SHEET_LEFT_MIN
  const drawerW = drawerWidth(windowW)
  const drawerSpace = drawerW + DRAWER.right
  // Docked only while the sheet still fits at its full width between the spine and the drawer.
  const drawerDocked = drawerOpen && windowW - leftMin - drawerSpace - GUTTER >= sheetW
  const roomLeft = full ? STORY_RIGHT : 0
  const roomRight = drawerDocked ? drawerSpace : 0
  // The column needs its room, and the page stays the middle of the desk: it moves left of its centre for the column
  // by MARGIN_SHIFT at most (the mockup's 20px or so).
  const centre = Math.max(leftMin, roomLeft + Math.max(0, (windowW - roomLeft - sheetW) / 2))
  const shift = centre - Math.min(centre, windowW - sheetW - MARGIN_RESERVE)
  const column = !drawerDocked && windowW - SCROLLBAR >= leftMin + sheetW + MARGIN_RESERVE && shift <= MARGIN_SHIFT
  const rightMin = column ? MARGIN_RESERVE : roomRight + GUTTER
  return { windowW, padX, sheetW, fullRoom, full, roomLeft, leftMin, drawerW, drawerDocked, roomRight, margin: column ? 'column' : 'tabs', rightMin }
}

/**
 * The sheet's sides (the padding of the page's scroller, in px so it glides cleanly as the spine or the drawer comes and
 * goes): centred in the room between them, never nearer the spine than leftMin nor the drawer (or the window's right
 * edge) than GUTTER. With too little room, the sheet narrows.
 */
export function sheetSides(frame: DeskFrame): { left: number; right: number } {
  const { windowW: w, sheetW: sheet, roomLeft, roomRight } = frame
  const free = w - roomLeft - roomRight - sheet
  // With the margin column, the sheet moves left of its centre as far as the column needs (MARGIN_SHIFT at most).
  const left = Math.max(frame.leftMin, Math.min(roomLeft + Math.max(0, free / 2), w - sheet - frame.rightMin))
  return { left, right: Math.max(frame.rightMin, w - left - sheet) }
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

/** The scene drawer is open on the writing page (the scene panel, or Ask the world). */
export const useDrawerOpen = (): boolean =>
  useApp((s) => s.view.kind === 'write' && (!!s.sceneId || s.askOpen) && (!!s.settings?.layout.inspectorOpen || s.askOpen))

/** The desk's frame now: the sheet's size and padding, whether the spine shows full and the drawer beside the page. */
export function useDeskFrame(): DeskFrame {
  const fontSize = useApp((s) => s.settings?.editor.fontSize ?? 19)
  const pageWidth = useApp((s) => s.settings?.editor.pageWidth ?? 70)
  const wantsFull = useWantsFullSpine()
  const drawerOpen = useDrawerOpen()
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
  // In focus mode the spine steps away and the drawer lies over the page's edge: the sheet is centred in the window.
  const focus = useFocusMode((s) => s.on)
  return deskFit(windowW, columnW, wantsFull && !focus, drawerOpen && !focus)
}

/** How long the sheet's glide may take at most (the spine opening out, 280ms), with a little to spare. */
const GLIDE_FOR = 340

/**
 * The sheet's glide as the spine opens out or collapses, or the drawer docks or goes: a CSS transition for its sides,
 * given in the very render that moves them (so nothing measured meanwhile can make it jump), and kept until it ends.
 * The spine goes out in 280ms and back in 140ms, the drawer in 220ms and out in 140ms, on the drawer's curve. A change
 * from the keyboard, or a window being resized, moves the sheet at once (and less motion makes every speed 0).
 */
export function useSheetGlide(frame: DeskFrame): string | undefined {
  const prev = useRef({ full: frame.full, drawer: frame.drawerDocked })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [glide, setGlide] = useState<string | undefined>(undefined)
  const spine = prev.current.full !== frame.full
  const drawer = prev.current.drawer !== frame.drawerDocked
  const speed = spine ? (frame.full ? 'var(--dur-view)' : 'var(--dur-exit)') : frame.drawerDocked ? 'var(--dur-base)' : 'var(--dur-exit)'
  const now = (spine || drawer) && !keyboardDriven() ? `padding ${speed} var(--motion-drawer)` : undefined
  useLayoutEffect(() => {
    if (!spine && !drawer) return
    prev.current = { full: frame.full, drawer: frame.drawerDocked }
    setGlide(now)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setGlide(undefined), GLIDE_FOR)
  })
  useEffect(() => () => clearTimeout(timer.current), [])
  return spine || drawer ? now : glide
}
