// The critic's report for each scene (Adam, 2026-10-04): what the latest check of a scene looked at, what was good
// and where there were issues, one item per check, shown collapsed in the Issues tab. Kept in the world's `meta`
// under 'check_reports', by scene (only the latest), so it goes with the world. Since findings that stay current
// (2026-10-16) it keeps a fingerprint of the words the checks read, so the tab can say when the scene has changed since,
// and the scene's latest contract as checked, so a later check of the whole scene can go through it again. No Electron
// imports.
import type Database from 'better-sqlite3'
import type { CheckKind, CheckReport, CheckReportItem, ContractCheck } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import type { SceneContract } from '../ai/contract'
import * as repo from '../db/repo'
import { hashText } from '../keeper/text'
import { now } from '../util'

type DB = Database.Database

const META_KEY = 'check_reports'

/**
 * The reports as last read, per world, by the stored text (the tab asks every few seconds while it shows). Never changed
 * in place: a save writes a new map with new reports in it.
 */
const read = new WeakMap<DB, { raw: string; all: Readonly<Record<ID, CheckReport>> }>()

function load(db: DB): Readonly<Record<ID, CheckReport>> {
  const raw = repo.getMeta(db, META_KEY) ?? '{}'
  const was = read.get(db)
  if (was && was.raw === raw) return was.all
  let all: Record<ID, CheckReport> = {}
  try {
    const v = JSON.parse(raw) as unknown
    all = v && typeof v === 'object' ? (v as Record<ID, CheckReport>) : {}
  } catch {
    all = {}
  }
  read.set(db, { raw, all })
  return all
}

export const checkReport = (db: DB, sceneId: ID): CheckReport | null => load(db)[sceneId] ?? null

/** A fingerprint of a scene's words, as a report keeps it. */
export const reportHash = (text: string): string => hashText(text)

/**
 * The scene's latest report with `changed`: true when the scene's words are no longer those its checks read (a report
 * kept before fingerprints, or one with only the contract checked as a draft landed, never says so).
 */
export function checkReportNow(db: DB, sceneId: ID): CheckReport | null {
  const r = checkReport(db, sceneId)
  if (!r) return null
  if (!r.textHash) return r
  const row = db.prepare('SELECT text FROM scenes WHERE id = ?').get(sceneId) as { text?: string } | undefined
  return { ...r, changed: reportHash(row?.text ?? '') !== r.textHash }
}

/**
 * The scene's latest check read its words as they are now, with these checks at least, and no scene before it in its
 * story has been written in (or had its card changed) since: checking it again would find the same, so it isn't paid for
 * twice (token audit, 2026-10-19). False with no such report: one kept before fingerprints, or a check cut short or
 * stopped, keeps none.
 */
export function checkedAsIs(db: DB, sceneId: ID, checks: readonly CheckKind[]): boolean {
  try {
    const r = checkReportNow(db, sceneId)
    if (!r?.textHash || r.changed !== false || !checks.every((c) => r.items.some((i) => i.check === c))) return false
    const scenes = repo.getOutline(db, repo.sceneLocation(db, sceneId).story.id).scenes
    const at = scenes.findIndex((s) => s.id === sceneId)
    return at >= 0 && scenes.slice(0, at).every((s) => s.updatedAt < r.at)
  } catch {
    return false
  }
}

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
 * stays with it unless this report has its own: the critic after a draft doesn't check the contract again. `contract:
 * null` takes it away (contracts switched off). `textHash`: the fingerprint of the words the checks read.
 */
export function saveReport(db: DB, report: Omit<CheckReport, 'at' | 'contract' | 'changed'> & { contract?: ContractCheck | null }): void {
  const all = { ...load(db) }
  const { contract: own, ...rest } = report
  const contract = own === null ? undefined : (own ?? all[report.sceneId]?.contract)
  all[report.sceneId] = { ...rest, at: now(), ...(contract ? { contract } : {}) }
  repo.setMeta(db, META_KEY, JSON.stringify(all))
}

/**
 * Keeps how a draft kept to its scene's contract (long story memory fix 13) with the scene's report, in place of the
 * one before; a scene with no report yet gets one with only this (no checks, nothing else found).
 */
export function saveContractCheck(db: DB, sceneId: ID, contract: ContractCheck): void {
  const all = { ...load(db) }
  const was = all[sceneId]
  all[sceneId] = was ? { ...was, contract } : { sceneId, at: contract.at, after: 'draft', items: [], found: 0, contract }
  repo.setMeta(db, META_KEY, JSON.stringify(all))
}

const CHECKS: CheckKind[] = ['facts', 'knowledge', 'timeline', 'continuity', 'voice', 'style']

/**
 * The scene's latest contract, as its latest draft was checked against it (findings that stay current, 2026-10-16):
 * what Check this scene and Mark done go through again, as the chapter writer does, so what a check through it found (a
 * "not shown yet" question) can be settled. Null when none was checked. An item kept before its code and check were
 * kept is read as a fact about no one in particular.
 */
export function savedContract(db: DB, sceneId: ID): SceneContract | null {
  const c = checkReport(db, sceneId)?.contract
  if (!c || !Array.isArray(c.items) || !c.items.length) return null
  const items = c.items
    .filter((i) => i && typeof i.text === 'string' && i.text.trim() && ['start', 'change', 'keep'].includes(i.part))
    .map((i, n) => ({
      code: typeof i.code === 'string' && i.code ? i.code : `C${n + 1}`,
      part: i.part,
      text: i.text,
      check: i.check && CHECKS.includes(i.check) ? i.check : ('facts' as CheckKind),
      entryIds: Array.isArray(i.entryIds) ? i.entryIds.filter((x): x is ID => typeof x === 'string') : []
    }))
  return items.length ? { asks: c.asks, items } : null
}
