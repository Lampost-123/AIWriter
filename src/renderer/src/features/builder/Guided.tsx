// Guided: Adam walks the steps himself, with AI help only where he wants it. A rail of steps on the
// left (each empty, partly done or complete), the step's fields in the middle, and the AI's actions
// in a slim bar under them. The entry is made once it has a name and then saves itself as he types.
import { ArrowLeft, ArrowRight, MessageCircle, Sparkles, Square } from '@/components/ui/icons'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { BuilderDone, BuilderKind, BuilderProgress, BuilderValues, InterviewTurn } from '@shared/contracts/builder'
import type { Entry } from '@shared/types'
import { Button, toast, useToastsAbove } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { KIND_ICONS } from '@/features/world/kindIcons'
import { splitChanges } from '@/features/world/memoryLogic'
import { useEntryData } from '@/features/world/memory/useEntryData'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useSceneLabels } from '@/features/world/useSceneLabels'
import {
  fleshOutKeys,
  labelOf,
  mergeSuggestions,
  openSuggestions,
  STATUS_WORDS,
  stepStatus,
  stepsFor,
  withSampleLine,
  type Step
} from './builderLogic'
import { InterviewPanel } from './Interview'
import { settingsAction, StatusIcon, useWidth, useWorldEntries, WritingStatus } from './parts'
import { Relationships } from './Relationships'
import { Review, type RelationLine } from './Review'
import { StepFields, type OptionsState } from './StepFields'
import { useBuildDraft } from './useBuildDraft'
import { useBuilderJob } from './useBuilderJob'

const omit = (v: BuilderValues, keys: string[]): BuilderValues => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)))
const pick = (v: BuilderValues, keys: string[]): BuilderValues => Object.fromEntries(Object.entries(v).filter(([k]) => keys.includes(k)))
const suggestionsWord = (n: number): string => (n === 1 ? 'One suggestion' : `${n} suggestions`)

/**
 * Room for the rail (216 px), the interview (340 px) and a step that is still comfortable to use (420
 * px) side by side. In less, the interview opens over the step instead of squeezing it.
 */
const INTERVIEW_BESIDE = 976

