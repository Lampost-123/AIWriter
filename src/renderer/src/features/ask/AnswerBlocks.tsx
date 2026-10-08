// An answer's body in the new Ask panel (chat overhaul Phase 2), block by block as shared/answerBlocks.ts reads it:
// the lead (the sentence that answers, in the story's serif, with a verdict chip for a fact check), then in the UI's
// sans: option cards for ideas, fact rows with their source and scene, plain paragraphs, and a folded "Why / details".
// Each block fades in as it arrives (opacity only); what already shows never moves.
import { useId, useState } from 'react'
import type { AnswerBlock, Verdict } from '@shared/answerBlocks'
import type { ID } from '@shared/types'
import { BookOpenText, Check, ChevronRight, CircleDashed, Star, X } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { factParts, leadWords } from './answerView'
import { InlineWords, AnswerProse } from './AnswerText'
import { useAskPrefs, optionKey, setOption, type Density } from './askPrefs'
import type { AskPlace } from './askStore'
import { citedTargets, type LinkTarget } from './citations'
import { SourceChip } from './CiteChip'
import { addAsBeat, moreLike, saveOption } from './optionActions'

/** What the option cards need from their turn. */
export interface TurnContext {
  generationId: ID
  question: string
  place: AskPlace
  /** The answer has ended and nothing else is being answered: its cards' buttons work. */
  canAct: boolean
  /** The answer's own first cited entry, where an idea that names none is saved. */
  firstCited: LinkTarget | null
}

const VERDICTS: Record<Verdict, { label: string; className: string; Icon: typeof Check }> = {
  yes: { label: 'Yes', className: 'bg-success-soft text-success', Icon: Check },
  no: { label: 'No', className: 'bg-danger-soft text-danger', Icon: X },
  unknown: { label: 'Not in memory yet', className: 'bg-surface-2 text-muted', Icon: CircleDashed }
}

/** A fact check's verdict, before its lead: Yes, No, or Not in memory yet. */
export function VerdictChip({ verdict }: { verdict: Verdict }): React.JSX.Element {
  const v = VERDICTS[verdict]
  return (
    <span
      data-verdict={verdict}
      className={cn('mr-2 inline-flex h-[22px] translate-y-[-1px] items-center gap-1 rounded-full px-2 align-middle font-sans text-[12px] font-semibold', v.className)}
    >
      <v.Icon size={12} strokeWidth={2.5} aria-hidden />
      {v.label}
    </span>
  )
}

/** The sentence that answers: the story's serif, a little larger (the plain sans in Compact). */
function AnswerLead({ block, index, density }: { block: Extract<AnswerBlock, { kind: 'lead' }>; index: Map<string, LinkTarget>; density: Density }): React.JSX.Element {
  return (
    <div
      data-lead
      className={cn(
        'break-words px-1 text-fg',
        density === 'compact' ? 'text-[14px] font-medium leading-[1.5]' : 'font-serif text-[15.5px] leading-[1.55]'
      )}
    >
      {block.verdict ? <VerdictChip verdict={block.verdict} /> : null}
      {/* The chip says the verdict, so its word isn't said twice ("Yes. Mara is 34." → [Yes] Mara is 34.). */}
      <InlineWords text={leadWords(block.text, block.verdict)} index={index} />
    </div>
  )
}

const actionButton =
  'inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-[12px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40'

