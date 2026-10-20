// Plan this chapter, inline in its row of Build with AI's story line (2026-10-20; the chapter planner's page before,
// features/outline/ChapterPlanner.tsx): the chapter's goal (saved to the chapter as Adam types), Interview me (a few short
// questions about what the chapter and the plan around it don't say yet) or Just suggest scenes, then the chapter's
// scene cards as suggestions in its own session (helperStore.suggestChapter), each kept into the chapter, changed or
// discarded, with Undo. A goal the AI gives goes to the chapter only while it has none. Once scenes are kept, Write this
// chapter is a click away.

import { useEffect, useId, useMemo, useState } from 'react'
import type { ID } from '@shared/types'
import { Check, MessageCircleQuestion, PenLine, Sparkles, Square, X } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { ProblemNotice } from '@/features/builder/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { StoryBuildLine } from '@/features/worldBuilder/StoryBuildLine'
import { chapterHelperKey, checkKept, dismissProblem, keepSuggestions, stopOutline, treeOf, useOutlineHelper } from '@/features/outline/helperStore'
import { EarlierSuggestions } from '@/features/outline/EarlierSuggestions'
import { PlanInterview, usePlanSession } from '@/features/outline/PlanInterview'
import { lastChapterAnswers, noteChapterStory, planChapter, startPlanInterview } from '@/features/outline/planInterviewStore'
import { countNodes, totalOf, withoutGone } from '@/features/outline/tree'
import { chapterName, suggestionLabels, type LineChapter } from './hubLogic'
import { HubStatus } from './HubStatus'
import { LineSuggestions, WaitingRows } from './LineSuggestions'
import { openPanel } from './hubStore'

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

