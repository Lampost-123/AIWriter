// Story settings ({ kind: 'story', storyId }): the story's title, series, premise, themes and tone; "What
// is it?" with the same live sentence as the New story dialog, saved with Undo; the time since the
// previous story; a prequel's starting cast; the style the AI gets for it; and deleting it with Undo.
import { BookOpen, Check, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StoryPlacement } from '@shared/api'
import type { StoryDetails, StoryRef } from '@shared/contracts/stories'
import type { Entry, ID, Series, Story } from '@shared/types'
import { Badge, Button, EmptyState, Field, IconButton, Input, Notice, Select, SettingsSection, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { CastPicker } from '@/features/inspector/CastPicker'
import { usePrefs } from '@/features/style/prefsStore'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { Switch } from '@/features/world/parts/Switch'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { useSlow } from '@/features/world/parts/useSlow'
import { retryFlow, runFlow, useFlows } from './flows'
import { usePreview } from './hooks'
import { PlacementEditor, Warnings } from './PlacementEditor'
import { useSeries, useSeriesList } from './series'
import {
  deleteStory,
  dismissFollowQuestion,
  editStoryStyle,
  endFirst,
  followQuestionAnswered,
  moveToFollow,
  savePlacement,
  takePendingSection
} from './storyActions'
import { flowLine, gapLabel, placementOf, samePlacement, styleRules } from './storiesLogic'

const failed = (e: unknown): string => (e as Error).message || 'That didn’t work. Please try again.'

/** What the page shows beyond the story's own fields, reloaded whenever the stories or what they know change. */
function useDetails(storyId: ID): { details: StoryDetails | null; error: string | null; retry: () => void } {
  const stories = useApp((s) => s.stories)
  const memoryRev = useApp((s) => s.memoryRev)
  const outlineRev = useApp((s) => s.outlineRev)
  const [state, setState] = useState<{ details: StoryDetails | null; error: string | null }>({ details: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const exists = stories.some((s) => s.id === storyId)
  useEffect(() => {
    if (!exists) return
    let live = true
    api
      .getStoryDetails(storyId)
      .then((details) => live && setState({ details, error: null }))
      .catch((e) => live && setState((s) => ({ details: s.details, error: failed(e) })))
    return () => {
      live = false
    }
  }, [storyId, exists, stories, memoryRev, outlineRev, attempt])
  return { ...state, retry: () => setAttempt((a) => a + 1) }
}

export function StorySettings({ storyId }: { storyId: ID }): React.JSX.Element {
  const story = useApp((s) => s.stories.find((x) => x.id === storyId) ?? null)
  const { details, error, retry } = useDetails(storyId)
  const slow = useSlow(!!story && !details && !error)
  const [section] = useState(takePendingSection)

  // Opened at a section ("Choose cast" in a toast): bring it into view and start there.
  useEffect(() => {
    if (!details || !section) return
    const el = document.getElementById(`story-${section}`)
    el?.scrollIntoView({ block: 'start' })
    const field = el?.querySelector<HTMLElement>('input') ?? el?.querySelector<HTMLElement>('button')
    field?.focus()
  }, [details, section])

  if (!story) {
    return (
      <EmptyState
        icon={<BookOpen size={20} />}
        title="This story isn’t here any more"
        className="pt-24"
        actions={<Button onClick={() => useApp.getState().navigate({ kind: 'write' })}>Back to writing</Button>}
      >
        It may have been deleted. Deleted stories stay in Recently deleted (Settings) for 30 days.
      </EmptyState>
    )
  }
  if (!details) {
    if (error)
      return (
        <div className="mx-auto max-w-md px-6 pt-16">
          <Notice
            tone="danger"
            action={
              <Button size="sm" onClick={retry}>
                Try again
              </Button>
            }
          >
            Couldn’t open this story’s settings. {error}
          </Notice>
        </div>
      )
    return slow ? (
      <div className="flex h-full items-center justify-center text-faint">
        <Spinner />
      </div>
    ) : (
      <div />
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[680px] animate-fade-in flex-col gap-10 px-8 pb-24 pt-8">
        <AboutStory key={story.id} story={story} summary={details.preview.summary} />
        <SeriesPart story={story} />
        <WhatIsIt story={story} details={details} />
        {story.kind === 'prequel' ? <StartingCast story={story} cast={details.cast} /> : null}
        <StyleForStory story={story} />
        <DeletePart story={story} startingHere={details.startingHere} />
      </div>
    </div>
  )
}

function Part({ id, title, description, children }: { id?: string; title: string; description?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div id={id} className="scroll-mt-6">
      <SettingsSection title={title} description={description} className="border-t border-line pt-6">
        <div className="flex flex-col gap-4">{children}</div>
      </SettingsSection>
    </div>
  )
}

// ---------- Title, premise, themes, tone ----------

interface AboutDraft {
  title: string
  premise: string
  themes: string
  tone: string
}

function AboutStory({ story, summary }: { story: Story; summary: string }): React.JSX.Element {
  const [draft, setDraft] = useState<AboutDraft>({ title: story.title, premise: story.premise, themes: story.themes, tone: story.tone })
  const ref = useRef(draft)
  const autosave = useAutosave<AboutDraft>(
    async (d) => {
      // A title left empty keeps the one it had.
      await api.updateStory(story.id, { ...(d.title.trim() ? { title: d.title.trim() } : {}), premise: d.premise, themes: d.themes, tone: d.tone })
      await useApp.getState().refreshStories()
    },
    { what: story.title.trim() ? `“${story.title.trim()}”` : 'this story' }
  )
  const { schedule } = autosave
  const update = useCallback(
    (patch: Partial<AboutDraft>) => {
      const next = { ...ref.current, ...patch }
      ref.current = next
      setDraft(next)
      schedule(next)
    },
    [schedule]
  )

  return (
    <div className="flex flex-col gap-6" onBlur={() => void autosave.flush()}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-faint">Story settings</p>
          <h1 className="mt-0.5 truncate text-[20px] font-semibold text-fg">{draft.title.trim() || story.title || 'Untitled story'}</h1>
          <p className="mt-1 text-[13px] text-muted">{summary}</p>
        </div>
        <SaveNote status={autosave.status} error={autosave.error} className="mt-6" />
      </header>
      <Field label="Title">{(id) => <Input id={id} value={draft.title} placeholder="Untitled story" onChange={(e) => update({ title: e.target.value })} />}</Field>
      <Field label="Premise" hint="What this story is about, in a few sentences. The AI keeps it in mind for every scene.">
        {(id) => (
          <AutoTextarea
            id={id}
            value={draft.premise}
            minRows={3}
            maxRows={14}
            placeholder="A ferryman who owes the Duke money is paid to smuggle the heir out of Varn."
            onChange={(e) => update({ premise: e.target.value })}
          />
        )}
      </Field>
      <Field label="Themes">
        {(id) => (
          <AutoTextarea
            id={id}
            value={draft.themes}
            minRows={2}
            maxRows={10}
            placeholder="What this story is about underneath"
            onChange={(e) => update({ themes: e.target.value })}
          />
        )}
      </Field>
      <Field label="Tone">{(id) => <Input id={id} value={draft.tone} placeholder="How this story should feel" onChange={(e) => update({ tone: e.target.value })} />}</Field>
    </div>
  )
}

// ---------- Series ----------

function SeriesPart({ story }: { story: Story }): React.JSX.Element {
  const id = useId()
  const series = useSeriesList()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = series?.find((s) => s.id === story.seriesId) ?? null

  // "New series" goes straight on to its name, and back to the series list after.
  const toggled = useRef(false)
  useEffect(() => {
    if (toggled.current) document.getElementById(naming ? `${id}-name` : `${id}-series`)?.focus()
  }, [naming, id])
  const startNaming = (on: boolean): void => {
    toggled.current = true
    setNaming(on)
    setError(null)
  }

  const move = async (seriesId: ID | null): Promise<void> => {
    setError(null)
    try {
      await api.updateStory(story.id, { seriesId })
      await useApp.getState().refreshStories()
    } catch (e) {
      setError(failed(e))
    }
  }

  const add = async (): Promise<void> => {
    if (busy) return
    if (!name.trim()) return setError('Give the new series a name.')
    setBusy(true)
    try {
      const made = await api.createSeries(name.trim())
      await useSeries.getState().load()
      await move(made.id)
      setName('')
      startNaming(false)
    } catch (e) {
      setError(failed(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Part title="Series" description="A series holds themes and tone for its books. Which series a story is in never changes what it knows.">
      <div className="flex flex-col gap-1">
        <label htmlFor={naming ? `${id}-name` : `${id}-series`} className="text-[12px] font-medium text-muted">
          {naming ? 'New series name' : 'Series'}
        </label>
        <div className="flex items-center gap-2">
          {naming ? (
            <>
              <Input
                id={`${id}-name`}
                value={name}
                placeholder="The Long Dark"
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void add()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    startNaming(false)
                  }
                }}
              />
              <Button onClick={() => void add()} loading={busy}>
                Add
              </Button>
              <IconButton label="Choose an existing series instead" onClick={() => startNaming(false)}>
                <X size={15} />
              </IconButton>
            </>
          ) : (
            <>
              <Select
                id={`${id}-series`}
                value={story.seriesId}
                allowNone
                noneLabel="No series"
                options={(series ?? []).map((s) => ({ value: s.id, label: s.name.trim() || 'Untitled series' }))}
                onChange={(v) => void move(v)}
              />
              <Button variant="ghost" icon={<Plus size={14} />} onClick={() => startNaming(true)}>
                New series
              </Button>
            </>
          )}
        </div>
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      </div>
      {current && !naming ? <SeriesFields key={current.id} series={current} /> : null}
    </Part>
  )
}

function SeriesFields({ series }: { series: Series }): React.JSX.Element {
  const [draft, setDraft] = useState({ name: series.name, themes: series.themes, tone: series.tone })
  const ref = useRef(draft)
  const autosave = useAutosave<typeof draft>(
    async (d) => {
      await api.updateSeries(series.id, d)
      await useSeries.getState().load()
    },
    { what: series.name.trim() ? `the series “${series.name.trim()}”` : 'the series' }
  )
  const { schedule } = autosave
  const update = (patch: Partial<typeof draft>): void => {
    const next = { ...ref.current, ...patch }
    ref.current = next
    setDraft(next)
    schedule(next)
  }
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line px-4 py-3.5" onBlur={() => void autosave.flush()}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[12.5px] text-muted">Shared by every story in this series.</p>
        <SaveNote status={autosave.status} error={autosave.error} />
      </div>
      <Field label="Series name">{(id) => <Input id={id} value={draft.name} onChange={(e) => update({ name: e.target.value })} />}</Field>
      <Field label="Series themes">
        {(id) => (
          <AutoTextarea
            id={id}
            value={draft.themes}
            minRows={2}
            maxRows={10}
            placeholder="What the series is about underneath"
            onChange={(e) => update({ themes: e.target.value })}
          />
        )}
      </Field>
      <Field label="Series tone">{(id) => <Input id={id} value={draft.tone} placeholder="How the series should feel" onChange={(e) => update({ tone: e.target.value })} />}</Field>
    </div>
  )
}

// ---------- What is it? ----------

function WhatIsIt({ story, details }: { story: Story; details: StoryDetails }): React.JSX.Element {
  const stories = useApp((s) => s.stories)
  const saved = placementOf(story)
  const [edit, setEdit] = useState<StoryPlacement | null>(null)
  const [saving, setSaving] = useState(false)
  const value = edit ?? saved
  const live = usePreview({ storyId: story.id, title: story.title, seriesId: story.seriesId, placement: value })
  // Until the first preview arrives, the saved one says the same thing.
  const fromDetails = !live.current && !edit ? details.preview : null
  const preview = fromDetails ?? live.preview
  const current = live.current || !!fromDetails

  const change = (p: StoryPlacement): void => setEdit(samePlacement(p, saved) ? null : p)

  const save = useCallback(
    async (p: StoryPlacement, summary: string): Promise<void> => {
      setSaving(true)
      const done = await savePlacement(story, p, summary)
      setSaving(false)
      // Kept if Adam changed it again meanwhile: that change is saved next.
      if (done) setEdit((cur) => (cur && samePlacement(cur, p) ? null : cur))
    },
    [story]
  )

  // A change saves straight away (Undo is in the toast) unless it would lose history or can't be saved.
  useEffect(() => {
    if (!edit || saving || !live.current || !live.preview || live.preview.problem || live.preview.warnings.length) return
    void save(edit, live.preview.summary)
  }, [edit, saving, live.current, live.preview, save])

  const [answered, setAnswered] = useState(() => followQuestionAnswered(story.id))
  const follow = !answered ? details.mightFollow[0] : undefined
  const gapFor = gapLabel(saved, stories)

  return (
    <>
      <Part
        id="story-what"
        title="What is it?"
        description="Where this story starts, and what it knows. Change it any time: nothing you wrote is rewritten, and what the AI knows is worked out again."
      >
        <PlacementEditor
          hideLegend
          storyId={story.id}
          seriesId={story.seriesId}
          value={value}
          onChange={change}
          preview={preview}
          current={current}
          onEndFirst={(r) => r.endFirst && void endFirst(r.storyId, r.endFirst.endRefId, r.endFirst.label)}
        />
        {edit && current && preview && !preview.problem && preview.warnings.length ? (
          <>
            <Warnings warnings={preview.warnings} onPick={change} />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={saving} onClick={() => void save(edit, preview.summary)}>
                Keep it this way
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>
                Put it back
              </Button>
            </div>
          </>
        ) : null}
        {edit && current && preview?.problem ? (
          <div>
            <Button size="sm" onClick={() => setEdit(null)}>
              Put it back
            </Button>
          </div>
        ) : null}
        {follow ? (
          <FollowQuestion
            story={story}
            book={follow}
            onNo={() => {
              dismissFollowQuestion(story.id)
              setAnswered(true)
            }}
          />
        ) : null}
        <FlowLine storyId={story.id} flow="when" onRetry={() => retryFlow(story.id, 'when')} />
        {details.leadsInto ? <LeadsIn story={story} leadsInto={details.leadsInto} /> : null}
      </Part>
      {gapFor ? <TimeGap key={story.id} story={story} label={gapFor} /> : null}
    </>
  )
}

function FollowQuestion({ story, book, onNo }: { story: Story; book: StoryRef; onNo: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Notice
      action={
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() => {
              setBusy(true)
              void moveToFollow(story, book).finally(() => setBusy(false))
            }}
          >
            Yes
          </Button>
          <Button size="sm" onClick={onNo}>
            No
          </Button>
        </div>
      }
    >
      <p className="font-medium">
        Should {book.title} now continue after {story.title}?
      </p>
      <p className="mt-0.5 text-muted">
        {book.title} also continues after the same story. If yes, {book.title} will know what happens in {story.title}, and the AI sorts which of its
        start-of-story changes happened before, during or after it.
      </p>
    </Notice>
  )
}

function LeadsIn({ story, leadsInto }: { story: Story; leadsInto: NonNullable<StoryDetails['leadsInto']> }): React.JSX.Element {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const me = leadsInto.leader.storyId === story.id
  const book = leadsInto.book.title
  const set = async (on: boolean): Promise<void> => {
    setError(null)
    try {
      await api.setLeadsIn(story.id, on)
      await useApp.getState().refreshStories()
    } catch (e) {
      setError(failed(e))
    }
  }
  // The last story before the book leads in unless Adam picks another, so there is nothing to turn off there.
  if (me && !leadsInto.marked) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-line px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
        <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />
        <span>
          <span className="font-medium text-fg">Leads into {book}.</span> Its ending leads into the opening of {book}, as the last story before it. To
          have another story lead in, turn it on in that story’s settings.
        </span>
      </p>
    )
  }
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
      <Switch id={id} checked={me} onChange={(on) => void set(on)} aria-describedby={`${id}-help`} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          Leads into {book}
        </label>
        <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          {me
            ? `You chose this story to lead into the opening of ${book}. Turn it off to go back to the last story before it.`
            : `${leadsInto.leader.title} leads into the opening of ${book} now. Turn this on to have this story lead in instead.`}
        </p>
        {error ? <p className="mt-1 text-[12px] text-danger">{error}</p> : null}
      </div>
    </div>
  )
}

