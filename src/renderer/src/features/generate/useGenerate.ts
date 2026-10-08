// Generate's workings for one scene, shared by the Generate button in the scene's toolbar (GenerateControls, Classic and
// the panels) and by the desk's AI dock (features/desk/dock): the card's length and whether it is planned, the draft
// options and their estimated cost, what the draft is doing (getting ready, writing, polishing, stopping) and how many
// words it has written, which of its panels is open (the "already has text" choice, the draft options, "choose a writer
// model"), and generate() itself. With `keys`, it also listens for Ctrl+G (Generate), Esc (stop the draft) and Ctrl+Z on
// Generate (undo in the page): exactly one mounted user of the hook should ask for them, or a key would act twice.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Creativity, ID, ModelChoice } from '@shared/types'
import { AUTO_LENGTH, cardLength } from '@shared/defaults'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { escapeTaken } from '@/lib/escape'
import { layerOpen } from '@/lib/layers'
import { useApp } from '@/lib/store'
import { isWriting, setOf, useVariants } from '@/features/variants/store'
import { useNewLook } from '@/features/look/look'
import { BLANK_DRAFT_OPTIONS, draftLength, type SceneDraftOptions } from './draftOptions'
import { busyElsewhere, listenForDrafts, startDraft, stopDraft, useDraft, type Phase } from './draftRun'
import { usePolish } from './polishRun'
import { withPolish } from './polish'
import { estimateDraftCost, shortModelName } from './format'
import { useDelayed } from './parts'

/** Where a draft goes in a scene that already has text: in place of it, or after it. */
export type DraftMode = 'replace' | 'fresh' | 'add'

/** Which of Generate's panels is open. */
export type GeneratePopover = 'options' | 'need-model' | 'choose' | null

/** The key was pressed in the manuscript page. */
const inPage = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.ProseMirror')

/** The keyboard isn't in anything that takes keys itself: nowhere in particular, or on Generate and its choice. */
const keyboardIdle = (t: EventTarget | null): boolean =>
  !t || t === document.body || t === document.documentElement || (t instanceof Element && !!t.closest('[data-generate-controls]'))

export interface GenerateOptions {
  /** Listen for Ctrl+G, Esc and Ctrl+Z (one user of the hook at a time). */
  keys?: boolean
  /**
   * A direction given just for the next draft (the desk's steer box): used in place of the draft options' Direction
   * when it has words, and `taken` once the draft has started with it.
   */
  steer?: { get: () => string; taken: () => void }
}

export interface Generate {
  sceneId: ID
  writer: ModelChoice | null
  /** The phase of this scene's draft, or of its polish pass. */
  phase: Phase | 'polishing'
  busy: boolean
  polishOn: boolean
  retrying: string | null
  popover: GeneratePopover
  setPopover: (p: GeneratePopover) => void
  popoverRef: MutableRefObject<GeneratePopover>
  /** Where the keyboard was before the "already has text" choice opened, so closing it puts it back there. */
  beforeChoice: MutableRefObject<HTMLElement | null>
  /** The choice was opened from the keyboard (Ctrl+G): Add below takes the keyboard, ready for Enter. */
  choiceByKey: boolean
  /** The choice took the place of the draft options: Esc goes back to them. */
  choiceFromOptions: boolean
  opts: SceneDraftOptions
  updateOpts: (patch: Partial<SceneDraftOptions>) => void
  /** The scene card's length: a word count, null for Auto, undefined until loaded. */
  cardWords: number | null | undefined
  /** The scene card says what happens. Null until loaded. */
  cardPlanned: boolean | null
  /** The page already has writing on it. */
  hasText: boolean
  checkText: () => void
  loadCard: (force?: boolean) => void
  creativity: Creativity
  /** The length this draft will aim for; null is Auto. */
  targetWords: number | null
  hasPrices: boolean
  /** The estimated cost of a draft, with the polish pass when it is on; null when unknown. */
  draftCost: number | null
  modelName: string | null
  /** The model sets its own creativity. */
  fixedCreativity: boolean
  openSettings: () => void
  /**
   * Drafts the scene. When it already has text and `mode` isn't given, it first asks whether the new draft replaces that
   * text or goes below it (nothing is sent until Adam answers). `byKey`: asked from the keyboard.
   */
  generate: (mode?: DraftMode, byKey?: boolean) => void
  stop: () => void
  /** The New look: the words the draft has written so far, while it streams. */
  written: number | null
  /** What the draft is doing, in a few words ("Writing…", "Updating memory…"), and why, for its tooltip. */
  status: string
  statusTitle: string | undefined
  /** The status is worth showing (a quick start shows none). */
  showStatus: boolean
}

