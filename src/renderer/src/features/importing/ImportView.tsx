// Import a manuscript (View 'import'; milestone 6, spec "Import and export"). Adam picks a Word, Markdown or
// plain text file; the page shows how it splits into chapters and scenes, with each one's words and opening,
// and he can rename any of them, change what a heading is, merge one with the one before, split a scene at a
// paragraph and set the story's title. One click imports it into the open world as a new story (a toast offers
// Undo). Then the page offers to build the memory from it, with roughly what that costs; the catch-up runs in
// the background (its line sits at the foot of the binder). The same offer is what "Build the memory from this
// story" opens. Long books stay quick: cards off screen aren't drawn, and a scene's paragraphs show a page at
// a time. Owned by the Manuscript import part.

import { ArrowLeft, Brain, CircleCheck, FileText, FileUp, Merge, RotateCcw, Scissors, Square } from '@/components/ui/icons'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CatchUpEstimate, Manuscript } from '@shared/contracts/importing'
import type { ID } from '@shared/types'
import { Button, Card, IconButton, Input, Notice, Select, useToastsAbove, type SelectOption } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { ProblemNotice } from '@/features/builder/parts'
import {
  buildMemory,
  chooseFile,
  importNow,
  listenForCatchUp,
  openImported,
  resetSplit,
  setEdits,
  setStoryTitle,
  stopBuildingMemory,
  useImport
} from './importStore'
import {
  buildOutline,
  countsText,
  mergeBack,
  outlineCounts,
  roleAt,
  setRole,
  setTitle,
  splitAt,
  wordsText,
  type Outline,
  type OutlineChapter,
  type OutlineScene,
  type Role
} from './split'
import { catchUpWords, costWords } from './importLogic'
import { useNewLook } from '@/features/look/look'
import { DropZone, Imported, InkProgress } from './ImportArt'

export function ImportView(): React.JSX.Element {
  const page = useImport((s) => s.page)
  useEffect(() => listenForCatchUp(), [])
  return (
    <div className="flex h-full flex-col bg-bg">
      {page === 'file' ? <FilePage /> : <MemoryPage />}
    </div>
  )
}

function Heading({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
        <FileUp size={12} aria-hidden />
        Import
      </div>
      <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">{children}</h1>
      {sub ? <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{sub}</p> : null}
    </>
  )
}

const backToWriting = (): void => useApp.getState().navigate({ kind: 'write' })
/** Back to the start screen it was started from, with the writing page under it again (so Continue goes there). */
const backToStart = (): void => {
  const app = useApp.getState()
  app.navigate({ kind: 'write' })
  app.goHome()
}

// ---------- Picking the file, and the split ----------

function FilePage(): React.JSX.Element {
  const manuscript = useImport((s) => s.manuscript)
  const reading = useImport((s) => s.reading)
  const problem = useImport((s) => s.problem)
  // Started from the start screen, Back goes back there (the book will get a world of its own).
  const fromStart = useImport((s) => s.forNewWorld)
  const hasWorld = useApp((s) => !!s.world) && !fromStart
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-[780px] px-8 pb-10 pt-10">
          <div className="mb-4 h-7">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={fromStart ? backToStart : backToWriting} className="-ml-2.5">
              {hasWorld ? 'Back to writing' : 'Back'}
            </Button>
          </div>
          <Heading
            sub={
              manuscript
                ? 'Check how it splits into chapters and scenes. Rename anything, change what a heading is, merge one with the one before, or split a scene at a paragraph. Nothing is imported until you press Import.'
                : 'Bring in a book you’ve already written. You’ll see how it splits into chapters and scenes, and can change that, before anything is imported.'
            }
          >
            Import a manuscript
          </Heading>
          {problem ? (
            <div className="mt-4">
              <ProblemNotice message={problem} onRetry={() => void chooseFile()} />
            </div>
          ) : null}
          {manuscript ? <Preview manuscript={manuscript} /> : <Choose reading={reading} />}
        </div>
      </div>
      {manuscript ? <ImportBar manuscript={manuscript} /> : null}
    </>
  )
}