// ---------- Time since the previous story ----------

function TimeGap({ story, label }: { story: Story; label: string }): React.JSX.Element {
  const [value, setValue] = useState(story.timeGap)
  const [error, setError] = useState<string | null>(null)
  const status = useFlows((s) => s.byStory[story.id]?.['time-gap'])
  const fill = (): void => runFlow(story.id, 'time-gap', () => api.fillTimeGap(story.id))

  const commit = async (): Promise<void> => {
    const next = value.trim()
    if (next === story.timeGap.trim()) return
    setError(null)
    try {
      await api.updateStory(story.id, { timeGap: next })
      await useApp.getState().refreshStories()
    } catch (e) {
      setError(failed(e))
      return
    }
    // A new gap: fill in what changed in it.
    if (next) fill()
  }

  return (
    <Part
      id="story-gap"
      title="Before this story starts"
      description="After a long gap, the AI fills in what changed in between, such as “Mara: died long ago”, and lists it under What changed."
    >
      <Field label={label} error={error}>
        {(id) => (
          <Input
            id={id}
            value={value}
            placeholder="Optional, such as 200 years"
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              }
            }}
          />
        )}
      </Field>
      <div className="flex min-h-7 flex-wrap items-center gap-3">
        <Button size="sm" onClick={fill} disabled={status?.state === 'running'}>
          What changed before this story starts?
        </Button>
        <FlowLine storyId={story.id} flow="time-gap" gap={story.timeGap} onRetry={fill} />
      </div>
    </Part>
  )
}

