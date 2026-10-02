// The History page for one scene (View 'history'): its earlier versions on a list, newest first, each
// compared side by side with the scene now (the words that differ marked), and restored in one click.
// Owned by the History part.
import { ArrowLeft, CheckCircle2, ChevronRight, Copy, History, PenLine, RotateCcw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ID } from '@shared/types'
import { comparableDoc, type SceneHistory, type Snapshot, type SnapshotInfo, type SnapshotKind } from '@shared/contracts/history'
import { countWords } from '@shared/defaults'
import { Button, EmptyState, Notice, toast } from '@/components/ui'
import { api, modKey, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { useOutline } from '@/features/binder/outlineStore'
import { Skeleton, useDelayed, useNow } from '@/features/generate/parts'
import { fullDate } from '@/features/generate/format'
import {
  againstNow,
  firstToShow,
  foldSame,
  groupByDay,
  lengthAgainstNow,
  timeOf,
  whenTaken,
  wordsLabel,
  type Shown,
  type Version
} from './historyLogic'
import { compareTexts, type Piece, type Row } from './wordDiff'
import { restoreSnapshot } from './restore'

const KIND_ICON: Record<SnapshotKind, ReactNode> = {
  ai: <Sparkles size={13} />,
  done: <CheckCircle2 size={13} />,
  editing: <PenLine size={13} />,
  restore: <RotateCcw size={13} />
}

/** The same version: the same words and formatting (paragraph ids aside), as History compares them. */
const sameVersion = (a: Version, b: Version): boolean => a.text === b.text && comparableDoc(a.doc) === comparableDoc(b.doc)

/** The scene as the page shows it now (unsaved typing included), kept up to date while this page is open. */
function useSceneNow(sceneId: ID): Version | null {
  const [now, setNow] = useState<Version | null>(() => {
    const page = editorBridge()?.current()
    return page && page.sceneId === sceneId ? { doc: page.doc, text: page.text } : null
  })
  useEffect(() => {
    let live = true
    const bridge = editorBridge()
    if (!bridge || bridge.sceneId !== sceneId) {
      // The page shows another scene: its saved text.
      api
        .getScene(sceneId)
        .then((s) => live && setNow({ doc: s.doc, text: s.text }))
        .catch(() => live && setNow({ doc: null, text: '' }))
      return () => {
        live = false
      }
    }
    // A draft still being written into the page (say) changes it while this page is open.
    const editor = bridge.editor
    let timer: ReturnType<typeof setTimeout> | null = null
    const read = (): void => {
      timer = null
      const page = editorBridge()?.current()
      if (!live || page?.sceneId !== sceneId) return
      const next = { doc: page.doc, text: page.text }
      setNow((n) => (n && sameVersion(n, next) ? n : next))
    }
    const onUpdate = (): void => {
      if (!timer) timer = setTimeout(read, 400)
    }
    editor?.on('update', onUpdate)
    return () => {
      live = false
      if (timer) clearTimeout(timer)
      editor?.off('update', onUpdate)
    }
  }, [sceneId])
  return now
}

/** Try again shows it is trying for at least this long, so a quick answer doesn't just flicker. */
const TRYING_MS = 400

export function HistoryView({ sceneId, snapshotId }: { sceneId: ID; snapshotId?: ID | null }): React.JSX.Element {
  const [history, setHistory] = useState<SceneHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null)
  const [selected, setSelected] = useState<ID | null>(snapshotId ?? null)
  const [trying, setTrying] = useState(false)
  const selectScene = useApp((s) => s.selectScene)
  const nowMs = useNow(60_000)
  const ticket = useRef(0)
  const now = useSceneNow(sceneId)
  const nowRef = useRef(now)
  nowRef.current = now

  const load = useCallback(
    (o: { tryAgain?: boolean } = {}): Promise<void> => {
      const t = ++ticket.current
      // The scene now, so the list can say which versions are the same as it.
      const page = nowRef.current ? { sceneId, doc: nowRef.current.doc, text: nowRef.current.text } : null
      return api
        .listSnapshots(sceneId, { tryAgain: o.tryAgain, page })
        .then((h) => {
          if (t !== ticket.current) return
          setHistory(h)
          setError(null)
          // The newest version that differs from the scene now is shown first; one no longer kept gives way to it.
          setSelected((sel) => (sel && h.snapshots.some((s) => s.id === sel) ? sel : firstToShow(h)))
        })
        .catch((e: Error) => {
          if (t === ticket.current) setError(e.message)
        })
    },
    [sceneId]
  )

  useEffect(() => {
    void load()
    return onEvent('history:changed', (p) => p.sceneId === sceneId && void load())
  }, [sceneId, load])

  // The page changed (a draft still being written into it, say): which versions are the same as it may have too.
  const seenNow = useRef(now)
  useEffect(() => {
    if (seenNow.current === now) return
    seenNow.current = now
    void load()
  }, [now, load])

  // Adam asked: history.db is tried at once, and the button says it is trying.
  const tryAgain = (): void => {
    setTrying(true)
    void Promise.all([load({ tryAgain: true }), new Promise((r) => setTimeout(r, TRYING_MS))]).finally(() => setTrying(false))
  }

  // The scene's title as the binder has it, so the page opens with it rather than changing a moment later;
  // read from the scene only when the outline doesn't list it.
  const listed = useOutline().outline?.scenes.find((s) => s.id === sceneId)
  useEffect(() => {
    if (listed) return
    let live = true
    api
      .getScene(sceneId)
      .then((s) => live && setFetchedTitle(s.title || 'Untitled scene'))
      .catch(() => live && setFetchedTitle(null))
    return () => {
      live = false
    }
  }, [sceneId, listed])
  const title = listed ? listed.title || 'Untitled scene' : fetchedTitle

  const back = (): void => selectScene(sceneId)
  const slow = useDelayed(!history && !error)
  const snapshots = history?.snapshots ?? []

  return (
    <div className="@container flex h-full flex-col">
      <div className="shrink-0 px-5 pb-4 pt-5 @min-[900px]:px-8">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={back} className="-ml-2.5 mb-2">
          {title ? `Back to “${title}”` : 'Back to the scene'}
        </Button>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">History</h1>
        <p className="mt-1 max-w-[720px] text-[13px] text-muted">
          Earlier versions of {title ? `“${title}”` : 'this scene'}, newest first. Pick one to compare it with the scene now; Restore puts
          it back, and {modKey()}+Z takes it out again.
        </p>
        {history?.notice ? (
          <div className="mt-3 max-w-[720px]">
            <Notice>{history.notice}</Notice>
          </div>
        ) : null}
      </div>

      {error && !history ? (
        <div className="px-5 @min-[900px]:px-8">
          <Notice
            tone="danger"
            action={
              <Button size="sm" variant="secondary" onClick={tryAgain} loading={trying}>
                Try again
              </Button>
            }
          >
            Couldn't load this scene's history. {error}
          </Notice>
        </div>
      ) : !history ? (
        <div
          aria-busy
          className={cn(
            'flex min-h-0 flex-1 gap-4 px-5 pb-6 transition-opacity duration-150 @min-[900px]:px-8',
            slow ? 'opacity-100' : 'opacity-0'
          )}
        >
          <Skeleton className="h-full w-[200px] shrink-0 rounded-xl @min-[900px]:w-[260px]" />
          <Skeleton className="h-full min-w-0 flex-1 rounded-xl" />
        </div>
      ) : !history.available ? (
        <div className="max-w-[720px] px-5 @min-[900px]:px-8">
          <Notice
            action={
              <Button size="sm" variant="secondary" onClick={tryAgain} loading={trying}>
                Try again
              </Button>
            }
          >
            {history.problem}
          </Notice>
        </div>
      ) : !snapshots.length ? (
        <EmptyState
          icon={<History size={18} />}
          title="No earlier versions yet"
          className="pt-[8vh]"
          actions={
            <Button variant="secondary" onClick={back}>
              Back to writing
            </Button>
          }
        >
          A version of this scene is kept before every AI change, whenever you mark it done, and every 10 minutes while you write. Each one
          is listed here, to compare with the scene now and restore in one click.
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 px-5 pb-6 animate-fade-in @min-[900px]:px-8">
          <VersionList snapshots={snapshots} sameAsNow={history.sameAsNow} selected={selected} onSelect={setSelected} nowMs={nowMs} />
          <Comparison key={sceneId} sceneId={sceneId} now={now} info={snapshots.find((s) => s.id === selected) ?? null} nowMs={nowMs} />
        </div>
      )}
    </div>
  )
}

