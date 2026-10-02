// A step's fields: what Adam types, the AI's suggestions waiting on Keep or Discard (in the soft
// amber highlight), a field being written, and the three options for one field.
import { AlertTriangle, ImagePlus, Shuffle, Sparkles, Square, X } from 'lucide-react'
import { memo, useEffect, useId, useMemo, useRef } from 'react'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import type { Entry } from '@shared/types'
import { Input, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { PortraitDrop } from '@/features/views/PortraitDrop'
import { Skeleton } from '@/features/generate/parts'
import { findNearDuplicates, kindNoun, withArticle, type NearDuplicate } from '@/features/world/entryLogic'
import { AutoTextarea, useFitHeight } from '@/features/world/parts/AutoTextarea'
import { markOf, ROLE_OPTIONS, splitAliases, type Step, type StepField } from './builderLogic'
import { MarkLine, SuggestionButton, WritingStatus } from './parts'

/** Give me options for one field: the three alternatives as they arrive, or why there are none. */
export interface OptionsState {
  key: string
  list: string[]
  /** The option still arriving. */
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
  /** Another AI action is running, so Give me options waits. */
  busy: boolean
  entry: Entry | null
  /** Every entry in the world, for the near-duplicate warning. */
  entries: Entry[] | null
  /** A field to put the cursor in (after Keep, Discard or picking an option), then forgotten. */
  focusKey: string | null
  onFocused(): void
  onChange(key: string, value: string): void
  onKeep(key: string): void
  onDiscard(key: string): void
  onOptions(key: string): void
  onPick(key: string, value: string): void
  onCloseOptions(): void
  onStopOptions(): void
  onImage(e: Entry): void
}

export function StepFields(p: StepFieldsProps): React.JSX.Element {
  const { step } = p
  const isBasics = step.id === 'basics'
  const rest = isBasics ? step.fields.filter((f) => f.key !== 'name') : step.fields
  const name = isBasics ? step.fields.find((f) => f.key === 'name') : undefined
  return (
    <div className="flex flex-col gap-4">
      {name ? (
        <div className="flex items-start gap-4">
          <PortraitSlot kind={p.kind} entry={p.entry} onImage={p.onImage} />
          <div className="min-w-0 flex-1">
            <FieldBox {...p} field={name} />
            <DuplicateHint kind={p.kind} entry={p.entry} values={p.values} entries={p.entries} />
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 @lg:grid-cols-2">
        {rest.map((f) => (
          <FieldBox key={f.key} {...p} field={f} className={f.type === 'text' || f.type === 'list' ? '@lg:col-span-2' : undefined} />
        ))}
      </div>
    </div>
  )
}

/** The portrait on Basics: click or drop a picture, once there is an entry to keep it on. */
function PortraitSlot({
  kind,
  entry,
  onImage
}: {
  kind: BuilderKind
  entry: Entry | null
  onImage: (e: Entry) => void
}): React.JSX.Element {
  if (entry) return <PortraitDrop entry={entry} size={72} onChange={onImage} className="mt-6" />
  return (
    <div
      title="Give it a name first, then you can add a picture."
      className={cn(
        'mt-6 flex h-[72px] w-[72px] shrink-0 items-center justify-center border border-dashed border-line-strong text-faint',
        kind === 'character' ? 'rounded-full' : 'rounded-md'
      )}
    >
      <ImagePlus size={18} aria-hidden />
    </div>
  )
}

function DuplicateHint({
  kind,
  entry,
  values,
  entries
}: {
  kind: BuilderKind
  entry: Entry | null
  values: BuilderValues
  entries: Entry[] | null
}): React.JSX.Element {
  const name = values.name ?? ''
  const aliases = values.aliases ?? ''
  const dups: NearDuplicate[] = useMemo(
    () => (entries ? findNearDuplicates({ id: entry?.id ?? '', kind, name, aliases: splitAliases(aliases) }, entries) : []),
    [entries, entry?.id, kind, name, aliases]
  )
  const d = dups[0]
  // The line is always there (empty when there's nothing to say) so nothing moves while a name is typed.
  if (!d) return <div className="h-6" aria-hidden />
  const other = d.entry
  const otherName = other.name.trim()
  const what = other.kind === kind ? `another ${kindNoun(kind)}` : withArticle(kindNoun(other.kind))
  const more = dups.length > 1 ? `, and ${dups.length - 1} more` : ''
  const text =
    d.reason === 'same'
      ? `There's already ${what} called ${otherName}${more}.`
      : d.reason === 'similar'
        ? `Very close to ${otherName}, ${what}${more}.`
        : `Shares a name with ${otherName}, ${what}${more}.`
  return (
    <div
      role="status"
      title="If they're the same, keep one, so the AI doesn't mix them up."
      className="flex h-6 animate-fade-in items-center gap-1.5 text-[12.5px] text-ai"
    >
      <AlertTriangle size={13} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{text} Same one?</span>
      <button
        type="button"
        onClick={() => useApp.getState().navigate({ kind: 'entries', entryKind: other.kind, entryId: other.id })}
        className="shrink-0 font-medium underline-offset-2 hover:underline"
      >
        Open {otherName}
      </button>
    </div>
  )
}

/** One field, with its suggestion or options when it has them. */
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

  // After Keep, Discard or an option picked, the cursor goes back into the field.
  const { focusKey, onFocused } = p
  useEffect(() => {
    if (focusKey !== field.key || suggestion !== undefined || writing !== null) return
    control.current?.focus()
    onFocused()
  }, [focusKey, field.key, suggestion, writing, onFocused])

  const label = field.label
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', p.className)}>
      <div className="flex h-5 items-center justify-between gap-2">
        <label htmlFor={id} className={cn('text-[12px] font-medium text-muted', field.type === 'name' && 'sr-only')}>
          {label}
        </label>
        {canOptions ? (
          <button
            type="button"
            disabled={p.busy}
            onClick={() => p.onOptions(field.key)}
            aria-label={`Give me options for ${label}`}
            title={`Three different ideas for ${label.toLowerCase()} to choose from`}
            className={cn(
              'ml-auto inline-flex h-5 items-center gap-1 rounded px-1 text-[12px] text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-50',
              options && 'text-ai'
            )}
          >
            <Shuffle size={11} aria-hidden />
            Options
          </button>
        ) : null}
      </div>

      {writing !== null ? (
        <WritingBox field={field} text={writing} />
      ) : suggestion !== undefined ? (
        <SuggestionBox field={field} text={suggestion} onKeep={() => p.onKeep(field.key)} onDiscard={() => p.onDiscard(field.key)} />
      ) : (
        <Control field={field} id={id} value={value} onChange={(v) => p.onChange(field.key, v)} innerRef={control} />
      )}

      {suggestion !== undefined || field.type === 'name' ? null : <MarkLine mark={writing !== null ? null : mark}>{field.hint}</MarkLine>}

      {options ? (
        <OptionsPanel
          field={field}
          options={options}
          onPick={(v) => p.onPick(field.key, v)}
          onClose={p.onCloseOptions}
          onStop={p.onStopOptions}
          onRetry={() => p.onOptions(field.key)}
        />
      ) : null}
    </div>
  )
})

