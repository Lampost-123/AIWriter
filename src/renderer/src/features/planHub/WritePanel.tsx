// Write this chapter, inline in its row of Build with AI's story line (2026-10-20; the start dialog and the plan's
// dialog before). In turn, in the same place:
//   - before: which scenes it writes (and that words there are kept for Undo), scenes with nothing on their cards with
//     "Plan these scenes" (one after another, Stop, one Undo), and "Plan the chapter", which starts the run;
//   - step 1 of 3, the plan: what it is doing while the plan is made, then the plan to read (ChapterPlanReview, built to
//     the mock-up), with Write the chapter, Change the plan and Cancel, and about how long and what it costs;
//   - step 2 of 3, writing, and step 3 of 3, checking and fixing: what it is doing, with Stop and the report so far;
//   - after: how it ended, See the report (on the chapter card beside the page) and Undo.
// Another chapter being written says so, with the way to stop it.

import { useEffect, useId, useRef, useState } from 'react'
import type { ChapterWriterPlan, ChapterWriterReport } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import { BookOpenText, Square, Undo2, X } from '@/components/ui/icons'
import { Button, Notice, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { planScene, stopScenePlan } from '@/features/outline/scenePlanStore'
import { ChapterPlanReview } from '@/features/chapterWriter/ChapterPlanReview'
import { LIMIT_WORDS, planWords, reportHeading } from '@/features/chapterWriter/chapterWriterLogic'
import { showReport, startChapterWriter, stopChapterWriter, undoChapterWriter, useChapterWriter } from '@/features/chapterWriter/chapterWriterStore'
import { chapterName, type LineChapter } from './hubLogic'
import { writeStep } from './buildLogic'
import { HubStatus } from './HubStatus'
import { openPanel } from './hubStore'

export function WritePanel({ storyId, chapter }: { storyId: ID; chapter: LineChapter }): React.JSX.Element {
  const id = useId()
  const progress = useChapterWriter((s) => s.progress)
  const rev = useChapterWriter((s) => s.reportRev)
  const outlineRev = useApp((s) => s.outlineRev)
  const mine = progress?.chapterId === chapter.id ? progress : null
  const other = progress && !mine ? progress : null
  const [plan, setPlan] = useState<ChapterWriterPlan | null>(null)
  const [report, setReport] = useState<ChapterWriterReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  // Plan these scenes: which one it is planning, and whether Stop was pressed.
  const [planning, setPlanning] = useState<{ at: number; of: number; sceneId: ID } | null>(null)
  const stopped = useRef(false)
  const [rerun, setRerun] = useState(0)
  const name = chapterName(chapter)

  // What the chapter's scenes are ready for, and how the last run went: read again as the story changes.
  useEffect(() => {
    let live = true
    api
      .chapterWriterPlan(chapter.id)
      .then((p) => live && setPlan(p))
      .catch((e) => live && setError(plainReason(e)))
    api
      .getChapterWriterReport(chapter.id)
      .then((r) => live && setReport(r))
      .catch(() => live && setReport(null))
    return () => {
      live = false
    }
  }, [chapter.id, rev, outlineRev, rerun])

  const start = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    try {
      await startChapterWriter(chapter.id)
    } catch (e) {
      setError(plainReason(e))
    } finally {
      setStarting(false)
    }
  }

  const stop = async (): Promise<void> => {
    setStopping(true)
    try {
      await stopChapterWriter()
    } finally {
      setStopping(false)
    }
  }

  /** Plan these scenes: the scenes with nothing on their cards are planned one after another, with one Undo. */
  const planMissing = async (): Promise<void> => {
    if (!plan || planning) return
    const ids = plan.scenes.filter((s) => !s.ready).map((s) => s.sceneId)
    stopped.current = false
    const undos: (() => Promise<void>)[] = []
    let failed: string | null = null
    for (let i = 0; i < ids.length && !stopped.current; i++) {
      setPlanning({ at: i + 1, of: ids.length, sceneId: ids[i] })
      const out = await planScene(ids[i], { quiet: true })
      if (out.undo) undos.push(out.undo)
      if (out.status === 'error') {
        failed = out.error ?? 'That didn’t work. Please try again.'
        break
      }
    }
    setPlanning(null)
    await flushAll()
    setRerun((n) => n + 1)
    if (undos.length)
      toast(`Planned ${undos.length === 1 ? 'a scene' : `${undos.length} scenes`} of the chapter.`, {
        action: {
          label: 'Undo',
          run: () =>
            void (async () => {
              for (const undo of undos) await undo()
              setRerun((n) => n + 1)
            })()
        }
      })
    if (failed) setError(failed)
  }

  const head = (kicker: string): React.JSX.Element => (
    <header className="build-panel-head">
      <div className="min-w-0 flex-1">
        <p className="build-panel-k">{kicker}</p>
        <h3 id={`${id}-t`} className="build-panel-t">
          {name}
        </h3>
      </div>
      <button type="button" className="build-panel-x" onClick={() => openPanel(storyId, chapter.id, null)} aria-label="Close Write this chapter" title="Close. A run goes on; the top bar says how it is going.">
        <X size={14} />
      </button>
    </header>
  )

  // Step 1 of 3, the plan to read.
  if (mine?.stage === 'review' && mine.plan) {
    return (
      <div className="build-panel is-review" data-write-panel={chapter.id} data-write-stage="review">
        <div className="build-panel-close">
          <button type="button" className="build-panel-x" onClick={() => openPanel(storyId, chapter.id, null)} aria-label="Close Write this chapter" title="Close. The plan waits for you: the top bar opens it again.">
            <X size={14} />
          </button>
        </div>
        <ChapterPlanReview runId={mine.runId} title={name} plan={mine.plan} estimate={mine.estimate} />
      </div>
    )
  }

  // While it works: the plan being made, the scenes being written, then checked and fixed.
  if (mine) {
    const step = writeStep(mine.stage)
    return (
      <section aria-labelledby={`${id}-t`} className="build-panel" data-write-panel={chapter.id} data-write-stage={mine.stage}>
        {head(`Write this chapter · ${step.words}`)}
        <ol className="cw-steps" aria-label="Steps">
          {['The plan', 'Writing', 'Checking and fixing'].map((s, i) => (
            <li key={s} className={i + 1 < step.no ? 'is-done' : i + 1 === step.no ? 'is-now' : ''} aria-current={i + 1 === step.no ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>
        <div className="hub-go">
          <HubStatus text={`${mine.note || 'Writing the chapter'}…`} size={22} />
          <Button size="sm" icon={<Square size={10} fill="currentColor" />} loading={stopping} onClick={() => void stop()} data-write-stop>
            Stop
          </Button>
        </div>
        <p className="build-panel-s">
          {mine.stage === 'planning'
            ? 'The AI reads the chapter card and each scene card, and looks up what the story’s memory says. You see the plan before anything is written.'
            : 'Its scenes can be read but not typed in until it finishes. You can leave this page: it carries on, and the top bar says how it is going.'}
        </p>
        {mine.stage !== 'planning' ? (
          <button type="button" className="hub-link" onClick={() => showReport(chapter.id)}>
            <BookOpenText size={13} aria-hidden /> The report so far
          </button>
        ) : null}
      </section>
    )
  }

  const words = plan ? planWords(plan) : null
  const ended = report && report.status !== 'running' && report.status !== 'cancelled' && !report.undone ? report : null
  return (
    <section aria-labelledby={`${id}-t`} className="build-panel" data-write-panel={chapter.id} data-write-stage="start">
      {head('Write this chapter')}
      {ended ? (
        <div className="build-panel-done" data-write-report>
          <p className="min-w-0 flex-1">
            <span className="font-medium text-fg">Last time: </span>
            {reportHeading(ended)}
          </p>
          <Button size="sm" variant="ghost" icon={<BookOpenText size={13} />} onClick={() => showReport(chapter.id)}>
            See the report
          </Button>
          <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => void undoChapterWriter(chapter.id)} title="Put the chapter back as it was before the AI wrote it">
            Undo
          </Button>
        </div>
      ) : null}
      <p className="build-panel-s">
        The AI plans the whole chapter first and shows you the plan here, to change before anything is written. Then it writes each scene to it, checks them
        against the plan and the story so far, and fixes only what it finds. {LIMIT_WORDS}
      </p>
      <div className="min-h-6" aria-live="polite" data-testid="chapter-writer-plan">
        {!plan && !error ? <p className="hub-go-s">Looking at the chapter…</p> : null}
        {plan ? (
          <ul className="cw-ready">
            {plan.scenes.map((s) => (
              <li key={s.sceneId} className={s.ready ? '' : 'is-faint'}>
                <span className="cw-ready-t">{s.label}</span>
                <span className="cw-ready-s">
                  {!s.ready
                    ? planning?.sceneId === s.sceneId
                      ? 'planning its card…'
                      : 'nothing on its card to write from yet'
                    : s.hasWords
                      ? 'has words: they will be replaced'
                      : 'empty: will be written'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {words && words.left.length ? (
        <div data-testid="chapter-writer-unplanned">
        <Notice
          action={
            planning ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  stopped.current = true
                  stopScenePlan(planning.sceneId)
                }}
              >
                Stop
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void planMissing()} data-plan-missing>
                {words.left.length === 1 ? 'Plan this scene' : 'Plan these scenes'}
              </Button>
            )
          }
        >
          {planning ? (
            <HubStatus text={`Planning scene ${planning.at} of ${planning.of}…`} size={20} />
          ) : words.left.length === 1 ? (
            'One scene has nothing on its card to write from. Plan it, and the AI writes it too.'
          ) : (
            `${words.left.length} scenes have nothing on their cards to write from. Plan them, and the AI writes them too.`
          )}
        </Notice>
        </div>
      ) : null}
      {words?.warning ? <p className="build-panel-s">{words.warning}</p> : null}
      {other ? <Notice>The AI is writing another chapter now. Wait for it to finish, or stop it from the top bar.</Notice> : null}
      {error ? (
        <p className="cw-error" role="alert">
          {error}
          {/Settings › Models/.test(error) ? (
            <button type="button" className="hub-link ml-2" onClick={() => useApp.getState().navigate({ kind: 'settings', tab: 'models' })}>
              Open Settings › Models
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="build-panel-row">
        <Button
          variant="primary"
          loading={starting}
          disabled={!plan || !words?.ready || plan.busy || !!other || !!planning}
          onClick={() => void start()}
          data-testid="chapter-writer-start"
        >
          Plan the chapter
        </Button>
        <span className="hub-go-s">Step 1 of 3. Nothing is written until you have read the plan.</span>
      </div>
    </section>
  )
}