// ---------- The list ----------

function VersionList({
  snapshots,
  sameAsNow,
  selected,
  onSelect,
  nowMs
}: {
  snapshots: SnapshotInfo[]
  /** The versions that are the same as the scene now. */
  sameAsNow: ID[]
  selected: ID | null
  onSelect: (id: ID) => void
  nowMs: number
}): React.JSX.Element {
  const groups = useMemo(() => groupByDay(snapshots, nowMs), [snapshots, nowMs])
  const same = useMemo(() => new Set(sameAsNow), [sameAsNow])
  const listRef = useRef<HTMLDivElement>(null)

  // Up and down move through the list, like the binder.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const i = snapshots.findIndex((s) => s.id === selected)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? snapshots.length - 1
          : Math.max(0, Math.min(snapshots.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    const id = snapshots[next]?.id
    if (!id) return
    e.preventDefault()
    onSelect(id)
    listRef.current?.querySelector<HTMLElement>(`[data-snapshot="${id}"]`)?.focus()
  }

  return (
    <nav
      ref={listRef}
      aria-label="Earlier versions"
      onKeyDown={onKeyDown}
      className="w-[200px] shrink-0 overflow-y-auto rounded-xl border border-line bg-surface @min-[900px]:w-[260px]"
    >
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h2 className="sticky top-0 z-[1] bg-surface px-3 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            {g.title}
          </h2>
          <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {g.snapshots.map((s) => {
              const on = s.id === selected
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    data-snapshot={s.id}
                    aria-current={on ? 'true' : undefined}
                    tabIndex={on || (!selected && s === snapshots[0]) ? 0 : -1}
                    onClick={() => onSelect(s.id)}
                    title={fullDate(s.createdAt)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40',
                      on ? 'bg-accent-soft' : 'hover:bg-surface-2'
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span
                        className={cn('flex shrink-0', s.kind === 'done' ? 'text-success' : on ? 'text-accent' : 'text-faint')}
                        aria-hidden
                      >
                        {KIND_ICON[s.kind]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{s.label}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1 pl-[19px] text-[12px] tabular-nums text-muted">
                      <span className="shrink-0">{timeOf(s.createdAt)} ·</span>
                      {same.has(s.id) ? (
                        // Its words are the scene's now, so they aren't said twice.
                        <span className="shrink-0 rounded-[4px] bg-surface-3 px-1 text-[11px] font-medium leading-[17px] text-fg/80">
                          Same as now
                        </span>
                      ) : (
                        <span className="truncate">{wordsLabel(s.words)}</span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}

// ---------- The comparison ----------

function Comparison({
  sceneId,
  now,
  info,
  nowMs
}: {
  sceneId: ID
  /** The scene now (unsaved typing included). */
  now: Version | null
  info: SnapshotInfo | null
  nowMs: number
}): React.JSX.Element {
  const cache = useRef(new Map<ID, Snapshot>())
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const navigate = useApp((s) => s.navigate)
  const drafting = useApp((s) => s.activeGeneration?.sceneId === sceneId)

  const id = info?.id ?? null
  useEffect(() => {
    setError(null)
    if (!id) return
    const hit = cache.current.get(id)
    if (hit) {
      setSnap(hit)
      return
    }
    let live = true
    api
      .getSnapshot(id)
      .then((s) => {
        cache.current.set(s.id, s)
        if (live) setSnap(s)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [id])

  // A newly picked version is read from its top, with every unchanged stretch folded again.
  useEffect(() => {
    setOpened(new Set())
    if (scroller.current) scroller.current.scrollTop = 0
  }, [snap?.id])

  const rows = useMemo(() => (snap && now ? compareTexts(snap.text, now.text) : null), [snap, now])
  const against = useMemo(() => (rows && snap && now ? againstNow(rows, snap, now) : null), [rows, snap, now])
  const identical = against?.kind === 'same'
  // With no words marked, nothing is folded away: the whole version reads as it is.
  const unfolded = !!against && against.kind !== 'differ'
  const shown = useMemo(
    () => (rows ? (unfolded ? rows.map((row, i) => ({ kind: 'row' as const, row, key: `r${i}` })) : foldSame(rows)) : null),
    [rows, unfolded]
  )
  const current = snap && snap.id === id ? snap : null
  const waiting = useDelayed(!!id && !current && !error, 250)
  const nowWords = now ? countWords(now.text) : 0
  const when = current ? whenTaken(current.createdAt, nowMs) : ''

  const restore = async (): Promise<void> => {
    if (!current || restoring) return
    setRestoring(true)
    try {
      // "Today at 14:05" reads "today at 14:05" in the middle of the message.
      const inSentence = when.replace(/^(Today|Yesterday)\b/, (w) => w.toLowerCase())
      await restoreSnapshot(current, inSentence)
    } finally {
      setRestoring(false)
    }
  }

  const copy = (): void => {
    if (!current) return
    navigator.clipboard.writeText(current.text).then(
      () => toast('Copied the text of this version.'),
      () => toast(`Couldn't copy the text. Select it and press ${modKey()}+C instead.`, { tone: 'danger' })
    )
  }

  if (error) {
    return (
      <section aria-label="Comparison" className="min-w-0 flex-1">
        <Notice tone="danger">Couldn't open this version. {error}</Notice>
      </section>
    )
  }

  // The last version shown stays until the next one is ready, so nothing flashes; a slow one dims it.
  const view = snap
  const meta = info
    ? [whenTaken(info.createdAt, nowMs), wordsLabel(info.words), ...(now ? [lengthAgainstNow(info.words, nowWords)] : [])]
    : []
  return (
    <section
      aria-label="Comparison"
      className="@container/compare flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface"
    >
      {/* Laid out by the comparison's width alone, never by what a version says (its date, a button only some
          have), so moving through the list never moves the text below: buttons beside the name when wide,
          under it when narrow, and the name and its details each on one line. */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-4 py-3 @min-[900px]:px-5 @min-[760px]/compare:flex-row @min-[760px]/compare:items-center @min-[760px]/compare:justify-between @min-[760px]/compare:gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold leading-[22px] text-fg">{info?.label ?? '\u00a0'}</h2>
          <p
            className="mt-0.5 truncate text-[12.5px] leading-[18px] text-muted"
            title={info ? [fullDate(info.createdAt), ...meta.slice(1)].join(' · ') : undefined}
          >
            {meta.length
              ? meta.map((part, i) => (
                  <span key={i} className={i === 1 ? 'tabular-nums' : undefined}>
                    {i > 0 ? <span className="mx-1.5 text-line-strong">·</span> : null}
                    {part}
                  </span>
                ))
              : '\u00a0'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {info?.generationId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ kind: 'generation', generationId: info.generationId! })}
              title="See exactly what the AI was given for the change that came after this version"
              // Under the name (a narrow comparison), its words line up with the name's.
              className="-ml-2.5 @min-[760px]/compare:ml-0"
            >
              What the AI saw
              <ChevronRight size={13} className="-ml-1" />
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" icon={<Copy size={13} />} onClick={copy} disabled={!current}>
            Copy
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<RotateCcw size={13} />}
            onClick={() => void restore()}
            loading={restoring}
            disabled={!current || identical || drafting}
            title={
              identical
                ? 'This version is the same as the scene now'
                : drafting
                  ? 'A draft is being written into this scene. Restore once it has finished.'
                  : 'Put this version back in the scene (the scene as it is now is kept first)'
            }
          >
            Restore this version
          </Button>
        </div>
      </div>

      {/* The column titles leave room for the text's scrollbar, so the line between the columns runs straight. */}
      <div className="grid shrink-0 grid-cols-2 overflow-hidden border-b border-line bg-surface-2/60 text-[11.5px] font-semibold uppercase tracking-wide text-faint [scrollbar-gutter:stable]">
        <div className="truncate px-4 py-1.5 @min-[900px]:px-5">This version</div>
        <div className="truncate border-l border-line px-4 py-1.5 @min-[900px]:px-5">The scene now</div>
      </div>

      <div
        ref={scroller}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto bg-page transition-opacity duration-150 [scrollbar-gutter:stable]',
          waiting && 'opacity-60'
        )}
      >
        {!view || !shown ? (
          <div
            aria-busy
            className={cn('grid grid-cols-2 gap-6 px-5 py-4 transition-opacity duration-150', waiting ? 'opacity-100' : 'opacity-0')}
          >
            {[0, 1].map((c) => (
              <div key={c} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="px-4 pb-1 pt-3 text-[12.5px] text-muted @min-[900px]:px-5">
              {against?.kind === 'differ' ? (
                <>
                  {against.paragraphs === 1 ? '1 paragraph differs' : `${against.paragraphs} paragraphs differ`}. The words that differ are{' '}
                  <Marked>marked</Marked>.
                </>
              ) : against?.kind === 'format' ? (
                'The words are the same as the scene now. Only the formatting or line breaks differ.'
              ) : (
                'This version is the same as the scene now.'
              )}
            </p>
            <div className="grid grid-cols-2 pb-6 pt-2">
              {shown.map((s) => (
                <ShownRow key={s.key} item={s} open={opened.has(s.key)} onOpen={() => setOpened((o) => new Set(o).add(s.key))} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

const cell =
  'min-w-0 px-4 py-1.5 font-serif text-[13.5px] leading-[1.7] text-fg whitespace-pre-wrap break-words @min-[900px]:px-5 @min-[900px]:text-[14.5px]'

/** A scene break shows as it does in the page. */
const isBreak = (text: string): boolean => /^\s*(\*\s*){3,}$/.test(text)

/** A paragraph; `whole` marks all of it as one block, since only one side has it. */
function Paragraph({ text, whole }: { text: string; whole?: boolean }): React.JSX.Element {
  const sceneBreak = isBreak(text)
  if (!whole) return sceneBreak ? <div className="text-center tracking-[0.4em] text-faint">* * *</div> : <>{text}</>
  return (
    <mark
      className={cn(
        '-mx-1.5 -my-0.5 block rounded-md bg-accent-soft px-1.5 py-0.5',
        sceneBreak ? 'text-center tracking-[0.4em] text-faint' : 'text-fg'
      )}
    >
      {sceneBreak ? '* * *' : text}
    </mark>
  )
}

/** Words the other side doesn't have. */
function Marked({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <mark className="rounded-[3px] bg-accent-soft text-fg shadow-[0_0_0_1.5px_var(--accent-soft)] [box-decoration-break:clone]">
      {children}
    </mark>
  )
}

function Pieces({ pieces }: { pieces: Piece[] }): React.JSX.Element {
  return <>{pieces.map((p, i) => (p.changed ? <Marked key={i}>{p.text}</Marked> : <span key={i}>{p.text}</span>))}</>
}

function ShownRow({ item, open, onOpen }: { item: Shown; open: boolean; onOpen: () => void }): React.JSX.Element {
  if (item.kind === 'row') return <RowCells row={item.row} />
  if (open) {
    return (
      <>
        {item.rows.map((row, i) => (
          <RowCells key={i} row={row} />
        ))}
      </>
    )
  }
  return (
    <div className="col-span-2 px-4 py-1 @min-[900px]:px-5">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-line py-1 text-[12px] text-muted transition-colors duration-150 hover:border-line-strong hover:bg-surface-2 hover:text-fg"
      >
        {item.rows.length} paragraphs the same · Show them
      </button>
    </div>
  )
}

/** One side of a row: the paragraph as that side has it, or nothing when only the other side has one. */
function Side({ row, side }: { row: Row; side: 'then' | 'now' }): React.JSX.Element | null {
  if (row.kind === 'same') return <Paragraph text={row.text} />
  if (row.kind === 'changed') return <Pieces pieces={side === 'then' ? row.then : row.now} />
  if (row.kind === 'apart') {
    // A stretch written afresh: each side's paragraphs, marked whole, from the top of the row.
    return (
      <div className="flex flex-col gap-3">
        {(side === 'then' ? row.then : row.now).map((text, i) => (
          <Paragraph key={i} text={text} whole />
        ))}
      </div>
    )
  }
  return row.kind === side ? <Paragraph text={row.text} whole /> : null
}

function RowCells({ row }: { row: Row }): React.JSX.Element {
  return (
    <>
      <div className={cell} data-side="then">
        <Side row={row} side="then" />
      </div>
      <div className={cn(cell, 'border-l border-line')} data-side="now">
        <Side row={row} side="now" />
      </div>
    </>
  )
}
