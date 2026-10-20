// The Issues list beside a scene (milestone 5, AI checks; one list since the calm overhaul, 2026-10-19): everything
// worth a look in this scene, in clear sections (sections.ts): Slips, Questions, Craft notes (the critic, what was the
// Critique tab), Plot threads and Memory (what the memory isn't sure about here, and a scene its model turned down, with
// Try again and another of Adam's models for the memory). Filters show one section or all. Each issue shows how serious
// it is (must fix in red; worth a look and minor in quiet tones, never amber, which is for AI suggestions), the words in
// the scene (a click shows them in the page), what disagrees with what, and links to what it conflicts with. Fix the
// text, Update the memory, Later and Ignore each act at once and can be undone. "Check this scene" is the top bar's
// Check (features/check), with progress, what it is waiting for, Check now and Stop.
import { CircleCheck, ListChecks, MessageSquareQuote } from '@/components/ui/icons'
import { CheckReportCard } from './CheckReportCard'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Issue, IssueSource } from '@shared/contracts/checks'
import type { MemoryRefusal } from '@shared/contracts/calm'
import type { Entry, ID, MemoryCheckItem } from '@shared/types'
import { Badge, Button, EmptyState, Notice, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { useDelayed } from '@/features/generate/parts'
import { fixTheText, ignore, later, openSource, reopen, showWords, updateTheMemory } from './actions'
import {
  CONTRACT_DETAIL,
  CONTRACT_WORDS,
  KIND_WORDS,
  LATER_TITLE,
  RULE_DETAIL,
  RULE_WORDS,
  SEVERITY_WORDS,
  ignoredWords,
  memoryFixWords,
  openCount,
  splitIssues,
  usableFix
} from './issuesLogic'
import { useSceneIssues } from './issuesStore'
import { SECTION_HINTS, SECTION_WORDS, bySection, sectionCounts, sectionSummary, useIssuesView, type IssueSection } from './sections'
import { SectionFilter } from './SectionFilter'
import { revealLiveFlag, useLiveFlagCounts } from '@/features/liveChecks/liveFlags'
import type { LiveFlagKind } from '@shared/liveChecks'
import { LighthouseArt } from '@/components/art/RoomArt'
import { useDesk } from '@/features/look/look'
import { reducedMotion } from '@/features/look/motion'
import { useFlip } from '@/lib/useFlip'
import { SeverityPill } from '@/features/consistency/desk/marks'
import { checkWithoutWaiting, stopRun, useChecks } from '@/features/consistency/checkStore'
import { runFor, runLine } from '@/features/consistency/runsLogic'
import { CritiquePanel } from '@/features/critique/CritiquePanel'
import { critiqueHeadline } from '@/features/critique/critiqueLogic'
import { useCritique, useCritiqueStore } from '@/features/critique/critiqueStore'
import { CheckQueue } from '@/features/memory/CheckQueue'
import { countedChecks } from '@/features/memory/checkLogic'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { anotherModel, modelName } from '@/features/draftNote/compose'
import { runCheck } from '@/features/check/runCheck'
import { useCalmLine } from '@/features/waits/useDraftWait'
import '@/features/consistency/check.css'
import './issuesPanel.css'

export function IssuesPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const { issues, error, retry } = useSceneIssues(sceneId)
  const run = useChecks((s) => runFor(s.runs, sceneId))
  const failed = useChecks((s) => s.failed[sceneId] ?? null)
  const section = useIssuesView((s) => s.section)
  const show = useIssuesView((s) => s.show)
  const memory = useSceneMemory(sceneId)
  const craft = useCraft(sceneId)
  const [showIgnored, setShowIgnored] = useState(false)
  const [showLater, setShowLater] = useState(false)
  const { open, later: forLater, ignored } = splitIssues(issues ?? [])
  const groups = bySection(open)
  const memoryItems = memory.checks.filter((c) => c.group !== 'promise')
  const threadItems = memory.checks.filter((c) => c.group === 'promise')
  const counts = sectionCounts({
    issues: open,
    craft: craft.open,
    memory: (memory.refusal || memory.failed ? 1 : 0) + countedChecks(memoryItems),
    threads: threadItems.length
  })
  // The desk: Ignore and Later fold the card away first, and the cards below close up.
  const desk = useDesk()
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const fold =
    (act: (issue: Issue) => Promise<void>) =>
    (issue: Issue): void => {
      if (!desk || reducedMotion()) {
        void act(issue)
        return
      }
      setLeaving((s) => new Set(s).add(issue.id))
      setTimeout(() => {
        void act(issue).finally(() =>
          setLeaving((s) => {
            const n = new Set(s)
            n.delete(issue.id)
            return n
          })
        )
      }, 180)
    }
  const cards = (list: Issue[], label: string): ReactNode => <IssueCards list={list} label={label} leaving={leaving} fold={fold} />
  const wants = (k: IssueSection): boolean => section === 'all' || section === k

  // In "All", only the sections with something in them; one section on its own says when it has nothing.
  const body: ReactNode[] = []
  if (wants('slips') && (groups.slips.length || section === 'slips'))
    body.push(
      <Section key="slips" id="slips" count={groups.slips.length} lone={section === 'slips'}>
        {cards(groups.slips, 'Slips in this scene')}
      </Section>
    )
  if (wants('questions') && (groups.questions.length || section === 'questions'))
    body.push(
      <Section key="questions" id="questions" count={groups.questions.length} lone={section === 'questions'}>
        {cards(groups.questions, 'Questions about this scene')}
      </Section>
    )
  if (section === 'all' && (craft.open || craft.reading))
    body.push(
      <Section key="craft" id="craft" count={craft.open}>
        <CraftSummary headline={craft.headline} open={craft.open} reading={craft.reading} onOpen={() => show('craft')} />
      </Section>
    )
  if (wants('threads') && (groups.threads.length || threadItems.length || section === 'threads'))
    body.push(
      <Section key="threads" id="threads" count={groups.threads.length + threadItems.length} lone={section === 'threads'}>
        {groups.threads.length ? cards(groups.threads, 'Plot threads in this scene') : null}
        {threadItems.length ? (
          <div className="px-4 pb-3">
            <CheckQueue bare items={threadItems} entries={memory.entries} onChange={(next) => memory.set(next, 'promise')} onReload={memory.reload} />
          </div>
        ) : null}
      </Section>
    )
  if (wants('memory') && (memory.refusal || memory.failed || memoryItems.length || section === 'memory'))
    body.push(
      <Section key="memory" id="memory" count={counts.memory} lone={section === 'memory'}>
        <MemoryNotes sceneId={sceneId} refusal={memory.refusal} failed={memory.failed} onRetried={memory.reload} />
        {memoryItems.length ? (
          <div className="px-4 pb-3">
            <CheckQueue bare items={memoryItems} entries={memory.entries} onChange={(next) => memory.set(next, 'memory')} onReload={memory.reload} />
          </div>
        ) : null}
      </Section>
    )

  return (
    <div className="flex min-h-full flex-col" data-issues-list data-section={section}>
      <OnThisPage />
      <CheckBar sceneId={sceneId} summary={issues === null ? '' : sectionSummary(counts)} run={run} />
      <SectionFilter value={section} counts={counts} onChange={show} />
      {failed ? (
        <div className="px-4 pb-2">
          <Notice tone="danger" action={settingsButton(failed)}>
            {failed}
          </Notice>
        </div>
      ) : null}
      {section === 'craft' ? (
        // The critic, as the Critique tab was: this scene or its chapter, Critique scene / chapter, its notes.
        <CritiquePanel sceneId={sceneId} />
      ) : (
        <>
          {section === 'all' || section === 'slips' || section === 'questions' ? (
            <CheckReportCard sceneId={sceneId} openIssues={issues ? openCount(issues).count : null} />
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
          ) : body.length ? (
            <div className="flex flex-col animate-fade-in">{body}</div>
          ) : (
            <NothingFound />
          )}
        </>
      )}
      {section !== 'craft' && (forLater.length || ignored.length) ? (
        <div className="mt-auto flex flex-col gap-1 border-t border-line px-4 py-2.5">
          {forLater.length ? <PutAway label="for later" issues={forLater} shown={showLater} onShow={setShowLater} /> : null}
          {ignored.length ? <PutAway label="ignored" issues={ignored} shown={showIgnored} onShow={setShowIgnored} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/** A section's cards, closing up as one folds away. */
function IssueCards({
  list,
  label,
  leaving,
  fold
}: {
  list: Issue[]
  label: string
  leaving: Set<string>
  fold: (act: (issue: Issue) => Promise<void>) => (issue: Issue) => void
}): React.JSX.Element {
  const listRef = useRef<HTMLUListElement>(null)
  useFlip(listRef, list.map((i) => i.id).join())
  return (
    <ul ref={listRef} aria-label={label} className="iss-list flex flex-col gap-2 px-4 pb-3 pt-1">
      {list.map((i) => (
        <li key={i.id} data-flip={i.id}>
          <IssueCard issue={i} leaving={leaving.has(i.id)} onIgnore={fold(ignore)} onLater={fold(later)} />
        </li>
      ))}
    </ul>
  )
}

/** One section: its heading (with how many, and what it holds on hover), then what it has, or that it has nothing. */
function Section({ id, count, lone = false, children }: { id: IssueSection; count: number; lone?: boolean; children: ReactNode }): React.JSX.Element {
  const empty = !count && lone
  return (
    <section aria-labelledby={`iss-sec-${id}`} data-issue-section={id} className="flex flex-col">
      <h3 id={`iss-sec-${id}`} title={SECTION_HINTS[id]} className="flex items-baseline gap-1.5 px-4 pb-1 pt-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-faint">
        {SECTION_WORDS[id]}
        {count ? <span className="tabular-nums font-medium normal-case tracking-normal">{count}</span> : null}
      </h3>
      {empty ? <p className="px-4 pb-3 text-[12.5px] leading-[18px] text-muted">{EMPTY_WORDS[id]}</p> : children}
    </section>
  )
}

/** What a section on its own says when it has nothing. */
const EMPTY_WORDS: Record<IssueSection, string> = {
  slips: 'No slips in this scene.',
  questions: 'No questions about this scene.',
  craft: '',
  threads: 'No plot threads to look at in this scene.',
  memory: 'The memory has read this scene and is sure of what it found.'
}

/** The critic's notes in "All": how many are still to do, and the way to them (Craft notes). */
function CraftSummary({ headline, open, reading, onOpen }: { headline: string; open: number; reading: boolean; onOpen: () => void }): React.JSX.Element {
  return (
    <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5" data-craft-summary>
      {reading ? <Spinner size={13} className="shrink-0" /> : <MessageSquareQuote size={15} className="shrink-0 text-muted" aria-hidden />}
      <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-muted">
        {reading ? 'The critic is reading…' : `${open} ${open === 1 ? 'note' : 'notes'} from the critic${headline ? ` · ${headline}` : ''}`}
      </p>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        Show
      </Button>
    </div>
  )
}

/** The scene's critique as the list needs it: notes still to do, the headline, whether the critic is reading now. */
function useCraft(sceneId: ID): { open: number; headline: string; reading: boolean } {
  const saved = useCritique({ scope: 'scene', id: sceneId })
  const reading = useCritiqueStore((s) => !!s.runs[`scene:${sceneId}`])
  const critique = saved?.critique ?? null
  const gone = saved?.gone ?? []
  const open = critique ? critique.notes.filter((n) => !n.status && !gone.includes(n.id)).length : 0
  return { open, headline: critique ? critiqueHeadline(critique) : '', reading }
}

/**
 * What the memory isn't sure about in this scene (the memory check list, keeper/checkQueue.ts), whether its model turned
 * the scene down (keeper/refusals.ts) and whether its latest words couldn't be read ("Memory not updated"). Read again a
 * moment after the memory changes.
 */
function useSceneMemory(sceneId: ID): {
  refusal: MemoryRefusal | null
  failed: boolean
  checks: MemoryCheckItem[]
  entries: Map<ID, Entry>
  set: (next: MemoryCheckItem[], part: 'memory' | 'promise') => void
  reload: () => void
} {
  const worldId = useApp((s) => s.world?.id ?? null)
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const status = useApp((s) => s.memoryStatus)
  const failed = useOutlineStore((s) => s.outline?.scenes.find((x) => x.id === sceneId)?.memoryState === 'failed')
  const [refusal, setRefusal] = useState<MemoryRefusal | null>(null)
  const [checks, setChecks] = useState<MemoryCheckItem[]>([])
  const [entries, setEntries] = useState<Map<ID, Entry>>(new Map())
  const [ask, setAsk] = useState(0)
  // Read again when a read fails or is turned down (not on every step of the memory's reading: the list is no small read).
  const statusKey = `${status?.failed ?? 0}:${status?.refused?.message ?? ''}:${status?.lastUpdate?.runId ?? ''}`
  useEffect(() => {
    if (!worldId) return
    let live = true
    const t = setTimeout(() => {
      api
        .memoryRefusal(sceneId)
        .then((r) => live && setRefusal(r))
        .catch(() => undefined)
      api
        .listMemoryChecks()
        .then((list) => live && setChecks(list.filter((c) => c.sceneId === sceneId)))
        .catch(() => undefined)
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [sceneId, worldId, memoryRev, entriesRev, statusKey, ask])
  // The entries' pages, for Fix on a fact (read only when there is something to fix).
  const needEntries = checks.some((c) => !!c.entryId)
  useEffect(() => {
    if (!needEntries) return
    let live = true
    api
      .listEntries()
      .then((all) => live && setEntries(new Map(all.map((e) => [e.id, e]))))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [needEntries, entriesRev])
  return {
    refusal,
    failed: failed && !refusal,
    checks,
    entries,
    set: (next, part) => setChecks((all) => [...all.filter((c) => (part === 'promise' ? c.group !== 'promise' : c.group === 'promise')), ...next]),
    reload: () => setAsk((n) => n + 1)
  }
}

/**
 * The memory's own notes on the scene: its model turned the scene down (Try again; Use another of Adam's models for the
 * memory, with Undo), or its latest words couldn't be read (Try again).
 */
function MemoryNotes({ sceneId, refusal, failed, onRetried }: { sceneId: ID; refusal: MemoryRefusal | null; failed: boolean; onRetried: () => void }): React.JSX.Element | null {
  const models = useApp((s) => s.settings?.models)
  const [busy, setBusy] = useState<'retry' | 'switch' | null>(null)
  const memoryNow = models ? (models.memory ?? models.writer) : null
  const other = useMemo(() => (models ? anotherModel(models, [memoryNow]) : null), [models, memoryNow])
  if (!refusal && !failed) return null

  const tryAgain = async (): Promise<void> => {
    setBusy('retry')
    try {
      await api.updateMemoryNow(sceneId)
      toast('Trying again. The memory is reading this scene.')
      onRetried()
    } catch (e) {
      toast(plainReason(e), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }
  const useOther = async (): Promise<void> => {
    if (!other) return
    const was = models?.memory ?? null
    setBusy('switch')
    try {
      await useApp.getState().updateSettings({ models: { memory: other } })
      await api.updateMemoryNow(sceneId)
      onRetried()
      toast(`The memory now uses ${modelName(other)}. It is reading this scene.`, {
        action: {
          label: 'Undo',
          run: () => void useApp.getState().updateSettings({ models: { memory: was } })
        }
      })
    } catch (e) {
      toast(plainReason(e), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const words = refusal
    ? refusal.kind === 'read'
      ? `The memory model (${refusal.model}) turned this scene down, so the memory doesn’t know what happens in it yet. Some models won’t read explicit scenes.`
      : `The memory model (${refusal.model}) wouldn’t write this scene’s summary, so later scenes are told less about it. Some models won’t read explicit scenes.`
    : 'The memory couldn’t read this scene’s latest changes, so the AI knows it as it was last read. It tries again by itself, or you can try now.'
  return (
    <div className="px-4 pb-3">
      <article className="iss-card rounded-lg border border-line bg-surface px-3 py-2.5" data-memory-note={refusal ? 'refused' : 'failed'} data-severity="warning">
        <div className="flex items-center gap-2">
          <Badge>{refusal ? 'Turned down' : 'Memory not updated'}</Badge>
        </div>
        <p className="iss-msg mt-1.5 text-[12.5px] leading-[18px] text-muted">{words}</p>
        <div className="iss-acts mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" loading={busy === 'retry'} onClick={() => void tryAgain()}>
            Try again
          </Button>
          {refusal ? (
            other ? (
              <Button size="sm" loading={busy === 'switch'} onClick={() => void useOther()} title={`Read this scene, and the memory from now on, with ${modelName(other)}, one of your models`}>
                Use {modelName(other)} for the memory
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => useApp.getState().navigate({ kind: 'settings', tab: 'models' })}>
                Pick another memory model
              </Button>
            )
          ) : null}
        </div>
      </article>
    </div>
  )
}

/**
 * The issues put away in this scene, folded under a "Show …" toggle: those saved for later (Show now brings one back)
 * and those ignored (Reopen).
 */
function PutAway({
  label,
  issues,
  shown,
  onShow
}: {
  label: 'for later' | 'ignored'
  issues: Issue[]
  shown: boolean
  onShow: (on: boolean) => void
}): React.JSX.Element {
  return (
    <div>
      <button type="button" aria-expanded={shown} onClick={() => onShow(!shown)} className="text-[12.5px] text-muted hover:text-fg">
        {shown ? `Hide ${label}` : `Show ${label} (${issues.length})`}
      </button>
      {shown ? (
        <ul aria-label={label === 'ignored' ? 'Ignored' : 'Saved for later'} className="mt-2 flex flex-col gap-1.5 animate-fade-in">
          {issues.map((i) => (
            <li key={i.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-muted">
                {i.message}
                {i.setAsideBy ? <span className="block text-faint">{ignoredWords(i)}</span> : null}
              </p>
              <Button size="sm" variant="ghost" className="-my-0.5" onClick={() => void reopen(i)}>
                {label === 'ignored' ? 'Reopen' : 'Show now'}
              </Button>
            </li>
          ))}
        </ul>
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

/**
 * Nothing to look at. While the page has words underlined (listed above it), it says the checks found nothing and
 * points at those, rather than that there is nothing to look at.
 */
function NothingFound(): React.JSX.Element {
  const counts = useLiveFlagCounts()
  const underlined = LIVE_ORDER.reduce((n, k) => n + counts[k], 0)
  const desk = useDesk()
  const text = (
    <>
      {underlined
        ? `The checks found nothing to fix, but ${underlined === 1 ? 'one thing is' : `${underlined.toLocaleString()} things are`} underlined in the page (listed above) for a look. `
        : desk
          ? 'All clear in this scene. '
          : null}
      Check (in the top bar) looks at facts, who knows what, the timeline, voices, style and tone, and the critic’s craft notes when you
      ask for them.
    </>
  )
  if (desk) {
    return (
      <div className="iss-clear" role="status">
        <LighthouseArt clear className="iss-clear-art" />
        <h3 className="iss-clear-title">{underlined ? 'No issues from the checks' : 'Nothing to look at'}</h3>
        <p className="iss-clear-text">{text}</p>
      </div>
    )
  }
  return (
    <EmptyState icon={<CircleCheck size={20} />} title={underlined ? 'No issues from the checks' : 'Nothing to look at'} className="py-8">
      {text}
    </EmptyState>
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

/**
 * What the scene has to look at, and Check this scene (the top bar's Check); or how the check is going, calmly, with
 * what it waits for, Check now while it waits for the memory, and Stop.
 */
function CheckBar({ sceneId, summary, run }: { sceneId: ID; summary: string; run: ReturnType<typeof runFor> }): React.JSX.Element {
  const [starting, setStarting] = useState(false)
  const runs = useChecks((s) => s.runs)
  const memory = useApp((s) => s.memoryStatus)
  const busy = !!run || starting
  const slow = useDelayed(busy, 120)
  // Its own scene's check needs no name here: "Checking this scene…" (or what it is waiting for).
  const words = run ? runLine(run, { runs, memory }) : 'Checking this scene…'
  const progress = useCalmLine(run?.target.scope === 'scene' && /^Checking /.test(words) ? 'Checking this scene…' : words)

  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      await runCheck('scene', { sceneId, show: false })
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
            data-check-progress
            className={cn('flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-muted transition-opacity duration-150', slow ? 'opacity-100' : 'opacity-0')}
          >
            <Spinner size={13} className="shrink-0" />
            <span className="truncate" title={progress}>
              {progress}
            </span>
          </span>
          {run?.waiting === 'memory' ? (
            <Button size="sm" variant="ghost" onClick={() => void checkWithoutWaiting(run.runId)} title="Don’t wait for the memory: check with what it knows">
              Check now
            </Button>
          ) : null}
          {run ? (
            <Button size="sm" variant="ghost" onClick={() => void stopRun(run.runId)}>
              Stop
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted" title={summary}>
            {summary}
          </span>
          <Button
            size="sm"
            icon={<ListChecks size={14} />}
            onClick={() => void start()}
            title="Checks facts, who knows what, timeline and place, voices, and style and tone (and the critic’s craft notes, with Craft notes too on in the top bar’s Check)"
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

function IssueCard({
  issue,
  leaving = false,
  onIgnore,
  onLater
}: {
  issue: Issue
  leaving?: boolean
  onIgnore?: (issue: Issue) => void
  onLater?: (issue: Issue) => void
}): React.JSX.Element {
  const memoryWords = memoryFixWords(issue)
  const canFix = !!issue.quote.trim() && !!issue.sceneId
  const fix = usableFix(issue)
  const desk = useDesk()
  return (
    <article
      aria-label={`${SEVERITY_WORDS[issue.severity]}: ${issue.message}`}
      data-severity={issue.severity}
      data-leaving={leaving || undefined}
      className={cn('iss-card rounded-lg border bg-surface px-3 py-2.5', issue.severity === 'must-fix' ? 'border-danger/35' : 'border-line')}
    >
      <div className="flex items-center gap-2">
        {desk ? <SeverityPill severity={issue.severity}>{SEVERITY_WORDS[issue.severity]}</SeverityPill> : <SeverityMark issue={issue} />}
        <span className="min-w-0 truncate text-[11.5px] text-faint" title={issue.byRule ? RULE_DETAIL : issue.byContract ? CONTRACT_DETAIL : undefined}>
          {issue.aiPhrase ? 'Common AI phrase' : KIND_WORDS[issue.kind]}
          {issue.byRule ? ` · ${RULE_WORDS}` : null}
          {issue.byContract ? ` · ${CONTRACT_WORDS}` : null}
        </span>
      </div>
      {issue.quote.trim() ? (
        <button
          type="button"
          onClick={() => showWords(issue)}
          title="Show these words in the page"
          className="iss-quote -mx-1 mt-1.5 block w-[calc(100%+0.5rem)] rounded px-1 py-0.5 text-left font-serif text-[14px] leading-[21px] text-fg hover:bg-surface-2"
        >
          <span className="line-clamp-3">{quoted(issue.quote.trim())}</span>
        </button>
      ) : null}
      <p className="iss-msg mt-1 text-[12.5px] leading-[18px] text-muted">{issue.message}</p>
      {/* The critic's suggestion, shown before anything changes: Fix the text puts the rewrite in the page to accept
          or reject; advice is for Adam to act on. */}
      {fix || issue.advice ? (
        <div className="iss-fix mt-1.5 rounded-md bg-surface-2 px-2 py-1.5 text-[12.5px] leading-[18px]" data-suggested-fix>
          <span className="font-medium text-fg">Suggested fix: </span>
          {fix ? <span className="font-serif text-fg">{quoted(fix.trim())}</span> : null}
          {fix && issue.advice ? ' ' : null}
          {issue.advice ? <span className="text-muted">{issue.advice}</span> : null}
        </div>
      ) : null}
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
      <div className="iss-acts mt-2 flex flex-wrap gap-1.5">
        {canFix ? (
          <Button
            size="sm"
            className="iss-ai"
            onClick={() => fixTheText(issue)}
            title={
              fix
                ? 'Shows the suggested fix in the page, to accept or reject: nothing changes until you accept'
                : 'Asks the writer model to rewrite the sentence, shown in the page to accept or reject'
            }
          >
            {fix ? 'Review the fix' : 'Fix the text'}
          </Button>
        ) : null}
        {memoryWords ? (
          <Button size="sm" onClick={() => void updateTheMemory(issue)} title={memoryWords}>
            Update the memory
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => (onLater ? onLater(issue) : void later(issue))} title={LATER_TITLE}>
          Later
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => (onIgnore ? onIgnore(issue) : void ignore(issue))}
          title="It’s meant to be like this: hide it, and don’t raise it again"
        >
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
