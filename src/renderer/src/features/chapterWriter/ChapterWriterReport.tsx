// "Written with AI" on a chapter's card: the way in to Write this chapter with AI, and the latest run's report: how it
// ended, the things in the scene cards that didn't fit the memory (for Adam: his cards are never changed), what was
// fixed in each scene and why, findings the AI judged not a problem (with its reasons; they are Ignored in the Issues
// tab, where they can be reopened), anything left, and the brief the scenes were written to. Undo puts the chapter back.

import { useEffect, useState } from 'react'
import type { ChapterWriterReport as Report } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { costWords, fixedCount, reportHeading } from './chapterWriterLogic'
import { openChapterWriter, undoChapterWriter, useChapterWriter } from './chapterWriterStore'

const details = 'rounded-md text-[12.5px] leading-relaxed text-muted [&>summary]:cursor-pointer [&>summary]:rounded [&>summary]:font-medium [&>summary]:text-fg [&>summary]:outline-none [&>summary:focus-visible]:ring-2 [&>summary:focus-visible]:ring-accent/40'

export function ChapterWriterReport({ chapterId }: { chapterId: ID }): React.JSX.Element {
  const rev = useChapterWriter((s) => s.reportRev)
  const running = useChapterWriter((s) => s.progress)
  const [report, setReport] = useState<Report | null | undefined>(undefined)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    let live = true
    api
      .getChapterWriterReport(chapterId)
      .then((r) => live && setReport(r))
      .catch(() => live && setReport(null))
    return () => {
      live = false
    }
  }, [chapterId, rev])

  const here = running?.chapterId === chapterId
  const busy = !!running
  const undo = async (): Promise<void> => {
    setUndoing(true)
    try {
      await undoChapterWriter(chapterId)
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="chapter-writer-report">
      <p className="text-[12.5px] leading-relaxed text-muted">
        {here
          ? 'The AI is writing this chapter now. Its scenes can be read but not typed in until it finishes.'
          : 'The AI writes every scene from its card, then checks the chapter against the memory, fixes what it finds and proofreads, until it is clean.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => openChapterWriter(chapterId)}>
          {report ? 'Write it again with AI…' : 'Write this chapter with AI…'}
        </Button>
        {report && !report.undone && report.status !== 'running' && !here ? (
          <Button size="sm" variant="ghost" loading={undoing} onClick={() => void undo()}>
            Undo
          </Button>
        ) : null}
      </div>
      {report && !here ? <ReportBody report={report} /> : null}
    </div>
  )
}

function ReportBody({ report }: { report: Report }): React.JSX.Element {
  const fixed = fixedCount(report)
  const setAside = report.scenes.reduce((k, s) => k + s.setAside.length, 0)
  const spent = costWords(report.cost).replace(/ so far$/, '')
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <p className="text-[13px] font-medium text-fg">{reportHeading(report)}</p>
      <p className="text-[12px] text-faint">
        {[fixed ? `${fixed} ${fixed === 1 ? 'thing' : 'things'} fixed` : '', setAside ? `${setAside} judged not a problem` : '', spent ? `cost ${spent}` : '']
          .filter(Boolean)
          .join(' · ')}
      </p>
      {report.message && report.status !== 'done' && report.status !== 'stuck' ? <p className="text-[12.5px] leading-relaxed text-muted">{report.message}</p> : null}
      {report.left.length ? (
        <details className={details} open>
          <summary>Still open ({report.left.length})</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {report.left.map((l, i) => (
              <li key={i}>{l.replace(/^F\d+ \[/, '[')}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {report.questions.length ? (
        <details className={details} open>
          <summary>Your scene cards and the memory ({report.questions.length})</summary>
          <p className="mt-1 text-faint">Your cards weren’t changed. The scenes were written to keep to the memory instead.</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {report.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {report.scenes.map((s) =>
        s.fixed.length || s.setAside.length || s.rewritten.length ? (
          <details key={s.sceneId} className={details}>
            <summary>
              {s.label}: {[s.rewritten.length ? 'written again' : '', s.fixed.length ? `${s.fixed.length} fixed` : '', s.setAside.length ? `${s.setAside.length} set aside` : '']
                .filter(Boolean)
                .join(', ')}
            </summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {s.rewritten.map((w, i) => (
                <li key={`r${i}`}>Written again: {w}</li>
              ))}
              {s.fixed.map((f, i) => (
                <li key={`f${i}`}>{f.why}</li>
              ))}
              {s.setAside.map((x, i) => (
                <li key={`s${i}`}>
                  Not a problem: {x.finding} <span className="text-faint">({x.why})</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null
      )}
      {report.brief ? (
        <details className={details}>
          <summary>The brief the scenes were written to</summary>
          <p className="mt-1.5 whitespace-pre-wrap">{report.brief}</p>
        </details>
      ) : null}
    </div>
  )
}
