// The critic's report at the top of the Issues tab (Adam, 2026-10-04): what the latest check of the scene looked at,
// what was good and where there were issues, one line per check. Collapsed by default: a line saying when it was
// checked and how it went; opened, each check with what it compared. Comes back after every check (a draft landing,
// Mark done, or Check this scene).
import { useEffect, useState } from 'react'
import type { CheckReport } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck } from '@/components/ui/icons'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { CHECK_WORDS, reportHeadline } from './issuesLogic'

export function CheckReportCard({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const [report, setReport] = useState<CheckReport | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    const load = (): void =>
      void api
        .getCheckReport(sceneId)
        .then((r) => live && setReport(r))
        .catch(() => undefined)
    load()
    // A check of this scene ended (any kind): its report may be new.
    const off = onEvent('checks:done', () => load())
    return () => {
      live = false
      off()
    }
  }, [sceneId])

  if (!report) return null
  return (
    <section aria-label="Check report" className="px-4 pb-2" data-check-report>
      <div className="rounded-lg border border-line bg-surface">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-muted hover:text-fg"
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <span className="min-w-0 flex-1">{reportHeadline(report)}</span>
        </button>
        {open ? (
          <ul className="flex flex-col gap-2 border-t border-line px-3 py-2.5 animate-fade-in">
            {report.items.map((item) => (
              <li key={item.check} className="flex gap-2 text-[12.5px] leading-relaxed" data-report-check={item.check}>
                {item.ok ? (
                  <CircleCheck size={14} aria-label="Good" className="mt-0.5 shrink-0 text-success" />
                ) : (
                  <CircleAlert size={14} aria-label="Issues" className="mt-0.5 shrink-0 text-danger" />
                )}
                <span className="min-w-0">
                  <span className={cn('font-medium', item.ok ? 'text-fg' : 'text-danger')}>{CHECK_WORDS[item.check]}</span>
                  <span className="text-muted"> · {item.note}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
