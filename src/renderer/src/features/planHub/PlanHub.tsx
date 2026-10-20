// Build with AI (View 'planHub'; Adam, 2026-10-20: "I told you I wanted a unified area to build all parts of the story
// using AI"; the Plan hub before, "the one place to plan with AI"). One page per story, the same on the desk and in the
// panels: "Build “<story>” with AI", then every AI building tool in four sections, one at a time under a row of tabs
// (Adam, 2026-10-20: "confusing with stuff locked behind other sections and it's hard to navigate"), each tab saying how
// its section stands:
//   1. Your idea: the idea (the one idea field), what must and must never happen, the story's style, Start from a recipe
//      (the Story builder's first step);
//   2. Cast and world: the cast and world planned from the idea and built into the codex, or built from a summary (the
//      World builder), and who and what the world has, with Add someone with AI;
//   3. The story line: what happens next (or how a new story is laid out), where the plan has drifted, and the story
//      line with the AI's suggestions in their place; each chapter with its name and one next step (Plan it, Write it,
//      Open), each scene its name;
//   4. Threads: the open plot threads, overdue first, each with Plan its payoff.
// Zoomed in (Option A, 2026-10-20): a chapter or a scene opens as its own page under the Story line tab, with a
// trail back to the whole story (ZoomPages.tsx; the view's `chapterId` or `sceneId`, zoomLogic.ts zoomOf): a chapter's
// plan, its scenes and Write this chapter; a scene's card, Ideas, Interview me, Fill the card and Write it.
// Beside them, Talk it over, about the chosen tab, and on Story line the Plan before writing switch. A new story opens at
// Your idea, one under way at the story line, else at the tab last chosen; every older way in opens its own section
// (buildLogic.ts buildRoute, tabFor). The
// suggestions and a request still arriving are the outline helper's session, so leaving the page loses neither; what
// Adam wrote here is kept while the app is open (hubStore.ts). Nothing goes into the story without a click.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { OutlineSize } from '@shared/contracts/outline'
import type { Chapter, ID, Outline, Story } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { ArrowLeft, ListTree } from '@/components/ui/icons'
import { Button, EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp, type View } from '@/lib/store'
import { useOutline } from '@/features/binder/outlineStore'
import { useDesk } from '@/features/look/look'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { Switch } from '@/features/world/parts/Switch'
import { useEntryCounts } from '@/features/binder/WorldSection'
import { PremiseCard } from '@/features/outline/PremiseCard'
import { PlanTalk } from '@/features/outline/PlanTalkParts'
import {
  helperKey,
  runBusy,
  setHelperMode,
  setHelperSize,
  shownRun,
  stopOutline,
  treeOf,
  useOutlineHelper,
  type HelperRun,
  type HelperSession
} from '@/features/outline/helperStore'
import { cardIsEmpty } from '@/features/outline/ideasLogic'
import { fitSize, fitStageSize } from '@/features/outline/size'
import { defaultMode, WHOLE_MOST_CHAPTERS, type PlanMode } from '@/features/outline/stages'
import type { TreeNode } from '@/features/outline/tree'
import { builderKey, briefOf, followRecipe, loadBrief, patchBrief, sizeForLength, useBuilders } from '@/features/storyBuilder/store'
import { IdeaStep } from '@/features/storyBuilder/IdeaStep'
import { CodexTalk, useCodexLocked } from '@/features/storyBuilder/CodexStep'
import { loadPlan, patchPlan, planOf } from '@/features/recipes/planStore'
import { buildStoryWorldSoon } from '@/features/worldBuilder/storyBuild'
import { useWorldBuilder } from '@/features/worldBuilder/worldBuilderStore'
import {
  chaptersHolding,
  hubMode,
  lineChapters,
  pickScope,
  rowsToOpen,
  scopesFor,
  storyLine,
  suggestionLabels,
  whereYouAre,
  wordsLine,
  writtenLine,
  type Where
} from './hubLogic'
import { castStatus, ideaStatus, lineStatus, SECTIONS, sectionLabel, tabFor, threadsStatus, type BuildSection, type BuildView } from './buildLogic'
import {
  hubKey,
  hubOf,
  loadBoard,
  loadFacts,
  openHub,
  openPanel,
  openTool,
  planIt,
  setScope,
  setSection,
  setWords,
  showScenes,
  showSummary,
  toggleRow,
  toggleThread,
  usePlanHubs,
  waitingThreads
} from './hubStore'
import { DriftCard, NextCard, SizeChoice, StartCard } from './HubCards'
import { ChapterPage, ScenePage } from './ZoomPages'
import { zoomOf } from './zoomLogic'
import { StoryLine } from './StoryLine'
import { EarlierBatches, shownNodes } from './LineSuggestions'
import { CastSection } from './CastSection'
import { ThreadsSection } from './ThreadsSection'
import './planHub.css'
import './build.css'
import './zoom.css'

