// The Generate button and its draft options, in the scene's toolbar.
// Generate (Ctrl+G) drafts the scene from its card into the editor; while it
// streams the button becomes Stop (Esc also stops) and the text so far stays.
// When the scene already has text, Generate first asks whether the new draft
// replaces it or goes below it. Once picked, the keyboard goes into the page, and
// Ctrl+Z on the Generate button works there too, so "Ctrl+Z undoes it" holds.
import * as P from '@radix-ui/react-popover'
import { ArrowDownToLine, ChevronDown, RefreshCw, Sparkles, Square } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { AppEvents } from '@shared/api'
import type { Creativity, ID } from '@shared/types'
import { CREATIVITY_PRESETS } from '@shared/defaults'
import { Button, Field, Input, Textarea, toast } from '@/components/ui'
import { api, ApiError, modKey, onEvent } from '@/lib/api'
import { editorBridge, type EditorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { snapshotBefore } from '@/features/history/snapshot'
import { BLANK_DRAFT_OPTIONS, resolveDraftOptions, type SceneDraftOptions } from './draftOptions'
import { CREATIVITY_HINTS, estimateDraftCost, formatCost, shortModelName } from './format'
import { PopoverPanel, Segmented, useDelayed } from './parts'

interface Session {
  sceneId: ID
  bridge: EditorBridge
  generationId: ID | null
  /** Text that arrived before startDraft returned the draft's id. */
  early: AppEvents['generation:chunk'][]
  earlyDone: AppEvents['generation:done'] | null
  cancelled: boolean
}

type Phase = 'idle' | 'starting' | 'streaming' | 'stopping'

/** Where a draft goes in a scene that already has text: in place of it, or after it. */
type DraftMode = 'replace' | 'add'

const CREATIVITY_OPTIONS = (Object.keys(CREATIVITY_PRESETS) as Creativity[]).map((k) => ({ value: k, label: CREATIVITY_PRESETS[k].label }))

/** Below this header width the writer model's name is left out, so Generate always fits. */
const COMPACT_BELOW = 600

/** True when the header around `ref` is too narrow for the model name next to Generate. */
function useNarrowHeader(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  // Measured before paint, so the header never shows one layout and then jumps to the other.
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.closest('header') ?? el?.parentElement
    if (!host) return
    const measure = (): void => setNarrow(host.getBoundingClientRect().width < COMPACT_BELOW)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [ref])
  return narrow
}

/**
 * One of the two answers to "This scene already has text": a name, and a faint line saying what it does.
 * Opened from the keyboard, the answer that has the keyboard always shows it (a shortcut alone doesn't
 * make the browser show its focus ring), so Enter never picks one Adam can't see.
 */
function ModeChoice({
  mode,
  icon,
  label,
  hint,
  keyboard,
  onClick
}: {
  mode: DraftMode
  icon: ReactNode
  label: string
  hint: string
  keyboard: boolean
  onClick: () => void
}): React.JSX.Element {
  const id = useId()
  return (
    <button
      type="button"
      data-choice={mode}
      onClick={onClick}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2',
        keyboard && 'focus:outline-2 focus:outline-offset-2 focus:outline-[var(--focus)]'
      )}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted transition-colors duration-150 group-hover:bg-surface-3 group-hover:text-fg"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-[13px] font-medium leading-5 text-fg">
          {label}
        </span>
        <span id={`${id}-hint`} className="block text-[12px] leading-[18px] text-faint">
          {hint}
        </span>
      </span>
    </button>
  )
}

/** Something else (a menu, a dialog, a popover) is open and should get Esc first. */
const layerOpen = (): boolean => !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')

/** The key was pressed in the manuscript page. */
const inPage = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.ProseMirror')

/** The keyboard isn't in anything that takes keys itself: nowhere in particular, or on Generate and its choice. */
const keyboardIdle = (t: EventTarget | null): boolean =>
  !t || t === document.body || t === document.documentElement || (t instanceof Element && !!t.closest('[data-generate-controls]'))

