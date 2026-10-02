// Guided: Adam walks the steps himself, with AI help only where he wants it. A rail of steps on the
// left (each empty, partly done or complete), the step's fields in the middle, and the AI's actions
// in a slim bar under them. The entry is made once it has a name and then saves itself as he types.
import { ArrowLeft, ArrowRight, MessageCircle, Sparkles, Square } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { BuilderDone, BuilderKind, BuilderProgress, BuilderValues, InterviewTurn } from '@shared/contracts/builder'
import type { Entry } from '@shared/types'
import { Button, toast } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { KIND_ICONS } from '@/features/world/kindIcons'
import { splitChanges } from '@/features/world/memoryLogic'
import { RelationshipsSection } from '@/features/world/memory/RelationshipsSection'
import { useEntryData } from '@/features/world/memory/useEntryData'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useSceneLabels } from '@/features/world/useSceneLabels'
import { fleshOutKeys, openSuggestions, STATUS_WORDS, stepStatus, stepsFor, withSampleLine, type Step } from './builderLogic'
import { InterviewPanel } from './Interview'
import { settingsAction, StatusIcon, useWorldEntries, WritingStatus } from './parts'
import { Review, type RelationLine } from './Review'
import { StepFields, type OptionsState } from './StepFields'
import { useBuildDraft } from './useBuildDraft'
import { useBuilderJob } from './useBuilderJob'

const omit = (v: BuilderValues, keys: string[]): BuilderValues => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)))
const pick = (v: BuilderValues, keys: string[]): BuilderValues => Object.fromEntries(Object.entries(v).filter(([k]) => keys.includes(k)))
const suggestionsWord = (n: number): string => (n === 1 ? 'One suggestion' : `${n} suggestions`)

