// Build with AI, zoomed in (Adam's choice, "Option A: Zoom in", 2026-10-20): a chapter or a scene as its own page in the
// area, so the whole story's line can stay quiet. The trail at the top goes back out ("Whole story › Ch 14 · The ford",
// "Whole story › Ch 14 › Sc 2").
//   - A chapter's page: how it stands, Write this chapter (the one primary button; its plan to read, then how it goes, in
//     WritePanel.tsx), what the chapter achieves and how many scenes and how long (ChapterPlanPanel.tsx ChapterGoal and
//     ChapterSize), its scenes (SceneRow.tsx: one action each, the rest in ⋯), and Plan with AI (Interview me, Suggest
//     scenes or Add scenes, Fill in the empty cards), whose suggestions arrive here to keep, change or discard.
//   - A scene's page: its card in short, then Ideas, Interview me, Fill the card and Write it (the scene opened on the
//     writing page and its draft started), written or not.
// The view says which (zoomLogic.ts zoomOf): `chapterId` a chapter's page, `sceneId` a scene's.

import { useEffect, useId, useMemo, useState } from 'react'
import type { HubDrift } from '@shared/contracts/planHub'
import type { Chapter, Entry, ID, Outline, SceneCard } from '@shared/types'
import { BookOpen, ChevronRight, Layers, Lightbulb, MessageCircleQuestion, PenLine, Plus, SquarePen } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp, type View } from '@/lib/store'
import { useChapterWriter } from '@/features/chapterWriter/chapterWriterStore'
import { requestChapterCardFocus } from '@/features/chapterCard/chapterCardEvents'
import { chapterSceneCount, chapterHelperKey, runBusy, useOutlineHelper, type HelperRun, type HelperSession } from '@/features/outline/helperStore'
import { cardIsEmpty } from '@/features/outline/ideasLogic'
import type { TreeNode } from '@/features/outline/tree'
import { emptySceneCard } from '@shared/defaults'
import { chapterName, shownTitle, type LineChapter, type LineScene } from './hubLogic'
import { writeStep } from './buildLogic'
import { addScenesTo, fillCardsIn, openPanel, type HubState } from './hubStore'
import { chapterMeta, chapterView, trailOf, type TrailStep } from './zoomLogic'
import { ChapterGoal, ChapterPlanPanel, ChapterSize } from './ChapterPlanPanel'
import { WritePanel } from './WritePanel'
import { FillingNow, SceneRow, SceneToolOpen, useSceneTools, writeScene } from './SceneRow'
import { BatchHead, LineSuggestions, shownNodes, WaitingRows } from './LineSuggestions'

type Back = { view: View; label: string }

