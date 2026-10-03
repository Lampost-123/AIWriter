// The Generate button and its draft options, in the scene's toolbar.
// Generate (Ctrl+G) drafts the scene from its card into the editor; while it
// streams the button becomes Stop (Esc also stops) and the text so far stays.
// The draft itself is kept in draftRun.ts, so it keeps writing into its scene while
// Adam opens another one, and this button shows Stop again when he comes back.
// When the scene already has text, Generate first asks whether the new draft
// replaces it or goes below it. Once picked, the keyboard goes into the page, and
// Ctrl+Z on the Generate button works there too, so "Ctrl+Z undoes it" holds.
import * as P from '@radix-ui/react-popover'
import { ArrowDownToLine, ChevronDown, RefreshCw, Sparkles, Square } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Creativity, ID } from '@shared/types'
import { AUTO_LENGTH, cardLength, CREATIVITY_PRESETS } from '@shared/defaults'
import { Button, Field, Textarea, toast } from '@/components/ui'
import { api, modKey } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { escapeTaken } from '@/lib/escape'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { isWriting, setOf, useVariants } from '@/features/variants/store'
import { BLANK_DRAFT_OPTIONS, draftLength, type SceneDraftOptions } from './draftOptions'
import { LengthField } from './LengthField'
import { busyElsewhere, listenForDrafts, startDraft, stopDraft, useDraft } from './draftRun'
import { CREATIVITY_HINTS, estimateDraftCost, formatCost, shortModelName } from './format'
import { costLabel } from '@/features/variants/cost'
import { PopoverPanel, Segmented, useDelayed } from './parts'

/** Where a draft goes in a scene that already has text: in place of it, or after it. */
type DraftMode = 'replace' | 'add'

const CREATIVITY_OPTIONS = (Object.keys(CREATIVITY_PRESETS) as Creativity[]).map((k) => ({ value: k, label: CREATIVITY_PRESETS[k].label }))

/**
 * Below this header width the writer model's name is left out, so Generate always fits and the scene's
 * title stays whole beside the scene's tools (Variants, Beat by beat, History, Listen).
 */
const COMPACT_BELOW = 640

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
  /** The scene card's length: a word count, null for Auto, undefined until loaded. */
  const [cardWords, setCardWords] = useState<number | null | undefined>(undefined)
  /** The scene card says what happens (beats, a goal, an outcome or notes). Null until loaded. */
  const [cardPlanned, setCardPlanned] = useState<boolean | null>(null)
  /** The page already has writing on it, so Generate asks whether the new draft replaces it or goes after it. */
  const [hasText, setHasText] = useState(false)
  // This scene's draft, if Generate is writing one (it carries on while Adam is in another scene).
  const phase = useDraft((d) => (d.sceneId === sceneId ? d.phase : 'idle'))
  const retrying = useDraft((d) => (d.sceneId === sceneId ? d.retrying : null))
  const panelAsked = useDraft((d) => (d.panel?.sceneId === sceneId ? d.panel.which : null))
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

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const popoverRef = useRef(popover)
  popoverRef.current = popover
  const creativity = opts.creativity ?? defaultCreativity
  /** The length this draft will aim for; null is Auto. */
  const targetWords = draftLength(opts, cardWords ?? null)

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
          setCardWords(cardLength(s.card))
          const c = s.card
          setCardPlanned(c.beats.some((b) => b.trim() !== '') || [c.goal, c.outcome, c.notes].some((t) => t.trim() !== ''))
        })
        .catch(() => undefined)
    },
    [sceneId]
  )

  useEffect(() => {
    setCardWords(undefined)
    setCardPlanned(null)
    setEstimate(null)
    lastCardLoad.current = 0
    loadCard(true)
  }, [sceneId, loadCard])

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
    if (!writerKey || !hasPrices || cardWords === undefined) {
      setEstimate(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      api
        .previewContext(sceneId, { direction: opts.direction, targetWords, creativity })
        // Auto is estimated at a typical scene's length.
        .then((p) => live && setEstimate(estimateDraftCost(p.budget.used, targetWords ?? AUTO_LENGTH.typical, { promptPrice, completionPrice })))
        .catch(() => live && setEstimate(null))
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [sceneId, writerKey, hasPrices, promptPrice, completionPrice, cardWords, targetWords, opts.direction, creativity, estimateRev])

  // ---------- Streaming ----------

  useEffect(listenForDrafts, [])

  // A message's button asked for this scene's draft options, or for a writer model.
  useEffect(() => {
    if (!panelAsked) return
    useDraft.setState({ panel: null })
    if (panelAsked === 'options') {
      loadCard(true)
      checkText()
    }
    setPopover(panelAsked)
  }, [panelAsked, loadCard, checkText])

  // A draft has ended: the card may have changed meanwhile, so the next look reads it again.
  useEffect(() => {
    if (phase === 'idle') lastCardLoad.current = 0
  }, [phase])

  /**
   * Drafts the scene. When it already has text and `mode` isn't given, it first asks whether the new
   * draft replaces that text or goes below it (nothing is sent until Adam answers). `byKey`: asked
   * from the keyboard.
   */
  const generate = useCallback((mode?: DraftMode, byKey = false) => {
    if (phaseRef.current !== 'idle') return
    // One draft at a time: one still being written into another scene says where it is.
    if (busyElsewhere(sceneId)) return
    if (!useApp.getState().settings?.models.writer) {
      setPopover('need-model')
      return
    }
    const bridge = editorBridge()
    if (!bridge || bridge.sceneId !== sceneId) {
      toast('Open this scene in the editor to draft into it.')
      return
    }
    // Milestone 4: while the scene's variants are being written, say so before asking anything.
    if (isWriting(setOf(useVariants.getState(), sceneId))) {
      toast('Variants of this scene are being written. Stop them on the Variants page, or wait for them to finish.')
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
    setPopover(null)
    void startDraft(sceneId, bridge, {
      replace: mode === 'replace' && filled,
      takeKeyboard: !!mode,
      options: () => useApp.getState().draftOptions[sceneId] ?? BLANK_DRAFT_OPTIONS
    })
  }, [sceneId])

  const stop = stopDraft

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
        // Under a dialog, a menu or the Add to memory form it does nothing (it would draft into the scene
        // behind them); from Generate's own panels (the draft options) it drafts.
        if (layerOpen() && popoverRef.current === null) return
        if (phaseRef.current === 'idle') void generateRef.current(undefined, true)
        return
      }
      // The page takes Esc for itself (and marks it handled), but there it stops the draft too, as Stop
      // says. An Esc that closed the "Selected words" bar or the floating binder did only that.
      const escape = e.key === 'Escape' && !e.isComposing && phaseRef.current !== 'idle' && !escapeTaken(e)
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
              <LengthField value={opts.targetWords} cardWords={cardWords} onChange={(targetWords) => updateOpts({ targetWords })} />
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
                {estimate != null ? (
                  <span className="shrink-0 tabular-nums">{estimate === 0 ? 'Free' : `${costLabel(estimate, true)} a draft`}</span>
                ) : null}
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
