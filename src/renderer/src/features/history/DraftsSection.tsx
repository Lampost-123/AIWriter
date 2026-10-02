// The scene's drafts at the top of the Drafts tab: the current one (the text in the page) and the others
// kept beside it, to switch to, rename or delete, and New draft. Owned by the History part.
import { History, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import type { DraftInfo, SceneDrafts } from '@shared/contracts/history'
import { Badge, Button, IconButton, Input, Notice } from '@/components/ui'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { fullDate, relativeTime } from '@/features/generate/format'
import { useNow } from '@/features/generate/parts'
import { deleteDraft, renameDraft, startNewDraft, switchToDraft } from './drafts'
import { wordsLabel } from './historyLogic'
import { openHistory } from './open'

/** The way to the scene's History page from the Drafts tab, beside the toolbar's History. */
export function EarlierVersionsButton({ sceneId }: { sceneId: ID }): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<History size={14} />}
      onClick={() => void openHistory(sceneId)}
      title="History: earlier versions of this scene, to compare with it and restore"
    >
      Earlier versions
    </Button>
  )
}

/** New draft, as a button: used here and in the Drafts tab's empty state. */
export function NewDraftButton({
  sceneId,
  onChange,
  variant = 'ghost'
}: {
  sceneId: ID
  onChange: (d: SceneDrafts) => void
  variant?: 'ghost' | 'secondary'
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      const d = await startNewDraft(sceneId, onChange)
      if (d) onChange(d)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button
      variant={variant}
      size="sm"
      icon={<Plus size={14} />}
      loading={busy}
      onClick={() => void start()}
      title="Start a new draft as a copy of this one, to try the scene another way. The draft you have now is kept as it is."
    >
      New draft
    </Button>
  )
}

/** The way to try history.db again at once when it couldn't be reached, saying it is trying. */
export function TryAgainButton({ onTry }: { onTry: () => Promise<unknown> }): React.JSX.Element {
  const [trying, setTrying] = useState(false)
  const run = (): void => {
    setTrying(true)
    // At least a moment, so a quick answer doesn't just flicker.
    void Promise.all([onTry(), new Promise((r) => setTimeout(r, 400))]).finally(() => setTrying(false))
  }
  return (
    <Button size="sm" variant="secondary" onClick={run} loading={trying}>
      Try again
    </Button>
  )
}

