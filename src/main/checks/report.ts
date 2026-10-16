// The critic's report for each scene (Adam, 2026-10-04): what the latest check of a scene looked at, what was good
// and where there were issues, one item per check, shown collapsed in the Issues tab. Kept in the world's `meta`
// under 'check_reports', by scene (only the latest), so it goes with the world. No Electron imports.
import type Database from 'better-sqlite3'
import type { CheckKind, CheckReport, CheckReportItem, ContractCheck } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { now } from '../util'

type DB = Database.Database

const META_KEY = 'check_reports'

function load(db: DB): Record<ID, CheckReport> {
  try {
    const v = JSON.parse(repo.getMeta(db, META_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<ID, CheckReport>) : {}
  } catch {
    return {}
  }
}

export const checkReport = (db: DB, sceneId: ID): CheckReport | null => load(db)[sceneId] ?? null

/**
 * The items of a reply's "checked" list, for the checks asked: one each, the parts of a long scene put together
 * (a check is good only when every part found it so). A check the reply didn't mention says only whether it found
 * anything.
 */
export function reportItems(checks: CheckKind[], said: Record<string, unknown>[], foundBy: Map<CheckKind, number>): CheckReportItem[] {
  return checks.map((check) => {
    const mine = said.filter((x) => x.check === check)
    const found = foundBy.get(check) ?? 0
    const notes = [...new Set(mine.map((x) => (typeof x.note === 'string' ? x.note.replace(/\s+/g, ' ').trim() : '')).filter(Boolean))]
    const ok = found === 0 && mine.every((x) => x.ok !== false)
    const note =
      notes.join(' ').slice(0, 500) ||
      (found ? `Found ${found === 1 ? '1 thing' : `${found} things`} to look at.` : 'Nothing to report.')
    return { check, ok, note }
  })
}

/**
 * Keeps a scene's latest report (replacing the one before). How the latest draft kept to its scene's contract (fix 13)
 * stays with it unless this report has its own: the critic after a draft doesn't check the contract again.
 */
export function saveReport(db: DB, report: Omit<CheckReport, 'at'>): void {
  const all = load(db)
  const contract = report.contract ?? all[report.sceneId]?.contract
  all[report.sceneId] = { ...report, at: now(), ...(contract ? { contract } : {}) }
  repo.setMeta(db, META_KEY, JSON.stringify(all))
}

/**
 * Keeps how a draft kept to its scene's contract (long story memory fix 13) with the scene's report, in place of the
 * one before; a scene with no report yet gets one with only this (no checks, nothing else found).
 */
export function saveContractCheck(db: DB, sceneId: ID, contract: ContractCheck): void {
  const all = load(db)
  const was = all[sceneId]
  all[sceneId] = was ? { ...was, contract } : { sceneId, at: contract.at, after: 'draft', items: [], found: 0, contract }
  repo.setMeta(db, META_KEY, JSON.stringify(all))
}