/** One idea: its title, a line on why, and what to do with it (shown on hover or focus, in room kept for it). */
function OptionCard({
  item,
  number,
  index,
  turn,
  density,
  live
}: {
  item: { title: string; why: string }
  number: number
  index: Map<string, LinkTarget>
  turn: TurnContext
  density: Density
  live: boolean
}): React.JSX.Element {
  const key = optionKey(turn.generationId, number)
  const state = useAskPrefs((s) => s.options[key]) ?? {}
  const [busy, setBusy] = useState(false)
  const name = item.title.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, n: string, s?: string) => s ?? n).replace(/[*_]/g, '')
  const entry = citedTargets(`${item.title} ${item.why}`, index)[0] ?? turn.firstCited
  const sceneId = turn.place.sceneId
  const run = (fn: () => Promise<void>): void => {
    setBusy(true)
    void fn().finally(() => setBusy(false))
  }
  const status = state.aside ? 'aside' : state.usedAsBeat ? 'used' : state.kept ? 'kept' : 'idle'
  return (
    <li
      data-option-card={number}
      data-state={status}
      className={cn(
        'group/opt rounded-lg border px-3 pb-1.5 pt-2.5 transition-[opacity,border-color,background-color] duration-150',
        live && 'animate-fade-in',
        state.kept && !state.aside ? 'border-accent/50 bg-accent-soft/50' : 'border-line bg-surface look-new:bg-raise look-new:shadow-e1',
        state.aside && 'opacity-55'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className={cn('block break-words text-[13.5px] font-semibold leading-snug text-fg', state.aside && 'line-through decoration-faint')}>
            {state.kept ? <Star size={12} fill="currentColor" aria-hidden className="mr-1 inline-block -translate-y-px text-accent" /> : null}
            <InlineWords text={item.title} index={index} />
          </span>
          {item.why ? (
            <span className={cn('mt-0.5 block break-words text-[13px] leading-[1.5] text-muted', density === 'compact' && 'truncate')}>
              <InlineWords text={item.why} index={index} />
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-pressed={!!state.kept}
          aria-label={state.kept ? `Stop keeping “${name}”` : `Keep “${name}”`}
          title={state.kept ? 'Kept for this session' : 'Keep this idea (for this session)'}
          onClick={() => setOption(key, { kept: !state.kept })}
          className={cn(
            '-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-faint transition-[opacity,color,background-color] duration-150 hover:bg-surface-2 hover:text-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus',
            state.kept ? 'text-accent opacity-100' : 'opacity-0 group-hover/opt:opacity-100 group-focus-within/opt:opacity-100'
          )}
        >
          <Star size={13} fill={state.kept ? 'currentColor' : 'none'} />
        </button>
      </div>
      {/* The buttons' row is always there (room kept), so nothing moves when they show. */}
      <div className="-ml-1.5 mt-1 flex h-6 min-w-0 items-center gap-0.5 overflow-hidden">
        {state.aside ? (
          <>
            <span className="px-1.5 text-[12px] text-faint">Set aside</span>
            <button type="button" className={actionButton} onClick={() => setOption(key, { aside: false })} aria-label={`Bring back “${name}”`}>
              Bring back
            </button>
          </>
        ) : state.usedAsBeat ? (
          <span className="flex items-center gap-1 px-1.5 text-[12px] font-medium text-success" data-used>
            <Check size={12} strokeWidth={2.5} aria-hidden /> Added as beat {state.usedAsBeat}
          </span>
        ) : (
          <div className={cn('flex min-w-0 items-center gap-0.5 transition-opacity duration-[140ms]', 'opacity-0 group-hover/opt:opacity-100 group-focus-within/opt:opacity-100', !turn.canAct && 'invisible')}>
            <button
              type="button"
              className={actionButton}
              disabled={!turn.canAct || busy || !sceneId}
              title={sceneId ? 'Add it to the end of the scene card’s beats' : 'Open a scene to add beats to its card'}
              aria-label={`Use “${name}” as a beat`}
              onClick={() => sceneId && run(() => addAsBeat(sceneId, key, item.title, item.why))}
            >
              Use as beat
            </button>
            <button
              type="button"
              className={actionButton}
              disabled={!turn.canAct || busy}
              title={entry ? `Save it to the memory for ${entry.name}, as your own note` : 'Save it as a new page in Lore, as your own note'}
              aria-label={`Save “${name}” to ${entry ? entry.name : 'Lore'}`}
              onClick={() => run(() => saveOption({ title: item.title, why: item.why, entryId: entry?.id ?? null, question: turn.question, place: turn.place }))}
            >
              Save to entry
            </button>
            <button
              type="button"
              className={actionButton}
              disabled={!turn.canAct}
              aria-label={`More ideas like “${name}”`}
              onClick={() => moreLike(item.title, turn.place)}
            >
              More like this
            </button>
            <button
              type="button"
              className={cn(actionButton, 'ml-auto px-1')}
              aria-label={`Set “${name}” aside`}
              title="Set aside"
              onClick={() => setOption(key, { aside: true, kept: false })}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

/** A fact with where it comes from: the entry it names and the scene it is from. */
function FactRow({ item, index, silent, live }: { item: string; index: Map<string, LinkTarget>; silent: boolean; live: boolean }): React.JSX.Element {
  const { text, scene } = factParts(item)
  const source = citedTargets(text, index)[0] ?? null
  return (
    <li
      data-fact
      className={cn(
        'flex gap-2 rounded-md border px-2.5 py-2',
        live && 'animate-fade-in',
        silent ? 'border-dashed border-line-strong bg-transparent' : 'border-line bg-surface look-new:bg-raise'
      )}
    >
      {silent ? <CircleDashed size={13} aria-hidden className="mt-[3px] shrink-0 text-faint" /> : <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" />}
      <div className="min-w-0 flex-1">
        <div className={cn('break-words text-[13px] leading-[1.5]', silent ? 'text-muted' : 'text-fg')}>
          <InlineWords text={text} index={index} />
        </div>
        {source || scene ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {source ? <SourceChip target={source} /> : null}
            {scene ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[11.5px] text-muted" data-fact-scene>
                <BookOpenText size={11} aria-hidden />
                {scene}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** The facts a check found; with the memory silent, said so plainly. */
function FactList({ block, index, live }: { block: Extract<AnswerBlock, { kind: 'facts' }>; index: Map<string, LinkTarget>; live: boolean }): React.JSX.Element {
  const silent = block.verdict === 'unknown'
  return (
    <ul aria-label={silent ? 'What the memory has (it doesn’t say)' : 'What the memory says'} data-facts={block.verdict ?? ''} className="flex flex-col gap-1.5">
      {block.items.length ? (
        block.items.map((it, i) => <FactRow key={i} item={it} index={index} silent={silent} live={live} />)
      ) : (
        <FactRow item="The memory doesn’t say." index={index} silent live={live} />
      )}
    </ul>
  )
}

/** The longer reasoning, folded away under "Why these" (or "Details"). */
function MoreBlock({ text, index, label, live }: { text: string; index: Map<string, LinkTarget>; label: string; live: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div data-more className={cn(live && 'animate-fade-in')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 items-center gap-1 rounded-md px-1 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
      >
        <ChevronRight size={12} aria-hidden className={cn('transition-transform duration-150', open && 'rotate-90')} />
        {label}
      </button>
      <div id={id} hidden={!open} className="mt-1 border-l-2 border-line pl-3 text-[13px] leading-[1.6] text-muted">
        <AnswerProse text={text} index={index} gap="mt-2" />
      </div>
    </div>
  )
}

/**
 * The answer's blocks, in order. `live`: the answer is being written now (its blocks fade in as they come; an old
 * chat's show at once). Follow-up questions (::next) aren't here: they show under the answer once it has ended.
 */
export function AnswerBlocks({
  blocks,
  index,
  density,
  turn,
  live
}: {
  blocks: AnswerBlock[]
  index: Map<string, LinkTarget>
  density: Density
  turn: TurnContext
  live: boolean
}): React.JSX.Element {
  const gap = density === 'compact' ? 'mt-2' : 'mt-3'
  const hasOptions = blocks.some((b) => b.kind === 'options')
  let optionNumber = 0
  return (
    <>
      {blocks.map((b, i) => {
        const at = i > 0 ? gap : undefined
        switch (b.kind) {
          case 'lead':
            return (
              <div key={i} className={cn(at, live && 'animate-fade-in')}>
                <AnswerLead block={b} index={index} density={density} />
              </div>
            )
          case 'options': {
            const first = optionNumber
            optionNumber += b.items.length
            return (
              <ol key={i} aria-label="Ideas" data-options className={cn(at, 'flex flex-col', density === 'compact' ? 'gap-1.5' : 'gap-2')}>
                {b.items.map((it, j) => (
                  <OptionCard key={j} item={it} number={first + j + 1} index={index} turn={turn} density={density} live={live} />
                ))}
              </ol>
            )
          }
          case 'facts':
            return (
              <div key={i} className={at}>
                <FactList block={b} index={index} live={live} />
              </div>
            )
          case 'more':
            return (
              <div key={i} className={at}>
                <MoreBlock text={b.text} index={index} label={hasOptions ? 'Why these' : 'Details'} live={live} />
              </div>
            )
          case 'text':
            return (
              <div key={i} className={cn(at, 'px-1 text-[13.5px] leading-[1.6] text-fg', live && 'animate-fade-in')}>
                <AnswerProse text={b.text} index={index} gap="mt-2" />
              </div>
            )
          case 'next':
            return null
        }
      })}
    </>
  )
}
