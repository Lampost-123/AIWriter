// Quick start: Adam types or pastes whatever he knows, and one click builds and saves the whole
// profile. It streams: the profile fills in as the reply arrives, and Stop keeps what has fully
// arrived. His own words are kept as written and marked as his; the rest is drafted by AI.
import { Check, Sparkles, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { BuilderDone, BuilderKind, BuilderProgress } from '@shared/contracts/builder'
import type { Entry, ID } from '@shared/types'
import { Button, Kbd, toast } from '@/components/ui'
import { api, ApiError, modKey } from '@/lib/api'
import { useApp } from '@/lib/store'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { stepsFor } from './builderLogic'
import { MarkLine, ProblemNotice, WritingStatus } from './parts'
import { useBuilderJob } from './useBuilderJob'

type View = Pick<BuilderProgress, 'values' | 'fromNotes' | 'writing' | 'entryId'>
const EMPTY: View = { values: {}, fromNotes: [], writing: null, entryId: null }

const COPY: Record<BuilderKind, { title: string; about: string; placeholder: string; build: string }> = {
  character: {
    title: 'Build a character from a few notes',
    about: 'What you know about them',
    placeholder: 'A grumpy ex-soldier who runs the ferry and owes the Duke money.',
    build: 'Build the character'
  },
  place: {
    title: 'Build a place from a few notes',
    about: 'What you know about it',
    placeholder: 'A salt-crusted port town where nobody asks questions, and the tide comes in twice as fast as it should.',
    build: 'Build the place'
  },
  group: {
    title: 'Build a group from a few notes',
    about: 'What you know about them',
    placeholder: 'A guild of smugglers who answer to no crown and pay their debts in silver and favours.',
    build: 'Build the group'
  },
  item: {
    title: 'Build an item from a few notes',
    about: 'What you know about it',
    placeholder: 'A cracked compass that always points to the person you miss most.',
    build: 'Build the item'
  }
}

export function QuickStart({
  kind,
  notes,
  onNotes,
  sceneId,
  onLookOver,
  onGuided
}: {
  kind: BuilderKind
  notes: string
  onNotes: (v: string) => void
  /** The scene a passage came from, when the notes are a passage Adam selected. */
  sceneId: ID | null
  /** Opens the finished profile step by step. */
  onLookOver: (e: Entry) => void
  /** Walks the steps instead, without the AI building it first. */
  onGuided: () => void
}): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const copy = COPY[kind]
  const noun = KIND_LABELS[kind].one.toLowerCase()
  const [view, setView] = useState<View>(EMPTY)
  const [done, setDone] = useState<BuilderDone | null>(null)
  const [problem, setProblem] = useState<{ message: string; code?: string } | null>(null)
  const [opening, setOpening] = useState(false)

  // Quick start saves as it goes, so it keeps going if Adam leaves this screen.
  const job = useBuilderJob({
    onProgress: (p) => setView(p),
    onDone: (d) => {
      setView(d)
      setDone(d)
      if (d.status === 'error' && d.error) setProblem({ message: d.error })
    }
  })
  const running = !!job.running

  const build = async (): Promise<void> => {
    if (running) return
    if (!notes.trim()) {
      const who = kind === 'character' || kind === 'group' ? 'them' : 'it'
      setProblem({ message: `Type or paste something about ${who} first. One line is enough.` })
      return
    }
    setView(EMPTY)
    setDone(null)
    setProblem(null)
    try {
      await job.start('quick-start', (jobId) => api.startQuickStart({ jobId, kind, notes, storyId, sceneId }))
    } catch (e) {
      setProblem({ message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined })
    }
  }

  const lookOver = async (): Promise<void> => {
    const id = view.entryId
    if (!id) return
    setOpening(true)
    try {
      onLookOver(await api.getEntry(id))
    } catch (e) {
      setOpening(false)
      toast(`Couldn't open it. ${(e as Error).message}`, { tone: 'danger' })
    }
  }

  const startAnother = (): void => {
    onNotes('')
    setView(EMPTY)
    setDone(null)
    setProblem(null)
  }

  const name = view.values.name?.trim() ?? ''
  const saved = !!view.entryId
  const finished = !running && !!done
  const showProfile = running || Object.keys(view.values).length > 0
  const status = running
    ? (job.running?.retrying ?? (name ? `Building ${name}…` : `Building the ${noun}…`))
    : finished && saved
      ? done.status === 'complete'
        ? `${name} is built and saved. Your words are kept as you wrote them; the rest is drafted by AI.`
        : 'Stopped. What had fully arrived is saved.'
      : finished && done.status === 'stopped'
        ? 'Stopped before it had a name, so nothing was saved.'
        : null

  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[680px] px-8 pb-16 pt-10">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Sparkles size={12} className="text-ai" aria-hidden />
          Quick start
        </div>
        <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">{copy.title}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {sceneId
            ? `The passage you selected is below; add anything else you know. AI Write builds the whole ${noun} to fit your world and saves it.`
            : `Type or paste whatever you know, from one line to rough notes. AI Write builds the whole ${noun} to fit your world and saves it.`}{' '}
          Your own words are kept exactly as you wrote them.
        </p>

        <label htmlFor="builder-notes" className="mt-5 block text-[12px] font-medium text-muted">
          {copy.about}
        </label>
        <AutoTextarea
          id="builder-notes"
          autoFocus={!notes}
          value={notes}
          readOnly={running}
          minRows={4}
          maxRows={14}
          placeholder={copy.placeholder}
          className="mt-1 font-serif text-[15px] leading-[1.6]"
          onChange={(e) => {
            onNotes(e.target.value)
            if (problem && !running) setProblem(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (!finished || !saved) void build()
            }
          }}
        />

        <div className="mt-3 flex h-10 items-center gap-2">
          {running ? (
            <>
              <Button
                size="lg"
                icon={<Square size={11} fill="currentColor" />}
                onClick={job.stop}
                title="Stop. What has fully arrived is kept and saved."
              >
                Stop
              </Button>
              <WritingStatus text={status ?? ''} title={job.running?.retrying ?? undefined} />
            </>
          ) : finished && saved ? (
            <>
              <Button variant="primary" size="lg" loading={opening} onClick={() => void lookOver()}>
                Look it over step by step
              </Button>
              <Button size="lg" onClick={() => useApp.getState().navigate({ kind: 'write' })}>
                Back to writing
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" onClick={startAnother}>
                Start another
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" icon={<Sparkles size={15} />} onClick={() => void build()}>
                {done && done.status === 'error' ? 'Try again' : copy.build}
              </Button>
              <Button variant="ghost" size="lg" onClick={onGuided}>
                Go step by step instead
              </Button>
              <div className="flex-1" />
              <span className="flex items-center gap-1 text-[12px] text-faint" title={`Press ${modKey()}+Enter in the notes to build`}>
                <Kbd>{modKey()}</Kbd>+<Kbd>Enter</Kbd>
              </span>
            </>
          )}
        </div>

        <div className="mt-1 min-h-5">
          {!running && status ? (
            <p role="status" className="flex items-center gap-1.5 text-[12.5px] text-muted animate-fade-in">
              {saved ? <Check size={13} className="shrink-0 text-success" aria-hidden /> : null}
              {status}
            </p>
          ) : null}
        </div>

        {problem ? (
          <div className="mt-2">
            <ProblemNotice message={problem.message} code={problem.code} />
          </div>
        ) : null}

        {showProfile ? <Profile kind={kind} view={view} running={running} /> : null}
      </div>
    </div>
  )
}

