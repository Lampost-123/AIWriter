// Guided: Adam walks the steps himself, with AI help only where he wants it. Across the top, a band in the kind's colour
// with the entry's picture (its portrait, else its drawing, idling gently), its name, and how much of it is filled in.
// Under it, the steps on a rail (each with its icon, a ring that fills as its fields do, and how many are filled), the
// step's fields in cards in the middle, and, on a wide screen, the entry's card as the world will show it filling in
// beside them, with a plain word on how the AI helps. The AI's actions sit in a slim bar at the foot, like the desk's
// dock. A step slides in from the side it comes from (at once from the keyboard, and with less motion). The entry is
// made once it has a name and then saves itself as he types.
import { ArrowLeft, ArrowRight, MessageCircle, Sparkles, Square, WandSparkles, X } from '@/components/ui/icons'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import { pickMotif } from '@shared/motifs'
import type { BuilderDone, BuilderKind, BuilderProgress, BuilderValues, InterviewTurn } from '@shared/contracts/builder'
import type { Entry } from '@shared/types'
import { Button, toast, useToastsAbove } from '@/components/ui'
import { GlidePill } from '@/components/ui/GlidePill'
import { Motif } from '@/components/art/Motif'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { PortraitDrop } from '@/features/views/PortraitDrop'
import { artHue } from '@/features/desk/world/galleryLogic'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { MotifPicker } from '@/features/world/art/MotifPicker'
import { splitChanges } from '@/features/world/memoryLogic'
import { useEntryData } from '@/features/world/memory/useEntryData'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useSceneLabels } from '@/features/world/useSceneLabels'
import {
  countWords,
  fleshOutKeys,
  labelOf,
  mergeSuggestions,
  openSuggestions,
  profileCounts,
  shownValue,
  STATUS_WORDS,
  stepArt,
  stepCounts,
  stepStatus,
  stepsFor,
  withSampleLine,
  type Step
} from './builderLogic'
import { flyInto, glowField } from './fly'
import { InterviewPanel } from './Interview'
import { settingsAction, useWidth, useWorldEntries, WritingStatus } from './parts'
import { ProfileCard } from './ProfileCard'
import { Relationships } from './Relationships'
import { Review, type RelationLine } from './Review'
import { stepIcon } from './stepIcons'
import { StepFields, type OptionsState } from './StepFields'
import { useBuildDraft } from './useBuildDraft'
import { useBuilderJob } from './useBuilderJob'
import './builder.css'

const omit = (v: BuilderValues, keys: string[]): BuilderValues => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)))
const pick = (v: BuilderValues, keys: string[]): BuilderValues => Object.fromEntries(Object.entries(v).filter(([k]) => keys.includes(k)))
const suggestionsWord = (n: number): string => (n === 1 ? 'One suggestion' : `${n} suggestions`)

/** The rail of steps. */
const RAIL = 252
/**
 * Room for the rail, the interview (340 px) and a step that is still comfortable to use (420 px) side by side. In
 * less, the interview opens over the step instead of squeezing it.
 */
const INTERVIEW_BESIDE = RAIL + 340 + 420
/** The step's column and the card beside it fit side by side from this width of the middle on. */
const CARD_BESIDE = 1000

/** The first time the builder opens: one line on what it is. Remembered on this computer once read. */
const INTRO_KEY = 'aiwrite.builder.introRead'
function useIntro(): [boolean, () => void] {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(INTRO_KEY) !== '1'
    } catch {
      return true
    }
  })
  const dismiss = useCallback(() => {
    setShown(false)
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch {
      /* only a convenience */
    }
  }, [])
  return [shown, dismiss]
}