export function Guided({
  kind,
  initial,
  firstStep,
  onQuickStart,
  fromPage = false
}: {
  kind: BuilderKind
  /** The entry to build on, or null to start a new one. */
  initial: Entry | null
  firstStep?: string
  /** Back to Quick start (offered until the entry exists). */
  onQuickStart?: () => void
  /** Opened from the entry's own page ("Open in the builder"): a button at the top goes back to it. */
  fromPage?: boolean
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
  // The fields Adam has kept, discarded or typed in since the last Flesh out began. It sends every
  // suggestion so far each time, and these stay gone.
  const decided = useRef(new Set<string>())

  const job = useBuilderJob({
    stopOnLeave: true,
    onProgress: (p) => {
      if (p.job === 'flesh-out') {
        setSuggestions((s) => mergeSuggestions(s, p.values, decided.current))
        setWriting(p.writing)
      } else if (p.job === 'options') setOptions((o) => o && { ...o, list: p.options, writing: p.writing?.text ?? null })
    },
    onDone: (d: BuilderDone) => {
      if (d.job === 'flesh-out') {
        setSuggestions((s) => mergeSuggestions(s, d.values, decided.current))
        setWriting(null)
        const n = Object.keys(d.values).filter((k) => !decided.current.has(k)).length
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

  // ---------- Interview ----------

  const root = useRef<HTMLDivElement>(null)
  const width = useWidth(root)
  // Beside the step when there is room for both; over it, like a drawer, when the window is narrow.
  const drawer = interview && width > 0 && width < INTERVIEW_BESIDE
  const toggle = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const closeInterview = useCallback(() => {
    refocus.current = true
    setInterview(false)
  }, [])
  // Closed from the panel: back to the button that opens it, rather than nowhere.
  useEffect(() => {
    if (interview || !refocus.current) return
    refocus.current = false
    toggle.current?.focus()
  }, [interview])

  // ---------- Steps ----------

  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // A toast (Undo after picking an option, say) sits above the buttons at the foot, never over them.
  const bottomBar = useRef<HTMLDivElement>(null)
  useToastsAbove(bottomBar)
  const focusHeading = useRef(false)
  // Options belong to a field on the step being left: they close (and stop, if still arriving). An
  // interview open over the step closes, so the step shows.
  const go = (id: string, focus = false): void => {
    setStepId(id)
    focusHeading.current = focus
    if (job.running?.job === 'options') job.stop()
    setOptions(null)
    if (drawer) setInterview(false)
  }
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    if (focusHeading.current) heading.current?.focus()
    focusHeading.current = false
  }, [stepId])

  // ---------- Relationships ----------

  const changes = useEntryData(() => api.listChanges(entryId ?? ''), `changes:${entryId ?? ''}`, kind === 'character' && !!entryId)
  const rows = useMemo(() => (changes.data && entryId ? splitChanges(changes.data, entryId).relationships : []), [changes.data, entryId])
  // Everyone they are linked to, a group or a place made on the entry page included.
  const relations = useMemo((): RelationLine[] | null => {
    if (!entryId) return []
    if (!changes.data || !entries) return null
    const byId = new Map(entries.map((e) => [e.id, e]))
    return rows.filter((r) => byId.has(r.otherId)).map((r) => ({ id: r.change.id, name: byId.get(r.otherId)!.name, type: r.type }))
  }, [entryId, changes.data, entries, rows])
  const places = useSceneLabels(step.special === 'relationships' && rows.some((r) => r.change.links.length > 0))
  const self = useMemo(() => ({ id: entryId ?? '', kind, name: draft.values.name ?? '' }), [entryId, kind, draft.values.name])

  // ---------- AI help ----------

  const fleshOut = async (): Promise<void> => {
    const keys = fleshOutKeys(step, draft.current(), open)
    if (!keys.length || job.running) return
    setNote(null)
    decided.current = new Set()
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
      for (const k of keys) decided.current.add(k)
      setSuggestions((s) => omit(s, keys))
      setNote(null)
      if (keys.length === 1) setFocusKey(keys[0])
      try {
        await draft.keep(chosen)
      } catch (e) {
        for (const k of keys) decided.current.delete(k)
        setSuggestions((s) => ({ ...chosen, ...s }))
        toast(`Couldn’t keep ${keys.length === 1 ? 'that suggestion' : 'those suggestions'}. ${(e as Error).message}`, { tone: 'danger' })
      }
    },
    [open, draft]
  )
  const discard = useCallback((keys: string[]): void => {
    for (const k of keys) decided.current.add(k)
    setSuggestions((s) => omit(s, keys))
    setNote(null)
    if (keys.length === 1) setFocusKey(keys[0])
  }, [])
  // His words win: a suggestion still to come for a field he types in is left out.
  const { set } = draft
  const change = useCallback(
    (key: string, value: string): void => {
      decided.current.add(key)
      setSuggestions((s) => (key in s ? omit(s, [key]) : s))
      set(key, value)
    },
    [set]
  )

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
      decided.current.add(key)
      setSuggestions((s) => omit(s, [key]))
      setFocusKey(key)
      const was = draft.fieldNow(key)
      try {
        await draft.keep({ [key]: value }, { replace: true })
      } catch (e) {
        toast(`Couldn’t use that option. ${(e as Error).message}`, { tone: 'danger' })
        return
      }
      // What it said before is one click away.
      if (!was.value.trim() || was.value === value) return
      const label = labelOf(kind, key)
      toast(`Replaced ${label.toLowerCase()} with the option you picked.`, {
        action: {
          label: 'Undo',
          run: () => {
            setFocusKey(key)
            const failed = (e: Error): void => void toast(`Couldn’t put ${label.toLowerCase()} back. ${e.message}`, { tone: 'danger' })
            void draft.revert(key, was).catch(failed)
          }
        }
      })
    },
    [job, draft, kind]
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
    <div ref={root} className="relative flex h-full min-h-0">
      <nav aria-label="Steps" className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <Icon size={15} className="shrink-0 text-muted" aria-hidden />
          <span className={cn('min-w-0 truncate text-[14px] font-semibold', name ? 'text-fg' : 'text-faint')}>{name || `New ${noun}`}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
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
                      // A long step name wraps onto a second line rather than being cut short.
                      'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors duration-150',
                      current ? 'bg-accent-soft font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
                    )}
                  >
                    <StatusIcon status={status} />
                    <span className="min-w-0 flex-1">{s.label}</span>
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
        {/* At the foot, so the steps stay put when it goes (once the entry is saved there is no going back to it). */}
        {onQuickStart && !entry ? (
          <div className="shrink-0 border-t border-line p-2">
            <button
              type="button"
              onClick={onQuickStart}
              className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
            >
              <Sparkles size={15} className="shrink-0 text-ai" aria-hidden />
              Quick start from notes
            </button>
          </div>
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col" inert={drawer}>
        {/* Leaving any field writes straight away, so nothing waits on the timer. */}
        <div
          ref={scroller}
          className="@container min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
          onBlur={() => void draft.flush()}
        >
          <div className="mx-auto w-full max-w-[680px] px-8 pb-16 pt-5">
            {fromPage && entry ? (
              // Everything is saved as Adam goes; this writes the last of it and goes back to the page.
              <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} className="-ml-2.5 mb-2" onClick={() => void save()}>
                Back to {name || `the ${noun}`}
              </Button>
            ) : null}
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
                <Relationships self={self} rows={rows} data={changes} entries={entries} places={places} />
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
                onChange={change}
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

        <div ref={bottomBar} className="@container flex h-12 shrink-0 items-center gap-2 border-t border-line bg-surface px-4">
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
                title={
                  canFlesh
                    ? 'Suggestions for the empty fields on this step. Nothing is saved until you keep it.'
                    : 'Every field here is filled in.'
                }
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
            // Left out when the bar is narrow (the interview open beside it) rather than cut short.
            <span className="hidden min-w-0 truncate text-[12.5px] text-faint @[520px]:block">
              {step.special === 'review'
                ? 'Everything is saved as you go.'
                : 'Pick from your characters, then say what they are to each other.'}
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
              ref={toggle}
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
          over={drawer}
          onTurns={setTurns}
          onSaveLine={saveLine}
          onClose={closeInterview}
        />
      ) : null}
    </div>
  )
}
