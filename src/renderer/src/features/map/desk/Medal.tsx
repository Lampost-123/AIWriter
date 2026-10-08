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
  return `linear-gradient(162deg, hsl(${h} 46% 70%), hsl(${h} 40% 47%) 56%, hsl(${h} 46% 29%))`
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
      <span className="dm-disc" style={{ background: coinFace(id) }}>
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
