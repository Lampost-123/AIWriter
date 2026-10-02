// The small form "Add to memory" opens beside the selected words: a new entry (named after a name in
// the words, with the words as its description) or a change to one the words name (the words as its
// note, pinned to this scene). Saving makes it Adam's and offers Undo; nothing asks "are you sure?".
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EntryKind, ID } from '@shared/types'
import type { SceneNames } from '@shared/contracts/manuscript'
import { KIND_LABELS } from '@shared/fields'
import { Button, Field, Input, Select, Textarea, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { Segmented } from '@/features/generate/parts'
import { newEntryName } from '@/features/world/entryActions'
import { displayName, kindWord } from '@/features/peek/entryView'
import { addedChangeMessage, addedEntryMessage, NEW_KINDS, type AddPrefill } from './addToMemoryLogic'

type Mode = AddPrefill['mode']

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'new', label: 'Something new' },
  { value: 'change', label: 'A change' }
]

const KIND_OPTIONS = NEW_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k].one }))

/** A toast for something just added, with Undo (see "Needs from integration": Open belongs here too). */
function announceAdded(message: string, undo: () => Promise<unknown>): void {
  toast(message, {
    tone: 'success',
    action: {
      label: 'Undo',
      run: () => void undo().catch((e: Error) => toast(`Couldn’t undo that. ${e.message}`, { tone: 'danger' }))
    }
  })
}

export function AddToMemoryForm({
  start,
  names,
  onDone
}: {
  start: AddPrefill
  names: SceneNames
  /** Closes the form: `added` after saving, false for Cancel. */
  onDone: (added: boolean) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(start.mode)
  const [kind, setKind] = useState<EntryKind>(start.kind)
  const [name, setName] = useState(start.name)
  const [description, setDescription] = useState(start.description)
  const [entryId, setEntryId] = useState<ID | null>(start.entryId)
  const [note, setNote] = useState(start.note)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // The entries a change can be to: those the words name first, then the rest by name.
  const options = useMemo(() => {
    const live = names.entries.filter((e) => e.kind !== 'thread' && !e.absent)
    const named = start.named.map((id) => live.find((e) => e.id === id)).filter((e) => !!e)
    const rest = live.filter((e) => !start.named.includes(e.id)).sort((a, b) => displayName(a).localeCompare(displayName(b)))
    return [...named, ...rest].map((e) => ({ value: e.id, label: displayName(e), hint: kindWord(e.kind) }))
  }, [names, start.named])
  const target = names.entries.find((e) => e.id === entryId)

  // The box to type in first: the name of something new, or what changed.
  useEffect(() => {
    const t = requestAnimationFrame(() => (mode === 'new' ? firstRef.current?.select() : noteRef.current?.focus()))
    return () => cancelAnimationFrame(t)
  }, [mode])

  const save = async (): Promise<void> => {
    if (busy) return
    setError(null)
    if (mode === 'change' && !target) return setError('Choose who or what changed.')
    if (mode === 'change' && !note.trim()) return setError('Say what changed.')
    setBusy(true)
    try {
      if (mode === 'new') {
        const e = await api.createEntry(kind, {
          name: name.trim() || newEntryName(kind),
          description: description.trim(),
          originStoryId: names.storyId
        })
        useApp.getState().bumpEntries()
        announceAdded(addedEntryMessage(displayName(e), kind), () => api.deleteEntry(e.id).then(() => useApp.getState().bumpEntries()))
      } else if (target) {
        const c = await api.createChange({
          kind: 'update',
          payload: { note: note.trim() },
          entryId: target.id,
          anchor: 'scene',
          sceneId: names.sceneId,
          storyId: names.storyId
        })
        announceAdded(addedChangeMessage(displayName(target), note), () => api.deleteChange(c.id))
      }
      onDone(true)
    } catch (e) {
      setError(`Couldn’t add it. ${(e as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <form
      aria-label="Add to memory"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        // Ctrl+Enter saves from any box (and never reaches the scene's own Ctrl+Enter).
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div>
        <h3 className="truncate text-[13.5px] font-semibold text-fg">
          {mode === 'new' ? `New ${KIND_LABELS[kind].one.toLowerCase()}` : target ? `A change to ${displayName(target)}` : 'A change'}
        </h3>
        <p className="mt-0.5 text-[12px] text-faint">
          {mode === 'new' ? 'The words become its description; fill in the rest on its page.' : `Pinned to this scene (${names.label}).`}
        </p>
      </div>
      <Segmented value={mode} onChange={setMode} options={MODE_OPTIONS} label="What to add" className="w-full" />
      {mode === 'new' ? (
        <>
          <div className="grid grid-cols-[1fr_1.6fr] gap-2">
            <Field label="Kind">
              {(id) => <Select id={id} value={kind} onChange={(v) => v && setKind(v as EntryKind)} options={KIND_OPTIONS} />}
            </Field>
            <Field label="Name">
              {(id) => (
                <Input id={id} ref={firstRef} value={name} placeholder={newEntryName(kind)} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
          </div>
          <Field label="Description">
            {(id) => <Textarea id={id} value={description} minRows={3} maxRows={8} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </>
      ) : (
        <>
          <Field label="Who or what changed">
            {(id) => <Select id={id} value={entryId} onChange={setEntryId} options={options} placeholder="Choose…" />}
          </Field>
          <Field label="What changed">
            {(id) => <Textarea id={id} ref={noteRef} value={note} minRows={3} maxRows={8} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </>
      )}
      {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Add to memory
        </Button>
      </div>
    </form>
  )
}
