// The story line (Build with AI's third section, 2026-10-20; the Plan hub's before): the story from start to end in a few
// rows, the AI's suggestions in their place. What is written is folded away ("✓ Act 1 · Ch 1 to Ch 3 · written", Open),
// the chapter being written lists its scenes so far, then YOU ARE HERE and the newest suggestions for what comes next;
// then what is planned but not written ("Ch 5 to Ch 9 · planned, not written", Pick up from here opens it chapter by
// chapter) and acts that have no chapters yet (Plan its chapters). Every chapter can carry its outline on: Add scenes to
// Ch N after its last scene, Plan its scenes when it has none, Fill in its empty cards; each with the words in the box
// and the threads ticked, and the suggestions arrive under that chapter. Each chapter planned or being written has, in
// its own row, Plan this chapter (the chapter planner: its interview, its goal and scene cards, ChapterPlanPanel.tsx)
// and Write this chapter (its plan to read, then how it goes, WritePanel.tsx); each planned scene has Ideas, Interview
// me, Fill the card and Write it (SceneRow.tsx). A planned scene the story has moved on from says so under it; Show me
// lights it up. Rows come from hubLogic.ts storyLine; suggestions are drawn by LineSuggestions.tsx.

import { useEffect, useMemo, useRef } from 'react'
import type { HubDrift } from '@shared/contracts/planHub'
import type { Chapter, ID, Outline } from '@shared/types'
import { Check, ChevronRight, NotebookText, PenLine, Plus, Sparkles, SquarePen } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp, type View } from '@/lib/store'
import { reducedMotion } from '@/features/look/motion'
import { useChapterWriter } from '@/features/chapterWriter/chapterWriterStore'
import { runBusy, treeOf, type HelperRun, type HelperSession } from '@/features/outline/helperStore'
import { countNodes, totalOf, type TreeNode } from '@/features/outline/tree'
import { chapterName, rowForPlace, sceneName, shownTitle, type HubMode, type LineChapter, type LineRow, type LineScene } from './hubLogic'
import { writeStep } from './buildLogic'
import { addScenesTo, fillCardsIn, openPanel, planChaptersIn, toggleChapter, toggleRow, type HubState } from './hubStore'
import { BatchHead, LineSuggestions, shownNodes, WaitingRows } from './LineSuggestions'
import { ChapterPlanPanel } from './ChapterPlanPanel'
import { WritePanel } from './WritePanel'
import { SceneRow } from './SceneRow'

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

/** A chapter's ways to carry its outline on: Add scenes to it (or Plan its scenes) and Fill in its empty cards. */
function ChapterActions({
  storyId,
  chapter,
  empty,
  busy,
  withAdd = true,
  quiet = false
}: {
  storyId: ID
  chapter: LineChapter
  empty: ID[]
  busy: boolean
  withAdd?: boolean
  quiet?: boolean
}): React.JSX.Element {
  const name = `Ch ${chapter.no}`
  return (
    <>
      {withAdd ? (
        <button
          type="button"
          className={cn('hub-row-btn', quiet && 'is-quiet')}
          disabled={busy}
          onClick={() => void addScenesTo(storyId, chapter)}
          data-plan-scenes={chapter.scenes.length ? undefined : true}
          data-add-scenes={chapter.scenes.length ? chapter.id : undefined}
          title={
            chapter.scenes.length
              ? `Suggest more scenes for ${name}, after its last scene, with what you wrote in the box`
              : 'Suggest this chapter’s scenes, with what you wrote in the box'
          }
        >
          {chapter.scenes.length ? <Plus size={12} aria-hidden /> : <Sparkles size={12} aria-hidden />}
          {chapter.scenes.length ? `Add scenes to ${name}` : 'Plan its scenes'}
        </button>
      ) : null}
      {empty.length ? (
        <button
          type="button"
          className={cn('hub-row-btn', quiet && 'is-quiet')}
          disabled={busy}
          onClick={() => void fillCardsIn(storyId, chapter, empty)}
          data-fill-cards={chapter.id}
          title="Plan what happens in the scenes whose cards are empty, from the story so far. Nothing a card already says changes."
        >
          <SquarePen size={12} aria-hidden />
          {empty.length === 1 ? 'Fill in 1 empty card' : `Fill in ${empty.length} empty cards`}
        </button>
      ) : null}
    </>
  )
}

