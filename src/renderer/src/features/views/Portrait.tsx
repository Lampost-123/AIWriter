// An entry's portrait, or its first letter on a quiet disc when it has none. Characters are round;
// places, groups and items are softly square. Used on cards, hover cards, the Cast tab and the map.
import { useState } from 'react'
import type { Entry } from '@shared/types'
import { cn } from '@/lib/cn'
import { entryInitial } from '@/features/world/entryLogic'
import { KIND_INK } from '@/features/world/kindIcons'
import { useNewLook } from '@/features/look/look'
import { Motif } from '@/components/art/Motif'

export function Portrait({
  entry,
  size = 40,
  className,
  motif
}: {
  entry: Pick<Entry, 'name' | 'kind' | 'image'>
  /** Width and height in pixels. */
  size?: number
  className?: string
  /**
   * The desk (UI overhaul, D5.4): a drawing from the drawing library to show when there is no portrait, in place of the
   * first letter. Adam's own portrait always wins. Only the desk passes one, so the panels and Classic are unchanged.
   */
  motif?: string | null
}): React.JSX.Element {
  // A picture that fails to load (removed since) falls back to the letter, never a broken image.
  const [failed, setFailed] = useState<string | null>(null)
  const src = entry.image && failed !== entry.image ? entry.image : null
  // The New look: the letter in its kind's ink, on its kind's tint, in the serif.
  const isNew = useNewLook()
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden',
        isNew
          ? cn(KIND_INK[entry.kind].tile, 'font-heading font-semibold shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_22%,transparent)]')
          : 'bg-surface-2 font-medium text-muted',
        entry.kind === 'character' ? 'rounded-full' : 'rounded-md',
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} decoding="async" loading="lazy" onError={() => setFailed(src)} className="h-full w-full object-cover" />
      ) : motif ? (
        <Motif id={motif} size={Math.round(size * 0.72)} />
      ) : (
        entryInitial(entry.name)
      )}
    </span>
  )
}
