// Build the world from a summary (View 'worldBuilder'): Quick start for a whole world. Adam types or
// pastes a summary, from a paragraph to several pages, sees roughly what it would cost, and one click lays
// out everything in it. There is nothing to approve: it saves as it goes, says what it is doing ("Laying
// out characters: 4 of 7") and lists each thing as it is saved, and Cancel keeps what was made. Then the
// page lists everything it made, grouped by kind, with Open on each and one Undo for the whole build.
// The summary is kept in the world, so the page reopens with it, and building again adds only what is
// missing. Owned by the World builder part.

import { AlertTriangle, ArrowRight, Check, Globe2, Link2, Palette, Sparkles, Square, Undo2 } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { WorldBuildDone, WorldBuildItem } from '@shared/contracts/worldBuilder'
import type { EntryKind, ID } from '@shared/types'
import { Badge, Button, Kbd, Notice, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isShortcut, shortcutKeys } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { ProblemNotice, settingsAction, WritingStatus } from '@/features/builder/parts'
import { MicButton } from '@/features/dictation/MicButton'
import { insertIntoBox } from '@/features/dictation/insertText'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { KIND_ICONS } from '@/features/world/kindIcons'
import {
  WORLD_START,
  allUndone,
  costWords,
  doneWords,
  estimateWords,
  listWords,
  madeSections,
  whenOptions,
  type MadeSection
} from './worldBuilderLogic'
import {
  buildWorld,
  cancelWorldBuild,
  loadWorldBuilder,
  refreshWorldBuilder,
  setWorldBuildStory,
  setWorldSummary,
  undoWholeBuild,
  useWorldBuilder
} from './worldBuilderStore'

export function WorldBuilderView(): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id ?? null)
  const loaded = useWorldBuilder((s) => s.loaded && s.worldId === worldId)
  // Read from the world when the page first opens in it (and again after a backup is restored).
  useEffect(() => {
    if (!loaded) void loadWorldBuilder()
  }, [worldId, loaded])
  // Nothing until the summary kept in the world is here, so the box never shows empty first.
  if (!loaded) return <div className="h-full" />
  return <Page />
}

/** Scrolls the page (only the page, never the window) just far enough to show its first outcome, when that is below its foot. */
function showOutcome(page: HTMLElement | null): void {
  const el = page?.querySelector<HTMLElement>('[data-outcome]')
  if (!page || !el) return
  const below = el.getBoundingClientRect().bottom - page.getBoundingClientRect().bottom + 24
  if (below <= 0) return
  let still = false
  try {
    still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // Smooth, then.
  }
  page.scrollBy({ top: below, behavior: still ? 'auto' : 'smooth' })
}

