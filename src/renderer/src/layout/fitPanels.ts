// How wide the side panels show, so the page in the middle always keeps room to write in. Adam's
// chosen widths are kept as they are (and come back when the window is wider again); in a small
// window the open panels give up some of their width, each in proportion to what it can spare.
// Pure, so it is unit-tested.

/** The narrowest the page between the panels gets while a panel can still give up width (see pageMinFor for the writing page). */
export const PAGE_MIN = 480

// ----- How narrow the writing page may get -----

/** The fewest characters a line of prose should hold in a small window. */
export const LINE_CHARS = 55
/** Lines break between words, so a line needs room for about one more word than it holds. */
const WRAP_SLACK = 7
/** How wide an average character of English prose is in the prose font (Literata), in ems; measured. */
export const PROSE_CHAR_EM = 0.472
/** How wide Literata's "0" is (CSS's ch unit, which the page width setting is in), in ems; measured. */
export const PROSE_CH_EM = 0.631
/** The page's padding either side when narrow (px-6), and its scroll bar. */
export const PAGE_PADDING = 2 * 24 + 10
/** From this page width the padding may be wider (px-10, SceneView's container query; with a scroll bar it starts 10 px later). */
export const WIDE_PAGE = 700
/** The page's padding either side from WIDE_PAGE (px-10), and its scroll bar. */
export const WIDE_PAGE_PADDING = 2 * 40 + 10

/** The room the words need for about 55 characters a line at Adam's text size, never more than the page width setting gives them. */
export function proseMinFor(fontSize: number, pageWidthCh = 70): number {
  return Math.round(Math.min((LINE_CHARS + WRAP_SLACK) * PROSE_CHAR_EM, pageWidthCh * PROSE_CH_EM) * fontSize)
}

/**
 * The narrowest the writing page gets while the panels beside it can give up width: room for about
 * 55 characters a line at Adam's text size (about 620 px at the default 19 px), plus the padding.
 * Never more than the page's own column at its widest (the page width setting), which is all it uses.
 * Large text needs a page wide enough for the wider padding too, so the words still get their room.
 */
export function pageMinFor(fontSize: number, pageWidthCh = 70): number {
  const prose = proseMinFor(fontSize, pageWidthCh)
  return prose + PAGE_PADDING < WIDE_PAGE ? prose + PAGE_PADDING : prose + WIDE_PAGE_PADDING
}

/**
 * True when the binder should float over the page instead of sitting beside it: the scene panel is
 * open and, even with both panels at their narrowest, the page wouldn't keep its room. The binder
 * then shows only when asked for, over the page; Adam's saved layout is left as it is.
 */
export function binderFloats(windowWidth: number, binderFloor: number, scenePanel: Omit<PanelSize, 'width'>, pageMin: number): boolean {
  return scenePanel.open && windowWidth - binderFloor - scenePanel.floor < pageMin
}

export interface PanelSize {
  open: boolean
  /** The width Adam chose. */
  width: number
  /** The narrowest the panel is squeezed to in a small window. */
  floor: number
}

/** The widths the left and right panels show at in a window `windowWidth` wide (0 when closed). */
export function fitPanels(windowWidth: number, left: PanelSize, right: PanelSize, pageMin = PAGE_MIN): { left: number; right: number } {
  const l = left.open ? left.width : 0
  const r = right.open ? right.width : 0
  const over = l + r + pageMin - windowWidth
  if (over <= 0) return { left: l, right: r }
  const spareL = left.open ? Math.max(0, l - left.floor) : 0
  const spareR = right.open ? Math.max(0, r - right.floor) : 0
  const spare = spareL + spareR
  if (spare <= 0) return { left: l, right: r }
  const take = Math.min(over, spare)
  const fromL = Math.round((take * spareL) / spare)
  return { left: l - fromL, right: r - (take - fromL) }
}

/** The widest a panel can be dragged to while the other panel shows at `other` px, keeping the page's room. */
export function dragMax(windowWidth: number, other: number, min: number, max: number, pageMin = PAGE_MIN): number {
  return Math.max(min, Math.min(max, windowWidth - other - pageMin))
}

/**
 * The width to save for a panel Adam dragged to `shown` px, so that it still shows at `shown` once
 * the panels are fitted to the window again (rather than being squeezed back from where he let go).
 * The other panel keeps its own chosen width. `max` is the panel's widest.
 */
export function chosenWidthFor(
  shown: number,
  windowWidth: number,
  side: 'left' | 'right',
  self: Omit<PanelSize, 'width'>,
  other: PanelSize,
  max: number,
  pageMin = PAGE_MIN
): number {
  const at = (width: number): number => {
    const me = { ...self, width }
    return fitPanels(windowWidth, side === 'left' ? me : other, side === 'left' ? other : me, pageMin)[side]
  }
  // What shows never falls as the chosen width grows, so the smallest width that shows enough is found by halving.
  if (shown >= max) return max
  let lo = shown
  let hi = max
  if (at(lo) >= shown) return lo
  if (at(hi) < shown) return hi
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (at(mid) >= shown) hi = mid
    else lo = mid + 1
  }
  // Rounding can step past `shown`: keep whichever width shows nearer to it.
  return lo > shown && shown - at(lo - 1) < at(lo) - shown ? lo - 1 : lo
}
