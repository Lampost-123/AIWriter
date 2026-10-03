// Planning one chapter (View 'outline' with a chapterId), opened from the chapter's menu in the binder:
// "Interview me about this chapter". The AI asks a few short questions about what the chapter and the
// outline around it don't say yet; then it gives the chapter a goal (if it has none) and suggests scene
// cards that Adam keeps, edits or discards one by one, as on the outline helper's page (the same
// suggestions, in a session of their own: helperStore.suggestChapter). Nothing is added without a click.
import { Check, ListTree, MessageCircleQuestion, Sparkles, Square } from '@/components/ui/icons'
import { useEffect, useMemo, useState } from 'react'
import type { Chapter } from '@shared/types'
import { Button, EmptyState, Notice } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { useOutline } from '@/features/binder/outlineStore'
import { ProblemNotice, WritingStatus } from '@/features/builder/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { chapterHelperKey, checkKept, stopOutline, treeOf, useOutlineHelper } from './helperStore'
import { PlanInterview, usePlanSession } from './PlanInterview'
import { lastChapterAnswers, noteChapterStory, planChapter, startPlanInterview } from './planInterviewStore'
import { Suggestions } from './Suggestions'
import { countNodes, totalOf, withoutGone } from './tree'

export function ChapterPlanner({ storyId, chapterId }: { storyId: string; chapterId: string }): React.JSX.Element {
  const { outline } = useOutline()
  const shape = outline?.story.id === storyId ? outline : null
  const chapter = shape?.chapters.find((c) => c.id === chapterId) ?? null
  if (!shape) return <div className="h-full" />
  if (!chapter) {
    return (
      <div className="flex h-full items-start justify-center pt-[16vh]">
        <EmptyState
          icon={<ListTree size={20} />}
          title="This chapter isn't here any more"
          actions={<Button onClick={() => useApp.getState().navigate({ kind: 'write' })}>Back to writing</Button>}
        >
          It may have been deleted. Chapters you delete stay in Settings › Recently deleted for 30 days.
        </EmptyState>
      </div>
    )
  }
  return <Planner storyId={storyId} chapter={chapter} />
}

