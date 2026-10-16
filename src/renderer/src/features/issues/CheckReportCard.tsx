// The critic's report at the top of the Issues tab (Adam, 2026-10-04): what the latest check of the scene looked at,
// what was good and where there were issues, one line per check. Collapsed by default: a line saying when it was
// checked and how it went; opened, each check with what it compared. Comes back after every check (a draft landing,
// Mark done, or Check this scene). Since long story memory fix 13 it also says how the latest draft kept to its scene's
// contract, item by item (from the check as the draft landed, or the chapter writer's checks).
import { useEffect, useState } from 'react'
import type { CheckReport } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck } from '@/components/ui/icons'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { CHECK_WORDS, CONTRACT_DETAIL, CONTRACT_PART_WORDS, CONTRACT_RESULT_WORDS, CONTRACT_WORDS, contractNote, contractOk, reportHeadline } from './issuesLogic'

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
    // A draft checked against its scene's contract as it landed says so as the scene's issues changing (fix 13).
    const offIssues = onEvent('issues:changed', (p) => {
      if (p.sceneIds.includes(sceneId)) load()
    })
    return () => {
      live = false
      off()
      offIssues()
    }
  }, [sceneId])

  if (!report) return null
  const contract = report.contract
  const kept = contract ? contractOk(contract) : true
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
            {contract ? (
              <li className="flex gap-2 text-[12.5px] leading-relaxed" data-report-check="contract">
                {kept ? (
                  <CircleCheck size={14} aria-label="Good" className="mt-0.5 shrink-0 text-success" />
                ) : (
                  <CircleAlert size={14} aria-label="Issues" className="mt-0.5 shrink-0 text-danger" />
                )}
                <span className="min-w-0">
                  <span className={cn('font-medium', kept ? 'text-fg' : 'text-danger')} title={CONTRACT_DETAIL}>
                    {CONTRACT_WORDS}
                  </span>
                  <span className="text-muted"> · {contractNote(contract)}</span>
                  <ul className="mt-1 flex flex-col gap-0.5" aria-label="The scene contract, item by item">
                    {contract.items.map((i, n) => (
                      <li key={n} className="text-[12px] text-muted" data-contract-result={i.result}>
                        <span className={i.result === 'broken' || i.result === 'not yet' ? 'text-danger' : 'text-faint'}>
                          {CONTRACT_RESULT_WORDS[i.result]}
                        </span>
                        <span className="text-faint"> · {CONTRACT_PART_WORDS[i.part]} · </span>
                        {i.text}
                      </li>
                    ))}
                  </ul>
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