export function PlanHub({ view }: { view: BuildView }): React.JSX.Element {
  const storyId = view.storyId
  const worldId = useApp((s) => s.world?.id)
  const story = useApp((s) => s.stories.find((st) => st.id === storyId) ?? null)
  const openStory = useApp((s) => s.storyId)
  const session = useOutlineHelper((st) => st.sessions[helperKey(worldId, storyId)])
  const brief = useBuilders((st) => st.builders[builderKey(storyId)]?.brief ?? null)
  const { outline } = useOutline()
  const shape = outline?.story.id === storyId ? outline : null
  // Once each time the page opens: the outline helper's session, whether the story is blank, and the idea.
  useLayoutEffect(() => {
    openHub(storyId)
    void loadBrief(storyId)
  }, [storyId])
  // The area is for the story open in the binder: open this one first, staying here.
  useEffect(() => {
    if (!story || openStory === storyId) return
    const app = useApp.getState()
    const v = app.view
    app.selectStory(storyId)
    app.navigate(v)
  }, [story, openStory, storyId])
  if (!story) {
    return (
      <div className="flex h-full items-start justify-center pt-[16vh]">
        <EmptyState
          icon={<ListTree size={20} />}
          title="This story isn’t here any more"
          actions={<Button onClick={() => useApp.getState().navigate({ kind: 'write' })}>Back to writing</Button>}
        >
          It may have been deleted. Stories you delete stay in Settings › Recently deleted for 30 days.
        </EmptyState>
      </div>
    )
  }
  if (!shape || !session || session.blank === null || !brief) return <div className="h-full" data-plan-hub-loading />
  return <Hub story={story} shape={shape} session={session} view={view} />
}

/** The empty "Chapter 1" a story was made with, still ahead of what was kept: the batch offers to remove it (with Undo). */
function useStarter(shape: Outline, run: HelperRun | null): Chapter | null {
  const kept = useMemo(() => new Set(Object.values(run?.decisions ?? {}).flatMap((d) => (d.status === 'kept' ? [d.id] : []))), [run?.decisions])
  const first = shape.chapters[0]
  const scenes = first ? shape.scenes.filter((sc) => sc.chapterId === first.id) : []
  const candidate =
    !!first &&
    !first.actId &&
    /^\s*chapter\s*\d*\s*$/i.test(first.title) &&
    !first.goal.trim() &&
    !kept.has(first.id) &&
    shape.chapters.some((c) => kept.has(c.id)) &&
    scenes.every((sc) => sc.wordCount === 0 && /^\s*scene\s*\d*\s*$/i.test(sc.title))
  const sceneKey = candidate ? scenes.map((sc) => sc.id).join(',') : ''
  const [empty, setEmpty] = useState<{ key: string; empty: boolean } | null>(null)
  useEffect(() => {
    if (!candidate) return
    let live = true
    const ids = sceneKey ? sceneKey.split(',') : []
    Promise.all(ids.map((id) => api.getScene(id)))
      .then((list) => live && setEmpty({ key: sceneKey, empty: list.every((sc) => cardIsEmpty({ ...emptySceneCard(), ...sc.card })) }))
      .catch(() => live && setEmpty({ key: sceneKey, empty: false }))
    return () => {
      live = false
    }
  }, [sceneKey, candidate])
  return candidate && first && empty?.key === sceneKey && empty.empty ? first : null
}

