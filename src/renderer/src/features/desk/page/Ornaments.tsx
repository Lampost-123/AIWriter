// The desk page's small ornaments: the ribbon bookmark hanging from the sheet's top edge, and the endmark under the
// scene's last line (a fleuron between two rules). Drawn, not text, so they never take part in the scene's words.
// (The scene break inside the text is drawn by layout/desk/desk.css on the editor's own <hr>.)

/** The ribbon bookmark: a notched band of red cloth over the sheet's top edge, near its right corner. */
export function Ribbon(): React.JSX.Element {
  return (
    <span aria-hidden className="desk-ribbon pointer-events-none absolute top-0 z-[2] h-[66px] w-[22px]">
      <span className="desk-ribbon-cloth block h-full w-full" />
    </span>
  )
}

/** The endmark: where the scene's words end. */
export function Endmark(): React.JSX.Element {
  return (
    <div aria-hidden className="desk-endmark flex justify-center pt-7 text-faint">
      <svg width={72} height={16} viewBox="0 0 72 16" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round">
        <path d="M6 8h18M48 8h18" />
        <path d="M24 8c2.6-3.4 5.4-4.6 8.2-4.2M48 8c-2.6-3.4-5.4-4.6-8.2-4.2M24 8c2.6 3.4 5.4 4.6 8.2 4.2M48 8c-2.6 3.4-5.4 4.6-8.2 4.2" />
        <path d="M36 4.6l3.4 3.4-3.4 3.4-3.4-3.4z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}
