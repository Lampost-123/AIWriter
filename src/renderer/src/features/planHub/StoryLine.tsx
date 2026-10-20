// The story line (Build with AI's third section, 2026-10-20; the Plan hub's before): the story from start to end in a few
// rows, the AI's suggestions in their place. What is written is folded away ("✓ Act 1 · Ch 1 to Ch 3 · written", Open),
// the chapter being written lists its scenes so far, then YOU ARE HERE and the newest suggestions for what comes next;
// then the chapters planned but not written, one row each (2026-10-20: no row around them to open), and acts that have
// no chapters yet (Plan its chapters). Quiet since "Option A: Zoom in" (Adam, 2026-10-20):
// each chapter shows its name, how it stands and ONE next step (Plan it, Write it or Open), and a click on its name or
// that step opens the chapter's own page (ZoomPages.tsx), where its plan, its scenes' tools and Write this chapter are.
// A scene shows its name only; a click opens the scene's own page. A planned scene the story has moved on from says so
// under it; Show me lights it up. Rows come from hubLogic.ts storyLine; suggestions are drawn by LineSuggestions.tsx.

import { useEffect, useMemo } from 'react'
import type { HubDrift } from '@shared/contracts/planHub'
import type { Chapter, ID, Outline } from '@shared/types'
import { Check, ChevronRight, NotebookText, PenLine, Sparkles } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp, type View } from '@/lib/store'
import { reducedMotion, tokenMs } from '@/features/look/motion'
import { useChapterWriter } from '@/features/chapterWriter/chapterWriterStore'
import { runBusy, treeOf, type HelperRun, type HelperSession } from '@/features/outline/helperStore'
import { countNodes, totalOf, type TreeNode } from '@/features/outline/tree'
import { chapterName, rowForPlace, sceneName, shownTitle, type HubMode, type LineChapter, type LineRow, type LineScene } from './hubLogic'
import { writeStep } from './buildLogic'
import { planChaptersIn, toggleChapter, toggleRow, type HubState } from './hubStore'
import { BatchHead, LineSuggestions, shownNodes, WaitingRows } from './LineSuggestions'
import { Fold } from '@/components/ui'
import { CHAPTER_STEP_WORDS, chapterStep, chapterView, sceneView } from './zoomLogic'

/** How long scenes stay lit after Show me. */
export const LIT_MS = 6000

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

export interface StoryLineProps {
  storyId: ID
  outline: Outline
  rows: LineRow[]
  mode: HubMode
  hub: HubState
  session: HelperSession
  run: HelperRun | null
  tree: TreeNode[]
  labels: Map<string, string>
  drift: HubDrift[]
  /** Scenes whose cards are empty, by chapter (PlanHubFacts.emptyCards). */
  emptyCards: Record<ID, ID[]>
  starter: Chapter | null
  back: { view: View; label: string }
  /** The page Build with AI was opened from (its Back link), kept when a chapter or scene opens as its own page. */
  outerBack?: { view: View; label: string }
}

/** Ids of what the newest batch kept: while it still has suggestions to decide, they show there, not again in the rows. */
function keptIn(run: HelperRun | null, tree: TreeNode[]): Set<ID> {
  const out = new Set<ID>()
  if (!run || run.fill) return out
  const walk = (nodes: TreeNode[]): void =>
    nodes.forEach((n) => {
      const d = run.decisions[n.key]
      if (d?.status === 'kept') out.add(d.id)
      walk(n.children)
    })
  walk(shownNodes(run, tree))
  return out
}

type Back = { view: View; label: string } | undefined

/** A chapter's name on the line: a click opens the chapter's own page. */
function ChapterLink({ storyId, chapter, back, label }: { storyId: ID; chapter: LineChapter; back: Back; label?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      className="hub-kid-name hub-zoom-link"
      onClick={() => useApp.getState().navigate(chapterView(storyId, chapter.id, { back }))}
      data-chapter-zoom={chapter.id}
      title="This chapter’s own page: its plan, its scenes and Write this chapter"
    >
      {label ?? chapterName(chapter)}
    </button>
  )
}

