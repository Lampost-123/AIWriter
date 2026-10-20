// Interview me, topic by topic (Adam, 2026-10-20): Characters, Places, Lore and history, then How it all connects,
// each its own interview, in any order. Picking one opens it under the topics: the AI asks a few short questions at a
// time (answer, skip, or stop asking), then suggests pages for the codex (the connections: links between the pages and
// additions to them), each to keep, change or discard, with Undo. Nothing goes into the world without a click. Each
// topic says whether it is done (something kept from it); How it all connects is offered once something is kept. The
// same in Build with AI's Cast and world (a story) and on the World builder page (storyId null).

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { InterviewTopic, TopicEntry, TopicLink } from '@shared/contracts/worldInterviews'
import { INTERVIEW_TOPICS } from '@shared/contracts/worldInterviews'
import { KIND_LABELS } from '@shared/fields'
import type { ID } from '@shared/types'
import { BookOpen, Check, CircleCheck, Link2, MapPin, MessageCircleQuestion, Square, Undo2, Users, X } from '@/components/ui/icons'
import { Button, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp, type RecordBack } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { useEntryCounts } from '@/features/binder/WorldSection'
import { ProblemNotice } from '@/features/builder/parts'
import { LampStatus } from '@/features/planning/LampThinking'
import {
  answeredWords,
  batchWords,
  connectionsOpen,
  entryLines,
  hasAnswers,
  linkWords,
  partLabel,
  partsToShow,
  topicStatus,
  TOPIC_TEXT
} from './topicLogic'
import {
  askMore,
  changeEntry,
  changeLink,
  closeTopic,
  discard,
  keep,
  keepAll,
  loadProgress,
  openTopic,
  retry,
  runOf,
  scopeKey,
  sendAnswers,
  setAnswer,
  skipRound,
  stopAsking,
  stopCall,
  suggest,
  undoKeep,
  useInterviews,
  type TopicRun
} from './topicStore'
import './topicInterviews.css'

const ICONS: Record<InterviewTopic, typeof Users> = { characters: Users, places: MapPin, lore: BookOpen, connections: Link2 }

export interface TopicInterviewsProps {
  /** The story (Build with AI), or null for the world on its own (the World builder page). */
  storyId: ID | null
  /** Where What the AI saw comes back to. */
  back: RecordBack
  className?: string
}

export function TopicInterviews({ storyId, back, className }: TopicInterviewsProps): React.JSX.Element {
  const key = useApp((s) => `${s.world?.id ?? ''}:${storyId ?? ''}`)
  const scope = useInterviews((s) => s.scopes[key])
  const entriesRev = useApp((s) => s.entriesRev)
  const memoryRev = useApp((s) => s.memoryRev)
  // What each topic has kept, as the world has it now (an Undo in What changed, a page deleted).
  useEffect(() => {
    void loadProgress(storyId)
  }, [storyId, key, entriesRev, memoryRev])
  const progress = scope?.progress ?? null
  const open = scope?.open ?? null
  const linkable = connectionsOpen(progress, useEntryCounts())
  return (
    <section aria-label="Questions by topic" className={cn('wi', className)} data-topic-interviews>
      <div className="wi-head">
        <MessageCircleQuestion size={15} className="text-ai" aria-hidden />
        <h3 className="wi-t">Interview me, topic by topic</h3>
      </div>
      <p className="wi-s">
        The AI asks a few short questions about one part at a time, building on what you already have, then suggests pages for your codex. Nothing goes into your
        world until you keep it.
      </p>
      <div className="wi-topics" role="group" aria-label="Topics">
        {INTERVIEW_TOPICS.map((t) => {
          const Icon = ICONS[t]
          const run = scope?.topics[t]
          const started = !!run && (run.asked.length > 0 || run.phase !== 'idle' || run.entries.length > 0 || run.links.length > 0)
          const status = topicStatus(progress?.[t] ?? 0, started)
          const locked = t === 'connections' && !linkable
          return (
            <button
              key={t}
              type="button"
              className={cn('wi-topic', open === t && 'is-open', status.done && 'is-done')}
              aria-pressed={open === t}
              disabled={locked}
              title={locked ? 'Add a character, place or lore first: this interview links what your world already has.' : undefined}
              onClick={() => (open === t ? closeTopic(storyId) : openTopic(storyId, t))}
              data-topic={t}
            >
              <span className="wi-topic-top">
                <Icon size={14} aria-hidden className="wi-topic-i" />
                <span className="wi-topic-t">{TOPIC_TEXT[t].title}</span>
              </span>
              <span className="wi-topic-l">{TOPIC_TEXT[t].line}</span>
              <span className={cn('wi-topic-s', status.done && 'is-done')} data-topic-status>
                {status.done ? <CircleCheck size={12} aria-hidden /> : null}
                {locked ? 'Add a character, place or lore first' : status.words}
              </span>
            </button>
          )
        })}
      </div>
      {open ? <TopicPanel key={`${key}:${open}`} storyId={storyId} topic={open} back={back} /> : null}
    </section>
  )
}

