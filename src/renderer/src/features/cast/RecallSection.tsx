// Recall, in the Cast tab (Adam, 2026-10-04): where things stand as this scene ends, from the continuity tracker:
// for each character where they are, what they wear and hold, how they are placed, their condition, mood and last
// action; and the scene's time, weather and light. Adam can change any value (click it), take a character out, or
// have the scene read again. A state whose words changed since is shown as out of date, and the writer isn't given it
// until it is read again, so nothing outlives the words it came from. At the cursor (Adam, 2026-10-07): the same at
// any point in the scene, following the cursor, from the checkpoints kept inside it (worked out there on request).
// Each value's words show when the pointer rests on it. Piece by piece (step 2b, Adam 2026-10-07): each piece of
// clothing is its own line ("Wearing: boots off, by the door"), and so is each thing in the place ("the door: barred
// from inside"); each can be changed, taken out (left empty) or added, like any other value.
import { useCallback, useEffect, useState } from 'react'
import type { RecallAtView, RecallChange, RecallView } from '@shared/contracts/recall'
import {
  clothesOf,
  pieceSource,
  STATE_FIELDS,
  STATE_LABELS,
  sourceKey,
  thingKey,
  thingsOf,
  type CharacterState,
  type StateField,
  type StateSource,
  type StateSources
} from '@shared/continuity'
import { pieceText } from '@shared/stageItems'
import type { ID } from '@shared/types'
import { Button, Input, Notice, Spinner } from '@/components/ui'
import { Plus, RefreshCw, X } from '@/components/ui/icons'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { wordsToCursor } from '@/features/edits/session'

const SCENE_FIELDS = [
  ['time', 'Time'],
  ['weather', 'Weather'],
  ['light', 'Light']
] as const

/** How often Recall at the cursor looks where the cursor is (nothing is asked of the model). */
const FOLLOW_MS = 700

/** A field's label for Adam: "Where", "Wearing", "Position"... */
const labelOf = (f: StateField): string => STATE_LABELS[f].charAt(0).toUpperCase() + STATE_LABELS[f].slice(1)

const plainError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (\w+Error: )?/, '') : String(e)

type Mode = 'end' | 'cursor'

