// The Context tab beside a scene: the briefing a draft would get right now, before Generate is
// pressed. What the story knows, how full the model's room is, each part in the order it matters
// (open one to read it, or choose full or short), and the entries from the world with why each is
// there: pin one for this scene, this story or every scene, or leave it out, and bring it back.
import * as M from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, EyeOff, MoreHorizontal, Pin, PinOff, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { BlockMode, ContextBlock, ContextEntry, ContextPreview, Entry, ID, PinScope } from '@shared/types'
import { Button, Notice, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { RowMenuItem, RowMenuSeparator } from '@/features/binder/RowMenu'
import { formatContext, formatNumber } from '@/features/generate/format'
import { Segmented, Skeleton, useDelayed } from '@/features/generate/parts'
import { CastPicker } from '@/features/inspector/CastPicker'
import {
  BLOCK_STATE_WORDS,
  MODE_HINTS,
  NOT_READY,
  PIN_WORDS,
  blockState,
  blockStateNote,
  briefingEntries,
  budgetView,
  entryDetail,
  hiddenScope,
  orderBlocks,
  pinCalls,
  quietReason,
  scopeIdFor,
  withMode,
  withNewPin,
  withPin
} from './contextLogic'
import { StorySoFar } from './StorySoFar'
import { useContextPreview } from './useContextPreview'

/** The parts Adam had open for each scene this session. */
const openParts = new Map<ID, Set<string>>()

const MODE_OPTIONS: { value: BlockMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'full', label: 'Full' },
  { value: 'short', label: 'Short' }
]

const SCOPES: PinScope[] = ['scene', 'story', 'world']
/** How far a pin reaches: a pin for every scene reaches furthest. */
const REACH: Record<PinScope, number> = { scene: 0, story: 1, world: 2 }

const kindWord = (e: Pick<ContextEntry, 'kind'>): string => KIND_LABELS[e.kind]?.one ?? 'Entry'
const nameOf = (e: Pick<ContextEntry, 'name'>): string => e.name.trim() || 'Unnamed'

export function ContextPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  // Keyed by scene, so nothing from one scene's briefing can show for the next.
  return <ContextView key={sceneId} sceneId={sceneId} />
}

