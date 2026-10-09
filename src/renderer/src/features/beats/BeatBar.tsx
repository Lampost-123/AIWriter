// What shows over the bottom of the page while writing beat by beat (milestone 4). Between beats: which
// beat is next and its words, a box to steer it, Write the next beat (Enter in the box), Write it again
// (the beat just written, afresh in its place), What the AI saw (for the beat just written) and Finish.
// While a beat is being written: that it is, with Stop (Esc also stops). Rendered by SceneView over the
// page's room below the text, so it never covers the words being written; its rows keep their size
// whatever it shows, so it never jumps. Messages show above it while it does, and a pointer above it
// leads to a beat being written out of sight below.
import * as P from '@radix-ui/react-popover'
import { ArrowDown, Check, FileSearch, ListOrdered, RotateCcw, Sparkles, Square } from '@/components/ui/icons'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ID } from '@shared/types'
import { Button, Textarea, useToastsAbove } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { useDelayed } from '@/features/generate/parts'
import {
  clearHeight,
  dismissQuestion,
  finish,
  reloadBeats,
  resumeBeats,
  revealBeat,
  showRecord,
  stopBeat,
  watchPage,
  writeAgain,
  writeNext
} from './flow'
import { MAX_NOTE_CHARS, nextBeat } from './sessionLogic'
import { QuestionPanel } from './parts'
import { patchSession, useBeats, type BeatSession } from './session'

/** The last request for the keyboard the bar has met, so showing it again (back from another scene) doesn't take it. */
let focusSeen = 0

export function BeatBar({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const session = useBeats((s) => (s.session?.sceneId === sceneId ? s.session : null))
  const anyOn = useBeats((s) => !!s.session)
  // Another scene shows: a page height held while a beat was written again goes with the last one.
  useLayoutEffect(() => () => clearHeight(), [sceneId])
  // The scene's last session didn't Finish (the app closed, say): with no session on, it carries on where it was,
  // once the scene's page shows. Tried again a little later while the page isn't ready for it (a long scene still
  // coming in, a draft still ending), so the bar doesn't stay away.
  useEffect(() => {
    if (anyOn) return
    let gone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tries = [0, 400, 1500, 4000]
    const attempt = (n: number): void => {
      void resumeBeats(sceneId, { auto: true }).then((ok) => {
        if (!ok && !gone && n + 1 < tries.length) timer = setTimeout(() => attempt(n + 1), tries[n + 1])
      })
    }
    const frame = requestAnimationFrame(() => attempt(0))
    return () => {
      gone = true
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [sceneId, anyOn])
  return session ? <Bar session={session} /> : null
}

/** How far the session has got, one mark a beat: written, being written (or stopped part-way), still to come. */
function Progress({
  of,
  written,
  writing,
  partWay
}: {
  of: number
  written: number
  writing: number | null
  partWay: number | null
}): React.JSX.Element | null {
  if (of < 2 || of > 12) return null
  return (
    <span className="flex shrink-0 items-center gap-[3px] @max-[460px]:hidden" aria-hidden>
      {Array.from({ length: of }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-3 rounded-full transition-colors duration-150',
            writing === i + 1 ? 'bg-ai animate-pulse' : partWay === i + 1 ? 'bg-ai' : i < written ? 'bg-success' : 'bg-line-strong'
          )}
        />
      ))}
    </span>
  )
}

/** Above the bar, while the beat it is about starts out of sight below (the page's own pointer would be under the bar). */
function Pointer({ index, writing }: { index: number; writing: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      // The keyboard stays where it is (the box, usually): the page only moves.
      onMouseDown={(e) => e.preventDefault()}
      onClick={revealBeat}
      title={writing ? 'Show where the beat is being written' : 'Show where the beat begins'}
      className={cn(
        'absolute bottom-full left-1/2 mb-3 flex h-8 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-medium shadow-pop transition-colors duration-150 animate-fade-in',
        writing ? 'border-ai/40 bg-ai-soft text-ai hover:border-ai' : 'border-line bg-surface text-fg hover:border-line-strong'
      )}
    >
      {writing ? <span className="h-1.5 w-1.5 rounded-full bg-ai animate-pulse" aria-hidden /> : null}
      {writing ? `Writing beat ${index} below` : `Beat ${index} is below`}
      <ArrowDown size={13} aria-hidden />
    </button>
  )
}

