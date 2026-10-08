// The desk's Check room, Issues (UI overhaul): every open issue in the story as a card of its own, the whole story's
// first, then by chapter and scene. A card shows how serious it is in form (a stripe and a pill in its ink: red only
// for must fix), the kind of check that found it, what disagrees with what, the words from the story set as a quote with
// a way to them in the scene, and what it disagrees with as small cards (an entry with its drawing). Filters by
// severity, with their counts ticking as issues go. Ignore folds the card away (the cards below close up, the counts
// tick down; Undo in its toast brings it back). With nothing left, the all-clear: the lighthouse over a calm sea.
// Behaviour is the Consistency page's own (IssuesTab.tsx): opening an issue's scene at its words, Ignore and Reopen.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Issue, IssueSeverity, IssueSource } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { ArrowUpRight, EyeOff, RotateCcw } from '@/components/ui/icons'
import { LighthouseArt } from '@/components/art/RoomArt'
import { DrawnTick } from '@/components/ui/DrawnTick'
import { TickNumber } from '@/components/ui/TickNumber'
import { cn } from '@/lib/cn'
import { useFlip } from '@/lib/useFlip'
import { useApp } from '@/lib/store'
import { reducedMotion } from '@/features/look/motion'
import { ViewError, ViewLoading } from '@/features/timeline/viewParts'
import { useChecks } from '../checkStore'
import { issueSummary, KIND_WORDS, SEVERITY_WORDS, type IssueGroups } from '../consistencyLogic'
import { ignoreIssue, reopenIssue } from '../IssuesTab'
import { openEntry, openIssue, openThread } from '../open'
import { EntryMark, ISSUE_KIND_ICONS, SeverityPill, useEntryLook } from './marks'

/** How long a card takes to fold away before it goes. */
const FOLD_MS = 180

type Filter = 'all' | IssueSeverity
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'must-fix', label: SEVERITY_WORDS['must-fix'] },
  { id: 'warning', label: SEVERITY_WORDS.warning },
  { id: 'minor', label: SEVERITY_WORDS.minor }
]

/** Open issues of each severity (ignored ones don't count). */
function severityCounts(g: IssueGroups): Record<Filter, number> {
  const out: Record<Filter, number> = { all: 0, 'must-fix': 0, warning: 0, minor: 0 }
  const add = (i: Issue): void => {
    if (i.status !== 'open') return
    out.all++
    out[i.severity]++
  }
  g.story.forEach(add)
  for (const c of g.chapters) for (const s of c.scenes) s.issues.forEach(add)
  return out
}

/** The groups with only the issues the filter lets through (empty scenes and chapters left out). */
function filtered(g: IssueGroups, f: Filter): IssueGroups {
  if (f === 'all') return g
  const keep = (i: Issue): boolean => i.severity === f
  return {
    ...g,
    story: g.story.filter(keep),
    chapters: g.chapters
      .map((c) => ({ ...c, scenes: c.scenes.map((s) => ({ ...s, issues: s.issues.filter(keep) })).filter((s) => s.issues.length) }))
      .filter((c) => c.scenes.length)
  }
}

export const chapterAnchor = (chapterId: ID): string => `ck-ch-${chapterId}`

