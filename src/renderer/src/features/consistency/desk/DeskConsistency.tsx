// The desk's Check room: a story's consistency (UI overhaul). The same page as ConsistencyView (which loads everything and
// hands it here on the desk), laid out for the sheet: down the left, the lighthouse sweeping the story (amber and
// quicker while a check runs), the page's name and story, Check this story (or the check's progress, with Stop), the
// three reports as cards to choose between (Issues, Repetition, Plot threads, each with its count), and for the issues
// where they are, chapter by chapter, to jump to. The chosen report fills the rest. In a narrow sheet the left column
// becomes a band across the top.
import * as T from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import type { Issue, RepetitionReport, ThreadsReport } from '@shared/contracts/checks'
import type { ID, Outline } from '@shared/types'
import { Repeat2, SearchCheck, Spool } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { GlidePill } from '@/components/ui/GlidePill'
import { TickNumber } from '@/components/ui/TickNumber'
import { LighthouseArt } from '@/components/art/RoomArt'
import { useApp } from '@/lib/store'
import { scrollBehavior } from '@/features/look/motion'
import { StoryFilter } from '@/features/timeline/viewParts'
import { CheckControls } from '../CheckControls'
import { runWords } from '../CheckLine'
import { dismissFailure, openConsistency, useChecks } from '../checkStore'
import type { IssueGroups } from '../consistencyLogic'
import { chapterAnchor, DeskIssues } from './DeskIssues'
import { DeskRepetition, DeskThreads } from './DeskReports'
import '../check.css'

type Tab = 'issues' | 'repetition' | 'threads'

interface Loaded<T> {
  data: T | null
  error: string | null
  retry: () => void
}

export interface DeskConsistencyProps {
  storyId: ID
  storyTitle: string
  tab: Tab
  onTab: (t: string) => void
  groups: IssueGroups | null
  issuesError: string | null
  onRetryIssues: () => void
  storyScenes: Set<ID>
  showIgnored: boolean
  onShowIgnored: (on: boolean) => void
  onChanged: (issue: Issue) => void
  outline: Outline | null
  repetition: Loaded<RepetitionReport>
  threads: Loaded<ThreadsReport>
  repeatCount: number | null
  threadCount: number | null
  failure: { message: string } | null
  /** Each report's scrolling area, back where Adam left it (ConsistencyView's KeptScroll). */
  scroller: (tab: Tab, children: ReactNode) => ReactNode
}

