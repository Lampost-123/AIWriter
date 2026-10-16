// The Critique tab beside a scene (the scene and chapter critic, contracts/critique.ts): honest craft feedback on the
// open scene or its whole chapter, only when Adam asks. "Critique scene" / "Critique chapter" asks the writer model
// (with a Stop while it reads); the report it gives is kept, so coming back shows it at once, and says when the words
// have changed since, with Critique again. A report is a short summary, what works, and a few notes, the ones that
// matter most first: each with what it is about, how much it matters, the words it points at (a click shows them in
// the page, opening their scene for a chapter's note) and what to do; "Rewrite this" hands the words and the note to
// the AI tools' Rewrite, as a tracked change to accept or reject (accepted, the note is marked Done). "Not needed" sets
// a note aside for this scene, "Not for this story" for every scene of the story; the critic is told both and never
// raises them again. A note whose words have changed since is dimmed and says so, in place, so nothing moves. Built like
// the Issues tab (IssuesPanel.tsx).
import { useEffect, useState } from 'react'
import type { Critique, CritiqueNote, CritiqueScope, CritiqueTarget, CritiqueWant, SavedCritique } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import { CircleCheck, MessageSquareQuote, PenLine } from '@/components/ui/icons'
import { Badge, Button, EmptyState, Notice, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { Segmented, useDelayed } from '@/features/generate/parts'
import { useDesk } from '@/features/look/look'
import { rewriteThis, showNote } from './actions'
import {
  CATEGORY_WORDS,
  CHANGED_WORDS,
  STATUS_WORDS,
  WEIGHT_WORDS,
  askWords,
  bringBackWords,
  changedWords,
  critiqueHeadline,
  noteState,
  quoted,
  readingNote,
  readingWords,
  shortenedWords,
  wantsWords
} from './critiqueLogic'
import {
  allowAgain,
  noteShown,
  setScope,
  settleNote,
  startCritique,
  stopCritique,
  targetKey,
  useCritique,
  useCritiqueStore
} from './critiqueStore'
import '@/features/consistency/check.css'
import '@/features/issues/issuesPanel.css'
import './critique.css'

export function CritiquePanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const scope = useCritiqueStore((s) => s.scope)
  const chapterId = useOutlineStore((s) => s.outline?.scenes.find((x) => x.id === sceneId)?.chapterId ?? null)
  const target: CritiqueTarget | null = scope === 'scene' ? { scope, id: sceneId } : chapterId ? { scope, id: chapterId } : null
  const key = target ? targetKey(target) : ''
  const saved = useCritique(target)
  const running = useCritiqueStore((s) => (key ? !!s.runs[key] : false))
  const failed = useCritiqueStore((s) => (key ? (s.failed[key] ?? null) : null))
  const critique = saved?.critique ?? null

  // So a critique that lands while Adam looks elsewhere can say it is ready.
  useEffect(() => {
    noteShown(key || null)
    return () => noteShown(null)
  }, [key])

  return (
    <div className="flex min-h-full flex-col" data-critique-panel>
      <div className="px-4 pt-3">
        <Segmented<CritiqueScope>
          label="Critique of"
          value={scope}
          onChange={setScope}
          className="flex w-full"
          options={[
            { value: 'scene', label: 'This scene' },
            { value: 'chapter', label: 'This chapter' }
          ]}
        />
      </div>
      {target ? <CritiqueBar target={target} critique={critique} running={running} /> : null}
      {failed ? (
        <div className="px-4 pb-2">
          <Notice tone="danger" action={settingsButton(failed)}>
            {failed}
          </Notice>
        </div>
      ) : null}
      {saved?.changed && critique && !running && target ? (
        <div className="px-4 pb-2">
          <Notice
            action={
              <Button size="sm" onClick={() => void startCritique(target)}>
                Critique again
              </Button>
            }
          >
            {changedWords(target.scope)}
          </Notice>
        </div>
      ) : null}
      {critique && saved && target ? (
        <Report saved={saved} target={target} />
      ) : saved === undefined && target ? null : ( // Loading: nothing rather than a flash; the report or the empty state takes its place.
        <NoCritique scope={scope} />
      )}
    </div>
  )
}

/** Open Settings, when the problem is fixed there. */
function settingsButton(message: string): React.JSX.Element | undefined {
  if (!/\bSettings\b/.test(message)) return undefined
  return (
    <Button size="sm" onClick={() => useApp.getState().navigate({ kind: 'settings', tab: 'models' })}>
      Open Settings
    </Button>
  )
}

