// The desk's Check room, its two reports (UI overhaul): Repetition and Plot threads, laid out to use the sheet.
//  - Repetition: the phrases Adam comes back to across chapters as quotes, each with a strip of the story's chapters
//    lit where it is used; then each chapter's words leaned on, as a card of chips sized by how often (the most used
//    largest). Each opens the first place it is used, as the page's report does (ReportTabs.tsx).
//  - Plot threads: each thread as a string across the story's chapters. Open too long: the string runs from the
//    chapter that set it up to the last, its loose end still glowing. Paid off with no setup: the string only begins
//    at its payoff, nothing knotted before it. Each links to the thread's page and the scene.
import type { ReactNode } from 'react'
import type { RepetitionItem, RepetitionReport, ThreadsReport } from '@shared/contracts/checks'
import type { ID, Outline } from '@shared/types'
import { ArrowUpRight } from '@/components/ui/icons'
import { EchoArt, LoomArt } from '@/components/art/RoomArt'
import { ViewError, ViewLoading } from '@/features/timeline/viewParts'
import { chapterList, chapterNumbers, timesWords } from '../consistencyLogic'
import { openThread, openWords } from '../open'

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }): React.JSX.Element {
  return (
    <section aria-label={title} className="ck-report-section">
      <header className="ck-report-head">
        <h2 className="ck-report-title">{title}</h2>
        <p className="ck-report-hint">{hint}</p>
      </header>
      {children}
    </section>
  )
}

function Calm({ art, title, children }: { art: ReactNode; title: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="ck-calm" role="status">
      {art}
      <h2 className="ck-calm-title">{title}</h2>
      <p className="ck-calm-sub">{children}</p>
    </div>
  )
}

const None = ({ children }: { children: ReactNode }): React.JSX.Element => <p className="ck-none">{children}</p>

// ---------- Repetition ----------

