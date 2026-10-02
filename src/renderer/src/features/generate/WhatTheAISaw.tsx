// "What the AI saw": the saved record of one draft, laid out like the briefing
// it was given. This is how Adam finds out why the AI got something wrong:
// whether a fact was missing, out of date, or ignored.
import * as S from '@radix-ui/react-switch'
import { ArrowLeft, ChevronRight, Copy, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ContextBlock, GenerationRecord, ID } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { countWords } from '@shared/defaults'
import { Button, Card, Notice, SectionTitle, toast } from '@/components/ui'
import { api, modKey, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { requestPutBack } from '@/features/editor/putBack'
import { variantsBackTo } from '@/features/variants/back'
import { editRecordWords } from '@/features/edits/record'
import { THINKING_LABELS, budgetShare, creativityOf, formatContext, formatCost, formatNumber, fullDate } from './format'
import { Skeleton, useDelayed } from './parts'

type Entry = GenerationRecord['entries'][number]

/** The messages of an answer in Ask the world (milestone 4): its briefing, then the chat's earlier turns and the question. */
const CHAT_ROLES: Record<GenerationRecord['messages'][number]['role'], string> = {
  system: 'Instructions and briefing',
  user: 'Question',
  assistant: 'Earlier answer'
}

/** The parts Adam had open in each record this session, so coming back from an entry shows them open again. */
const openParts = new Map<ID, Set<string>>()

export function WhatTheAISaw({
  generationId,
  fromHistory
}: {
  generationId: ID
  /** Opened from this version in a scene's History (milestone 4): Back returns there. */
  fromHistory?: { sceneId: ID; snapshotId: ID }
}): React.JSX.Element {
  const [rec, setRec] = useState<GenerationRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sceneTitle, setSceneTitle] = useState<string | null>(null)
  /** The draft's scene couldn't be opened (deleted since, perhaps). */
  const [sceneGone, setSceneGone] = useState(false)
  const selectScene = useApp((s) => s.selectScene)
  const writer = useApp((s) => s.settings?.models.writer ?? null)

  useEffect(() => {
    let live = true
    setRec(null)
    setError(null)
    setSceneGone(false)
    api
      .getGeneration(generationId)
      .then((r) => {
        if (!live) return
        setRec(r)
        api
          .getScene(r.sceneId)
          .then((s) => live && setSceneTitle(s.title || 'Untitled scene'))
          .catch(() => {
            if (!live) return
            setSceneTitle(null)
            setSceneGone(true)
          })
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [generationId])

  // While the draft is still being written, the reply grows here too. It is
  // re-read from the saved record (saved every half second), so no text is
  // missed between opening the page and the next piece arriving.
  const streaming = rec?.status === 'streaming'
  useEffect(() => {
    if (!streaming) return
    let live = true
    const refresh = (): void => {
      api
        .getGeneration(generationId)
        .then((r) => live && setRec(r))
        .catch(() => undefined)
    }
    const t = setInterval(refresh, 1000)
    const offDone = onEvent('generation:done', (p) => p.generationId === generationId && refresh())
    return () => {
      live = false
      clearInterval(t)
      offDone()
    }
  }, [streaming, generationId])

  const slow = useDelayed(!rec && !error)

  // A variant's record (milestone 4) opened from the Variants page goes back there.
  const toVariants = variantsBackTo(generationId)
  const back = (): void => {
    if (fromHistory) {
      useApp.getState().navigate({ kind: 'history', ...fromHistory })
    } else if (toVariants) {
      selectScene(toVariants)
      useApp.getState().navigate({ kind: 'variants', sceneId: toVariants })
    } else if (rec?.job === 'chat') {
      // An answer in Ask the world (milestone 4) goes back to its chat, beside the page.
      useApp.getState().navigate({ kind: 'write' })
      useApp.getState().setAskOpen(true)
    } else if (rec) selectScene(rec.sceneId)
    else useApp.getState().navigate({ kind: 'write' })
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[880px] px-8 pb-16 pt-6">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={back} className="-ml-2.5 mb-3">
          {fromHistory
            ? 'Back to History'
            : toVariants
              ? 'Back to the variants'
              : rec?.job === 'chat'
                ? 'Back to Ask the world'
                : rec && sceneTitle
                  ? `Back to “${sceneTitle}”`
                  : 'Back to the scene'}
        </Button>

        {error ? (
          <Notice tone="danger">
            Couldn't open this draft's record. {error}
          </Notice>
        ) : !rec ? (
          <div aria-busy className={cn('flex flex-col gap-4 transition-opacity', slow ? 'opacity-100' : 'opacity-0')}>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-[132px] w-full rounded-xl" />
            <Skeleton className="h-[52px] w-full rounded-xl" />
            <Skeleton className="h-[52px] w-full rounded-xl" />
            <Skeleton className="h-[52px] w-full rounded-xl" />
          </div>
        ) : (
          <DraftRecord
            rec={rec}
            sceneTitle={sceneTitle}
            sceneGone={sceneGone}
            modelLabel={writer?.modelId === rec.modelId ? writer.label : null}
          />
        )}
      </div>
    </div>
  )
}

function DraftRecord({
  rec,
  sceneTitle,
  sceneGone,
  modelLabel
}: {
  rec: GenerationRecord
  sceneTitle: string | null
  sceneGone: boolean
  modelLabel: string | null
}): React.JSX.Element {
  const [open, setOpenState] = useState<Set<string>>(() => openParts.get(rec.id) ?? new Set(['scene-card']))
  const setOpen = (next: Set<string> | ((s: Set<string>) => Set<string>)): void =>
    setOpenState((s) => {
      const n = typeof next === 'function' ? next(s) : next
      openParts.set(rec.id, n)
      return n
    })
  const [showMessages, setShowMessages] = useState(false)
  const entries = useMemo(() => new Map(rec.entries.map((e) => [e.entryId, e])), [rec.entries])
  const sentBlocks = rec.blocks.filter((b) => !b.dropped)
  const droppedCount = rec.blocks.length - sentBlocks.length
  // Parts are numbered in the order they were sent; parts left out get a dash.
  const sentNumber = new Map(sentBlocks.map((b, i) => [b.id, i + 1]))
  const allOpen = rec.blocks.every((b) => open.has(b.id))
  const responseWords = countWords(rec.response)
  const changed = rec.entries.filter((e) => e.changedSince && !e.deleted).length
  // An answer in Ask the world (milestone 4) is called one here.
  const answer = rec.job === 'chat'
  // An AI edit of selected words, or Continue (milestone 4), is a change, named for its tool, not a draft.
  const edit = editRecordWords(rec, sceneTitle)

  const toggle = (id: string): void =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="animate-fade-in">
      <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">What the AI saw</h1>
      <p className="mt-1 text-[13px] text-muted">
        {answer ? (
          <>The exact briefing for this answer in Ask the world, asked {fullDate(rec.createdAt)}.</>
        ) : (
          <>
            {edit?.intro ?? `The exact briefing for this draft${sceneTitle ? ` of “${sceneTitle}”` : ''}${partWords(rec.params)}`}, written{' '}
            {fullDate(rec.createdAt)}.
          </>
        )}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {rec.status === 'streaming' ? (
          <Notice tone="ai">
            {edit?.streaming ?? `This ${answer ? 'answer' : 'draft'} is still being written. Its text appears below as it arrives.`}
          </Notice>
        ) : null}
        {rec.status === 'stopped' ? (
          <Notice>
            {edit?.stopped ??
              (answer
                ? 'This answer was stopped before it finished. The words that arrived are kept in the chat.'
                : rec.params.variant
                  ? 'This variant was stopped before it finished. The text that arrived is kept with it.'
                  : 'This draft was stopped before it finished. The text that arrived is kept in the scene.')}
          </Notice>
        ) : null}
        {rec.status === 'complete' && rec.params.cutOff && answer ? (
          <Notice>
            The answer reached the most the model can write in one go, so it stops part-way. Ask it to go on, or for a shorter answer.
          </Notice>
        ) : null}
        {rec.status === 'complete' && rec.params.cutOff && !answer ? (
          <Notice>
            {edit?.cutOff ?? (
              <>
                The model ran out of room before the end of the scene: it reached its reply limit of {formatNumber(rec.params.max_tokens)} tokens, so the
                draft stops part-way. Try a shorter length, or a writer model that can write more in one go.
              </>
            )}
          </Notice>
        ) : null}
        {rec.status === 'error' ? (
          <Notice tone="danger">
            {rec.error ?? edit?.error ?? `Something went wrong while this ${answer ? 'answer' : 'draft'} was written.`}
          </Notice>
        ) : null}
        {changed ? (
          <Notice tone="ai">
            {changed === 1 ? 'One entry has' : `${changed} entries have`} been edited since{' '}
            {edit?.since ?? `this ${answer ? 'answer' : 'draft'}`}, so the AI saw an older version. They're marked below.
          </Notice>
        ) : null}
      </div>

      <ReplacedText rec={rec} sceneGone={sceneGone} />

      <Card className="mt-4 grid grid-cols-3 gap-x-6 gap-y-4 px-5 py-4">
        {/* How much it was asked to think goes with the model, so the grid keeps its two even rows. */}
        <Meta
          label="Model"
          value={modelLabel || rec.modelId}
          title={rec.modelId}
          note={rec.params.thinking ? `Thinking: ${THINKING_LABELS[rec.params.thinking]}` : undefined}
        />
        <Meta label="Provider" value={rec.providerName} />
        <Meta
          label="Creativity"
          value={rec.params.sampling === false ? 'Set by the model' : creativityOf(rec.params)}
          title={rec.params.sampling === false ? 'This model sets its own creativity, so the preset was not sent' : undefined}
        />
        <Meta
          label="Tokens sent"
          value={rec.promptTokens != null ? formatNumber(rec.promptTokens) : `about ${formatNumber(rec.budget.used)}`}
          note={rec.promptTokens != null ? `Counted by ${rec.providerName}` : "AI Write's estimate"}
        />
        <Meta
          label="Tokens written"
          value={rec.completionTokens != null ? formatNumber(rec.completionTokens) : '—'}
          note={rec.completionTokens != null ? `Counted by ${rec.providerName}` : undefined}
        />
        <Meta
          label="Cost"
          value={
            rec.cost != null
              ? `${rec.costEstimated ? 'about ' : ''}${formatCost(rec.cost)}`
              : rec.status === 'error' && !rec.response
                ? 'Nothing charged'
                : 'Not known'
          }
          title={rec.costEstimated ? 'Estimated: the provider did not report the cost' : undefined}
        />
      </Card>

      <BudgetBar
        used={rec.budget.used}
        available={rec.budget.available}
        contextLength={rec.budget.contextLength}
        reserved={rec.budget.reserved}
        providerCounted={rec.promptTokens != null}
      />

      {rec.direction ? (
        <section className="mt-6">
          <SectionTitle>{edit?.direction ?? (answer ? 'Your question' : 'Your direction for this draft')}</SectionTitle>
          <blockquote className="select-text border-l-2 border-ai/60 pl-3 text-[14px] leading-relaxed text-fg">{rec.direction}</blockquote>
        </section>
      ) : null}

      <section className="mt-7">
        <SectionTitle
          actions={
            <div className="flex items-center gap-4">
              <label className="flex cursor-default items-center gap-2 text-[12px] text-muted">
                <S.Root
                  checked={showMessages}
                  onCheckedChange={setShowMessages}
                  className="relative h-[18px] w-8 shrink-0 rounded-full bg-surface-3 transition-colors duration-150 data-[state=checked]:bg-accent"
                >
                  <S.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-page shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[16px]" />
                </S.Root>
                Show the exact messages sent
              </label>
              {!showMessages ? (
                <button type="button" className="text-[12px] font-medium text-accent hover:underline" onClick={() => setOpen(allOpen ? new Set() : new Set(rec.blocks.map((b) => b.id)))}>
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </button>
              ) : null}
            </div>
          }
        >
          The briefing, in order
        </SectionTitle>
        {!showMessages ? (
          <>
            <p className="mb-3 text-[12.5px] text-muted">
              {sentBlocks.length} {sentBlocks.length === 1 ? 'part' : 'parts'} sent, in the order the AI read them
              {droppedCount ? `; ${droppedCount} left out because the model couldn't read that much` : ''}. Click a part to read it.
            </p>
            <div className="flex flex-col gap-2">
              {rec.blocks.map((b) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  number={sentNumber.get(b.id) ?? null}
                  open={open.has(b.id)}
                  onToggle={() => toggle(b.id)}
                  entries={entries}
                  generationId={rec.id}
                  since={edit?.since}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {rec.messages.map((m, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[12px] font-medium text-muted">
                  <span>
                    {answer
                      ? CHAT_ROLES[m.role]
                      : m.role === 'system'
                        ? 'Instructions message'
                        : m.role === 'user'
                          ? 'Briefing message'
                          : 'Reply'}
                  </span>
                  <span className="tabular-nums text-faint">{formatNumber(countWords(m.content))} words</span>
                </div>
                <pre className="max-h-[560px] select-text overflow-auto whitespace-pre-wrap break-words bg-page px-4 py-3 font-mono text-[12px] leading-[1.6] text-fg">
                  {m.content}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle actions={<span className="text-[12px] tabular-nums text-faint">{responseWords.toLocaleString()} words</span>}>What came back</SectionTitle>
        {rec.response ? (
          <Card className="px-6 py-5">
            <div className="max-w-[68ch] select-text whitespace-pre-wrap font-serif text-[15px] leading-[1.75] text-fg">{rec.response}</div>
          </Card>
        ) : (
          <p className="text-[13px] text-muted">{rec.status === 'streaming' ? 'Waiting for the first words…' : 'No text came back.'}</p>
        )}
      </section>
    </div>
  )
}

/**
 * The scene's text this draft took the place of (Adam chose "Replace it"), kept with its record: to read,
 * copy, or put back in the scene, even long after Ctrl+Z could.
 */
function ReplacedText({ rec, sceneGone }: { rec: GenerationRecord; sceneGone: boolean }): React.JSX.Element | null {
  const selectScene = useApp((s) => s.selectScene)
  const replaced = rec.replacedText
  if (!replaced) return null
  const words = countWords(replaced.text)
  const writing = rec.status === 'streaming'
  const copy = (): void => {
    navigator.clipboard.writeText(replaced.text).then(
      () => toast('Copied the text this draft replaced.'),
      () => toast(`Couldn't copy the text. Select it and press ${modKey()}+C instead.`, { tone: 'danger' })
    )
  }
  const putBack = (): void => {
    requestPutBack({ sceneId: rec.sceneId, doc: replaced.doc, text: replaced.text })
    selectScene(rec.sceneId)
  }
  return (
    <section className="mt-6">
      <SectionTitle
        actions={
          <div className="flex items-center gap-2">
            <span className="mr-1 text-[12px] tabular-nums text-faint">{words.toLocaleString()} words</span>
            <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={copy}>
              Copy
            </Button>
            <Button
              size="sm"
              icon={<Undo2 size={13} />}
              onClick={putBack}
              disabled={writing || sceneGone}
              title={
                sceneGone
                  ? "The scene this draft was written for couldn't be opened, so the text can't be put back in it. Copy it instead."
                  : writing
                    ? 'The draft is still being written. Stop it or let it finish first.'
                    : "Put this text back in the scene, in place of what's there now"
              }
            >
              Put it back
            </Button>
          </div>
        }
      >
        The text this draft replaced
      </SectionTitle>
      <Card className="px-6 py-5">
        <div className="max-h-[260px] max-w-[68ch] select-text overflow-auto whitespace-pre-wrap font-serif text-[15px] leading-[1.75] text-fg">
          {replaced.text}
        </div>
      </Card>
      <p className="mt-2 text-[12px] text-faint">
        Kept when the draft's first words took its place. Put it back replaces what's in the scene now with this text, and {modKey()}+Z undoes that.
      </p>
    </section>
  )
}

function Meta({ label, value, title, note }: { label: string; value: string; title?: string; note?: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 truncate text-[14px] text-fg" title={title ?? value}>
        {value}
      </div>
      {note ? <div className="truncate text-[11.5px] text-faint">{note}</div> : null}
    </div>
  )
}

function BudgetBar({
  used,
  available,
  contextLength,
  reserved,
  providerCounted
}: {
  used: number
  available: number
  contextLength: number
  reserved: number
  /** The provider reported its own count above, which this estimate can differ from. */
  providerCounted: boolean
}): React.JSX.Element {
  const share = budgetShare(used, available)
  const pct = Math.min(100, Math.round(share * 100))
  const tight = share > 0.9
  return (
    <Card className="mt-3 px-5 py-4">
      <div className="flex items-baseline justify-between gap-4 text-[13px]">
        <span className="font-medium text-fg">Briefing size (AI Write's estimate)</span>
        <span className="tabular-nums text-muted">
          {formatNumber(used)} of {formatNumber(available)} tokens{' '}
          <span className={cn('font-medium', tight ? 'text-ai' : 'text-fg')}>({Number.isFinite(share) ? `${Math.round(share * 100)}%` : 'over'})</span>
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={available} aria-valuenow={used} aria-label="Briefing size">
        <div className={cn('h-full rounded-full transition-[width] duration-200', tight ? 'bg-ai' : 'bg-accent')} style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-faint">
        The model can read {formatContext(contextLength)} tokens. {formatNumber(reserved)} are kept for the reply and a little more as a safety margin, which leaves{' '}
        {formatNumber(available)} for the briefing.
        {providerCounted ? ' AI Write counts with a 10% allowance to be safe, so its estimate can differ a little from the count the provider reported above.' : ''}
      </p>
    </Card>
  )
}

/**
 * A part of the briefing as readable text. Entries inside a part start with a
 * "### Name" line for the AI; here that line shows as a small heading instead.
 * "Show the exact messages sent" still shows the raw text.
 */
function BlockText({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/^### (.+)$/m)
  return (
    <div className="select-text whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-fg">
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

function BlockRow({
  block,
  number,
  open,
  onToggle,
  entries,
  generationId,
  since = 'this draft'
}: {
  block: ContextBlock
  /** Its place in the order sent; null when it was left out. */
  number: number | null
  open: boolean
  onToggle: () => void
  entries: Map<ID, Entry>
  generationId: ID
  /** What the record is, after "since": "this draft", or "this change" for an AI edit. */
  since?: string
}): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const linked = block.entryIds.map((id) => entries.get(id)).filter((e): e is Entry => !!e)
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface transition-colors duration-150', block.dropped && 'bg-surface-2/60')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2"
      >
        <ChevronRight size={15} className={cn('shrink-0 text-faint transition-transform duration-150', open && 'rotate-90')} />
        <span
          className={cn(
            'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums',
            block.dropped ? 'bg-surface-3 text-faint' : 'bg-accent-soft text-accent'
          )}
          title={`Priority ${block.priority} of 10${block.priority <= 2 ? ': always sent' : ''}`}
        >
          {number ?? '–'}
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-[13.5px] font-medium', block.dropped ? 'text-faint' : 'text-fg')}>{block.title}</span>
        {block.dropped ? (
          <span className="shrink-0 text-[12px] text-faint">Left out: not enough room</span>
        ) : (
          <span className="shrink-0 text-[12px] tabular-nums text-faint">{formatNumber(block.tokens)} tokens</span>
        )}
      </button>
      {open ? (
        <div className={cn('border-t border-line px-4 pb-4 pt-3', block.dropped && 'opacity-70')}>
          {linked.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12px] text-muted">From your world:</span>
              {linked.map((e) => (
                <EntryChip
                  key={e.entryId}
                  entry={e}
                  since={since}
                  onOpen={() => navigate({ kind: 'entries', entryKind: e.kind, entryId: e.entryId, from: { generationId } })}
                />
              ))}
            </div>
          ) : null}
          <BlockText text={block.text} />
        </div>
      ) : null}
    </div>
  )
}

function EntryChip({ entry, onOpen, since }: { entry: Entry; onOpen: () => void; since: string }): React.JSX.Element {
  const kind = KIND_LABELS[entry.kind]?.one.toLowerCase() ?? 'entry'
  if (entry.deleted) {
    return (
      <span className="inline-flex h-6 items-center rounded-full border border-line px-2 text-[12px] text-faint line-through" title={`Deleted since ${since}`}>
        {entry.name}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title={entry.changedSince ? `Open ${entry.name}. Edited since ${since}: the AI saw an older version.` : `Open ${entry.name}`}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] transition-colors duration-150',
        entry.changedSince ? 'border-ai/40 bg-ai-soft text-fg hover:border-ai' : 'border-line bg-page text-fg hover:border-accent hover:text-accent'
      )}
    >
      {entry.name}
      <span className="text-faint">{kind}</span>
      {entry.changedSince ? <span className="text-[11px] font-medium text-ai">edited since</span> : null}
    </button>
  )
}

/** " (variant 2 of 3)" or " (beat 1 of 4)" for a draft that was one of those (milestone 4), else nothing. */
function partWords(params: GenerationRecord['params']): string {
  const part = params.variant ? { name: 'variant', ...params.variant } : params.beat ? { name: 'beat', ...params.beat } : null
  return part ? ` (${part.name} ${part.index} of ${part.of})` : ''
}