function ContextView({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const { preview, error, refreshing, patch, retry } = useContextPreview(sceneId)
  const slow = useDelayed(!preview && !error, 250)

  if (!preview) {
    if (error) {
      return (
        <div className="p-4">
          <Notice
            tone={error === NOT_READY ? 'neutral' : 'danger'}
            action={
              <Button size="sm" onClick={retry}>
                Try again
              </Button>
            }
          >
            {error === NOT_READY
              ? "The briefing for this scene can't be shown yet in this version of AI Write."
              : `Couldn't work out this scene's briefing. ${error}`}
          </Notice>
        </div>
      )
    }
    return (
      <div aria-busy className={cn('flex flex-col gap-3 px-4 pt-4 transition-opacity duration-150', slow ? 'opacity-100' : 'opacity-0')}>
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-[74px] w-full rounded-lg" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  return <Briefing sceneId={sceneId} preview={preview} error={error} refreshing={refreshing} patch={patch} retry={retry} />
}

function Briefing({
  sceneId,
  preview,
  error,
  refreshing,
  patch,
  retry
}: {
  sceneId: ID
  preview: ContextPreview
  error: string | null
  refreshing: boolean
  patch: (fn: (p: ContextPreview) => ContextPreview) => void
  retry: () => void
}): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const navigate = useApp((s) => s.navigate)
  const blocks = useMemo(() => orderBlocks(preview.blocks), [preview.blocks])
  const { included, removed } = useMemo(() => briefingEntries(preview, new Map()), [preview])
  const droppedBlocks = useMemo(() => new Set(preview.blocks.filter((b) => b.dropped).map((b) => b.id)), [preview.blocks])
  const [open, setOpenState] = useState<Set<string>>(() => openParts.get(sceneId) ?? new Set())
  const showRefreshing = useDelayed(refreshing, 400)

  const toggle = (id: string): void =>
    setOpenState((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      openParts.set(sceneId, n)
      return n
    })

  // ---------- Changes, shown straight away and then worked out again ----------

  const failed = useCallback((e: unknown, what: string) => {
    useApp.getState().bumpBriefing()
    toast(`Couldn't ${what}. ${quietReason(e)}`, { tone: 'danger' })
  }, [])

  const setMode = async (block: ContextBlock, mode: BlockMode): Promise<void> => {
    patch((p) => ({ ...p, blocks: withMode(p.blocks, block.id, mode) }))
    try {
      await api.setBlockMode(sceneId, block.id, mode)
      useApp.getState().bumpBriefing()
    } catch (e) {
      failed(e, `change how “${block.title}” is sent`)
    }
  }

  const runPins = async (entryId: ID, calls: { scope: PinScope; action: 'pin' | 'hide' | null }[]): Promise<void> => {
    for (const c of calls) await api.setPin(entryId, c.scope, scopeIdFor(c.scope, sceneId, storyId), c.action)
  }

  const pinFor = async (entry: Pick<ContextEntry, 'entryId' | 'name' | 'kind' | 'pinned'>, scope: PinScope): Promise<void> => {
    if (scope === 'story' && !storyId) return
    patch((p) => ({ ...p, entries: withNewPin(p.entries ?? [], entry, scope) }))
    try {
      await runPins(entry.entryId, pinCalls(entry.pinned, scope))
      useApp.getState().bumpBriefing()
      // Narrowing a pin takes the entry out of other scenes' briefings: say so, with the way back.
      const was = entry.pinned
      if (was && REACH[was] > REACH[scope]) {
        toast(`${nameOf(entry)} is pinned for ${PIN_WORDS[scope]} now, no longer for ${PIN_WORDS[was]}.`, {
          action: {
            label: 'Undo',
            run: () =>
              void runPins(entry.entryId, pinCalls(scope, was))
                .then(() => useApp.getState().bumpBriefing())
                .catch((e: unknown) => failed(e, `pin ${nameOf(entry)} again`))
          }
        })
      }
    } catch (e) {
      failed(e, `pin ${nameOf(entry)}`)
    }
  }

  const unpin = async (entry: ContextEntry): Promise<void> => {
    if (!entry.pinned) return
    const scope = entry.pinned
    patch((p) => ({ ...p, entries: withPin(p.entries ?? [], entry.entryId, scope, null) }))
    try {
      await runPins(entry.entryId, [{ scope, action: null }])
      useApp.getState().bumpBriefing()
    } catch (e) {
      failed(e, `unpin ${nameOf(entry)}`)
    }
  }

  const leaveOut = async (entry: ContextEntry): Promise<void> => {
    patch((p) => ({ ...p, entries: withPin(p.entries ?? [], entry.entryId, 'scene', 'hide') }))
    try {
      // Leaving out replaces a pin for this scene, so Undo puts that pin back.
      await runPins(entry.entryId, [{ scope: 'scene', action: 'hide' }])
      useApp.getState().bumpBriefing()
      const before: 'pin' | null = entry.pinned === 'scene' ? 'pin' : null
      toast(`${nameOf(entry)} is left out of this scene's briefing.`, {
        action: {
          label: 'Undo',
          run: () =>
            void runPins(entry.entryId, [{ scope: 'scene', action: before }])
              .then(() => useApp.getState().bumpBriefing())
              .catch((e: unknown) => failed(e, `bring ${nameOf(entry)} back`))
        }
      })
    } catch (e) {
      failed(e, `leave ${nameOf(entry)} out`)
    }
  }

  const bringBack = async (entry: Pick<ContextEntry, 'entryId' | 'name' | 'why'>): Promise<void> => {
    const scope = hiddenScope(entry)
    patch((p) => ({ ...p, entries: withPin(p.entries ?? [], entry.entryId, scope, null) }))
    try {
      await runPins(entry.entryId, [{ scope, action: null }])
      useApp.getState().bumpBriefing()
      // Kept out of the whole story or every scene: bringing it back reaches those scenes too, so say so.
      if (scope !== 'scene') toast(`${nameOf(entry)} is back in the briefing for ${PIN_WORDS[scope]}.`)
    } catch (e) {
      failed(e, `bring ${nameOf(entry)} back`)
    }
  }

  const openEntry = (e: Pick<ContextEntry, 'entryId' | 'kind'>): void =>
    navigate({ kind: 'entries', entryKind: e.kind, entryId: e.entryId })

  const allOpen = blocks.length > 0 && blocks.every((b) => open.has(b.id))
  const knows = preview.knows?.trim()

  return (
    <div className="flex animate-fade-in flex-col gap-5 px-4 pb-12 pt-4">
      {knows ? <p className="text-[13px] leading-relaxed text-muted">{knows}</p> : null}

      <div className="flex flex-col gap-2">
        <BudgetBar preview={preview} busy={showRefreshing} />
        {error ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Couldn't bring this up to date. {error}{' '}
            <button type="button" onClick={retry} className="rounded font-medium text-accent hover:underline">
              Try again
            </button>
          </p>
        ) : null}
      </div>

      <Section
        title="The briefing, part by part"
        action={
          blocks.length ? (
            <button
              type="button"
              className="rounded text-[12px] font-medium text-accent hover:underline"
              onClick={() => {
                const n = allOpen ? new Set<string>() : new Set(blocks.map((b) => b.id))
                openParts.set(sceneId, n)
                setOpenState(n)
              }}
            >
              {allOpen ? 'Close all' : 'Open all'}
            </button>
          ) : null
        }
      >
        <p className="-mt-1 text-[12px] leading-relaxed text-faint">
          Most important first. When room is short, the parts lower down are shortened or left out first.
        </p>
        <div className="flex flex-col gap-1.5">
          {blocks.map((b) => (
            <BlockRow
              key={b.id}
              sceneId={sceneId}
              block={b}
              open={open.has(b.id)}
              onToggle={() => toggle(b.id)}
              onMode={(m) => void setMode(b, m)}
            />
          ))}
        </div>
      </Section>

      <Section
        title="From your world"
        action={included.length ? <span className="text-[12px] tabular-nums text-faint">{included.length}</span> : null}
      >
        {included.length ? (
          <ul className="flex flex-col" aria-label="Entries in the briefing">
            {included.map((e) => (
              <EntryRow
                key={e.entryId}
                entry={e}
                leftOutForRoom={!!e.blockId && droppedBlocks.has(e.blockId)}
                canPinStory={!!storyId}
                onOpen={() => openEntry(e)}
                onPin={(scope) => void pinFor(e, scope)}
                onUnpin={() => void unpin(e)}
                onLeaveOut={() => void leaveOut(e)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">
            Nothing from your world yet. Add characters and a place to the scene card, or name them in the beats.
          </p>
        )}
        <PinAnother sceneId={sceneId} exclude={preview.entries ?? []} onPick={(e) => void pinFor({ ...e, pinned: null }, 'scene')} />
      </Section>

      {removed.length ? (
        <Section title="Left out by you">
          <ul className="flex flex-col gap-1" aria-label="Entries left out of the briefing">
            {removed.map((e) => (
              <li key={e.entryId} className="flex min-h-9 items-center gap-2 animate-fade-in">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => openEntry(e)}
                    className="block max-w-full truncate rounded text-left text-[13px] text-muted hover:text-fg hover:underline"
                  >
                    {nameOf(e)}
                  </button>
                  <div className="truncate text-[12px] text-faint">{e.why}</div>
                </div>
                <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => void bringBack(e)}>
                  Bring back<span className="sr-only"> {nameOf(e)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}

// ---------- The token bar ----------

function BudgetBar({ preview, busy }: { preview: ContextPreview; busy: boolean }): React.JSX.Element {
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const navigate = useApp((s) => s.navigate)
  const { used, available, contextLength, reserved } = preview.budget
  const view = budgetView(preview.budget)
  const known = !!writer?.contextLength
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="flex items-center gap-1.5 whitespace-nowrap font-medium text-fg">
          Briefing size
          <span className="flex w-3.5 justify-center text-faint" aria-hidden>
            {busy ? <Spinner size={11} /> : null}
          </span>
        </span>
        <span className={cn('font-medium tabular-nums', view.tight ? 'text-ai' : 'text-fg')}>{view.percentText}</span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-label="Briefing size"
        aria-valuemin={0}
        aria-valuemax={available}
        aria-valuenow={Math.min(used, available)}
        aria-valuetext={`${formatNumber(used)} of ${formatNumber(available)} tokens, ${view.percentText}`}
      >
        <div
          className={cn('h-full rounded-full transition-[width,background-color] duration-200', view.tight ? 'bg-ai' : 'bg-accent')}
          style={{ width: `${view.fill}%` }}
        />
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
        <span className="tabular-nums text-muted">
          {formatNumber(used)} of {formatNumber(available)} tokens.
        </span>{' '}
        {!writer ? (
          <>
            No writer model chosen yet, so this assumes one that reads {formatContext(contextLength)} tokens.{' '}
            <button
              type="button"
              onClick={() => navigate({ kind: 'settings', tab: 'models' })}
              className="rounded font-medium text-accent hover:underline"
            >
              Choose one
            </button>
          </>
        ) : !known ? (
          `How much ${writer.label || 'the writer model'} can read isn't known, so this assumes ${formatContext(contextLength)} tokens.`
        ) : (
          `${writer.label || 'The writer model'} reads ${formatContext(contextLength)} tokens; ` +
          `${formatNumber(reserved)} of them are kept for its reply.`
        )}
      </p>
    </div>
  )
}

// ---------- Parts of the briefing ----------

function BlockRow({
  sceneId,
  block,
  open,
  onToggle,
  onMode
}: {
  sceneId: ID
  block: ContextBlock
  open: boolean
  onToggle: () => void
  onMode: (m: BlockMode) => void
}): React.JSX.Element {
  const bodyId = useId()
  const state = blockState(block)
  const mode = block.mode ?? 'auto'
  const text = <BlockText text={block.text} />
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line', block.dropped ? 'bg-surface-2/60' : 'bg-surface')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        title={`${block.title}. ${blockStateNote(block)}`}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-offset-[-2px]"
      >
        <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform duration-150', open && 'rotate-90')} />
        <span className={cn('min-w-0 flex-1 truncate text-[13px] font-medium', block.dropped ? 'text-faint' : 'text-fg')}>
          {block.title}
        </span>
        {state !== 'full' ? (
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-px text-[11px] font-medium',
              state === 'short' ? 'bg-surface-2 text-muted' : 'text-faint'
            )}
          >
            {BLOCK_STATE_WORDS[state]}
          </span>
        ) : null}
        <span className="w-[52px] shrink-0 text-right text-[12px] tabular-nums text-faint">
          {block.dropped ? '—' : formatNumber(block.tokens)}
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-3 border-t border-line px-3 pb-3 pt-2.5">
          <p className="text-[12px] leading-relaxed text-faint">{blockStateNote(block)}</p>
          {block.hasShort ? (
            <div className="flex flex-col gap-1">
              <Segmented value={mode} onChange={onMode} options={MODE_OPTIONS} label={`How “${block.title}” is sent`} className="w-full" />
              <p className="text-[12px] leading-relaxed text-faint">{MODE_HINTS[mode]}</p>
            </div>
          ) : null}
          <div className={cn(block.dropped && 'opacity-70')}>
            {block.id === 'story-so-far' ? (
              <StorySoFar sceneId={sceneId} text={block.text}>
                {text}
              </StorySoFar>
            ) : (
              text
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** A part as readable text: the "### Name" lines the AI gets show as small headings. */
function BlockText({ text }: { text: string }): React.JSX.Element {
  if (!text.trim()) return <p className="text-[12.5px] text-faint">Nothing in this part for this scene.</p>
  const parts = text.split(/^#{2,3} (.+)$/m)
  return (
    <div className="select-text whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-fg">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <div key={i} className="mt-1 font-semibold first:mt-0">
            {part}
          </div>
        ) : (
          <span key={i}>{i > 0 ? part.replace(/^\n/, '') : part}</span>
        )
      )}
    </div>
  )
}

// ---------- Entries ----------

function EntryRow({
  entry,
  leftOutForRoom,
  canPinStory,
  onOpen,
  onPin,
  onUnpin,
  onLeaveOut
}: {
  entry: ContextEntry
  leftOutForRoom: boolean
  canPinStory: boolean
  onOpen: () => void
  onPin: (scope: PinScope) => void
  onUnpin: () => void
  onLeaveOut: () => void
}): React.JSX.Element {
  const name = nameOf(entry)
  return (
    <li className="group flex min-h-[46px] items-center gap-1.5 border-b border-line/60 py-1.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            title={`Open ${name}`}
            className={cn(
              'min-w-0 truncate rounded text-left text-[13px] font-medium hover:text-accent hover:underline',
              leftOutForRoom ? 'text-faint' : 'text-fg'
            )}
          >
            {name}
          </button>
          {entry.pinned ? (
            <>
              <Pin size={11} className="shrink-0 text-accent" aria-hidden />
              <span className="sr-only">, pinned for {PIN_WORDS[entry.pinned]}</span>
            </>
          ) : null}
        </div>
        <div className="truncate text-[12px] text-faint" title={entryDetail(entry, kindWord(entry), leftOutForRoom)}>
          {entryDetail(entry, kindWord(entry), leftOutForRoom)}
        </div>
      </div>
      <M.Root modal={false}>
        <M.Trigger asChild>
          <button
            type="button"
            aria-label={`Choices for ${name}`}
            title="Pin or leave out"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-fg data-[state=open]:bg-surface-2 data-[state=open]:text-fg"
          >
            <MoreHorizontal size={15} />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="end"
            sideOffset={4}
            collisionPadding={8}
            aria-label={`Choices for ${name}`}
            className="z-50 min-w-[220px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
          >
            {SCOPES.filter((s) => s !== 'story' || canPinStory).map((scope) => (
              <RowMenuItem
                key={scope}
                icon={entry.pinned === scope ? <Check size={14} /> : <Pin size={14} />}
                onSelect={() => (entry.pinned === scope ? undefined : onPin(scope))}
              >
                Pin for {PIN_WORDS[scope]}
              </RowMenuItem>
            ))}
            {entry.pinned ? (
              <RowMenuItem icon={<PinOff size={14} />} onSelect={onUnpin}>
                Unpin from {PIN_WORDS[entry.pinned]}
              </RowMenuItem>
            ) : null}
            <RowMenuSeparator />
            <RowMenuItem icon={<EyeOff size={14} />} onSelect={onLeaveOut}>
              Leave out of this scene
            </RowMenuItem>
          </M.Content>
        </M.Portal>
      </M.Root>
    </li>
  )
}

/** Adds any other entry to this scene's briefing by pinning it here. */
function PinAnother({
  sceneId,
  exclude,
  onPick
}: {
  sceneId: ID
  exclude: ContextEntry[]
  onPick: (e: { entryId: ID; name: string; kind: Entry['kind'] }) => void
}): React.JSX.Element | null {
  const entriesRev = useApp((s) => s.entriesRev)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const inputId = useId()
  const hintId = useId()

  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(list))
      // Without the list, there is simply nothing more to offer.
      .catch(() => live && setEntries((prev) => prev ?? []))
    return () => {
      live = false
    }
  }, [entriesRev, sceneId])

  const offered = useMemo(() => {
    const taken = new Set(exclude.map((e) => e.entryId))
    return (entries ?? []).filter((e) => !taken.has(e.id))
  }, [entries, exclude])

  if (!entries || !offered.length) return null
  return (
    <div className="flex flex-col gap-1 pt-1">
      <label htmlFor={inputId} className="text-[12px] font-medium text-muted">
        Add another
      </label>
      <CastPicker
        id={inputId}
        aria-describedby={hintId}
        value={[]}
        characters={offered}
        onChange={(ids) => {
          const e = offered.find((x) => x.id === ids[ids.length - 1])
          if (e) onPick({ entryId: e.id, name: e.name, kind: e.kind })
        }}
        noun="entry"
        listLabel="Entries from your world"
        placeholder="Type a name to pin it here…"
      />
      <p id={hintId} className="text-[12px] text-faint">
        It is pinned for this scene. Use its ⋯ menu to pin it for the story or every scene instead.
      </p>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2.5 border-t border-line pt-4">
      <div className="flex h-5 items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}