function TopicPanel({ storyId, topic, back }: { storyId: ID | null; topic: InterviewTopic; back: RecordBack }): React.JSX.Element {
  const r = useInterviews((s) => s.scopes[scopeKey(storyId)]?.topics[topic]) ?? runOf(storyId, topic)
  const links = topic === 'connections'
  const whatTheAISaw = r.generationId
    ? () => useApp.getState().navigate({ kind: 'generation', generationId: r.generationId!, back: { ...back, what: `this interview about ${TOPIC_TEXT[topic].title.toLowerCase()}` } })
    : null
  return (
    <div role="region" aria-label={TOPIC_TEXT[topic].title} className="wi-panel animate-fade-in" data-topic-panel={topic}>
      <div className="wi-panel-head">
        <h4 className="wi-panel-t">{TOPIC_TEXT[topic].title}</h4>
        {r.asked.length ? <span className="wi-panel-n">{answeredWords(r.asked)}</span> : null}
        <span className="flex-1" />
        <button type="button" className="wi-close" onClick={() => closeTopic(storyId)} aria-label="Close this interview" title="Close. What you answered stays, to come back to.">
          <X size={14} />
        </button>
      </div>
      {r.problem ? (
        <div className="mt-2">
          <ProblemNotice message={r.problem.message} code={r.problem.code} onRetry={() => retry(storyId, topic)} />
        </div>
      ) : null}
      {r.phase === 'asking' ? (
        <Working text={r.asked.length ? 'Thinking of the next questions…' : 'Reading what you have so far…'} onStop={() => stopCall(storyId, topic)} />
      ) : r.phase === 'suggesting' ? (
        <Working text={links ? 'Finding the links in your answers…' : 'Suggesting pages from your answers…'} onStop={() => stopCall(storyId, topic)} />
      ) : r.phase === 'answering' ? (
        <Questions storyId={storyId} topic={topic} r={r} />
      ) : r.phase === 'review' ? (
        <Review storyId={storyId} topic={topic} r={r} whatTheAISaw={whatTheAISaw} />
      ) : !r.problem && r.asked.length ? (
        <div className="wi-row">
          <p className="wi-note">{hasAnswers(r.asked) ? 'Carry on, or have the AI suggest from your answers so far.' : 'Nothing answered yet.'}</p>
          {!r.enough ? (
            <Button size="sm" variant="ghost" onClick={() => void askMore(storyId, topic)}>
              Ask me more
            </Button>
          ) : null}
          {hasAnswers(r.asked) ? (
            <Button size="sm" variant="ai" onClick={() => void suggest(storyId, topic)} data-suggest>
              {links ? 'Suggest links' : 'Suggest pages'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Working({ text, onStop }: { text: string; onStop: () => void }): React.JSX.Element {
  return (
    <div className="wi-row wi-working">
      <LampStatus text={text} size={22} />
      <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={onStop}>
        Stop
      </Button>
    </div>
  )
}

function Questions({ storyId, topic, r }: { storyId: ID | null; topic: InterviewTopic; r: TopicRun }): React.JSX.Element {
  const id = useId()
  const first = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    first.current?.focus({ preventScroll: true })
  }, [r.questions])
  const typed = r.answers.some((a) => a.trim())
  return (
    <form
      className="wi-questions"
      onSubmit={(e) => {
        e.preventDefault()
        if (typed) sendAnswers(storyId, topic)
      }}
    >
      <ol className="wi-q-list">
        {r.questions.map((q, i) => (
          <li key={`${i}:${q}`} className="wi-q animate-fade-in">
            <label htmlFor={`${id}-${i}`} className="wi-q-text">
              {q}
            </label>
            <AutoTextarea
              ref={i === 0 ? first : undefined}
              id={`${id}-${i}`}
              value={r.answers[i] ?? ''}
              minRows={2}
              maxRows={8}
              placeholder="Your answer, in your own words. Leave it empty to skip."
              className="mt-1 text-[14px] leading-[1.55]"
              onChange={(e) => setAnswer(storyId, topic, i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  if (typed) sendAnswers(storyId, topic)
                }
              }}
            />
          </li>
        ))}
      </ol>
      <div className="wi-row">
        <Button type="submit" size="sm" variant="primary" disabled={!typed} title="Answer these (an empty box skips its question), then the next questions come">
          Answer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => skipRound(storyId, topic)} title="Skip these questions and ask others">
          Skip these
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => stopAsking(storyId, topic)}
          title={hasAnswers(r.asked) || typed ? 'No more questions: suggest from your answers so far' : 'No more questions'}
          data-stop-asking
        >
          Stop asking
        </Button>
      </div>
    </form>
  )
}

function Review({ storyId, topic, r, whatTheAISaw }: { storyId: ID | null; topic: InterviewTopic; r: TopicRun; whatTheAISaw: (() => void) | null }): React.JSX.Element {
  const links = topic === 'connections'
  const keys = useMemo(() => (links ? r.links.map((l) => l.key) : r.entries.map((e) => e.key)), [links, r.links, r.entries])
  const shown = keys.filter((k) => r.decisions[k]?.status !== 'discarded')
  const open = keys.filter((k) => !r.decisions[k]).length
  return (
    <div className="wi-review" data-topic-review>
      <div className="wi-row">
        <p className="wi-batch-t" role="status">
          {keys.length ? batchWords(keys, r.decisions, links) : TOPIC_TEXT[topic].empty}
        </p>
        {open > 1 ? (
          <Button size="sm" icon={<Check size={13} />} onClick={() => void keepAll(storyId, topic)} title="Keep every suggestion here you haven’t discarded">
            Keep all
          </Button>
        ) : null}
        {whatTheAISaw ? (
          <button type="button" className="wi-link" onClick={whatTheAISaw}>
            What the AI saw
          </button>
        ) : null}
      </div>
      {shown.length ? (
        <div className="wi-sugs">
          {links
            ? r.links.filter((l) => shown.includes(l.key)).map((l) => <LinkRow key={l.key} storyId={storyId} topic={topic} link={l} r={r} />)
            : r.entries.filter((e) => shown.includes(e.key)).map((e) => <EntryRow key={e.key} storyId={storyId} topic={topic} entry={e} r={r} />)}
        </div>
      ) : null}
      <div className="wi-row wi-more">
        {!r.enough ? (
          <Button size="sm" variant="ghost" onClick={() => void askMore(storyId, topic)} data-ask-more>
            Ask me more
          </Button>
        ) : (
          <span className="wi-note">That covers it. Close this, or pick another topic.</span>
        )}
      </div>
    </div>
  )
}

/** Keep, Change and Discard on a suggestion still to decide; once kept, Kept with Open and Undo. */
function Actions({
  storyId,
  topic,
  k,
  r,
  name,
  onChange,
  open
}: {
  storyId: ID | null
  topic: InterviewTopic
  k: string
  r: TopicRun
  name: string
  onChange: (() => void) | null
  open: (() => void) | null
}): React.JSX.Element {
  const d = r.decisions[k]
  const [busy, setBusy] = useState(false)
  if (d?.status === 'kept')
    return (
      <div className="wi-actions">
        <span className="wi-kept" data-kept>
          <Check size={13} aria-hidden />
          Kept
        </span>
        {open ? (
          <button type="button" className="wi-txt" onClick={open}>
            Open
          </button>
        ) : null}
        <button type="button" className="wi-txt" onClick={() => void undoKeep(storyId, topic, k)} aria-label={`Undo keeping ${name}`} title="Take it out of your world again">
          <Undo2 size={13} aria-hidden />
          Undo
        </button>
      </div>
    )
  return (
    <div className="wi-actions">
      <button
        type="button"
        className="wi-keep"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void keep(storyId, topic, k).finally(() => setBusy(false))
        }}
        aria-label={`Keep ${name}`}
        data-keep
      >
        Keep
      </button>
      {onChange ? (
        <button type="button" className="wi-change" onClick={onChange} aria-label={`Change ${name}`} data-change>
          Change
        </button>
      ) : null}
      <button type="button" className="wi-txt" onClick={() => discard(storyId, topic, k)} aria-label={`Discard ${name}`} title="Leave this out. Undo brings it back.">
        Discard
      </button>
    </div>
  )
}