/** Plan this chapter and Write this chapter, in a chapter's row; while the AI writes it, how it is going. */
function ChapterTools({ storyId, chapter, hub }: { storyId: ID; chapter: LineChapter; hub: HubState }): React.JSX.Element {
  const progress = useChapterWriter((s) => (s.progress?.chapterId === chapter.id ? s.progress : null))
  const open = hub.panel?.chapterId === chapter.id ? hub.panel.kind : null
  const toggle = (kind: 'plan' | 'write'): void => openPanel(storyId, chapter.id, open === kind ? null : kind)
  return (
    <>
      <button
        type="button"
        className={cn('hub-row-btn is-quiet', open === 'plan' && 'is-on')}
        aria-expanded={open === 'plan'}
        onClick={() => toggle('plan')}
        data-plan-chapter={chapter.id}
        title="This chapter’s own plan: interview me, its goal and its scene cards"
      >
        <NotebookText size={12} aria-hidden />
        Plan this chapter
      </button>
      {chapter.scenes.length ? (
        <button
          type="button"
          className={cn('hub-row-btn', open === 'write' && 'is-on', progress && 'is-busy')}
          aria-expanded={open === 'write'}
          onClick={() => toggle('write')}
          data-write-chapter-btn={chapter.id}
          title={progress ? 'The AI is writing this chapter: see how it is going' : 'Write the whole chapter with AI: its plan first, then every scene'}
        >
          <PenLine size={12} aria-hidden />
          {progress ? `Writing · ${writeStep(progress.stage).words.replace(/^step /, '')}` : 'Write this chapter'}
        </button>
      ) : null}
    </>
  )
}

/** The panel open in a chapter's row, if any, brought into view (as far as needed) when it opens or changes. */
function ChapterPanelFor({ storyId, chapter, hub }: { storyId: ID; chapter: LineChapter; hub: HubState }): React.JSX.Element | null {
  const kind = hub.panel?.chapterId === chapter.id ? hub.panel.kind : null
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!kind) return
    requestAnimationFrame(() => box.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }))
  }, [kind])
  if (!kind) return null
  return <div ref={box} className="build-panel-wrap">{kind === 'plan' ? <ChapterPlanPanel storyId={storyId} chapter={chapter} /> : <WritePanel storyId={storyId} chapter={chapter} />}</div>
}