export function GenerateControls({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const defaultCreativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const navigate = useApp((s) => s.navigate)

  // Kept in the store (each scene's own), so the Context tab previews the briefing with the same options.
  const opts = useApp((s) => s.draftOptions[sceneId] ?? BLANK_DRAFT_OPTIONS)
  const [lengthText, setLengthText] = useState('')
  const [cardWords, setCardWords] = useState<number | null>(null)
  /** The scene card says what happens (beats, a goal, an outcome or notes). Null until loaded. */
  const [cardPlanned, setCardPlanned] = useState<boolean | null>(null)
  /** The page already has writing on it, so Generate asks whether the new draft replaces it or goes after it. */
  const [hasText, setHasText] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [popover, setPopover] = useState<'options' | 'need-model' | 'choose' | null>(null)
  /** Where the keyboard was before the "already has text" choice opened, so closing it puts it back there. */
  const beforeChoice = useRef<HTMLElement | null>(null)
  /** The choice was opened from the keyboard (Ctrl+G): Add below takes the keyboard, ready for Enter. */
  const [choiceByKey, setChoiceByKey] = useState(false)
  /** The choice took the place of the draft options (Ctrl+Enter or Generate draft there): Esc goes back to them. */
  const [choiceFromOptions, setChoiceFromOptions] = useState(false)
  const [estimate, setEstimate] = useState<number | null>(null)
  /** Bumped when the card may have changed, so the estimate is worked out again. */
  const [estimateRev, setEstimateRev] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const compact = useNarrowHeader(rootRef)

  const session = useRef<Session | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const popoverRef = useRef(popover)
  popoverRef.current = popover
  const optsRef = useRef(opts)
  optsRef.current = opts
  const creativity = opts.creativity ?? defaultCreativity
  const targetWords = opts.targetWords ?? cardWords

  const openSettings = useCallback(() => {
    setPopover(null)
    navigate({ kind: 'settings', tab: 'models' })
  }, [navigate])

  // ---------- Scene card target length ----------

  const lastCardLoad = useRef(0)
  const loadCard = useCallback(
    (force = false) => {
      if (!force && Date.now() - lastCardLoad.current < 5000) return
      lastCardLoad.current = Date.now()
      setEstimateRev((n) => n + 1)
      api
        .getScene(sceneId)
        .then((s) => {
          if (s.id !== sceneId) return
          setCardWords(s.card.targetWords)
          const c = s.card
          setCardPlanned(c.beats.some((b) => b.trim() !== '') || [c.goal, c.outcome, c.notes].some((t) => t.trim() !== ''))
        })
        .catch(() => undefined)
    },
    [sceneId]
  )

  useEffect(() => {
    setCardWords(null)
    setCardPlanned(null)
    setEstimate(null)
    lastCardLoad.current = 0
    loadCard(true)
  }, [sceneId, loadCard])

  useEffect(() => {
    setLengthText(targetWords != null ? String(targetWords) : '')
  }, [targetWords])

  // Another scene: a question about the last one's text no longer applies.
  useEffect(() => setPopover((p) => (p === 'choose' ? null : p)), [sceneId])

  const checkText = useCallback(() => {
    const bridge = editorBridge()
    setHasText(!!bridge && bridge.sceneId === sceneId && bridge.hasText())
  }, [sceneId])

  const updateOpts = (patch: Partial<SceneDraftOptions>): void => useApp.getState().setDraftOptions(sceneId, patch)

  // ---------- Estimated cost (only for models with prices) ----------

  // Keyed on the values, not the settings object, which is replaced whenever any setting is saved.
  const promptPrice = writer?.promptPrice ?? null
  const completionPrice = writer?.completionPrice ?? null
  const hasPrices = promptPrice != null && completionPrice != null
  const writerKey = writer ? `${writer.providerId}/${writer.modelId}/${writer.contextLength ?? ''}` : null
  useEffect(() => {
    if (!writerKey || !hasPrices || targetWords == null) {
      setEstimate(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      api
        .previewContext(sceneId, { direction: opts.direction, targetWords, creativity })
        .then((p) => live && setEstimate(estimateDraftCost(p.budget.used, targetWords, { promptPrice, completionPrice })))
        .catch(() => live && setEstimate(null))
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [sceneId, writerKey, hasPrices, promptPrice, completionPrice, targetWords, opts.direction, creativity, estimateRev])

  // ---------- Streaming ----------

  /** Opens the draft options (from a message's button, perhaps while another page shows). */
  const openOptions = (): void => {
    if (useApp.getState().view.kind !== 'write') navigate({ kind: 'write' })
    loadCard(true)
    checkText()
    setPopover('options')
  }
  const openOptionsRef = useRef(openOptions)
  openOptionsRef.current = openOptions

  const finish = useCallback(
    (p: AppEvents['generation:done']) => {
      const s = session.current
      if (!s || s.generationId !== p.generationId) return
      // A problem is reported here, in one message; otherwise the page says what the draft did.
      const failed = (p.status === 'error' && !!p.error) || !!p.cutOff
      const { replaced } = s.bridge.endStream(p.generationId, { failed })
      session.current = null
      setPhase('idle')
      setRetrying(null)
      const app = useApp.getState()
      if (app.activeGeneration?.id === p.generationId) app.setActiveGeneration(null)
      const showRecord = { label: 'What the AI saw', run: () => navigate({ kind: 'generation', generationId: p.generationId }) }
      // The draft took the place of the scene's text: how to have the old text back.
      const oldText = replaced ? ` ${modKey()}+Z puts the scene's old text back.` : ''
      if (p.status === 'error' && p.error) {
        // The button goes where the message says the fix is: the draft options (a length the
        // model can't manage), Settings (key, credit, model), or else the draft's record.
        const action = /\bdraft options\b/.test(p.error)
          ? { label: 'Draft options', run: () => openOptionsRef.current() }
          : /\bSettings\b/.test(p.error)
            ? { label: 'Open Settings', run: () => navigate({ kind: 'settings', tab: 'models' }) }
            : showRecord
        toast(p.error + oldText, { tone: 'danger', action })
      } else if (p.cutOff) {
        toast(
          `The model ran out of room before the end of the scene, so the draft stops mid-way. The text so far is kept. Try a shorter target length, or a writer model that can write more in one go.${oldText}`,
          { action: showRecord }
        )
      }
      lastCardLoad.current = 0
    },
    [navigate]
  )

  useEffect(() => {
    const offChunk = onEvent('generation:chunk', (p) => {
      const s = session.current
      if (!s || s.cancelled) return
      if (s.generationId === null) {
        s.early.push(p)
        return
      }
      if (p.generationId !== s.generationId) return
      s.bridge.appendStream(p.generationId, p.text)
      setRetrying((r) => (r ? null : r))
    })
    const offRetry = onEvent('generation:retrying', (p) => {
      const s = session.current
      if (!s || (s.generationId !== null && p.generationId !== s.generationId)) return
      setRetrying(p.reason)
    })
    const offDone = onEvent('generation:done', (p) => {
      const s = session.current
      if (!s) return
      if (s.generationId === null) s.earlyDone = p
      else finish(p)
    })
    return () => {
      offChunk()
      offRetry()
      offDone()
    }
  }, [finish])

  /**
   * Drafts the scene. When it already has text and `mode` isn't given, it first asks whether the new
   * draft replaces that text or goes below it (nothing is sent until Adam answers). `byKey`: asked
   * from the keyboard.
   */
  const generate = useCallback(async (mode?: DraftMode, byKey = false) => {
    if (session.current || phaseRef.current !== 'idle') return
    if (!useApp.getState().settings?.models.writer) {
      setPopover('need-model')
      return
    }
    const bridge = editorBridge()
    if (!bridge || bridge.sceneId !== sceneId) {
      toast('Open this scene in the editor to draft into it.')
      return
    }
    const filled = bridge.hasText()
    if (!mode && filled) {
      setHasText(true)
      if (popoverRef.current !== 'choose') {
        const active = document.activeElement
        // Not from inside the draft options: that panel makes way for the choice (and Esc goes back to it).
        beforeChoice.current = active instanceof HTMLElement && !active.closest('[data-radix-popper-content-wrapper]') ? active : null
        setChoiceFromOptions(popoverRef.current === 'options')
        setChoiceByKey(byKey)
      }
      setPopover('choose')
      return
    }
    // Emptied since the choice was made: there's nothing to replace.
    const replace = mode === 'replace' && filled
    setPopover(null)
    // From now until the first words arrive, the text to be replaced is held as it is (dimmed, and
    // nothing can change it), so nothing typed while the draft gets ready goes with it.
    if (replace && !bridge.holdForReplace(sceneId)) {
      toast("The editor wasn't ready for this scene, so nothing was sent. Try again in a moment.")
      return
    }
    // Picked from the choice: the keyboard goes back into the page, so Ctrl+Z works as the choice says.
    if (mode) bridge.takeKeyboard()
    setPhase('starting')
    const s: Session = { sceneId, bridge, generationId: null, early: [], earlyDone: null, cancelled: false }
    session.current = s
    /** The draft didn't start: the held text is the scene's again (unless a newer draft has started since). */
    const giveUp = (): void => {
      if (session.current !== s && session.current !== null) return
      session.current = null
      setPhase('idle')
      if (replace) bridge.releaseHold()
    }
    try {
      // Save the card and the page first, so the draft is built from the latest of both.
      await flushAll()
      const card = (await api.getScene(sceneId)).card
      const options = resolveDraftOptions(optsRef.current, card.targetWords, useApp.getState().settings?.creativity ?? 'balanced')
      if (s.cancelled) {
        giveUp()
        return
      }
      const { generationId } = await api.startDraft(sceneId, options)
      // History keeps the scene as it is just before the draft goes in (linked to the draft, for What the AI saw).
      await snapshotBefore(sceneId, 'Before a new draft', { generationId })
      if (s.cancelled || session.current !== s) {
        void api.stopGeneration(generationId).catch(() => undefined)
        giveUp()
        return
      }
      if (!bridge.beginStream(sceneId, generationId, { replace })) {
        void api.stopGeneration(generationId).catch(() => undefined)
        giveUp()
        toast("The editor wasn't ready for this scene, so the draft was stopped. Try again in a moment.")
        return
      }
      s.generationId = generationId
      useApp.getState().setActiveGeneration({ id: generationId, sceneId })
      setPhase('streaming')
      for (const c of s.early) if (c.generationId === generationId) bridge.appendStream(generationId, c.text)
      s.early = []
      if (s.earlyDone?.generationId === generationId) finish(s.earlyDone)
    } catch (e) {
      giveUp()
      const err = e as ApiError
      // Adam pressed Stop before it began: nothing was sent, and there's nothing to say.
      if (err.code === 'cancelled') return
      if (err.code === 'no-writer-model') setPopover('need-model')
      // A length the model can't write is changed in the draft options; key and model problems in Settings.
      else if (err.code === 'too-long') toast(err.message, { tone: 'danger', action: { label: 'Draft options', run: () => openOptionsRef.current() } })
      else toast(err.message, { tone: 'danger', action: err.code === 'no-key' || /\bSettings\b/.test(err.message) ? { label: 'Open Settings', run: openSettings } : undefined })
    }
  }, [sceneId, finish, openSettings])

  const stop = useCallback(() => {
    const s = session.current
    if (!s) return
    if (!s.generationId) {
      // Still starting (perhaps waiting for the memory to catch up): it is called off and nothing is sent.
      // A draft that had already begun by then is stopped as soon as its start comes back.
      s.cancelled = true
      setPhase('stopping')
      void api.cancelDraftStart(s.sceneId).catch(() => undefined)
      return
    }
    if (phaseRef.current === 'stopping') return
    setPhase('stopping')
    api.stopGeneration(s.generationId).catch((e: Error) => toast(e.message, { tone: 'danger' }))
  }, [])

  // Leaving the scene (or the page) mid-draft stops the draft; the text so far stays.
  useEffect(() => {
    return () => {
      const s = session.current
      if (!s) return
      s.cancelled = true
      session.current = null
      setPhase('idle')
      setRetrying(null)
      if (s.generationId) {
        void api.stopGeneration(s.generationId).catch(() => undefined)
        s.bridge.endStream(s.generationId)
        const app = useApp.getState()
        if (app.activeGeneration?.id === s.generationId) app.setActiveGeneration(null)
      } else {
        void api.cancelDraftStart(s.sceneId).catch(() => undefined)
        s.bridge.releaseHold()
      }
    }
  }, [sceneId])

  // Ctrl+G generates; Esc stops; Ctrl+Z on Generate (or with the keyboard nowhere in particular) undoes in the page.
  const generateRef = useRef(generate)
  generateRef.current = generate
  const stopRef = useRef(stop)
  stopRef.current = stop
  const sceneIdRef = useRef(sceneId)
  sceneIdRef.current = sceneId
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Only on the writing page: while another page covers it, Esc and Ctrl+G belong to that page.
      if (useApp.getState().view.kind !== 'write') return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        if (phaseRef.current === 'idle') void generateRef.current(undefined, true)
        return
      }
      // The page takes Esc for itself (and marks it handled), but there it stops the draft too, as Stop says.
      const escape = e.key === 'Escape' && !e.isComposing && phaseRef.current !== 'idle'
      if (escape && (!e.defaultPrevented || inPage(e.target)) && !layerOpen()) {
        stopRef.current()
        return
      }
      const undoKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z'
      if (undoKey && !e.defaultPrevented && keyboardIdle(e.target) && !layerOpen()) {
        const bridge = editorBridge()
        if (bridge?.sceneId === sceneIdRef.current && bridge.undo()) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------- View ----------

  const busy = phase !== 'idle'
  // Before a draft starts, the memory first reads any earlier scenes it hasn't caught up with, which
  // can take a little while; the status then says why, and Stop (or Esc) calls the draft off before
  // anything is sent. A quick start shows no status at all.
  const memoryReading = useApp((s) => !!s.memoryStatus?.reading)
  const startingSlow = useDelayed(phase === 'starting', 700)
  const showStatus = phase === 'streaming' || phase === 'stopping' || startingSlow
  const afterText = 'This scene already has text. You can replace it with the new draft, or add the draft below it.'
  // Some models (OpenAI's reasoning models, for one) set their own creativity and take no setting for it.
  const fixedCreativity = writer?.sampling === false
  const modelName = writer ? shortModelName(writer.label || writer.modelId) : null
  const status =
    phase === 'starting'
      ? memoryReading
        ? 'Updating memory…'
        : 'Getting ready…'
      : retrying
        ? 'Retrying…'
        : phase === 'stopping'
          ? 'Stopping…'
          : 'Writing…'
  const statusTitle =
    phase === 'starting'
      ? memoryReading
        ? 'Bringing the memory up to date with earlier scenes first, so the draft knows what happened in them.'
        : 'Getting the draft ready.'
      : (retrying ?? undefined)

  return (
    <div ref={rootRef} data-generate-controls className="flex items-center gap-1.5">
      {compact ? (
        // Narrow header: only the amber light while writing (its slot is always kept, so nothing moves).
        <span role="status" title={showStatus ? (statusTitle ?? status) : undefined} className="flex h-8 w-4 items-center justify-center">
          {showStatus ? (
            <>
              <span className="h-2 w-2 rounded-full bg-ai animate-pulse" aria-hidden />
              <span className="sr-only">{status}</span>
            </>
          ) : null}
        </span>
      ) : (
        // Wide enough for the longest words that show while drafting ("Updating memory…"), so they never
        // spill over the buttons beside them whatever the writer model is called.
        <div className="relative flex h-8 min-w-[150px] items-center justify-end">
          <button
            type="button"
            onClick={openSettings}
            tabIndex={showStatus ? -1 : 0}
            title={writer ? `Writer model: ${writer.label || writer.modelId}. Change it in Settings › Models.` : 'Choose a writer model in Settings › Models.'}
            className={cn(
              'flex h-7 max-w-[230px] items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg',
              showStatus && 'invisible'
            )}
          >
            <span className="truncate">{modelName ?? 'No writer model'}</span>
            {writer && hasPrices ? (
              <span className="w-[50px] shrink-0 text-left tabular-nums text-faint" title="Estimated cost of a draft">
                {estimate != null ? `· ${formatCost(estimate)}` : ''}
              </span>
            ) : null}
          </button>
          {showStatus ? (
            <span
              role="status"
              title={statusTitle}
              className="absolute inset-0 flex items-center justify-end gap-2 overflow-hidden whitespace-nowrap pr-2 text-[12.5px] font-medium text-ai animate-fade-in"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-ai animate-pulse" aria-hidden />
              <span className="truncate">{status}</span>
            </span>
          ) : null}
        </div>
      )}

      <P.Root open={popover !== null} onOpenChange={(o) => !o && setPopover(null)}>
        <P.Anchor asChild>
          <div className="flex w-[132px] shrink-0">
            {busy ? (
              // Also while the draft is starting (perhaps waiting for the memory to catch up first).
              <Button
                variant="secondary"
                className="w-full"
                icon={<Square size={11} fill="currentColor" />}
                onClick={stop}
                disabled={phase === 'stopping'}
                title="Stop writing (Esc). The text so far is kept."
              >
                Stop
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  className="flex-1 rounded-r-none"
                  icon={<Sparkles size={14} />}
                  onClick={() => void generate()}
                  onPointerEnter={() => {
                    loadCard()
                    checkText()
                  }}
                  onFocus={checkText}
                  title={`Draft this scene from its card (${modKey()}+G)${hasText ? `\n${afterText}` : ''}`}
                >
                  Generate
                </Button>
                <Button
                  variant="primary"
                  className="w-7 rounded-l-none border-l border-accent-fg/25 px-0!"
                  aria-label="Draft options"
                  title="Draft options: direction, length and creativity"
                  onClick={() => {
                    if (popover === 'options') setPopover(null)
                    else {
                      loadCard(true)
                      checkText()
                      setPopover('options')
                    }
                  }}
                >
                  <ChevronDown size={14} />
                </Button>
              </>
            )}
          </div>
        </P.Anchor>

        {/* Each panel is its own popover (keyed), so switching from one to another opens it afresh. */}
        {popover === 'choose' ? (
          <PopoverPanel
            key="choose"
            className="w-[340px]"
            onOpenAutoFocus={(e) => {
              // From the keyboard, Add below takes the keyboard: Enter then does what Ctrl+G always did,
              // and replacing the text takes a deliberate step. From a click, the panel does (nothing
              // looks picked before Adam picks it); Tab or the arrow keys then reach the answers.
              e.preventDefault()
              const panel = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
              const first = choiceByKey ? panel?.querySelector<HTMLElement>('[data-choice="add"]') : panel
              first?.focus({ preventScroll: true })
            }}
            onEscapeKeyDown={(e) => {
              // Asked from the draft options: Esc goes back to them, with the direction as it was.
              if (!choiceFromOptions) return
              e.preventDefault()
              setPopover('options')
            }}
            onKeyDown={(e) => {
              // Up and down move between the two answers.
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              const answers = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-choice]')]
              if (!answers.length) return
              e.preventDefault()
              const at = answers.indexOf(document.activeElement as HTMLElement)
              const step = e.key === 'ArrowDown' ? 1 : answers.length - 1
              const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : answers.length - 1) : (at + step) % answers.length
              answers[next].focus()
            }}
            onCloseAutoFocus={(e) => {
              // Back to where the keyboard was (the page, for Ctrl+G), unless Adam clicked somewhere else.
              // (This runs a moment after closing: if the choice was opened again since, it has the keyboard.)
              e.preventDefault()
              if (popoverRef.current === 'choose') return
              const back = beforeChoice.current
              beforeChoice.current = null
              const here = document.activeElement
              if (back?.isConnected && (!here || here === document.body)) back.focus({ preventScroll: true })
            }}
          >
            <div data-generate-controls>
              <h3 className="text-[13.5px] font-semibold text-fg">This scene already has text</h3>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">Where should the new draft go?</p>
              <div className="mt-3 flex flex-col gap-2">
                <ModeChoice
                  mode="replace"
                  icon={<RefreshCw size={14} />}
                  label="Replace it"
                  hint="The new draft takes its place."
                  keyboard={choiceByKey}
                  onClick={() => void generate('replace')}
                />
                <ModeChoice
                  mode="add"
                  icon={<ArrowDownToLine size={15} />}
                  label="Add below"
                  hint="The new draft goes below a scene break."
                  keyboard={choiceByKey}
                  onClick={() => void generate('add')}
                />
              </div>
              <p className="mt-3 text-[12px] text-faint">Either way, {modKey()}+Z undoes it.</p>
            </div>
          </PopoverPanel>
        ) : popover === 'need-model' ? (
          <PopoverPanel key="need-model" className="w-[300px]">
            <h3 className="text-[13.5px] font-semibold text-fg">Choose a writer model first</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              AI Write needs a model to write with. Connect OpenRouter or another provider, then pick a writer model.
            </p>
            <Button variant="primary" size="sm" className="mt-3" onClick={openSettings}>
              Open Settings › Models
            </Button>
          </PopoverPanel>
        ) : popover === 'options' ? (
          <PopoverPanel key="options" className="w-[340px]">
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-[13.5px] font-semibold text-fg">Draft options</h3>
                <p className="text-[12px] leading-relaxed text-muted">{hasText ? afterText : "For this scene's next draft."}</p>
              </div>
              <Field label="Direction for this draft (optional)">
                {(id) => (
                  <Textarea
                    id={id}
                    minRows={2}
                    maxRows={6}
                    value={opts.direction}
                    placeholder="Make it tense, end on the knock at the door"
                    onChange={(e) => updateOpts({ direction: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        void generate(undefined, true)
                      }
                    }}
                  />
                )}
              </Field>
              {cardPlanned === false && !opts.direction.trim() ? (
                <p className="-mt-2 text-[12px] leading-relaxed text-faint">
                  Tip: add a beat or two on the scene card, so the AI knows what happens in this scene.
                </p>
              ) : null}
              <div className="flex items-end gap-3">
                <Field label="Length" className="w-[132px]">
                  {(id) => (
                    <div className="relative">
                      <Input
                        id={id}
                        inputMode="numeric"
                        value={lengthText}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, '').slice(0, 5)
                          setLengthText(v)
                          const n = parseInt(v, 10)
                          if (n >= 100) updateOpts({ targetWords: Math.min(n, 12000) })
                        }}
                        onBlur={() => setLengthText(targetWords != null ? String(targetWords) : '')}
                        className="pr-12 tabular-nums"
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-faint">words</span>
                    </div>
                  )}
                </Field>
                <div className="mb-[7px] min-w-0 text-[12px]">
                  {opts.targetWords == null || opts.targetWords === cardWords ? (
                    <span className="text-faint">From the scene card</span>
                  ) : cardWords != null ? (
                    <button type="button" className="text-accent hover:underline" onClick={() => updateOpts({ targetWords: null })}>
                      Use the card's {cardWords.toLocaleString()}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-muted">Creativity</span>
                {fixedCreativity ? (
                  <p className="text-[12px] leading-relaxed text-faint">This model sets its own creativity, so there's nothing to choose here.</p>
                ) : (
                  <>
                    <Segmented label="Creativity" value={creativity} onChange={(c) => updateOpts({ creativity: c })} options={CREATIVITY_OPTIONS} className="w-full" />
                    <p className="text-[12px] text-faint">{CREATIVITY_HINTS[creativity]}</p>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[12px] text-muted">
                <span className="min-w-0 truncate">
                  Writer:{' '}
                  <button type="button" onClick={openSettings} className="font-medium text-fg hover:underline">
                    {modelName ?? 'none chosen'}
                  </button>
                </span>
                {estimate != null ? <span className="shrink-0 tabular-nums">About {formatCost(estimate)} a draft</span> : null}
              </div>
              <Button variant="primary" className="w-full" icon={<Sparkles size={14} />} onClick={() => void generate()}>
                Generate draft
                <span className="ml-1 text-[11.5px] font-normal opacity-70">{modKey()}+G</span>
              </Button>
            </div>
          </PopoverPanel>
        ) : null}
      </P.Root>
    </div>
  )
}