/** A step's ring on the rail: its icon in the middle, the ring filling as its fields do. */
function StepRing({ kind, step, filled, total, current }: { kind: BuilderKind; step: Step; filled: number; total: number; current: boolean }): React.JSX.Element {
  const Icon = stepIcon(kind, step.id)
  const r = 15
  const c = 2 * Math.PI * r
  const part = total ? filled / total : 0
  return (
    <span aria-hidden className={cn('bld-ring', part >= 1 && 'is-done', current && 'is-on')}>
      <svg className="bld-ring-svg" width="36" height="36" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={r} className="bld-ring-track" />
        <circle
          cx="18"
          cy="18"
          r={r}
          className="bld-ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - part)}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <Icon size={16} selected={current} className="bld-ring-icon" />
    </span>
  )
}

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
  /** Opened from the entry's own page ("Build with AI"): a button at the top goes back to it. */
  fromPage?: boolean
}): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const steps = stepsFor(kind)
  const draft = useBuildDraft(kind, initial, storyId)
  const [stepId, setStepId] = useState(() => (firstStep && steps.some((s) => s.id === firstStep) ? firstStep : steps[0].id))
  // Which way the step came in (from the side it is on), or null for at once (the keyboard, less motion).
  const [dir, setDir] = useState<'fwd' | 'back' | null>(null)
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
  const [intro, dismissIntro] = useIntro()

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
  // A toast (Undo after picking an idea, say) sits above the buttons at the foot, never over them.
  const bottomBar = useRef<HTMLDivElement>(null)
  useToastsAbove(bottomBar)
  const focusHeading = useRef(false)
  // Ideas belong to a field on the step being left: they close (and stop, if still arriving). An
  // interview open over the step closes, so the step shows.
  const go = (id: string, focus = false): void => {
    if (id === stepId) return
    const to = steps.findIndex((s) => s.id === id)
    setDir(keyboardDriven() || reducedMotion() ? null : to > index ? 'fwd' : 'back')
    setStepId(id)
    focusHeading.current = focus
    if (job.running?.job === 'options') job.stop()
    setOptions(null)
    if (drawer) setInterview(false)
  }
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    if (focusHeading.current) heading.current?.focus({ preventScroll: true })
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
      // The kept words settle into their boxes with the lamp's glow.
      requestAnimationFrame(() => requestAnimationFrame(() => keys.forEach(glowField)))
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
    async (key: string, value: string, from: DOMRect | null): Promise<void> => {
      if (job.running?.job === 'options') job.stop()
      setOptions(null)
      decided.current.add(key)
      setSuggestions((s) => omit(s, [key]))
      setFocusKey(key)
      const was = draft.fieldNow(key)
      // The idea flies up into its field (its words are there at once; the flight is a copy over the page).
      if (from) flyInto(key, from, value)
      try {
        await draft.keep({ [key]: value }, { replace: true })
      } catch (e) {
        toast(`Couldn’t use that idea. ${(e as Error).message}`, { tone: 'danger' })
        return
      }
      // What it said before is one click away.
      if (!was.value.trim() || was.value === value) return
      const label = labelOf(kind, key)
      toast(`Replaced ${label.toLowerCase()} with the idea you picked.`, {
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
  const summary = draft.values.summary?.trim() ?? ''
  const noun = KIND_LABELS[kind].one.toLowerCase()
  const rels = relations?.length ?? 0
  const total = profileCounts(kind, draft.values, rels)
  const pct = total.total ? total.filled / total.total : 0
  // Its drawing: Adam's choice (or the one the world gave it), else the one its words call for as he types.
  const motifs = useEntryMotifs()
  const motif =
    (entryId ? motifs.get(entryId) : null) ??
    pickMotif({ kind, name: draft.values.name ?? '', summary: draft.values.summary ?? '', description: draft.values.description ?? '', fields: draft.values })
  const hue = artHue(kind, entryId ?? `new-${kind}`)
  const role = kind === 'character' && draft.values.role?.trim() ? shownValue('role', draft.values.role) : ''
  const middle = width - RAIL - (interview && !drawer ? 340 : 0)
  const beside = middle >= CARD_BESIDE && step.special !== 'review'
  const card = (
    <ProfileCard
      kind={kind}
      id={entryId ?? ''}
      name={name}
      summary={summary}
      role={role}
      image={entry?.image ?? null}
      motif={motif}
      counts={total}
    />
  )

  return (
    <div ref={root} className="bld" data-kind={kind} style={{ '--bld-hue': hue } as React.CSSProperties}>
      <header className="bld-band">
        <span aria-hidden className="bld-band-stars" />
        <div className={cn('bld-medal', kind === 'character' && 'is-round')}>
          <span aria-hidden className="bld-medal-halo" />
          <span className="bld-medal-in">
            {entry ? (
              <PortraitDrop entry={entry} size={92} motif={motif} onChange={draft.noteSaved} />
            ) : (
              <span className="bld-medal-art" title="Give it a name first, then you can add a picture.">
                <Motif key={motif} id={motif} size={62} />
              </span>
            )}
          </span>
        </div>
        <div className="bld-titles">
          <div className="bld-kicker">
            <WandSparkles size={12} aria-hidden />
            {KIND_LABELS[kind].one} builder · Step {index + 1} of {steps.length}
          </div>
          <p className={cn('bld-name', !name && 'is-empty')}>{name || `New ${noun}`}</p>
          <p className="bld-sum">{summary || (name ? 'No one-line summary yet.' : 'Only a name is needed to begin; everything else can wait.')}</p>
        </div>
        <div className="bld-band-side">
          {fromPage && entry ? (
            // Everything is saved as Adam goes; this writes the last of it and goes back to the page.
            <button type="button" className="bld-back" onClick={() => void save()}>
              <ArrowLeft size={14} aria-hidden />
              <span>Back to {name || `the ${noun}`}</span>
            </button>
          ) : null}
          <div className="bld-meter" title={`${total.filled} of ${total.total} parts filled in`}>
            <span className="bld-meter-n tabular-nums">{Math.round(pct * 100)}%</span>
            <span className="bld-meter-t">
              <span className="tabular-nums">
                {total.filled} of {total.total}
              </span>{' '}
              filled in
            </span>
            <SaveNote status={draft.status} error={draft.error} className="bld-save" />
          </div>
        </div>
        <span aria-hidden className="bld-bar">
          <span style={{ transform: `scaleX(${pct})` }} />
        </span>
      </header>

      <div className="bld-body">
        <nav aria-label="Steps" className="bld-rail">
          <ol className="bld-steps">
            <GlidePill className="bld-pill" selector='[aria-current="step"]' />
            {steps.map((s, i) => {
              const status = stepStatus(kind, s, draft.values, rels)
              const counts = stepCounts(kind, s, draft.values, rels)
              const current = i === index
              const waiting = waitingIn(s)
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={current ? 'step' : undefined}
                    onClick={() => go(s.id)}
                    className={cn('bld-step-btn', current && 'is-on')}
                    data-status={status}
                  >
                    <StepRing kind={kind} step={s} filled={counts.filled} total={counts.total} current={current} />
                    <span className="bld-step-txt">
                      <span className="bld-step-l">{s.label}</span>
                      <span className="bld-step-c">{s.special === 'review' ? 'The whole ' + noun : countWords(counts, s)}</span>
                    </span>
                    <span className="sr-only">, {STATUS_WORDS[status]}</span>
                    {waiting ? (
                      <>
                        <span aria-hidden className="bld-wait" />
                        <span className="sr-only">, suggestions waiting</span>
                      </>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ol>
          {/* At the foot, so the steps stay put when it goes (once the entry is saved there is no going back to it). */}
          {onQuickStart && !entry ? (
            <div className="bld-rail-foot">
              <button type="button" onClick={onQuickStart} className="bld-quick">
                <Sparkles size={15} className="shrink-0 text-ai" aria-hidden />
                Quick start from notes
              </button>
            </div>
          ) : null}
        </nav>

        <div className="bld-main" inert={drawer}>
          {/* Leaving any field writes straight away, so nothing waits on the timer. */}
          <div ref={scroller} className="bld-scroll @container" onBlur={() => void draft.flush()}>
            <div className={cn('bld-wrap', beside && 'has-card')}>
              <div className="bld-col" data-builder-main>
                {intro ? (
                  <div className="bld-intro" role="note">
                    <span aria-hidden className="bld-intro-ic">
                      <WandSparkles size={16} />
                    </span>
                    <p>
                      <b>The {noun} builder.</b> Walk through who {kind === 'character' ? 'they are' : 'it is'} step by step; the AI can
                      suggest each part. Everything saves as you go.
                    </p>
                    <button type="button" className="bld-intro-x" onClick={dismissIntro} aria-label="Got it, hide this">
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                ) : null}

                <div key={step.id} className="bld-step" data-dir={dir ?? undefined}>
                  <div className="bld-head">
                    <span aria-hidden className="bld-head-art">
                      <Motif id={stepArt(kind, step.id)} size={44} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="bld-eyebrow">
                        Step {index + 1} of {steps.length}
                      </div>
                      <h1 ref={heading} tabIndex={-1} className="bld-h1">
                        {step.label}
                      </h1>
                      <p className="bld-intro-p">{step.intro}</p>
                    </div>
                  </div>

                  {kind === 'character' && step.id === 'voice' && !interview ? (
                    <div className="bld-callout">
                      <span aria-hidden className="bld-callout-ic">
                        <MessageCircle size={18} />
                      </span>
                      <p className="min-w-0 flex-1">
                        <b>Talk to {name || 'them'} to find their voice.</b> The AI answers in character; any reply can be saved as a
                        sample line.
                      </p>
                      <Button size="sm" variant="ai" onClick={() => setInterview(true)}>
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
                      relations={relations}
                      waiting={Object.keys(open).length}
                      saving={saving}
                      card={<ProfileCard kind={kind} id={entryId ?? ''} name={name} summary={summary} role={role} image={entry?.image ?? null} motif={motif} counts={total} large />}
                      onEdit={(id) => go(id, true)}
                      onSave={() => void save()}
                    />
                  ) : step.special === 'relationships' ? (
                    <section className="bld-card" aria-label="Who they know">
                      {entry ? (
                        <Relationships self={self} rows={rows} data={changes} entries={entries} places={places} />
                      ) : (
                        <div className="bld-empty">
                          <p>Give them a name first, then you can say who they know.</p>
                          <Button size="sm" className="mt-3" onClick={() => go('basics', true)}>
                            Go to Basics
                          </Button>
                        </div>
                      )}
                    </section>
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
                      onPick={(k, v, from) => void pickOption(k, v, from)}
                      onCloseOptions={closeOptions}
                      onStopOptions={job.stop}
                    />
                  )}

                  {step.special !== 'review' ? (
                    <div className="bld-nav">
                      {index > 0 ? (
                        <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => go(steps[index - 1].id, true)}>
                          Back
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Button variant="primary" onClick={() => go(steps[index + 1].id, true)}>
                        Next: {steps[index + 1].label}
                        <ArrowRight size={14} aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              {beside ? (
                <aside className="bld-aside" aria-label={`${name || `The ${noun}`}, as the world will show ${kind === 'character' ? 'them' : 'it'}`}>
                  <div className="bld-aside-in">
                    <div className="bld-caps">{kind === 'character' ? 'Their card' : 'Its card'} in the world</div>
                    {card}
                    {entry ? (
                      <div className="bld-aside-pick">
                        <MotifPicker entry={{ ...entry, name: draft.values.name ?? entry.name }} />
                      </div>
                    ) : null}
                    <div className="bld-help">
                      <div className="bld-caps">How the AI helps</div>
                      <ul>
                        <li>
                          <Sparkles size={13} className="text-ai" aria-hidden />
                          <span>
                            <b>Ideas</b> beside a field: three different takes on it to pick from.
                          </span>
                        </li>
                        <li>
                          <Sparkles size={13} className="text-ai" aria-hidden />
                          <span>
                            <b>Flesh out with AI</b> at the foot: suggestions for this step’s empty fields.
                          </span>
                        </li>
                        {kind === 'character' ? (
                          <li>
                            <MessageCircle size={13} className="text-ai" aria-hidden />
                            <span>
                              <b>Interview</b>: talk to them in character to find their voice.
                            </span>
                          </li>
                        ) : null}
                      </ul>
                      <p>Nothing the AI writes is kept until you keep it.</p>
                    </div>
                  </div>
                </aside>
              ) : null}
            </div>
          </div>

          <div ref={bottomBar} className="bld-ai-wrap">
            <div className="bld-ai @container">
              {fleshing ? (
                <>
                  <Button icon={<Square size={11} fill="currentColor" />} onClick={job.stop} title="Stop. Suggestions that have arrived are kept.">
                    Stop
                  </Button>
                  <WritingStatus text={job.running?.retrying ?? 'Writing suggestions…'} title={job.running?.retrying ?? undefined} />
                </>
              ) : step.fields.length ? (
                <>
                  <Button
                    variant="ai"
                    icon={<Sparkles size={14} />}
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
                      <span className="text-faint">Every field here is filled in. Ideas can offer others for any one of them.</span>
                    ) : (
                      <span className="text-faint">Suggestions for this step’s empty fields; you keep what you like.</span>
                    )}
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
    </div>
  )
}
