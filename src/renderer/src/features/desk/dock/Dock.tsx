// The AI dock (the desk, UI overhaul phase 3): floating at the foot of the page, where the AI is asked to write. Idle, it
// has the steer box ("Steer the next bit…", for the next Continue or Add below only), Add below (a new draft below a
// scene break, with no question), Continue (the AI writes on from the end of the scene as a change to accept or reject;
// "Draft the scene" when the page is empty) and the ⋯ menu (every other way to write, and the scene's tools). While the
// AI writes it shows what it is doing, its words so far, the writer model and Stop; while Continue's change waits, Accept
// (Tab) and Reject (Esc), as beside the change in the page. Beat by beat's bar takes its place while that is on.
// No new AI flows: Continue is the AI edits' Continue (edits/continue.ts), Add below is Generate's (useGenerate.ts).
import type { Editor } from '@tiptap/core'
import * as P from '@radix-ui/react-popover'
import { ArrowDown, ArrowDownToLine, Check, Sparkles, Square, X } from '@/components/ui/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { cn } from '@/lib/cn'
import { layerOpen } from '@/lib/layers'
import { isShortcut, shortcutKeys, withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { dismissQuestion } from '@/features/beats/flow'
import { QuestionPanel } from '@/features/beats/parts'
import { useBeats } from '@/features/beats/session'
import { useOutline } from '@/features/binder/outlineStore'
import { continueAtEnd } from '@/features/edits/continue'
import { accept, reject, stop as stopChange } from '@/features/edits/session'
import { suggestionsOf, type Suggestion } from '@/features/edits/suggestions'
import { GeneratePanels } from '@/features/generate/GeneratePanels'
import { useDraft } from '@/features/generate/draftRun'
import { usePolish } from '@/features/generate/polishRun'
import { useGenerate, type Generate } from '@/features/generate/useGenerate'
import { keyboardDriven } from '@/features/look/motion'
import { setSteer, steerOf, steerSettled, steerTaken, useDeskStore } from '../deskStore'
import { activityLine, activityOf, isBusy, progressOf, type Activity } from './activity'
import { DockMenu } from './DockMenu'

/** The change waiting (or being written) in the page for this scene, followed as the editor changes. */
function useChange(editor: Editor, sceneId: ID): Suggestion | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      editor.on('transaction', onChange)
      return () => {
        editor.off('transaction', onChange)
      }
    },
    [editor]
  )
  const active = useSyncExternalStore(subscribe, () => (editor.isDestroyed ? null : suggestionsOf(editor.state).active))
  return active && active.sceneId === sceneId ? active : null
}

/** What the AI is doing in the scene now (activity.ts). */
function useActivity(editor: Editor, sceneId: ID, g: Generate): { activity: Activity; changeId: ID | null } {
  const draftPhase = useDraft((d) => (d.sceneId === sceneId ? d.phase : 'idle'))
  const retrying = useDraft((d) => (d.sceneId === sceneId ? !!d.retrying : false))
  const polishing = usePolish((p) => p.sceneId === sceneId)
  const polishStopping = usePolish((p) => p.sceneId === sceneId && p.stopping)
  const beats = useBeats((s) => s.session?.sceneId === sceneId)
  const memoryReading = useApp((s) => !!s.memoryStatus?.reading)
  const change = useChange(editor, sceneId)
  const activity = activityOf({
    draft: { phase: draftPhase, retrying, written: g.written, target: g.targetWords },
    polish: { running: polishing, stopping: polishStopping },
    change,
    beats,
    memoryReading
  })
  return { activity, changeId: change?.id ?? null }
}

/** "Ctrl ⇧ ⏎": Continue's keys as small keycaps. */
function ContinueKeys(): React.JSX.Element {
  const keys = shortcutKeys('continue')
  return (
    <span className="desk-kcap" aria-hidden>
      {keys.map((k) => (
        <span key={k}>{k === 'Enter' ? '⏎' : k === 'Shift' ? '⇧' : k}</span>
      ))}
    </span>
  )
}