function Page(): React.JSX.Element {
  const s = useWorldBuilder()
  const stories = useApp((st) => st.stories)
  const entriesRev = useApp((st) => st.entriesRev)
  const memoryRev = useApp((st) => st.memoryRev)
  const box = useRef<HTMLTextAreaElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const whenId = useId()
  const running = !!s.running

  // What the last build made, as it is now: lines undone in What changed, entries deleted since.
  useEffect(() => {
    if (!running) void refreshWorldBuilder()
  }, [entriesRev, memoryRev, running])

  // A build that ends, or can't start, while the page is open: how it went comes into view, even in a
  // small window where it would be below the foot of the page. Never on opening the page.
  const seen = useRef({ running, problem: s.problem })
  useEffect(() => {
    const before = seen.current
    seen.current = { running, problem: s.problem }
    if ((before.running && !running) || (s.problem && s.problem !== before.problem)) showOutcome(pageRef.current)
  }, [running, s.problem])

  const estimate = s.estimate
  const estimateProblem = estimate?.problem ? { message: estimate.problem, code: estimate.code ?? undefined } : null
  const settings = estimateProblem ? settingsAction(estimateProblem.message, estimateProblem.code) : undefined
  const last = s.last
  const canUndo = !running && !!last?.runId && last.made.some((m) => !m.undone)

  return (
    <div ref={pageRef} className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[720px] px-8 pb-16 pt-10">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          <Globe2 size={12} className="text-ai" aria-hidden />
          World builder
        </div>
        <h1 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-fg">Build the world from a summary</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Type or paste a summary of your world or story, from a paragraph to several pages. AI Write lays out everything in it and saves it
          to your world. Your own words are kept exactly as you wrote them, and anything already in your world is left as it is.
        </p>

        <div className="mt-5 flex items-end justify-between gap-2">
          <label htmlFor="world-summary" className="block text-[12px] font-medium text-muted">
            Your summary
          </label>
          <MicButton disabled={running} onText={(t) => box.current && insertIntoBox(box.current, t, setWorldSummary)} />
        </div>
        <AutoTextarea
          ref={box}
          id="world-summary"
          autoFocus={!s.summary && !running}
          value={s.summary}
          readOnly={running}
          minRows={5}
          maxRows={18}
          placeholder="The Grey Coast is a cold land of fog and reefs. Mara Venn captains a smuggling ship out of Saltmarsh and owes the Salt Guild a fortune. Magic always costs blood…"
          className={cn('mt-1 font-serif text-[15px] leading-[1.6]', running && 'bg-surface-2!')}
          onChange={(e) => setWorldSummary(e.target.value)}
          onKeyDown={(e) => {
            if (isShortcut(e, 'buildWorld')) {
              e.preventDefault()
              if (!running) void buildWorld()
            }
          }}
        />

        <div className="mt-4 flex max-w-[360px] flex-col gap-1">
          <label htmlFor={whenId} className="text-[12px] font-medium text-muted">
            When is this true?
          </label>
          <Select
            id={whenId}
            value={s.storyId && stories.some((st) => st.id === s.storyId) ? s.storyId : WORLD_START}
            options={whenOptions(stories)}
            onChange={(v) => setWorldBuildStory(v && v !== WORLD_START ? v : null)}
          />
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          Anything your summary says happens later becomes an event or a plot thread.
        </p>

        <div className="mt-5 flex h-10 items-center gap-2">
          {running ? (
            <>
              <Button
                size="lg"
                icon={<Square size={11} fill="currentColor" />}
                loading={s.cancelling}
                onClick={() => void cancelWorldBuild()}
                title="Cancel. Everything made so far is kept."
              >
                Cancel
              </Button>
              <WritingStatus
                text={s.cancelling ? 'Cancelling…' : (s.running?.retrying ?? s.running?.step ?? 'Reading your summary')}
                title={s.running?.retrying ?? undefined}
              />
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" icon={<Sparkles size={15} />} onClick={() => void buildWorld()}>
                {last?.status === 'error' && s.problem ? 'Try again' : 'Build the world'}
              </Button>
              {canUndo ? (
                <Button
                  size="lg"
                  icon={<Undo2 size={15} />}
                  onClick={() => void undoWholeBuild()}
                  title="Takes out everything this build made"
                >
                  Undo the whole build
                </Button>
              ) : null}
              <div className="flex-1" />
              <span className="flex items-center gap-1 text-[12px] text-faint" title="Press these in your summary to build">
                {shortcutKeys('buildWorld').map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </>
          )}
        </div>

        {/* What building would cost, or why it can't be built yet. Always a line high, so nothing below moves. */}
        <div className="mt-1 min-h-5">
          {!running && estimateProblem ? (
            <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted animate-fade-in">
              {estimateProblem.message}
              {settings ? (
                <button type="button" onClick={settings.run} className="font-medium text-accent hover:underline">
                  {settings.label}
                </button>
              ) : null}
            </p>
          ) : !running && s.summary.trim() && estimateWords(estimate) ? (
            <p className="text-[12.5px] text-muted animate-fade-in">{estimateWords(estimate)}</p>
          ) : null}
        </div>

        {s.problem ? (
          <div className="mt-2" data-outcome>
            <ProblemNotice message={s.problem.message} code={s.problem.code} />
          </div>
        ) : null}

        {s.running ? <Progress made={s.running.made} /> : last ? <Results last={last} /> : null}
      </div>
    </div>
  )
}

/** What the build has saved so far, each thing at the end of the list as it is saved. */
function Progress({ made }: { made: WorldBuildItem[] }): React.JSX.Element {
  return (
    <section aria-label="Made so far" aria-busy className="mt-7">
      <Heading title="Made so far" />
      <p className="mt-1 text-[12.5px] text-muted">
        {made.length
          ? 'Each thing is saved as soon as it is made. Cancel keeps everything here.'
          : 'Each thing shows here as soon as it is saved.'}
      </p>
      <Sections sections={madeSections(made)} />
    </section>
  )
}

/** How the last build ended and everything it made, grouped by kind, with Open on each. */
function Results({ last }: { last: WorldBuildDone }): React.JSX.Element | null {
  const undone = allUndone(last.made)
  const told = doneWords(last)
  const words = [told, undone ? '' : costWords(last.cost)].filter(Boolean).join(' ')
  const navigate = useApp((s) => s.navigate)
  // A build that stopped before it made or found anything: the problem above says it all.
  const nothing = !last.made.length && !last.found.length && !last.conflicts.length && !last.missed.length && !last.skipped.length
  if (!told && nothing) return null
  return (
    <section aria-label="Made from your summary" className="mt-7">
      <Heading title="Made from your summary" />
      {words ? (
        <p role="status" data-outcome className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted">
          {last.status === 'complete' && !undone && last.made.length ? (
            <Check size={13} className="mt-[3px] shrink-0 text-success" aria-hidden />
          ) : null}
          <span>{words}</span>
        </p>
      ) : null}

      {last.conflicts.length && !undone ? (
        <div className="mt-4">
          <Notice>
            <p className="font-medium">Where your summary disagrees with your world</p>
            <p className="text-muted">Nothing on these pages was changed. Each is listed as a consistency issue to look at.</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {last.conflicts.map((c) => (
                <li key={`${c.entryId}:${c.field}`} className="flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-[3.5px] shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">{c.message}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-my-0.5"
                    onClick={() => openEntry(c.entryId, c.kind)}
                    aria-label={`Open ${c.name}`}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}

      {undone ? null : <Sections sections={madeSections(last.made)} />}

      {!undone && last.found.length ? (
        <div className="mt-6">
          <Heading title="Already in your world" count={last.found.length} />
          <p className="mt-1 text-[12.5px] text-muted">Your summary names these too. They were left as they are.</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {last.found.map((f) => (
              <li key={f.entryId}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'entries', entryKind: f.kind, entryId: f.entryId })}
                  title={`Open ${f.name}`}
                  className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12.5px] text-fg transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
                >
                  <KindIcon kind={f.kind} />
                  <span className="truncate">{f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!undone && last.skipped.length ? (
        <p className="mt-5 text-[12.5px] leading-relaxed text-muted">
          Left out, because you undid or deleted {last.skipped.length === 1 ? 'it' : 'them'} after an earlier build:{' '}
          {listWords(last.skipped)}.
        </p>
      ) : null}
      {!undone && last.missed.length ? (
        <div className="mt-4">
          <Notice>
            AI Write couldn’t lay out {listWords(last.missed)}. Build again to try {last.missed.length === 1 ? 'it' : 'them'} once more;
            everything else is left as it is.
          </Notice>
        </div>
      ) : null}
    </section>
  )
}

function Heading({ title, count }: { title: string; count?: number }): React.JSX.Element {
  return (
    <h2 className="flex h-6 items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-faint">
      {title}
      {count != null ? <span className="font-normal tabular-nums">{count}</span> : null}
    </h2>
  )
}

function Sections({ sections }: { sections: MadeSection[] }): React.JSX.Element {
  return (
    <>
      {sections.map((sec) => (
        <Section key={sec.key} section={sec} />
      ))}
    </>
  )
}

function Section({ section }: { section: MadeSection }): React.JSX.Element {
  return (
    <section aria-label={section.label} className="mt-5 animate-fade-in">
      <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold text-fg">
        {section.label}
        <span className="text-[12px] font-normal tabular-nums text-faint">{section.items.length}</span>
      </h3>
      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {section.items.map((item) => (
          <Row key={item.lineId} item={item} />
        ))}
      </ul>
    </section>
  )
}

/** Opens what a line made: its entry's page (a relationship's, the character it is recorded on), or the Style guide for themes and tone. */
function openItem(item: WorldBuildItem): void {
  if (item.what === 'themes' || item.what === 'tone') useApp.getState().navigate({ kind: 'style' })
  else if (item.entryId) openEntry(item.entryId, item.kind ?? 'character')
}

function openEntry(entryId: ID, kind: EntryKind): void {
  useApp.getState().navigate({ kind: 'entries', entryKind: kind, entryId })
}

/** The Open button's name, unique on the page: a relationship's says which, themes and tone say where they open. */
function openLabel(item: WorldBuildItem): string {
  if (item.what === 'relationship') return `Open ${item.name} (${item.detail})`
  if (item.what === 'themes' || item.what === 'tone') return `Open the world's ${item.what} in the Style guide`
  return `Open ${item.name}`
}

function KindIcon({ kind, className }: { kind: WorldBuildItem['kind']; className?: string }): React.JSX.Element {
  const Icon = kind ? KIND_ICONS[kind] : Palette
  return <Icon size={14} className={cn('shrink-0 text-muted', className)} aria-hidden />
}

function Row({ item }: { item: WorldBuildItem }): React.JSX.Element {
  const icon =
    item.what === 'relationship' ? (
      <Link2 size={14} className="shrink-0 text-muted" aria-hidden />
    ) : (
      <KindIcon kind={item.what === 'entry' ? item.kind : null} />
    )
  return (
    <li className="flex min-h-[52px] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0 animate-fade-in">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate text-[13.5px] font-medium', item.undone ? 'text-faint' : 'text-fg')}>{item.name}</span>
          {item.what === 'relationship' && item.detail ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
              <ArrowRight size={12} className="shrink-0 text-faint" aria-hidden />
              <span className="truncate">{item.detail}</span>
            </span>
          ) : null}
          {item.hardRule ? <Badge className="shrink-0">Never to be broken</Badge> : null}
        </div>
        {item.what !== 'relationship' && item.detail ? (
          <p className={cn('mt-0.5 truncate text-[12.5px]', item.undone ? 'text-faint' : 'text-muted')} title={item.detail}>
            {item.detail}
          </p>
        ) : null}
      </div>
      {item.undone ? (
        <span className="shrink-0 text-[12px] text-faint">Undone</span>
      ) : (
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => openItem(item)} aria-label={openLabel(item)}>
          Open
        </Button>
      )}
    </li>
  )
}
