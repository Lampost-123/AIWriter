// The Issues tab beside a scene (milestone 5, AI checks; spec "Consistency checker"): what the checks found
// in this scene, must fix first. Each issue shows how serious it is (must fix in red; worth a look and minor
// in quiet tones, never amber, which is for AI suggestions), the words in the scene (a click shows them in
// the page), what disagrees with what, and links to what it conflicts with. Fix the text, Update the memory
// and Ignore each act at once and can be undone. "Check this scene" runs every check, with progress and Stop.
import { CircleCheck, ListChecks } from '@/components/ui/icons'
import { CheckReportCard } from './CheckReportCard'
import { useState } from 'react'
import type { Issue, IssueSource } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { Badge, Button, EmptyState, Notice, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useDelayed } from '@/features/generate/parts'
import { checkThisScene, fixTheText, ignore, openSource, reopen, showWords, stopRun, updateTheMemory } from './actions'
import { KIND_WORDS, SEVERITY_WORDS, memoryFixWords, openCount, runFor, splitIssues } from './issuesLogic'
import { useIssuesStore, useSceneIssues } from './issuesStore'
import { revealLiveFlag, useLiveFlagCounts } from '@/features/liveChecks/liveFlags'
import type { LiveFlagKind } from '@shared/liveChecks'

