// A story's Consistency page (milestone 5, spec "Consistency checker"): checking the whole story, with
// its progress and Stop; every open issue grouped by chapter and scene; the repetition report; and plot
// threads left open too long or paid off with no setup. Reached from the binder's World section, the
// palette and the "Show" on a finished check's toast.
import * as M from '@radix-ui/react-dropdown-menu'
import { ChevronDown, SearchCheck, Square } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ALL_CHECKS, DONE_CHECKS, type Issue, type RepetitionReport, type ThreadsReport } from '@shared/contracts/checks'
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

/**
 * What each story's page last showed, and where each tab was scrolled to, by world and story: coming back
 * to the page (it is made afresh for each visit) shows them at once and refreshes them quietly.
 */
interface Kept {
  issues?: Issue[]
  outline?: Outline
  repetition?: RepetitionReport
  threads?: ThreadsReport
  scroll: Partial<Record<Tab, number>>
}
const kept = new Map<string, Kept>()

function keptFor(worldId: ID | null, storyId: ID): Kept {
  const key = `${worldId}:${storyId}`
  let k = kept.get(key)
  if (!k) kept.set(key, (k = { scroll: {} }))
  return k
}

/** Remembers an answer once it arrives. */
function useKeep<K extends Exclude<keyof Kept, 'scroll'>>(k: Kept, key: K, data: Kept[K] | null): void {
  useEffect(() => {
    if (data) k[key] = data
  }, [k, key, data])
}

/** The story's outline: the binder's copy when it is the open story (always current), else asked for. */
function useStoryOutline(storyId: ID, k: Kept): { outline: Outline | null; order: string; error: string | null } {
  const worldId = useApp((s) => s.world?.id ?? null)
  const open = useOutlineStore((s) => (s.outline?.story.id === storyId ? s.outline : null))
  const issuesRev = useChecks((s) => s.issuesRev)
  const asked = useLoad(() => api.getOutline(storyId), [storyId, worldId, issuesRev], !open, k.outline ?? null)
  const outline = open ?? asked.data
  useKeep(k, 'outline', outline)
  return { outline, order: outlineOrder(outline), error: outline ? null : asked.error }
}

export function ConsistencyView({ storyId }: { storyId: ID }): React.JSX.Element {
  const story = useApp((s) => s.stories.find((x) => x.id === storyId) ?? null)
  const worldId = useApp((s) => s.world?.id ?? null)
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const briefingRev = useApp((s) => s.briefingRev)
  const issuesRev = useChecks((s) => s.issuesRev)
  const failure = useChecks((s) => (s.failure?.storyId === storyId ? s.failure : null))
  const k = useMemo(() => keptFor(worldId, storyId), [worldId, storyId])
  const [tab, setTab] = useState<Tab>(lastTab)
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set([lastTab]))
  const [showIgnored, setShowIgnored] = useState(false)
  // Issues ignored or reopened here, shown at once while the change is saved. Each reload of the issues
  // starts afresh from what the main process says.
  const [changed, setChanged] = useState<Map<ID, Issue>>(new Map())

  const { outline, order, error: outlineError } = useStoryOutline(storyId, k)
  const issues = useLoad(() => api.listStoryIssues(storyId), [storyId, worldId, issuesRev], true, k.issues ?? null)
  const repetition = useLoad(
    () => api.getRepetitionReport(storyId),
    [storyId, worldId, memoryRev, entriesRev, order],
    seen.has('repetition'),
    k.repetition ?? null
  )
  const threads = useLoad(
    () => api.getThreadsReport(storyId),
    [storyId, worldId, memoryRev, entriesRev, briefingRev, order],
    seen.has('threads'),
    k.threads ?? null
  )
  useKeep(k, 'issues', issues.data)
  useKeep(k, 'repetition', repetition.data)
  useKeep(k, 'threads', threads.data)
  useEffect(() => setChanged((m) => (m.size ? new Map() : m)), [issues.data])

  const list = useMemo(() => {
    if (!issues.data) return null
    // A newer copy from the main process wins over one changed here.
    return issues.data.map((i) => {
      const mine = changed.get(i.id)
      return mine && !(i.updatedAt > mine.updatedAt) ? mine : i
    })
  }, [issues.data, changed])
  // Grouped only once the outline is here too, so issues never show as none while it loads.
  const groups = useMemo(() => (list && outline ? groupIssues(list, outline, showIgnored) : null), [list, outline, showIgnored])
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
        <TabsContent value="issues" className="flex flex-col">
          <KeptScroll k={k} tab="issues">
            <IssuesTab
              storyId={storyId}
              groups={groups}
              storyScenes={storyScenes}
              error={issues.error ?? outlineError}
              onRetry={issues.retry}
              showIgnored={showIgnored}
              onShowIgnored={setShowIgnored}
              onChanged={note}
            />
          </KeptScroll>
        </TabsContent>
        <TabsContent value="repetition" className="flex flex-col">
          <KeptScroll k={k} tab="repetition">
            <RepetitionTab storyId={storyId} report={repetition.data} error={repetition.error} onRetry={repetition.retry} />
          </KeptScroll>
        </TabsContent>
        <TabsContent value="threads" className="flex flex-col">
          <KeptScroll k={k} tab="threads">
            <ThreadsTab storyId={storyId} report={threads.data} error={threads.error} onRetry={threads.retry} />
          </KeptScroll>
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** A tab's scrolling area, back where it was when Adam last left it. */
function KeptScroll({ k, tab, children }: { k: Kept; tab: Tab; children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = k.scroll[tab] ?? 0
  }, [k, tab])
  return (
    <div ref={ref} onScroll={(e) => (k.scroll[tab] = e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto">
      {children}
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
 * while a check runs, its progress and Stop. Both take the same width, so nothing beside them moves.
 */
function CheckControls({ storyId }: { storyId: ID }): React.JSX.Element {
  const run = useChecks((s) => s.run)
  if (run) {
    return (
      <div className="flex h-8 w-[320px] items-center justify-end gap-2.5" role="status">
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
    <div className="flex h-8 w-[320px] items-center justify-end">
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
