// The Consistency page's reports: Repetition (pet phrases across chapters, then each chapter's words and
// phrases used too often, each opening the first place it is used) and Plot threads (open too long, and
// payoffs with no setup, each linking to the thread's page and the scene).
import { Hourglass, Repeat2, Spool, Unlink } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ID } from '@shared/types'
import type { RepetitionItem, RepetitionReport, ThreadsReport } from '@shared/contracts/checks'
import { EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ViewError, ViewLoading } from '@/features/timeline/viewParts'
import { chapterList, chapterNumbers, timesWords } from './consistencyLogic'
import { openThread, openWords } from './open'

/** A link's look without its colour (clsx doesn't settle two colours, so each use names one). */
const linkBase = 'rounded underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40'
const link = `${linkBase} font-medium text-accent`

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }): React.JSX.Element {
  return (
    <section aria-label={title}>
      <header className="mb-3 px-1">
        <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{hint}</p>
      </header>
      {children}
    </section>
  )
}

const None = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[12.5px] text-faint">{children}</p>
)

// ---------- Repetition ----------

export function RepetitionTab({
  storyId,
  report,
  error,
  onRetry
}: {
  storyId: ID
  report: RepetitionReport | null
  error: string | null
  onRetry: () => void
}): React.JSX.Element {
  if (!report) return error ? <ViewError what="The repetition report" error={error} onRetry={onRetry} /> : <ViewLoading />
  const numbers = chapterNumbers(report)
  const chapters = report.chapters.filter((c) => c.items.length)
  if (!chapters.length && !report.petPhrases.length) {
    return (
      <EmptyState icon={<Repeat2 size={20} />} title="Nothing is used too often" className="mt-[8vh]">
        Words and phrases used much more than usual in a chapter show here, and phrases you come back to in chapter after chapter. Names
        are left out: they are meant to repeat.
      </EmptyState>
    )
  }
  const open = (item: RepetitionItem): void => {
    if (item.sceneId) openWords(item.sceneId, storyId, item.phrase, { wholeWord: true })
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pb-12 pt-5">
      <Section title="Pet phrases" hint="Phrases you come back to in chapter after chapter. Click one to see where it is first used.">
        {report.petPhrases.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
            {report.petPhrases.map((p) => (
              <li key={p.phrase} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
                <PhraseButton item={p} onOpen={open} className="font-serif text-[14.5px]" />
                <span className="text-[12.5px] text-muted">
                  {timesWords(p.count, p.chapterIds.length)} · {chapterList(p.chapterIds, numbers)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <None>No phrase comes back across three chapters or more.</None>
        )}
      </Section>
      <Section title="By chapter" hint="Words and phrases used often within one chapter. Chapters with nothing to flag are left out.">
        {chapters.length ? (
          <div className="flex flex-col gap-3">
            {chapters.map((c) => (
              <div key={c.chapterId} className="rounded-xl border border-line bg-surface px-4 py-3 shadow-soft">
                <h3 className="mb-2 flex items-baseline gap-2 text-[13.5px] font-semibold text-fg">
                  {numbers.get(c.chapterId)}
                  {c.title.trim() ? <span className="min-w-0 truncate font-normal text-muted">{c.title.trim()}</span> : null}
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {c.items.map((item) => (
                    <li key={item.phrase}>
                      <button
                        type="button"
                        disabled={!item.sceneId}
                        onClick={() => open(item)}
                        aria-label={`${item.phrase}, used ${item.count} times`}
                        title={`${timesWords(item.count)} in this chapter. Click to see where it is first used.`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-[13px] text-fg outline-none transition-colors duration-150 hover:border-line-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        <span className="font-serif">{item.phrase}</span>
                        <span className="text-[11.5px] tabular-nums text-faint">×{item.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <None>No chapter leans on a word or phrase.</None>
        )}
      </Section>
    </div>
  )
}

function PhraseButton({ item, onOpen, className }: { item: RepetitionItem; onOpen: (i: RepetitionItem) => void; className?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={!item.sceneId}
      onClick={() => onOpen(item)}
      title="See where it is first used"
      className={cn(linkBase, 'text-left text-fg hover:text-accent', className)}
    >
      “{item.phrase}”
    </button>
  )
}

// ---------- Plot threads ----------

export function ThreadsTab({
  storyId,
  report,
  error,
  onRetry
}: {
  storyId: ID
  report: ThreadsReport | null
  error: string | null
  onRetry: () => void
}): React.JSX.Element {
  if (!report) return error ? <ViewError what="The plot threads report" error={error} onRetry={onRetry} /> : <ViewLoading />
  if (!report.openTooLong.length && !report.noSetup.length) {
    return (
      <EmptyState icon={<Spool size={20} />} title="Every plot thread is in hand" className="mt-[8vh]">
        Threads left open for many chapters show here, and threads a scene card pays off with nothing earlier setting them up. See them
        all on the plot threads board.
      </EmptyState>
    )
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pb-12 pt-5">
      <Section title="Open too long" hint="Opened many chapters ago, and not paid off yet. Pay them off, or let the reader see they still matter.">
        {report.openTooLong.length ? (
          <ThreadList>
            {report.openTooLong.map((t) => (
              <ThreadRow key={t.entryId} icon={<Hourglass size={14} />} entryId={t.entryId} name={t.name}>
                Open for {t.chapters} {t.chapters === 1 ? 'chapter' : 'chapters'}
                {t.openedIn ? (
                  <>
                    , since{' '}
                    {t.openedAt ? (
                      <SceneLink storyId={t.openedAt.storyId} sceneId={t.openedAt.sceneId}>
                        {t.openedIn}
                      </SceneLink>
                    ) : (
                      t.openedIn
                    )}
                  </>
                ) : null}
              </ThreadRow>
            ))}
          </ThreadList>
        ) : (
          <None>No plot thread has been open too long.</None>
        )}
      </Section>
      <Section
        title="Paid off with no setup"
        hint="A scene card pays these off, but nothing before that scene sets them up. Mark the scene that does under Sets up on its card, or write the setup in."
      >
        {report.noSetup.length ? (
          <ThreadList>
            {report.noSetup.map((t) => (
              <ThreadRow key={t.entryId} icon={<Unlink size={14} />} entryId={t.entryId} name={t.name}>
                Paid off in{' '}
                <SceneLink storyId={storyId} sceneId={t.sceneId}>
                  {t.label}
                </SceneLink>
              </ThreadRow>
            ))}
          </ThreadList>
        ) : (
          <None>Every payoff has a setup before it.</None>
        )}
      </Section>
    </div>
  )
}

const ThreadList = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-soft">{children}</ul>
)

function ThreadRow({ icon, entryId, name, children }: { icon: ReactNode; entryId: ID; name: string; children: ReactNode }): React.JSX.Element {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0 text-faint" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => openThread(entryId)} title="Open this plot thread" className={cn(linkBase, 'text-left text-[14px] font-medium text-fg hover:text-accent')}>
          {name}
        </button>
        <p className="mt-0.5 text-[12.5px] text-muted">{children}</p>
      </div>
    </li>
  )
}

function SceneLink({ storyId, sceneId, children }: { storyId: ID; sceneId: ID; children: ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={() => openWords(sceneId, storyId, '')} title="Open this scene" className={link}>
      {children}
    </button>
  )
}
