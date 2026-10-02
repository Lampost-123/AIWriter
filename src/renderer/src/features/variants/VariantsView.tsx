// The Variants page (View 'variants'): two or three drafts of a scene written side by side from one
// briefing, to use the one Adam likes best or take paragraphs from each (picked in any column, in the
// order they are to go in). Nothing goes into the scene until he chooses; then the scene is kept in its
// history first and one Ctrl+Z puts it back.
//
// The page shows the scene's latest set: the one being written (it keeps writing while Adam is on other
// pages), else the last one from the records, until a new one starts. With none yet, it offers to start.
// In a small window the columns keep a readable width and the row scrolls sideways.
import { ArrowLeft, Columns3, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ID } from '@shared/types'
import { CREATIVITY_PRESETS } from '@shared/defaults'
import { Button, EmptyState } from '@/components/ui'
import { isTyping } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { useOutline } from '@/features/binder/outlineStore'
import { formatCost, relativeTime } from '@/features/generate/format'
import { Skeleton, useDelayed, useNow } from '@/features/generate/parts'
import { blocksWords, pickedBlocks, variantBlocks, type VariantBlock } from './merge'
import { StartPanel } from './StartPanel'
import { clearPicks, isWriting, loadVariants, setOf, stopAll, useVariants, type LiveSet } from './store'
import { UseButton } from './UseButton'
import { VariantColumn } from './VariantColumn'

/** Something else (a menu, a dialog, a popover) is open and should get Esc first. */
const layerOpen = (): boolean => !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')

export function VariantsView({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const entry = useVariants((s) => s.scenes[sceneId])
  const { outline } = useOutline()
  const sceneTitle = outline?.scenes.find((s) => s.id === sceneId)?.title.trim() || null
  const memoryReading = useApp((s) => !!s.memoryStatus?.reading)
  /** Adam asked for new variants while the last set shows: the start panel takes its place. */
  const [composing, setComposing] = useState(false)
  const [focus, setFocus] = useState<'direction' | 'length'>('direction')

  /**
   * A set was just asked for: the start panel stays a moment longer (its button turning), so a start
   * turned down at once (a model that can't write that much, say) never flashes the columns, and its
   * problem shows under the button just pressed. `hadSet`: a set showed before, so the panel stays as it was.
   */
  const [asking, setAsking] = useState<{ hadSet: boolean } | null>(null)
  useEffect(() => {
    if (!asking) return
    const t = setTimeout(() => setAsking(null), 300)
    return () => clearTimeout(t)
  }, [asking])

  useEffect(() => void loadVariants(sceneId), [sceneId])

  const set = entry?.kind === 'set' ? entry.set : null
  const writing = isWriting(set)
  const holding = !!asking && !!set?.starting
  const showStart = entry?.kind === 'none' || (!!set && composing && !writing) || holding
  const loading = !entry || entry.kind === 'loading'
  const slow = useDelayed(loading, 300)

  // Esc stops the variants being written (as it stops a draft), unless something else wants it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const v = useApp.getState().view
      if (v.kind !== 'variants' || v.sceneId !== sceneId) return
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || layerOpen() || isTyping(e.target)) return
      if (!isWriting(setOf(useVariants.getState(), sceneId))) return
      e.preventDefault()
      stopAll(sceneId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sceneId])

  const back = (): void => useApp.getState().navigate({ kind: 'write' })
  const changeLength = (): void => {
    setFocus('length')
    setComposing(true)
  }

  const status = set?.starting ? (memoryReading ? 'Updating memory…' : 'Getting ready…') : set?.stopping ? 'Stopping…' : 'Writing…'

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/70 bg-page pl-2 pr-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={back} title="Back to the scene. The variants stay here.">
          Back
        </Button>
        <h1 className="min-w-0 truncate text-[14px] font-semibold text-fg">
          Variants
          {sceneTitle ? <span className="font-normal text-faint"> of “{sceneTitle}”</span> : null}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {writing && !holding ? (
            <>
              <span
                role="status"
                title={
                  set?.starting && memoryReading
                    ? 'Bringing the memory up to date with earlier scenes first, so the variants know what happened in them.'
                    : undefined
                }
                className="flex items-center gap-2 whitespace-nowrap text-[12.5px] font-medium text-ai"
              >
                <span className="h-2 w-2 rounded-full bg-ai animate-pulse" aria-hidden />
                {status}
              </span>
              <Button
                size="sm"
                icon={<Square size={10} fill="currentColor" />}
                onClick={() => stopAll(sceneId)}
                disabled={set?.stopping}
                title="Stop all the variants (Esc). What they have written so far is kept."
              >
                Stop all
              </Button>
            </>
          ) : set && !showStart ? (
            <Button
              size="sm"
              icon={<Sparkles size={13} />}
              onClick={() => {
                setFocus('direction')
                setComposing(true)
              }}
              title="Write a new set of variants of this scene. These stay until the new ones start."
            >
              New variants
            </Button>
          ) : null}
        </div>
      </header>

      {entry?.kind === 'failed' ? (
        <div className="flex min-h-0 flex-1 items-start justify-center pt-[14vh]">
          <EmptyState
            icon={<Columns3 size={20} />}
            title="The variants couldn't be shown"
            actions={
              <Button icon={<RotateCcw size={14} />} onClick={() => void loadVariants(sceneId, true)}>
                Try again
              </Button>
            }
          >
            {entry.error}
          </EmptyState>
        </div>
      ) : loading ? (
        <div aria-busy className={slow ? 'grid min-h-0 flex-1 grid-cols-3 gap-3 p-3 animate-fade-in' : 'min-h-0 flex-1'}>
          {slow ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-full rounded-xl" />) : null}
        </div>
      ) : showStart ? (
        <div className="min-h-0 flex-1">
          <StartPanel
            key={focus}
            sceneId={sceneId}
            sceneTitle={sceneTitle}
            hasSet={holding && asking ? asking.hadSet : !!set}
            focus={focus}
            onCancel={() => setComposing(false)}
            onAsking={() => setAsking({ hadSet: !!set })}
            onStarted={(result) => {
              setAsking(null)
              if (result === 'started') {
                setComposing(false)
                setFocus('direction')
              } else setComposing(true)
            }}
          />
        </div>
      ) : set ? (
        <SetView set={set} memoryReading={memoryReading} onChangeLength={changeLength} />
      ) : null}
    </div>
  )
}

