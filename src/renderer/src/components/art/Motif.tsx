// One drawing from the desk's drawing library (components/art/motifShapes.ts), in currentColor: it takes the ink of
// wherever it sits, in every theme. A filled tone (`soft`) and small solid touches (`solid`) give it depth; `fine`
// lines are the engraved details.
import { createElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { MOTIF_SHAPES, type MotifShape } from './motifShapes'
import './motif.css'

/** SVG attribute names as React wants them. */
const ATTR: Record<string, string> = { class: 'className', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'stroke-dasharray': 'strokeDasharray', 'stroke-width': 'strokeWidth' }

function draw(shapes: MotifShape[], key = ''): ReactNode[] {
  return shapes.map(([tag, attrs, kids], i) => {
    const props: Record<string, unknown> = { key: `${key}${i}` }
    for (const [k, v] of Object.entries(attrs)) props[ATTR[k] ?? k] = v
    return createElement(tag, props, kids ? draw(kids, `${key}${i}-`) : undefined)
  })
}

const drawn = new Map<string, ReactNode[]>()

export function Motif({ id, size = 24, className, title }: { id: string; size?: number | string; className?: string; title?: string }): React.JSX.Element | null {
  const shapes = MOTIF_SHAPES[id]
  if (!shapes) return null
  let kids = drawn.get(id)
  if (!kids) {
    kids = draw(shapes)
    drawn.set(id, kids)
  }
  return (
    <svg
      className={cn('aw-motif', className)}
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
    >
      {kids}
    </svg>
  )
}