/**
 * A chapter's one next step: Plan it (no scenes, or a card that says nothing), Write it (every card says something, no
 * words yet), Open (it has words); while the AI writes it, how that goes. Each opens the chapter's own page, at its plan
 * or with Write this chapter open.
 */
function ChapterStepButton({ storyId, chapter, empty, back }: { storyId: ID; chapter: LineChapter; empty: number; back: Back }): React.JSX.Element {
  const progress = useChapterWriter((s) => (s.progress?.chapterId === chapter.id ? s.progress : null))
  const step = progress ? 'write' : chapterStep(chapter, empty)
  const name = chapterName(chapter)
  const title = progress
    ? 'The AI is writing this chapter: see how it is going'
    : step === 'plan'
      ? `Plan ${name} with AI: an interview, its scenes, its empty cards`
      : step === 'write'
        ? `Write ${name} with AI: its plan first, for you to read, then every scene`
        : `${name}’s own page: add scenes, fill in cards, build its scenes with AI`
  return (
    <button
      type="button"
      className={cn('hub-row-btn', step === 'write' && 'is-strong', progress && 'is-busy')}
      onClick={() => useApp.getState().navigate(chapterView(storyId, chapter.id, { open: step === 'open' ? undefined : step, back }))}
      data-chapter-step={step}
      data-step-for={chapter.id}
      title={title}
    >
      {step === 'plan' ? <Sparkles size={12} aria-hidden /> : step === 'write' ? <PenLine size={12} aria-hidden /> : <NotebookText size={12} aria-hidden />}
      {progress ? `Writing · ${writeStep(progress.stage).words.replace(/^step /, '')}` : CHAPTER_STEP_WORDS[step]}
    </button>
  )
}

/** A scene on the line: its name, and how it stands; a click opens the scene's own page. */
function SceneLink({
  storyId,
  scene,
  chapterNo,
  lit,
  back,
  note
}: {
  storyId: ID
  scene: LineScene
  chapterNo: number
  lit: boolean
  back: Back
  note?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('hub-scene build-scene', lit && 'is-lit')} data-scene-row={scene.id} role="group" aria-label={`Ch ${chapterNo} · ${sceneName(scene)}`}>
      <div className="build-scene-row">
        <button
          type="button"
          className="hub-scene-link build-scene-name"
          onClick={() => useApp.getState().navigate(sceneView(storyId, scene.id, { back }))}
          data-scene-zoom={scene.id}
          title="This scene’s own page: its card, ideas, interview and draft"
        >
          {sceneName(scene)}
        </button>
        <span className="hub-row-state">{scene.words > 0 ? 'written' : 'planned'}</span>
      </div>
      {note}
    </div>
  )
}

