// Settings › Appearance in the New look: a small window beside the choices that changes as they do. It is drawn with
// the theme's own colours (the theme and accent are painted on the whole window at once, so it simply follows them),
// in the layout chosen (the desk with its spine and sheet, the panels with their rail and list, or Classic), and its
// page shows a few lines of prose at Adam's real text size, line spacing, page width and paragraph style, scaled to fit.
// Every change eases across (the base speed), at once with less motion.
import { useLayoutEffect, useRef, useState } from 'react'
import type { EditorSettings } from '@shared/types'
import type { Arrangement, Look } from '@shared/contracts/look'
import { cn } from '@/lib/cn'

/** The page's sample: invented lines in the sample world's voice (never anything of Adam's). */
const SAMPLE = [
  'The tide had turned an hour before the ferry was due, and Wren felt it in the lamp room before she saw it on the water.',
  'She trimmed the wick square across, the way her father had taught her, and gave the old lamp a kind word for luck.',
  '“Right, then,” she said, and lit it.'
]

export function AppearancePreview({
  look,
  arrangement,
  editor
}: {
  look: Look
  arrangement: Arrangement
  editor: Pick<EditorSettings, 'fontSize' | 'lineHeight' | 'pageWidth' | 'paragraphStyle'>
}): React.JSX.Element {
  const layout = look === 'classic' ? 'classic' : arrangement
  // The page's words at their real size, scaled to the little sheet's width.
  const sheet = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(300)
  useLayoutEffect(() => {
    const el = sheet.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom(el.clientWidth))
    ro.observe(el)
    setRoom(el.clientWidth)
    return () => ro.disconnect()
  }, [layout])
  // The column as the editor makes it: about `pageWidth` characters of Literata at `fontSize` (0.5em a character).
  const column = editor.pageWidth * editor.fontSize * 0.5
  const scale = Math.min(0.62, (room - 28) / column)
  const book = editor.paragraphStyle === 'book'
  return (
    <figure aria-label="Preview" data-preview-layout={layout} className="ap-window">
      <div className={cn('ap-frame', `ap-${layout}`)}>
        {/* The top bar: the rooms on the desk, a plain bar otherwise. */}
        <div className="ap-top">
          <span className="ap-dot" />
          {layout === 'desk' ? (
            <span className="ap-rooms">
              <i className="is-on" />
              <i />
              <i />
              <i />
            </span>
          ) : null}
        </div>
        {layout === 'desk' ? (
          <span className="ap-spine">
            {[1, 1, 0, 1, 1, 1].map((r, i) => (r ? <i key={i} /> : <b key={i} />))}
          </span>
        ) : layout === 'panels' ? (
          <>
            <span className="ap-rail">
              <i className="is-on" />
              <i />
              <i />
            </span>
            <span className="ap-list">
              <i className="w-[70%]" />
              <i className="is-on" />
              <i />
              <i className="w-[80%]" />
              <i />
            </span>
          </>
        ) : (
          <span className="ap-binder">
            <i className="w-[70%]" />
            <i className="is-on" />
            <i />
            <i className="w-[80%]" />
          </span>
        )}
        <div ref={sheet} className="ap-sheet">
          <div
            className="ap-words"
            style={{
              width: column,
              fontSize: editor.fontSize,
              lineHeight: editor.lineHeight,
              transform: `scale(${scale})`
            }}
          >
            <p className="ap-eyebrow">Chapter One · The Night Ferry</p>
            <p className="ap-title">Lighting the Lamp</p>
            {SAMPLE.map((p, i) => (
              <p key={i} className="ap-para" style={book ? { textIndent: i ? '1.5em' : 0, marginTop: 0 } : { marginTop: i ? '0.9em' : 0 }}>
                {p}
              </p>
            ))}
          </div>
        </div>
        {layout === 'desk' ? (
          <span className="ap-dock">
            <i />
            <b />
          </span>
        ) : null}
      </div>
      <figcaption className="ap-caption">
        {layout === 'desk' ? 'Desk' : layout === 'panels' ? 'Panels' : 'Classic'} · {editor.fontSize}px text · {editor.pageWidth} characters a line ·{' '}
        {book ? 'book paragraphs' : 'spaced paragraphs'}
      </figcaption>
    </figure>
  )
}
