// One drawing from the desk's drawing library (components/art/motifShapes.ts), in currentColor: it takes the ink of
// wherever it sits, in every theme. A filled tone (`soft`) and small solid touches (`solid`) give it depth; `fine`
// lines are the engraved details.
//
// It comes alive a little (motifMotion.ts, motifMotion.css): hovering the card or button it sits on (data-art-hover),
// or the drawing itself, plays its small movement (the flame flickers, the boat bobs, the bell swings); `live` gives it
// its quiet idle loop where it is the one picture (the story home's cover, the dossier's portrait); `reveal` draws its
// lines in the first time that drawing shows in a session. Never with less motion; still while the window is away.
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { watchWindowForArt } from './living'
import { motifMotion } from './motifMotion'
import { MOTIF_SHAPES, type MotifShape } from './motifShapes'
import './living.css'
import './motif.css'
import './motifMotion.css'

/** SVG attribute names as React wants them. */
const ATTR: Record<string, string> = { class: 'className', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'stroke-dasharray': 'strokeDasharray', 'stroke-width': 'strokeWidth' }

/** The shapes whose lines can be drawn in (each measured as 1 long, so one dash draws it). */
const LINES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])

function draw(shapes: MotifShape[], key = ''): ReactNode[] {
  return shapes.map(([tag, attrs, kids], i) => {
    const props: Record<string, unknown> = { key: `${key}${i}` }
    for (const [k, v] of Object.entries(attrs)) props[ATTR[k] ?? k] = v
    // A line (not a filled tone, not already dashed) can draw itself in: measured as 1 long.
    if (LINES.has(tag) && attrs.class !== 'soft' && attrs.class !== 'solid' && !attrs['stroke-dasharray']) props.pathLength = 1
    return createElement(tag, props, kids ? draw(kids, `${key}${i}-`) : undefined)
  })
}

const drawn = new Map<string, ReactNode[]>()

/** Drawings whose lines have drawn themselves in this session (each does once). */
const revealed = new Set<string>()
/** How long the drawing-in takes, its tones included (motifMotion.css, aw-draw and aw-fill). */
const DRAW_MS = 1300

/** A small four-pointed spark, for a glint. */
const spark = (x: number, y: number, r = 3.6): string =>
  `M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}z`

export function Motif({
  id,
  size = 24,
  className,
  title,
  live = false,
  reveal = false
}: {
  id: string
  size?: number | string
  className?: string
  title?: string
  /** Its quiet idle loop (where it is the one picture). */
  live?: boolean
  /** Draw its lines in, the first time this drawing shows in the session. */
  reveal?: boolean
}): React.JSX.Element | null {
  const shapes = MOTIF_SHAPES[id]
  const [drawing, setDrawing] = useState(() => {
    if (!reveal || !shapes || revealed.has(id)) return false
    revealed.add(id)
    return true
  })
  // Drawn in (about 1.2 seconds): its parts' own movements take over.
  useEffect(() => {
    if (!drawing) return
    const t = setTimeout(() => setDrawing(false), DRAW_MS)
    return () => clearTimeout(t)
  }, [drawing])
  if (!shapes) return null
  watchWindowForArt()
  let kids = drawn.get(id)
  if (!kids) {
    kids = draw(shapes)
    drawn.set(id, kids)
  }
  const motion = motifMotion(id)
  const glint = motion.glint && (motion.idle.includes('glint') || motion.hover.includes('glint')) ? motion.glint : null
  return (
    <svg
      className={cn('aw-motif la', live && 'lp', className)}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-motif={id}
      data-idle={motion.idle.join(' ') || undefined}
      data-hover={motion.hover.join(' ')}
      data-live={live || undefined}
      data-draw={drawing || undefined}
    >
      {kids}
      {glint ? <path className="aw-glint" d={spark(glint[0], glint[1])} /> : null}
    </svg>
  )
}
