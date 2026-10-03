// Before a set of variants starts: how many (two or three, remembered), the scene's draft options (the
// same ones Generate and the Context tab use, so a direction typed here is there too), the writer model
// and what the set should cost. Problems starting show here in plain words, with the way to fix them.
import { Columns3, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Creativity, ID } from '@shared/types'
import type { VariantCount } from '@shared/contracts/variants'
import { AUTO_LENGTH, cardLength, CREATIVITY_PRESETS } from '@shared/defaults'
import { Button, Card, Field, Notice, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { BLANK_DRAFT_OPTIONS, draftLength, resolveDraftOptions, type SceneDraftOptions } from '@/features/generate/draftOptions'
import { LengthField } from '@/features/generate/LengthField'
import { CREATIVITY_HINTS, estimateDraftCost, shortModelName } from '@/features/generate/format'
import { Segmented } from '@/features/generate/parts'
import { costLabel } from './cost'
import { clearProblem, startVariants, useVariants } from './store'

const CREATIVITY_OPTIONS = (Object.keys(CREATIVITY_PRESETS) as Creativity[]).map((k) => ({ value: k, label: CREATIVITY_PRESETS[k].label }))
const COUNT_OPTIONS: { value: '2' | '3'; label: string }[] = [
  { value: '2', label: 'Two' },
  { value: '3', label: 'Three' }
]

/** How many variants Adam wrote last time (three until he picks). */
const COUNT_KEY = 'aiwrite.variants.count'
function lastCount(): VariantCount {
  try {
    return localStorage.getItem(COUNT_KEY) === '2' ? 2 : 3
  } catch {
    return 3
  }
}
function rememberCount(n: VariantCount): void {
  try {
    localStorage.setItem(COUNT_KEY, String(n))
  } catch {
    // Remembering it is only a convenience.
  }
}

export function StartPanel({
  sceneId,
  sceneTitle,
  hasSet,
  focus = 'direction',
  onCancel,
  onAsking,
  onStarted
}: {
  sceneId: ID
  sceneTitle: string | null
  /** The scene has a set of variants already (shown again with Cancel). */
  hasSet: boolean
  /** Where the keyboard starts: the direction, or the length (when the model had a problem with it). */
  focus?: 'direction' | 'length'
  onCancel: () => void
  /** The set is about to be asked for (its columns may take this panel's place). */
  onAsking?: () => void
  /** The start has run its course: started, called off, or failed (the problem shows here). */
  onStarted: (result: 'started' | 'cancelled' | 'failed') => void
}): React.JSX.Element {
  const writer = useApp((s) => s.settings?.models.writer ?? null)
  const defaultCreativity = useApp((s) => s.settings?.creativity ?? 'balanced')
  const opts = useApp((s) => s.draftOptions[sceneId] ?? BLANK_DRAFT_OPTIONS)
  /** Generate is writing into this scene: its draft has the scene for now. */
  const generating = useApp((s) => s.activeGeneration?.sceneId === sceneId)
  const problem = useVariants((s) => s.problems[sceneId] ?? null)
  const navigate = useApp((s) => s.navigate)

  const [count, setCount] = useState<VariantCount>(lastCount)
  /** The scene card's length: a word count, null for Auto, undefined until loaded. */
  const [cardWords, setCardWords] = useState<number | null | undefined>(undefined)
  const [cardPlanned, setCardPlanned] = useState<boolean | null>(null)
  const [estimate, setEstimate] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  /** Shown here before anything is sent: there is no writer model to write with. */
  const [needModel, setNeedModel] = useState(false)
  const lengthRef = useRef<HTMLInputElement>(null)
  const directionRef = useRef<HTMLTextAreaElement>(null)

  const creativity = opts.creativity ?? defaultCreativity
  /** The length each variant will aim for; null is Auto. */
  const targetWords = draftLength(opts, cardWords ?? null)
  const updateOpts = (patch: Partial<SceneDraftOptions>): void => {
    useApp.getState().setDraftOptions(sceneId, patch)
    clearProblem(sceneId)
  }

  useEffect(() => {
    let live = true
    api
      .getScene(sceneId)
      .then((s) => {
        if (!live) return
        const c = s.card
        setCardWords(cardLength(c))
        setCardPlanned(c.beats.some((b) => b.trim() !== '') || [c.goal, c.outcome, c.notes].some((t) => t.trim() !== ''))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [sceneId])

  useEffect(() => {
    if (writer) setNeedModel(false)
  }, [writer])

  /** The keyboard goes to the length box, its number selected, ready to type another. */
  const toLength = (): void => {
    lengthRef.current?.focus()
    lengthRef.current?.select()
  }
  /** Opened to change the length: its number is selected once it shows (the scene card is read first). */
  const selectLength = useRef(focus === 'length')

  // The keyboard starts in the direction box, ready to type (or in the length box, to change it).
  useEffect(() => {
    if (focus === 'length') toLength()
    else directionRef.current?.focus({ preventScroll: true })
  }, [focus])
  useLayoutEffect(() => {
    if (!selectLength.current || targetWords == null) return
    selectLength.current = false
    if (document.activeElement === lengthRef.current) lengthRef.current?.select()
  }, [targetWords])

  // A problem shows below the buttons, so nothing Adam is looking at moves; the panel scrolls just
  // enough to show it when it is out of sight (in a small window, say).
  const noticeRef = useRef<HTMLDivElement>(null)
  const shownProblem = needModel ? 'need-model' : (problem?.message ?? null)
  useEffect(() => {
    if (shownProblem) noticeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [shownProblem])

  // What the whole set should cost, for models with prices: the briefing and the length, once per variant.
  const promptPrice = writer?.promptPrice ?? null
  const completionPrice = writer?.completionPrice ?? null
  const writerKey = writer ? `${writer.providerId}/${writer.modelId}/${writer.contextLength ?? ''}` : null
  useEffect(() => {
    if (!writerKey || promptPrice == null || completionPrice == null || cardWords === undefined) {
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
  }, [sceneId, writerKey, promptPrice, completionPrice, cardWords, targetWords, opts.direction, creativity])

  const start = async (): Promise<void> => {
    if (starting || generating) return
    if (!useApp.getState().settings?.models.writer) {
      setNeedModel(true)
      return
    }
    setStarting(true)
    clearProblem(sceneId)
    try {
      // The page and the card are saved first, so the variants are written from the latest of both.
      await flushAll()
      const card = (await api.getScene(sceneId)).card
      const options = resolveDraftOptions(
        useApp.getState().draftOptions[sceneId],
        cardLength(card),
        useApp.getState().settings?.creativity ?? 'balanced'
      )
      rememberCount(count)
      // The columns show once the set is on its way (this panel goes); this says how it went.
      onAsking?.()
      onStarted(await startVariants(sceneId, count, options))
    } catch {
      // The scene couldn't be read: startVariants was never called, so say so here.
      useVariants.setState((s) => ({
        problems: { ...s.problems, [sceneId]: { message: "The scene couldn't be read just now. Try again in a moment.", fixes: [] } }
      }))
      onStarted('failed')
    } finally {
      setStarting(false)
    }
  }

  const fixedCreativity = writer?.sampling === false
  const modelName = writer ? shortModelName(writer.label || writer.modelId) : null
  const howMany = count === 2 ? 'both' : 'all three'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[560px] px-6 pb-16 pt-[6vh]">
        <div className="mb-5 flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted" aria-hidden>
            <Columns3 size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-fg">{hasSet ? 'New variants' : 'No variants of this scene yet'}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Write two or three drafts of {sceneTitle ? `“${sceneTitle}”` : 'this scene'} side by side, from the same briefing. Then use
              the one you like best, or pick the best paragraphs from each. Nothing goes into the scene until you choose.
            </p>
          </div>
        </div>

        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">How many variants</span>
            <Segmented
              label="How many variants"
              value={String(count) as '2' | '3'}
              onChange={(v) => setCount(v === '2' ? 2 : 3)}
              options={COUNT_OPTIONS}
              className="w-[200px]"
            />
          </div>

          <Field label="Direction for these drafts (optional)">
            {(id) => (
              <Textarea
                id={id}
                ref={directionRef}
                minRows={2}
                maxRows={6}
                value={opts.direction}
                placeholder="Make it tense, end on the knock at the door"
                onChange={(e) => updateOpts({ direction: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void start()
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

          <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
            <LengthField
              label="Length of each"
              value={opts.targetWords}
              cardWords={cardWords}
              onChange={(targetWords) => updateOpts({ targetWords })}
              inputRef={lengthRef}
              onTyped={() => (selectLength.current = false)}
            />
            <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted">Creativity</span>
              {fixedCreativity ? (
                <p className="text-[12px] leading-relaxed text-faint">
                  This model sets its own creativity, so there's nothing to choose here.
                </p>
              ) : (
                <Segmented
                  label="Creativity"
                  value={creativity}
                  onChange={(c) => updateOpts({ creativity: c })}
                  options={CREATIVITY_OPTIONS}
                  className="w-full"
                />
              )}
            </div>
          </div>
          {!fixedCreativity ? <p className="-mt-2 text-[12px] text-faint">{CREATIVITY_HINTS[creativity]}</p> : null}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[12px] text-muted">
            <span className="min-w-0 truncate">
              Writer:{' '}
              <button
                type="button"
                onClick={() => navigate({ kind: 'settings', tab: 'models' })}
                className="font-medium text-fg hover:underline"
              >
                {modelName ?? 'none chosen'}
              </button>
            </span>
            {estimate != null ? (
              <span className="shrink-0 tabular-nums" title="The briefing and the length, for each variant, at the writer model's prices">
                {costLabel(estimate * count, true)} for {howMany}
              </span>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            {hasSet ? (
              <Button variant="ghost" onClick={onCancel} disabled={starting}>
                Cancel
              </Button>
            ) : null}
            <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => void start()} disabled={generating} loading={starting}>
              {count === 2 ? 'Write two variants' : 'Write three variants'}
            </Button>
          </div>

          {/* Below the buttons, so the one just pressed stays where it is. */}
          {needModel || problem || generating ? (
            <div ref={noticeRef} className="scroll-mb-4">
              {needModel ? (
                <Notice
                  tone="danger"
                  action={
                    <Button size="sm" onClick={() => navigate({ kind: 'settings', tab: 'models' })}>
                      Open Settings › Models
                    </Button>
                  }
                >
                  Choose a writer model first. AI Write needs a model to write with: connect OpenRouter or another provider, then pick a
                  writer model.
                </Notice>
              ) : problem ? (
                <Notice tone="danger">
                  <p>{problem.message}</p>
                  {problem.fixes.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {problem.fixes.map((f) =>
                        f === 'length' ? (
                          <Button key={f} size="sm" onClick={toLength}>
                            Change the length
                          </Button>
                        ) : (
                          <Button key={f} size="sm" onClick={() => navigate({ kind: 'settings', tab: 'models' })}>
                            Open Settings
                          </Button>
                        )
                      )}
                    </div>
                  ) : null}
                </Notice>
              ) : (
                <Notice>A draft is being written into this scene. Stop it first, or wait for it to finish, then write the variants.</Notice>
              )}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