/** A set's columns, what it was written with, and the picked paragraphs. */
function SetView({
  set,
  memoryReading,
  onChangeLength
}: {
  set: LiveSet
  memoryReading: boolean
  onChangeLength: () => void
}): React.JSX.Element {
  const { sceneId, variants, picks } = set
  const now = useNow()
  const writing = isWriting(set)
  // Each variant's blocks, for the picked paragraphs (the columns work out their own as they draw).
  const blocks = useMemo(() => new Map(variants.map((v) => [v.generationId, variantBlocks(v.text)])), [variants])
  const picked = useMemo(() => pickedBlocks(picks, (id) => blocks.get(id)), [picks, blocks])
  const pickedWords = blocksWords(picked)
  /** Some variant has a paragraph to pick (none has when they all failed or were stopped at once). */
  const anyParagraph = useMemo(() => [...blocks.values()].some((bs) => bs.some((b) => b.kind === 'paragraph')), [blocks])

  const known = variants.filter((v) => v.cost != null)
  const cost = known.length
    ? `${known.some((v) => v.costEstimated) ? 'about ' : ''}${formatCost(known.reduce((n, v) => n + (v.cost ?? 0), 0))}`
    : null
  const meta = [
    writing ? 'Being written now' : `${anyParagraph ? 'Written' : 'Tried'} ${relativeTime(set.createdAt, now)}`,
    set.creativity && set.creativity in CREATIVITY_PRESETS ? `Creativity: ${CREATIVITY_PRESETS[set.creativity].label}` : null,
    set.targetWords ? `About ${set.targetWords.toLocaleString()} words each` : null,
    set.direction ? `Direction: “${set.direction}”` : null
  ].filter(Boolean)

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-3 px-4 text-[12px] text-faint">
        <span className="min-w-0 truncate" title={set.direction ? `Direction: “${set.direction}”` : undefined}>
          {meta.join(' · ')}
        </span>
        {cost ? (
          <span
            className="ml-auto shrink-0 tabular-nums"
            title={known.some((v) => v.costEstimated) ? "Partly AI Write's estimate: the provider didn't say" : 'What the provider charged'}
          >
            Cost: {cost}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div
          className="grid h-full gap-3 px-3 pb-3"
          style={{ gridTemplateColumns: `repeat(${variants.length}, minmax(300px, 560px))`, justifyContent: 'safe center' }}
        >
          {variants.map((v) => (
            <VariantColumn
              key={v.index}
              sceneId={sceneId}
              variant={v}
              starting={set.starting}
              memoryReading={memoryReading}
              picks={picks}
              onChangeLength={onChangeLength}
            />
          ))}
        </div>
      </div>
      {/* The button comes first: it never moves as paragraphs are picked, and the app's messages (in
          the bottom right corner) never cover it. */}
      <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-line/70 bg-page pl-3 pr-5">
        <UseButton
          sceneId={sceneId}
          variant="primary"
          align="start"
          className="shrink-0"
          blocks={(): VariantBlock[] => picked}
          what="The picked paragraphs"
          plural
          disabled={!picks.length}
          onUsed={() => clearPicks(sceneId)}
          title={picks.length ? 'Put the picked paragraphs into the scene, in the order they are numbered' : 'Pick paragraphs first'}
        >
          Use the picked paragraphs
        </UseButton>
        {picks.length ? (
          <>
            <span className="whitespace-nowrap text-[13px] text-fg" role="status">
              <span className="font-semibold tabular-nums">{picks.length}</span> {picks.length === 1 ? 'paragraph' : 'paragraphs'} picked
              <span className="ml-2 tabular-nums text-faint">{pickedWords.toLocaleString()} words</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => clearPicks(sceneId)} title="Unpick them all">
              Clear
            </Button>
          </>
        ) : (
          <span className="line-clamp-2 min-w-0 text-[12.5px] leading-snug text-faint">
            {anyParagraph || writing
              ? 'Click paragraphs in any variant to pick them, in the order they should go in.'
              : 'These variants have no paragraphs to pick from.'}
          </span>
        )}
      </footer>
    </>
  )
}