export function StoryLine(p: StoryLineProps): React.JSX.Element {
  const { storyId, rows, run, tree, hub, mode, emptyCards } = p
  const busy = runBusy(run)
  // A batch with everything decided folds to its head: what it kept is in the rows, where it now is in the story.
  const nodes = run ? shownNodes(run, tree) : []
  const settled = !!run && !busy && nodes.length > 0 && totalOf(countNodes(nodes, run.decisions, 'open')) === 0
  const placed = run ? rowForPlace(rows, run.place) : null
  const kept = useMemo(() => (settled ? new Set<ID>() : keptIn(run, tree)), [run, tree, settled])
  const driftBy = useMemo(() => new Map(p.drift.map((d) => [d.sceneId, d])), [p.drift])
  const lit = hub.lit && Date.now() - hub.lit.at < LIT_MS ? new Set(hub.lit.ids) : null
  const emptyIn = (chapterId: ID): ID[] => emptyCards[chapterId] ?? []
  const toolFor = (sceneId: ID): 'ideas' | 'interview' | null => (hub.tool?.sceneId === sceneId ? hub.tool.kind : null)

  // Show me: the first lit scene comes into view once its row has opened.
  const litAt = hub.lit?.at ?? 0
  useEffect(() => {
    if (!litAt || Date.now() - litAt > 1000) return
    const id = hub.lit?.ids[0]
    if (!id) return
    requestAnimationFrame(() =>
      document.querySelector(`[data-scene-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    )
  }, [litAt, hub.lit?.ids])

  const batch = run ? (
    <li className="hub-line-batch" data-batch={run.place?.at ?? 'end'} data-settled={settled || undefined} key="batch">
      <BatchHead storyId={storyId} session={p.session} run={run} tree={tree} starter={p.starter} backLabel={p.back} />
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
            onClick={() => useApp.getState().selectScene(s.id, storyId)}
            title={written ? 'Open this scene' : 'Open this scene to write it'}
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
            title={isOpen ? undefined : 'Open it chapter by chapter, to add scenes or fill in empty cards'}
          >
            {isOpen ? 'Fold away' : 'Open'}
          </button>
        </li>
      )
      if (isOpen)
        items.push(
          <li key={`${row.key}:in`} className="hub-row-kids" data-written-chapters>
            {row.chapters.map((c) => (
              <div key={c.id} className="hub-chap" data-chapter={c.id}>
                <WrittenChapter
                  storyId={storyId}
                  chapter={c}
                  actions={placed?.chapterId === c.id ? null : <ChapterActions storyId={storyId} chapter={c} empty={emptyIn(c.id)} busy={busy} quiet />}
                />
                <ChapterPanelFor storyId={storyId} chapter={c} hub={hub} />
                {placed?.chapterId === c.id && batch ? <div className="hub-chap-batch">{batch}</div> : null}
              </div>
            ))}
          </li>
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
            <span className="hub-row-ch">Ch {row.chapter.no}</span>
            <span className="hub-dot"> · </span>
            {scenesLine(row.scenes, true)}
          </span>
          <span className="hub-kid-actions">
            {empty.length ? <ChapterActions storyId={storyId} chapter={row.chapter} empty={empty} busy={busy} withAdd={false} quiet /> : null}
            <ChapterTools storyId={storyId} chapter={row.chapter} hub={hub} />
          </span>
        </li>
      )
      if (hub.panel?.chapterId === row.chapter.id)
        items.push(
          <li key={`${row.key}:panel`} className="hub-row-kids is-panel">
            <ChapterPanelFor storyId={storyId} chapter={row.chapter} hub={hub} />
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
                <SceneRow
                  key={s.id}
                  storyId={storyId}
                  scene={s}
                  chapterNo={row.chapter.no}
                  tool={toolFor(s.id)}
                  lit={!!lit?.has(s.id)}
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
      const chapters = row.chapters.filter((c) => !kept.has(c.id))
      if (!chapters.length) continue
      const range =
        chapters.length === row.chapters.length ? row.range : chapters.length === 1 ? `Ch ${chapters[0].no}` : `Ch ${chapters[0].no} to Ch ${chapters[chapters.length - 1].no}`
      items.push(
        <li key={row.key} className="hub-row is-planned is-dashed" data-row="planned">
          <span className="hub-row-mark is-planned" aria-hidden />
          <span className="hub-row-words">{range} · planned, not written</span>
          <button
            type="button"
            className="hub-row-btn"
            aria-expanded={isOpen}
            onClick={() => toggleRow(storyId, row.key)}
            title={isOpen ? undefined : 'Open the plan chapter by chapter, to carry on planning it'}
          >
            {isOpen ? 'Fold away' : mode === 'writing' ? 'Pick up from here' : 'Open the plan'}
          </button>
        </li>
      )
      if (isOpen)
        items.push(
          <li key={`${row.key}:in`} className="hub-row-kids" data-planned-chapters>
            {chapters.map((c, i) => (
              <PlannedChapter
                key={c.id}
                {...p}
                chapter={c}
                actHead={c.actId && c.actId !== chapters[i - 1]?.actId ? c : null}
                open={hub.openChapters.includes(c.id) || p.drift.some((d) => d.chapterId === c.id && lit?.has(d.sceneId)) || c.scenes.some((s) => hub.tool?.sceneId === s.id)}
                batch={placed?.chapterId === c.id ? batch : null}
                driftBy={driftBy}
                lit={lit}
                busy={busy}
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

/** A written chapter inside an opened written row: its name (a click opens its first scene), its words, its actions. */
function WrittenChapter({ storyId, chapter, actions }: { storyId: ID; chapter: LineChapter; actions: React.ReactNode }): React.JSX.Element {
  const first = chapter.scenes[0]
  return (
    <div className="hub-kid">
      <span className="hub-row-mark is-done is-small" aria-hidden>
        <Check size={11} />
      </span>
      <button
        type="button"
        className="hub-kid-name"
        disabled={!first}
        onClick={() => first && useApp.getState().selectScene(first.id, storyId)}
        title="Open its first scene"
      >
        {chapterName(chapter)}
      </button>
      <span className="hub-kid-meta">
        {plural(chapter.scenes.length, 'scene')} · {chapter.words.toLocaleString('en-GB')} words
      </span>
      <span className="hub-kid-actions">{actions}</span>
    </div>
  )
}

/**
 * A planned chapter inside the opened planned stretch: its goal, its scenes (each with what the AI can do for it), its
 * ways to carry on, Plan this chapter and Write this chapter, and whichever of those is open.
 */
function PlannedChapter({
  storyId,
  chapter,
  actHead,
  open,
  batch,
  driftBy,
  lit,
  busy,
  kept,
  empty,
  outline,
  hub
}: StoryLineProps & {
  chapter: LineChapter
  actHead: LineChapter | null
  open: boolean
  batch: React.JSX.Element | null
  driftBy: Map<ID, HubDrift>
  lit: Set<ID> | null
  busy: boolean
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
        <span className="hub-kid-name is-text">{chapterName(chapter)}</span>
        <span className="hub-kid-meta">
          {scenes.length ? plural(scenes.length, 'scene') : 'no scenes yet'}
          {drifting.length ? <span className="hub-kid-drift"> · {drifting.length === 1 ? '1 needs a look' : `${drifting.length} need a look`}</span> : null}
        </span>
        <span className="hub-kid-actions">
          {!batch ? <ChapterActions storyId={storyId} chapter={chapter} empty={empty} busy={busy} /> : null}
          <ChapterTools storyId={storyId} chapter={chapter} hub={hub} />
        </span>
      </div>
      {chapter.goal.trim() ? <p className="hub-kid-goal">{chapter.goal.trim()}</p> : null}
      <ChapterPanelFor storyId={storyId} chapter={chapter} hub={hub} />
      {open && scenes.length ? (
        <div className="hub-kid-scenes">
          {scenes.map((s) => (
            <SceneRow
              key={s.id}
              storyId={storyId}
              scene={s}
              chapterNo={chapter.no}
              tool={hub.tool?.sceneId === s.id ? hub.tool.kind : null}
              lit={!!lit?.has(s.id)}
              note={driftBy.has(s.id) ? <DriftNote drift={driftBy.get(s.id)!} lit={!!lit?.has(s.id)} inline /> : null}
            />
          ))}
        </div>
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