export function Guided({
  kind,
  initial,
  firstStep,
  onQuickStart
}: {
  kind: BuilderKind
  /** The entry to build on, or null to start a new one. */
  initial: Entry | null
  firstStep?: string
  /** Back to Quick start (offered until the entry exists). */
  onQuickStart?: () => void
}): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const steps = stepsFor(kind)
  const draft = useBuildDraft(kind, initial, storyId)
  const [stepId, setStepId] = useState(() => (firstStep && steps.some((s) => s.id === firstStep) ? firstStep : steps[0].id))
  const index = Math.max(0, steps.findIndex((s) => s.id === stepId))
  const step = steps[index]
  const entries = useWorldEntries()
  const entry = draft.entry
  const entryId = entry?.id ?? null

  const [suggestions, setSuggestions] = useState<BuilderValues>({})
  const [writing, setWriting] = useState<BuilderProgress['writing']>(null)
  const [options, setOptions] = useState<OptionsState | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [interview, setInterview] = useState(false)
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [saving, setSaving] = useState(false)

  const open = useMemo(() => openSuggestions(suggestions, draft.values), [suggestions, draft.values])

  const job = useBuilderJob({
    stopOnLeave: true,
    onProgress: (p) => {
      if (p.job === 'flesh-out') {
        setSuggestions((s) => ({ ...s, ...p.values }))
        setWriting(p.writing)
      } else if (p.job === 'options') setOptions((o) => o && { ...o, list: p.options, writing: p.writing?.text ?? null })
    },
    onDone: (d: BuilderDone) => {
      if (d.job === 'flesh-out') {
        setSuggestions((s) => ({ ...s, ...d.values }))
        setWriting(null)
        const n = Object.keys(d.values).length
        if (d.status === 'error' && d.error) {
          setNote(null)
          toast(d.error, { tone: 'danger', action: settingsAction(d.error) })
        } else if (d.status === 'stopped') {
          setNote(n ? `Stopped. ${suggestionsWord(n)} arrived.` : 'Stopped before any suggestions arrived.')
        } else setNote(null)
      } else if (d.job === 'options') {
        if (d.status === 'stopped' && !d.options.length) setOptions(null)
        else
          setOptions(
            (o) =>
              o && {
                ...o,
                running: false,
                writing: null,
                list: d.status === 'error' ? [] : d.options,
                error: d.status === 'error' ? (d.error ?? 'Something went wrong.') : null
              }
          )
      }
    }
  })
  const busy = !!job.running
  const fleshing = job.running?.job === 'flesh-out'

  // ---------- Steps ----------

  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = useRef(false)
  // Options belong to a field on the step being left: they close (and stop, if still arriving).
  const go = (id: string, focus = false): void => {
    setStepId(id)
    focusHeading.current = focus
    if (job.running?.job === 'options') job.stop()
    setOptions(null)
  }
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    if (focusHeading.current) heading.current?.focus()
    focusHeading.current = false
  }, [stepId])

  // ---------- Relationships ----------

  const changes = useEntryData(() => api.listChanges(entryId ?? ''), `changes:${entryId ?? ''}`, kind === 'character' && !!entryId)
  const characters = useMemo(() => (entries ?? []).filter((e) => e.kind === 'character' && e.id !== entryId), [entries, entryId])
  const rows = useMemo(() => (changes.data && entryId ? splitChanges(changes.data, entryId).relationships : []), [changes.data, entryId])
  const relations = useMemo((): RelationLine[] | null => {
    if (!entryId) return []
    if (!changes.data || !entries) return null
    const byId = new Map(characters.map((c) => [c.id, c]))
    return rows.filter((r) => byId.has(r.otherId)).map((r) => ({ id: r.change.id, name: byId.get(r.otherId)!.name, type: r.type }))
  }, [entryId, changes.data, entries, characters, rows])
  const places = useSceneLabels(step.special === 'relationships' && rows.some((r) => r.change.links.length > 0))
  const self = useMemo(() => ({ id: entryId ?? '', kind, name: draft.values.name ?? '' }), [entryId, kind, draft.values.name])

  // ---------- AI help ----------

  const fleshOut = async (): Promise<void> => {
    const keys = fleshOutKeys(step, draft.current(), open)
    if (!keys.length || job.running) return
    setNote(null)
    try {
      await job.start('flesh-out', (jobId) =>
        api.startFleshOut({ jobId, kind, entryId: draft.entryNow()?.id ?? null, values: draft.current(), keys, storyId })
      )
    } catch (e) {
      const err = e as ApiError
      toast(err.message, { tone: 'danger', action: settingsAction(err.message, err.code) })
    }
  }

  const keep = useCallback(
    async (keys: string[]): Promise<void> => {
      const chosen = pick(open, keys)
      if (!Object.keys(chosen).length) return
      setSuggestions((s) => omit(s, keys))
      setNote(null)
      if (keys.length === 1) setFocusKey(keys[0])
      try {
        await draft.keep(chosen)
      } catch (e) {
        setSuggestions((s) => ({ ...chosen, ...s }))
        toast(`Couldn't keep ${keys.length === 1 ? 'that suggestion' : 'those suggestions'}. ${(e as Error).message}`, { tone: 'danger' })
      }
    },
    [open, draft]
  )
  const discard = useCallback((keys: string[]): void => {
    setSuggestions((s) => omit(s, keys))
    setNote(null)
    if (keys.length === 1) setFocusKey(keys[0])
  }, [])

  const openOptions = useCallback(
    async (key: string): Promise<void> => {
      if (job.running) return
      setOptions({ key, list: [], writing: null, running: true, error: null })
      try {
        await job.start('options', (jobId) =>
          api.startOptions({ jobId, kind, entryId: draft.entryNow()?.id ?? null, values: draft.current(), key, storyId })
        )
      } catch (e) {
        const err = e as ApiError
        setOptions({ key, list: [], writing: null, running: false, error: err.message, code: err.code })
      }
    },
    [job, kind, draft, storyId]
  )
  const pickOption = useCallback(
    async (key: string, value: string): Promise<void> => {
      if (job.running?.job === 'options') job.stop()
      setOptions(null)
      setSuggestions((s) => omit(s, [key]))
      setFocusKey(key)
      try {
        await draft.keep({ [key]: value }, { replace: true })
      } catch (e) {
        toast(`Couldn't use that option. ${(e as Error).message}`, { tone: 'danger' })
      }
    },
    [job, draft]
  )
  const closeOptions = useCallback(() => {
    if (job.running?.job === 'options') job.stop()
    setOptions(null)
  }, [job])

  const saveLine = useCallback((text: string) => draft.set('sampleLines', withSampleLine(draft.current().sampleLines ?? '', text)), [draft])

  const save = async (): Promise<void> => {
    setSaving(true)
    await draft.flush()
    setSaving(false)
    const e = draft.entryNow()
    if (e) useApp.getState().navigate({ kind: 'entries', entryKind: kind, entryId: e.id })
  }

  // ---------- View ----------

  const stepKeys = step.fields.map((f) => f.key)
  const stepOpen = Object.keys(open).filter((k) => stepKeys.includes(k))
  const canFlesh = fleshOutKeys(step, draft.values, open).length > 0
  const waitingIn = (s: Step): boolean =>
    s.fields.some((f) => f.key in open) || (fleshing && !!writing && s.fields.some((f) => f.key === writing.key))
  const name = draft.values.name?.trim() ?? ''
  const Icon = KIND_ICONS[kind]
  const noun = KIND_LABELS[kind].one.toLowerCase()

  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Steps" className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <Icon size={15} className="shrink-0 text-muted" aria-hidden />
          <span className={cn('min-w-0 truncate text-[14px] font-semibold', name ? 'text-fg' : 'text-faint')}>{name || `New ${noun}`}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {onQuickStart && !entry ? (
            <button
              type="button"
              onClick={onQuickStart}
              className="mb-2 flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
            >
              <Sparkles size={15} className="shrink-0 text-ai" aria-hidden />
              Quick start from notes
            </button>
          ) : null}
          <ol className="flex flex-col gap-0.5">
            {steps.map((s, i) => {
              const status = stepStatus(kind, s, draft.values, relations?.length ?? 0)
              const current = i === index
              const waiting = waitingIn(s)
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={current ? 'step' : undefined}
                    onClick={() => go(s.id)}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors duration-150',
                      current ? 'bg-accent-soft font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
                    )}
                  >
                    <StatusIcon status={status} />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <span className="sr-only">, {STATUS_WORDS[status]}</span>
                    {waiting ? (
                      <>
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ai" />
                        <span className="sr-only">, suggestions waiting</span>
                      </>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Leaving any field writes straight away, so nothing waits on the timer. */}
        <div ref={scroller} className="@container min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" onBlur={() => void draft.flush()}>
          <div className="mx-auto w-full max-w-[680px] px-8 pb-16 pt-5">
            <div className="flex h-8 items-center gap-2">
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                {KIND_LABELS[kind].one} · Step {index + 1} of {steps.length}
              </span>
              <div className="flex-1" />
              <SaveNote status={draft.status} error={draft.error} />
            </div>
            <h1 ref={heading} tabIndex={-1} className="mt-1 text-[20px] font-semibold text-fg outline-none">
              {step.label}
            </h1>
            <p className="mb-5 mt-1 text-[13px] leading-relaxed text-muted">{step.intro}</p>

            {kind === 'character' && step.id === 'voice' && !interview ? (
              <div className="mb-5 flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
                <MessageCircle size={16} className="shrink-0 text-muted" aria-hidden />
                <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
                  Talk to {name || 'them'} to find their voice. Any reply can be saved as a sample line.
                </p>
                <Button size="sm" onClick={() => setInterview(true)}>
                  Interview {name || 'them'}
                </Button>
              </div>
            ) : null}

            {step.special === 'review' ? (
              <Review
                kind={kind}
                steps={steps}
                values={draft.values}
                ai={draft.ai}
                entry={entry}
                relations={relations}
                waiting={Object.keys(open).length}
                saving={saving}
                onEdit={(id) => go(id, true)}
                onSave={() => void save()}
                onImage={draft.noteSaved}
              />
            ) : step.special === 'relationships' ? (
              entry ? (
                <RelationshipsSection
                  self={self}
                  rows={rows}
                  data={changes}
                  entries={characters}
                  places={places}
                  onOpen={(e) => useApp.getState().navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id })}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center">
                  <p className="text-[13px] text-muted">Give them a name first, then you can say who they know.</p>
                  <Button size="sm" className="mt-3" onClick={() => go('basics', true)}>
                    Go to Basics
                  </Button>
                </div>
              )
            ) : (
              <StepFields
                kind={kind}
                step={step}
                values={draft.values}
                ai={draft.ai}
                suggestions={open}
                writing={writing}
                options={options}
                busy={busy}
                entry={entry}
                entries={entries}
                focusKey={focusKey}
                onFocused={() => setFocusKey(null)}
                onChange={draft.set}
                onKeep={(k) => void keep([k])}
                onDiscard={(k) => discard([k])}
                onOptions={(k) => void openOptions(k)}
                onPick={(k, v) => void pickOption(k, v)}
                onCloseOptions={closeOptions}
                onStopOptions={job.stop}
                onImage={draft.noteSaved}
              />
            )}

            {step.special !== 'review' ? (
              <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
                {index > 0 ? (
                  <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => go(steps[index - 1].id, true)}>
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                <Button onClick={() => go(steps[index + 1].id, true)}>
                  Next: {steps[index + 1].label}
                  <ArrowRight size={14} aria-hidden />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="@container flex h-12 shrink-0 items-center gap-2 border-t border-line bg-surface px-4">
          {fleshing ? (
            <>
              <Button
                icon={<Square size={11} fill="currentColor" />}
                onClick={job.stop}
                title="Stop. Suggestions that have arrived are kept."
              >
                Stop
              </Button>
              <WritingStatus text={job.running?.retrying ?? 'Writing suggestions…'} title={job.running?.retrying ?? undefined} />
            </>
          ) : step.fields.length ? (
            <>
              <Button
                icon={<Sparkles size={14} className="text-ai" />}
                disabled={!canFlesh || busy}
                onClick={() => void fleshOut()}
                title={canFlesh ? 'Suggestions for the empty fields on this step. Nothing is saved until you keep it.' : 'Every field here is filled in.'}
              >
                Flesh out with AI
              </Button>
              <span role="status" className="hidden min-w-0 truncate text-[12.5px] @[560px]:block">
                {stepOpen.length ? (
                  <span className="text-ai">{suggestionsWord(stepOpen.length)} to look at</span>
                ) : note ? (
                  <span className="text-muted">{note}</span>
                ) : !canFlesh && !busy ? (
                  <span className="text-faint">Every field here is filled in. Options can offer others for any one of them.</span>
                ) : null}
              </span>
            </>
          ) : (
            <span className="min-w-0 truncate text-[12.5px] text-faint">
              {step.special === 'review' ? 'Everything is saved as you go.' : 'Pick from your characters, then say what they are to each other.'}
            </span>
          )}
          <div className="flex-1" />
          {stepOpen.length > 1 && !fleshing ? (
            <>
              <Button size="sm" onClick={() => void keep(stepOpen)}>
                Keep all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => discard(stepOpen)}>
                Discard all
              </Button>
            </>
          ) : null}
          {kind === 'character' ? (
            // Just its icon when the bar is narrow (the interview open beside it), so nothing is cut off.
            <Button
              size="sm"
              variant="ghost"
              icon={<MessageCircle size={14} />}
              aria-pressed={interview}
              aria-label="Interview"
              title={interview ? 'Close the interview' : 'Talk to them in character, to find their voice'}
              onClick={() => setInterview((v) => !v)}
            >
              <span className="hidden @[600px]:inline">Interview</span>
            </Button>
          ) : null}
        </div>
      </div>

      {interview && kind === 'character' ? (
        <InterviewPanel
          draft={draft}
          storyId={storyId}
          turns={turns}
          onTurns={setTurns}
          onSaveLine={saveLine}
          onClose={() => setInterview(false)}
        />
      ) : null}
    </div>
  )
}