function Planner({ storyId, chapter }: { storyId: string; chapter: Chapter }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const session = useOutlineHelper((st) => st.sessions[chapterHelperKey(worldId, storyId, chapter.id)])
  const target = useMemo(() => ({ kind: 'chapter' as const, chapterId: chapter.id }), [chapter.id])
  const interview = usePlanSession(target)
  const run = session?.run ?? null
  const running = run?.status === 'running'
  const shown = useMemo(
    () => (run && session?.gone.length ? { ...run, decisions: withoutGone(run.decisions, session.gone) } : run),
    [run, session?.gone]
  )
  const tree = useMemo(() => (run ? treeOf(run) : []), [run])
  const scenes = tree[0]?.children ?? []
  const arrived = scenes.length
  const open = shown ? totalOf(countNodes(scenes, shown.decisions, 'open')) : 0
  const ended = !!run && !running
  const nothingRead = ended && arrived === 0

  // What was kept is looked for again each time the page opens.
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

  const suggest = (): void => void planChapter(chapter.id, lastChapterAnswers(chapter.id))
  const title = chapter.title.trim() || 'Untitled chapter'
  const status = running
    ? (run.retrying ?? (arrived ? `Suggesting scene cards… ${plural(arrived, 'scene')} so far` : 'Suggesting scene cards…'))
    : null
  const doneLine =
    ended && !nothingRead
      ? run.status === 'complete'
        ? `Here ${arrived === 1 ? 'is a scene card' : `are ${arrived} scene cards`} for the chapter. Keep what you like.`
        : run.status === 'stopped'
          ? `Stopped. What had arrived is below: ${plural(arrived, 'scene')}.`
          : `It stopped part way. What had arrived is below: ${plural(arrived, 'scene')}.`
      : null
  const whatTheAISaw = run?.generationId
    ? () =>
        useApp.getState().navigate({
          kind: 'generation',
          generationId: run.generationId!,
          back: { view: { kind: 'outline', storyId, chapterId: chapter.id }, label: 'Back to planning the chapter', what: 'this plan' }
        })
    : null

  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      {/* Room at the foot, so the end of the page scrolls clear of the Undo toasts in the corner. */}
      <div className="mx-auto w-full max-w-[720px] px-8 pb-48 pt-10">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Sparkles size={12} className="text-ai" aria-hidden />
          Plan a chapter
        </div>
        <h1 className="mt-1 break-words font-serif text-[26px] font-semibold leading-tight text-fg">{title}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Answer a few short questions about this chapter, in your own words. AI Write then gives it a goal, if it has none, and suggests
          scene cards to keep, change or discard. Nothing is added until you keep it.
        </p>

        <div className="mt-5 flex items-end justify-between gap-2">
          <label htmlFor="chapter-goal" className="block text-[12px] font-medium text-muted">
            Goal
          </label>
          <SaveNote status={autosave.status} error={autosave.error} />
        </div>
        <AutoTextarea
          id="chapter-goal"
          value={goal}
          minRows={2}
          maxRows={8}
          placeholder="What this chapter achieves"
          className="mt-1 font-serif text-[15px] leading-[1.6] placeholder:font-sans placeholder:text-[13.5px]"
          onChange={(e) => {
            setGoal(e.target.value)
            autosave.schedule(e.target.value)
          }}
          onBlur={() => void autosave.flush()}
        />

        <PlanInterview target={target} className="mt-5" />

        <div className="mt-4 flex h-10 items-center gap-2">
          {running ? (
            <>
              <Button
                size="lg"
                icon={<Square size={11} fill="currentColor" />}
                onClick={() => stopOutline(storyId, chapter.id)}
                title="Stop. What has arrived stays, to keep or discard."
              >
                Stop
              </Button>
              <WritingStatus text={status ?? ''} title={run.retrying ?? undefined} />
            </>
          ) : interview ? null : (
            <>
              <Button variant="primary" size="lg" icon={<MessageCircleQuestion size={15} />} onClick={() => startPlanInterview(target)}>
                {run ? 'Interview me again' : 'Interview me'}
              </Button>
              <Button
                size="lg"
                variant="ghost"
                icon={<Sparkles size={15} />}
                onClick={suggest}
                title="Suggest scene cards from the chapter and the outline around it"
              >
                {run ? 'Suggest again' : 'Just suggest scenes'}
              </Button>
            </>
          )}
        </div>

        <div className="mt-1 flex min-h-5 items-center gap-3">
          {doneLine ? (
            <p role="status" className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted animate-fade-in">
              {run?.status === 'complete' ? <Check size={13} className="shrink-0 text-success" aria-hidden /> : null}
              <span className="min-w-0">{doneLine}</span>
            </p>
          ) : null}
          {whatTheAISaw && run ? (
            <button
              type="button"
              onClick={whatTheAISaw}
              className="ml-auto shrink-0 rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              What the AI saw
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 empty:hidden">
          {session?.problem ? (
            <div className="mt-2">
              <ProblemNotice message={session.problem.message} code={session.problem.code} onRetry={run ? undefined : suggest} />
            </div>
          ) : null}
          {ended && run.cutOff && !nothingRead ? (
            <div className="mt-2">
              <Notice>The answer reached its length limit, so the scene cards stop early. Keep what is here, or suggest again.</Notice>
            </div>
          ) : null}
          {nothingRead && run.status !== 'error' ? (
            <div className="mt-2">
              <Notice
                action={
                  <Button size="sm" onClick={suggest}>
                    Try again
                  </Button>
                }
              >
                {run.text.trim()
                  ? 'The AI’s answer didn’t come as scene cards, so there is nothing to keep. Please try again.'
                  : 'Nothing arrived before it stopped, so there is nothing to keep.'}
              </Notice>
            </div>
          ) : null}
        </div>

        {shown && (arrived || running) ? (
          <Suggestions storyId={storyId} chapterId={chapter.id} run={shown} tree={tree} open={open} starter={null} />
        ) : null}
      </div>
    </div>
  )
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`