function Choose({ reading }: { reading: boolean }): React.JSX.Element {
  const isNew = useNewLook()
  // The New look: a drop zone with a manuscript drawn on it (a file can be dropped there too).
  if (isNew) return <DropZone reading={reading} onChoose={() => void chooseFile()} onDrop={(path) => void chooseFile(path)} />
  return (
    <Card className="mt-6 flex flex-col items-center px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted">
        <FileText size={20} />
      </div>
      <p className="mt-3 text-[14px] font-medium text-fg">Word, Markdown or plain text</p>
      <p className="mt-1 max-w-[380px] text-[13px] leading-relaxed text-muted">
        A .docx, .md or .txt file. Chapters are found by their headings (“Chapter 12”, “Prologue”, Word’s heading styles), and scenes by
        breaks like * * *.
      </p>
      <Button variant="primary" size="lg" className="mt-5" icon={<FileUp size={15} />} loading={reading} onClick={() => void chooseFile()}>
        {reading ? 'Reading the file…' : 'Choose a file…'}
      </Button>
    </Card>
  )
}

function Preview({ manuscript }: { manuscript: Manuscript }): React.JSX.Element {
  const proposed = useImport((s) => s.proposed)
  const edits = useImport((s) => s.edits)
  const title = useImport((s) => s.title)
  const reading = useImport((s) => s.reading)
  const outline = useMemo(() => buildOutline(manuscript, proposed, edits), [manuscript, proposed, edits])
  const changed = Object.keys(edits.roles).length > 0 || Object.keys(edits.titles).length > 0
  const titleId = useId()
  return (
    <div className="mt-6">
      <div className="flex max-w-[460px] flex-col gap-1">
        <label htmlFor={titleId} className="text-[12px] font-medium text-muted">
          Story title
        </label>
        <Input id={titleId} value={title} onChange={(e) => setStoryTitle(e.target.value)} className="h-9 font-serif text-[15px]" />
      </div>
      <div className="mt-4 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText size={13} className="shrink-0 text-faint" />
          <span className="truncate font-medium text-fg">{manuscript.fileName}</span>
        </span>
        <span className="tabular-nums">{wordsText(outline.words)}</span>
        <span>{outlineCounts(outline)}</span>
        <span className="flex-1" />
        {changed ? (
          <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={resetSplit} title="Back to the split as it was found">
            Undo my changes
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={<FileUp size={13} />} loading={reading} onClick={() => void chooseFile()}>
          Choose another file
        </Button>
      </div>
      <OutlineList manuscript={manuscript} outline={outline} />
    </div>
  )
}

/** The foot of the page: what will be imported, and Import. Toasts rise above it. */
function ImportBar({ manuscript }: { manuscript: Manuscript }): React.JSX.Element {
  const proposed = useImport((s) => s.proposed)
  const edits = useImport((s) => s.edits)
  const importing = useImport((s) => s.importing)
  // From the start screen the book gets a world of its own, even with another world open behind it.
  const world = useApp((s) => s.world)
  const forNewWorld = useImport((s) => s.forNewWorld)
  const shownWorld = forNewWorld ? null : world
  const outline = useMemo(() => buildOutline(manuscript, proposed, edits), [manuscript, proposed, edits])
  const bar = useRef<HTMLDivElement>(null)
  useToastsAbove(bar)
  return (
    <div ref={bar} className="shrink-0 border-t border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-[780px] items-center gap-3 px-8">
        <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
          {shownWorld ? (
            <>
              A new story in <span className="font-medium text-fg">{shownWorld.name}</span>: {outlineCounts(outline)}
            </>
          ) : (
            <>A new world named after the book, with it as the first story: {outlineCounts(outline)}</>
          )}
        </p>
        <Button variant="primary" size="lg" icon={<FileUp size={15} />} loading={importing} onClick={() => void importNow()}>
          Import
        </Button>
      </div>
    </div>
  )
}

// ---------- The outline ----------

/** What a boundary can be, by what it is in the file. */
function kindOptions(kind: Manuscript['blocks'][number]['kind']): SelectOption[] {
  if (kind === 'heading') {
    return [
      { value: 'act', label: 'Act' },
      { value: 'chapter', label: 'Chapter' },
      { value: 'scene', label: 'Scene' },
      { value: 'text', label: 'Ordinary text' }
    ]
  }
  return [
    { value: 'chapter', label: 'Chapter' },
    { value: 'scene', label: 'Scene' },
    { value: 'text', label: 'Not a break' }
  ]
}

function OutlineList({ manuscript, outline }: { manuscript: Manuscript; outline: Outline }): React.JSX.Element {
  const proposed = useImport((s) => s.proposed)
  const edits = useImport((s) => s.edits)
  const { blocks } = manuscript
  const role = (at: number): Role => roleAt(blocks, proposed, edits, at)
  const change = (at: number, r: Role): void => setEdits(setRole(useImport.getState().edits, at, r))
  const rename = (key: string, t: string): void => setEdits(setTitle(useImport.getState().edits, key, t))
  const merge = (at: number): void => setEdits(mergeBack(useImport.getState().edits, blocks, proposed, at))
  const split = (at: number): void => setEdits(splitAt(useImport.getState().edits, at))
  const actFirst = new Map(outline.acts.map((a, i) => [i, outline.chapters.findIndex((c) => c.act === i)]))
  return (
    <div className="mt-3 flex flex-col gap-3" aria-label="Chapters and scenes">
      {outline.acts
        .map((a, i) => ({ a, i }))
        .filter(({ i }) => actFirst.get(i) === -1)
        .map(({ a }) => (
          <ActRow key={a.key} at={a.at} title={a.title} role={role(a.at)} kind="heading" onRole={change} onTitle={(t) => rename(a.key, t)} empty />
        ))}
      {outline.chapters.map((c, ci) => {
        const act = c.act != null && actFirst.get(c.act) === ci ? outline.acts[c.act] : null
        return (
          <div key={c.key} className="flex flex-col gap-3">
            {act ? (
              <ActRow key={act.key} at={act.at} title={act.title} role={role(act.at)} kind="heading" onRole={change} onTitle={(t) => rename(act.key, t)} />
            ) : null}
            <ChapterCard
              chapter={c}
              sig={chapterSig(c, role)}
              first={ci === 0}
              kind={c.at >= 0 && c.at !== (c.act != null ? outline.acts[c.act]?.at : -2) ? blocks[c.at].kind : null}
              role={c.at >= 0 ? role(c.at) : 'chapter'}
              manuscript={manuscript}
              roleOf={role}
              onRole={change}
              onTitle={rename}
              onMerge={merge}
              onSplit={split}
            />
          </div>
        )
      })}
    </div>
  )
}

/** A signature of what a chapter card shows, so a card is drawn again only when it changes. */
const chapterSig = (c: OutlineChapter, role: (at: number) => Role): string =>
  [c.title, c.words, c.act, ...c.scenes.map((s) => `${s.key}|${s.title}|${s.words}|${s.own}|${s.from}|${s.to}|${s.own ? role(s.at) : ''}`)].join(
    '\u0001'
  )

/** A title in place: looks like text, edits like a box, and is kept when Adam leaves it (Esc puts it back). */
function TitleInput({ value, label, onCommit, className }: { value: string; label: string; onCommit: (t: string) => void; className?: string }): React.JSX.Element {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = (): void => {
    if (text.trim() !== value.trim()) onCommit(text.trim())
    else setText(value)
  }
  return (
    <input
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(value)
          e.stopPropagation()
        }
      }}
      className={cn(
        'h-7 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-fg outline-none transition-[border-color,background-color] duration-150 hover:border-line focus:border-accent focus:bg-page focus:ring-2 focus:ring-accent/20',
        className
      )}
    />
  )
}

