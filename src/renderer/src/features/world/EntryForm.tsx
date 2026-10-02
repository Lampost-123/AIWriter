import { AlertTriangle, Lock, Trash2 } from 'lucide-react'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CHARACTER_ROLES, FIELD_GROUPS, KIND_LABELS, type FieldDef, type FieldGroup } from '@shared/fields'
import type { Entry, EntryKind } from '@shared/types'
import { Button, Field, Input, Select } from '@/components/ui'
import { AutoTextarea } from './parts/AutoTextarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { confirmSaved, getDraft, setDraft, takeFresh } from './entryDrafts'
import { deleteEntryWithUndo, toPatch } from './entryActions'
import { filledCount, findNearDuplicates, kindNoun, parentPlaceOptions, type NearDuplicate, type PlaceOption } from './entryLogic'
import { SaveNote } from './parts/SaveNote'
import { Section } from './parts/Section'
import { Switch } from './parts/Switch'
import { CommaListInput } from './parts/TextInputs'
import { useAutosave } from './parts/useAutosave'

const COPY: Partial<Record<EntryKind, { summary: string; description: string; aliases: string; aliasesHint: string }>> = {
  character: {
    summary: 'A grumpy ex-soldier who runs the ferry and owes the Duke money',
    description: 'Who they are, in your own words. The sections below help you fill in the detail.',
    aliases: "nicknames, titles, 'the old woman'",
    aliasesHint: 'Separate with commas. Used to spot them in your text.'
  },
  place: {
    summary: 'A salt-crusted port where nobody asks questions',
    description: 'What it is, what it feels like to be there, and why it matters to the story.',
    aliases: "other names, like 'the Old Keep'",
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  },
  lore: {
    summary: 'Every spell costs the caster a memory',
    description: 'How it works, where it came from, and who knows about it.',
    aliases: "other names, like 'the Binding'",
    aliasesHint: 'Separate with commas. Used to spot it in your text.'
  }
}

const ROLE_OPTIONS = CHARACTER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))

// Which sections are open, remembered per kind for this session and the next.
const DEFAULT_OPEN: Partial<Record<EntryKind, string[]>> = { character: ['basics'], place: ['place'], lore: ['lore'] }
function loadOpen(kind: EntryKind): string[] {
  try {
    const raw = localStorage.getItem(`aiwrite.entrySections.${kind}`)
    const ids: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string')
  } catch {
    // Storage can be unavailable; fall back to the defaults.
  }
  return DEFAULT_OPEN[kind] ?? []
}
function saveOpen(kind: EntryKind, ids: string[]): void {
  try {
    localStorage.setItem(`aiwrite.entrySections.${kind}`, JSON.stringify(ids))
  } catch {
    // Not important enough to report.
  }
}

export interface EntryFormProps {
  /** The entry as it was when the form opened. The form owns the copy from then on. */
  initial: Entry
  /** Every other entry in the world, for the near-duplicate hint. */
  others: Entry[]
  /** Every place in the world, for "Inside". */
  places: Entry[]
  /** Called when anything shown in the list changes (name, summary, aliases...). */
  onLiveChange: (e: Entry) => void
  onDeleted: (e: Entry) => void
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
}

