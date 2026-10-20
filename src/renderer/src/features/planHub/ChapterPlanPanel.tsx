// Plan with AI, on a chapter's own page in Build with AI (Option A, "Zoom in", 2026-10-20; inline in the chapter's row of
// the story line before, and the chapter planner's page before that, features/outline/ChapterPlanner.tsx): Interview me
// (a few short questions about what the chapter and the plan around it don't say yet) or Suggest scenes, then the
// chapter's scene cards as suggestions in its own session (helperStore.suggestChapter), each kept into the chapter,
// changed or discarded, with Undo. A goal the AI gives goes to the chapter only while it has none. Beside them, what the
// page passes in (`more`: Add scenes, Fill in the empty cards). Once scenes are kept, Write this chapter is a click away.
// The page shows the chapter's goal (ChapterGoal, saved to the chapter as Adam types) and how many scenes and how long
// (ChapterSize: Auto or a number; the length is its chapter card's target, so Write this chapter and every draft go by
// it) above it.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChapterCard, ID } from '@shared/types'
import { CHAPTER_PLAN_SCENES } from '@shared/contracts/outline'
import { CHAPTER_TARGET_LIMITS, chapterShare } from '@shared/lengths'
import { Check, MessageCircleQuestion, PenLine, Sparkles, Square } from '@/components/ui/icons'
import { Button, Notice, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { ProblemNotice } from '@/features/builder/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { StoryBuildLine } from '@/features/worldBuilder/StoryBuildLine'
import {
  chapterHelperKey,
  chapterSceneCount,
  checkKept,
  dismissProblem,
  keepSuggestions,
  setChapterSceneCount,
  stopOutline,
  treeOf,
  useOutlineHelper
} from '@/features/outline/helperStore'
import { WordTargetInput } from '@/features/inspector/WordTargetInput'
import { usePrefs } from '@/features/style/prefsStore'
import { announceChapterCard, chapterCardShown } from '@/features/chapterCard/chapterCardEvents'
import { EarlierSuggestions } from '@/features/outline/EarlierSuggestions'
import { PlanInterview, usePlanSession } from '@/features/outline/PlanInterview'
import { lastChapterAnswers, noteChapterStory, planChapter, startPlanInterview } from '@/features/outline/planInterviewStore'
import { countNodes, totalOf, withoutGone } from '@/features/outline/tree'
import { suggestionLabels, type LineChapter } from './hubLogic'
import { HubStatus } from './HubStatus'
import { LineSuggestions, WaitingRows } from './LineSuggestions'
import { openPanel } from './hubStore'

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`

export function ChapterPlanPanel({ storyId, chapter, more }: { storyId: ID; chapter: LineChapter; more?: React.ReactNode }): React.JSX.Element {
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
          <h3 id={`${id}-t`} className="build-panel-t">
            Plan with AI
          </h3>
          <p className="build-panel-s mt-1">
            {chapter.scenes.length
              ? 'Answer a few short questions about this chapter, ask for its scene cards, add scenes after its last one, or fill in the cards that say nothing yet. Everything the AI suggests arrives here, to keep, change or discard.'
              : 'Answer a few short questions about this chapter, or just ask for its scenes. The AI gives it a goal if it has none, and suggests scene cards to keep, change or discard.'}
          </p>
        </div>
      </header>

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
          <Button icon={<Sparkles size={14} className="text-ai" />} onClick={suggest} title="Suggest scene cards for this chapter from its goal and the plan around it" data-suggest-scenes>
            {run ? 'Suggest again' : 'Suggest scenes'}
          </Button>
          {more}
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

/** The chapter's goal, saved to the chapter as Adam types; one the AI gives it shows here too. */
export function ChapterGoal({ chapter }: { chapter: LineChapter }): React.JSX.Element {
  const id = useId()
  const [goal, setGoal] = useState(chapter.goal)
  const [saved, setSaved] = useState(chapter.goal)
  if (chapter.goal !== saved) {
    setSaved(chapter.goal)
    if (goal === saved) setGoal(chapter.goal)
  }
  // `saved` follows the chapter as read (the outline reloads after this write): set here, the next render would see the
  // older chapter still on screen as a change from elsewhere and put it back over what Adam typed (chat truth R7).
  const autosave = useAutosave<string>(
    async (g) => {
      await api.updateChapter(chapter.id, { goal: g })
      useApp.getState().bumpOutline()
    },
    { what: 'the chapter’s goal' }
  )
  return (
    <div className="build-field" data-chapter-goal>
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
  )
}

/** "Auto", or 1 to 12 scenes. */
const COUNT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  ...Array.from({ length: CHAPTER_PLAN_SCENES.max - CHAPTER_PLAN_SCENES.min + 1 }, (_, i) => {
    const n = CHAPTER_PLAN_SCENES.min + i
    return { value: String(n), label: plural(n, 'scene') }
  })
]

/**
 * How many scenes to suggest (Auto: as many as the chapter needs) and the chapter's length in words (Auto: the default in
 * Settings › Writing, else the AI picks). The length is the chapter card's target, saved as Adam types, so Write this
 * chapter and every draft in it go by it: its scenes on Auto share it out.
 */
export function ChapterSize({ storyId, chapter }: { storyId: ID; chapter: LineChapter }): React.JSX.Element {
  const id = useId()
  const worldId = useApp((s) => s.world?.id)
  const count = useOutlineHelper((st) => chapterSceneCount(st.sessions[chapterHelperKey(worldId, storyId, chapter.id)]))
  const running = useOutlineHelper((st) => st.sessions[chapterHelperKey(worldId, storyId, chapter.id)]?.run?.status === 'running')
  const fallback = usePrefs((s) => s.prefs?.chapterLength ?? null)
  // The chapter card's target; undefined until it is read.
  const [words, setWords] = useState<number | null | undefined>(undefined)
  /** A length Adam typed that isn't written yet: a read of the card meanwhile doesn't put the older one back on screen. */
  const typed = useRef<number | null | undefined>(undefined)
  const cardsRev = useApp((s) => s.chapterCardsRev)
  useEffect(() => {
    let live = true
    api
      .getChapterCard(chapter.id)
      .then((c) => live && typed.current === undefined && setWords(c.totalWords ?? null))
      .catch(() => live && setWords(null))
    return () => {
      live = false
    }
  }, [chapter.id, cardsRev])
  const autosave = useAutosave<number | null>(
    async (n) => {
      try {
        // The card as it is now, with only its target changed.
        const before = await api.getChapterCard(chapter.id)
        const next: ChapterCard = { ...before }
        if (n == null) delete next.totalWords
        else next.totalWords = n
        const saved = await api.updateChapterCard(chapter.id, next)
        if (typed.current === n) typed.current = undefined
        // Written on a later try, after the screen showed a length from elsewhere: it shows what is on disk.
        if (typed.current === undefined) setWords(saved.card.totalWords ?? null)
        chapterCardShown(chapter.id, saved.card)
        announceChapterCard(chapter.id, before, saved)
      } catch (e) {
        // Not written: a length set elsewhere meanwhile (the chat's) shows again, rather than waiting behind this one.
        if (typed.current === n) typed.current = undefined
        throw e
      }
    },
    { what: 'the chapter’s length' }
  )
  const target = words ?? fallback
  const scenesAfter = chapter.scenes.length + (count ?? 0)
  const each = target != null && count ? chapterShare(target, Array.from({ length: Math.max(0, scenesAfter - 1) }, () => null)) : null
  const hint =
    target == null
      ? 'Auto: the AI picks how long each scene is.'
      : each != null
        ? `About ${(Math.round(each / 50) * 50).toLocaleString('en-GB')} words a scene${words == null ? ', from your default in Settings › Writing' : ''}.`
        : words == null
          ? `Auto: ${target.toLocaleString('en-GB')} words, your default in Settings › Writing.`
          : 'Its scenes share this out, and Write this chapter goes by it.'
  return (
    <div className="build-panel-row" data-chapter-size>
      <div className="build-field">
        <label htmlFor={`${id}-count`} className="hub-label">
          How many scenes
        </label>
        <Select
          id={`${id}-count`}
          value={count ? String(count) : 'auto'}
          onChange={(v) => setChapterSceneCount(storyId, chapter.id, v && v !== 'auto' ? Number(v) : null)}
          options={COUNT_OPTIONS}
          className={running ? 'pointer-events-none w-[128px] opacity-60' : 'w-[128px]'}
        />
      </div>
      <div className="build-field">
        <div className="flex items-end justify-between gap-2">
          <label htmlFor={`${id}-words`} className="hub-label">
            Length of the chapter
          </label>
          <SaveNote status={autosave.status} error={autosave.error} />
        </div>
        <WordTargetInput
          id={`${id}-words`}
          value={words ?? null}
          limits={CHAPTER_TARGET_LIMITS}
          placeholder={fallback != null ? fallback.toLocaleString('en-GB') : 'Auto'}
          describedBy={`${id}-size-hint`}
          onChange={(n) => {
            typed.current = n
            setWords(n)
            autosave.schedule(n)
          }}
        />
      </div>
      <p id={`${id}-size-hint`} className="hub-go-s basis-full" data-size-hint>
        {words === undefined ? ' ' : hint}
      </p>
    </div>
  )
}