export function DeskIssues({
  storyId,
  storyTitle,
  groups,
  error,
  onRetry,
  storyScenes,
  showIgnored,
  onShowIgnored,
  onChanged
}: {
  storyId: ID
  storyTitle: string
  groups: IssueGroups | null
  error: string | null
  onRetry: () => void
  storyScenes: Set<ID>
  showIgnored: boolean
  onShowIgnored: (on: boolean) => void
  onChanged: (issue: Issue) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [leaving, setLeaving] = useState<Set<ID>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  // Whether this visit has seen issues: the all-clear that follows the last one going gets its moment.
  const hadIssues = useRef(false)
  const counts = useMemo(() => (groups ? severityCounts(groups) : null), [groups])
  const shown = useMemo(() => (groups ? filtered(groups, filter) : null), [groups, filter])
  const shownKey = useMemo(
    () => (shown ? [...shown.story.map((i) => i.id), ...shown.chapters.flatMap((c) => c.scenes.flatMap((s) => s.issues.map((i) => i.id)))].join() : ''),
    [shown]
  )
  useFlip(listRef, shownKey)

  if (!groups || !shown || !counts) return error ? <ViewError what="The issues" error={error} onRetry={onRetry} /> : <ViewLoading />
  const nothing = !groups.story.length && !groups.chapters.length
  if (!nothing) hadIssues.current = true

  const fold = (issue: Issue): void => {
    // Shown with the ignored ones, it stays (as ignored); otherwise it folds away first.
    if (showIgnored || reducedMotion()) {
      void ignoreIssue(issue, onChanged)
      return
    }
    setLeaving((s) => new Set(s).add(issue.id))
    setTimeout(() => {
      void ignoreIssue(issue, onChanged).finally(() =>
        setLeaving((s) => {
          const n = new Set(s)
          n.delete(issue.id)
          return n
        })
      )
    }, FOLD_MS)
  }

  if (nothing) {
    return (
      <AllClear
        storyId={storyId}
        storyTitle={storyTitle}
        ignored={groups.ignored}
        moment={hadIssues.current}
        showIgnored={showIgnored}
        onShowIgnored={onShowIgnored}
      />
    )
  }

  const cardProps = { storyId, storyScenes, onChanged, leaving, onFold: fold }
  let n = 0
  return (
    <div className="ck-issues" ref={listRef}>
      <div className="ck-toolbar">
        <Filters value={filter} counts={counts} onChange={setFilter} />
        <p className="ck-summary">{issueSummary(groups)}</p>
        {groups.ignored ? (
          <label className="ck-toggle">
            <input type="checkbox" checked={showIgnored} onChange={(e) => onShowIgnored(e.target.checked)} />
            Show ignored ({groups.ignored})
          </label>
        ) : null}
      </div>
      {!shown.story.length && !shown.chapters.length ? (
        <p className="ck-none">No {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} issues. Choose All to see the rest.</p>
      ) : null}
      {shown.story.length ? (
        <section aria-label="The whole story" className="ck-group">
          <h2 className="ck-group-head">
            <span className="ck-num">✦</span>
            <span className="ck-group-title">The whole story</span>
          </h2>
          <ul className="ck-cards">
            {shown.story.map((i) => (
              <li key={i.id} data-flip={i.id} style={{ '--i': n++ } as React.CSSProperties}>
                <DeskIssueCard issue={i} {...cardProps} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {shown.chapters.map((c) => (
        <section key={c.chapterId} id={chapterAnchor(c.chapterId)} aria-label={c.title ? `${c.label}: ${c.title}` : c.label} className="ck-group">
          <h2 className="ck-group-head" data-flip={`h-${c.chapterId}`}>
            <span className="ck-num">{c.label.replace('Ch ', '')}</span>
            <span className="ck-group-title">{c.title || c.label}</span>
            <span className="ck-group-rule" aria-hidden />
          </h2>
          {c.scenes.map((s) => (
            <div key={s.sceneId} className="ck-scene">
              <h3 className="ck-scene-head" data-flip={`s-${s.sceneId}`}>
                <span className="desk-caps">{s.label.replace('Sc', 'Scene')}</span>
                {s.title ? <span className="ck-scene-title">{s.title}</span> : null}
              </h3>
              <ul className="ck-cards">
                {s.issues.map((i) => (
                  <li key={i.id} data-flip={i.id} style={{ '--i': n++ } as React.CSSProperties}>
                    <DeskIssueCard issue={i} {...cardProps} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

/** The severity filters: All, Must fix, Worth a look, Minor, each with its count; the one chosen on a raised pill. */
function Filters({ value, counts, onChange }: { value: Filter; counts: Record<Filter, number>; onChange: (f: Filter) => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  useLayoutEffect(() => {
    const on = box.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    const p = pill.current
    if (!on || !p) return
    if (!placed.current) p.style.transition = 'none'
    p.style.width = `${on.offsetWidth}px`
    p.style.transform = `translateX(${on.offsetLeft}px)`
    if (!placed.current) {
      void p.offsetWidth
      p.style.transition = ''
      placed.current = true
    }
  })
  return (
    <div ref={box} role="group" aria-label="Show issues" className="ck-filters">
      <span ref={pill} aria-hidden className="ck-filter-pill" />
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={value === f.id}
          data-severity={f.id}
          disabled={f.id !== 'all' && !counts[f.id] && value !== f.id}
          onClick={() => onChange(f.id)}
          className="ck-filter"
        >
          {f.id !== 'all' ? <span className="ck-dot" aria-hidden /> : null}
          {f.label}
          <TickNumber value={counts[f.id]} className="ck-filter-n" />
        </button>
      ))}
    </div>
  )
}

/** The words in quotation marks, unless they carry their own (dialogue). */
const quoted = (q: string): string => (/^["“‘']|["”’']$/.test(q) ? q : `“${q}”`)

function DeskIssueCard({
  issue: i,
  storyId,
  storyScenes,
  onChanged,
  leaving,
  onFold
}: {
  issue: Issue
  storyId: ID
  storyScenes: Set<ID>
  onChanged: (i: Issue) => void
  leaving: Set<ID>
  onFold: (i: Issue) => void
}): React.JSX.Element {
  const ignored = i.status === 'ignored'
  const opens = !!i.sceneId
  const KindIcon = ISSUE_KIND_ICONS[i.kind]
  const [busy, setBusy] = useState(false)
  const quote = i.quote.trim()
  return (
    <article
      data-issue={i.id}
      data-severity={i.severity}
      data-ignored={ignored || undefined}
      data-leaving={leaving.has(i.id) || undefined}
      aria-label={`${SEVERITY_WORDS[i.severity]}: ${i.message}`}
      onClick={(e) => {
        if (opens && !(e.target as HTMLElement).closest('button, a')) openIssue(i, storyId)
      }}
      className={cn('ck-card', opens && 'is-opens')}
    >
      <div className="ck-card-head">
        <SeverityPill severity={i.severity}>{SEVERITY_WORDS[i.severity]}</SeverityPill>
        <span className="ck-kind">
          <KindIcon size={13} aria-hidden />
          {KIND_WORDS[i.kind] ?? ''}
        </span>
        {ignored ? <span className="ck-kind">· Ignored</span> : null}
        <span className="flex-1" />
        {ignored ? (
          <button
            type="button"
            className="ck-act"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void reopenIssue(i, onChanged).finally(() => setBusy(false))
            }}
          >
            <RotateCcw size={13} aria-hidden />
            Reopen
          </button>
        ) : (
          <button type="button" className="ck-act" title="It’s meant to be like this: put it away, and don’t raise it again" onClick={() => onFold(i)}>
            <EyeOff size={13} aria-hidden />
            Ignore
          </button>
        )}
      </div>
      {opens ? (
        <button type="button" className="ck-msg" onClick={() => openIssue(i, storyId)} title="Open the scene at these words">
          {i.message}
        </button>
      ) : (
        <p className="ck-msg">{i.message}</p>
      )}
      {quote ? (
        <figure className="ck-quote">
          <blockquote>{quoted(quote)}</blockquote>
          {opens ? (
            <button type="button" className="ck-jump" onClick={() => openIssue(i, storyId)}>
              In the scene
              <ArrowUpRight size={12} aria-hidden />
            </button>
          ) : null}
        </figure>
      ) : null}
      {i.fix || i.advice ? (
        <p className="ck-advice">
          <span className="desk-caps">Suggested</span>
          {i.fix ? <span className="ck-fix">{quoted(i.fix.trim())}</span> : null}
          {i.advice ? <span>{i.advice}</span> : null}
        </p>
      ) : null}
      {i.sources.length ? <Sources sources={i.sources} storyId={storyId} storyScenes={storyScenes} /> : null}
    </article>
  )
}

/** What the issue disagrees with: entries and threads as small cards with their drawings; scenes and stories as links. */
function Sources({ sources, storyId, storyScenes }: { sources: IssueSource[]; storyId: ID; storyScenes: Set<ID> }): React.JSX.Element {
  const look = useEntryLook()
  return (
    <div className="ck-sources">
      <span className="ck-sources-label">Disagrees with</span>
      {sources.map((s, n) =>
        s.kind === 'entry' || s.kind === 'thread' ? (
          <EntryMark
            key={n}
            {...look(s.entryId)}
            name={s.name}
            detail={s.kind === 'entry' ? s.field : null}
            title={`Open ${s.name}`}
            onClick={() => (s.kind === 'thread' ? openThread(s.entryId) : void openEntry(s.entryId))}
          />
        ) : s.kind === 'scene' && storyScenes.has(s.sceneId) ? (
          <button key={n} type="button" className="ck-link" onClick={() => useApp.getState().selectScene(s.sceneId, storyId)}>
            {s.label}
          </button>
        ) : (
          <span key={n} className="ck-plain">
            {s.kind === 'scene' ? s.label : s.title}
          </span>
        )
      )}
    </div>
  )
}

/** Nothing to look at: the lighthouse over a calm sea, a tick drawn, and the way to check the whole story. */
function AllClear({
  storyId,
  storyTitle,
  ignored,
  moment,
  showIgnored,
  onShowIgnored
}: {
  storyId: ID
  storyTitle: string
  ignored: number
  /** The last issue just went: the scene arrives with its moment. */
  moment: boolean
  showIgnored: boolean
  onShowIgnored: (on: boolean) => void
}): React.JSX.Element {
  const running = useChecks((s) => s.run?.storyId === storyId)
  return (
    <div className="ck-clear" data-moment={moment || undefined} role="status">
      <LighthouseArt clear state={running ? 'busy' : 'idle'} className="ck-clear-art" />
      <div className="ck-clear-words">
        <span className="ck-clear-tick" aria-hidden>
          <DrawnTick size={18} draw />
        </span>
        <h2 className="ck-clear-title">{ignored ? 'Nothing left to look at' : 'No issues found'}</h2>
        <p className="ck-clear-sub">
          {ignored ? `Everything in ${storyTitle || 'this story'} is in hand.` : `All clear in ${storyTitle || 'this story'}.`} Scenes are checked
          against the memory when you mark them done; Check this story looks for facts, knowledge and timeline that disagree across the
          whole of it. Anything found shows here, by chapter and scene.
        </p>
        <div className="ck-clear-acts">
          {ignored ? (
            <label className="ck-toggle">
              <input type="checkbox" checked={showIgnored} onChange={(e) => onShowIgnored(e.target.checked)} />
              Show ignored ({ignored})
            </label>
          ) : null}
        </div>
      </div>
    </div>
  )
}
