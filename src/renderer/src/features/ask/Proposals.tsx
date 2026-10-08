// The editor chat's proposed changes inside its answer (restyled in the chat overhaul's Phase 2): a bar saying how many
// are ready, with Apply all and Review in page, then a card each saying what would change and why. An edit to a scene's
// words shows as a word-level change (only what changes, with a few words either side and "…" for the rest; the whole
// change a click away); a card's or an entry's new values, a new scene or a new title as before. A card is waiting,
// being applied, applied (✓ with its own Undo), set aside (Not this), or stale (its words are no longer in the scene).
// Nothing changes until Adam applies (applyProposal.ts), and each applied change can be undone.
import { useId, useState } from 'react'
import { create } from 'zustand'
import type { Proposal } from '@shared/contracts/ask'
import { KIND_LABELS } from '@shared/fields'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import {
  AlertTriangle,
  BetweenHorizontalStart,
  BookA,
  CheckCircle2,
  CircleSlash,
  Feather,
  FilePlus2 as FilePlus,
  ListOrdered,
  Pencil,
  Pilcrow,
  Scissors,
  SquareStack,
  TextCursorInput,
  Undo2 as Undo,
  Wrench,
  type IconType
} from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { KIND_ICONS, KIND_INK } from '@/features/world/kindIcons'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { applyChanges, declineChange, showScene } from './applyProposal'
import { parseEmphasis } from '@/features/editor/streamText'
import { blockAt, findEditAt, findPassageAt } from './askEdits'
import { compactDiff, diffSize, folds, wordDiff, type DiffPart } from './wordDiff'

const CARD_LABELS: Record<string, string> = { goal: 'Goal', conflict: 'Conflict', outcome: 'Outcome', mood: 'Mood', when: 'When', notes: 'Notes' }

/** What a proposal is, in a few words, for its card's head. */
function headOf(p: Proposal): string {
  switch (p.kind) {
    case 'text':
      return p.replace ? `Edit · ${p.sceneLabel}` : `Cut · ${p.sceneLabel}`
    case 'passage':
      return `Rewrite · ${p.sceneLabel}`
    case 'card':
      return `Scene card · ${p.sceneLabel}`
    case 'entry':
      return `${KIND_LABELS[p.entryKind].one} · ${p.name}`
    case 'newEntry':
      return `New ${KIND_LABELS[p.entryKind].one.toLowerCase()}`
    case 'newScene':
      return `New scene · ${p.chapterLabel}`
    case 'newChapter':
      return 'New chapter'
    case 'rename':
      return p.target === 'scene' ? 'New scene title' : 'New chapter title'
    case 'draft':
      return `Draft · ${p.sceneLabel}`
    case 'insert':
      return `Insert · ${p.sceneLabel}`
    case 'cut':
      return `Cut · ${p.sceneLabel}`
    case 'beats':
      return `Beats · ${p.sceneLabel}`
    case 'issueFix':
      return p.how === 'memory' && p.memory ? `Memory fix · ${p.memory.name}` : `Issue fix${p.sceneLabel ? ` · ${p.sceneLabel}` : ''}`
    case 'chapterCard':
      return `Chapter card · ${p.chapterLabel}`
    case 'thread':
      return `${p.threadId ? 'Plot thread' : 'New plot thread'} · ${p.name}`
  }
}

// ---------- STORYTOOLS (chat Phase 3): an issue fix, a chapter card change, a plot thread link ----------

/** A change's from → to, for a card's part or an entry's field. */
const Change = ({ label, from, to }: { label: string; from: string; to: string }): React.JSX.Element => (
  <div className="break-words text-[12.5px] leading-relaxed">
    <span className="font-medium text-muted">{label}: </span>
    {from ? (
      <>
        <del className="text-muted">{from}</del> →{' '}
      </>
    ) : null}
    <span className="text-fg">{to || '(empty)'}</span>
  </div>
)

const SEVERITY: Record<Extract<Proposal, { kind: 'issueFix' }>['severity'], string> = { 'must-fix': 'Must fix', warning: 'Worth a look', minor: 'Minor' }

/** Started in the page rather than applied here (it is kept or undone there): a draft, or a fix with no suggested rewrite. */
const startedInPage = (p: Proposal): boolean => p.kind === 'draft' || (p.kind === 'issueFix' && p.how === 'text' && !p.fix)

