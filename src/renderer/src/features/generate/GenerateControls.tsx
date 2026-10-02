// The Generate button and its draft options, in the scene's toolbar.
// Generate (Ctrl+G) drafts the scene from its card into the editor; while it
// streams the button becomes Stop (Esc also stops) and the text so far stays.
import * as P from '@radix-ui/react-popover'
import { ChevronDown, Sparkles, Square } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { AppEvents } from '@shared/api'
import type { Creativity, DraftOptions, ID } from '@shared/types'
import { CREATIVITY_PRESETS } from '@shared/defaults'
import { Button, Field, Input, Textarea, toast } from '@/components/ui'
import { api, ApiError, modKey, onEvent } from '@/lib/api'
import { editorBridge, type EditorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { CREATIVITY_HINTS, estimateDraftCost, formatCost, shortModelName } from './format'
import { PopoverPanel, Segmented } from './parts'

interface SceneDraftOptions {
  direction: string
  /** Null: use the scene card's target length. */
  targetWords: number | null
  /** Null: use the default from Settings. */
  creativity: Creativity | null
}

const BLANK: SceneDraftOptions = { direction: '', targetWords: null, creativity: null }
/** Each scene's draft options, kept while the app is open. */
const remembered = new Map<ID, SceneDraftOptions>()

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

/** Something else (a menu, a dialog, a popover) is open and should get Esc first. */
const layerOpen = (): boolean => !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')

export function GenerateControls({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const defaultCreativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const navigate = useApp((s) => s.navigate)

  const [opts, setOpts] = useState<SceneDraftOptions>(() => remembered.get(sceneId) ?? BLANK)
  const [lengthText, setLengthText] = useState('')
  const [cardWords, setCardWords] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [popover, setPopover] = useState<'options' | 'need-model' | null>(null)
  const [estimate, setEstimate] = useState<number | null>(null)
  /** Bumped when the card may have changed, so the estimate is worked out again. */
  const [estimateRev, setEstimateRev] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const compact = useNarrowHeader(rootRef)

  const session = useRef<Session | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
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
          if (s.id === sceneId) setCardWords(s.card.targetWords)
        })
        .catch(() => undefined)
    },
    [sceneId]
  )

  useEffect(() => {
    const o = remembered.get(sceneId) ?? BLANK
    setOpts(o)
    setCardWords(null)
    setEstimate(null)
    lastCardLoad.current = 0
    loadCard(true)
  }, [sceneId, loadCard])

  useEffect(() => {
    setLengthText(targetWords != null ? String(targetWords) : '')
  }, [targetWords])

  const updateOpts = (patch: Partial<SceneDraftOptions>): void => {
    setOpts((o) => {
      const next = { ...o, ...patch }
      remembered.set(sceneId, next)
      return next
    })
  }

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

  const finish = useCallback(
    (p: AppEvents['generation:done']) => {
      const s = session.current
      if (!s || s.generationId !== p.generationId) return
      s.bridge.endStream(p.generationId)
      session.current = null
      setPhase('idle')
      setRetrying(null)
      const app = useApp.getState()
      if (app.activeGeneration?.id === p.generationId) app.setActiveGeneration(null)
      if (p.status === 'error' && p.error) {
        toast(p.error, { tone: 'danger', action: { label: 'What the AI saw', run: () => navigate({ kind: 'generation', generationId: p.generationId }) } })
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

  const generate = useCallback(async () => {
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
    setPopover(null)
    setPhase('starting')
    const s: Session = { sceneId, bridge, generationId: null, early: [], earlyDone: null, cancelled: false }
    session.current = s
    try {
      // Save the card and the page first, so the draft is built from the latest of both.
      await flushAll()
      const card = (await api.getScene(sceneId)).card
      const o = optsRef.current
      const options: DraftOptions = {
        direction: o.direction.trim(),
        targetWords: o.targetWords ?? card.targetWords,
        creativity: o.creativity ?? useApp.getState().settings?.creativity ?? 'balanced'
      }
      if (s.cancelled) {
        if (session.current === s) session.current = null
        setPhase('idle')
        return
      }
      const { generationId } = await api.startDraft(sceneId, options)
      if (s.cancelled || session.current !== s) {
        void api.stopGeneration(generationId).catch(() => undefined)
        if (session.current === s) session.current = null
        setPhase('idle')
        return
      }
      if (!bridge.beginStream(sceneId, generationId)) {
        session.current = null
        setPhase('idle')
        void api.stopGeneration(generationId).catch(() => undefined)
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
      if (session.current === s) session.current = null
      setPhase('idle')
      const err = e as ApiError
      if (err.code === 'no-writer-model') setPopover('need-model')
      else toast(err.message, { tone: 'danger', action: err.code === 'no-key' ? { label: 'Open Settings', run: openSettings } : undefined })
    }
  }, [sceneId, finish, openSettings])

  const stop = useCallback(() => {
    const s = session.current
    if (!s) return
    if (!s.generationId) {
      // Still starting: it stops as soon as it has begun.
      s.cancelled = true
      setPhase('stopping')
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
      }
    }
  }, [sceneId])

  // Ctrl+G generates; Esc stops.
  const generateRef = useRef(generate)
  generateRef.current = generate
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        if (phaseRef.current === 'idle') void generateRef.current()
        return
      }
      if (e.key === 'Escape' && phaseRef.current !== 'idle' && !e.defaultPrevented && !layerOpen()) stopRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------- View ----------

  const busy = phase !== 'idle'
  const modelName = writer ? shortModelName(writer.label || writer.modelId) : null
  const status = retrying ? 'Retrying…' : phase === 'stopping' ? 'Stopping…' : 'Writing…'

  return (
    <div ref={rootRef} className="flex items-center gap-1.5">
      {compact ? (
        // Narrow header: only the amber light while writing (its slot is always kept, so nothing moves).
        <span role="status" title={busy ? (retrying ?? status) : undefined} className="flex h-8 w-4 items-center justify-center">
          {busy ? (
            <>
              <span className="h-2 w-2 rounded-full bg-ai animate-pulse" aria-hidden />
              <span className="sr-only">{status}</span>
            </>
          ) : null}
        </span>
      ) : (
        <div className="relative flex h-8 min-w-[104px] items-center justify-end">
          <button
            type="button"
            onClick={openSettings}
            tabIndex={busy ? -1 : 0}
            title={writer ? `Writer model: ${writer.label || writer.modelId}. Change it in Settings > Models.` : 'Choose a writer model in Settings > Models.'}
            className={cn(
              'flex h-7 max-w-[230px] items-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg',
              busy && 'invisible'
            )}
          >
            <span className="truncate">{modelName ?? 'No writer model'}</span>
            {writer && hasPrices ? (
              <span className="w-[50px] shrink-0 text-left tabular-nums text-faint" title="Estimated cost of a draft">
                {estimate != null ? `· ${formatCost(estimate)}` : ''}
              </span>
            ) : null}
          </button>
          {busy ? (
            <span
              role="status"
              title={retrying ?? undefined}
              className="absolute inset-y-0 right-0 flex items-center gap-2 pr-2 text-[12.5px] font-medium text-ai animate-fade-in"
            >
              <span className="h-2 w-2 rounded-full bg-ai animate-pulse" aria-hidden />
              {status}
            </span>
          ) : null}
        </div>
      )}

      <P.Root open={popover !== null} onOpenChange={(o) => !o && setPopover(null)}>
        <P.Anchor asChild>
          <div className="flex w-[132px] shrink-0">
            {busy ? (
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
                  onPointerEnter={() => loadCard()}
                  title={`Draft this scene from its card (${modKey()}+G)`}
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

        {popover === 'need-model' ? (
          <PopoverPanel className="w-[300px]">
            <h3 className="text-[13.5px] font-semibold text-fg">Choose a writer model first</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              AI Write needs a model to write with. Connect OpenRouter or another provider, then pick a writer model.
            </p>
            <Button variant="primary" size="sm" className="mt-3" onClick={openSettings}>
              Open Settings › Models
            </Button>
          </PopoverPanel>
        ) : popover === 'options' ? (
          <PopoverPanel className="w-[340px]">
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-[13.5px] font-semibold text-fg">Draft options</h3>
                <p className="text-[12px] text-muted">For this scene's next draft.</p>
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
                        void generate()
                      }
                    }}
                  />
                )}
              </Field>
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
                <Segmented label="Creativity" value={creativity} onChange={(c) => updateOpts({ creativity: c })} options={CREATIVITY_OPTIONS} className="w-full" />
                <p className="text-[12px] text-faint">{CREATIVITY_HINTS[creativity]}</p>
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