export function useGenerate(sceneId: ID, o: GenerateOptions = {}): Generate {
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const defaultCreativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const navigate = useApp((s) => s.navigate)

  // Kept in the store (each scene's own), so the Context tab previews the briefing with the same options.
  const opts = useApp((s) => s.draftOptions[sceneId] ?? BLANK_DRAFT_OPTIONS)
  const [cardWords, setCardWords] = useState<number | null | undefined>(undefined)
  const [cardPlanned, setCardPlanned] = useState<boolean | null>(null)
  const [hasText, setHasText] = useState(false)
  // This scene's draft, if Generate is writing one (it carries on while Adam is in another scene), or its polish pass.
  const draftPhase = useDraft((d) => (d.sceneId === sceneId ? d.phase : 'idle'))
  const polishPhase = usePolish((p) => (p.sceneId === sceneId ? (p.stopping ? 'stopping' : 'polishing') : null))
  const phase = draftPhase !== 'idle' ? draftPhase : (polishPhase ?? 'idle')
  const polishOn = usePolish((p) => p.on)
  const retrying = useDraft((d) => (d.sceneId === sceneId ? d.retrying : null))
  const panelAsked = useDraft((d) => (d.panel?.sceneId === sceneId ? d.panel.which : null))
  const [popover, setPopover] = useState<GeneratePopover>(null)
  const beforeChoice = useRef<HTMLElement | null>(null)
  const [choiceByKey, setChoiceByKey] = useState(false)
  const [choiceFromOptions, setChoiceFromOptions] = useState(false)
  const [estimate, setEstimate] = useState<number | null>(null)
  /** Bumped when the card may have changed, so the estimate is worked out again. */
  const [estimateRev, setEstimateRev] = useState(0)

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const popoverRef = useRef(popover)
  popoverRef.current = popover
  const steerRef = useRef(o.steer)
  steerRef.current = o.steer
  const creativity = opts.creativity ?? defaultCreativity
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

  const updateOpts = useCallback((patch: Partial<SceneDraftOptions>): void => useApp.getState().setDraftOptions(sceneId, patch), [sceneId])

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

  const generate = useCallback(
    (mode?: DraftMode, byKey = false) => {
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
      // The desk's steer box: its words steer this draft (in place of the options' Direction), once.
      const steer = steerRef.current
      const steered = steer?.get().trim() ?? ''
      void startDraft(sceneId, bridge, {
        replace: (mode === 'replace' || mode === 'fresh') && filled,
        takeKeyboard: !!mode,
        // A fresh take doesn't build on what the earlier draft established; Add below carries on from the scene's words.
        options: () => ({
          ...(useApp.getState().draftOptions[sceneId] ?? BLANK_DRAFT_OPTIONS),
          ...(steered ? { direction: steered } : {}),
          ...(mode === 'fresh' ? { fresh: true } : {}),
          ...(mode === 'add' && filled ? { addBelow: true } : {})
        })
      })
      if (steered) steer?.taken()
    },
    [sceneId]
  )

  const stop = stopDraft

  // Ctrl+G generates; Esc stops; Ctrl+Z on Generate (or with the keyboard nowhere in particular) undoes in the page.
  const generateRef = useRef(generate)
  generateRef.current = generate
  const stopRef = useRef(stop)
  stopRef.current = stop
  const sceneIdRef = useRef(sceneId)
  sceneIdRef.current = sceneId
  const keys = !!o.keys
  useEffect(() => {
    if (!keys) return
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
  }, [keys])

  // ---------- What it is doing ----------

  const busy = phase !== 'idle'
  // The New look: while the draft streams, a live count of the words it has written so far (the words themselves never
  // animate), from the scene's count when it began (a draft that replaces the text starts again from nothing).
  const isNew = useNewLook()
  const sceneWords = useApp((s) => (s.sceneId === sceneId ? s.sceneWords : null))
  const [base, setBase] = useState<number | null>(null)
  useEffect(() => {
    if (phase !== 'streaming') return setBase(null)
    setBase((b) => b ?? useApp.getState().sceneWords)
  }, [phase])
  const written = isNew && phase === 'streaming' && base !== null && sceneWords !== null ? (sceneWords >= base ? sceneWords - base : sceneWords) : null
  // Before a draft starts, the memory first reads any earlier scenes it hasn't caught up with, which
  // can take a little while; the status then says why, and Stop (or Esc) calls the draft off before
  // anything is sent. A quick start shows no status at all.
  const memoryReading = useApp((s) => !!s.memoryStatus?.reading)
  const startingSlow = useDelayed(phase === 'starting', 700)
  const showStatus = phase === 'streaming' || phase === 'stopping' || phase === 'polishing' || startingSlow
  // The polish pass reads the draft and writes it again, so a draft costs about twice as much with it.
  const draftCost = estimate != null ? withPolish(estimate, polishOn) : null
  // Some models (OpenAI's reasoning models, for one) set their own creativity and take no setting for it.
  const fixedCreativity = writer?.sampling === false
  const modelName = writer ? shortModelName(writer.label || writer.modelId) : null
  const status =
    phase === 'starting'
      ? memoryReading
        ? 'Updating memory…'
        : 'Getting ready…'
      : phase === 'polishing'
        ? 'Polishing…'
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
      : phase === 'polishing'
        ? 'The draft is written. A second pass is polishing it; you can accept or reject the result.'
        : (retrying ?? undefined)

  return {
    sceneId,
    writer,
    phase,
    busy,
    polishOn,
    retrying,
    popover,
    setPopover,
    popoverRef,
    beforeChoice,
    choiceByKey,
    choiceFromOptions,
    opts,
    updateOpts,
    cardWords,
    cardPlanned,
    hasText,
    checkText,
    loadCard,
    creativity,
    targetWords,
    hasPrices,
    draftCost,
    modelName,
    fixedCreativity,
    openSettings,
    generate,
    stop,
    written,
    status,
    statusTitle,
    showStatus
  }
}