/** The profile as it arrives: each field once it has fully arrived, and the one being written. */
function Profile({ kind, view, running }: { kind: BuilderKind; view: View; running: boolean }): React.JSX.Element {
  const sections = useMemo(
    () =>
      stepsFor(kind)
        .filter((s) => !s.special)
        .map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== 'name') })),
    [kind]
  )
  const waiting = useDelayed(running && Object.keys(view.values).length === 0 && !view.writing, 250)
  const name = view.values.name?.trim() ?? ''
  const writingName = view.writing?.key === 'name' ? view.writing.text : null
  const mark = (key: string): 'notes' | 'ai' => (view.fromNotes.includes(key) ? 'notes' : 'ai')

  return (
    <section aria-label="The profile so far" aria-busy={running} className="mt-6 rounded-xl border border-line bg-surface px-5 pb-5 pt-4 shadow-soft">
      <div className="flex min-h-[40px] items-center gap-3">
        {name || writingName ? (
          <p className="min-w-0 flex-1 font-serif text-[22px] font-semibold leading-tight text-fg">
            {name || writingName}
            {!name ? <Caret /> : null}
          </p>
        ) : waiting ? (
          <Skeleton className="h-6 w-48" />
        ) : (
          <div className="flex-1" />
        )}
        {view.entryId ? (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-faint">
            <Check size={12} aria-hidden />
            Saved
          </span>
        ) : null}
      </div>
      {name ? <MarkLine mark={mark('name')} /> : null}

      {waiting ? (
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : null}

      {sections.map((s) => {
        const shown = s.fields.filter((f) => view.values[f.key]?.trim() || view.writing?.key === f.key)
        if (!shown.length) return null
        return (
          <div key={s.id} className="mt-4 border-t border-line pt-3">
            <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{s.label}</h3>
            <dl className="mt-2 flex flex-col gap-2.5">
              {shown.map((f) => {
                const value = view.values[f.key]?.trim()
                return (
                  <div key={f.key} className="min-w-0">
                    <dt className="text-[12px] font-medium text-muted">{f.label}</dt>
                    {value ? (
                      <>
                        <dd className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-fg">{view.values[f.key]}</dd>
                        <dd>
                          <MarkLine mark={mark(f.key)} />
                        </dd>
                      </>
                    ) : (
                      <dd className="mt-0.5 whitespace-pre-wrap rounded-md bg-ai-soft px-2 py-1 text-[13.5px] leading-[1.6] text-fg">
                        {view.writing?.text}
                        <Caret />
                      </dd>
                    )}
                  </div>
                )
              })}
            </dl>
          </div>
        )
      })}
    </section>
  )
}

const Caret = (): React.JSX.Element => <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ai" />
