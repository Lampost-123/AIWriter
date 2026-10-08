// Words fading in as the AI writes them (UI overhaul, "the AI planning pages"): while a suggestion streams, each piece
// of text that arrives is wrapped for a moment in a span that fades it in (opacity only, 160ms; it never moves), then
// joins the plain text. As in the page (features/editor/arrival.ts), a piece's mark goes once its fade has played, so
// nothing replays when the text is drawn again. When nothing is streaming it is plain text. With less motion, or on the
// panels and Classic (planning.css only fades on the desk), the words simply appear.
import { useRef } from 'react'
import { freshPieces, type Fresh } from './planLogic'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function FreshText({ text, live }: { text: string; live: boolean }): React.JSX.Element {
  // Text that is already there when it first shows doesn't fade, unless it is arriving now.
  const state = useRef<Fresh>(live ? { text: '', marks: [] } : { text, marks: [] })
  const pieces = freshPieces(state.current, text, live, now())
  state.current = pieces.state
  return (
    <>
      {pieces.parts.map((p) =>
        p.fresh ? (
          <span key={p.start} className="plan-fresh">
            {p.text}
          </span>
        ) : (
          p.text
        )
      )}
    </>
  )
}