/** What each suggestion is called in the story line, from where its batch goes. */
function labelsFor(run: HelperRun, tree: TreeNode[], shape: Outline, where: Where | null, blank: boolean): Map<string, string> {
  const chapters = lineChapters(shape)
  const keptIds = new Set(Object.values(run.decisions).flatMap((d) => (d.status === 'kept' ? [d.id] : [])))
  const place = run.place
  const nodes = shownNodes(run, tree)
  // Filled cards are called by the scenes they are for.
  if (run.fill) {
    const byScene = new Map(chapters.flatMap((c) => c.scenes.map((sc) => [sc.id, `Ch ${c.no} · Sc ${sc.no}`] as const)))
    const fill = run.fill
    return new Map(nodes.map((n, i) => [n.key, byScene.get(fill[i] ?? '') ?? 'Scene'] as const))
  }
  if (run.lead) {
    const chapterId = place?.at === 'here' || place?.at === 'chapter' ? place.chapterId : null
    const ch = chapters.find((c) => c.id === chapterId)
    // Counting on from the scene they come after (the last one written, or the chapter's last), else the chapter's end.
    const kept = ch?.scenes.filter((s) => !keptIds.has(s.id)) ?? []
    const after = place?.at === 'here' ? kept.findIndex((s) => s.id === place.afterSceneId) : -1
    const before = after >= 0 ? after + 1 : place?.at === 'here' && where && where.chapterId === chapterId ? where.sceneNo : kept.length
    return suggestionLabels(nodes, run.decisions, { acts: 0, chapters: 0, lead: { chapterNo: ch?.no ?? 1, scenes: before } })
  }
  const actsBefore = (shape.acts ?? []).filter((a) => !keptIds.has(a.id)).length
  if (place?.at === 'here') {
    const after = chapters.find((c) => c.id === place.afterChapterId)
    return suggestionLabels(nodes, run.decisions, { acts: actsBefore, chapters: after?.no ?? chapters.length })
  }
  if (place?.at === 'act') {
    const actNo = (shape.acts ?? []).findIndex((a) => a.id === place.actId) + 1
    const before = chapters.filter((c) => !keptIds.has(c.id) && (c.actNo === null || c.actNo < actNo)).length
    return suggestionLabels(nodes, run.decisions, { acts: actsBefore, chapters: before })
  }
  if (blank) return suggestionLabels(nodes, run.decisions, { acts: 0, chapters: 0 })
  return suggestionLabels(nodes, run.decisions, { acts: actsBefore, chapters: chapters.filter((c) => !keptIds.has(c.id)).length })
}

/** A story followed from a recipe (a recipe story's plan, opened here): it follows the recipe, its guidance its idea. */
async function followFromRecipe(storyId: ID, recipeId: ID): Promise<void> {
  await loadBrief(storyId)
  if (!briefOf(storyId).recipe) followRecipe(storyId, recipeId)
  if (await loadPlan(storyId, recipeId)) {
    const guidance = planOf(storyId)?.guidance.trim() ?? ''
    if (guidance && !briefOf(storyId).plot.trim()) patchBrief(storyId, { plot: guidance })
  }
}

/**
 * Waits for an element to be in the page (a row opening), then brings it into view at the top of the area. Opened at
 * once (not glided), it is kept there for a moment while what is above it settles (a list still loading), unless Adam
 * scrolls, clicks or types first.
 */
function scrollToSoon(root: HTMLElement | null, selector: string, smooth: boolean, then?: (el: HTMLElement) => void): void {
  if (!root) return
  const until = Date.now() + 1500
  const glide = smooth && !reducedMotion() && !keyboardDriven()
  const go = (): void => {
    const el = root.querySelector<HTMLElement>(selector)
    if (!el) {
      if (Date.now() < until) requestAnimationFrame(go)
      return
    }
    el.scrollIntoView({ block: 'start', behavior: glide ? 'smooth' : 'auto' })
    then?.(el)
    if (!glide) pin(root, el)
  }
  requestAnimationFrame(go)
}