function Bar({ session: s }: { session: BeatSession }): React.JSX.Element {
  const question = useBeats((x) => (x.question?.sceneId === s.sceneId && x.question.from === 'bar' ? x.question : null))
  const focusRev = useBeats((x) => x.focusRev)
  const memoryReading = useApp((x) => !!x.memoryStatus?.reading)
  const briefingRev = useApp((x) => x.briefingRev)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const barRef = useRef<HTMLElement>(null)
  // The writing page shows (the bar is kept, hidden with it, while another page does).
  const onPage = useApp((x) => x.view.kind === 'write')

  // The beats on the page are counted as it changes (Ctrl+Z on a beat takes the bar back a beat).
  useEffect(() => {
    const ed = editorBridge()?.editor
    return ed ? watchPage(ed) : undefined
  }, [s.sceneId])

  // The card's beats as they are now, and again whenever the card is saved.
  useEffect(() => {
    void reloadBeats(s.sceneId)
  }, [s.sceneId, briefingRev])

  // The keyboard into the box when asked (a session starting, a beat written...).
  useEffect(() => {
    if (focusRev <= focusSeen) return
    focusSeen = focusRev
    if (useApp.getState().view.kind === 'write') boxRef.current?.focus({ preventScroll: true })
  }, [focusRev])

  const of = s.beats.length
  const busy = s.phase !== 'paused'
  const next = nextBeat(s.written, of)
  const writing = busy && s.current ? s.current.index : null
  // The beat the bar is about: the one being written, else the next one, else the last.
  const shown = writing ?? next ?? of
  // Between beats, a beat after the one written (or being written) that the note in the box is for.
  const after = writing != null ? (writing < of ? writing + 1 : null) : next
  // The last beat on the page was stopped or cut off before its end.
  const short = !busy && s.written >= 1 && s.last != null && s.partWay.includes(s.last)

  // Getting ready is usually quick; when it isn't because the memory is catching up first, the bar says so.
  const startingSlow = useDelayed(s.phase === 'starting', 700)
  let status: string
  let statusTitle: string | undefined
  if (busy) {
    if (s.phase === 'stopping') status = 'Stopping…'
    else if (s.retrying) {
      status = 'Retrying…'
      statusTitle = s.retrying
    } else if (startingSlow && memoryReading) {
      status = 'Updating memory…'
      statusTitle = 'Bringing the memory up to date with earlier scenes first, so the beat knows what happened in them.'
    } else status = s.current?.again ? `Writing beat ${writing} again…` : `Writing beat ${writing} of ${of}…`
  } else if (next != null) status = `Beat ${next} of ${of}`
  else if (short) status = of === 1 ? 'The beat stopped part-way' : `Beat ${s.written} stopped part-way`
  else status = of === 1 ? 'The beat is written' : `All ${of} beats are written`

  const words = busy
    ? (s.beats[shown - 1] ?? '')
    : short
      ? next != null
        ? `Beat ${s.written} stopped part-way. Write it again, or carry on with beat ${next}.`
        : 'Write it again, or finish with the scene as it is.'
      : next != null
        ? (s.beats[next - 1] ?? '')
        : 'That was the last beat on the scene card. Write it again, or finish.'
  const again = s.written >= 1 ? s.written : null

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter writes (Shift+Enter starts a new line in the note). Ctrl+Enter does too, here, and not Mark done.
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (busy) return
    if (next != null) writeNext(true)
    else if (s.steer.trim()) writeAgain()
  }

  return (
    // The page fades out just above the bar and stays out below it, so no words peek round it (clear of
    // the page's scroll bar).
    <div className="pointer-events-none absolute bottom-0 left-0 right-2.5 z-10 flex justify-center bg-[linear-gradient(to_top,var(--page)_calc(100%-20px),transparent)] px-4 pb-4 pt-5">
      <section
        ref={barRef}
        data-beat-bar
        // The AI edits' change keeps its buttons above the bar (features/edits/SuggestionLayer.tsx).
        data-covers-page=""
        aria-label="Beat by beat"
        className="@container pointer-events-auto relative w-full max-w-[680px] rounded-xl border border-line bg-surface px-4 pb-3 pt-2 shadow-pop animate-slide-up"
      >
        {s.below ? <Pointer key={`${s.below.index}-${s.below.writing}`} index={s.below.index} writing={s.below.writing} /> : null}
        <div className="flex h-8 items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              role="status"
              title={statusTitle}
              className={cn('flex min-w-0 items-center gap-2 text-[12.5px] font-semibold', busy ? 'text-ai' : 'text-fg')}
            >
              {busy ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-ai animate-pulse" aria-hidden />
              ) : (
                <ListOrdered size={14} className="shrink-0 text-muted" aria-hidden />
              )}
              <span className="truncate">{status}</span>
            </span>
            <Progress of={of} written={s.written} writing={writing} partWay={short ? s.written : null} />
          </div>
          {/* Between beats only; the room is kept while a beat is written, so nothing moves. Once every beat is
              written, Finish is the big button below instead (the buttons here keep their places at the right). */}
          <div className={cn('-mr-1.5 flex shrink-0 items-center gap-0.5', busy && 'invisible')}>
            {next != null ? (
              <Button variant="ghost" size="sm" onClick={finish} title="Close this bar. The beats stay as they are.">
                Finish
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              icon={<FileSearch size={13} />}
              disabled={!s.last && !s.tried}
              onClick={showRecord}
              title={
                again != null && s.last
                  ? `See exactly what the AI was given for beat ${again}`
                  : s.tried
                    ? 'See what the AI was given for the last beat tried, and what came back'
                    : undefined
              }
            >
              <span className="@max-[540px]:sr-only">What the AI saw</span>
            </Button>
            <Button
              variant={short ? 'secondary' : 'ghost'}
              size="sm"
              icon={<RotateCcw size={13} />}
              disabled={again == null}
              onClick={writeAgain}
              title={
                again != null
                  ? `Write beat ${again} afresh in its place, following your note if you wrote one. ${modKey()}+Z takes the new version out.`
                  : undefined
              }
            >
              Write it again
            </Button>
          </div>
        </div>
        <p className="line-clamp-2 h-10 text-[13.5px] leading-5 text-muted" title={words}>
          {words}
        </p>
        <div className="mt-2.5 flex items-end gap-2">
          <Textarea
            ref={boxRef}
            minRows={1}
            maxRows={3}
            maxLength={MAX_NOTE_CHARS}
            value={s.steer}
            onChange={(e) => patchSession({ steer: e.target.value })}
            onKeyDown={onKeyDown}
            aria-label={after != null ? 'Your note for the next beat' : 'Your note if the beat is written again'}
            placeholder={after != null ? 'Anything to change for the next beat?' : 'Anything to change if you write it again?'}
            className="min-w-0 flex-1"
          />
          <P.Root open={!!question} onOpenChange={(open) => !open && dismissQuestion()}>
            <P.Anchor asChild>
              <div className="w-[172px] shrink-0">
                {busy ? (
                  <Button
                    variant="secondary"
                    className="h-[35px] w-full"
                    icon={<Square size={11} fill="currentColor" />}
                    onClick={stopBeat}
                    disabled={s.phase === 'stopping'}
                    title="Stop writing (Esc). The text so far is kept."
                  >
                    Stop
                  </Button>
                ) : next != null ? (
                  <Button
                    variant="primary"
                    className="h-[35px] w-full"
                    icon={<Sparkles size={14} />}
                    onClick={() => writeNext(false)}
                    title={`Write beat ${next} of ${of}, following your note if you wrote one (Enter in the box)`}
                  >
                    Write the next beat
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="h-[35px] w-full"
                    icon={<Check size={14} />}
                    onClick={finish}
                    title="Close this bar. The beats stay as they are."
                  >
                    Finish
                  </Button>
                )}
              </div>
            </P.Anchor>
            {question ? <QuestionPanel key={question.kind} question={question} side="top" /> : null}
          </P.Root>
        </div>
      </section>
      {/* After the bar, so it is there to measure. */}
      {onPage ? <ToastsAbove bar={barRef} /> : null}
    </div>
  )
}

/** Messages show above the bar while it shows, so none covers its buttons (or the Undo in one covers it). */
function ToastsAbove({ bar }: { bar: React.RefObject<HTMLElement | null> }): null {
  useToastsAbove(bar)
  return null
}
