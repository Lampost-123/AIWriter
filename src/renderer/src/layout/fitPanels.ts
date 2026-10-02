// How wide the side panels show, so the page in the middle always keeps room to write in. Adam's
// chosen widths are kept as they are (and come back when the window is wider again); in a small
// window the open panels give up some of their width, each in proportion to what it can spare.
// Pure, so it is unit-tested.

/** The narrowest the page between the panels gets while a panel can still give up width. */
export const PAGE_MIN = 480

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
