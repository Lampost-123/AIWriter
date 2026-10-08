// A margin note's tether (the desk, UI overhaul phase 3): a 1px hairline in the note's kind's ink, at 40% (85% while the
// note is hovered, desk.css), from the word the note is about to the note's edge, with a small dot at the word. Drawn in
// the note's own corner (coordinates relative to its top left), so it moves with the note and never needs a layer of its
// own over the page. Pointer events pass through it.
import { tetherPath } from './anchors'

export function Tether({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }): React.JSX.Element | null {
  // Nothing to draw when the word is already at (or past) the note's edge.
  if (x2 - x1 < 6) return null
  return (
    <svg aria-hidden className="desk-tether" width={1} height={1} overflow="visible">
      <path d={tetherPath(x1, y1, x2, y2)} />
      <circle cx={x1} cy={y1} r={2} />
    </svg>
  )
}