/** "Whole story › Ch 14 · The ford": each step but the last goes back out. */
function Trail({ steps }: { steps: TrailStep[] }): React.JSX.Element {
  return (
    <nav className="zoom-trail" aria-label="Trail" data-zoom-trail>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            {i ? <ChevronRight size={12} aria-hidden className="zoom-trail-sep" /> : null}
            {s.view ? (
              <button type="button" className="zoom-trail-link" onClick={() => useApp.getState().navigate(s.view!)} data-trail={i === 0 ? 'whole' : 'chapter'}>
                {s.label}
              </button>
            ) : (
              <span className="zoom-trail-here" aria-current="page">
                {s.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Whether a batch of the story line's suggestions belongs on this chapter's page (Add scenes, Fill in, the next scene). */
const placedIn = (run: HelperRun | null, chapterId: ID): boolean =>
  !!run && ((run.place?.at === 'chapter' && run.place.chapterId === chapterId) || (run.place?.at === 'here' && run.place.chapterId === chapterId))

export interface ChapterPageProps {
  storyId: ID
  chapter: LineChapter
  outline: Outline
  hub: HubState
  session: HelperSession
  run: HelperRun | null
  tree: TreeNode[]
  labels: Map<string, string>
  starter: Chapter | null
  /** Scenes of this chapter whose cards say nothing yet. */
  empty: ID[]
  drift: HubDrift[]
  /** The page Build with AI was opened from (its Back link), kept as Adam zooms in and out. */
  back?: Back
}

export function ChapterPage(p: ChapterPageProps): React.JSX.Element {
  const { storyId, chapter, hub, run, empty, back } = p
  const id = useId()
  const worldId = useApp((s) => s.world?.id)
  const progress = useChapterWriter((s) => (s.progress?.chapterId === chapter.id ? s.progress : null))
  const count = useOutlineHelper((st) => chapterSceneCount(st.sessions[chapterHelperKey(worldId, storyId, chapter.id)]))
  const busy = runBusy(run)
  const writeOpen = hub.panel?.chapterId === chapter.id && hub.panel.kind === 'write'
  const act = chapter.actId ? (p.outline.acts ?? []).find((a) => a.id === chapter.actId) : null
  const driftBy = useMemo(() => new Map(p.drift.map((d) => [d.sceneId, d])), [p.drift])
  const lit = hub.lit && Date.now() - hub.lit.at < 6000 ? new Set(hub.lit.ids) : null
  // The story line's suggestions for this chapter (Add scenes, Fill in the empty cards) arrive here, under its scenes.
  const nodes = run ? shownNodes(run, p.tree) : []
  const batch = run && placedIn(run, chapter.id) ? run : null
  const settled = !!batch && !busy && nodes.length > 0 && nodes.every((n) => !!batch.decisions[n.key])
  // This page, for What the AI saw's Back.
  const here: Back = { view: chapterView(storyId, chapter.id, { back }), label: `Back to ${chapterName(chapter)}` }
  const toggleWrite = (): void => openPanel(storyId, chapter.id, writeOpen ? null : 'write')
  const cardOpen = (): void => {
    requestChapterCardFocus()
    useApp.getState().openChapterCard(chapter.id)
  }

  return (
    <div className="build-zoom" data-zoom="chapter" data-chapter-page={chapter.id}>
      <Trail steps={trailOf(storyId, chapter, null, back)} />
      <header className="zoom-head">
        <div className="min-w-0 flex-1">
          <p className="zoom-k" data-chapter-meta>
            {act ? `Act ${chapter.actNo}${shownTitle(act.title) ? ` · ${shownTitle(act.title)}` : ''} · ` : ''}
            {chapterMeta(chapter)}
          </p>
          <h2 className="zoom-t">{chapterName(chapter)}</h2>
        </div>
        <div className="zoom-acts">
          {chapter.scenes.length ? (
            <Button
              variant={chapter.words === 0 || progress ? 'primary' : 'secondary'}
              icon={<PenLine size={14} />}
              aria-expanded={writeOpen}
              onClick={toggleWrite}
              data-write-chapter-btn={chapter.id}
              title={progress ? 'The AI is writing this chapter: see how it is going' : 'Write the whole chapter with AI: its plan first, for you to read, then every scene'}
            >
              {progress ? `Writing · ${writeStep(progress.stage).words.replace(/^step /, '')}` : 'Write this chapter'}
            </Button>
          ) : null}
          <button type="button" className="hub-link" onClick={cardOpen} title="What this chapter’s scenes share: who, where, when, its mood and notes for the AI">
            <Layers size={13} aria-hidden /> Chapter card
          </button>
        </div>
      </header>

      {writeOpen ? (
        <div className="build-panel-wrap">
          <WritePanel storyId={storyId} chapter={chapter} />
        </div>
      ) : null}

      <div className="zoom-fields">
        <ChapterGoal chapter={chapter} />
        <ChapterSize storyId={storyId} chapter={chapter} />
      </div>

      <section aria-labelledby={`${id}-scenes`} className="zoom-sec" data-chapter-scenes>
        <h3 id={`${id}-scenes`} className="zoom-sec-t">
          Scenes
        </h3>
        {chapter.scenes.length ? (
          <div className="zoom-scenes">
            {chapter.scenes.map((s) => (
              <SceneRow
                key={s.id}
                storyId={storyId}
                scene={s}
                chapterNo={chapter.no}
                tool={hub.tool?.sceneId === s.id ? hub.tool.kind : null}
                lit={!!lit?.has(s.id)}
                emptyCard={empty.includes(s.id)}
                back={back}
                note={
                  driftBy.has(s.id) ? (
                    <p className={cn('hub-drift-note is-inline', lit?.has(s.id) && 'is-lit')} data-drift-note={s.id}>
                      <span className="hub-drift-label">{driftBy.get(s.id)!.label}:</span> {driftBy.get(s.id)!.text}
                    </p>
                  ) : null
                }
              />
            ))}
          </div>
        ) : (
          <p className="zoom-none">No scenes yet. Plan them with AI below, or add them yourself in the binder.</p>
        )}
        {batch ? (
          <div className="hub-line-batch" data-batch="chapter" data-settled={settled || undefined}>
            <BatchHead storyId={storyId} session={p.session} run={batch} tree={p.tree} starter={p.starter} backLabel={here} outline={p.outline} />
            {settled ? null : nodes.length ? (
              <div role="region" aria-label="Suggestions">
                <LineSuggestions storyId={storyId} run={batch} tree={p.tree} labels={p.labels} />
              </div>
            ) : busy ? (
              <WaitingRows />
            ) : null}
          </div>
        ) : null}
      </section>

      <ChapterPlanPanel
        storyId={storyId}
        chapter={chapter}
        more={
          <>
            {chapter.scenes.length ? (
              <Button
                icon={<Plus size={14} className="text-ai" />}
                disabled={busy}
                onClick={() => void addScenesTo(storyId, chapter, { count })}
                data-add-scenes={chapter.id}
                title={`Suggest more scenes for ${chapterName(chapter)}, after its last scene${count ? ` (${count === 1 ? '1 scene' : `${count} scenes`}, as set above)` : ''}`}
              >
                Add scenes
              </Button>
            ) : null}
            {empty.length ? (
              <Button
                icon={<SquarePen size={14} className="text-ai" />}
                disabled={busy}
                onClick={() => void fillCardsIn(storyId, chapter, empty)}
                data-fill-cards={chapter.id}
                title="Plan what happens in the scenes whose cards are empty, from the story so far. Nothing a card already says changes."
              >
                {empty.length === 1 ? 'Fill in 1 empty card' : `Fill in ${empty.length} empty cards`}
              </Button>
            ) : null}
          </>
        }
      />
    </div>
  )
}

// ---------- A scene's page ----------

/** The scene's card as it is now, and the codex's names for who and where; read again as they change. */
function useSceneCard(sceneId: ID): { card: SceneCard | null; names: Map<ID, string> } {
  const outlineRev = useApp((s) => s.outlineRev)
  const briefingRev = useApp((s) => s.briefingRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const [card, setCard] = useState<{ id: ID; card: SceneCard } | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  useEffect(() => {
    let live = true
    api
      .getScene(sceneId)
      .then((sc) => live && setCard({ id: sceneId, card: { ...emptySceneCard(), ...sc.card } }))
      .catch(() => live && setCard({ id: sceneId, card: emptySceneCard() }))
    return () => {
      live = false
    }
  }, [sceneId, outlineRev, briefingRev])
  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [entriesRev])
  const names = useMemo(() => new Map(entries.map((e) => [e.id, e.name])), [entries])
  return { card: card?.id === sceneId ? card.card : null, names }
}

export function ScenePage({
  storyId,
  chapter,
  scene,
  hub,
  back
}: {
  storyId: ID
  chapter: LineChapter
  scene: LineScene
  hub: HubState
  back?: Back
}): React.JSX.Element {
  const tool = hub.tool?.sceneId === scene.id ? hub.tool.kind : null
  const t = useSceneTools(storyId, scene.id, tool)
  const { card, names } = useSceneCard(scene.id)
  const written = scene.words > 0
  const empty = card ? cardIsEmpty(card) : false
  const title = shownTitle(scene.title) || `Scene ${scene.no}`
  const open = (): void => useApp.getState().selectScene(scene.id, storyId)
  const who = card ? [card.povId, ...card.presentIds.filter((x) => x !== card.povId)].flatMap((x) => (x && names.get(x) ? [names.get(x)!] : [])) : []
  const where = card?.locationId ? (names.get(card.locationId) ?? '') : ''
  const lines: [string, string][] = card
    ? (
        [
          ['When', card.when],
          ['Where', where],
          ['Who', who.join(', ')],
          ['What happens', card.goal],
          ['What stands in the way', card.conflict],
          ['How it ends', card.outcome]
        ] as [string, string][]
      ).filter(([, v]) => v.trim())
    : []
  const beats = card ? card.beats.map((b) => b.trim()).filter(Boolean) : []

  return (
    <div className="build-zoom" data-zoom="scene" data-scene-page={scene.id}>
      <Trail steps={trailOf(storyId, chapter, scene, back)} />
      <header className="zoom-head">
        <div className="min-w-0 flex-1">
          <p className="zoom-k">
            {chapterName(chapter)} · Scene {scene.no} · {written ? `written · ${scene.words.toLocaleString('en-GB')} words` : 'not written yet'}
          </p>
          <h2 className="zoom-t">{title}</h2>
        </div>
        <div className="zoom-acts">
          {/* The main button while there is nothing written, as on the chapter's page; once written, Open the scene is the way on. */}
          <Button
            variant={written ? 'secondary' : 'primary'}
            icon={<PenLine size={14} />}
            onClick={() => writeScene(storyId, scene.id)}
            data-scene-tool="write"
            title={written ? 'Open this scene and write a draft from its card. It asks first whether to replace what is there or add below.' : 'Open this scene and write a draft of it from its card'}
          >
            Write it
          </Button>
          <button type="button" className="hub-link" onClick={open} data-scene-open title="Open this scene on the writing page">
            <BookOpen size={13} aria-hidden /> Open the scene
          </button>
        </div>
      </header>

      <section className="zoom-card" aria-label="Scene card" data-scene-card-summary={scene.id} aria-busy={!card || undefined}>
        {!card ? (
          <p className="zoom-none">&nbsp;</p>
        ) : empty ? (
          <p className="zoom-none">Nothing on its card yet. Let the AI fill it, ask for three ideas, or answer a few questions.</p>
        ) : (
          <>
            <dl className="zoom-card-lines">
              {lines.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {beats.length ? (
              <div>
                <p className="zoom-card-k">Beats</p>
                <ol className="zoom-card-beats">
                  {beats.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        )}
      </section>

      <div className="zoom-tools" role="group" aria-label="Build this scene with AI">
        <Button variant={tool === 'ideas' ? 'secondary' : 'ghost'} icon={<Lightbulb size={14} className="text-ai" />} aria-expanded={tool === 'ideas'} onClick={() => t.toggle('ideas')} data-scene-tool="ideas" title="Three directions for this scene, from the plan, the open threads and the story so far">
          Ideas
        </Button>
        <Button
          variant={tool === 'interview' ? 'secondary' : 'ghost'}
          icon={<MessageCircleQuestion size={14} className="text-ai" />}
          aria-expanded={tool === 'interview'}
          onClick={() => t.toggle('interview')}
          data-scene-tool="interview"
          title="A few short questions about what this scene’s card doesn’t say yet, then its empty parts filled from your answers"
        >
          Interview me
        </Button>
        {t.filling ? (
          <FillingNow onStop={t.stopFill} />
        ) : (
          <Button variant="ghost" icon={<SquarePen size={14} className="text-ai" />} onClick={t.fill} data-scene-tool="fill" title="Plan this scene’s card from the story so far. Only its empty parts are filled; Undo takes them off.">
            Fill the card
          </Button>
        )}
      </div>
      <SceneToolOpen storyId={storyId} sceneId={scene.id} tool={tool} interview={t.interview} />
    </div>
  )
}
