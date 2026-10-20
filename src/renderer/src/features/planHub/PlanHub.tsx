// The Plan hub (View 'planHub'; Adam, 2026-10-20: "the one place to plan with AI", and "we should also be able to return
// after we have already written part of a story and plan the next part of it"). One page per story, the same on the desk
// and in the panels, built to the mid-story mock-up:
//   the header: Plan, the story's title, what is written ("Written: Ch 1 to Ch 4, Sc 2 · 31,400 words"), and the way to
//     the idea, cast and world (the Story builder's first steps);
//   "What happens next?" (mid-story) or "What is your story?" (a new story): HubCards.tsx;
//   "The story has moved on from the plan", when planned scene cards no longer fit what is written (no AI call to find it);
//   the story line, with the AI's suggestions in their place: StoryLine.tsx, LineSuggestions.tsx;
//   beside it, Talk it over (the outline's own talk: the change shown first, made only with "Make this change") and the
//     Plan before writing switch.
// The suggestions and a request still arriving are the outline helper's session, so leaving the page loses neither; what
// Adam wrote here is kept while the app is open (hubStore.ts). Nothing goes into the story without a click.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { OutlineSize } from '@shared/contracts/outline'
import type { Chapter, ID, Outline, Story } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { ArrowLeft, Feather, ListTree } from '@/components/ui/icons'
import { Button, EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp, type View } from '@/lib/store'
import { useOutline } from '@/features/binder/outlineStore'
import { useDesk } from '@/features/look/look'
import { Switch } from '@/features/world/parts/Switch'
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
import { builderKey, loadBrief, patchBrief, sizeForLength, useBuilders } from '@/features/storyBuilder/store'
import {
  chaptersHolding,
  hubMode,
  lineChapters,
  pickScope,
  scopesFor,
  storyLine,
  suggestionLabels,
  whereYouAre,
  wordsLine,
  writtenLine,
  type HubScopeId,
  type Where
} from './hubLogic'
import { hubKey, hubOf, loadFacts, openHub, planIt, setScope, setWords, showScenes, toggleRow, toggleThread, usePlanHubs } from './hubStore'
import { DriftCard, NextCard, SizeChoice, StartCard } from './HubCards'
import { StoryLine } from './StoryLine'
import { EarlierBatches, shownNodes } from './LineSuggestions'
import './planHub.css'