export function RecallSection({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('end')
  const [view, setView] = useState<RecallView | null>(null)
  const [at, setAt] = useState<RecallAtView | null>(null)
  /** The scene's words up to the cursor; null while the page isn't showing this scene. */
  const [words, setWords] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = (): void =>
      void api
        .getRecall(sceneId)
        .then((v) => live && setView(v))
        .catch((e: unknown) => live && setError(plainError(e)))
    load()
    // Brought up to date on its own after the memory read the scene.
    const off = onEvent('recall:changed', (p) => p.sceneId === sceneId && load())
    return () => {
      live = false
      off()
    }
  }, [sceneId])

  // At the cursor: follows the cursor as it moves and the words as they change.
  useEffect(() => {
    setAt(null)
    setWords(null)
    if (mode !== 'cursor') return
    let live = true
    let last: string | null | undefined
    const look = (): void => {
      const w = wordsToCursor(sceneId)
      if (w === last) return
      last = w
      setWords(w)
      if (w === null) return setAt(null)
      void api
        .getRecallAt(sceneId, w)
        .then((v) => live && last === w && setAt(v))
        .catch((e: unknown) => live && setError(plainError(e)))
    }
    look()
    const timer = setInterval(look, FOLLOW_MS)
    const off = onEvent('recall:changed', (p) => {
      if (p.sceneId !== sceneId) return
      last = undefined
      look()
    })
    return () => {
      live = false
      clearInterval(timer)
      off()
    }
  }, [mode, sceneId])

  const run = useCallback(async <T,>(work: () => Promise<T>, done: (v: T) => void): Promise<void> => {
    setError(null)
    try {
      done(await work())
    } catch (e) {
      setError(plainError(e))
    }
  }, [])

  const readAgain = (): void => {
    setBusy(true)
    const work =
      mode === 'end'
        ? run(() => api.refreshRecall(sceneId), setView)
        : words === null
          ? Promise.resolve()
          : run(() => api.refreshRecallAt(sceneId, words), (v) => wordsToCursor(sceneId) === words && setAt(v))
    void work.finally(() => setBusy(false))
  }
  const change = (c: RecallChange): Promise<void> => run(() => api.setRecallValue(sceneId, c), setView)
  const remove = (name: string): Promise<void> => run(() => api.removeRecallCharacter(sceneId, name), setView)

  const atCursor = mode === 'cursor'
  const state = atCursor ? (at?.state ?? null) : (view?.state ?? null)
  const canRead = atCursor ? words !== null && !at?.exact : true
  return (
    <section aria-label="Recall" data-recall>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="flex-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          {atCursor ? 'Recall: at the cursor' : 'Recall: as this scene ends'}
        </h3>
        {canRead ? (
          <Button size="sm" variant="ghost" icon={busy ? <Spinner size={13} /> : <RefreshCw size={13} />} disabled={busy} onClick={readAgain}>
            {atCursor ? 'Work it out here' : state ? 'Read again' : 'Work it out'}
          </Button>
        ) : null}
      </div>
      <div className="mb-2 flex gap-1" role="group" aria-label="Where in the scene">
        <ModeButton on={!atCursor} onClick={() => setMode('end')}>
          Scene end
        </ModeButton>
        <ModeButton on={atCursor} onClick={() => setMode('cursor')}>
          At the cursor
        </ModeButton>
      </div>
      {error ? (
        <div className="mb-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      {atCursor ? (
        words === null ? (
          <p className="text-[12.5px] leading-relaxed text-muted">Click in this scene’s words to see where things stand at that point.</p>
        ) : !state ? (
          <p className="text-[12.5px] leading-relaxed text-muted">
            Not worked out at the cursor yet. Work it out here reads the words up to the cursor: where each character is, what they wear and hold,
            and how they are placed.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[12px] text-faint" data-recall-at={at?.exact ? 'exact' : 'earlier'}>
              {at?.exact
                ? 'Where things stand at the cursor. To put a value right, use Scene end.'
                : 'As worked out a little earlier in the scene. Work it out here for exactly this point.'}
            </p>
            <StateView sceneId={sceneId} state={state} />
          </>
        )
      ) : !view ? null : !state ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Not worked out yet. It is worked out once the memory has read the scene, or now with Work it out: where each character is, what they
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
          <StateView sceneId={sceneId} state={state} onChange={change} onRemove={remove} />
        </>
      )}
    </section>
  )
}

function ModeButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-medium transition-[background-color,color] duration-(--dur-quick)',
        on ? 'bg-fg text-bg' : 'bg-surface text-muted shadow-[inset_0_0_0_1px_var(--line)] hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}

