// Quick start: Adam types or pastes whatever he knows, and one click builds and saves the whole
// profile. It streams: each field is added at the end of the profile as it arrives, so nothing he is
// reading moves, and Stop keeps what has fully arrived. His own words are kept as written and marked
// as his; the rest is drafted by AI. The notes and a build still running are kept in quickStartStore,
// so leaving the screen loses neither. Once a build has saved a character, its notes are done with:
// they can't be typed in, and Start another clears them for the next one.
import { Check, Sparkles, Square } from '@/components/ui/icons'
import { useLayoutEffect, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { BuilderKind, BuilderStart } from '@shared/contracts/builder'
import type { Entry } from '@shared/types'
import { Button, Kbd, toast } from '@/components/ui'
import { api, modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { labelOf, shownValue } from './builderLogic'
import { DuplicateHint, MarkLine, ProblemNotice, useWorldEntries, WritingStatus } from './parts'
import {
  buildQuickStart,
  openQuickStart,
  sessionKey,
  setQuickNotes,
  startAnotherQuickStart,
  stopQuickStart,
  useQuickStart,
  type QuickSession
} from './quickStartStore'
import { MicButton } from '@/features/dictation/MicButton'
import { insertIntoBox } from '@/features/dictation/insertText'

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
  start,
  onLookOver,
  onGuided
}: {
  kind: BuilderKind
  /** How the builder was opened (with a passage Adam selected in a scene, say). */
  start?: BuilderStart
  /** Opens the finished profile step by step. */
  onLookOver: (e: Entry) => void
  /** Walks the steps instead, without the AI building it first. */
  onGuided: () => void
}): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const session = useQuickStart((st) => st.sessions[sessionKey(worldId, kind)])
  const [opened, setOpened] = useState(false)
  // Once each time the builder opens, before anything is drawn, so the first frame is the right one.
  useLayoutEffect(() => {
    openQuickStart(kind, start)
    setOpened(true)
  }, [kind, start])
  if (!opened || !session) return <div className="h-full" />
  return <Screen kind={kind} s={session} onLookOver={onLookOver} onGuided={onGuided} />
}

function Screen({
  kind,
  s,
  onLookOver,
  onGuided
}: {
  kind: BuilderKind
  s: QuickSession
  onLookOver: (e: Entry) => void
  onGuided: () => void
}): React.JSX.Element {
  const storyId = useApp((st) => st.storyId)
  const copy = COPY[kind]
  const noun = KIND_LABELS[kind].one.toLowerCase()
  const [opening, setOpening] = useState(false)
  const notesBox = useRef<HTMLTextAreaElement>(null)
  const { view, done } = s

  const running = !!s.jobId
  const name = view.values.name?.trim() ?? ''
  const saved = !!view.entryId
  const finished = !running && !!done
  // The connection dropped (say) after the entry was saved: what arrived is kept, and the rest can be finished.
  const partSaved = finished && saved && done.status === 'error'
  // The notes being built from, or that a saved character was built from: not for typing in.
  const locked = running || (finished && saved)
  const build = (finish = false): void => void buildQuickStart(kind, storyId, { finish })
  const another = (): void => {
    startAnotherQuickStart(kind)
    notesBox.current?.focus()
  }

  const lookOver = async (): Promise<void> => {
    const id = view.entryId
    if (!id) return
    setOpening(true)
    try {
      onLookOver(await api.getEntry(id))
    } catch (e) {
      setOpening(false)
      toast(`Couldn’t open it. ${(e as Error).message}`, { tone: 'danger' })
    }
  }

  const status = running
    ? (s.retrying ?? (s.finishing ? `Finishing ${name || `the ${noun}`}…` : name ? `Building ${name}…` : `Building the ${noun}…`))
    : finished && saved
      ? done.status === 'complete'
        ? `${name} is built and saved. Your words are kept as you wrote them; the rest is drafted by AI.`
        : done.status === 'stopped'
          ? 'Stopped. What had fully arrived is saved.'
          : 'It stopped part way. What had arrived is saved.'
      : finished && done.status === 'stopped'
        ? 'Stopped before it had a name, so nothing was saved.'
        : null
  const showProfile = running || Object.keys(view.values).length > 0

  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[680px] px-8 pb-16 pt-10">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Sparkles size={12} className="text-ai" aria-hidden />
          Quick start
        </div>
        <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">{copy.title}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {s.sceneId
            ? `The passage you selected is below; add anything else you know. AI Write builds the whole ${noun} to fit your world and saves it.`
            : `Type or paste whatever you know, from one line to rough notes. AI Write builds the whole ${noun} to fit your world and saves it.`}{' '}
          Your own words are kept exactly as you wrote them.
        </p>

        <div className="mt-5 flex items-end justify-between gap-2">
          <label htmlFor="builder-notes" className="block text-[12px] font-medium text-muted">
            {copy.about}
          </label>
          <MicButton
            disabled={locked}
            onText={(t) => notesBox.current && insertIntoBox(notesBox.current, t, (v) => setQuickNotes(kind, v))}
          />
        </div>
        <AutoTextarea
          ref={notesBox}
          id="builder-notes"
          autoFocus={!s.notes}
          value={s.notes}
          readOnly={locked}
          title={finished && saved ? `To build another ${noun}, choose Start another.` : undefined}
          minRows={4}
          maxRows={14}
          placeholder={copy.placeholder}
          className={cn('mt-1 font-serif text-[15px] leading-[1.6]', locked && 'bg-surface-2!')}
          onChange={(e) => setQuickNotes(kind, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (!locked) build()
            }
          }}
        />

        <div className="mt-3 flex h-10 items-center gap-2">
          {running ? (
            <>
              <Button
                size="lg"
                icon={<Square size={11} fill="currentColor" />}
                onClick={() => stopQuickStart(kind)}
                title="Stop. What has fully arrived is kept and saved."
              >
                Stop
              </Button>
              <WritingStatus text={status ?? ''} title={s.retrying ?? undefined} />
            </>
          ) : partSaved ? (
            <>
              <Button
                variant="primary"
                size="lg"
                icon={<Sparkles size={15} />}
                onClick={() => build(true)}
                title="Fills in only the fields that are still empty. What is saved stays as it is."
              >
                Finish the rest
              </Button>
              <Button size="lg" loading={opening} onClick={() => void lookOver()}>
                Look it over step by step
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" onClick={another}>
                Start another
              </Button>
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
              <Button variant="ghost" onClick={another}>
                Start another
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" icon={<Sparkles size={15} />} onClick={() => build()}>
                {done && done.status === 'error' ? 'Try again' : copy.build}
              </Button>
              <Button variant="ghost" size="lg" onClick={onGuided}>
                Go step by step instead
              </Button>
              <div className="flex-1" />
              <span className="flex items-center gap-1 text-[12px] text-faint" title={`Press ${modKey()}+Enter in the notes to build`}>
                <Kbd>{modKey()}</Kbd>
                <Kbd>Enter</Kbd>
              </span>
            </>
          )}
        </div>

        <div className="mt-1 min-h-5">
          {!running && status ? (
            <p role="status" className="flex items-center gap-1.5 text-[12.5px] text-muted animate-fade-in">
              {saved && !partSaved ? <Check size={13} className="shrink-0 text-success" aria-hidden /> : null}
              {status}
            </p>
          ) : null}
        </div>

        {s.problem ? (
          <div className="mt-2">
            <ProblemNotice message={s.problem.message} code={s.problem.code} />
          </div>
        ) : null}

        {showProfile ? <Profile kind={kind} s={s} running={running} /> : null}
      </div>
    </div>
  )
}