// ---------- A prequel's starting cast ----------

const CAST_KINDS = new Set<Entry['kind']>(['character', 'place', 'group', 'item'])

function StartingCast({ story, cast }: { story: Story; cast: ID[] }): React.JSX.Element {
  const id = useId()
  const entriesRev = useApp((s) => s.entriesRev)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [adding, setAdding] = useState<ID[]>([])
  const status = useFlows((s) => s.byStory[story.id]?.['starting-cast'])

  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(list.filter((e) => CAST_KINDS.has(e.kind))))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [entriesRev])

  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])
  const names = cast.map((c) => byId.get(c)?.name.trim()).filter((n): n is string => !!n)
  const choices = useMemo(() => (entries ?? []).filter((e) => !cast.includes(e.id)), [entries, cast])
  const running = status?.state === 'running'

  const draft = (): void => {
    const ids = adding
    if (!ids.length) return
    runFlow(story.id, 'starting-cast', () => api.draftStartingCast(story.id, ids))
    setAdding([])
  }

  return (
    <Part
      id="story-cast"
      title="Starting cast"
      description="A prequel needs younger versions of its cast and setting. Choose the characters, places, groups and items it uses, and the AI drafts how each of them was back then. You can edit any of them."
    >
      <p className="text-[13px] text-fg">
        {names.length ? (
          <>
            Starts with: {joinNames(names)}.{' '}
            <button
              type="button"
              className="text-accent underline-offset-2 hover:underline"
              onClick={() => useApp.getState().navigate({ kind: 'memory', sceneId: null })}
            >
              See them under What changed
            </button>
          </>
        ) : (
          <span className="text-muted">No one yet.</span>
        )}
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-cast`} className="text-[12px] font-medium text-muted">
          Add to the starting cast
        </label>
        <CastPicker
          id={`${id}-cast`}
          value={adding}
          characters={choices}
          onChange={setAdding}
          noun="entry"
          listLabel="Characters, places, groups and items"
          placeholder="Type a name…"
        />
      </div>
      <div className="flex min-h-7 flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" onClick={draft} disabled={!adding.length || running}>
          Draft how they start
        </Button>
        <FlowLine storyId={story.id} flow="starting-cast" onRetry={() => retryFlow(story.id, 'starting-cast')} />
      </div>
    </Part>
  )
}

const joinNames = (names: string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? ''))

// ---------- The style the AI gets ----------

function StyleForStory({ story }: { story: Story }): React.JSX.Element {
  const world = useApp((s) => s.world)
  const prefs = usePrefs((s) => s.prefs)
  useEffect(() => {
    if (!usePrefs.getState().prefs) void usePrefs.getState().load()
  }, [])
  const rules = useMemo(() => (prefs && world ? styleRules(prefs, world.style, story.style ?? {}) : null), [prefs, world, story.style])

  return (
    <Part title="Style the AI gets for this story" description="Your own preferences, then the world’s style guide, then this story’s own changes. Later ones win.">
      {rules === null ? null : rules.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Style rules">
          {rules.map((r) => (
            <li key={r.key} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-muted">{r.label}</p>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{r.value}</p>
              </div>
              <Badge tone={r.tag === 'This story' ? 'accent' : 'neutral'} className="mt-0.5 shrink-0">
                {r.tag}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">No style rules yet. Without any, the AI writes in a plain, natural style.</p>
      )}
      <div>
        <Button size="sm" onClick={() => void editStoryStyle(story.id)}>
          Change this story’s style
        </Button>
      </div>
    </Part>
  )
}

// ---------- Delete ----------

function DeletePart({ story, startingHere }: { story: Story; startingHere: StoryDetails['startingHere'] }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Part title="Delete this story" description="It stays in Recently deleted (Settings) for 30 days, and Undo brings it straight back.">
      {startingHere.length ? (
        <Notice>
          <p>
            {startingHere.length === 1 ? 'This story starts in it' : 'These stories start in it'}, so {startingHere.length === 1 ? 'it takes' : 'they take'} over
            where it starts. A backup is made first.
          </p>
          <ul className="mt-1.5 list-disc pl-5">
            {startingHere.map((s) => (
              <li key={s.storyId}>
                {s.title} will start {s.wouldStart} instead.
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div>
        <Button
          variant="danger"
          icon={busy ? undefined : <Trash2 size={14} />}
          loading={busy}
          onClick={() => {
            setBusy(true)
            void deleteStory(story, startingHere.length > 0).finally(() => setBusy(false))
          }}
        >
          Delete story
        </Button>
      </div>
    </Part>
  )
}

// ---------- The flows' quiet line ----------

function FlowLine({ storyId, flow, gap = '', onRetry }: { storyId: ID; flow: 'time-gap' | 'starting-cast' | 'when'; gap?: string; onRetry: () => void }): React.JSX.Element | null {
  const status = useFlows((s) => s.byStory[storyId]?.[flow])
  if (!status) return null
  return (
    <p role="status" className={cn('flex items-center gap-2 text-[12.5px] animate-fade-in', status.state === 'failed' ? 'text-fg' : 'text-muted')}>
      {status.state === 'running' ? <Spinner size={12} /> : status.state === 'done' ? <Check size={13} className="text-success" aria-hidden /> : null}
      <span>{flowLine(status, gap)}</span>
      {status.state === 'failed' ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </p>
  )
}