function KindSelect({ at, role, kind, what, onRole }: { at: number; role: Role; kind: Manuscript['blocks'][number]['kind']; what: string; onRole: (at: number, r: Role) => void }): React.JSX.Element {
  const id = useId()
  return (
    <div className="w-[136px] shrink-0">
      <label htmlFor={id} className="sr-only">
        What {what} is
      </label>
      <Select id={id} value={role} options={kindOptions(kind)} onChange={(v) => v && onRole(at, v as Role)} className="h-7 text-[12.5px]" />
    </div>
  )
}

function ActRow(props: {
  at: number
  title: string
  role: Role
  kind: 'heading'
  empty?: boolean
  onRole: (at: number, r: Role) => void
  onTitle: (t: string) => void
}): React.JSX.Element {
  return (
    <div className="mt-2 flex items-center gap-2 border-b border-line pb-2">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Act</span>
      <TitleInput value={props.title} label="Act title" onCommit={props.onTitle} className="flex-1 font-serif text-[16px] font-semibold" />
      {props.empty ? <span className="text-[12px] text-faint">No chapters</span> : null}
      <KindSelect at={props.at} role={props.role} kind={props.kind} what={`“${props.title}”`} onRole={props.onRole} />
    </div>
  )
}

interface ChapterProps {
  chapter: OutlineChapter
  sig: string
  first: boolean
  /** The kind of block that starts it; null when it starts with no heading (the opening, or an act's opening). */
  kind: Manuscript['blocks'][number]['kind'] | null
  role: Role
  manuscript: Manuscript
  roleOf: (at: number) => Role
  onRole: (at: number, r: Role) => void
  onTitle: (key: string, t: string) => void
  onMerge: (at: number) => void
  onSplit: (at: number) => void
}

