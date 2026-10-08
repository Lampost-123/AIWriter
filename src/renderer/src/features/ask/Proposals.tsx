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
import { AlertTriangle, Check, FilePlus2 as FilePlus, ListChecks, NotebookText, PenLine, Sparkles, Type, Undo2 as Undo, type IconType } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { applyChanges, declineChange, showScene } from './applyProposal'
import { findEditAt, findPassageAt } from './askEdits'
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
  }
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
  }
}

/** Opens the scene and selects the words a proposed edit (or rewrite) would change, so Adam sees them in place. */
function showInPage(p: Extract<Proposal, { kind: 'text' | 'passage' }>): void {
  const app = useApp.getState()
  app.selectScene(p.sceneId)
  const until = Date.now() + 4000
  const look = (): void => {
    const b = editorBridge()
    if (b?.sceneId === p.sceneId && b.editor && !b.editor.isDestroyed) {
      const doc = b.editor.state.doc
      // Where the chat says the words stand, when it says (the same words may be elsewhere too); else where they are.
      const r = p.kind === 'text' ? findEditAt(doc, p.find, p.at) : (findPassageAt(doc, p.start, p.end, p.at) ?? findEditAt(doc, p.start, p.at?.start))
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

const KIND_ICON: Record<Proposal['kind'], IconType> = {
  text: PenLine,
  passage: PenLine,
  card: ListChecks,
  entry: NotebookText,
  newEntry: FilePlus,
  newScene: FilePlus,
  newChapter: FilePlus,
  rename: Type,
  draft: Sparkles
}

const isWords = (p: Proposal): p is Extract<Proposal, { kind: 'text' | 'passage' }> => p.kind === 'text' || p.kind === 'passage'

function ChangeCard({ generationId, p, locked }: { generationId: ID; p: Proposal; locked: boolean }): React.JSX.Element {
  const key = localKey(generationId, p.id)
  const local = useLocal((s) => s[key]) ?? {}
  const Icon = KIND_ICON[p.kind]
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
        <Icon size={13} aria-hidden className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold uppercase tracking-wide text-faint">{headOf(p)}</span>
        {p.status === 'applied' ? (
          <span className="flex shrink-0 animate-fade-in items-center gap-1 text-[12px] font-medium text-success">
            {/* A draft is started, not applied: its words are written (and kept or undone) in the scene. */}
            <Check size={13} strokeWidth={2.5} aria-hidden /> {p.kind === 'draft' ? 'Started' : 'Applied'}
          </span>
        ) : p.status === 'declined' ? (
          <span className="shrink-0 text-[12px] text-faint">Set aside</span>
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
          p.kind === 'draft' ? (
            <Button size="sm" variant="ghost" onClick={() => showScene(p.sceneId)}>
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
  const waiting = pending.filter((p) => p.kind !== 'draft')
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