/** The simple form for a character, place or lore entry. Saves itself as Adam types. */
export const EntryForm = memo(function EntryForm({ initial, others, places, onLiveChange, onDeleted, onOpen }: EntryFormProps): React.JSX.Element {
  const kind = initial.kind
  const [draft, setDraftState] = useState(initial)
  const draftRef = useRef(initial)
  const liveRef = useRef(onLiveChange)
  liveRef.current = onLiveChange
  const nameRef = useRef<HTMLInputElement>(null)
  const ids = { notes: useId(), hard: useId() }

  const autosave = useAutosave<Entry>(
    async (e) => {
      await api.updateEntry(e.id, toPatch(e))
      confirmSaved(e)
      useApp.getState().bumpEntries()
    },
    { what: draft.name.trim() ? `"${draft.name.trim()}"` : `this ${kindNoun(kind)}` }
  )
  const { schedule } = autosave

  const update = useCallback(
    (patch: Partial<Entry>) => {
      const next = { ...draftRef.current, ...patch }
      draftRef.current = next
      setDraftState(next)
      setDraft(next)
      schedule(next)
      if ('name' in patch || 'summary' in patch || 'aliases' in patch || 'hardRule' in patch || 'parentId' in patch) liveRef.current(next)
    },
    [schedule]
  )
  // Opened from a copy that isn't confirmed saved yet (re-opened before its write
  // landed, or after a failed write): queue it again so it can't be left unsaved.
  const opened = useRef(initial)
  useEffect(() => {
    const first = opened.current
    if (getDraft(first.id) === first) schedule(first)
  }, [schedule])

  const setField = useCallback((key: string, v: string) => update({ fields: { ...draftRef.current.fields, [key]: v } }), [update])
  const setParent = useCallback((parentId: string | null) => update({ parentId }), [update])

  // A freshly created entry opens with its name selected, ready to type over.
  useLayoutEffect(() => {
    if (takeFresh(initial.id)) {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
  }, [initial.id])

  const dups = useMemo(
    () => findNearDuplicates({ id: draft.id, kind, name: draft.name, aliases: draft.aliases }, others),
    [draft.id, kind, draft.name, draft.aliases, others]
  )

  const [open, setOpen] = useState(() => new Set(loadOpen(kind)))
  const toggle = useCallback(
    (id: string): void =>
      setOpen((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        saveOpen(kind, [...next])
        return next
      }),
    [kind]
  )

  const deleting = useRef(false)
  const remove = async (): Promise<void> => {
    if (deleting.current) return
    deleting.current = true
    // Write any last edit first, so Undo brings back exactly what was on screen.
    await autosave.flush()
    autosave.cancel()
    if (await deleteEntryWithUndo(draftRef.current)) onDeleted(draftRef.current)
    else deleting.current = false
  }

  const copy = COPY[kind]
  const groups = FIELD_GROUPS[kind] ?? []
  const parentOptions = useMemo(() => (kind === 'place' ? parentPlaceOptions(places, draft.id) : []), [kind, places, draft.id])

  return (
    // Leaving any field writes straight away, so nothing waits on the timer.
    <div className="@container mx-auto w-full max-w-[700px] px-8 pb-24 pt-5" onBlur={() => void autosave.flush()}>
      <div className="flex h-8 items-center gap-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{KIND_LABELS[kind].one}</span>
        <div className="flex-1" />
        <SaveNote status={autosave.status} error={autosave.error} />
        <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void remove()}>
          Delete
        </Button>
      </div>

      <input
        ref={nameRef}
        value={draft.name}
        aria-label="Name"
        placeholder="Name"
        spellCheck={false}
        onChange={(e) => update({ name: e.target.value })}
        className="-mx-2 mt-1 w-[calc(100%+16px)] rounded-md border border-transparent bg-transparent px-2 py-1 font-serif text-[28px] font-semibold leading-tight text-fg transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <DuplicateHint dups={dups} kind={kind} onOpen={onOpen} />

      <div className="mt-3 flex flex-col gap-4">
        <Field label="Aliases" hint={copy?.aliasesHint}>
          {(id) => <CommaListInput id={id} value={draft.aliases} onChange={(aliases) => update({ aliases })} placeholder={copy?.aliases} />}
        </Field>
        <Field label="Short summary">
          {(id) => <Input id={id} value={draft.summary} placeholder={copy?.summary} onChange={(e) => update({ summary: e.target.value })} />}
        </Field>

        {kind === 'place' ? (
          <Field label="Inside" hint="The bigger place this one is part of, like a room inside a castle inside a city.">
            {(id) => (
              <ParentSelect
                id={id}
                value={draft.parentId && parentOptions.some((o) => o.value === draft.parentId) ? draft.parentId : null}
                onChange={setParent}
                options={parentOptions}
              />
            )}
          </Field>
        ) : null}

        {kind === 'lore' ? (
          <div className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150', draft.hardRule ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface')}>
            <Switch id={ids.hard} checked={draft.hardRule} onChange={(hardRule) => update({ hardRule })} className="mt-px" />
            <label htmlFor={ids.hard} className="flex-1 cursor-default">
              <span className="block text-[13.5px] font-medium text-fg">Hard rule</span>
              <span className="block text-[12.5px] text-muted">Never break this rule. Always given to the AI.</span>
            </label>
          </div>
        ) : null}

        <Field label="Description">
          {(id) => (
            <AutoTextarea id={id} value={draft.description} minRows={4} maxRows={30} placeholder={copy?.description} onChange={(e) => update({ description: e.target.value })} />
          )}
        </Field>
        <Field label="Tags" hint="Separate with commas.">
          {(id) => <CommaListInput id={id} value={draft.tags} onChange={(tags) => update({ tags })} placeholder="family, the north, book one" />}
        </Field>
      </div>

      {groups.length ? (
        <div className="mt-6 border-b border-line">
          {groups.map((g) => (
            <GroupSection key={g.id} group={g} fields={draft.fields} open={open.has(g.id)} onToggle={toggle} onField={setField} />
          ))}
        </div>
      ) : null}

      <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface px-3 pb-3 pt-2.5">
        <label htmlFor={ids.notes} className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
          <Lock size={12} aria-hidden />
          Private notes (never sent to the AI)
        </label>
        <AutoTextarea
          id={ids.notes}
          value={draft.notes}
          minRows={3}
          maxRows={24}
          placeholder="Reminders for yourself. The AI never sees these."
          onChange={(e) => update({ notes: e.target.value })}
        />
      </div>
    </div>
  )
})

