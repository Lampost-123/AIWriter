// The questions Beat by beat asks before writing (milestone 4): where the beats go on a scene that
// already has text (as Generate asks, with the same answers and keys), and what is missing first: beats
// on the scene card, or a writer model. Shown under the toolbar button, or over the bar's Write button.
import * as P from '@radix-ui/react-popover'
import { ArrowDownToLine, ListOrdered, RefreshCw } from '@/components/ui/icons'
import { useId, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { answer, dismissQuestion, openCardAtBeats } from './flow'
import { useBeats, type BeatQuestion } from './session'

/**
 * One of the two answers to "This scene already has text", as Generate shows them. Asked from the
 * keyboard, the answer that has the keyboard always shows it, so Enter never picks one Adam can't see.
 */
function ModeChoice({
  mode,
  icon,
  label,
  hint,
  keyboard,
  onClick
}: {
  mode: 'resume' | 'replace' | 'add'
  icon: ReactNode
  label: string
  hint: string
  keyboard: boolean
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
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2',
        keyboard && 'focus:outline-2 focus:outline-offset-2 focus:outline-[var(--focus)]'
      )}
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

/** A question about to start Beat by beat, in a small panel beside what asked it. */
export function QuestionPanel({ question, side }: { question: BeatQuestion; side: 'top' | 'bottom' }): React.JSX.Element {
  /** Where the keyboard was when the question opened, so closing it puts the keyboard back. */
  const before = useRef<HTMLElement | null>(null)
  const { kind, byKey, sceneId, resume } = question
  return (
    <P.Portal>
      <P.Content
        side={side}
        align="end"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => {
          // From the keyboard, the likely answer takes the keyboard (Add below, as for Ctrl+G); from a
          // click, the panel does, so nothing looks picked before Adam picks it.
          e.preventDefault()
          const here = document.activeElement
          before.current = here instanceof HTMLElement && !here.closest('[data-radix-popper-content-wrapper]') ? here : null
          const panel = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
          const first = byKey ? panel?.querySelector<HTMLElement>(kind === 'choose' ? (resume ? '[data-choice="resume"]' : '[data-choice="add"]') : '[data-first]') : panel
          ;(first ?? panel)?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(e) => {
          // Back to where the keyboard was, unless it has gone somewhere since (the bar's box, the card).
          e.preventDefault()
          if (useBeats.getState().question) return
          const back = before.current
          before.current = null
          const here = document.activeElement
          if (back?.isConnected && (!here || here === document.body)) back.focus({ preventScroll: true })
        }}
        onKeyDown={(e) => {
          // Up and down move between the answers.
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          const answers = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-choice]')]
          if (!answers.length) return
          e.preventDefault()
          const at = answers.indexOf(document.activeElement as HTMLElement)
          const step = e.key === 'ArrowDown' ? 1 : answers.length - 1
          const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : answers.length - 1) : (at + step) % answers.length
          answers[next].focus()
        }}
        className={cn(
          'z-50 rounded-xl border border-line bg-surface p-4 shadow-pop focus:outline-none data-[state=open]:animate-pop-in',
          kind === 'choose' ? 'w-[340px]' : 'w-[320px]'
        )}
      >
        {kind === 'choose' ? (
          <>
            <h3 className="text-[13.5px] font-semibold text-fg">This scene already has text</h3>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              {resume ? 'Carry on with its beats, or start a new draft?' : 'Where should the new draft go?'}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {resume ? (
                <ModeChoice
                  mode="resume"
                  icon={<ListOrdered size={14} />}
                  label={`Carry on from beat ${resume.written + 1} of ${resume.of}`}
                  hint={
                    resume.written === 1
                      ? 'Beat 1 stays as it is, and the next beat follows it.'
                      : `Beats 1 to ${resume.written} stay as they are, and the next beat follows them.`
                  }
                  keyboard={byKey}
                  onClick={() => answer('resume')}
                />
              ) : null}
              <ModeChoice
                mode="replace"
                icon={<RefreshCw size={14} />}
                label="Replace it"
                hint="The new draft takes its place."
                keyboard={byKey}
                onClick={() => answer('replace')}
              />
              <ModeChoice
                mode="add"
                icon={<ArrowDownToLine size={15} />}
                label="Add below"
                hint="The new draft goes below a scene break."
                keyboard={byKey}
                onClick={() => answer('add')}
              />
            </div>
            <p className="mt-3 text-[12px] text-faint">Either way, {modKey()}+Z takes the beats out one at a time.</p>
          </>
        ) : kind === 'no-beats' ? (
          <>
            <h3 className="text-[13.5px] font-semibold text-fg">This scene's card has no beats yet</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Beat by beat writes the scene one beat at a time, from the beats on its card, and pauses after each so you can steer the next.
              Add the beats first: the things that must happen, in order.
            </p>
            <Button
              data-first
              variant="primary"
              size="sm"
              className="mt-3"
              icon={<ListOrdered size={14} />}
              onClick={() => openCardAtBeats(sceneId)}
            >
              Open the scene card
            </Button>
          </>
        ) : (
          <>
            <h3 className="text-[13.5px] font-semibold text-fg">Choose a writer model first</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              AI Write needs a model to write with. Connect OpenRouter or another provider, then pick a writer model.
            </p>
            <Button
              data-first
              variant="primary"
              size="sm"
              className="mt-3"
              onClick={() => {
                dismissQuestion()
                useApp.getState().navigate({ kind: 'settings', tab: 'models' })
              }}
            >
              Open Settings › Models
            </Button>
          </>
        )}
      </P.Content>
    </P.Portal>
  )
}