/** Waits for an element to be in the page (a tab just chosen), then hands it over, without scrolling to it. */
function whenShown(root: HTMLElement | null, selector: string, then: (el: HTMLElement) => void): void {
  if (!root) return
  const until = Date.now() + 1500
  const go = (): void => {
    const el = root.querySelector<HTMLElement>(selector)
    if (el) then(el)
    else if (Date.now() < until) requestAnimationFrame(go)
  }
  requestAnimationFrame(go)
}

/** Keeps an element where it was scrolled to for a moment (see scrollToSoon). */
function pin(root: HTMLElement, el: HTMLElement): void {
  let stop = false
  const end = Date.now() + 1500
  const quit = (): void => {
    stop = true
  }
  const off = (): void => {
    root.removeEventListener('wheel', quit)
    root.removeEventListener('pointerdown', quit)
    window.removeEventListener('keydown', quit)
  }
  root.addEventListener('wheel', quit, { passive: true })
  root.addEventListener('pointerdown', quit)
  window.addEventListener('keydown', quit)
  const at = (): number => el.getBoundingClientRect().top - root.getBoundingClientRect().top
  const want = at()
  const tick = (): void => {
    if (stop || Date.now() > end || !el.isConnected) return off()
    const now = at()
    if (Math.abs(now - want) > 2) root.scrollTop += now - want
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function Hub({ story, shape, session, view }: { story: Story; shape: Outline; session: HelperSession; view: BuildView }): React.JSX.Element {
  const storyId = story.id
  const back = view.back
  const worldId = useApp((s) => s.world?.id)
  const outlineRev = useApp((s) => s.outlineRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const planFirst = useApp((s) => s.settings?.planFirst ?? true)
  const updateSettings = useApp((s) => s.updateSettings)
  const desk = useDesk()
  const hub = usePlanHubs((s) => s.hubs[hubKey(worldId, storyId)]) ?? hubOf(storyId)
  const brief = useBuilders((st) => st.builders[builderKey(storyId)]?.brief ?? null)
  const castBuilding = useBuilders((st) => st.builders[builderKey(storyId)]?.build?.status === 'running')
  const summaryRunning = useWorldBuilder((s) => !!s.running)
  const counts = useEntryCounts()
  const scroller = useRef<HTMLDivElement>(null)
  // The tabs along the top: their height, so the talk beside and a row brought into view keep clear of them.
  const nav = useRef<HTMLDivElement>(null)
  const [navH, setNavH] = useState(64)
  useEffect(() => {
    const el = nav.current
    if (!el) return
    const ro = new ResizeObserver(() => setNavH(Math.round(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const mode = hubMode(shape, session.blank)
  // A chapter's or a scene's own page (zoomed in), or the whole story.
  const zoom = useMemo(() => zoomOf(view, shape), [view, shape])
  const zoomChapter = useMemo(() => (zoom ? (lineChapters(shape).find((c) => c.id === zoom.chapterId) ?? null) : null), [zoom, shape])
  const zoomScene = zoom?.kind === 'scene' ? (zoomChapter?.scenes.find((sc) => sc.id === zoom.sceneId) ?? null) : null
  const where = useMemo(() => whereYouAre(shape), [shape])
  const written = useMemo(() => writtenLine(shape, where), [shape, where])
  const rows = useMemo(() => storyLine(shape), [shape])
  const run = useMemo(() => (session.run ? shownRun(session, session.run) : null), [session])
  const tree = useMemo(() => (run ? treeOf(run) : []), [run])
  const running = runBusy(session.run)
  const starter = useStarter(shape, run)
  const labels = useMemo(() => (run ? labelsFor(run, tree, shape, where, session.blank === true) : new Map<string, string>()), [run, tree, shape, where, session.blank])
  const labelsOf = (r: HelperRun, t: TreeNode[]): Map<string, string> => labelsFor(r, t, shape, where, session.blank === true)

  // The facts from the main process (the last scene's gist, the threads, where the plan has drifted) and the plot threads
  // board, read again a moment after the story or its memory changes.
  const rev = `${outlineRev}:${memoryRev}`
  useEffect(() => {
    const t = setTimeout(
      () => {
        void loadFacts(storyId, rev)
        void loadBoard(storyId, rev)
      },
      hub.factsRev === null ? 0 : 400
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, rev])
  const facts = hub.facts
  const fresh = !!facts && facts.lastSceneId === (where?.sceneId ?? null)
  const drift = mode === 'writing' && fresh ? facts.drift : []
  const threads = waitingThreads(hub)

  // ---------- The tabs: one section at a time ----------

  // Story line on a chapter's or a scene's page; else what the view asks for, the tab last chosen, where the story stands.
  const tab = tabFor(view, hub.section, mode)
  /** Shows a section (its tab, or another section's button): from a chapter's page, Story line goes back to its row. */
  const goTo = useCallback(
    (s: BuildSection, then?: (el: HTMLElement) => void): void => {
      setSection(storyId, s)
      const near = s === 'line' && zoom ? { near: zoom.chapterId } : {}
      useApp.getState().navigate({ kind: 'planHub', storyId, section: s, ...near, ...(back ? { back } : {}) })
      if (then) whenShown(scroller.current, `[data-build-section="${s}"]`, then)
    },
    [storyId, back, zoom]
  )

  // What the way in asked for: a section, a chapter's or a scene's own page (with Write this chapter or a scene's tool
  // open), a summary build, a recipe to follow. Once each time it is opened (the first time, a story with nothing asked
  // for opens at its default section). Zoomed in, the page starts at its top, or at what was asked for.
  const applied = useRef<BuildView | null>(null)
  useLayoutEffect(() => {
    if (applied.current === view) return
    applied.current = view
    if (view.section && !zoomOf(view, shape)) setSection(storyId, view.section)
    if (view.summary) showSummary(storyId, true)
    if (view.recipeId) void followFromRecipe(storyId, view.recipeId)
    const z = zoomOf(view, shape)
    if (z) {
      if (z.kind === 'chapter' && view.open === 'write') openPanel(storyId, z.chapterId, 'write')
      if (z.kind === 'scene' && view.tool) openTool(storyId, z.sceneId, view.tool)
      if (scroller.current) scroller.current.scrollTop = 0
      const target =
        z.kind === 'chapter'
          ? view.open === 'write'
            ? `[data-write-panel="${CSS.escape(z.chapterId)}"]`
            : view.open === 'plan'
              ? `[data-chapter-plan="${CSS.escape(z.chapterId)}"]`
              : null
          : view.tool
            ? `[data-scene-page="${CSS.escape(z.sceneId)}"] .zoom-tools`
            : null
      if (target) scrollToSoon(scroller.current, target, false)
      return
    }
    // A tab starts at the top of the page; back out from a chapter's page, its row is open and in view.
    if (scroller.current) scroller.current.scrollTop = 0
    if (view.near) {
      const open = rowsToOpen(storyLine(shape), { chapterId: view.near })
      for (const k of open.rowKeys) toggleRow(storyId, k, true)
      if (open.chapterId) scrollToSoon(scroller.current, `[data-chapter="${CSS.escape(open.chapterId)}"]`, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // ---------- The story line's request ----------

  // How much a new story's whole plan lays out: what Adam picked, else from the idea's length (sizeForLength).
  const size: OutlineSize = session.size ?? sizeForLength(brief?.length ?? '', 0)
  const planMode: PlanMode = session.mode ?? defaultMode(size.chapters)
  const scopes = scopesFor(shape, mode, size)
  const scope = pickScope(scopes, hub.scope ?? view.at)
  const [problem, setProblem] = useState<string | null>(null)
  // The idea: the Story builder's plot, the one place it is written (the story's premise stands for it while there is none).
  // Once Adam types in Plan your story's box, it shows what he wrote, even emptied (as Your idea's box does).
  const [ideaTyped, setIdeaTyped] = useState(false)
  const idea = ideaTyped || brief?.plot.trim() ? (brief?.plot ?? '') : story.premise
  const writeIdea = (plot: string): void => {
    setIdeaTyped(true)
    if (plot.trim()) setProblem(null)
    patchBrief(storyId, { plot })
  }
  const focusIdea = (): void => goTo('idea', (el) => el.querySelector<HTMLTextAreaElement>('[data-plot]')?.focus())

  const plan = (): void => {
    if (!scope || running) return
    if (mode === 'start' && scope !== 'first-chapter' && !idea.trim()) {
      // Said under the box, with the cursor in it: the idea is written right here.
      setProblem('Write your idea first: a line or two on what the story is about is enough.')
      scroller.current?.querySelector<HTMLTextAreaElement>('[data-start-idea]')?.focus()
      return
    }
    setProblem(null)
    void planIt(storyId, { outline: shape, scope, premise: story.premise, fromPlot: !!idea.trim(), size, mode: planMode })
  }
  const status = 'Planning… the suggestions arrive in the story line below.'

  const showMe = (): void => {
    const ids = drift.map((d) => d.sceneId)
    const held = chaptersHolding(rows, ids)
    showScenes(storyId, held.rowKeys, held.chapterIds, ids)
  }

  const changeSize = (patch: Partial<OutlineSize>): void => setHelperSize(storyId, planMode === 'stages' ? fitStageSize(size, patch) : fitSize(size, patch))
  const changeMode = (next: PlanMode): void => {
    setHelperMode(storyId, next)
    if (next === 'whole') setHelperSize(storyId, fitSize(size, { chapters: Math.min(size.chapters, WHOLE_MOST_CHAPTERS), scenes: size.scenes || 3 }))
  }
  const acts = shape.acts ?? []
  const lastAct = acts[acts.length - 1]
  const landing =
    size.acts === 0 ? (lastAct ? `The chapters go in the story’s last act, “${lastAct.title || 'Untitled act'}”.` : null) : acts.length ? 'New acts go after the story’s acts.' : null

  const title = story.title.trim() || 'Untitled story'
  const hubView: View = { kind: 'planHub', storyId, section: 'line', ...(back ? { back } : {}) }
  const backToHub = { view: hubView, label: 'Back to Build with AI' }

  // How each section stands, for the list of sections and their heads.
  const statuses: Record<BuildSection, string> = {
    idea: ideaStatus(brief, story.premise),
    cast: castStatus(counts, brief, castBuilding || summaryRunning),
    line: lineStatus(shape),
    threads: threadsStatus(hub.board?.threads ?? null)
  }

  // The plan's premise, kept: a story from a recipe builds its world with the recipe's cast roles too.
  const recipePlan = planOf(storyId)
  const keepPremise = (premise: string): void => {
    if (!recipePlan) return
    patchPlan(storyId, { premise: { status: 'kept', text: premise, before: null, taskId: null } })
    buildStoryWorldSoon(storyId, recipePlan.recipeId)
  }

  // Beside the page, zoomed in or not: Talk it over, and on the story line (where drafts start) the Plan before writing switch.
  const side = (
    <aside className="hub-side" aria-label="Beside the plan">
      <TalkBeside storyId={storyId} section={tab} mode={mode} running={running} hasOpen={!!run && shownNodes(run, tree).some((n) => !run.decisions[n.key])} hasList={!!brief?.codex} />
      {tab === 'line' ? (
      <div className="hub-side-card" data-plan-first>
        <Switch id="hub-plan-first" checked={planFirst} onChange={(v) => void updateSettings({ planFirst: v })} aria-describedby="hub-plan-first-help" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <label htmlFor="hub-plan-first" className="text-[13px] font-medium text-fg">
            Plan before writing
          </label>
          <p id="hub-plan-first-help" className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Before the AI writes a scene, it looks up where everyone is and plans the scene’s beats, so the draft keeps to the story. Uses the memory model
            once each time.
          </p>
        </div>
      </div>
      ) : null}
    </aside>
  )

  // The tab list's keys: arrows, Home and End move between the tabs; Enter or Space (the button's own) picks one.
  const tabKeys = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
    if (next < 0 || at < 0) return
    e.preventDefault()
    tabs[next]?.focus()
  }

  // The section the tab shows, or (zoomed in, under Story line) the chapter's or the scene's own page.
  let panel: React.JSX.Element | null = null
  if (zoom && zoomChapter) {
    panel =
      zoom.kind === 'scene' && zoomScene ? (
        <ScenePage storyId={storyId} chapter={zoomChapter} scene={zoomScene} hub={hub} back={back} />
      ) : (
        <ChapterPage
          storyId={storyId}
          chapter={zoomChapter}
          outline={shape}
          hub={hub}
          session={session}
          run={run}
          tree={tree}
          labels={labels}
          starter={starter}
          empty={facts?.emptyCards[zoomChapter.id] ?? []}
          drift={drift}
          back={back}
        />
      )
  } else if (tab === 'idea') {
    panel = <IdeaStep storyId={storyId} premise={story.premise} />
  } else if (tab === 'cast') {
    panel = <CastSection storyId={storyId} summary={hub.summary} premise={story.premise} onGo={(s) => (s === 'idea' ? focusIdea() : goTo(s))} />
  } else if (tab === 'threads') {
    panel = (
      <ThreadsSection
        storyId={storyId}
        threads={hub.board?.threads ?? null}
        onPlan={() =>
          goTo('line', (el) => {
            // Mid-story the box says it; the box comes into view with what Plan its payoff put there.
            el.querySelector<HTMLTextAreaElement>('[data-next-card] textarea')?.focus()
          })
        }
      />
    )
  } else {
    panel = (
      <>
        {mode !== 'start' ? (
          <NextCard
            where={mode === 'writing' ? where : null}
            extra={
              scope === 'whole-story' ? (
                <SizeChoice size={size} sizeAuto={!session.size} planMode={planMode} onPlanMode={changeMode} onSize={changeSize} hasActs={acts.length > 0} where={landing} brief={brief} />
              ) : null
            }
            lastGist={fresh ? facts.lastGist : ''}
            words={hub.words}
            onWords={(w) => setWords(storyId, w)}
            scopes={scopes}
            scope={scope}
            onScope={(id) => setScope(storyId, id)}
            threads={threads}
            ticked={hub.threads}
            onThread={(id) => toggleThread(storyId, id)}
            running={running}
            status={status}
            onPlan={plan}
            onStop={() => stopOutline(storyId)}
          />
        ) : (
          <StartCard
            mode={mode}
            idea={idea}
            onIdeaChange={writeIdea}
            brief={brief}
            onCastAndWorld={() => goTo('cast')}
            scopes={scopes}
            scope={scope}
            onScope={(id) => setScope(storyId, id)}
            size={size}
            sizeAuto={!session.size}
            planMode={planMode}
            onPlanMode={changeMode}
            onSize={changeSize}
            hasActs={acts.length > 0}
            where={landing}
            desk={desk}
            running={running}
            status={status}
            onPlan={plan}
            onStop={() => stopOutline(storyId)}
            problem={problem}
          />
        )}
        {run && !story.premise.trim() && mode !== 'writing' ? <PremiseCard storyId={storyId} text={run.text} ended={!running} onKeep={keepPremise} /> : null}
        {drift.length ? <DriftCard storyId={storyId} drift={drift} update={hub.update} onShow={showMe} /> : null}
        <StoryLine
          storyId={storyId}
          outline={shape}
          rows={rows}
          mode={mode}
          hub={hub}
          session={session}
          run={run}
          tree={tree}
          labels={labels}
          drift={drift}
          emptyCards={facts?.emptyCards ?? {}}
          starter={starter}
          back={backToHub}
          outerBack={back}
        />
        <EarlierBatches storyId={storyId} session={session} labelsOf={labelsOf} />
      </>
    )
  }

  return (
    <div
      className="plan-hub build"
      data-plan-hub={mode}
      data-desk={desk || undefined}
      data-in-view={tab}
      data-zoomed={zoom?.kind}
      style={{ '--nav-h': `${navH}px` } as React.CSSProperties}
    >
      <div className="hub-scroll" data-hub-scroll ref={scroller}>
        <header className="hub-head">
          {back ? (
            <button type="button" className="hub-back" onClick={() => useApp.getState().navigate(back.view)}>
              <ArrowLeft size={13} aria-hidden />
              {back.label}
            </button>
          ) : null}
          <div className="hub-head-row">
            <div className="hub-head-t">
              <p className="hub-head-k">Build with AI</p>
              <h1 className="hub-title">Build “{title}” with AI</h1>
            </div>
            <p className="hub-written" data-written>
              {written.range ? `Written: ${written.range} · ${wordsLine(written.words)}` : mode === 'planned' ? 'Planned, nothing written yet' : 'Nothing written yet'}
            </p>
          </div>
        </header>

        <div className="build-body">
          <div ref={nav} className="build-nav" role="tablist" aria-label="Build with AI" data-build-nav onKeyDown={tabKeys}>
            {SECTIONS.map((s, i) => {
              const on = tab === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  id={`build-tab-${s.id}`}
                  aria-selected={on}
                  aria-controls="build-tabpanel"
                  tabIndex={on ? 0 : -1}
                  className={cn('build-nav-btn', on && 'is-on')}
                  onClick={() => goTo(s.id)}
                  data-nav={s.id}
                >
                  <span className="build-nav-no" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="build-nav-words">
                    <span className="build-nav-t">{s.label}</span>
                    {statuses[s.id] ? (
                      <span className="build-nav-s" data-section-status={s.id}>
                        {statuses[s.id]}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>

          <div
            className="hub-main build-main build-sec"
            role="tabpanel"
            id="build-tabpanel"
            aria-labelledby={`build-tab-${tab}`}
            data-build-section={tab}
          >
            {panel}
          </div>

          {side}
        </div>
      </div>
    </div>
  )
}

/**
 * Talk it over, beside every section and about the one in view: the cast and world list's own talk while Cast and world
 * is in view and has a list (its changes shown first, then applied); else the plan's talk, told what Adam is looking at
 * (his idea, the cast and world, the threads) so it answers about that, with quick asks to match.
 */
function TalkBeside({
  storyId,
  section,
  mode,
  running,
  hasOpen,
  hasList
}: {
  storyId: ID
  section: BuildSection
  mode: 'start' | 'planned' | 'writing'
  running: boolean
  hasOpen: boolean
  hasList: boolean
}): React.JSX.Element {
  const codexLocked = useCodexLocked(storyId)
  const about = sectionLabel(section)
  if (section === 'cast' && hasList) return <CodexTalk storyId={storyId} locked={codexLocked} className="hub-talk" title="Talk it over" about={about} />
  const talk: Record<BuildSection, { intro: string; quick: string[]; looking?: string }> = {
    idea: {
      intro: 'Ask about your idea: what it needs, where it could go, what could happen. It knows your idea, your style and your cast and world.',
      quick: ['What is my story missing?', 'Who could stand in the lead’s way?', 'Suggest a twist for the middle'],
      looking: 'His idea for the story, its style and its recipe (Your idea)'
    },
    cast: {
      intro: 'Ask about your cast and world: who is missing, who could clash, where things could happen. It knows your idea and your plan.',
      quick: ['Who is missing from my cast?', 'Who could be the villain?', 'Where could the story go next?'],
      looking: 'The story’s cast and world (Cast and world)'
    },
    line: {
      intro:
        mode === 'writing'
          ? 'Ask about the plan, or ask for a change. It knows what you’ve written so far.'
          : 'Ask about your plan, or ask for a change to the suggestions. It knows your idea and your cast and world.',
      quick: hasOpen ? ['Raise the stakes', 'Tighten the pacing', 'Add a twist'] : ['What should happen next?', 'Which threads have gone quiet?', 'Is anything moving too fast?']
    },
    threads: {
      intro: 'Ask about the plot threads: which have gone quiet, where one could pay off, what is left hanging. It knows what you’ve written so far.',
      quick: ['Which threads have gone quiet?', 'Where could a thread pay off?', 'Is anything left hanging?'],
      looking: 'The story’s open plot threads (Threads)'
    }
  }
  const t = talk[section]
  return <PlanTalk storyId={storyId} running={running} intro={t.intro} quick={t.quick} applyLabel="Make this change" className="hub-talk" about={about} looking={t.looking} />
}