/** When the critique was written and how many notes, and the button to ask (or, while it reads, Stop). */
function CritiqueBar({
  target,
  critique,
  running
}: {
  target: CritiqueTarget
  critique: Critique | null
  running: boolean
}): React.JSX.Element {
  const slow = useDelayed(running, 120)
  return (
    // A fixed height, so the bar never moves the report when a critique starts or ends.
    <div className="flex h-12 shrink-0 items-center gap-2 px-4">
      {running ? (
        <>
          <span
            role="status"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-muted transition-opacity duration-150',
              slow ? 'opacity-100' : 'opacity-0'
            )}
          >
            <Spinner size={13} className="shrink-0" />
            <span className="truncate">{readingWords(target.scope)}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => stopCritique(target)}>
            Stop
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{critique ? critiqueHeadline(critique) : ''}</span>
          <Button
            size="sm"
            className="iss-ai"
            icon={<MessageSquareQuote size={14} />}
            onClick={() => void startCritique(target)}
            title={
              target.scope === 'scene'
                ? 'Asks the writer model for honest feedback on the scene’s craft'
                : 'Asks the writer model for honest feedback on the chapter as a whole'
            }
          >
            {askWords(target.scope, !!critique)}
          </Button>
        </>
      )}
    </div>
  )
}

/** No critique yet: what one looks at, and that it only runs when asked. */
function NoCritique({ scope }: { scope: CritiqueScope }): React.JSX.Element {
  const words =
    scope === 'scene'
      ? 'Honest feedback on this scene’s craft: pacing, tension and stakes, voices and dialogue, clarity, showing and telling, the prose, and how it opens and ends.'
      : 'Honest feedback on the chapter as a whole: its shape, how its scenes flow into each other, pacing across them, and whether it ends with a pull to read on.'
  return (
    <EmptyState icon={<MessageSquareQuote size={20} />} title="No critique yet" className="py-8">
      {words} It runs only when you ask, and never changes your words: each note can offer a rewrite for you to accept or reject.
    </EmptyState>
  )
}

/** "What the AI saw" for the critique's request, coming back to the tab. */
function openRecord(critique: Critique): void {
  if (!critique.generationId) return
  useApp.getState().navigate({
    kind: 'generation',
    generationId: critique.generationId,
    back: {
      view: { kind: 'write' },
      label: 'Back to the critique',
      what: critique.scope === 'scene' ? 'this critique of the scene' : 'this critique of the chapter'
    }
  })
}

