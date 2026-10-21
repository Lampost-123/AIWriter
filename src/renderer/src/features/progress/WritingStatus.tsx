// The top bar while the AI writes a chapter (Write this chapter) or a scene (Generate): a compact pill that says where it
// has got ("Writing Ch 3 · scene 2 of 4 · 1,240 words", "Writing “Morning Confrontation” · 640 of ~1,500 words") with a
// thin bar under it, and on a click a card with the steps, each scene, what it is doing right now and which model does
// it, the time so far and about how long is left, the cost so far, Go to the scene, Stop, and for a chapter the plan and
// the report. A card left open when it ends says how it ended and what was kept. (Adam, 2026-10-20.) The words are
// progressLogic.ts's. Nothing shows (and no room is kept) when nothing is being written.

import * as P from '@radix-ui/react-popover'
import { useEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { ArrowRight, BookOpenText, Check, ListChecks, Square, Undo2 } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { PopoverPanel, useNow } from '@/features/generate/parts'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { openScene } from '@/features/memory/openScene'
import { openChapterPlan, openChapterWriter, showReport, stopChapterWriter, undoChapterWriter, useChapterWriter } from '@/features/chapterWriter/chapterWriterStore'
import { stopDraft, useDraft } from '@/features/generate/draftRun'
import { listenForDraftSteps, useDraftSteps } from '@/features/waits/useDraftWait'
import { usePlanReview } from '@/features/planReview/store'
import { useDirector } from '@/features/director/store'
import { chapterEndWords, chapterNames, chapterView, sceneEndWords, sceneView, type ProgressView } from './progressLogic'
import './progress.css'

/** The run the card is about: a chapter's, else a Generate draft's. */
type Which = { kind: 'chapter'; runId: ID; chapterId: ID } | { kind: 'scene'; sceneId: ID }

export function WritingStatus(): React.JSX.Element | null {
  listenForDraftSteps()
  const chapter = useChapterWriter((s) => s.progress)
  const draftScene = useDraft((s) => (s.phase !== 'idle' ? s.sceneId : s.checking))
  const [open, setOpen] = useState(false)
  // What the card is about; kept while it is open after the run ends, so it can say how it ended.
  const [which, setWhich] = useState<Which | null>(null)
  const now: Which | null = chapter ? { kind: 'chapter', runId: chapter.runId, chapterId: chapter.chapterId } : draftScene ? { kind: 'scene', sceneId: draftScene } : null
  const nowKey = now ? (now.kind === 'chapter' ? `c:${now.runId}` : `s:${now.sceneId}`) : ''
  useEffect(() => {
    if (now) setWhich(now)
    else if (!open) setWhich(null)
  }, [nowKey, open])
  const shown = now ?? (open ? which : null)
  if (!shown) return null
  // The chapter plan waits for Adam: the top bar opens it again (as before), or cancels it from wherever he is (2026-10-21:
  // with the plan out of reach, nothing could end the run).
  if (shown.kind === 'chapter' && chapter?.stage === 'review') {
    return (
      <div className="flex min-w-0 shrink items-center justify-end gap-1" role="status" aria-live="polite" data-testid="chapter-writer-status">
        <button type="button" className="wp-pill" onClick={openChapterPlan} title="Read the chapter plan, change it if you like, then write.">
          <span className="wp-dot" aria-hidden />
          <span className="wp-lead">The chapter plan is ready for you</span>
        </button>
        <Button size="sm" variant="ghost" onClick={() => void stopChapterWriter()} title="Cancel the plan. Nothing in the chapter changes." data-plan-pill-cancel>
          Cancel
        </Button>
      </div>
    )
  }
  return (
    <div
      className="flex min-w-0 shrink justify-end"
      role="status"
      aria-live="polite"
      data-testid={shown.kind === 'chapter' ? 'chapter-writer-status' : 'draft-status'}
    >
      <P.Root open={open} onOpenChange={setOpen}>
        {shown.kind === 'chapter' ? <ChapterPill ended={!now} /> : <ScenePill sceneId={shown.sceneId} ended={!now} />}
        <PopoverPanel className="wp-card w-[352px] max-w-[calc(100vw-24px)] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          {shown.kind === 'chapter' ? (
            <ChapterCard chapterId={shown.chapterId} runId={shown.runId} close={() => setOpen(false)} />
          ) : (
            <SceneCard sceneId={shown.sceneId} close={() => setOpen(false)} />
          )}
        </PopoverPanel>
      </P.Root>
    </div>
  )
}

