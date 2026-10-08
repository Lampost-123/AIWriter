// The editor chat's question with options (ask_user, lab switch ASKUSER) under its answer: the question, an option
// button each (the one the chat recommends marked so), and Other… for an answer in his own words, which takes the
// keyboard to the box. One pick sends at once; with several allowed, the options toggle and Send sends them. The pick
// goes as the next question in the chat (askStore.pickChoice), and once it has, the options show which were picked
// (read back from that question, so a chat opened again shows it too).
import { useId, useState } from 'react'
import type { AskChoice } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { Check, CircleHelp } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { pickChoice, requestBoxFocus, type AskPlace } from './askStore'
import { pickedOf } from './askChoice'

export function Choice({
  generationId,
  choice,
  place,
  answeredBy,
  canPick
}: {
  generationId: ID
  choice: AskChoice
  place: AskPlace
  /** The question asked after this answer, if one was: the choice is answered. */
  answeredBy: string | undefined
  /** Options can be picked now (the chat's last answer, nothing being answered). */
  canPick: boolean
}): React.JSX.Element {
  const headingId = useId()
  const [toggled, setToggled] = useState<number[]>([])
  const answered = answeredBy !== undefined
  const open = !answered && canPick
  const picked = answered ? pickedOf(choice, answeredBy) : []
  const multi = !!choice.multi

  const press = (i: number): void => {
    if (!open) return
    if (!multi) {
      pickChoice(generationId, [i], place)
      return
    }
    setToggled((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i].sort((a, b) => a - b)))
  }

  return (
    <section
      aria-labelledby={headingId}
      data-choice
      data-state={answered ? 'answered' : open ? 'open' : 'waiting'}
      className="mt-2.5 animate-fade-in rounded-lg border border-line bg-surface px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-ai-soft text-ai">
          <CircleHelp size={12} />
        </span>
        <p id={headingId} className="min-w-0 flex-1 break-words text-[13.5px] font-medium leading-snug text-fg">
          {choice.question}
        </p>
      </div>
      {multi && open ? <p className="mt-0.5 text-[12px] text-faint">Pick one or more, then Send.</p> : null}
      <div role="group" aria-labelledby={headingId} className="mt-2 flex flex-col gap-1.5">
        {choice.options.map((o, i) => {
          const on = answered ? picked.includes(i) : multi && toggled.includes(i)
          return (
            <button
              key={i}
              type="button"
              data-option={i}
              data-picked={answered && on ? '' : undefined}
              aria-pressed={multi && !answered ? on : undefined}
              disabled={!open}
              onClick={() => press(i)}
              className={cn(
                'flex w-full min-w-0 items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default',
                on ? 'border-accent bg-accent-soft' : 'border-line bg-page enabled:hover:border-line-strong enabled:hover:bg-surface-2',
                answered && !on && 'opacity-60'
              )}
            >
              {multi || answered ? (
                <span
                  aria-hidden
                  className={cn(
                    'mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
                    on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
                    !multi && !on && 'invisible'
                  )}
                >
                  {on ? <Check size={10} strokeWidth={3} /> : null}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="break-words font-medium text-fg">
                    {o.label}
                    {answered && on ? <span className="sr-only"> (your pick)</span> : null}
                  </span>
                  {choice.recommended === i ? (
                    <span className="rounded-sm bg-accent-soft px-1.5 text-[11px] font-semibold leading-[18px] text-accent">Recommended</span>
                  ) : null}
                </span>
                {o.detail ? <span className="mt-0.5 block break-words text-[12px] leading-snug text-muted">{o.detail}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {multi ? (
            <Button size="sm" variant="primary" disabled={!toggled.length} onClick={() => pickChoice(generationId, toggled, place)}>
              Send
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={requestBoxFocus} title="Answer in your own words, in the box below">
            Other…
          </Button>
        </div>
      ) : answered && !picked.length ? (
        <p className="mt-1.5 text-[12px] text-faint">Answered in your own words.</p>
      ) : null}
    </section>
  )
}
