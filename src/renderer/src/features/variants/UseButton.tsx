// "Use this one" (a column's variant) and "Use the picked paragraphs". A scene with no words takes the
// text straight away; a scene with text first asks, in Generate's own words, whether the new text
// replaces it or goes below it.
import * as P from '@radix-ui/react-popover'
import { ArrowDownToLine, RefreshCw } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import type { ID } from '@shared/types'
import { Button, toast, type ButtonProps } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { PopoverPanel } from '@/features/generate/parts'
import type { UseMode, VariantBlock } from './merge'
import { putInScene, sceneHasText, sceneNotReady } from './use'

/** One of the two answers to "This scene already has text": a name, and a faint line saying what it does. */
function Choice({
  mode,
  icon,
  label,
  hint,
  onClick
}: {
  mode: UseMode
  icon: ReactNode
  label: string
  hint: string
  onClick: () => void
}): React.JSX.Element {
  const id = useId()
  return (
    <button
      type="button"
      data-choice={mode}
      onClick={onClick}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      className="group flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2"
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted transition-colors duration-150 group-hover:bg-surface-3 group-hover:text-fg"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-[13px] font-medium leading-5 text-fg">
          {label}
        </span>
        <span id={`${id}-hint`} className="block text-[12px] leading-[18px] text-faint">
          {hint}
        </span>
      </span>
    </button>
  )
}

export function UseButton({
  sceneId,
  blocks,
  what,
  plural,
  generationId,
  onUsed,
  align,
  children,
  className,
  ...button
}: Omit<ButtonProps, 'onClick'> & {
  sceneId: ID
  /** The text to put in, read when Adam picks (so a column still filling gives what it has then). */
  blocks: () => VariantBlock[]
  /** Names the text in the message afterwards ("Variant 2"). */
  what: string
  plural?: boolean
  generationId?: ID | null
  onUsed?: () => void
  /** Which edge of the button the question lines up with: its right edge unless said. */
  align?: 'start' | 'end'
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  // Quick (no spinner), but a second press while it goes in does nothing.
  const busy = useRef(false)

  const use = async (mode: UseMode): Promise<void> => {
    if (busy.current) return
    setAsking(false)
    busy.current = true
    try {
      if (await putInScene(sceneId, blocks(), mode, { what, plural, generationId })) onUsed?.()
    } finally {
      busy.current = false
    }
  }

  const click = (): void => {
    const notReady = sceneNotReady(sceneId)
    if (notReady) {
      toast(notReady)
      return
    }
    if (sceneHasText(sceneId)) setAsking(true)
    else void use('replace')
  }

  return (
    <P.Root open={asking} onOpenChange={(o) => !o && setAsking(false)}>
      <P.Anchor asChild>
        <Button {...button} className={cn(className)} onClick={click}>
          {children}
        </Button>
      </P.Anchor>
      {asking ? (
        <PopoverPanel
          className="w-[340px]"
          align={align}
          onOpenAutoFocus={(e) => {
            // The panel takes the keyboard (nothing looks picked before Adam picks); Tab or the arrows reach the answers.
            e.preventDefault()
            if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus({ preventScroll: true })
          }}
          onKeyDown={(e) => {
            // Up and down move between the two answers.
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            const answers = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-choice]')]
            if (!answers.length) return
            e.preventDefault()
            const at = answers.indexOf(document.activeElement as HTMLElement)
            const step = e.key === 'ArrowDown' ? 1 : answers.length - 1
            const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : answers.length - 1) : (at + step) % answers.length
            answers[next].focus()
          }}
        >
          <h3 className="text-[13.5px] font-semibold text-fg">This scene already has text</h3>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">Where should the new draft go?</p>
          <div className="mt-3 flex flex-col gap-2">
            <Choice
              mode="replace"
              icon={<RefreshCw size={14} />}
              label="Replace it"
              hint="The new draft takes its place."
              onClick={() => void use('replace')}
            />
            <Choice
              mode="add"
              icon={<ArrowDownToLine size={15} />}
              label="Add below"
              hint="The new draft goes below a scene break."
              onClick={() => void use('add')}
            />
          </div>
          <p className="mt-3 text-[12px] text-faint">Either way, {modKey()}+Z undoes it.</p>
        </PopoverPanel>
      ) : null}
    </P.Root>
  )
}