export function IssuesPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const { issues, error, retry } = useSceneIssues(sceneId)
  const run = useIssuesStore((s) => runFor(s.runs, sceneId))
  const failed = useIssuesStore((s) => s.failed[sceneId] ?? null)
  const [showIgnored, setShowIgnored] = useState(false)
  const { open, ignored } = splitIssues(issues ?? [])

  return (
    <div className="flex min-h-full flex-col">
      <OnThisPage />
      <CheckBar sceneId={sceneId} issues={issues} run={run} />
      <CheckReportCard sceneId={sceneId} />
      {failed ? (
        <div className="px-4 pb-2">
          <Notice tone="danger" action={settingsButton(failed)}>
            {failed}
          </Notice>
        </div>
      ) : null}
      {issues === null ? (
        error ? (
          <div className="px-4 pt-2">
            <Notice
              tone="danger"
              action={
                <Button size="sm" onClick={retry}>
                  Try again
                </Button>
              }
            >
              Couldn’t read this scene’s issues. {error}
            </Notice>
          </div>
        ) : // Loading: nothing rather than a flash; the list takes its place when it comes.
        null
      ) : open.length ? (
        <ul aria-label="Issues in this scene" className="flex flex-col gap-2 px-4 pb-4 pt-1 animate-fade-in">
          {open.map((i) => (
            <li key={i.id}>
              <IssueCard issue={i} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<CircleCheck size={20} />} title="Nothing to look at" className="py-8">
          Every draft is checked against the memory, where things stand and the story so far. Marking the scene done checks its facts,
          who knows what, its timeline and continuity; Check this scene looks at voices, style and tone too.
        </EmptyState>
      )}
      {ignored.length ? (
        <div className="mt-auto border-t border-line px-4 py-2.5">
          <button
            type="button"
            aria-expanded={showIgnored}
            onClick={() => setShowIgnored((v) => !v)}
            className="text-[12.5px] text-muted hover:text-fg"
          >
            {showIgnored ? 'Hide ignored' : `Show ignored (${ignored.length})`}
          </button>
          {showIgnored ? (
            <ul aria-label="Ignored" className="mt-2 flex flex-col gap-1.5 animate-fade-in">
              {ignored.map((i) => (
                <li key={i.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                  <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-muted">{i.message}</p>
                  <Button size="sm" variant="ghost" className="-my-0.5" onClick={() => void reopen(i)}>
                    Reopen
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** What each kind of underline in the page is called here, one and many. */
const LIVE_WORDS: Record<LiveFlagKind, [string, string]> = {
  spelling: ['possible misspelt name', 'possible misspelt names'],
  phrase: ['phrase to avoid', 'phrases to avoid'],
  ai: ['common AI phrase', 'common AI phrases'],
  repetition: ['repeated word', 'repeated words']
}
const LIVE_ORDER: LiveFlagKind[] = ['spelling', 'phrase', 'ai', 'repetition']

/**
 * The live checks' underlines in the page now (phrases to avoid, common AI phrases, repeated words, names that look misspelt),
 * each a link to the next one. Nothing when there are none.
 */
function OnThisPage(): React.JSX.Element | null {
  const counts = useLiveFlagCounts()
  const kinds = LIVE_ORDER.filter((k) => counts[k] > 0)
  if (!kinds.length) return null
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 text-[12.5px]">
      <span className="text-muted">Underlined in the page:</span>
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => revealLiveFlag(k)}
          title="Show the next one in the page"
          className="text-accent hover:underline"
        >
          {counts[k]} {LIVE_WORDS[k][counts[k] === 1 ? 0 : 1]}
        </button>
      ))}
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

/** What the scene's issues add up to, and Check this scene (or how the check is going, with Stop). */
function CheckBar({ sceneId, issues, run }: { sceneId: ID; issues: Issue[] | null; run: ReturnType<typeof runFor> }): React.JSX.Element {
  const [starting, setStarting] = useState(false)
  const busy = !!run || starting
  const slow = useDelayed(busy, 120)
  const { count, mustFix } = openCount(issues)
  const summary = issues === null || count === 0 ? '' : `${count} to look at${mustFix ? ` · ${mustFix} must fix` : ''}`
  const progress = run?.current?.startsWith('Comparing')
    ? run.current
    : run && run.total > 1
      ? `Checking… ${Math.min(run.done + 1, run.total)} of ${run.total}`
      : 'Checking…'

  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      await checkThisScene(sceneId)
    } finally {
      setStarting(false)
    }
  }

  return (
    // A fixed height, so the bar never moves the list when a check starts or ends.
    <div className="flex h-12 shrink-0 items-center gap-2 px-4">
      {busy ? (
        <>
          <span
            role="status"
            className={cn('flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-muted transition-opacity duration-150', slow ? 'opacity-100' : 'opacity-0')}
          >
            <Spinner size={13} className="shrink-0" />
            <span className="truncate">{progress}</span>
          </span>
          {run ? (
            <Button size="sm" variant="ghost" onClick={() => void stopRun(run.runId)}>
              Stop
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{summary}</span>
          <Button
            size="sm"
            icon={<ListChecks size={14} />}
            onClick={() => void start()}
            title="Checks facts, who knows what, timeline and place, voices, and style and tone"
          >
            Check this scene
          </Button>
        </>
      )}
    </div>
  )
}

/** The words in quotation marks, unless they start or end with their own (dialogue). */
const quoted = (q: string): string => (/^["“‘']|["”’']$/.test(q) ? q : `“${q}”`)

function SeverityMark({ issue }: { issue: Issue }): React.JSX.Element {
  if (issue.severity === 'must-fix') return <Badge tone="danger">{SEVERITY_WORDS['must-fix']}</Badge>
  return <Badge className={issue.severity === 'minor' ? 'text-faint' : undefined}>{SEVERITY_WORDS[issue.severity]}</Badge>
}

/** One link to what an issue conflicts with. */
function SourceLink({ source }: { source: IssueSource }): React.JSX.Element {
  const words = source.kind === 'scene' ? source.label : source.kind === 'story' ? source.title : source.name
  const title = source.kind === 'scene' ? 'Open this scene' : source.kind === 'story' ? 'Open this story’s settings' : `Show ${words} beside the page`
  return (
    <button type="button" onClick={() => openSource(source)} title={title} className="max-w-full truncate text-accent hover:underline">
      {words}
    </button>
  )
}

function IssueCard({ issue }: { issue: Issue }): React.JSX.Element {
  const memoryWords = memoryFixWords(issue)
  const canFix = !!issue.quote.trim() && !!issue.sceneId
  return (
    <article
      aria-label={`${SEVERITY_WORDS[issue.severity]}: ${issue.message}`}
      className={cn('rounded-lg border bg-surface px-3 py-2.5', issue.severity === 'must-fix' ? 'border-danger/35' : 'border-line')}
    >
      <div className="flex items-center gap-2">
        <SeverityMark issue={issue} />
        <span className="min-w-0 truncate text-[11.5px] text-faint">{issue.aiPhrase ? 'Common AI phrase' : KIND_WORDS[issue.kind]}</span>
      </div>
      {issue.quote.trim() ? (
        <button
          type="button"
          onClick={() => showWords(issue)}
          title="Show these words in the page"
          className="-mx-1 mt-1.5 block w-[calc(100%+0.5rem)] rounded px-1 py-0.5 text-left font-serif text-[14px] leading-[21px] text-fg hover:bg-surface-2"
        >
          <span className="line-clamp-3">{quoted(issue.quote.trim())}</span>
        </button>
      ) : null}
      <p className="mt-1 text-[12.5px] leading-[18px] text-muted">{issue.message}</p>
      {issue.sources.length ? (
        <p className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px]">
          <span className="text-faint">Disagrees with</span>
          {issue.sources.map((s, n) => (
            <span key={n} className="flex min-w-0 items-baseline">
              <SourceLink source={s} />
              {n < issue.sources.length - 1 ? <span className="text-faint">,</span> : null}
            </span>
          ))}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {canFix ? (
          <Button
            size="sm"
            onClick={() => fixTheText(issue)}
            title={issue.fix ? 'Shows the suggested rewrite in the page, to accept or reject' : 'Asks the writer model to rewrite the sentence'}
          >
            Fix the text
          </Button>
        ) : null}
        {memoryWords ? (
          <Button size="sm" onClick={() => void updateTheMemory(issue)} title={memoryWords}>
            Update the memory
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void ignore(issue)} title="It’s meant to be like this: hide it, and don’t raise it again">
          Ignore
        </Button>
      </div>
    </article>
  )
}

/**
 * The small count on the Issues tab while the scene has open issues (red when one must be fixed). It sits
 * over the tab's top corner, above the label, so it never moves the tabs when it comes or goes.
 */
export function IssuesTabCount({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const { issues } = useSceneIssues(sceneId)
  const { count, mustFix } = openCount(issues)
  if (!count) return null
  return (
    <span
      aria-label={`${count} open${mustFix ? `, ${mustFix} must fix` : ''}`}
      className={cn(
        'pointer-events-none absolute right-0 top-[5px] min-w-[15px] translate-x-1/2 rounded-full px-1 text-center text-[10px] font-semibold leading-[15px] tabular-nums',
        mustFix ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-muted'
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