const ChapterCard = memo(
  function ChapterCard({ chapter: c, first, kind, role, manuscript, roleOf, onRole, onTitle, onMerge, onSplit }: ChapterProps): React.JSX.Element {
    return (
      <section
        aria-label={`Chapter: ${c.title}`}
        className="rounded-xl border border-line bg-surface shadow-soft [contain-intrinsic-size:auto_160px] [content-visibility:auto]"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <TitleInput value={c.title} label="Chapter title" onCommit={(t) => onTitle(c.key, t)} className="flex-1 text-[14px] font-semibold" />
          <span className="shrink-0 text-[12px] tabular-nums text-faint">{wordsText(c.words)}</span>
          {kind ? <KindSelect at={c.at} role={role} kind={kind} what={`“${c.title}”`} onRole={onRole} /> : null}
          {kind && !first ? (
            <IconButton label="Merge with the chapter before" size="sm" onClick={() => onMerge(c.at)}>
              <Merge size={14} />
            </IconButton>
          ) : (
            <span className="w-6 shrink-0" aria-hidden />
          )}
        </div>
        <ol className="flex flex-col py-1">
          {c.scenes.map((s, si) => (
            <SceneRow
              key={s.key}
              scene={s}
              number={si + 1}
              manuscript={manuscript}
              role={s.own ? roleOf(s.at) : 'scene'}
              onRole={onRole}
              onTitle={onTitle}
              onMerge={onMerge}
              onSplit={onSplit}
            />
          ))}
        </ol>
      </section>
    )
  },
  // The handlers read the latest split when they run, so only what shows decides whether it is drawn again.
  (a, b) => a.sig === b.sig && a.first === b.first && a.kind === b.kind && a.role === b.role && a.manuscript === b.manuscript
)

