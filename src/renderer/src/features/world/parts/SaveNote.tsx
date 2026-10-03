import { Check } from '@/components/ui/icons'
import { useRef } from 'react'
import { cn } from '@/lib/cn'
import type { SaveStatus } from './saver'

/**
 * A quiet "Saved" note for autosaving forms. Writes take a few milliseconds, so
 * "Saving…" is never flashed: the note keeps showing "Saved" through later writes.
 * Its width is reserved so nothing around it moves.
 */
export function SaveNote({ status, error, className }: { status: SaveStatus; error?: string | null; className?: string }): React.JSX.Element {
  const everSaved = useRef(false)
  if (status === 'saved') everSaved.current = true
  const showSaved = status === 'saved' || (status === 'saving' && everSaved.current)
  const isError = status === 'error'
  return (
    <span
      aria-live="polite"
      title={isError && error ? error : undefined}
      className={cn(
        'inline-flex min-w-[64px] items-center justify-end gap-1 whitespace-nowrap text-[12px] transition-opacity duration-200',
        isError ? 'text-danger' : 'text-faint',
        !showSaved && !isError && 'opacity-0',
        className
      )}
    >
      {isError ? (
        'Not saved yet'
      ) : (
        <>
          <Check size={12} aria-hidden />
          Saved
        </>
      )}
    </span>
  )
}