export function DeskConsistency(p: DeskConsistencyProps): React.JSX.Element {
  const running = useChecks((s) => s.run?.storyId === p.storyId)
  return (
    <T.Root value={p.tab} onValueChange={p.onTab} className="ck-desk" data-tab={p.tab}>
      <div className="ck-frame">
        <aside className="ck-side" aria-label="Consistency">
          <LighthouseArt state={running ? 'busy' : 'idle'} className="ck-art" />
          <div className="ck-title-block">
            <p className="desk-caps">Check</p>
            <h1 className="ck-title">Consistency</h1>
            <p className="ck-story">
              <span className="ck-story-name">{p.storyTitle || 'This story'}</span>: what disagrees with the memory or earlier scenes, words used
              too often, and plot threads to look at.
            </p>
          </div>
          <StoryFilter value={p.storyId} onChange={(id) => id !== p.storyId && openConsistency(id)} className="ck-story-pick" />
          <div className="ck-controls">
            <CheckControls storyId={p.storyId} className="ck-controls-row" />
            <RunMeter storyId={p.storyId} />
          </div>
          <T.List aria-label="Reports" className="ck-reports">
            <GlidePill className="ck-report-pill" />
            <ReportTab value="issues" icon={<SearchCheck size={16} />} label="Issues" n={p.groups?.open ?? null} danger={!!p.groups?.mustFix} sub={p.groups ? mustWords(p.groups) : ''} />
            <ReportTab value="repetition" icon={<Repeat2 size={16} />} label="Repetition" n={p.repeatCount} sub="Words leaned on" />
            <ReportTab value="threads" icon={<Spool size={16} />} label="Plot threads" n={p.threadCount} sub="Loose ends" />
          </T.List>
          {p.tab === 'issues' && p.groups && (p.groups.story.length || p.groups.chapters.length) ? <Where groups={p.groups} /> : null}
        </aside>
        <div className="ck-main">
          {p.failure ? (
            <div className="ck-failure">
              <Notice
                tone="danger"
                action={
                  <div className="flex shrink-0 gap-1.5">
                    {/Settings/.test(p.failure.message) ? (
                      <Button size="sm" onClick={() => useApp.getState().navigate({ kind: 'settings', tab: 'models' })}>
                        Settings
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={dismissFailure}>
                      Dismiss
                    </Button>
                  </div>
                }
              >
                The check didn’t finish. {p.failure.message}
              </Notice>
            </div>
          ) : null}
          <T.Content value="issues" className="ck-panel">
            {p.scroller(
              'issues',
              <DeskIssues
                storyId={p.storyId}
                storyTitle={p.storyTitle}
                groups={p.groups}
                error={p.issuesError}
                onRetry={p.onRetryIssues}
                storyScenes={p.storyScenes}
                showIgnored={p.showIgnored}
                onShowIgnored={p.onShowIgnored}
                onChanged={p.onChanged}
              />
            )}
          </T.Content>
          <T.Content value="repetition" className="ck-panel">
            {p.scroller('repetition', <DeskRepetition storyId={p.storyId} report={p.repetition.data} error={p.repetition.error} onRetry={p.repetition.retry} />)}
          </T.Content>
          <T.Content value="threads" className="ck-panel">
            {p.scroller(
              'threads',
              <DeskThreads storyId={p.storyId} report={p.threads.data} outline={p.outline} error={p.threads.error} onRetry={p.threads.retry} />
            )}
          </T.Content>
        </div>
      </div>
    </T.Root>
  )
}

const mustWords = (g: IssueGroups): string => (g.mustFix ? `${g.mustFix} must fix` : g.open ? 'Nothing that must be fixed' : 'All clear')

function ReportTab({ value, icon, label, n, danger, sub }: { value: Tab; icon: ReactNode; label: string; n: number | null; danger?: boolean; sub: string }): React.JSX.Element {
  return (
    <T.Trigger value={value} className="ck-report-tab">
      <span className="ck-report-icon" aria-hidden>
        {icon}
      </span>
      <span className="ck-report-words">
        <span className="ck-report-label">{label}</span>
        <span className="ck-report-sub">{sub}</span>
      </span>
      <span className="ck-report-n" data-danger={danger || undefined} data-none={!n || undefined}>
        <TickNumber value={n ?? 0} />
      </span>
    </T.Trigger>
  )
}

/** How far a check of this story has got: a line that fills, and what is being read. */
function RunMeter({ storyId }: { storyId: ID }): React.JSX.Element | null {
  const run = useChecks((s) => (s.run?.storyId === storyId ? s.run : null))
  if (!run) return null
  const share = run.total && run.done !== null ? Math.min(1, run.done / run.total) : 0
  return (
    <div className="ck-meter" aria-hidden>
      <span className="ck-meter-fill" style={{ transform: `scaleX(${Math.max(0.03, share)})` }} />
      <span className="ck-meter-words">{runWords(run, true)}</span>
    </div>
  )
}

/** Where the issues are: the whole story, then each chapter with its count; a click brings it into view. */
function Where({ groups }: { groups: IssueGroups }): React.JSX.Element {
  const go = (id: string): void => document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  const open = (list: Issue[]): Issue[] => list.filter((i) => i.status === 'open')
  return (
    <nav aria-label="Where the issues are" className="ck-where">
      <p className="desk-caps">Where they are</p>
      <ul>
        {groups.story.length ? (
          <li>
            <button type="button" className="ck-where-row" onClick={() => document.querySelector('[aria-label="The whole story"]')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}>
              <span className="ck-num">✦</span>
              <span className="ck-where-name">The whole story</span>
              <Dots issues={open(groups.story)} />
            </button>
          </li>
        ) : null}
        {groups.chapters.map((c) => (
          <li key={c.chapterId}>
            <button type="button" className="ck-where-row" onClick={() => go(chapterAnchor(c.chapterId))}>
              <span className="ck-num">{c.label.replace('Ch ', '')}</span>
              <span className="ck-where-name">{c.title || c.label}</span>
              <Dots issues={open(c.scenes.flatMap((s) => s.issues))} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** One dot per open issue in its severity's ink (at most six, then a number). */
function Dots({ issues }: { issues: Issue[] }): React.JSX.Element {
  const order = { 'must-fix': 0, warning: 1, minor: 2 }
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <span className="ck-dots" aria-label={`${issues.length} open`}>
      {sorted.slice(0, 6).map((i) => (
        <span key={i.id} className="ck-dot" data-severity={i.severity} />
      ))}
      {issues.length > 6 ? <span className="ck-dots-more">+{issues.length - 6}</span> : null}
    </span>
  )
}