function SceneRow({
  scene: s,
  manuscript,
  role,
  onRole,
  onTitle,
  onMerge,
  onSplit
}: {
  scene: OutlineScene
  number: number
  manuscript: Manuscript
  role: Role
  onRole: (at: number, r: Role) => void
  onTitle: (key: string, t: string) => void
  onMerge: (at: number) => void
  onSplit: (at: number) => void
}): React.JSX.Element {
  const [splitting, setSplitting] = useState(false)
  const paragraphs = s.to - s.from
  return (
    <li className="group/scene px-3">
      <div className="flex min-h-10 items-center gap-2 py-1">
        <TitleInput value={s.title} label="Scene title" onCommit={(t) => onTitle(s.key, t)} className="w-[170px] shrink-0 text-[13px]" />
        <span className="min-w-0 flex-1 truncate font-serif text-[13px] text-muted" title={s.opening}>
          {s.opening || <span className="font-sans italic text-faint">No words</span>}
        </span>
        <span className="w-[76px] shrink-0 text-right text-[12px] tabular-nums text-faint">{wordsText(s.words)}</span>
        {s.own ? (
          <KindSelect at={s.at} role={role} kind={manuscript.blocks[s.at].kind} what={`“${s.title}”`} onRole={onRole} />
        ) : (
          <span className="w-[136px] shrink-0" aria-hidden />
        )}
        <IconButton
          label={splitting ? 'Close the paragraphs' : 'Split this scene at a paragraph'}
          size="sm"
          active={splitting}
          disabled={paragraphs < 2}
          onClick={() => setSplitting((v) => !v)}
        >
          <Scissors size={14} />
        </IconButton>
        {s.own ? (
          <IconButton label="Merge with the scene before" size="sm" onClick={() => onMerge(s.at)}>
            <Merge size={14} />
          </IconButton>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
      </div>
      {splitting ? (
        <SplitPicker
          manuscript={manuscript}
          scene={s}
          onSplit={(at) => {
            onSplit(at)
            setSplitting(false)
          }}
        />
      ) : null}
    </li>
  )
}

/** Paragraphs shown at a time when splitting a long scene. */
const PAGE = 60

/** A scene's paragraphs, with "Split here" between them. */
function SplitPicker({ manuscript, scene, onSplit }: { manuscript: Manuscript; scene: OutlineScene; onSplit: (at: number) => void }): React.JSX.Element {
  const [shown, setShown] = useState(PAGE)
  const items = useMemo(() => {
    const out: { at: number; text: string }[] = []
    for (let i = scene.from; i < scene.to; i++) {
      const b = manuscript.blocks[i]
      if (b.kind === 'para' || b.kind === 'heading') out.push({ at: i, text: b.text })
    }
    return out
  }, [manuscript, scene.from, scene.to])
  return (
    <div className="mb-2 ml-1 rounded-lg border border-line bg-surface-2 p-2 animate-fade-in" aria-label={`Paragraphs of ${scene.title}`}>
      <p className="px-1 pb-1.5 text-[12px] text-muted">Pick where the new scene starts.</p>
      <ol className="flex max-h-[420px] flex-col overflow-y-auto">
        {items.slice(0, shown).map((p, i) => (
          <li key={p.at}>
            {i > 0 ? (
              <button
                type="button"
                onClick={() => onSplit(p.at)}
                className="group/split flex h-5 w-full items-center gap-2 px-1 text-[11.5px] font-medium text-faint outline-none hover:text-accent focus-visible:text-accent"
              >
                <span className="h-px flex-1 bg-line group-hover/split:bg-accent group-focus-visible/split:bg-accent" />
                Split here
                <span className="h-px flex-1 bg-line group-hover/split:bg-accent group-focus-visible/split:bg-accent" />
              </button>
            ) : null}
            <p className="line-clamp-2 px-1 font-serif text-[13px] leading-relaxed text-fg">{p.text}</p>
          </li>
        ))}
      </ol>
      {items.length > shown ? (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({(items.length - shown).toLocaleString('en-US')} more paragraphs)
        </Button>
      ) : null}
    </div>
  )
}

// ---------- After importing: building the memory ----------

function MemoryPage(): React.JSX.Element {
  const page = useImport((s) => s.page)
  const result = useImport((s) => s.result)
  const storyId = useImport((s) => s.memoryStoryId)
  const story = useApp((s) => s.stories.find((x) => x.id === storyId) ?? null)
  const title = story?.title ?? result?.title ?? ''
  const isNew = useNewLook()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[680px] px-8 pb-16 pt-10">
        <div className="mb-4 h-7">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={backToWriting} className="-ml-2.5">
            Back to writing
          </Button>
        </div>
        {page === 'done' && result && isNew ? (
          // The New look: what came in, as cards, and the way to it.
          <>
            <Heading>Imported</Heading>
            <Imported title={title} result={result} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px] text-muted">
                <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" />
                <span>
                  “{title}” is in your world: {countsText(result.acts, result.chapters, result.scenes)}, {wordsText(result.words)}.
                </span>
              </p>
              <Button size="sm" onClick={() => void openImported(result.storyId)}>
                Open the story
              </Button>
            </div>
          </>
        ) : page === 'done' && result ? (
          <>
            <Heading>Imported</Heading>
            <div className="mt-4">
              <Notice
                tone="success"
                action={
                  <Button size="sm" onClick={() => void openImported(result.storyId)}>
                    Open the story
                  </Button>
                }
              >
                <span className="flex items-start gap-2">
                  <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" />
                  <span>
                    “{title}” is in your world: {countsText(result.acts, result.chapters, result.scenes)}, {wordsText(result.words)}.
                  </span>
                </span>
              </Notice>
            </div>
          </>
        ) : (
          <Heading>Build the memory from “{title}”</Heading>
        )}
        {storyId && story ? <MemoryOffer storyId={storyId} /> : null}
      </div>
    </div>
  )
}