function EntryRow({ storyId, topic, entry, r }: { storyId: ID | null; topic: InterviewTopic; entry: TopicEntry; r: TopicRun }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const d = r.decisions[entry.key]
  const kept = d?.status === 'kept'
  const lines = entryLines(entry)
  const openPage =
    kept && d.entryId ? () => useApp.getState().navigate({ kind: 'entries', entryKind: entry.kind, entryId: d.entryId }) : null
  if (editing && !kept) return <EntryEdit storyId={storyId} topic={topic} entry={entry} onDone={() => setEditing(false)} />
  return (
    <div className={cn('wi-sug', kept && 'is-kept')} data-suggestion={entry.key}>
      <span className={cn('wi-mark', kept && 'is-kept')} aria-hidden />
      <div className="wi-sug-body">
        <p className="wi-sug-head">
          <span className="wi-sug-label">{KIND_LABELS[entry.kind].one}</span>
          <span className="wi-sug-title">{entry.name}</span>
          {entry.existing ? <span className="wi-tag" title="Your world has this page: keeping it fills only its empty parts">Adds to your page</span> : null}
        </p>
        {entry.summary ? <p className="wi-sug-text">{entry.summary}</p> : null}
        {lines.length ? (
          <ul className="wi-sug-parts">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <Actions storyId={storyId} topic={topic} k={entry.key} r={r} name={entry.name} onChange={() => setEditing(true)} open={openPage} />
    </div>
  )
}

function EntryEdit({ storyId, topic, entry, onDone }: { storyId: ID | null; topic: InterviewTopic; entry: TopicEntry; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState(entry.name)
  const [summary, setSummary] = useState(entry.summary)
  const [inside, setInside] = useState(entry.in)
  const [fields, setFields] = useState<Record<string, string>>({ ...entry.fields })
  const [rule, setRule] = useState(entry.rule)
  const id = useId()
  const save = (): void => {
    changeEntry(storyId, topic, entry.key, { name: entry.existing ? entry.name : name.trim() || entry.name, summary, fields, in: inside, rule })
    onDone()
  }
  return (
    <form
      className="wi-sug wi-edit"
      aria-label={`Change ${entry.name}`}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone()
      }}
      data-suggestion-edit={entry.key}
    >
      <div className="wi-edit-grid">
        <label htmlFor={`${id}-name`}>Name</label>
        <Input id={`${id}-name`} value={name} disabled={!!entry.existing} autoFocus={!entry.existing} onChange={(e) => setName(e.target.value)} />
        <label htmlFor={`${id}-summary`}>In a line</label>
        <AutoTextarea id={`${id}-summary`} value={summary} minRows={1} maxRows={4} onChange={(e) => setSummary(e.target.value)} />
        {entry.kind === 'place' ? (
          <>
            <label htmlFor={`${id}-in`}>Inside</label>
            <Input id={`${id}-in`} value={inside} placeholder="The place it lies inside (optional)" onChange={(e) => setInside(e.target.value)} />
          </>
        ) : null}
        {entry.kind === 'lore' && !entry.existing ? (
          <>
            <span aria-hidden />
            <label className="wi-check">
              <input type="checkbox" checked={rule} onChange={(e) => setRule(e.target.checked)} />
              Always true, never to be broken
            </label>
          </>
        ) : null}
        {partsToShow(entry).map((k) => (
          <FieldRow key={k} id={`${id}-${k}`} label={partLabel(entry.kind, k)} value={fields[k] ?? ''} onChange={(v) => setFields((f) => ({ ...f, [k]: v }))} />
        ))}
      </div>
      <div className="wi-row wi-edit-foot">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary">
          Done
        </Button>
      </div>
    </form>
  )
}

function FieldRow({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <AutoTextarea id={id} value={value} minRows={1} maxRows={6} onChange={(e) => onChange(e.target.value)} />
    </>
  )
}

function LinkRow({ storyId, topic, link, r }: { storyId: ID | null; topic: InterviewTopic; link: TopicLink; r: TopicRun }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const kept = r.decisions[link.key]?.status === 'kept'
  const words = linkWords(link)
  const people = link.from.kind === 'character' && link.to?.kind === 'character'
  const feels = [link.feels ? `${link.from.name} feels: ${link.feels}` : '', link.otherFeels && link.to ? `${link.to.name} feels: ${link.otherFeels}` : ''].filter(Boolean)
  if (editing && !kept) return <LinkEdit storyId={storyId} topic={topic} link={link} people={people} onDone={() => setEditing(false)} />
  return (
    <div className={cn('wi-sug', kept && 'is-kept')} data-suggestion={link.key}>
      <span className={cn('wi-mark', kept && 'is-kept')} aria-hidden />
      <div className="wi-sug-body">
        <p className="wi-sug-head">
          <span className="wi-sug-label">{link.link === 'detail' ? 'Add to a page' : link.link === 'inside' ? 'Inside' : 'Link'}</span>
          <span className="wi-sug-title">{words}</span>
        </p>
        {link.link === 'detail' ? <p className="wi-sug-text">{link.text}</p> : null}
        {feels.length ? <p className="wi-sug-text">{feels.join(' · ')}</p> : null}
        {link.why ? <p className="wi-sug-why">{link.why}</p> : null}
      </div>
      <Actions storyId={storyId} topic={topic} k={link.key} r={r} name={words} onChange={link.link === 'inside' ? null : () => setEditing(true)} open={null} />
    </div>
  )
}

function LinkEdit({ storyId, topic, link, people, onDone }: { storyId: ID | null; topic: InterviewTopic; link: TopicLink; people: boolean; onDone: () => void }): React.JSX.Element {
  const [type, setType] = useState(link.type)
  const [feels, setFeels] = useState(link.feels)
  const [otherFeels, setOtherFeels] = useState(link.otherFeels)
  const [text, setText] = useState(link.text)
  const id = useId()
  return (
    <form
      className="wi-sug wi-edit"
      aria-label={`Change ${linkWords(link)}`}
      onSubmit={(e) => {
        e.preventDefault()
        changeLink(storyId, topic, link.key, link.link === 'detail' ? { text: text.trim() || link.text } : { type: type.trim() || link.type, feels, otherFeels })
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone()
      }}
    >
      <div className="wi-edit-grid">
        {link.link === 'detail' ? (
          <FieldRow id={`${id}-text`} label={partLabel(link.from.kind, link.field)} value={text} onChange={setText} />
        ) : (
          <>
            <label htmlFor={`${id}-type`}>{`${link.from.name} is`}</label>
            <Input id={`${id}-type`} value={type} autoFocus placeholder={`older sister of, lives at… ${link.to?.name ?? ''}`} onChange={(e) => setType(e.target.value)} />
            {people ? (
              <>
                <FieldRow id={`${id}-feels`} label={`How ${link.from.name} feels`} value={feels} onChange={setFeels} />
                <FieldRow id={`${id}-other`} label={`How ${link.to?.name ?? 'the other'} feels`} value={otherFeels} onChange={setOtherFeels} />
              </>
            ) : null}
          </>
        )}
      </div>
      <div className="wi-row wi-edit-foot">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary">
          Done
        </Button>
      </div>
    </form>
  )
}