// ---------- TEXTTOOLS (chat Phase 3): an insert, a cut, a change to the beats ----------

/** Words as the page shows them: *italics* and **bold** as marks. */
function Emphasis({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {parseEmphasis(text).map((piece, i) =>
        piece.italic || piece.bold ? (
          <span key={i} className={cn(piece.italic && 'italic', piece.bold && 'font-semibold')}>
            {piece.text}
          </span>
        ) : (
          <span key={i}>{piece.text}</span>
        )
      )}
    </>
  )
}

const paragraphsOf = (text: string): string[] => text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
const wordCount = (texts: string[]): number => texts.join(' ').split(/\s+/).filter(Boolean).length

/** "Show all" / "Show less" under a long change. */
function MoreToggle({ id, whole, onToggle, more }: { id: string; whole: boolean; onToggle: () => void; more: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={whole}
      aria-controls={id}
      onClick={onToggle}
      className="rounded-sm font-medium text-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
    >
      {whole ? 'Show less' : more}
    </button>
  )
}

/** An insert: the paragraph it goes next to, faint and cut short, and the new paragraphs in the success ink. */
function InsertBody({ p }: { p: Extract<Proposal, { kind: 'insert' }> }): React.JSX.Element {
  const added = paragraphsOf(p.text)
  const near = (
    <p data-insert-near className="line-clamp-2 text-faint" title={`Paragraph ${p.at.paragraph}, as it stays`}>
      <span className="mr-1 font-sans text-[11px] tabular-nums">¶{p.at.paragraph}</span>
      <Emphasis text={p.near} />
    </p>
  )
  const fresh = (
    <div data-insert-text className="flex flex-col gap-1.5 border-l-2 border-success/50 pl-2">
      {added.map((t, i) => (
        <ins key={i} className="block rounded-sm bg-success-soft px-0.5 text-success no-underline">
          <Emphasis text={t} />
        </ins>
      ))}
    </div>
  )
  return (
    <div>
      <div className="flex flex-col gap-1.5 whitespace-pre-wrap break-words font-serif text-[13.5px] leading-[1.6] text-fg">
        {p.where === 'before' ? (
          <>
            {fresh}
            {near}
          </>
        ) : (
          <>
            {near}
            {fresh}
          </>
        )}
      </div>
      <div className="mt-1 text-[11.5px] tabular-nums text-faint">
        +{wordCount(added)} {wordCount(added) === 1 ? 'word' : 'words'} · {p.where} paragraph {p.at.paragraph}
      </div>
    </div>
  )
}