export function DraftsSection({
  sceneId,
  drafts,
  onChange,
  reload,
  tryAgain
}: {
  sceneId: ID
  drafts: SceneDrafts
  onChange: (d: SceneDrafts) => void
  reload: () => void
  /** Loads the drafts again, trying history.db at once. */
  tryAgain: () => Promise<unknown>
}): React.JSX.Element {
  const now = useNow()
  // The current draft is the text in the page, so its words are the page's (as the top bar counts them).
  const pageWords = useApp((s) => s.sceneWords)
  // A new draft is a copy of the scene's text, so it starts once the page has words.
  const canStart = drafts.available && pageWords > 0
  const [working, setWorking] = useState<ID | null>(null)
  const list = drafts.drafts

  const run = async (id: ID, fn: () => Promise<unknown>): Promise<void> => {
    if (working) return
    setWorking(id)
    try {
      await fn()
    } finally {
      setWorking(null)
    }
  }

  return (
    <section aria-label="This scene's drafts">
      <div className="flex h-8 items-center justify-between pl-1.5">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">This scene's drafts</h3>
        {canStart ? <NewDraftButton sceneId={sceneId} onChange={onChange} /> : null}
      </div>
      {!drafts.available ? (
        // Below the words, so they keep the narrow panel's width.
        <Notice>
          {drafts.problem}
          <div className="mt-2">
            <TryAgainButton onTry={tryAgain} />
          </div>
        </Notice>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {list.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                words={d.current && pageWords != null ? pageWords : d.words}
                now={now}
                busy={working === d.id}
                disabled={!!working}
                onSwitch={() =>
                  void run(d.id, async () => {
                    const next = await switchToDraft(sceneId, d, onChange)
                    if (next) onChange(next)
                  })
                }
                onRename={async (name) => {
                  const renamed = await renameDraft(d, name)
                  if (renamed) onChange({ ...drafts, drafts: list.map((x) => (x.id === renamed.id ? { ...x, name: renamed.name } : x)) })
                }}
                onDelete={() =>
                  void run(d.id, async () => {
                    if (await deleteDraft(d, reload)) onChange({ ...drafts, drafts: list.filter((x) => x.id !== d.id) })
                  })
                }
              />
            ))}
          </ul>
          {list.length === 1 ? (
            <p className="px-1.5 pt-1.5 text-[12px] leading-relaxed text-faint">
              {canStart
                ? 'New draft starts a copy to try the scene another way. The draft you have now stays here, to switch back to at any time.'
                : 'New draft starts once the scene has words: it keeps a copy to try the scene another way.'}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

/** When a draft began (New draft) or was put aside; the scene's first draft began with the scene. */
function DraftWhen({ draft, now }: { draft: DraftInfo; now: number }): React.JSX.Element {
  const at = draft.current ? draft.startedAt : draft.keptAt
  return (
    <span className="min-w-0 truncate text-[11.5px] text-faint" title={at ? fullDate(at) : undefined}>
      {!draft.current ? `Kept ${relativeTime(draft.keptAt, now)}` : at ? `Started ${relativeTime(at, now)}` : "The scene's first draft"}
    </span>
  )
}

function DraftRow({
  draft,
  words,
  now,
  busy,
  disabled,
  onSwitch,
  onRename,
  onDelete
}: {
  draft: DraftInfo
  words: number
  now: number
  busy: boolean
  disabled: boolean
  onSwitch: () => void
  onRename: (name: string) => Promise<void>
  onDelete: () => void
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(draft.name)
  // Renaming ends once: Enter or Escape, then the box going away, never save twice (or after Escape).
  const editing = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const renameButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!renaming) return
    input.current?.focus()
    input.current?.select()
  }, [renaming])

  const start = (): void => {
    setName(draft.name)
    editing.current = true
    setRenaming(true)
  }

  const finish = async (save: boolean): Promise<void> => {
    if (!editing.current) return
    editing.current = false
    setRenaming(false)
    if (save && name.trim() !== draft.name) await onRename(name)
    requestAnimationFrame(() => renameButton.current?.focus())
  }

  return (
    <li
      className={cn(
        'rounded-lg border px-2.5 py-2 transition-colors duration-150',
        draft.current ? 'border-accent/25 bg-accent-soft/60' : 'border-transparent hover:bg-surface-2 focus-within:bg-surface-2'
      )}
    >
      <div className="flex h-7 items-center gap-2">
        {renaming ? (
          <Input
            ref={input}
            aria-label={`New name for ${draft.name}`}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void finish(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void finish(true)
              if (e.key === 'Escape') {
                e.stopPropagation()
                void finish(false)
              }
            }}
            className="h-7 min-w-0 flex-1 px-2 text-[13px]"
          />
        ) : (
          <span className="min-w-0 truncate text-[13px] font-medium text-fg" title={draft.name}>
            {draft.name}
          </span>
        )}
        {draft.current && !renaming ? (
          <Badge tone="accent" className="shrink-0 text-[11px]">
            In the page
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 whitespace-nowrap text-[12px] tabular-nums text-muted">{wordsLabel(words)}</span>
      </div>
      {!draft.current && draft.excerpt ? (
        <p className="mt-0.5 line-clamp-2 font-serif text-[12.5px] leading-[1.55] text-muted">{draft.excerpt}</p>
      ) : null}
      <div className="mt-1 flex h-7 items-center gap-1">
        <DraftWhen draft={draft} now={now} />
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton ref={renameButton} size="sm" label={`Rename ${draft.name}`} onClick={start} disabled={disabled}>
            <Pencil size={13} />
          </IconButton>
          {!draft.current ? (
            <>
              <IconButton size="sm" label={`Delete ${draft.name}`} onClick={onDelete} disabled={disabled}>
                <Trash2 size={13} />
              </IconButton>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Switch to ${draft.name}`}
                title={`Put ${draft.name} in the page. The text there now is kept as the draft it is.`}
                onClick={onSwitch}
                loading={busy}
                disabled={disabled && !busy}
                className="ml-1"
              >
                Switch to it
              </Button>
            </>
          ) : null}
        </span>
      </div>
    </li>
  )
}