// ---------- The pill ----------

function Pill({ view, ended, endWords }: { view: ProgressView | null; ended: boolean; endWords?: string }): React.JSX.Element {
  const lead = ended ? (endWords ?? 'Finished') : (view?.lead ?? 'Writing…')
  const tail = ended ? '' : (view?.tail ?? '')
  return (
    <P.Trigger className="wp-pill" title={ended ? lead : view?.hover} aria-label={ended ? lead : `${lead}${tail ? ` · ${tail}` : ''}. Show how it is going.`}>
      <span className={cn('wp-dot', !ended && 'is-live', ended && 'is-ended')} aria-hidden />
      <span className="wp-lead">{lead}</span>
      {tail ? (
        <span className="wp-tail" aria-hidden>
          <span aria-hidden>·</span> {tail}
        </span>
      ) : null}
      {!ended && view?.fraction != null ? (
        <span className="wp-pill-bar" aria-hidden>
          <span style={{ transform: `scaleX(${view.fraction})` }} />
        </span>
      ) : null}
    </P.Trigger>
  )
}

function useChapterView(chapterId: ID, now: number): ProgressView | null {
  const progress = useChapterWriter((s) => (s.progress?.chapterId === chapterId ? s.progress : null))
  const chapters = useOutlineStore((s) => s.outline?.chapters ?? null)
  const models = useApp((s) => s.settings?.models)
  const memory = useApp((s) => s.memoryStatus)
  const step = useDraftSteps((s) => (progress?.sceneId ? (s.steps[progress.sceneId] ?? null) : null))
  if (!progress) return null
  return chapterView({ progress, chapter: chapterNames(chapters, chapterId), now, models, step, memory })
}

function ChapterPill({ ended }: { ended: boolean }): React.JSX.Element {
  const chapterId = useChapterWriter((s) => s.progress?.chapterId ?? s.last?.chapterId ?? '')
  const view = useChapterView(chapterId, Date.now())
  const last = useChapterWriter((s) => s.last)
  const end = ended && last ? chapterEndWords(last.report) : null
  return <Pill view={view} ended={ended} endWords={end ? (end.tone === 'done' ? 'Chapter written' : end.tone === 'stopped' ? 'Stopped' : 'Stopped with a problem') : undefined} />
}

function useSceneView(sceneId: ID, now: number): ProgressView | null {
  const d = useDraft()
  const title = useOutlineStore((s) => s.outline?.scenes.find((x) => x.id === sceneId)?.title ?? '')
  const step = useDraftSteps((s) => s.steps[sceneId] ?? null)
  const memory = useApp((s) => s.memoryStatus)
  const planFirst = useApp((s) => s.settings?.planFirst !== false)
  const checkNewWords = useApp((s) => s.settings?.checkNewWords !== false)
  const review = usePlanReview((s) => s.waiting.some((r) => r.sceneId === sceneId))
  const director = useDirector((s) => s.byScene[sceneId] ?? null)
  const live = d.live?.sceneId === sceneId ? d.live : null
  const going = d.sceneId === sceneId && d.phase !== 'idle'
  const checking = d.checking === sceneId
  if (!going && !checking) return null
  const last = d.last?.sceneId === sceneId ? d.last : null
  return sceneView({
    sceneId,
    sceneTitle: title,
    now,
    phase: going ? d.phase : 'idle',
    words: live?.words ?? last?.words ?? 0,
    target: live?.target ?? null,
    startedAt: live?.startedAt ?? now,
    firstWordAt: live?.firstWordAt ?? null,
    checking,
    retrying: going ? d.retrying : null,
    step: going && d.phase === 'starting' ? step : null,
    review,
    memory,
    planFirst,
    checkNewWords,
    model: live?.model ?? '',
    memoryModel: live?.memoryModel ?? '',
    stretch: director && !director.ended ? { at: director.stretch, of: director.of } : null
  })
}