export function Dock({
  editor,
  sceneId,
  fallbackStatus,
  draftBelow,
  onRevealDraft
}: {
  editor: Editor
  sceneId: ID
  fallbackStatus: SceneStatus
  /** Generate's new draft is being written below, out of sight. */
  draftBelow: boolean
  onRevealDraft: () => void
}): React.JSX.Element {
  const { outline } = useOutline()
  const status = outline?.scenes.find((s) => s.id === sceneId)?.status ?? fallbackStatus
  const steer = useDeskStore((s) => s.steer[sceneId] ?? '')
  // Generate's workings, with its keys (Ctrl+G, Esc stops the draft, Ctrl+Z on the dock), and the steer box's words for
  // the next draft (Add below, Draft the scene, a choice from Ctrl+G).
  const g = useGenerate(sceneId, { keys: true, steer: { get: () => steerOf(sceneId), taken: () => steerTaken(sceneId) } })
  const { activity, changeId } = useActivity(editor, sceneId, g)
  const busy = isBusy(activity)
  const hasWords = useApp((s) => (s.sceneId === sceneId ? s.sceneWords > 0 : false))
  const question = useBeats((s) => (s.question?.sceneId === sceneId && s.question.from === 'button' ? s.question : null))

  // A state change asked from the keyboard (Ctrl+Shift+Enter, Tab, Esc) shows at once; from a click, it crossfades.
  const kind = activity.kind === 'starting' || activity.kind === 'writing' || activity.kind === 'polishing' ? 'busy' : activity.kind
  const [instant, setInstant] = useState(false)
  const lastKind = useRef(kind)
  useLayoutEffect(() => {
    if (lastKind.current === kind) return
    lastKind.current = kind
    setInstant(keyboardDriven())
  }, [kind])

  // The steer box's words come back if the writing they started ends with no words at all.
  const wrote = useRef(false)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (busy) {
      if (!wasBusy.current) wrote.current = false
      if (activity.kind === 'writing' && activity.words > 0) wrote.current = true
    } else if (wasBusy.current) {
      steerSettled(sceneId, wrote.current || activity.kind === 'review')
    }
    wasBusy.current = busy
  }, [busy, activity, sceneId])

  /** Continue from the end of the scene, steered by the box; on an empty page, a first draft of the scene. */
  const runContinue = useCallback(
    (byKey = false) => {
      if (useApp.getState().sceneId !== sceneId) return
      const text = steerOf(sceneId).trim()
      if (continueAtEnd(text)) {
        if (text) steerTaken(sceneId)
        return
      }
      g.generate(undefined, byKey)
    },
    [sceneId, g]
  )
  const runRef = useRef(runContinue)
  runRef.current = runContinue
  const kindRef = useRef(kind)
  kindRef.current = kind

  // Ctrl+Shift+Enter: Continue, from anywhere on the writing page (the steer box too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isShortcut(e, 'continue') || e.repeat || useApp.getState().view.kind !== 'write' || layerOpen()) return
      e.preventDefault()
      if (kindRef.current === 'idle') runRef.current(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const words = activityLine(activity)
  const progress = progressOf(activity)
  const continueLabel = hasWords ? 'Continue' : 'Draft the scene'

  return (
    <P.Root open={g.popover !== null} onOpenChange={(o) => !o && g.setPopover(null)}>
      <P.Anchor asChild>
        <div
          role="toolbar"
          aria-label="AI dock"
          data-desk-dock={kind}
          data-generate-controls
          data-focus-chrome
          data-instant={instant || undefined}
          inert={kind === 'beats'}
          onKeyDown={(e) => {
            // Esc on the dock does what it does in the page: stops the AI's change, or rejects it once written.
            if (e.key !== 'Escape' || e.defaultPrevented || !changeId) return
            if (activity.kind === 'review') {
              e.preventDefault()
              reject(changeId, 'key')
            } else if (activity.kind === 'writing' || activity.kind === 'starting') {
              if (activity.what === 'draft') return
              e.preventDefault()
              stopChange(changeId)
            }
          }}
          className={cn('desk-dock @container/dock pointer-events-auto relative h-14 w-full rounded-[18px]', kind === 'beats' && 'is-away')}
        >
          {/* Idle: steer, Add below, Continue, more. */}
          <div className="desk-dock-layer" data-layer="idle" inert={kind !== 'idle'} aria-hidden={kind !== 'idle' || undefined}>
            <span aria-hidden className="desk-dock-dot" />
            <label htmlFor={`steer-${sceneId}`} className="sr-only">
              Steer the next bit (optional)
            </label>
            <input
              id={`steer-${sceneId}`}
              type="text"
              className="desk-steer"
              placeholder="Steer the next bit… (optional)"
              autoComplete="off"
              spellCheck
              value={steer}
              onChange={(e) => setSteer(sceneId, e.target.value)}
              onKeyDown={(e) => {
                // Enter in the box: Continue (with what it says).
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  runContinue(true)
                }
              }}
            />
            <button
              type="button"
              className="desk-dock-btn"
              title="Add below: a new draft goes below a scene break (Ctrl+Z undoes it)"
              onClick={(e) => g.generate('add', e.detail === 0)}
            >
              <ArrowDownToLine size={16} aria-hidden />
              <span className="@max-[520px]/dock:sr-only">Add below</span>
            </button>
            <button
              type="button"
              className="desk-dock-ai"
              aria-label={withShortcut(continueLabel, 'continue')}
              title={
                hasWords
                  ? withShortcut('Continue: the AI writes on from the end of the scene, for you to accept or reject', 'continue')
                  : withShortcut('Draft the scene from its card', 'generate')
              }
              onClick={(e) => runContinue(e.detail === 0)}
            >
              <Sparkles size={16} aria-hidden />
              <span>{continueLabel}</span>
              {hasWords ? <ContinueKeys /> : null}
            </button>
            <DockMenu sceneId={sceneId} status={status} g={g} disabled={kind !== 'idle'} />
          </div>

          {/* Busy: what the AI is doing, its words so far, the model, Stop. */}
          <div className="desk-dock-layer" data-layer="busy" inert={kind !== 'busy'} aria-hidden={kind !== 'busy' || undefined}>
            <span aria-hidden className="desk-dock-dot is-live" />
            {draftBelow && activity.kind === 'writing' && activity.what === 'draft' ? (
              // The new draft is being written below, out of sight: the line shows where it is.
              <button type="button" className="desk-dock-line is-link" onClick={onRevealDraft} title="Show where the new draft is being written">
                <span className="truncate">{words}</span>
                <span className="desk-dock-below">
                  below
                  <ArrowDown size={13} aria-hidden />
                </span>
              </button>
            ) : (
              <span className="desk-dock-line" role="status" aria-live="polite">
                <span className="truncate">{kind === 'busy' ? words : ''}</span>
              </span>
            )}
            <span className="desk-dock-model truncate">{g.modelName ?? ''}</span>
            <button
              type="button"
              className="desk-dock-stop"
              disabled={(activity.kind === 'writing' && activity.stopping) || (activity.kind === 'polishing' && activity.stopping)}
              title={activity.kind === 'polishing' ? 'Stop polishing (Esc). The draft stays as it was written.' : 'Stop writing (Esc). The words so far are kept.'}
              onClick={() => {
                if (activity.kind === 'starting' || activity.kind === 'writing') {
                  if (activity.what === 'draft') g.stop()
                  else if (changeId) stopChange(changeId)
                } else g.stop()
              }}
            >
              <Square size={11} fill="currentColor" aria-hidden />
              Stop
            </button>
          </div>

          {/* Review: Continue's change waits in the page; Accept or Reject it here too. */}
          <div className="desk-dock-layer" data-layer="review" inert={kind !== 'review'} aria-hidden={kind !== 'review' || undefined}>
            <span aria-hidden className="desk-dock-dot" />
            <span className="desk-dock-line">
              <span className="truncate">{activity.kind === 'review' ? words : ''}</span>
            </span>
            <button
              type="button"
              className="desk-dock-btn"
              disabled={activity.kind === 'review' && activity.accepting}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => changeId && reject(changeId)}
            >
              <X size={14} aria-hidden />
              Reject <span className="desk-dock-key">Esc</span>
            </button>
            <button
              type="button"
              className="desk-dock-ai"
              disabled={activity.kind === 'review' && activity.accepting}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => changeId && void accept(changeId)}
            >
              <Check size={15} aria-hidden />
              Accept <span className="desk-dock-key">Tab</span>
            </button>
          </div>

          <span aria-hidden className="desk-dock-track" />
          <span
            aria-hidden
            className={cn('desk-dock-prog', progress === null && 'is-shimmer')}
            style={progress === null ? undefined : { transform: `scaleX(${progress})` }}
          />
          {/* Beat by beat's first question ("This scene already has text"…) opens over the dock. */}
          <P.Root open={!!question} onOpenChange={(o) => !o && dismissQuestion()}>
            <P.Anchor asChild>
              <span aria-hidden className="pointer-events-none absolute inset-0" />
            </P.Anchor>
            {question ? <QuestionPanel key={question.kind} question={question} side="top" /> : null}
          </P.Root>
        </div>
      </P.Anchor>
      <GeneratePanels g={g} side="top" />
    </P.Root>
  )
}
