// A portrait Adam can change: click to choose a picture, or drop one on it. Removing it is
// undoable from the toast. The picture is made small first (lib/image.ts) and kept in the world.
import { ImagePlus, Trash2 } from '@/components/ui/icons'
import { useRef, useState } from 'react'
import type { Entry } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { firstPicture, preparePortrait, type PreparedImage } from '@/lib/image'
import { useApp } from '@/lib/store'
import { Portrait } from './Portrait'

/** The current picture's bytes, so removing it can be undone. */
async function currentPicture(entry: Pick<Entry, 'image'>): Promise<PreparedImage | null> {
  if (!entry.image) return null
  try {
    const res = await fetch(entry.image)
    if (!res.ok) return null
    const blob = await res.blob()
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type }
  } catch {
    return null
  }
}

export function PortraitDrop({
  entry,
  size = 96,
  onChange,
  className,
  motif,
  live = false
}: {
  entry: Pick<Entry, 'id' | 'name' | 'kind' | 'image'>
  size?: number
  /** The desk: the entry's drawing, shown while it has no portrait (see Portrait). */
  motif?: string | null
  /** The drawing's quiet idle loop (see Portrait). */
  live?: boolean
  /** Called with the entry as saved, once the picture is in place (or removed). */
  onChange?: (entry: Entry) => void
  className?: string
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const bump = useApp((s) => s.bumpEntries)

  const save = async (image: PreparedImage | null): Promise<Entry> => {
    const saved = await api.setEntryImage(entry.id, image)
    bump()
    onChange?.(saved)
    return saved
  }

  const use = async (file: File | null): Promise<void> => {
    if (!file || busy) return
    setBusy(true)
    try {
      await save(await preparePortrait(file))
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const was = await currentPicture(entry)
    try {
      await save(null)
      toast('Picture removed.', was ? { action: { label: 'Undo', run: () => void save(was).catch((e: Error) => toast(e.message, { tone: 'danger' })) } } : {})
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  const label = entry.image ? `Change the picture of ${entry.name}` : `Add a picture of ${entry.name}`
  return (
    <div className={cn('group relative shrink-0', className)} style={{ width: size, height: size }}>
      <button
        type="button"
        aria-label={label}
        title={`${label} (or drop one here)`}
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void use(firstPicture(e.dataTransfer.files))
        }}
        className={cn(
          'relative block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          entry.kind === 'character' ? 'rounded-full' : 'rounded-md'
        )}
      >
        <Portrait entry={entry} size={size} motif={motif} live={live} className={cn('transition-opacity duration-150', busy && 'opacity-60')} />
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100',
            entry.kind === 'character' ? 'rounded-full' : 'rounded-md',
            (over || busy) && 'opacity-100'
          )}
        >
          <ImagePlus size={Math.max(14, Math.round(size / 4))} />
        </span>
      </button>
      {entry.image ? (
        <button
          type="button"
          aria-label={`Remove the picture of ${entry.name}`}
          title="Remove the picture"
          onClick={() => void remove()}
          className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-muted opacity-0 shadow-sm transition-opacity duration-150 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void use(firstPicture(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}