function ScenePill({ sceneId, ended }: { sceneId: ID; ended: boolean }): React.JSX.Element {
  const view = useSceneView(sceneId, Date.now())
  const last = useDraft((s) => (s.last?.sceneId === sceneId ? s.last : null))
  const end = ended && last ? sceneEndWords(last) : null
  return <Pill view={view} ended={ended || !view} endWords={end ? (end.tone === 'done' ? 'Scene written' : end.tone === 'stopped' ? 'Stopped' : 'Stopped with a problem') : undefined} />
}

// ---------- The card ----------

function Steps({ view }: { view: ProgressView }): React.JSX.Element {
  return (
    <ol className="wp-steps" aria-label="Steps">
      {view.steps.map((s) => (
        <li key={s.label} className={cn(s.state === 'done' && 'is-done', s.state === 'now' && 'is-now')} aria-current={s.state === 'now' ? 'step' : undefined}>
          <span className="wp-step-t">
            {s.state === 'done' ? <Check size={11} aria-hidden /> : null}
            {s.label}
          </span>
          {!view.oneModel && s.model ? <span className="wp-step-m">{s.model}</span> : null}
        </li>
      ))}
    </ol>
  )
}

function Now({ view }: { view: ProgressView }): React.JSX.Element {
  return (
    <div className={cn('wp-now', view.retrying && 'is-retry')} data-progress-now>
      <span className="wp-dot is-live" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="wp-now-t">{view.doing}</p>
        {view.detail ? <p className="wp-now-d">{view.detail}</p> : null}
        {view.doingModel ? (
          <p className="wp-now-m" data-progress-model>
            Model: {view.doingModel}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Bar({ view }: { view: ProgressView }): React.JSX.Element {
  const facts = [view.elapsed, view.left, view.cost].filter(Boolean)
  return (
    <div className="wp-progress">
      <div
        className="wp-bar"
        role="progressbar"
        aria-label={view.barLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.fraction == null ? undefined : Math.round(view.fraction * 100)}
      >
        <span style={{ transform: `scaleX(${view.fraction ?? 0})` }} />
      </div>
      <p className="wp-bar-t">{view.barLabel}</p>
      {facts.length ? (
        <p className="wp-facts" data-progress-time>
          {facts.join(' · ')}
        </p>
      ) : null}
    </div>
  )
}

function Ended({ text, tone }: { text: string; tone: 'done' | 'stopped' | 'problem' }): React.JSX.Element {
  return (
    <p className={cn('wp-ended', `is-${tone}`)} role="status" data-progress-ended={tone}>
      {text}
    </p>
  )
}

function Head({ kicker, title }: { kicker: string; title: string }): React.JSX.Element {
  return (
    <header className="wp-head">
      <p className="wp-kicker">{kicker}</p>
      <h3 className="wp-title" title={title}>
        {title}
      </h3>
    </header>
  )
}

function ChapterCard({ chapterId, runId, close }: { chapterId: ID; runId: ID; close: () => void }): React.JSX.Element {
  const now = useNow(1000)
  const view = useChapterView(chapterId, now)
  const last = useChapterWriter((s) => (s.last?.report.runId === runId ? s.last : null))
  const storyId = useChapterWriter((s) => (s.progress?.runId === runId ? s.progress.storyId : undefined))
  const chapters = useOutlineStore((s) => s.outline?.chapters ?? null)
  const [stopping, setStopping] = useState(false)
  const names = chapterNames(chapters, chapterId)
  const title = view?.title ?? (names.name ? `${names.short} · ${names.name}` : names.short)
  const keep = useRef<ProgressView | null>(null)
  if (view) keep.current = view
  const shown = view ?? keep.current
  const end = !view && last ? chapterEndWords(last.report) : null
  return (
    <div data-progress-card="chapter">
      <Head kicker={end ? (end.tone === 'done' ? 'Write this chapter · finished' : 'Write this chapter · stopped') : 'Writing the chapter'} title={title} />
      <div className="wp-body">
        {shown ? <Steps view={shown} /> : null}
        {end ? <Ended {...end} /> : view ? <Now view={view} /> : null}
        {shown && shown.scenes.length ? (
          <ul className="wp-scenes" aria-label="Scenes">
            {shown.scenes.map((s) => (
              // Once it has ended, a scene it was still drafting was never saved: it says so.
              <li
                key={s.sceneId}
                className={cn(`is-${end && s.state === 'writing' ? 'waiting' : s.state}`, s.busy && !end && 'is-busy')}
                data-progress-scene={end && s.state === 'writing' ? 'unfinished' : s.state}
              >
                <span className="wp-scene-i" aria-hidden>
                  {s.state === 'written' ? <Check size={12} /> : <span />}
                </span>
                <span className="wp-scene-t">{s.label}</span>
                <span className="wp-scene-w">{end && s.state === 'writing' ? 'not finished' : s.state === 'written' && s.busy && !end ? `${s.words} · checking` : s.words}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {view ? <Bar view={view} /> : null}
        {shown?.oneModel ? <p className="wp-model">Model: {shown.oneModel}</p> : null}
      </div>
      <footer className="wp-foot">
        {view ? (
          <>
            {view.sceneId ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<ArrowRight size={13} />}
                title="Open the scene the AI is working on. Its words show there as each part is saved."
                onClick={() => {
                  close()
                  void openScene(view.sceneId!)
                }}
              >
                Go to the scene
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              icon={<Square size={10} fill="currentColor" />}
              loading={stopping}
              data-testid="chapter-writer-stop"
              title="Stop writing. The words written so far are kept; Undo puts the chapter back."
              onClick={() => {
                setStopping(true)
                void stopChapterWriter().finally(() => setStopping(false))
              }}
            >
              Stop
            </Button>
            <span className="wp-links">
              <button type="button" className="wp-link" onClick={() => (close(), openChapterWriter(chapterId, storyId))}>
                <ListChecks size={13} aria-hidden /> See the plan
              </button>
              {view.steps[0].state === 'done' ? (
                <button type="button" className="wp-link" onClick={() => (close(), showReport(chapterId))}>
                  <BookOpenText size={13} aria-hidden /> The report so far
                </button>
              ) : null}
            </span>
          </>
        ) : last && last.report.status !== 'cancelled' ? (
          <>
            <Button size="sm" variant="secondary" icon={<BookOpenText size={13} />} onClick={() => (close(), showReport(chapterId))}>
              See the report
            </Button>
            {!last.report.undone ? (
              <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} title="Put the chapter back as it was before the AI wrote it" onClick={() => (close(), void undoChapterWriter(chapterId))}>
                Undo
              </Button>
            ) : null}
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={close}>
            Close
          </Button>
        )}
      </footer>
    </div>
  )
}

function SceneCard({ sceneId, close }: { sceneId: ID; close: () => void }): React.JSX.Element {
  const now = useNow(1000)
  const view = useSceneView(sceneId, now)
  const phase = useDraft((s) => (s.sceneId === sceneId ? s.phase : 'idle'))
  const last = useDraft((s) => (s.last?.sceneId === sceneId ? s.last : null))
  const appScene = useApp((s) => s.sceneId)
  const keep = useRef<ProgressView | null>(null)
  if (view) keep.current = view
  const shown = view ?? keep.current
  const end = !view && last ? sceneEndWords(last) : null
  const go = (): void => {
    close()
    const app = useApp.getState()
    if (appScene === sceneId) app.navigate({ kind: 'write' })
    else void openScene(sceneId)
  }
  return (
    <div data-progress-card="scene">
      <Head kicker={end ? (end.tone === 'done' ? 'Draft finished' : 'Draft stopped') : 'Writing a scene'} title={shown?.title ?? 'The scene'} />
      <div className="wp-body">
        {shown ? <Steps view={shown} /> : null}
        {end ? <Ended {...end} /> : view ? <Now view={view} /> : null}
        {view ? <Bar view={view} /> : null}
        {shown?.oneModel ? <p className="wp-model">Model: {shown.oneModel}</p> : null}
      </div>
      <footer className="wp-foot">
        <Button size="sm" variant="secondary" icon={<ArrowRight size={13} />} onClick={go} title="Open the scene, where the words come in as they are written">
          Go to the scene
        </Button>
        {view && phase !== 'idle' ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<Square size={10} fill="currentColor" />}
            loading={phase === 'stopping'}
            data-testid="draft-stop"
            title="Stop writing. The words written so far stay in the scene."
            onClick={() => stopDraft()}
          >
            Stop
          </Button>
        ) : null}
      </footer>
    </div>
  )
}