/** "Inside" for a place. Memoised: a world can hold hundreds of places. */
const ParentSelect = memo(function ParentSelect({
  id,
  value,
  onChange,
  options
}: {
  id: string
  value: string | null
  onChange: (v: string | null) => void
  options: PlaceOption[]
}): React.JSX.Element {
  return <Select id={id} value={value} onChange={onChange} options={options} allowNone noneLabel="Not inside another place" />
})

function DuplicateHint({ dups, kind, onOpen }: { dups: NearDuplicate[]; kind: EntryKind; onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void }): React.JSX.Element {
  const d = dups[0]
  // The line is always there (empty when there's nothing to say) so the form never jumps while typing a name.
  if (!d) return <div className="h-6" aria-hidden />
  const other = d.entry
  const otherName = other.name.trim()
  const what = other.kind === kind ? `another ${kindNoun(kind)}` : `a ${kindNoun(other.kind)}`
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
      <span className="min-w-0 truncate">
        {text} Same one?
      </span>
      <button type="button" onClick={() => onOpen(other)} className="shrink-0 font-medium underline-offset-2 hover:underline">
        Open {otherName}
      </button>
    </div>
  )
}

const GroupSection = memo(function GroupSection({
  group,
  fields,
  open,
  onToggle,
  onField
}: {
  group: FieldGroup
  fields: Record<string, string>
  open: boolean
  onToggle: (id: string) => void
  onField: (key: string, v: string) => void
}): React.JSX.Element {
  const keys = group.fields.map((f) => f.key)
  const filled = filledCount(fields, keys)
  return (
    <Section title={group.label} meta={filled ? `${filled} of ${keys.length}` : null} open={open} onToggle={() => onToggle(group.id)}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 @lg:grid-cols-2">
        {group.fields.map((f) => (
          <FieldInput key={f.key} def={f} value={fields[f.key] ?? ''} onField={onField} />
        ))}
      </div>
    </Section>
  )
})

const FieldInput = memo(function FieldInput({ def, value, onField }: { def: FieldDef; value: string; onField: (key: string, v: string) => void }): React.JSX.Element {
  const wide = def.type === 'text'
  return (
    <Field label={def.label} className={wide ? '@lg:col-span-2' : undefined}>
      {(id) =>
        def.key === 'role' ? (
          <Select
            id={id}
            value={value || null}
            onChange={(v) => onField(def.key, v ?? '')}
            options={value && !ROLE_OPTIONS.some((o) => o.value === value) ? [...ROLE_OPTIONS, { value, label: value }] : ROLE_OPTIONS}
            allowNone
            noneLabel="Not set"
            placeholder="Not set"
          />
        ) : wide ? (
          <AutoTextarea id={id} value={value} minRows={2} maxRows={20} placeholder={def.placeholder} onChange={(e) => onField(def.key, e.target.value)} />
        ) : (
          <Input id={id} value={value} placeholder={def.placeholder} onChange={(e) => onField(def.key, e.target.value)} />
        )
      }
    </Field>
  )
})