/** A state's values: to change (with onChange) or only to read. */
function StateView({
  sceneId,
  state,
  onChange,
  onRemove
}: {
  sceneId: ID
  state: NonNullable<RecallView['state']>
  onChange?: (c: RecallChange) => Promise<void>
  onRemove?: (name: string) => Promise<void>
}): React.JSX.Element {
  const things = thingsOf(state)
  return (
    <>
      <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
        {SCENE_FIELDS.map(([f, label]) => (
          <Row
            key={f}
            label={label}
            value={state[f]}
            from={wordsOf(state.said?.[sourceKey(null, f)], sceneId)}
            onSave={onChange && ((value) => onChange({ field: f, value }))}
          />
        ))}
      </dl>
      {things.length || onChange ? (
        <div className="mb-2" data-recall-things>
          <p className="mb-0.5 text-[11.5px] font-medium text-faint">Things here</p>
          {things.length ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
              {things.map((t) => (
                <Row
                  key={t.name}
                  label={t.name}
                  value={t.state}
                  from={wordsOf(state.said?.[thingKey(t.name)], sceneId)}
                  onSave={onChange && ((value) => onChange({ field: 'things', item: t.name, value }))}
                />
              ))}
            </dl>
          ) : null}
          {onChange ? (
            <AddRow label="Add a thing" placeholder="the door: locked" onAdd={(value) => onChange({ field: 'things', item: '', value })} />
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {state.characters.map((c) => (
          <li key={c.name}>
            <CharacterCard
              character={c}
              said={state.said}
              sceneId={sceneId}
              onChange={onChange && ((field, value) => onChange({ character: c.name, field, value }))}
              onPiece={onChange && ((item, value) => onChange({ character: c.name, field: 'clothes', item, value }))}
              onRemove={onRemove && (() => onRemove(c.name))}
            />
          </li>
        ))}
      </ul>
    </>
  )
}

/** The words a value came from, for its tooltip. */
function wordsOf(s: StateSource | undefined, sceneId: ID): string | undefined {
  return s ? `From the words: “${s.quote}”${s.sceneId === sceneId ? '' : ' (in an earlier scene)'}` : undefined
}

function CharacterCard({
  character,
  said,
  sceneId,
  onChange,
  onPiece,
  onRemove
}: {
  character: CharacterState
  said: StateSources | undefined
  sceneId: ID
  onChange?: (field: StateField, value: string) => Promise<void>
  /** A piece of clothing changed (`item` its name, '' for a new one; value '' takes it out). */
  onPiece?: (item: string, value: string) => Promise<void>
  onRemove?: () => Promise<void>
}): React.JSX.Element {
  const row = (f: StateField): React.JSX.Element => (
    <Row
      key={f}
      label={labelOf(f)}
      value={character[f] ?? ''}
      from={wordsOf(said?.[sourceKey(character.name, f)], sceneId)}
      onSave={onChange && ((value) => onChange(f, value))}
    />
  )
  const [first, ...rest] = STATE_FIELDS
  return (
    <div className="rounded-lg border border-line px-2.5 py-2" data-recall-character={character.name}>
      <div className="mb-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{character.name}</span>
        {onRemove ? (
          <button
            type="button"
            aria-label={`Take ${character.name} out`}
            title="Take out (until this scene’s words change)"
            onClick={() => void onRemove()}
            className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
        {row(first)}
        {/* Each piece of clothing on its own line, right after where they are. */}
        {clothesOf(character).map((p) => (
          <Row
            key={`piece:${p.name}`}
            label="Wearing"
            value={pieceText(p)}
            from={wordsOf(pieceSource(said, character.name, p.name), sceneId)}
            onSave={onPiece && ((value) => onPiece(p.name, value))}
          />
        ))}
        {rest.map(row)}
      </dl>
      {onPiece ? (
        <AddRow label="Add a piece of clothing" placeholder="boots off, by the door" onAdd={(value) => onPiece('', value)} />
      ) : null}
    </div>
  )
}

/** A button that turns into a box to add one more line (Enter adds it, Esc doesn't). */
function AddRow({
  label,
  placeholder,
  onAdd
}: {
  label: string
  placeholder: string
  onAdd: (value: string) => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const save = (): void => {
    setOpen(false)
    const v = draft.trim()
    setDraft('')
    if (v) void onAdd(v)
  }
  return open ? (
    <Input
      autoFocus
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') {
          e.stopPropagation()
          setDraft('')
          setOpen(false)
        }
      }}
      className="mt-1 h-6 px-1.5 text-[12.5px]"
    />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mt-1 inline-flex items-center gap-1 rounded px-1 -mx-1 text-[12px] text-faint hover:bg-surface-2 hover:text-fg"
    >
      <Plus size={12} />
      {label}
    </button>
  )
}

/**
 * One value: its label, and the value as a button that turns into a box to change it (Enter keeps it, Esc doesn't);
 * without onSave, only to read. `from`: the words it came from, shown when the pointer rests on it.
 */
function Row({
  label,
  value,
  from,
  onSave
}: {
  label: string
  value: string
  from?: string
  onSave?: (value: string) => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const save = (): void => {
    setEditing(false)
    if (draft.trim() !== value) void onSave?.(draft.trim())
  }
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0">
        {!onSave ? (
          <span title={from} className={cn('block break-words', value ? 'text-fg' : 'text-faint')}>
            {value || '—'}
          </span>
        ) : editing ? (
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
            title={from}
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