/** The offer to build the memory from a story: what it does and roughly costs, then how it is going. */
function MemoryOffer({ storyId }: { storyId: ID }): React.JSX.Element {
  const catchUp = useImport((s) => s.catchUp)
  const running = catchUp.running?.storyId === storyId ? catchUp.running : null
  const unread = catchUp.unread[storyId] ?? 0
  const [estimate, setEstimate] = useState<CatchUpEstimate | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let live = true
    api
      .estimateCatchUp(storyId)
      .then((e) => live && setEstimate(e))
      .catch(() => live && setEstimate(null))
    return () => {
      live = false
    }
  }, [storyId, unread > 0])

  const start = async (): Promise<void> => {
    setStarting(true)
    await buildMemory(storyId)
    setStarting(false)
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Brain size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">Build the memory from it</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            The memory model reads the story chapter by chapter in the background, so AI Write knows its characters, places and what
            happens, as if you had written it here. Keep writing meanwhile; you can stop at any time, and it carries on after a restart.
          </p>
          {running ? (
            <CatchUpProgressBlock storyId={storyId} />
          ) : unread === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-success">
              <CircleCheck size={15} /> The memory has read all of it.
            </p>
          ) : (
            <>
              {estimate?.problem ? (
                <div className="mt-4">
                  <ProblemNotice message={estimate.problem} />
                </div>
              ) : (
                <p className="mt-3 min-h-5 text-[13px] text-fg" aria-live="polite">
                  {estimate ? costWords(estimate) : <span className="text-faint">Working out the cost…</span>}
                </p>
              )}
              <div className="mt-4 flex items-center gap-2">
                <Button variant="primary" icon={<Brain size={14} />} loading={starting} disabled={!!estimate?.problem} onClick={() => void start()}>
                  Build the memory
                </Button>
                <Button variant="ghost" onClick={() => void openImported(storyId)}>
                  Not now
                </Button>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-faint">
                You can do it later from the story’s menu, or the command palette.
              </p>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

function CatchUpProgressBlock({ storyId }: { storyId: ID }): React.JSX.Element | null {
  const run = useImport((s) => (s.catchUp.running?.storyId === storyId ? s.catchUp.running : null))
  if (!run) return null
  const share = run.scenes ? Math.min(1, run.read / run.scenes) : 0
  const isNew = useNewLook()
  if (run.status === 'paused') {
    return (
      <div className="mt-4">
        <ProblemNotice message={run.error ?? 'Building the memory has paused.'} onRetry={() => void buildMemory(storyId)} />
      </div>
    )
  }
  return (
    <div className="mt-4" role="status">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="font-medium text-fg">{catchUpWords(run)}</span>
        <Button size="sm" icon={<Square size={10} fill="currentColor" />} disabled={run.status === 'stopping'} onClick={() => void stopBuildingMemory()}>
          Stop
        </Button>
      </div>
      {isNew ? (
        <div className="mt-3">
          <InkProgress run={run} />
        </div>
      ) : (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-[12px] tabular-nums text-faint">
        {run.read.toLocaleString('en-US')} of {run.scenes.toLocaleString('en-US')} scenes read
      </p>
    </div>
  )
}