export function ChapterPlanPanel({ storyId, chapter }: { storyId: ID; chapter: LineChapter }): React.JSX.Element {
  const id = useId()
  const worldId = useApp((s) => s.world?.id)
  const session = useOutlineHelper((st) => st.sessions[chapterHelperKey(worldId, storyId, chapter.id)])
  const target = useMemo(() => ({ kind: 'chapter' as const, chapterId: chapter.id }), [chapter.id])
  const interview = usePlanSession(target)
  const run = session?.run ?? null
  const running = run?.status === 'running'
  const shown = useMemo(() => (run && session?.gone.length ? { ...run, decisions: withoutGone(run.decisions, session.gone) } : run), [run, session?.gone])
  const tree = useMemo(() => (run ? treeOf(run) : []), [run])
  const scenes = useMemo(() => tree[0]?.children ?? [], [tree])
  const open = shown ? totalOf(countNodes(scenes, shown.decisions, 'open')) : 0
  const kept = shown ? totalOf(countNodes(scenes, shown.decisions, 'kept')) : 0
  const ended = !!run && !running
  const nothing = ended && scenes.length === 0

  // What was kept is looked for again each time it opens; the interview's answers know their story.
  useEffect(() => {
    noteChapterStory(chapter.id, storyId)
    void checkKept(storyId, chapter.id)
  }, [storyId, chapter.id])

  // The goal is the chapter's own: changes here are saved to it. One the AI gives it shows here too.
  const [goal, setGoal] = useState(chapter.goal)
  const [saved, setSaved] = useState(chapter.goal)
  if (chapter.goal !== saved) {
    setSaved(chapter.goal)
    if (goal === saved) setGoal(chapter.goal)
  }
  const autosave = useAutosave<string>(
    async (g) => {
      await api.updateChapter(chapter.id, { goal: g })
      setSaved(g)
      useApp.getState().bumpOutline()
    },
    { what: 'the chapter’s goal' }
  )

  // Named where they go: after the chapter's scenes that this batch didn't put there.
  const labels = useMemo(() => {
    if (!shown) return new Map<string, string>()
    const keptIds = new Set(Object.values(shown.decisions).flatMap((d) => (d.status === 'kept' ? [d.id] : [])))
    const before = chapter.scenes.filter((s) => !keptIds.has(s.id)).length
    return suggestionLabels(scenes, shown.decisions, { acts: 0, chapters: 0, lead: { chapterNo: chapter.no, scenes: before } })
  }, [shown, scenes, chapter.scenes, chapter.no])

  const suggest = (): void => void planChapter(chapter.id, lastChapterAnswers(chapter.id))
  const arrived = scenes.length
  return (
    <section aria-labelledby={`${id}-t`} className="build-panel" data-chapter-plan={chapter.id}>
      <header className="build-panel-head">
        <div className="min-w-0 flex-1">
          <p className="build-panel-k">Plan this chapter</p>
          <h3 id={`${id}-t`} className="build-panel-t">
            {chapterName(chapter)}
          </h3>
        </div>
        <button type="button" className="build-panel-x" onClick={() => openPanel(storyId, chapter.id, null)} aria-label="Close Plan this chapter" title="Close. Anything suggested stays here for when you come back.">
          <X size={14} />
        </button>
      </header>
      <p className="build-panel-s">
        Answer a few short questions about this chapter, or just ask for scenes. The AI gives it a goal if it has none, and suggests scene cards to keep, change or
        discard.
      </p>

      <div className="build-field">
        <div className="flex items-end justify-between gap-2">
          <label htmlFor={`${id}-goal`} className="hub-label">
            What the chapter achieves
          </label>
          <SaveNote status={autosave.status} error={autosave.error} />
        </div>
        <AutoTextarea
          id={`${id}-goal`}
          value={goal}
          minRows={2}
          maxRows={8}
          placeholder="The chapter’s goal: what changes by its end"
          className="hub-box"
          onChange={(e) => {
            setGoal(e.target.value)
            autosave.schedule(e.target.value)
          }}
          onBlur={() => void autosave.flush()}
        />
      </div>

      <PlanInterview target={target} />

      {running ? (
        <div className="hub-go">
          <HubStatus text={run.retrying ?? (arrived ? `Suggesting scene cards… ${plural(arrived, 'scene')} so far` : 'Suggesting scene cards…')} size={22} />
          <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => stopOutline(storyId, chapter.id)} title="Stop. What has arrived stays, to keep or discard.">
            Stop
          </Button>
        </div>
      ) : interview ? null : (
        <div className="build-panel-row">
          <Button variant="ai" icon={<MessageCircleQuestion size={14} />} onClick={() => startPlanInterview(target)} data-interview-chapter>
            {run ? 'Interview me again' : 'Interview me'}
          </Button>
          <Button icon={<Sparkles size={14} className="text-ai" />} onClick={suggest} title="Suggest scene cards from the chapter and the plan around it" data-suggest-scenes>
            {run ? 'Suggest again' : 'Just suggest scenes'}
          </Button>
        </div>
      )}

      {session?.problem ? (
        <div>
          <ProblemNotice message={session.problem.message} code={session.problem.code} onRetry={run ? undefined : suggest} />
          <button type="button" className="hub-link mt-1" onClick={() => dismissProblem(storyId, chapter.id)}>
            Close
          </button>
        </div>
      ) : null}
      {ended && run.cutOff && !nothing ? <Notice>The answer reached its length limit, so the scene cards stop early. Keep what is here, or suggest again.</Notice> : null}
      {nothing && run.status !== 'error' ? (
        <Notice
          action={
            <Button size="sm" onClick={suggest}>
              Try again
            </Button>
          }
        >
          {run.text.trim() ? 'The AI’s answer didn’t come as scene cards, so there is nothing to keep. Please try again.' : 'Nothing arrived before it stopped, so there is nothing to keep.'}
        </Notice>
      ) : null}

      {shown && (arrived || running) ? (
        <div className="hub-line-batch" data-chapter-batch>
          {ended && arrived ? (
            <div className="hub-batch-line">
              <p className="hub-batch-t" role="status">
                {open ? `${plural(open, 'scene card')} to keep, change or discard${kept ? ` · ${kept} kept` : ''}` : kept ? `All decided · ${kept} kept` : 'All decided'}
              </p>
              {open ? (
                <Button size="sm" icon={<Check size={13} />} onClick={() => void keepSuggestions(storyId, 'all', chapter.id)} title="Put every scene card here you haven’t discarded into the chapter">
                  Keep all
                </Button>
              ) : null}
            </div>
          ) : null}
          {arrived ? <LineSuggestions storyId={storyId} run={shown} tree={tree} labels={labels} chapterId={chapter.id} /> : <WaitingRows />}
        </div>
      ) : null}

      {kept > 0 && !running ? (
        <div className="build-panel-row" data-write-chapter-row>
          <Button variant="primary" size="sm" icon={<PenLine size={13} />} onClick={() => openPanel(storyId, chapter.id, 'write')} title="Write the whole chapter with AI, from its scene cards">
            Write this chapter
          </Button>
          <span className="hub-go-s">{kept === 1 ? 'Its kept scene is in the story.' : `Its ${kept} kept scenes are in the story.`}</span>
        </div>
      ) : null}
      <StoryBuildLine storyId={storyId} />
      <EarlierSuggestions storyId={storyId} chapterId={chapter.id} className="mt-2 pt-3" />
    </section>
  )
}
