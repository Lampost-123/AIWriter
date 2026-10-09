// A character's medallion on the desk's relationship map: a coin in the gallery card's own colours (the same entry has
// the same colour everywhere on the desk), with its drawing from the drawing library, or Adam's own portrait.
import { useState, type ReactNode } from 'react'
import type { ID } from '@shared/types'
import { Motif } from '@/components/art/Motif'
import { entryInitial } from '@/features/world/entryLogic'
import { artHue } from '@/features/desk/world/galleryLogic'

/** The coin's face, in the gallery's colours for this character. */
export const coinFace = (id: ID): string => {
  const h = artHue('character', id)
  // The lightness and saturation are the theme's (deskMap.css: deeper on the dark desk), with the gallery's as the default.
  return `linear-gradient(162deg, hsl(${h} var(--dm-s1, 46%) var(--dm-l1, 70%)), hsl(${h} var(--dm-s2, 40%) var(--dm-l2, 47%)) 56%, hsl(${h} var(--dm-s1, 46%) var(--dm-l3, 29%)))`
}

export function Medal({
  id,
  name,
  image,
  motif,
  size,
  children
}: {
  id: ID
  name: string
  image: string | null
  motif: string | null
  /** Width in pixels. */
  size: number
  children?: ReactNode
}): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const src = image && failed !== image ? image : null
  return (
    <span aria-hidden className="dm-medal" style={{ '--s': `${size}px` } as React.CSSProperties}>
      <span className={src ? 'dm-disc has-img' : 'dm-disc'} style={{ background: coinFace(id) }}>
        {src ? (
          <img src={src} alt="" draggable={false} decoding="async" onError={() => setFailed(src)} />
        ) : motif ? (
          <Motif id={motif} size={Math.round(size * 0.64)} />
        ) : (
          entryInitial(name)
        )}
      </span>
      {children}
    </span>
  )
}