function Report({ saved, target }: { saved: SavedCritique; target: CritiqueTarget }): React.JSX.Element {
  const { critique } = saved
  const how = readingNote(critique)
  return (
    <section aria-label="Critique" className="flex flex-col gap-3 px-4 pb-4 pt-1 animate-fade-in">
      <div className="crit-overall rounded-lg border border-line bg-surface px-3 py-2.5">
        <h3 className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-faint">Overall</h3>
        <p className="mt-1 text-[13px] leading-[19px] text-fg">{critique.summary || 'The critic gave no summary.'}</p>
        {critique.shortened ? <p className="mt-1.5 text-[12px] leading-[17px] text-muted">{shortenedWords(critique.scope)}</p> : null}
        {how ? (
          <p className="mt-1.5 text-[12px] leading-[17px] text-muted" data-reading-note>
            {how}
          </p>
        ) : null}
        {critique.strengths.length ? (
          <>
            <h3 className="mt-2.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-faint">What works</h3>
            <ul aria-label="What works" className="mt-1 flex flex-col gap-1">
              {critique.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-[18px] text-fg">
                  <CircleCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-success" />
                  <span className="min-w-0">{s}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {critique.generationId ? (
          <button
            type="button"
            onClick={() => openRecord(critique)}
            className="mt-2 text-[12px] text-muted hover:text-fg hover:underline"
            title="The exact briefing the critic was given"
          >
            What the AI saw
          </button>
        ) : null}
      </div>
      {critique.notes.length ? (
        <ul aria-label="Notes" className="iss-list flex flex-col gap-2">
          {critique.notes.map((n) => (
            <li key={n.id}>
              <NoteCard note={n} chapter={critique.scope === 'chapter'} target={target} at={critique.at} gone={saved.gone} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted">No notes: the critic found nothing it would change.</p>
      )}
      {saved.wants.length ? <Wants wants={saved.wants} target={target} /> : null}
    </section>
  )
}

/**
 * What Adam said isn't for this story: a quiet line under the notes, opened to a list where each kind of note can be
 * allowed again.
 */
function Wants({ wants, target }: { wants: CritiqueWant[]; target: CritiqueTarget }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12px] leading-[17px] text-muted" data-critique-wants>
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span>{wantsWords(wants.length)}</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="text-accent hover:underline"
          title="The kinds of note the critic leaves out of every scene of this story"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </p>
      {open ? (
        <ul aria-label="Not for this story" className="mt-1.5 flex flex-col gap-1">
          {wants.map((w) => (
            <li key={w.id} className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={w.suggestion || undefined}>
                <span className="text-fg">“{w.title}”</span> · {CATEGORY_WORDS[w.category]}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void allowAgain(target, w)} title="Let the critic raise notes like this again">
                Allow again
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function WeightMark({ note }: { note: CritiqueNote }): React.JSX.Element {
  const desk = useDesk()
  if (desk)
    return (
      <span className="ck-sev" data-weight={note.weight}>
        {WEIGHT_WORDS[note.weight]}
      </span>
    )
  return (
    <Badge tone={note.weight === 'high' ? 'accent' : 'neutral'} className={note.weight === 'low' ? 'text-faint' : undefined}>
      {WEIGHT_WORDS[note.weight]}
    </Badge>
  )
}

/** The scene a chapter's note is in, by its title in the binder. */
function SceneName({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const title = useOutlineStore((s) => s.outline?.scenes.find((x) => x.id === sceneId)?.title ?? null)
  if (title === null) return null
  return <> · {title.trim() || 'Untitled scene'}</>
}

function NoteCard({
  note,
  chapter,
  target,
  at,
  gone
}: {
  note: CritiqueNote
  chapter: boolean
  target: CritiqueTarget
  at: string
  gone: readonly string[]
}): React.JSX.Element {
  const anchored = !!note.quote.trim() && !!note.sceneId
  const state = noteState(note, gone)
  // Its words are no longer in the scene: nothing to rewrite or show, said in place (the buttons stay, so nothing moves).
  const changed = state === 'changed'
  return (
    <article
      aria-label={`${WEIGHT_WORDS[note.weight]}: ${note.title}`}
      data-weight={note.weight}
      data-state={state}
      className="iss-card crit-note rounded-lg border border-line bg-surface px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* One line, whatever the width: the weight never wraps, what it is about gives way first, then the tag. */}
        <span className="shrink-0 whitespace-nowrap">
          <WeightMark note={note} />
        </span>
        <span className="min-w-0 truncate text-[11.5px] text-faint" style={{ flexShrink: 100 }}>
          {CATEGORY_WORDS[note.category]}
          {note.repeated ? ' · Still stands from last time' : null}
          {chapter && note.sceneId ? <SceneName sceneId={note.sceneId} /> : null}
        </span>
        {state !== 'open' ? (
          <span
            className={cn('crit-state ml-auto min-w-0 truncate whitespace-nowrap text-[11.5px] font-medium', state === 'done' ? 'text-success' : 'text-muted')}
            data-note-state={state}
            title={state === 'changed' ? CHANGED_WORDS : STATUS_WORDS[state]}
          >
            {state === 'changed' ? CHANGED_WORDS : STATUS_WORDS[state]}
          </span>
        ) : null}
      </div>
      <div className="crit-body">
        <h4 className="mt-1.5 text-[13px] font-semibold leading-[18px] text-fg">{note.title}</h4>
        {anchored ? (
          <button
            type="button"
            onClick={() => showNote(note)}
            title={changed || note.status === 'done' ? 'These words have changed since the critique' : 'Show these words in the page'}
            className="iss-quote -mx-1 mt-1.5 block w-[calc(100%+0.5rem)] rounded px-1 py-0.5 text-left font-serif text-[14px] leading-[21px] text-fg hover:bg-surface-2"
          >
            <span className="line-clamp-3">{quoted(note.quote.trim())}</span>
          </button>
        ) : null}
        {note.suggestion ? <p className="iss-msg mt-1 text-[12.5px] leading-[18px] text-muted">{note.suggestion}</p> : null}
      </div>
      <div className="iss-acts mt-2 flex flex-wrap gap-1.5">
        {note.status ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void settleNote(target, note, null, { at })}
            title={note.status === 'done' ? 'Show this note as still to do' : 'Show this note again, and let the critic raise it again'}
          >
            {bringBackWords(note.status)}
          </Button>
        ) : (
          <>
            {anchored ? (
              <>
                <Button
                  size="sm"
                  className="iss-ai"
                  icon={<PenLine size={14} />}
                  disabled={changed}
                  onClick={() => void rewriteThis(note, target, at)}
                  title={
                    changed
                      ? 'These words have changed since the critique, so there is nothing here to rewrite'
                      : 'Asks the writer model to rewrite these words with this note in mind, shown in the page to accept or reject'
                  }
                >
                  Rewrite this
                </Button>
                <Button size="sm" variant="ghost" disabled={changed} onClick={() => showNote(note)} title="Show these words in the page">
                  Show in the page
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void settleNote(target, note, 'dismissed', { at })}
              title={`Set this note aside: the critic won’t raise it for this ${chapter ? 'chapter' : 'scene'} again`}
            >
              Not needed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void settleNote(target, note, 'unwanted', { at })}
              title="Don’t raise this kind of note anywhere in this story (you can allow it again below)"
            >
              Not for this story
            </Button>
          </>
        )}
      </div>
    </article>
  )
}

/** The label of the scene panel's Critique tab: "Critique", or its icon when the panel is narrow (still read out). */
export function CritiqueLabel({ crowded }: { crowded: boolean }): React.JSX.Element {
  return crowded ? (
    <>
      <span className="@max-[459px]:sr-only">Critique</span>
      <span aria-hidden title="Critique" className="@min-[460px]:hidden">
        <MessageSquareQuote size={15} />
      </span>
    </>
  ) : (
    <>
      <span className="@max-[359px]:sr-only">Critique</span>
      <span aria-hidden title="Critique" className="@min-[360px]:hidden">
        <MessageSquareQuote size={15} />
      </span>
    </>
  )
}