export function DeskRepetition({
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
      <Calm art={<EchoArt className="ck-calm-art" />} title="Nothing is used too often">
        Words and phrases used much more than usual in a chapter show here, and phrases you come back to in chapter after chapter. Names are
        left out: they are meant to repeat.
      </Calm>
    )
  }
  const open = (item: RepetitionItem): void => {
    if (item.sceneId) openWords(item.sceneId, storyId, item.phrase, { wholeWord: true })
  }
  const all = report.chapters
  return (
    <div className="ck-report">
      <div className="ck-report-intro">
        <EchoArt className="ck-report-art" />
        <p>Words and phrases that echo: the ones you come back to in chapter after chapter, and those a chapter leans on. Click one to see where it is first used.</p>
      </div>
      <Section title="Pet phrases" hint="Phrases you come back to in chapter after chapter.">
        {report.petPhrases.length ? (
          <ul className="ck-pets">
            {report.petPhrases.map((p, i) => (
              <li key={p.phrase} className="ck-pet" style={{ '--i': i } as React.CSSProperties}>
                <button type="button" disabled={!p.sceneId} onClick={() => open(p)} className="ck-pet-phrase" title="See where it is first used">
                  “{p.phrase}”
                </button>
                <span className="ck-pet-meta">
                  {timesWords(p.count, p.chapterIds.length)} · {chapterList(p.chapterIds, numbers)}
                </span>
                <span className="ck-strip" aria-hidden>
                  {all.map((c) => (
                    <span key={c.chapterId} className="ck-strip-cell" data-on={p.chapterIds.includes(c.chapterId) || undefined} title={numbers.get(c.chapterId)} />
                  ))}
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
          <div className="ck-chapters">
            {chapters.map((c, ci) => {
              const most = Math.max(...c.items.map((i) => i.count))
              return (
                <div key={c.chapterId} className="ck-chapter-card" style={{ '--i': ci } as React.CSSProperties}>
                  <h3 className="ck-chapter-head">
                    <span className="ck-num">{numbers.get(c.chapterId)?.replace('Ch ', '')}</span>
                    <span className="ck-chapter-title">{c.title.trim() || numbers.get(c.chapterId)}</span>
                  </h3>
                  <ul className="ck-words">
                    {c.items.map((item) => (
                      <li key={item.phrase}>
                        <button
                          type="button"
                          disabled={!item.sceneId}
                          onClick={() => open(item)}
                          aria-label={`${item.phrase}, used ${item.count} times`}
                          title={`${timesWords(item.count)} in this chapter. Click to see where it is first used.`}
                          className="ck-word"
                          style={{ '--w': most > 1 ? (item.count - 1) / (most - 1) : 1 } as React.CSSProperties}
                        >
                          <span className="ck-word-text">{item.phrase}</span>
                          <span className="ck-word-n">×{item.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <None>No chapter leans on a word or phrase.</None>
        )}
      </Section>
    </div>
  )
}

// ---------- Plot threads ----------

/** Each chapter's place in the story (0 first), and the chapter each scene is in. */
function chapterPlaces(outline: Outline | null): { count: number; ofScene: (sceneId: ID | null | undefined) => number | null } {
  const index = new Map(outline?.chapters.map((c, i) => [c.id, i]) ?? [])
  const scenes = new Map(outline?.scenes.map((s) => [s.id, s.chapterId]) ?? [])
  return {
    count: outline?.chapters.length ?? 0,
    ofScene: (id) => (id ? (index.get(scenes.get(id) ?? '') ?? null) : null)
  }
}

/** A thread as a string across the chapters: from `from` to `to` (inclusive), knotted where it was set up or paid off. */
function ThreadString({ count, from, to, knot, open }: { count: number; from: number; to: number; knot: number; open: boolean }): React.JSX.Element | null {
  if (count < 1) return null
  const x = (i: number): number => (count === 1 ? 50 : (i / (count - 1)) * 100)
  const at = (i: number): React.CSSProperties => ({ left: `${x(i)}%` })
  return (
    <div className="ck-string la" aria-hidden data-open={open || undefined}>
      <span className="ck-string-track" />
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="ck-string-tick" style={at(i)}>
          <span className="ck-string-label">{i + 1}</span>
        </span>
      ))}
      {open ? null : <span className="ck-string-missing" style={{ left: 0, width: `${x(knot)}%` }} />}
      <span className="ck-string-line" style={{ left: `${x(from)}%`, width: `${x(to) - x(from)}%` }} />
      <span className="ck-string-knot" style={at(knot)} />
      {open ? <span className="ck-string-end" style={at(to)} /> : null}
    </div>
  )
}

export function DeskThreads({
  storyId,
  report,
  outline,
  error,
  onRetry
}: {
  storyId: ID
  report: ThreadsReport | null
  outline: Outline | null
  error: string | null
  onRetry: () => void
}): React.JSX.Element {
  if (!report) return error ? <ViewError what="The plot threads report" error={error} onRetry={onRetry} /> : <ViewLoading />
  if (!report.openTooLong.length && !report.noSetup.length) {
    return (
      <Calm art={<LoomArt className="ck-calm-art" />} title="Every plot thread is in hand">
        Threads left open for many chapters show here, and threads a scene card pays off with nothing earlier setting them up. See them all on
        the plot threads board.
      </Calm>
    )
  }
  const places = chapterPlaces(outline)
  const last = Math.max(0, places.count - 1)
  return (
    <div className="ck-report">
      <div className="ck-report-intro">
        <LoomArt className="ck-report-art" />
        <p>Each plot thread as a string through the story’s chapters: where it was set up, where it is paid off, and the ones still hanging loose.</p>
      </div>
      <Section title="Open too long" hint="Opened many chapters ago, and not paid off yet. Pay them off, or let the reader see they still matter.">
        {report.openTooLong.length ? (
          <ul className="ck-threads">
            {report.openTooLong.map((t, i) => {
              const from = places.ofScene(t.openedAt?.sceneId) ?? Math.max(0, last - t.chapters)
              return (
                <li key={t.entryId} className="ck-thread" style={{ '--i': i } as React.CSSProperties}>
                  <div className="ck-thread-words">
                    <button type="button" onClick={() => openThread(t.entryId)} title="Open this plot thread" className="ck-thread-name">
                      {t.name}
                    </button>
                    <p className="ck-thread-meta">
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
                    </p>
                  </div>
                  <ThreadString count={places.count} from={from} to={last} knot={from} open />
                </li>
              )
            })}
          </ul>
        ) : (
          <None>No plot thread has been open too long.</None>
        )}
      </Section>
      <Section
        title="Paid off with no setup"
        hint="A scene card pays these off, but nothing before that scene sets them up. Mark the scene that does under Sets up on its card, or write the setup in."
      >
        {report.noSetup.length ? (
          <ul className="ck-threads">
            {report.noSetup.map((t, i) => {
              const at = places.ofScene(t.sceneId) ?? 0
              return (
                <li key={t.entryId} className="ck-thread" style={{ '--i': i } as React.CSSProperties}>
                  <div className="ck-thread-words">
                    <button type="button" onClick={() => openThread(t.entryId)} title="Open this plot thread" className="ck-thread-name">
                      {t.name}
                    </button>
                    <p className="ck-thread-meta">
                      Paid off in{' '}
                      <SceneLink storyId={storyId} sceneId={t.sceneId}>
                        {t.label}
                      </SceneLink>
                    </p>
                  </div>
                  <ThreadString count={places.count} from={at} to={at} knot={at} open={false} />
                </li>
              )
            })}
          </ul>
        ) : (
          <None>Every payoff has a setup before it.</None>
        )}
      </Section>
    </div>
  )
}

function SceneLink({ storyId, sceneId, children }: { storyId: ID; sceneId: ID; children: ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={() => openWords(sceneId, storyId, '')} title="Open this scene" className="ck-link">
      {children}
      <ArrowUpRight size={11} aria-hidden />
    </button>
  )
}