/** A cut: the paragraphs struck through, folded to the first two (each to a few lines) when long. */
function CutBody({ p }: { p: Extract<Proposal, { kind: 'cut' }> }): React.JSX.Element {
  const [whole, setWhole] = useState(false)
  const id = useId()
  const long = p.paragraphs.length > 2 || p.paragraphs.some((t) => t.length > 320)
  const shown = whole || !long ? p.paragraphs : p.paragraphs.slice(0, 2)
  const n = p.paragraphs.length
  return (
    <div>
      <div id={id} className={cn('flex flex-col gap-1.5 whitespace-pre-wrap break-words font-serif text-[13.5px] leading-[1.6]', whole && 'max-h-72 overflow-auto')}>
        {shown.map((t, i) => (
          <del key={i} data-cut-paragraph className={cn('block rounded-sm bg-danger-soft px-0.5 text-danger decoration-danger/60', !whole && long && 'line-clamp-4')}>
            <Emphasis text={t} />
          </del>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-faint">
        <span className="tabular-nums">
          −{wordCount(p.paragraphs)} {wordCount(p.paragraphs) === 1 ? 'word' : 'words'} ·{' '}
          {n === 1 ? `paragraph ${p.from.paragraph}` : `paragraphs ${p.from.paragraph}–${p.to.paragraph}`}
        </span>
        {long ? <MoreToggle id={id} whole={whole} onToggle={() => setWhole((w) => !w)} more={n > 2 ? `Show all ${n}` : 'Show all'} /> : null}
      </div>
    </div>
  )
}

/** The beats as they would be: a new one or a reworded one in the success ink, one taken out struck through. */
function BeatsBody({ p }: { p: Extract<Proposal, { kind: 'beats' }> }): React.JSX.Element {
  type Row = { text: string; how: 'same' | 'new' | 'gone' }
  const rows: Row[] =
    p.op === 'replace'
      ? [
          ...p.beats.map((b): Row => ({ text: b, how: p.before.includes(b) ? 'same' : 'new' })),
          ...p.before.filter((b) => !p.beats.includes(b)).map((b): Row => ({ text: b, how: 'gone' }))
        ]
      : p.op === 'remove'
        ? p.before.map((b, i): Row => ({ text: b, how: i + 1 === p.index ? 'gone' : 'same' }))
        : p.op === 'edit'
          ? p.before.flatMap((b, i): Row[] => (i + 1 === p.index ? [{ text: b, how: 'gone' }, { text: p.beats[i], how: 'new' }] : [{ text: b, how: 'same' }]))
          : p.beats.map((b, i): Row => ({ text: b, how: i + 1 === p.index ? 'new' : 'same' }))
  let n = 0
  return (
    <div className="text-[12.5px] leading-relaxed">
      <ol className="flex flex-col gap-0.5" data-beats>
        {rows.map((r, i) => (
          <li key={i} data-beat={r.how} className="flex gap-1.5">
            <span className="w-4 shrink-0 text-right tabular-nums text-faint">{r.how === 'gone' ? '' : `${++n}.`}</span>
            {r.how === 'gone' ? (
              <del className="min-w-0 rounded-sm bg-danger-soft px-0.5 text-danger decoration-danger/60">{r.text}</del>
            ) : r.how === 'new' ? (
              <ins className="min-w-0 rounded-sm bg-success-soft px-0.5 text-success no-underline">{r.text}</ins>
            ) : (
              <span className="min-w-0 text-fg">{r.text}</span>
            )}
          </li>
        ))}
      </ol>
      {p.marks ? (
        <div className="mt-1.5 flex items-start gap-1 text-[12px] text-muted" data-beat-marks>
          <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0 text-danger" />
          <span>This scene has beat markers on the page, numbered by these beats: after this change, a marker may sit beside a different beat.</span>
        </div>
      ) : null}
    </div>
  )
}

/** A proposed draft's way of writing, in the writer's own words for it (propose_draft, lab switch DRAFT). */
export function draftModeLabel(p: Extract<Proposal, { kind: 'draft' }>): string {
  switch (p.mode) {
    case 'generate':
      return 'Generate (below any words already there)'
    case 'add_below':
      return 'Add below'
    case 'continue':
      return p.atParagraph ? `Continue from paragraph ${p.atParagraph.paragraph}` : 'Continue from the end'
    case 'redo_beat':
      return p.beat ? `Redo beat ${p.beat.index}` : 'Redo a beat'
    default:
      return String(p.mode)
  }
}

const Line = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div className="break-words text-[12.5px] leading-relaxed">
    <span className="font-medium text-muted">{label}: </span>
    <span className="text-fg">{value || '(empty)'}</span>
  </div>
)

/** A change's kept, cut and added words; a gap is "…" for words that stay as they are. */
function DiffWords({ parts }: { parts: DiffPart[] }): React.JSX.Element {
  return (
    <>
      {parts.map((d, i) => {
        if (d.kind === 'gap')
          return (
            <span key={i} className="mx-0.5 rounded-sm bg-surface-2 px-1 font-sans text-[11.5px] text-faint" title={`${d.words} words unchanged`}>
              …
            </span>
          )
        if (d.kind === 'same') return <span key={i}>{d.text}</span>
        // A cut straight before an addition gets a space between them.
        const spaced = d.kind === 'del' && parts[i + 1]?.kind === 'ins'
        return d.kind === 'del' ? (
          <span key={i}>
            <del className="rounded-sm bg-danger-soft text-danger decoration-danger/60">{d.text}</del>
            {spaced ? ' ' : null}
          </span>
        ) : (
          <ins key={i} className="rounded-sm bg-success-soft text-success no-underline">
            {d.text}
          </ins>
        )
      })}
    </>
  )
}

/** A change to a scene's words, folded to what changes; "Show all" opens the whole change. */
function Diff({ before, after }: { before: string; after: string }): React.JSX.Element {
  const [whole, setWhole] = useState(false)
  const id = useId()
  const parts = wordDiff(before, after)
  const foldable = folds(parts)
  const { cut, added } = diffSize(parts)
  return (
    <div>
      <div id={id} className={cn('whitespace-pre-wrap break-words font-serif text-[13.5px] leading-[1.6] text-fg', whole && 'max-h-72 overflow-auto')}>
        <DiffWords parts={whole ? parts : compactDiff(parts)} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-faint">
        <span className="tabular-nums">
          {cut ? `−${cut}` : ''}
          {cut && added ? ' ' : ''}
          {added ? `+${added}` : ''} {cut + added === 1 ? 'word' : 'words'}
        </span>
        {foldable ? (
          <button
            type="button"
            aria-expanded={whole}
            aria-controls={id}
            onClick={() => setWhole((w) => !w)}
            className="rounded-sm font-medium text-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {whole ? 'Show less' : 'Show all'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Body({ p }: { p: Proposal }): React.JSX.Element {
  switch (p.kind) {
    case 'text':
      return <Diff before={p.find} after={p.replace} />
    case 'passage':
      return <Diff before={p.original} after={p.replace} />
    case 'card':
      return (
        <div className="flex flex-col gap-0.5">
          {(p.names ?? []).map((n) => (
            <Change key={n.label} {...n} />
          ))}
          {Object.entries(CARD_LABELS).map(([k, label]) =>
            typeof p.patch[k as keyof typeof p.patch] === 'string' ? <Line key={k} label={label} value={p.patch[k as 'goal'] as string} /> : null
          )}
          {p.patch.beats ? (
            <div className="text-[12.5px] leading-relaxed">
              <span className="font-medium text-muted">Beats:</span>
              <ol className="ml-4 list-decimal text-fg">
                {p.patch.beats.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )
    case 'entry':
      return (
        <div className="flex flex-col gap-0.5">
          {p.patch.summary !== undefined ? <Line label="Summary" value={p.patch.summary} /> : null}
          {p.patch.description !== undefined ? <Line label="Description" value={p.patch.description} /> : null}
          {p.patch.aliases ? <Line label="Also called" value={p.patch.aliases.join(', ')} /> : null}
          {Object.entries(p.patch.fields ?? {}).map(([k, v]) => (
            <Line key={k} label={k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase()} value={v} />
          ))}
        </div>
      )
    case 'newEntry':
      return (
        <div className="flex flex-col gap-0.5">
          <Line label="Name" value={p.name} />
          {p.summary ? <Line label="Summary" value={p.summary} /> : null}
          {p.description ? <Line label="Description" value={p.description} /> : null}
        </div>
      )
    case 'newScene':
      return (
        <div className="flex flex-col gap-0.5">
          <Line label="Title" value={p.title} />
          {p.card.goal ? <Line label="Goal" value={p.card.goal} /> : null}
          {p.card.beats?.length ? <Line label="Beats" value={p.card.beats.join(' · ')} /> : null}
        </div>
      )
    case 'newChapter':
      return <Line label="Title" value={p.title} />
    case 'rename':
      return (
        <div className="break-words text-[12.5px] leading-relaxed text-fg">
          <del className="text-muted">{p.from || 'Untitled'}</del> → <span className="font-medium">{p.to}</span>
        </div>
      )
    case 'draft':
      return (
        <div className="flex flex-col gap-0.5" data-draft-mode={p.mode}>
          <Line label="How" value={draftModeLabel(p)} />
          <Line label="Scene" value={p.sceneLabel} />
          {p.beat ? <Line label={`Beat ${p.beat.index}`} value={p.beat.text} /> : null}
          <Line label="Direction" value={p.direction} />
          <Line label="Length" value={p.length ? `about ${p.length.toLocaleString()} words` : 'the scene’s own'} />
        </div>
      )
    case 'issueFix':
      return (
        <div className="flex flex-col gap-1" data-issue-fix={p.how}>
          <div className="break-words text-[12.5px] leading-relaxed text-fg">
            <span className={cn('mr-1.5 text-[11px] font-semibold uppercase tracking-wide', p.severity === 'must-fix' ? 'text-danger' : 'text-muted')}>{SEVERITY[p.severity]}</span>
            {p.message}
          </div>
          {p.how === 'memory' && p.memory ? (
            <Change label={`${p.memory.name}’s ${p.memory.fieldLabel}`} from={p.memory.from} to={p.memory.to} />
          ) : p.fix ? (
            <Diff before={p.quote} after={p.fix} />
          ) : (
            <>
              {p.quote ? <div className="break-words font-serif text-[13.5px] leading-[1.6] text-muted">“{p.quote}”</div> : null}
              <div className="text-[12px] leading-relaxed text-muted">No suggested rewrite: Apply has the AI rewrite the sentence, as a change to accept or reject in the page.</div>
            </>
          )}
        </div>
      )
    case 'chapterCard':
      return (
        <div className="flex flex-col gap-0.5">
          {p.lines.map((l) => (
            <Change key={l.label} {...l} />
          ))}
          <div className="mt-0.5 text-[12px] text-muted" data-chapter-scenes={p.scenes}>
            {p.scenes ? `Updates ${p.scenes} ${p.scenes === 1 ? 'scene that follows' : 'scenes that follow'} this chapter card` : 'No scene follows these parts yet'}
          </div>
        </div>
      )
    case 'thread':
      return (
        <div className="flex flex-col gap-0.5" data-thread-action={p.action}>
          <Line label={p.list === 'setsUp' ? 'Set up in' : 'Paid off in'} value={p.sceneLabel} />
          {!p.threadId && p.note ? <Line label="What it promises" value={p.note} /> : null}
        </div>
      )
    case 'insert':
      return <InsertBody p={p} />
    case 'cut':
      return <CutBody p={p} />
    case 'beats':
      return <BeatsBody p={p} />
  }
}

/** Where a whole-paragraph change stands in the page (TEXTTOOLS): the paragraph an insert goes next to, a cut's paragraphs. */
function blocksRange(doc: Parameters<typeof blockAt>[0], p: Extract<Proposal, { kind: 'insert' | 'cut' }>): { from: number; to: number } | null {
  const [a, b] = p.kind === 'insert' ? [blockAt(doc, p.at, p.near), blockAt(doc, p.at, p.near)] : [blockAt(doc, p.from, p.paragraphs[0]), blockAt(doc, p.to, p.paragraphs.at(-1) ?? '')]
  if (a === null || b === null || b < a) return null
  let pos = 0
  for (let i = 0; i < a; i++) pos += doc.child(i).nodeSize
  let end = pos
  for (let i = a; i <= b; i++) end += doc.child(i).nodeSize
  return { from: pos + 1, to: end - 1 }
}

/** Opens the scene and selects the words a proposed edit (or rewrite, insert or cut) would change, so Adam sees them in place. */
function showInPage(p: InPage): void {
  const app = useApp.getState()
  app.selectScene(p.sceneId)
  const until = Date.now() + 4000
  const look = (): void => {
    const b = editorBridge()
    if (b?.sceneId === p.sceneId && b.editor && !b.editor.isDestroyed) {
      const doc = b.editor.state.doc
      // Where the chat says the words stand, when it says (the same words may be elsewhere too); else where they are.
      const r =
        p.kind === 'insert' || p.kind === 'cut'
          ? blocksRange(doc, p)
          : p.kind === 'text'
            ? findEditAt(doc, p.find, p.at)
            : (findPassageAt(doc, p.start, p.end, p.at) ?? findEditAt(doc, p.start, p.at?.start))
      if (r) b.editor.chain().focus().setTextSelection(r).scrollIntoView().run()
      return
    }
    if (Date.now() < until) setTimeout(look, 50)
  }
  look()
}

/** What this session knows of a change beyond its status: it is being applied, its own Undo, or why it couldn't go in. */
interface Local {
  applying?: boolean
  undo?: () => Promise<void>
  stale?: string
}

const useLocal = create<Record<string, Local>>(() => ({}))
const localKey = (generationId: ID, id: string): string => `${generationId}:${id}`
const setLocal = (key: string, patch: Local): void => useLocal.setState((s) => ({ [key]: { ...s[key], ...patch } }))

/** Applies changes, each card showing it is being applied, then its own Undo (or why it couldn't go in). */
async function apply(generationId: ID, list: Proposal[]): Promise<void> {
  for (const p of list) setLocal(localKey(generationId, p.id), { applying: true, stale: undefined })
  try {
    const { undoOf, failedOf } = await applyChanges(generationId, list)
    for (const p of list) setLocal(localKey(generationId, p.id), { applying: false, undo: undoOf[p.id], stale: failedOf[p.id] })
  } catch {
    for (const p of list) setLocal(localKey(generationId, p.id), { applying: false })
  }
}

const KIND_ICON: Record<Exclude<Proposal['kind'], 'entry' | 'newEntry' | 'thread'>, IconType> = {
  text: Pencil,
  passage: Pilcrow,
  card: SquareStack,
  newScene: FilePlus,
  newChapter: FilePlus,
  rename: TextCursorInput,
  draft: Feather,
  insert: BetweenHorizontalStart,
  cut: Scissors,
  beats: ListOrdered,
  issueFix: Wrench,
  chapterCard: BookA
}

/** A change's icon and its tile's ink: an entry's kind in its own ink; a cut, scissors; the rest by what they change. */
function markOf(p: Proposal): { Icon: IconType; tile: string } {
  if (p.kind === 'entry' || p.kind === 'newEntry') return { Icon: KIND_ICONS[p.entryKind], tile: KIND_INK[p.entryKind].tile }
  if ((p.kind === 'text' && !p.replace) || p.kind === 'cut') return { Icon: Scissors, tile: 'bg-danger-soft text-danger' }
  if (p.kind === 'insert') return { Icon: BetweenHorizontalStart, tile: 'bg-success-soft text-success' }
  if (p.kind === 'draft') return { Icon: Feather, tile: 'bg-ai-soft text-ai' }
  // A plot thread in its own ink, with the app's thread mark; an issue fix as a fix (a memory fix in the memory's ink).
  if (p.kind === 'thread') return { Icon: KIND_ICONS.thread, tile: KIND_INK.thread.tile }
  if (p.kind === 'issueFix') return { Icon: p.how === 'memory' ? CheckCircle2 : Wrench, tile: 'bg-accent-soft text-accent' }
  return { Icon: KIND_ICON[p.kind], tile: 'bg-surface-2 text-muted' }
}

/** A change to a scene's words, which Show in page shows. */
type InPage = Extract<Proposal, { kind: 'text' | 'passage' | 'insert' | 'cut' }>
const isWords = (p: Proposal): p is InPage => p.kind === 'text' || p.kind === 'passage' || p.kind === 'insert' || p.kind === 'cut'

function ChangeCard({ generationId, p, locked }: { generationId: ID; p: Proposal; locked: boolean }): React.JSX.Element {
  const key = localKey(generationId, p.id)
  const local = useLocal((s) => s[key]) ?? {}
  const { Icon, tile } = markOf(p)
  const entryInk = p.kind === 'entry' || p.kind === 'newEntry' ? KIND_INK[p.entryKind] : p.kind === 'thread' ? KIND_INK.thread : null
  const stale = p.status === 'pending' && !local.applying && !!local.stale
  const state = local.applying ? 'applying' : stale ? 'stale' : p.status
  return (
    <li
      data-proposal={p.id}
      data-status={p.status}
      data-state={state}
      className={cn(
        'rounded-lg border px-3 pb-2 pt-2.5 transition-[opacity,border-color,background-color] duration-150',
        p.status === 'applied'
          ? 'border-success/30 bg-success-soft/30'
          : stale
            ? 'border-danger/30 bg-surface look-new:bg-raise'
            : 'border-line bg-surface look-new:bg-raise look-new:shadow-e1',
        p.status === 'declined' && 'opacity-60'
      )}
    >
      <div className="mb-1.5 flex h-5 items-center gap-1.5">
        <span aria-hidden data-change-mark className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', tile)}>
          <Icon size={12} />
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-[11.5px] font-semibold uppercase tracking-wide', entryInk ? entryInk.text : 'text-faint')}>{headOf(p)}</span>
        {p.status === 'applied' ? (
          <span className="flex shrink-0 animate-fade-in items-center gap-1 text-[12px] font-medium text-success">
            {/* A draft is started, not applied: its words are written (and kept or undone) in the scene. */}
            <CheckCircle2 size={13} aria-hidden /> {p.kind === 'draft' ? 'Started' : startedInPage(p) ? 'In the page' : 'Applied'}
          </span>
        ) : p.status === 'declined' ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-faint">
            <CircleSlash size={12} aria-hidden /> Set aside
          </span>
        ) : stale ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-danger">
            <AlertTriangle size={12} aria-hidden /> Not found
          </span>
        ) : null}
      </div>
      <div className={cn(p.status === 'applied' && 'opacity-80')}>
        <Body p={p} />
      </div>
      {p.why ? <div className="mt-1.5 break-words text-[12px] italic leading-relaxed text-muted">{p.why}</div> : null}
      {stale ? <div className="mt-1.5 break-words text-[12px] leading-relaxed text-danger">{local.stale}</div> : null}
      <div className="mt-2 flex min-h-7 flex-wrap items-center gap-1.5">
        {p.status === 'applied' ? (
          (p.kind === 'draft' || startedInPage(p)) && 'sceneId' in p && p.sceneId ? (
            <Button size="sm" variant="ghost" onClick={() => showScene(p.sceneId!)}>
              Show {p.sceneLabel}
            </Button>
          ) : local.undo ? (
            <Button size="sm" variant="ghost" icon={<Undo size={13} />} onClick={() => void local.undo?.().then(() => setLocal(key, { undo: undefined }))} aria-label={`Undo this change: ${headOf(p)}`}>
              Undo
            </Button>
          ) : null
        ) : (
          <>
            <Button size="sm" variant="primary" disabled={locked} loading={local.applying} onClick={() => void apply(generationId, [p])}>
              {p.status === 'declined' ? 'Apply anyway' : stale ? 'Try again' : 'Apply'}
            </Button>
            {p.status === 'pending' ? (
              <Button size="sm" variant="ghost" disabled={locked || local.applying} onClick={() => void declineChange(generationId, p)}>
                Not this
              </Button>
            ) : null}
            {isWords(p) ? (
              <Button size="sm" variant="ghost" onClick={() => showInPage(p)}>
                Show in page
              </Button>
            ) : null}
          </>
        )}
      </div>
    </li>
  )
}

/** "3 changes ready · Apply all · Review in page": stays at the top of the panel while the turn's cards scroll under it. */
function ChangesBar({ generationId, proposals, locked }: { generationId: ID; proposals: Proposal[]; locked: boolean }): React.JSX.Element {
  const local = useLocal()
  const pending = proposals.filter((p) => p.status === 'pending')
  // A draft is started on its own (it writes into its scene for a while), never with Apply all.
  const waiting = pending.filter((p) => !startedInPage(p))
  const inPage = pending.filter(isWords)
  const applied = proposals.filter((p) => p.status === 'applied').length
  const busy = proposals.some((p) => local[localKey(generationId, p.id)]?.applying)
  const words = pending.length
    ? `${pending.length} ${pending.length === 1 ? 'change' : 'changes'} ready`
    : applied
      ? `${applied === proposals.length && applied > 1 ? 'All' : applied} applied`
      : proposals.length === 1
        ? 'Set aside'
        : 'All set aside'
  return (
    <div data-changes-bar className="sticky top-0 z-[1] -mx-1 flex min-h-9 flex-wrap items-center gap-x-1 gap-y-1 bg-surface/95 px-2 py-1 backdrop-blur-sm">
      <span className="mr-auto text-[12.5px] font-medium text-fg" title={pending.length ? 'Nothing changes until you apply' : undefined}>
        {words}
      </span>
      {waiting.length > 1 ? (
        <Button size="sm" variant="secondary" disabled={locked || busy} onClick={() => void apply(generationId, waiting)}>
          Apply all
        </Button>
      ) : null}
      {inPage.length ? (
        <Button size="sm" variant="ghost" onClick={() => showInPage(inPage[0])} title="Opens the scene with the words this change would change selected">
          Review in page
        </Button>
      ) : null}
    </div>
  )
}

/** The proposed changes in an answer. */
export function Proposals({ generationId, proposals, streaming }: { generationId: ID; proposals: Proposal[]; streaming: boolean }): React.JSX.Element | null {
  if (!proposals.length) return null
  return (
    <section aria-label="Proposed changes" className="mt-3 flex flex-col gap-2">
      <ChangesBar generationId={generationId} proposals={proposals} locked={streaming} />
      <ul className="flex flex-col gap-2">
        {proposals.map((p) => (
          <ChangeCard key={p.id} generationId={generationId} p={p} locked={streaming} />
        ))}
      </ul>
    </section>
  )
}