/**
 * The profile as it arrives: the name at the top, then each field once it has fully arrived and the
 * one being written, in the order they came. A field keeps its box from being written to finished;
 * only the amber highlight and the caret give way to the line saying whose words they are.
 */
function Profile({ kind, s, running }: { kind: BuilderKind; s: QuickSession; running: boolean }): React.JSX.Element {
  const entries = useWorldEntries()
  const { view } = s
  const waiting = useDelayed(running && Object.keys(view.values).length === 0 && !view.writing, 250)
  const name = view.values.name?.trim() ?? ''
  const writingName = view.writing?.key === 'name' ? view.writing.text : null
  const mark = (key: string): 'notes' | 'ai' => (view.fromNotes.includes(key) ? 'notes' : 'ai')
  const w = view.writing
  const writing = w && w.key !== 'name' && !view.values[w.key]?.trim() ? w : null
  // One list with the field being written last, so a field that has just arrived keeps its place and its box.
  const shown: { key: string; text: string; mark?: 'notes' | 'ai' }[] = s.order
    .filter((k) => k !== 'name' && view.values[k]?.trim())
    .map((k) => ({ key: k, text: view.values[k], mark: mark(k) }))
  if (writing) shown.push({ key: writing.key, text: writing.text })

  return (
    <section
      aria-label="The profile so far"
      aria-busy={running}
      className="mt-6 rounded-xl border border-line bg-surface px-5 pb-5 pt-4 shadow-soft"
    >
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
      {/* Whose the name is (a line kept from the start), and under it, a warning when it is very like another one. */}
      <div className="flex min-h-[18px] min-w-0 items-center text-[12px]">
        <MarkLine mark={name ? mark('name') : null} />
      </div>
      {name ? (
        <DuplicateHint
          kind={kind}
          entryId={view.entryId}
          name={name}
          aliases={view.values.aliases ?? ''}
          entries={entries}
          className="mt-1 text-[12px]"
        />
      ) : null}

      {shown.length ? (
        <dl className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
          {shown.map((f) => (
            <ProfileField key={f.key} label={labelOf(kind, f.key)} text={shownValue(f.key, f.text)} mark={f.mark} />
          ))}
        </dl>
      ) : waiting ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-4">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : null}
    </section>
  )
}

/** One field of the profile: being written (no `mark` yet) or arrived, in the same box either way. */
function ProfileField({ label, text, mark }: { label: string; text: string; mark?: 'notes' | 'ai' }): React.JSX.Element {
  const box = '-mx-2 mt-0.5 whitespace-pre-wrap break-words rounded-md px-2 py-0.5 text-[13.5px] leading-[1.6] text-fg'
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-muted">{label}</dt>
      <dd className={cn(box, !mark && 'bg-ai-soft')}>
        {text}
        {mark ? null : <Caret />}
      </dd>
      <dd>
        <MarkLine mark={mark ?? null} />
      </dd>
    </div>
  )
}

const Caret = (): React.JSX.Element => <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ai" />
