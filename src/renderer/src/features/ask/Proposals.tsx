// The editor chat's proposed changes under its answer: each as a small card saying what would change (words struck
// through and their replacement, a card's or an entry's new values, a new scene, a new title) and why, with Apply and
// Not this; Apply all when several are waiting. Nothing changes until Adam applies (applyProposal.ts), and each
// applied change can be undone.
import { useState } from 'react'
import type { Proposal } from '@shared/contracts/ask'
import { KIND_LABELS } from '@shared/fields'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { applyChanges, declineChange } from './applyProposal'
import { findPassage, findQuote } from './askEdits'

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
  }
}

const Line = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <p className="break-words text-[12.5px] leading-relaxed">
    <span className="font-medium text-muted">{label}: </span>
    <span className="text-fg">{value || '(empty)'}</span>
  </p>
)

function Body({ p }: { p: Proposal }): React.JSX.Element {
  switch (p.kind) {
    case 'text':
      return (
        <p className="break-words font-serif text-[13.5px] leading-[1.6]">
          <del className="rounded-sm bg-danger-soft text-danger decoration-danger/60">{p.find}</del>
          {p.replace ? (
            <>
              {' '}
              <ins className="rounded-sm bg-success-soft text-success no-underline">{p.replace}</ins>
            </>
          ) : null}
        </p>
      )
    case 'passage':
      return (
        <div className="flex flex-col gap-1.5 font-serif text-[13.5px] leading-[1.6]">
          <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
            <del className="rounded-sm bg-danger-soft text-danger decoration-danger/60">{p.original}</del>
          </p>
          <p className="max-h-60 overflow-auto whitespace-pre-wrap break-words">
            <ins className="rounded-sm bg-success-soft text-success no-underline">{p.replace}</ins>
          </p>
        </div>
      )
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
        <p className="break-words text-[12.5px] leading-relaxed text-fg">
          <del className="text-muted">{p.from || 'Untitled'}</del> → <span className="font-medium">{p.to}</span>
        </p>
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
      const r = p.kind === 'text' ? findQuote(doc, p.find) : (findPassage(doc, p.start, p.end) ?? findQuote(doc, p.start))
      if (r) b.editor.chain().focus().setTextSelection(r).scrollIntoView().run()
      return
    }
    if (Date.now() < until) setTimeout(look, 50)
  }
  look()
}

function ProposalCard({ generationId, p, busy, onApply }: { generationId: ID; p: Proposal; busy: boolean; onApply: () => void }): React.JSX.Element {
  return (
    <li
      data-proposal={p.id}
      data-status={p.status}
      className={cn(
        'rounded-lg border px-3 py-2.5 transition-opacity duration-150',
        p.status === 'applied' ? 'border-success/30 bg-success-soft/40' : 'border-line bg-surface',
        p.status === 'declined' && 'opacity-60'
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold uppercase tracking-wide text-faint">{headOf(p)}</span>
        {p.status === 'applied' ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-success">
            <Check size={13} aria-hidden /> Applied
          </span>
        ) : p.status === 'declined' ? (
          <span className="shrink-0 text-[12px] text-faint">Set aside</span>
        ) : null}
      </div>
      <Body p={p} />
      {p.why ? <p className="mt-1.5 break-words text-[12px] italic leading-relaxed text-muted">{p.why}</p> : null}
      {p.status !== 'applied' ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={onApply}>
            {p.status === 'declined' ? 'Apply anyway' : 'Apply'}
          </Button>
          {p.status === 'pending' ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void declineChange(generationId, p)}>
              Not this
            </Button>
          ) : null}
          {p.kind === 'text' || p.kind === 'passage' ? (
            <Button size="sm" variant="ghost" onClick={() => showInPage(p)}>
              Show in page
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** The proposed changes under an answer. */
export function Proposals({ generationId, proposals, streaming }: { generationId: ID; proposals: Proposal[]; streaming: boolean }): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  if (!proposals.length) return null
  const waiting = proposals.filter((p) => p.status === 'pending')
  const run = (list: Proposal[]): void => {
    setBusy(true)
    void applyChanges(generationId, list).finally(() => setBusy(false))
  }
  return (
    <section aria-label="Proposed changes" className="mt-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 text-[12px] font-medium text-muted">
          {proposals.length === 1 ? 'A proposed change' : `${proposals.length} proposed changes`} · nothing changes until you apply
        </span>
        {waiting.length > 1 && !streaming ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(waiting)}>
            Apply all ({waiting.length})
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2">
        {proposals.map((p) => (
          <ProposalCard key={p.id} generationId={generationId} p={p} busy={busy || streaming} onApply={() => run([p])} />
        ))}
      </ul>
    </section>
  )
}
