// A story's Consistency page (milestone 5, spec "Consistency checker"): checking the whole story, with
// its progress and Stop; every open issue grouped by chapter and scene; the repetition report; and plot
// threads left open too long or paid off with no setup. Reached from the binder's World section, the
// palette and the "Show" on a finished check's toast.
import * as M from '@radix-ui/react-dropdown-menu'
import { ChevronDown, SearchCheck, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ALL_CHECKS, DONE_CHECKS, type Issue } from '@shared/contracts/checks'
import type { ID, Outline } from '@shared/types'
import { Button, Notice, Tabs, TabsContent, TabsList } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { outlineOrder } from '@/features/editor/names/outlineOrder'
import { StoryFilter } from '@/features/timeline/viewParts'
import { runWords } from './CheckLine'
import { checkStory, dismissFailure, openConsistency, stopCheck, useChecks } from './checkStore'
import { groupIssues } from './consistencyLogic'
import { IssuesTab } from './IssuesTab'
import { RepetitionTab, ThreadsTab } from './ReportTabs'
import { useLoad } from './useLoad'

type Tab = 'issues' | 'repetition' | 'threads'

/** The tab last open, so coming back to the page shows it again (this run of the app only). */
let lastTab: Tab = 'issues'

/** The story's outline: the binder's copy when it is the open story (always current), else asked for. */
function useStoryOutline(storyId: ID): { outline: Outline | null; order: string } {
  const worldId = useApp((s) => s.world?.id ?? null)
  const open = useOutlineStore((s) => (s.outline?.story.id === storyId ? s.outline : null))
  const issuesRev = useChecks((s) => s.issuesRev)
  const asked = useLoad(() => api.getOutline(storyId), [storyId, worldId, issuesRev], !open)
  const outline = open ?? asked.data
  return { outline, order: outlineOrder(outline) }
}