export function StoryLine(p: StoryLineProps): React.JSX.Element {
  const { storyId, rows, run, tree, hub, emptyCards } = p
  const busy = runBusy(run)
  // A batch with everything decided folds to its head: what it kept is in the rows, where it now is in the story.
  const nodes = run ? shownNodes(run, tree) : []
  const settled = !!run && !busy && nodes.length > 0 && totalOf(countNodes(nodes, run.decisions, 'open')) === 0
  const placed = run ? rowForPlace(rows, run.place) : null
  const kept = useMemo(() => (settled ? new Set<ID>() : keptIn(run, tree)), [run, tree, settled])
  const driftBy = useMemo(() => new Map(p.drift.map((d) => [d.sceneId, d])), [p.drift])
  const lit = hub.lit && Date.now() - hub.lit.at < LIT_MS ? new Set(hub.lit.ids) : null
  const emptyIn = (chapterId: ID): ID[] => emptyCards[chapterId] ?? []
  const back = p.outerBack

  // Show me: the first lit scene comes into view once its row has opened (after the fold has grown, 220 ms, so the
  // page scrolls to where the row ends up, not where it starts).
  const litAt = hub.lit?.at ?? 0
  useEffect(() => {
    if (!litAt || Date.now() - litAt > 1000) return
    const id = hub.lit?.ids[0]
    if (!id) return
    const grow = tokenMs(document.documentElement, '--dur-base')
    const t = window.setTimeout(
      () => document.querySelector(`[data-scene-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }),
      grow
    )
    return () => window.clearTimeout(t)
  }, [litAt, hub.lit?.ids])

  const batch = run ? (
    <li className="hub-line-batch" data-batch={run.place?.at ?? 'end'} data-settled={settled || undefined} key="batch">
      <BatchHead storyId={storyId} session={p.session} run={run} tree={tree} starter={p.starter} backLabel={p.back} outline={p.outline} />
      {settled ? null : nodes.length ? (
        <div role="region" aria-label="Suggestions">
          <LineSuggestions storyId={storyId} run={run} tree={tree} labels={p.labels} />
        </div>
      ) : busy ? (
        <WaitingRows />
      ) : null}
    </li>
  ) : null

  const scenesLine = (scenes: LineScene[], written: boolean): React.JSX.Element => (
    <span className="hub-row-scenes">
      {scenes.map((s, i) => (
        <span key={s.id}>
          {i ? <span className="hub-dot"> · </span> : null}
          <button
            type="button"
            className={cn('hub-scene-link', lit?.has(s.id) && 'is-lit')}
            data-scene-row={s.id}
            data-scene-zoom={s.id}
            onClick={() => useApp.getState().navigate(sceneView(storyId, s.id, { back }))}
            title={written ? 'This scene’s own page: its card, ideas and draft' : 'This scene’s own page: its card, ideas, interview and draft'}
          >
            {sceneName(s)}
          </button>
        </span>
      ))}
    </span>
  )

  const items: React.JSX.Element[] = []
  for (const row of rows) {
    const isOpen = hub.open.includes(row.key) || placed?.rowKey === row.key
    if (row.kind === 'written-act' || row.kind === 'written-chapters') {
      items.push(
        <li key={row.key} className="hub-row is-written" data-row={row.kind}>
          <span className="hub-row-mark is-done" aria-hidden>
            <Check size={13} />
          </span>
          <span className="hub-row-words">
            {row.kind === 'written-act' ? `Act ${row.actNo} · ` : ''}
            {row.range} · written
          </span>
          <button
            type="button"
            className="hub-row-btn"
            aria-expanded={isOpen}
            onClick={() => toggleRow(storyId, row.key)}
            title={isOpen ? undefined : 'Open it chapter by chapter'}
          >
            {isOpen ? 'Fold away' : 'Open'}
          </button>
        </li>
      )
      items.push(
        <Fold as="li" key={`${row.key}:in`} open={isOpen} className="hub-row-kids" data="data-written-chapters">
          {row.chapters.map((c) => (
            <div key={c.id} className="hub-chap" data-chapter={c.id}>
              <WrittenChapter storyId={storyId} chapter={c} back={back} actions={<ChapterStepButton storyId={storyId} chapter={c} empty={emptyIn(c.id).length} back={back} />} />
              {placed?.chapterId === c.id && batch ? <div className="hub-chap-batch">{batch}</div> : null}
            </div>
          ))}
        </Fold>
      )
      continue
    }
    if (row.kind === 'current') {
      const empty = emptyIn(row.chapter.id)
      items.push(
        <li key={row.key} className="hub-row is-current" data-row="current" data-chapter={row.chapter.id}>
          <span className="hub-row-mark is-done" aria-hidden>
            <Check size={13} />
          </span>
          <span className="hub-row-words">
            <span className="hub-row-ch">
              <ChapterLink storyId={storyId} chapter={row.chapter} back={back} label={`Ch ${row.chapter.no}`} />
            </span>
            <span className="hub-dot"> · </span>
            {scenesLine(row.scenes, true)}
          </span>
          <span className="hub-kid-actions">
            <ChapterStepButton storyId={storyId} chapter={row.chapter} empty={empty.length} back={back} />
          </span>
        </li>
      )
      // A batch for this chapter with nothing planned past the marker (its empty cards filled in) goes under it.
      if (placed?.rowKey === row.key && batch) items.push(batch)
      continue
    }
    if (row.kind === 'here') {
      items.push(
        <li key="here" aria-current="step" className="hub-here" data-row="here">
          <span aria-hidden />
          <span className="hub-here-t">YOU ARE HERE</span>
          <span aria-hidden />
        </li>
      )
      if (placed?.rowKey === 'here' && batch) items.push(batch)
      continue
    }
    if (row.kind === 'planned-scenes') {
      const scenes = row.scenes.filter((s) => !kept.has(s.id))
      if (scenes.length) {
        items.push(
          <li key={row.key} className="hub-row is-planned is-stack" data-row="planned-scenes">
            <div className="hub-row-line">
              <span className="hub-row-mark is-planned" aria-hidden />
              <span className="hub-row-words">
                <span className="hub-row-ch">Ch {row.chapter.no}</span>
                <span className="hub-dot"> · </span>
                {scenes.length === 1 ? 'the next scene, planned' : `the next ${scenes.length} scenes, planned`}
              </span>
              <span className="hub-row-state">planned</span>
            </div>
            <div className="hub-kid-scenes is-flush">
              {scenes.map((s) => (
                <SceneLink
                  key={s.id}
                  storyId={storyId}
                  scene={s}
                  chapterNo={row.chapter.no}
                  lit={!!lit?.has(s.id)}
                  back={back}
                  note={driftBy.has(s.id) ? <DriftNote drift={driftBy.get(s.id)!} lit={!!lit?.has(s.id)} inline /> : null}
                />
              ))}
            </div>
          </li>
        )
      }
      // The rest of the chapter, planned past what is written, comes after its planned scenes.
      if (placed?.rowKey === row.key && batch) items.push(batch)
      continue
    }
    if (row.kind === 'planned') {
      // The planned chapters straight in the line, one row each with its one next step (no row around them to open).
      const chapters = row.chapters.filter((c) => !kept.has(c.id))
      if (!chapters.length) continue
      items.push(
        <li key={`${row.key}:in`} className="hub-row-kids is-flat" data-planned-chapters>
          {chapters.map((c, i) => (
            <PlannedChapter
              key={c.id}
              {...p}
              chapter={c}
              actHead={c.actId && c.actId !== chapters[i - 1]?.actId ? c : null}
              open={hub.openChapters.includes(c.id) || p.drift.some((d) => d.chapterId === c.id && lit?.has(d.sceneId))}
              batch={placed?.chapterId === c.id ? batch : null}
              driftBy={driftBy}
              lit={lit}
              kept={kept}
              empty={emptyIn(c.id)}
            />
          ))}
        </li>
      )
      continue
    }
    // Acts with no chapters yet.
    const first = row.acts[0]
    items.push(
      <li key={row.key} className="hub-row is-planned is-dashed is-faint" data-row="acts-only">
        <span className="hub-row-mark is-planned" aria-hidden />
        <span className="hub-row-words">
          {row.label}
          {row.acts.length === 1 && shownTitle(first.title) ? ` · ${shownTitle(first.title)}` : ''} · acts only
        </span>
        <button
          type="button"
          className="hub-row-btn"
          disabled={busy}
          onClick={() => void planChaptersIn(storyId, first.id)}
          title={`Suggest the chapters of Act ${first.no}${shownTitle(first.title) ? `, “${shownTitle(first.title)}”` : ''}, with what you wrote in the box`}
        >
          <Sparkles size={12} aria-hidden />
          {row.acts.length === 1 ? 'Plan its chapters' : `Plan Act ${first.no}’s chapters`}
        </button>
      </li>
    )
    if (placed?.rowKey === row.key && batch) items.push(batch)
  }
  if (run && !placed && batch) items.push(batch)

  return (
    <div className="hub-line" data-story-line>
      {items.length ? (
        <ol className="hub-rows" aria-label="The story line">
          {items}
        </ol>
      ) : (
        <div className="hub-line-empty" data-line-empty>
          <div className="hub-line-empty-rows" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <p className="hub-line-empty-t">Your story line will lie here</p>
          <p className="hub-line-empty-s">
            The acts, chapters and scenes the AI suggests arrive here in order, each one to keep, change or discard. Nothing goes into your story until you
            keep it.
          </p>
        </div>
      )}
    </div>
  )
}

/** A written chapter inside an opened written row: its name (a click opens its own page), its words, its next step. */
function WrittenChapter({ storyId, chapter, actions, back }: { storyId: ID; chapter: LineChapter; actions: React.ReactNode; back: Back }): React.JSX.Element {
  return (
    <div className="hub-kid">
      <span className="hub-row-mark is-done is-small" aria-hidden>
        <Check size={11} />
      </span>
      <ChapterLink storyId={storyId} chapter={chapter} back={back} />
      <span className="hub-kid-meta">
        {plural(chapter.scenes.length, 'scene')} · {chapter.words.toLocaleString('en-GB')} words
      </span>
      <span className="hub-kid-actions">{actions}</span>
    </div>
  )
}

/**
 * A planned chapter inside the opened planned stretch: its name (a click opens its own page), how many scenes, its one
 * next step, its goal, and its scenes' names when unfolded.
 */
function PlannedChapter({
  storyId,
  chapter,
  actHead,
  open,
  batch,
  driftBy,
  lit,
  kept,
  empty,
  outline,
  outerBack
}: StoryLineProps & {
  chapter: LineChapter
  actHead: LineChapter | null
  open: boolean
  batch: React.JSX.Element | null
  driftBy: Map<ID, HubDrift>
  lit: Set<ID> | null
  kept: Set<ID>
  empty: ID[]
}): React.JSX.Element {
  const scenes = chapter.scenes.filter((s) => !kept.has(s.id))
  const drifting = scenes.filter((s) => driftBy.has(s.id))
  const act = actHead ? (outline.acts ?? []).find((a) => a.id === actHead.actId) : null
  return (
    <div className="hub-chap" data-chapter={chapter.id}>
      {actHead && act ? (
        <p className="hub-chap-act">
          Act {actHead.actNo}
          {shownTitle(act.title) ? ` · ${shownTitle(act.title)}` : ''}
        </p>
      ) : null}
      <div className="hub-kid">
        {scenes.length ? (
          <button
            type="button"
            className="hub-kid-toggle"
            aria-expanded={open}
            onClick={() => toggleChapter(storyId, chapter.id)}
            aria-label={`${open ? 'Fold away' : 'Show'} the scenes of ${chapterName(chapter)}`}
          >
            <ChevronRight size={12} aria-hidden className={cn('hub-chev', open && 'is-open')} />
          </button>
        ) : (
          <span className="hub-row-mark is-planned is-small" aria-hidden />
        )}
        <ChapterLink storyId={storyId} chapter={chapter} back={outerBack} />
        <span className="hub-kid-meta">
          {scenes.length ? plural(scenes.length, 'scene') : 'no scenes yet'}
          {drifting.length ? <span className="hub-kid-drift"> · {drifting.length === 1 ? '1 needs a look' : `${drifting.length} need a look`}</span> : null}
        </span>
        <span className="hub-kid-actions">
          <ChapterStepButton storyId={storyId} chapter={chapter} empty={empty.length} back={outerBack} />
        </span>
      </div>
      {chapter.goal.trim() ? <p className="hub-kid-goal">{chapter.goal.trim()}</p> : null}
      {scenes.length ? (
        <Fold open={open} className="hub-kid-scenes">
          {scenes.map((s) => (
            <SceneLink
              key={s.id}
              storyId={storyId}
              scene={s}
              chapterNo={chapter.no}
              lit={!!lit?.has(s.id)}
              back={outerBack}
              note={driftBy.has(s.id) ? <DriftNote drift={driftBy.get(s.id)!} lit={!!lit?.has(s.id)} inline /> : null}
            />
          ))}
        </Fold>
      ) : null}
      {batch ? <div className="hub-chap-batch">{batch}</div> : null}
    </div>
  )
}

/** What a planned scene no longer fits, under it. */
function DriftNote({ drift, lit, inline = false }: { drift: HubDrift; lit: boolean; inline?: boolean }): React.JSX.Element {
  return (
    <p className={cn('hub-drift-note', inline && 'is-inline', lit && 'is-lit')} data-scene-row={inline ? undefined : drift.sceneId} data-drift-note={drift.sceneId}>
      <span className="hub-drift-label">{drift.label}:</span> {drift.text}
    </p>
  )
}

/** The newest batch's tree, read once per change of the run. */
export function useRunTree(run: HelperRun | null): TreeNode[] {
  return useMemo(() => (run ? treeOf(run) : []), [run])
}
