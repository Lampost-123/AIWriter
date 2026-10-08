// A step's fields, in cards of the ones that belong together (builderLogic.cardsOf), each card with a line saying what
// goes in it and every empty box showing an example. The AI's suggestions wait on Keep or Discard in the soft amber
// highlight; a field being written shows the words as they come; and Ideas (the AI's three takes on one field) opens
// under its field. A suggestion's box is the size of the box it would fill, line for line, so nothing moves when Adam
// keeps or discards it; a kept one settles into its box with a short amber glow, and a picked idea flies up into its
// field (fly.ts).
import { Sparkles, Square, X } from '@/components/ui/icons'
import { memo, useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import type { Entry } from '@shared/types'
import { Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/features/generate/parts'
import { AutoTextarea, useFitHeight } from '@/features/world/parts/AutoTextarea'
import { cardsOf, markOf, wideKeys, ROLE_OPTIONS, type Step, type StepField } from './builderLogic'
import { mayFly } from './fly'
import { DuplicateHint, MarkLine, settingsAction, SuggestionButton, WritingStatus } from './parts'

/** The AI's ideas for one field: the three as they arrive, or why there are none. */
export interface OptionsState {
  key: string
  list: string[]
  /** The idea still arriving. */
  writing: string | null
  running: boolean
  error: string | null
  code?: string
}

export interface StepFieldsProps {
  kind: BuilderKind
  step: Step
  values: BuilderValues
  ai: Readonly<Record<string, string>>
  /** Suggestions waiting on Keep or Discard, by key (only for fields empty on screen). */
  suggestions: BuilderValues
  /** The field the AI is writing a suggestion for right now. */
  writing: { key: string; text: string } | null
  options: OptionsState | null
  /** Another AI action is running, so Ideas waits. */
  busy: boolean
  entry: Entry | null
  /** Every entry in the world, for the near-duplicate warning. */
  entries: Entry[] | null
  /** A field to put the cursor in (after Keep, Discard or picking an idea), then forgotten. */
  focusKey: string | null
  onFocused(): void
  onChange(key: string, value: string): void
  onKeep(key: string): void
  onDiscard(key: string): void
  onOptions(key: string): void
  /** An idea picked; `from` is where it was on screen, so it can fly into its field. */
  onPick(key: string, value: string, from: DOMRect | null): void
  onCloseOptions(): void
  onStopOptions(): void
}

export function StepFields(p: StepFieldsProps): React.JSX.Element {
  const { step, kind } = p
  const cards = cardsOf(kind, step)
  const byKey = new Map(step.fields.map((f) => [f.key, f]))
  return (
    <div className="bld-cards">
      {cards.map((c) => (
        <section key={c.id} className="bld-card" aria-label={c.title || undefined} data-card={c.id}>
          {c.title ? (
            <header className="bld-card-h">
              <h2 className="bld-card-t">{c.title}</h2>
              {c.hint ? <p className="bld-card-hint">{c.hint}</p> : null}
            </header>
          ) : null}
          <div className="bld-grid">
            {(() => {
              const fields = c.keys.map((k) => byKey.get(k)!)
              const wide = wideKeys(fields)
              return fields.map((f) => <FieldBox key={f.key} {...p} field={f} className={wide.has(f.key) ? 'is-wide' : undefined} />)
            })()}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Ideas: the AI's three takes on one field, in its amber, with what it does on hover. */
function IdeasButton({ label, open, busy, onClick }: { label: string; open: boolean; busy: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      aria-label={`Ask the AI for ideas for ${label}`}
      aria-expanded={open}
      title={`Ideas from the AI: three different takes on ${label.toLowerCase()} to choose from. Nothing changes until you pick one.`}
      className={cn('bld-ideas', open && 'is-on')}
    >
      <Sparkles size={12} aria-hidden />
      Ideas
    </button>
  )
}

/** One field, with its suggestion or ideas when it has them. */
const FieldBox = memo(function FieldBox(p: StepFieldsProps & { field: StepField; className?: string }): React.JSX.Element {
  const { field } = p
  const id = useId()
  const value = p.values[field.key] ?? ''
  const empty = !value.trim()
  const suggestion = empty ? p.suggestions[field.key] : undefined
  const writing = empty && p.writing?.key === field.key ? p.writing.text : null
  const options = p.options?.key === field.key ? p.options : null
  const canOptions = field.type !== 'list' && field.type !== 'role'
  const mark = markOf(field.key, value, p.ai)
  const control = useRef<HTMLElement | null>(null)
  const isName = field.type === 'name'

  // After Keep, Discard or an idea picked, the cursor goes back into the field.
  const { focusKey, onFocused } = p
  useEffect(() => {
    if (focusKey !== field.key || suggestion !== undefined || writing !== null) return
    control.current?.focus({ preventScroll: true })
    onFocused()
  }, [focusKey, field.key, suggestion, writing, onFocused])

  const label = field.label
  const ideas = canOptions ? <IdeasButton label={label} open={!!options} busy={p.busy} onClick={() => p.onOptions(field.key)} /> : null

  return (
    <div className={cn('bld-field', p.className)} data-bld-field={field.key}>
      <div className="bld-label-row">
        <label htmlFor={id} className={cn('bld-label', isName && 'sr-only')}>
          {label}
        </label>
        {ideas}
      </div>

      {writing !== null ? (
        <WritingBox field={field} text={writing} />
      ) : suggestion !== undefined ? (
        <SuggestionBox field={field} text={suggestion} onKeep={() => p.onKeep(field.key)} onDiscard={() => p.onDiscard(field.key)} />
      ) : (
        <Control field={field} id={id} value={value} onChange={(v) => p.onChange(field.key, v)} innerRef={control} />
      )}

      {isName ? (
        <DuplicateHint
          kind={p.kind}
          entryId={p.entry?.id ?? null}
          name={value}
          aliases={p.values.aliases ?? ''}
          entries={p.entries}
          className="text-[12.5px]"
        />
      ) : suggestion !== undefined ? null : (
        <MarkLine mark={writing !== null ? null : mark}>{field.hint}</MarkLine>
      )}

      {options ? (
        <OptionsPanel
          field={field}
          options={options}
          filled={!empty}
          onPick={(v, from) => p.onPick(field.key, v, from)}
          onClose={p.onCloseOptions}
          onStop={p.onStopOptions}
          onRetry={() => p.onOptions(field.key)}
        />
      ) : null}
    </div>
  )
})

const CONTROL =
  'block w-full resize-none rounded-md border border-line bg-page px-2.5 text-[13.5px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

/**
 * The box sizes each kind of field shares with its suggestion and the suggestion being written, so a
 * field is the same height whichever of them shows: a one-line field is a line of 20 px (32 px with
 * its padding) that grows a line at a time, a few-paragraph one starts at two lines (three for the
 * description), and the name is a title.
 */
const BOX = {
  name: 'px-2.5 py-1 font-serif text-[26px] font-semibold leading-tight',
  line: 'px-2.5 py-[5px] text-[13.5px] leading-5',
  text: 'px-2.5 py-1.5 text-[13.5px] leading-[1.55]'
}
const boxOf = (f: StepField): string => (f.type === 'name' ? BOX.name : f.type === 'text' ? BOX.text : BOX.line)
// The text box's own smallest height: its rows of 20.925 px (13.5 px at 1.55), its padding and border.
const minHeightOf = (f: StepField): string =>
  f.type === 'name' ? 'min-h-[43px]' : f.type === 'text' ? (f.key === 'description' ? 'min-h-[77px]' : 'min-h-[56px]') : 'min-h-8'

// A suggestion, or one being written: the AI's words in the soft amber highlight, awaiting Adam.
const AMBER = 'whitespace-pre-wrap break-words rounded-md border border-ai/40 bg-ai-soft text-fg'

const oneLine = (v: string): string => v.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ')

function Control({
  field,
  id,
  value,
  onChange,
  innerRef
}: {
  field: StepField
  id: string
  value: string
  onChange: (v: string) => void
  innerRef: React.MutableRefObject<HTMLElement | null>
}): React.JSX.Element {
  const set = (el: HTMLElement | null): void => {
    innerRef.current = el
  }
  if (field.type === 'name') return <NameBox id={id} value={value} placeholder={field.placeholder} onChange={onChange} innerRef={set} />
  if (field.type === 'role') {
    return (
      <div data-bld-box>
        <Select
          id={id}
          value={value || null}
          onChange={(v) => onChange(v ?? '')}
          options={value && !ROLE_OPTIONS.some((o) => o.value === value) ? [...ROLE_OPTIONS, { value, label: value }] : ROLE_OPTIONS}
          allowNone
          noneLabel="Not set"
          placeholder="Not set"
        />
      </div>
    )
  }
  if (field.type === 'text') {
    return (
      <AutoTextarea
        ref={set}
        id={id}
        data-bld-box
        value={value}
        minRows={field.key === 'description' ? 3 : 2}
        maxRows={20}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return <LineBox id={id} value={value} placeholder={field.placeholder} onChange={onChange} innerRef={set} />
}

/**
 * A one-line field (aliases, pronouns, all of Looks): one line high, growing to show the whole of a
 * longer text (a kept suggestion, say) rather than cut it off. Still one line of text: Enter does
 * nothing, and a pasted line break becomes a space. Empty, its example stays on its one line, ending in
 * "…" when the box is too narrow for it, so no second line shows cut in half under the first and the
 * first letter typed doesn't make the box shrink.
 */
function LineBox({
  id,
  value,
  placeholder,
  onChange,
  innerRef
}: {
  id: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  innerRef: (el: HTMLElement | null) => void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const empty = !value
  useFitHeight(ref, value, 1, empty ? 0 : 6)
  useLayoutEffect(() => {
    const el = ref.current
    if (!empty || !el) return
    el.style.height = ''
    el.style.overflowY = ''
  }, [empty])
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        innerRef(el)
      }}
      id={id}
      data-bld-box
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(oneLine(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault()
      }}
      className={cn(CONTROL, BOX.line, 'overflow-hidden', empty && 'truncate placeholder:truncate')}
    />
  )
}

/**
 * The name, as a title. It wraps rather than cut a long one short, and stays one line of text:
 * Enter does nothing, and a pasted line break becomes a space.
 */
function NameBox({
  id,
  value,
  placeholder,
  onChange,
  innerRef
}: {
  id: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  innerRef: (el: HTMLElement | null) => void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useFitHeight(ref, value, 1, 4)
  return (
    <textarea
      ref={(el) => {
        ref.current = el
        innerRef(el)
      }}
      id={id}
      data-bld-box
      rows={1}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(oneLine(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault()
      }}
      className={cn(
        BOX.name,
        'block w-full resize-none overflow-hidden rounded-md border border-line bg-page text-fg transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'
      )}
    />
  )
}

/** The AI writing a suggestion for this field: its words so far, in the amber highlight. */
function WritingBox({ field, text }: { field: StepField; text: string }): React.JSX.Element {
  return (
    <div
      data-bld-box
      aria-busy="true"
      aria-label={`Writing a suggestion for ${field.label}`}
      className={cn(AMBER, boxOf(field), minHeightOf(field), 'bld-writing')}
    >
      {text}
      <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ai" />
    </div>
  )
}

/**
 * A suggestion waiting on Adam: the AI's words in the amber highlight, the size of the box it would
 * fill, with Keep and Discard on the line under it (where "Drafted by AI" goes once kept), so
 * nothing moves when he decides.
 */
function SuggestionBox({
  field,
  text,
  onKeep,
  onDiscard
}: {
  field: StepField
  text: string
  onKeep: () => void
  onDiscard: () => void
}): React.JSX.Element {
  return (
    <div role="group" aria-label={`Suggestion for ${field.label}`} className="flex flex-col gap-1 animate-fade-in">
      <p data-bld-box className={cn(AMBER, boxOf(field), minHeightOf(field))}>
        {text}
      </p>
      <div className="flex h-[18px] items-center gap-1 text-[12px]">
        <Sparkles size={11} className="mr-0.5 shrink-0 text-ai" aria-hidden />
        <span className="mr-1 text-faint">Suggested by AI</span>
        <button
          type="button"
          onClick={onKeep}
          aria-label={`Keep the suggestion for ${field.label}`}
          className="h-[18px] rounded px-1.5 font-medium text-ai transition-colors duration-150 hover:bg-ai-soft"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={onDiscard}
          aria-label={`Discard the suggestion for ${field.label}`}
          className="h-[18px] rounded px-1.5 font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

/**
 * The AI's three ideas for one field, under it (so their words need no field name), as amber cards that each fly up
 * into the field when picked. Three places are kept for them from the start, so nothing moves as they arrive.
 */
function OptionsPanel({
  field,
  options,
  filled,
  onPick,
  onClose,
  onStop,
  onRetry
}: {
  field: StepField
  options: OptionsState
  /** The field has words of its own, which closing the ideas keeps. */
  filled: boolean
  onPick: (v: string, from: DOMRect | null) => void
  onClose: () => void
  onStop: () => void
  onRetry: () => void
}): React.JSX.Element {
  // Opened below the fold: it scrolls into view, so the ideas are seen arriving.
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'nearest', behavior: mayFly() ? 'smooth' : 'auto' })
  }, [])
  const slots: { text: string; state: 'ready' | 'writing' | 'waiting' }[] = []
  for (let i = 0; i < 3; i++) {
    const text = options.list[i]
    if (text !== undefined) slots.push({ text, state: 'ready' })
    else if (options.running && i === options.list.length && options.writing) slots.push({ text: options.writing, state: 'writing' })
    else if (options.running) slots.push({ text: '', state: 'waiting' })
  }
  // A model or key missing: the fix is in Settings, so the button goes there.
  const settings = options.error ? settingsAction(options.error, options.code) : undefined
  // Short enough for a field at half width.
  const heading = options.error ? 'No ideas this time' : filled ? 'Pick one, or close this to keep yours' : 'Pick one, or close this'
  return (
    <div ref={panel} role="group" aria-label={`Ideas for ${field.label}`} className="bld-ideas-panel animate-fade-in">
      <div className="flex h-7 items-center gap-2 pl-1">
        <Sparkles size={13} className="shrink-0 text-ai" aria-hidden />
        {options.running ? (
          <WritingStatus text="Thinking of three ideas…" />
        ) : (
          <span title={heading} className="min-w-0 truncate text-[12.5px] font-medium text-muted">
            {heading}
          </span>
        )}
        <div className="flex-1" />
        {options.running ? (
          <SuggestionButton primary onClick={onStop} className="gap-1.5">
            <Square size={9} fill="currentColor" aria-hidden />
            Stop
          </SuggestionButton>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close the ideas for ${field.label}`}
          title="Close"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors duration-150 hover:bg-surface hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      {options.error ? (
        <div className="flex items-start gap-2 px-1 pb-1 pt-0.5">
          <p role="alert" className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg">
            {options.error}
          </p>
          {settings ? (
            <SuggestionButton primary onClick={settings.run}>
              {settings.label}
            </SuggestionButton>
          ) : null}
          <SuggestionButton primary={!settings} onClick={onRetry}>
            Try again
          </SuggestionButton>
        </div>
      ) : (
        <ol className="mt-1 flex flex-col gap-1.5">
          {slots.map((s, i) => (
            <li key={i} className="bld-idea" data-state={s.state}>
              <span aria-hidden className="bld-idea-n">
                {i + 1}
              </span>
              {s.state === 'waiting' ? (
                // As tall as an idea of one line, so the panel doesn't shrink when the last one arrives.
                <div className="flex h-6 flex-1 items-center">
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ) : (
                <p className="bld-idea-t min-w-0 flex-1 whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-fg">
                  {s.text}
                  {s.state === 'writing' ? (
                    <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ai" />
                  ) : null}
                </p>
              )}
              <SuggestionButton
                primary
                disabled={s.state !== 'ready'}
                onClick={(e) => {
                  const row = (e.currentTarget.closest('li')?.querySelector('.bld-idea-t') as HTMLElement | null) ?? null
                  onPick(s.text, row?.getBoundingClientRect() ?? null)
                }}
                aria-label={`Use idea ${i + 1} for ${field.label}`}
              >
                Use this
              </SuggestionButton>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
