// One variant on the Variants page: its text as it will go into the page, written in as it arrives,
// with its own Stop, "What the AI saw" and "Use this one". Each of its paragraphs can be picked with a
// click (or Enter or Space; the arrow keys move between them): picked ones are tinted and numbered in
// the order they will go into the scene.
//
// The column never scrolls by itself while Adam reads: new words go on at the end, and a small pointer
// says when they are out of sight below. Once he scrolls to the end, it follows the words as they come.
import { ArrowDown, FileSearch, Plus, Square } from '@/components/ui/icons'
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { FollowScroll } from '@/features/editor/followScroll'
import type { MarkedPiece } from '@/features/editor/streamText'
import { openVariantRecord } from './back'
import { costLabel, costWords } from './cost'
import { fixesFor } from './fixes'
import { blocksWords, pickNumber, variantBlocks, type Pick } from './merge'
import { pickParagraph, stopVariant, type LiveVariant } from './store'
import { UseButton } from './UseButton'

/** "1st", "2nd", "3rd", "4th"... */
const ordinal = (n: number): string => {
  const tens = n % 100
  const s = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${s}`
}

const samePieces = (a: MarkedPiece[], b: MarkedPiece[]): boolean =>
  a.length === b.length && a.every((p, i) => p.text === b[i].text && !!p.italic === !!b[i].italic && !!p.bold === !!b[i].bold)

interface ParaProps {
  pieces: MarkedPiece[]
  block: number
  /** Where it comes in the picked text, from 1; 0 when not picked. */
  number: number
  /** Complete, so it can be picked (the paragraph still being written can't, yet). */
  pickable: boolean
  /** Has the column's place in the Tab order. */
  tabStop: boolean
  onToggle: (block: number) => void
  onKey: (e: React.KeyboardEvent<HTMLDivElement>, block: number) => void
}

/** A paragraph of a variant. Only the one being written changes as words arrive, so only it is drawn again. */
const Para = memo(
  function Para({ pieces, block, number, pickable, tabStop, onToggle, onKey }: ParaProps): React.JSX.Element {
    const picked = number > 0
    return (
      <div
        data-block={block}
        role={pickable ? 'checkbox' : undefined}
        aria-checked={pickable ? picked : undefined}
        tabIndex={pickable ? (tabStop ? 0 : -1) : undefined}
        title={
          pickable ? (picked ? `Picked: it goes ${ordinal(number)}. Click to leave it out.` : 'Click to pick this paragraph') : undefined
        }
        onClick={pickable ? () => onToggle(block) : undefined}
        onKeyDown={pickable ? (e) => onKey(e, block) : undefined}
        className={cn(
          'group relative -mx-2 mb-[0.85em] rounded-md px-2 py-px outline-none transition-colors duration-150',
          pickable && 'focus-visible:ring-2 focus-visible:ring-accent/40',
          // Tinted, with a stripe down its side, so a picked paragraph stands out in every theme.
          picked ? 'bg-accent-soft shadow-[inset_3px_0_0_0_var(--accent)]' : pickable && 'hover:bg-surface-2'
        )}
      >
        {pickable ? (
          <span
            aria-hidden
            className={cn(
              'absolute -left-6 top-[0.35em] flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-sans text-[11px] font-semibold tabular-nums leading-none transition-[opacity,background-color,color] duration-150',
              picked
                ? 'bg-accent text-accent-fg'
                : 'border border-line-strong text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
            )}
          >
            {picked ? number : <Plus size={11} strokeWidth={2.5} />}
          </span>
        ) : null}
        {picked ? <span className="sr-only">Picked, number {number}. </span> : null}
        {pieces.map((p, i) => {
          const text = p.bold ? <strong>{p.text}</strong> : p.text
          return p.italic ? <em key={i}>{text}</em> : <span key={i}>{text}</span>
        })}
      </div>
    )
  },
  (a, b) =>
    a.block === b.block &&
    a.number === b.number &&
    a.pickable === b.pickable &&
    a.tabStop === b.tabStop &&
    a.onToggle === b.onToggle &&
    a.onKey === b.onKey &&
    samePieces(a.pieces, b.pieces)
)

export function VariantColumn({
  sceneId,
  variant,
  starting,
  memoryReading,
  picks,
  onChangeLength
}: {
  sceneId: ID
  variant: LiveVariant
  /** The set is getting ready (the memory catching up, the briefing being made). */
  starting: boolean
  memoryReading: boolean
  picks: Pick[]
  /** Opens the draft options at the length (a problem the model had with the length asked for). */
  onChangeLength: () => void
}): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const { generationId, index, status, text } = variant
  const writing = status === 'streaming'
  const blocks = useMemo(() => variantBlocks(text), [text])
  const words = useMemo(() => blocksWords(blocks), [blocks])
  const lastBlock = blocks.length - 1

  // ---------- Picking, by mouse or keyboard ----------

  const [tabStop, setTabStop] = useState<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pickable = (i: number): boolean => blocks[i]?.kind === 'paragraph' && (!writing || i < lastBlock)
  const firstPickable = blocks.findIndex((_, i) => pickable(i))
  const stop = tabStop != null && pickable(tabStop) ? tabStop : firstPickable

  const toggle = useCallback(
    (block: number) => {
      if (!generationId) return
      setTabStop(block)
      pickParagraph(sceneId, { generationId, block })
    },
    [sceneId, generationId]
  )

  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>, block: number) => {
    const all = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[role="checkbox"][data-block]') ?? [])]
    const at = all.findIndex((el) => Number(el.dataset.block) === block)
    let next: HTMLElement | undefined
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.currentTarget.click()
      return
    }
    if (e.key === 'ArrowDown') next = all[at + 1]
    else if (e.key === 'ArrowUp') next = all[at - 1]
    else if (e.key === 'Home') next = all[0]
    else if (e.key === 'End') next = all[all.length - 1]
    else return
    e.preventDefault()
    if (!next) return
    setTabStop(Number(next.dataset.block))
    next.focus()
  }, [])

  // ---------- Following the words as they come, only once Adam has gone to the end ----------

  const scrollRef = useRef<HTMLDivElement>(null)
  const [follow] = useState(() => new FollowScroll(() => scrollRef.current))
  const stick = useRef(false)
  const lastTop = useRef(0)
  const [below, setBelow] = useState(false)

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setBelow(writing && !stick.current && el.scrollHeight - el.scrollTop - el.clientHeight > 40)
  }, [writing])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop
    // Scrolling up stops following; reaching the end starts it.
    if (top < lastTop.current - 2) stick.current = false
    else if (el.scrollHeight - top - el.clientHeight <= 24) stick.current = true
    lastTop.current = top
    follow.onScroll()
    measure()
  }

  useLayoutEffect(() => {
    if (writing && stick.current) {
      follow.check()
      follow.nudge()
    }
    measure()
  }, [text, writing, follow, measure])

  useLayoutEffect(() => {
    if (!writing) follow.settle()
  }, [writing, follow])

  useLayoutEffect(() => () => follow.stop(), [follow])

  const toEnd = (): void => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    el.scrollTop = el.scrollHeight
    lastTop.current = el.scrollTop
    setBelow(false)
  }

  // ---------- What it says about itself ----------

  const error = status === 'error' ? variant.error : null
  const status_ = starting
    ? memoryReading
      ? 'Updating memory…'
      : 'Getting ready…'
    : variant.stopping
      ? 'Stopping…'
      : variant.retrying
        ? 'Retrying…'
        : 'Writing…'
  const cost = variant.cost != null ? costLabel(variant.cost, variant.costEstimated) : null
  // The cost goes in the header when there's room for it (a finished variant); otherwise it's said on hover.
  const endTitle =
    status === 'complete' && !variant.cutOff
      ? variant.costEstimated
        ? "AI Write's estimate: the provider didn't say"
        : undefined
      : variant.cost != null
        ? `Cost: ${costWords(variant.cost, variant.costEstimated)}`
        : undefined
  // The ways to fix it that its words name: the length first (as Generate offers it), then Settings.
  const fixes = error ? fixesFor(error) : []

  return (
    <section
      aria-label={`Variant ${index}`}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-page shadow-soft"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line/70 pl-4 pr-2">
        <h2 className="shrink-0 text-[13px] font-semibold text-fg">Variant {index}</h2>
        <span className="min-w-0 truncate text-[12px] tabular-nums text-faint">{text ? `${words.toLocaleString()} words` : ''}</span>
        <div className="ml-auto flex h-7 shrink-0 items-center gap-1.5">
          {writing || starting ? (
            <>
              <span
                role="status"
                title={variant.retrying ?? undefined}
                className="flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium text-ai"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-ai animate-pulse" aria-hidden />
                {status_}
              </span>
              {!starting ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[12px]"
                  icon={<Square size={9} fill="currentColor" />}
                  disabled={variant.stopping}
                  onClick={() => stopVariant(sceneId, generationId)}
                  title="Stop this variant. What it has written so far is kept."
                >
                  Stop
                </Button>
              ) : null}
            </>
          ) : (
            <span className="whitespace-nowrap pr-2 text-[12px] tabular-nums text-faint" title={endTitle}>
              {status === 'stopped' ? 'Stopped' : status === 'error' ? 'Not finished' : variant.cutOff ? 'Cut short' : (cost ?? '')}
            </span>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
          <div ref={bodyRef} className="py-4 pl-9 pr-5 font-serif text-[15px] leading-[1.75] text-fg">
            {!text && (writing || starting) ? <p className="font-sans text-[13px] text-faint">Waiting for the first words…</p> : null}
            {blocks.map((b, i) =>
              b.kind === 'break' ? (
                <div
                  key={i}
                  aria-label="Scene break"
                  role="separator"
                  className="my-[1.2em] text-center text-[0.9em] tracking-[0.2em] text-faint"
                >
                  *&nbsp;&nbsp;*&nbsp;&nbsp;*
                </div>
              ) : (
                <Para
                  key={i}
                  pieces={b.pieces}
                  block={i}
                  number={generationId ? pickNumber(picks, { generationId, block: i }) : 0}
                  pickable={!!generationId && pickable(i)}
                  tabStop={i === stop}
                  onToggle={toggle}
                  onKey={onKey}
                />
              )
            )}
            <div className="flex flex-col gap-2 font-sans">
              {error ? (
                // The way to fix it goes under the words, so they keep the column's width.
                <Notice tone="danger">
                  <p>{error}</p>
                  {fixes.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {fixes.map((f) =>
                        f === 'length' ? (
                          <Button key={f} size="sm" onClick={onChangeLength}>
                            Change the length
                          </Button>
                        ) : (
                          <Button key={f} size="sm" onClick={() => navigate({ kind: 'settings', tab: 'models' })}>
                            Open Settings
                          </Button>
                        )
                      )}
                    </div>
                  ) : null}
                </Notice>
              ) : null}
              {status === 'complete' && variant.cutOff ? (
                <Notice>
                  The model ran out of room before the end of the scene, so this variant stops part-way. Try a shorter length, or a writer
                  model that can write more in one go.
                </Notice>
              ) : null}
              {status === 'stopped' && text ? (
                <p className="text-[12px] text-faint">Stopped before the end. What it wrote is kept here.</p>
              ) : null}
              {!text && (status === 'stopped' || (status === 'complete' && !variant.cutOff)) ? (
                <p className="text-[13px] text-faint">{status === 'stopped' ? 'Stopped before any words came.' : 'No text came back.'}</p>
              ) : null}
            </div>
          </div>
        </div>
        {below ? (
          // Over the text, so nothing moves: the new words are below.
          <button
            type="button"
            onClick={toEnd}
            title="Go to the end, and follow the words as they come"
            className="absolute bottom-3 right-4 flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-ai/40 bg-ai-soft px-2.5 text-[12px] font-medium text-ai shadow-pop transition-colors duration-150 hover:border-ai animate-fade-in"
          >
            Writing below
            <ArrowDown size={12} aria-hidden />
          </button>
        ) : null}
      </div>

      <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-line/70 pl-2 pr-3">
        <Button
          variant="ghost"
          size="sm"
          icon={<FileSearch size={13} />}
          disabled={!generationId}
          onClick={() => openVariantRecord(sceneId, generationId)}
          title="The exact briefing this variant was written from, and what it cost"
        >
          What the AI saw
        </Button>
        <UseButton
          sceneId={sceneId}
          variant="secondary"
          size="sm"
          className="ml-auto"
          blocks={() => blocks}
          what={`Variant ${index}`}
          generationId={generationId}
          disabled={writing || starting || words === 0}
          title={
            writing || starting
              ? 'Still being written. Stop it, or wait for it to finish.'
              : words === 0
                ? 'This variant has no text to use.'
                : 'Put this variant into the scene'
          }
        >
          Use this one
        </UseButton>
      </footer>
    </section>
  )
}