export function PlanHub({ storyId, at, back }: { storyId: ID; at?: HubScopeId; back?: { view: View; label: string } }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const story = useApp((s) => s.stories.find((st) => st.id === storyId) ?? null)
  const openStory = useApp((s) => s.storyId)
  const session = useOutlineHelper((st) => st.sessions[helperKey(worldId, storyId)])
  const { outline } = useOutline()
  const shape = outline?.story.id === storyId ? outline : null
  // Once each time the page opens: the outline helper's session, whether the story is blank, and the idea.
  useLayoutEffect(() => {
    openHub(storyId)
    void loadBrief(storyId)
  }, [storyId])
  // The hub is for the story open in the binder: open this one first, staying here.
  useEffect(() => {
    if (!story || openStory === storyId) return
    const app = useApp.getState()
    const view = app.view
    app.selectStory(storyId)
    app.navigate(view)
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
  if (!shape || !session || session.blank === null) return <div className="h-full" data-plan-hub-loading />
  return <Hub story={story} shape={shape} session={session} at={at} back={back} />
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

function Hub({
  story,
  shape,
  session,
  at,
  back
}: {
  story: Story
  shape: Outline
  session: HelperSession
  at?: HubScopeId
  back?: { view: View; label: string }
}): React.JSX.Element {
  const storyId = story.id
  const worldId = useApp((s) => s.world?.id)
  const outlineRev = useApp((s) => s.outlineRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const planFirst = useApp((s) => s.settings?.planFirst ?? true)
  const updateSettings = useApp((s) => s.updateSettings)
  const desk = useDesk()
  const hub = usePlanHubs((s) => s.hubs[hubKey(worldId, storyId)]) ?? hubOf(storyId)
  const brief = useBuilders((st) => st.builders[builderKey(storyId)]?.brief ?? null)

  const mode = hubMode(shape, session.blank)
  const where = useMemo(() => whereYouAre(shape), [shape])
  const written = useMemo(() => writtenLine(shape, where), [shape, where])
  const rows = useMemo(() => storyLine(shape), [shape])
  const run = useMemo(() => (session.run ? shownRun(session, session.run) : null), [session])
  const tree = useMemo(() => (run ? treeOf(run) : []), [run])
  const running = runBusy(session.run)
  const starter = useStarter(shape, run)
  const labels = useMemo(() => (run ? labelsFor(run, tree, shape, where, session.blank === true) : new Map<string, string>()), [run, tree, shape, where, session.blank])
  const labelsOf = (r: HelperRun, t: TreeNode[]): Map<string, string> => labelsFor(r, t, shape, where, session.blank === true)

  // The facts from the main process (the last scene's gist, the threads, where the plan has drifted), read again a moment
  // after the story or its memory changes.
  const rev = `${outlineRev}:${memoryRev}`
  useEffect(() => {
    const t = setTimeout(() => void loadFacts(storyId, rev), hub.factsRev === null ? 0 : 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, rev])
  const facts = hub.facts
  const fresh = !!facts && facts.lastSceneId === (where?.sceneId ?? null)
  const drift = mode === 'writing' && fresh ? facts.drift : []
  const threads = facts?.threads ?? []

  // A story planned but not written: its plan shows open, chapter by chapter, the first time the hub shows it.
  useEffect(() => {
    if (mode === 'planned' && !hub.open.includes('planned')) toggleRow(storyId, 'planned', true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, storyId])

  // How much a new story's whole plan lays out: what Adam picked, else from the idea's length (sizeForLength).
  const size: OutlineSize = session.size ?? sizeForLength(brief?.length ?? '', 0)
  const planMode: PlanMode = session.mode ?? defaultMode(size.chapters)
  const scopes = scopesFor(shape, mode, size)
  const scope = pickScope(scopes, hub.scope ?? at)
  const [problem, setProblem] = useState<string | null>(null)

  // The idea: the Story builder's plot, the one place it is written (the story's premise shows here while there is none).
  const [ideaDraft, setIdeaDraft] = useState<string | null>(null)
  const idea = ideaDraft ?? (brief?.plot.trim() ? brief.plot : story.premise)
  const [ideaSaved, setIdeaSaved] = useState<'idle' | 'saved'>('idle')
  useEffect(() => {
    if (ideaDraft === null) return
    const t = setTimeout(() => setIdeaSaved('saved'), 600)
    return () => clearTimeout(t)
  }, [ideaDraft])
  const changeIdea = (v: string): void => {
    setIdeaDraft(v)
    setIdeaSaved('idle')
    patchBrief(storyId, { plot: v })
    if (problem) setProblem(null)
  }

  const plan = (): void => {
    if (!scope || running) return
    if (mode === 'start' && scope !== 'first-chapter' && !idea.trim()) {
      setProblem('Write your idea first: a line or two on what the story is about is enough.')
      return
    }
    setProblem(null)
    void planIt(storyId, { outline: shape, scope, premise: story.premise, fromPlot: !!idea.trim(), size, mode: planMode })
  }
  // In the card, what is happening in a word; the batch in the story line says how far it has got.
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
    size.acts === 0
      ? lastAct
        ? `The chapters go in the story’s last act, “${lastAct.title || 'Untitled act'}”.`
        : null
      : acts.length
        ? 'New acts go after the story’s acts.'
        : null

  const title = story.title.trim() || 'Untitled story'
  const hubView: View = { kind: 'planHub', storyId, ...(back ? { back } : {}) }
  const backToHub = { view: hubView, label: 'Back to the plan' }
  const openIdea = (): void => useApp.getState().navigate({ kind: 'storyBuilder', storyId, step: 'idea' })
  const talkIntro =
    mode === 'writing'
      ? 'Ask about the plan, or ask for a change. It knows what you’ve written so far.'
      : 'Ask about your plan, or ask for a change to the suggestions. It knows your idea and your cast and world.'
  const hasOpen = !!run && shownNodes(run, tree).some((n) => !run.decisions[n.key])
  const quick = hasOpen ? ['Raise the stakes', 'Tighten the pacing', 'Add a twist'] : ['What should happen next?', 'Which threads have gone quiet?', 'Is anything moving too fast?']

  return (
    <div className="plan-hub" data-plan-hub={mode} data-desk={desk || undefined}>
      <div className="hub-scroll" data-hub-scroll>
        <header className="hub-head">
          {back ? (
            <button type="button" className="hub-back" onClick={() => useApp.getState().navigate(back.view)}>
              <ArrowLeft size={13} aria-hidden />
              {back.label}
            </button>
          ) : null}
          <div className="hub-head-row">
            <div className="hub-head-t">
              <p className="hub-head-k">Plan</p>
              <h1 className="hub-title">{title}</h1>
            </div>
            <p className="hub-written" data-written>
              {written.range ? `Written: ${written.range} · ${wordsLine(written.words)}` : mode === 'planned' ? 'Planned, nothing written yet' : 'Nothing written yet'}
            </p>
            <Button icon={<Feather size={14} />} onClick={openIdea} title="Your idea, then the cast and world: the Story builder’s first steps">
              The idea, cast and world
            </Button>
          </div>
        </header>

        <div className="hub-body">
          <div className="hub-main">
            {mode !== 'start' ? (
              <NextCard
                where={mode === 'writing' ? where : null}
                extra={
                  scope === 'whole-story' ? (
                    <SizeChoice
                      size={size}
                      sizeAuto={!session.size}
                      planMode={planMode}
                      onPlanMode={changeMode}
                      onSize={changeSize}
                      hasActs={acts.length > 0}
                      where={landing}
                      brief={brief}
                    />
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
                onIdea={changeIdea}
                ideaSave={{ status: ideaSaved, error: null }}
                brief={brief}
                onCastAndWorld={() => useApp.getState().navigate({ kind: 'storyBuilder', storyId, step: 'codex' })}
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
            {run && !story.premise.trim() && mode !== 'writing' ? <PremiseCard storyId={storyId} text={run.text} ended={!running} /> : null}
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
            />
            <EarlierBatches storyId={storyId} session={session} labelsOf={labelsOf} />
          </div>
          <aside className="hub-side" aria-label="Beside the plan">
            <PlanTalk storyId={storyId} running={running} intro={talkIntro} quick={quick} applyLabel="Make this change" className="hub-talk" />
            <div className="hub-side-card" data-plan-first>
              <Switch id="hub-plan-first" checked={planFirst} onChange={(v) => void updateSettings({ planFirst: v })} aria-describedby="hub-plan-first-help" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <label htmlFor="hub-plan-first" className="text-[13px] font-medium text-fg">
                  Plan before writing
                </label>
                <p id="hub-plan-first-help" className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  Before the AI writes a scene, it looks up where everyone is and plans the scene’s beats, so the draft keeps to the story. Uses the memory
                  model once each time.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