const box = 'w-full rounded-md border px-2.5 text-[13.5px] leading-[1.55]'

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
      <Select
        id={id}
        value={value || null}
        onChange={(v) => onChange(v ?? '')}
        options={value && !ROLE_OPTIONS.some((o) => o.value === value) ? [...ROLE_OPTIONS, { value, label: value }] : ROLE_OPTIONS}
        allowNone
        noneLabel="Not set"
        placeholder="Not set"
      />
    )
  }
  if (field.type === 'text') {
    return (
      <AutoTextarea
        ref={set}
        id={id}
        value={value}
        minRows={field.key === 'description' ? 3 : 2}
        maxRows={20}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return <Input ref={set} id={id} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
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
      rows={1}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value.replace(/[ \t]*[\r\n]+[ \t]*/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault()
      }}
      className="-mx-2 block w-[calc(100%+16px)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-2 py-1 font-serif text-[28px] font-semibold leading-tight text-fg transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
    />
  )
}

/** The AI writing a suggestion for this field: its words so far, in the amber highlight. */
function WritingBox({ field, text }: { field: StepField; text: string }): React.JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label={`Writing a suggestion for ${field.label}`}
      className={cn(
        box,
        'border-ai/40 bg-ai-soft text-fg',
        field.type === 'name' ? 'min-h-[46px] py-1 font-serif text-[28px] font-semibold leading-tight' : field.type === 'text' ? 'min-h-[56px] py-1.5' : 'min-h-8 py-[5px]'
      )}
    >
      <span className="whitespace-pre-wrap">{text}</span>
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
  const name = field.type === 'name'
  return (
    <div role="group" aria-label={`Suggestion for ${field.label}`} className="flex flex-col gap-1 animate-fade-in">
      <p
        className={cn(
          box,
          'whitespace-pre-wrap border-ai/40 bg-ai-soft text-fg',
          name ? 'min-h-[46px] py-1 font-serif text-[28px] font-semibold leading-tight' : field.type === 'text' ? 'min-h-[56px] py-1.5' : 'min-h-8 py-[5px]'
        )}
      >
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

/** Three alternatives for one field. Three places are kept for them from the start, so nothing moves as they arrive. */
function OptionsPanel({
  field,
  options,
  onPick,
  onClose,
  onStop,
  onRetry
}: {
  field: StepField
  options: OptionsState
  onPick: (v: string) => void
  onClose: () => void
  onStop: () => void
  onRetry: () => void
}): React.JSX.Element {
  const slots: { text: string; state: 'ready' | 'writing' | 'waiting' }[] = []
  for (let i = 0; i < 3; i++) {
    const text = options.list[i]
    if (text !== undefined) slots.push({ text, state: 'ready' })
    else if (options.running && i === options.list.length && options.writing) slots.push({ text: options.writing, state: 'writing' })
    else if (options.running) slots.push({ text: '', state: 'waiting' })
  }
  const label = field.label.toLowerCase()
  return (
    <div role="group" aria-label={`Options for ${field.label}`} className="mt-1 rounded-lg border border-ai/30 bg-ai-soft p-2 animate-fade-in">
      <div className="flex h-7 items-center gap-2 pl-1">
        {options.running ? (
          <WritingStatus text={`Thinking of three ideas for ${label}…`} />
        ) : (
          <span className="min-w-0 truncate text-[12.5px] font-medium text-muted">
            {options.error ? `No options for ${label}` : `Pick one for ${label}, or close this to keep what you have`}
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
          aria-label={`Close the options for ${field.label}`}
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
          <SuggestionButton primary onClick={onRetry}>
            Try again
          </SuggestionButton>
        </div>
      ) : (
        <ol className="mt-1 flex flex-col gap-1.5">
          {slots.map((s, i) => (
            <li key={i} className="flex min-h-[44px] items-start gap-2 rounded-md border border-line bg-page py-1.5 pl-2.5 pr-1.5">
              {s.state === 'waiting' ? (
                <div className="flex flex-1 flex-col gap-1.5 py-1">
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              ) : (
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13.5px] leading-[1.55] text-fg">
                  {s.text}
                  {s.state === 'writing' ? <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ai" /> : null}
                </p>
              )}
              <SuggestionButton
                primary
                disabled={s.state !== 'ready'}
                onClick={() => onPick(s.text)}
                aria-label={`Use option ${i + 1} for ${field.label}`}
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