export function ConsistencyView({ storyId }: { storyId: ID }): React.JSX.Element {
  const story = useApp((s) => s.stories.find((x) => x.id === storyId) ?? null)
  const worldId = useApp((s) => s.world?.id ?? null)
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const briefingRev = useApp((s) => s.briefingRev)
  const issuesRev = useChecks((s) => s.issuesRev)
  const failure = useChecks((s) => (s.failure?.storyId === storyId ? s.failure : null))
  const [tab, setTab] = useState<Tab>(lastTab)
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set([lastTab]))
  const [showIgnored, setShowIgnored] = useState(false)
  // Issues ignored or reopened here, shown at once while the change is saved.
  const [changed, setChanged] = useState<Map<ID, Issue>>(new Map())

  const { outline, order } = useStoryOutline(storyId)
  const issues = useLoad(() => api.listStoryIssues(storyId), [storyId, worldId, issuesRev])
  const repetition = useLoad(() => api.getRepetitionReport(storyId), [storyId, worldId, memoryRev, entriesRev, order], seen.has('repetition'))
  const threads = useLoad(
    () => api.getThreadsReport(storyId),
    [storyId, worldId, memoryRev, entriesRev, briefingRev, order],
    seen.has('threads')
  )

  const list = useMemo(() => (issues.data ? issues.data.map((i) => changed.get(i.id) ?? i) : null), [issues.data, changed])
  const groups = useMemo(() => (list ? groupIssues(list, outline, showIgnored) : null), [list, outline, showIgnored])
  const storyScenes = useMemo(() => new Set(outline?.scenes.map((s) => s.id) ?? []), [outline])

  const pick = (t: string): void => {
    const next = t as Tab
    lastTab = next
    setTab(next)
    setSeen((s) => (s.has(next) ? s : new Set([...s, next])))
  }
  const note = (issue: Issue): void => setChanged((m) => new Map(m).set(issue.id, issue))

  const threadCount = threads.data ? threads.data.openTooLong.length + threads.data.noSetup.length : null
  const repeatCount = repetition.data
    ? repetition.data.petPhrases.length + repetition.data.chapters.reduce((n, c) => n + c.items.length, 0)
    : null

  return (
    <div className="flex h-full flex-col">
      <Tabs value={tab} onValueChange={pick} className="flex min-h-0 flex-1 flex-col">
        <header className="relative shrink-0 px-6 pt-5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="min-w-[220px] flex-1">
              <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">Consistency</h1>
              <p className="mt-0.5 min-h-[20px] text-balance text-[13px] text-muted">
                <span className="font-medium text-fg">{story?.title || 'This story'}</span>: what disagrees with the memory or with earlier
                scenes, words used too often, and plot threads to look at.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <StoryFilter value={storyId} onChange={(id) => id !== storyId && openConsistency(id)} />
              <CheckControls storyId={storyId} />
            </div>
          </div>
          <TabsList
            className="-mx-6 mt-3 px-4"
            items={[
              { value: 'issues', label: 'Issues', badge: <Count n={groups?.open ?? null} danger={!!groups?.mustFix} /> },
              { value: 'repetition', label: 'Repetition', badge: <Count n={repeatCount} /> },
              { value: 'threads', label: 'Plot threads', badge: <Count n={threadCount} /> }
            ]}
          />
          <RunBar storyId={storyId} />
        </header>
        {failure ? (
          <div className="mx-auto w-full max-w-3xl px-6 pt-4">
            <Notice
              tone="danger"
              action={
                <div className="flex shrink-0 gap-1.5">
                  {/Settings/.test(failure.message) ? (
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
              The check didn’t finish. {failure.message}
            </Notice>
          </div>
        ) : null}
        <TabsContent value="issues" className="overflow-y-auto">
          <IssuesTab
            storyId={storyId}
            groups={groups}
            storyScenes={storyScenes}
            error={issues.error}
            onRetry={issues.retry}
            showIgnored={showIgnored}
            onShowIgnored={setShowIgnored}
            onChanged={note}
          />
        </TabsContent>
        <TabsContent value="repetition" className="overflow-y-auto">
          <RepetitionTab storyId={storyId} report={repetition.data} error={repetition.error} onRetry={repetition.retry} />
        </TabsContent>
        <TabsContent value="threads" className="overflow-y-auto">
          <ThreadsTab storyId={storyId} report={threads.data} error={threads.error} onRetry={threads.retry} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** A tab's count. Room is kept for it, so the tabs don't move when it arrives; nothing shows for none. */
function Count({ n, danger }: { n: number | null; danger?: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums',
        n ? (danger ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted') : 'invisible'
      )}
    >
      {n || 0}
    </span>
  )
}

/**
 * Check this story (facts, knowledge and timeline), with a small menu to take in voice and style too; or,
 * while a check runs, its progress and Stop.
 */
function CheckControls({ storyId }: { storyId: ID }): React.JSX.Element {
  const run = useChecks((s) => s.run)
  if (run) {
    return (
      <div className="flex h-8 max-w-[380px] items-center gap-2.5" role="status">
        <span className="min-w-0 truncate text-[13px] text-muted" title={runWords(run)}>
          {run.storyId === storyId ? runWords(run) : `${runWords(run, true)}, in another story`}
        </span>
        <Button icon={<Square size={12} />} loading={run.stopping} onClick={() => void stopCheck()}>
          Stop
        </Button>
      </div>
    )
  }
  return (
    <div className="flex h-8 items-center">
      <Button variant="primary" className="rounded-r-none" icon={<SearchCheck size={15} />} onClick={() => void checkStory(storyId, DONE_CHECKS)}>
        Check this story
      </Button>
      <M.Root modal={false}>
        <M.Trigger asChild>
          <Button variant="primary" aria-label="More ways to check this story" className="rounded-l-none border-l border-accent-fg/25 px-2">
            <ChevronDown size={15} />
          </Button>
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="end"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 w-[300px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
          >
            <CheckItem
              title="Facts, knowledge and timeline"
              hint="What each scene is checked for when you mark it done."
              onSelect={() => void checkStory(storyId, DONE_CHECKS)}
            />
            <CheckItem
              title="Voice and style too"
              hint="Also each character’s voice, point of view, tense and tone. Slower, and costs more."
              onSelect={() => void checkStory(storyId, ALL_CHECKS)}
            />
          </M.Content>
        </M.Portal>
      </M.Root>
    </div>
  )
}

function CheckItem({ title, hint, onSelect }: { title: string; hint: string; onSelect: () => void }): React.JSX.Element {
  return (
    <M.Item onSelect={onSelect} className="flex flex-col rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2">
      <span className="text-[13.5px] font-medium text-fg">{title}</span>
      <span className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</span>
    </M.Item>
  )
}

/** A thin bar along the foot of the header while this story is being checked: how far it has got. */
function RunBar({ storyId }: { storyId: ID }): React.JSX.Element | null {
  const run = useChecks((s) => (s.run?.storyId === storyId ? s.run : null))
  if (!run) return null
  // Until the first scene starts there is nothing to measure: the bar starts from the left, never shrinks back.
  const share = run.total && run.done !== null ? Math.min(1, run.done / run.total) : 0
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
      <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, share * 100)}%` }} />
    </div>
  )
}
