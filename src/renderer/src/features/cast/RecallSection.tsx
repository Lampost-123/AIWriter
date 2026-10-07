// Recall, in the Cast tab (Adam, 2026-10-04): where things stand as this scene ends, from the continuity tracker:
// for each character where they are, what they wear and hold, how they are placed, their condition, mood and last
// action; and the scene's time, weather and light. Adam can change any value (click it), take a character out, or
// have the scene read again. A state whose words changed since is shown as out of date, and the writer isn't given it
// until it is read again, so nothing outlives the words it came from.
import { useCallback, useEffect, useState } from 'react'
import type { RecallChange, RecallView } from '@shared/contracts/recall'
import { STATE_FIELDS, STATE_LABELS, type CharacterState, type StateField } from '@shared/continuity'
import type { ID } from '@shared/types'
import { Button, Input, Notice, Spinner } from '@/components/ui'
import { RefreshCw, X } from '@/components/ui/icons'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

const SCENE_FIELDS = [
  ['time', 'Time'],
  ['weather', 'Weather'],
  ['light', 'Light']
] as const

/** A field's label for Adam: "Where", "Wearing", "Position"... */
const labelOf = (f: StateField): string => STATE_LABELS[f].charAt(0).toUpperCase() + STATE_LABELS[f].slice(1)

const plainError = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (\w+Error: )?/, '') : String(e))

export function RecallSection({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const [view, setView] = useState<RecallView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void api
      .getRecall(sceneId)
      .then((v) => live && setView(v))
      .catch((e: unknown) => live && setError(plainError(e)))
    return () => {
      live = false
    }
  }, [sceneId])

  const run = useCallback(async (work: () => Promise<RecallView>): Promise<void> => {
    setError(null)
    try {
      setView(await work())
    } catch (e) {
      setError(plainError(e))
    }
  }, [])

  const readAgain = (): void => {
    setBusy(true)
    void run(() => api.refreshRecall(sceneId)).finally(() => setBusy(false))
  }
  const change = (c: RecallChange): Promise<void> => run(() => api.setRecallValue(sceneId, c))
  const remove = (name: string): Promise<void> => run(() => api.removeRecallCharacter(sceneId, name))

  const state = view?.state ?? null
  return (
    <section aria-label="Recall" data-recall>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="flex-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Recall: as this scene ends</h3>
        <Button size="sm" variant="ghost" icon={busy ? <Spinner size={13} /> : <RefreshCw size={13} />} disabled={busy} onClick={readAgain}>
          {state ? 'Read again' : 'Work it out'}
        </Button>
      </div>
      {error ? (
        <div className="mb-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      {!view ? null : !state ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Not worked out yet. It is worked out before the next scene is drafted, or now with Work it out: where each character is, what they
          wear and hold, how they are placed, and how they are.
        </p>
      ) : (
        <>
          {!view.current ? (
            <p className="mb-2 text-[12.5px] leading-relaxed text-muted" data-recall-stale>
              <span className="font-medium text-fg">Out of date:</span> the words changed since (here or in an earlier scene). The writer isn’t
              given this until it is read again.
            </p>
          ) : view.edited ? (
            <p className="mb-2 text-[12px] text-faint">Includes your changes. They stay until this scene’s words change.</p>
          ) : null}
          <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
            {SCENE_FIELDS.map(([f, label]) => (
              <Row key={f} label={label} value={state[f]} onSave={(value) => change({ field: f, value })} />
            ))}
          </dl>
          <ul className="flex flex-col gap-2">
            {state.characters.map((c) => (
              <li key={c.name}>
                <CharacterCard character={c} onChange={(field, value) => change({ character: c.name, field, value })} onRemove={() => remove(c.name)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function CharacterCard({
  character,
  onChange,
  onRemove
}: {
  character: CharacterState
  onChange: (field: StateField, value: string) => Promise<void>
  onRemove: () => Promise<void>
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line px-2.5 py-2" data-recall-character={character.name}>
      <div className="mb-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{character.name}</span>
        <button
          type="button"
          aria-label={`Take ${character.name} out`}
          title="Take out (until this scene’s words change)"
          onClick={() => void onRemove()}
          className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
        {STATE_FIELDS.map((f) => (
          <Row key={f} label={labelOf(f)} value={character[f]} onSave={(value) => onChange(f, value)} />
        ))}
      </dl>
    </div>
  )
}

/** One value: its label, and the value as a button that turns into a box to change it (Enter keeps it, Esc doesn't). */
function Row({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => Promise<void> }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const save = (): void => {
    setEditing(false)
    if (draft.trim() !== value) void onSave(draft.trim())
  }
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0">
        {editing ? (
          <Input
            autoFocus
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setDraft(value)
                setEditing(false)
              }
            }}
            className="h-6 px-1.5 text-[12.5px]"
          />
        ) : (
          <button
            type="button"
            aria-label={`${label}: ${value || 'not known'}. Change`}
            onClick={() => {
              setDraft(value)
              setEditing(true)
            }}
            className={cn('w-full break-words rounded px-1 -mx-1 text-left hover:bg-surface-2', value ? 'text-fg' : 'text-faint')}
          >
            {value || '—'}
          </button>
        )}
      </dd>
    </>
  )
}
