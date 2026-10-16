// All SQL for consistency issues (milestone 5, AI checks part): reading `issues` rows as the contract's
// Issue, a scene's and a story's issues, open counts for the binder's badges, status changes, saving what a
// check found, and marking issues whose words have gone. The table is migration 2's, unchanged: everything
// beyond its columns is in `payload_json`. Pure functions over a better-sqlite3 handle, no Electron imports.
//
// Rows come from three places, and all read the same way:
// - the memory keeper's clashes with Adam's facts: { entryId, field, memory, text, key };
// - the world builder's, the same plus from: 'summary', with scene '' (story-wide);
// - the AI checks': { key, by: 'check', check, sources, fix, memoryFix, entryId, field };
// - the free rule checks' (long story memory fix 8, checks/ruleChecks.ts): { key, by: 'rule', rule, sources, entryId,
//   field }.
// A clash with one of Adam's own fields can be settled by updating the memory (memoryFix): the field
// takes the text's value, as his.

import type Database from 'better-sqlite3'
import type { CheckKind, Issue, IssueKind, IssueSeverity, IssueSource, IssueStatus } from '@shared/contracts/checks'
import type { ID, Origin } from '@shared/types'
import { newId, now } from '../util'
import { quoteAt, quotesOverlap, stillThere } from '../checks/quote'
import { memoryFixable } from '../checks/memoryFix'
import { hashText, plain, sceneParagraphs } from '../keeper/text'
import { isSlopKey } from '@shared/liveChecks'

type DB = Database.Database
type Row = Record<string, unknown>

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || s === '') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

/** What an issue's payload_json may hold (each source of rows fills its own part). */
export interface IssuePayload {
  key?: string
  /** The entry and field it is about (the keeper's and the world builder's, and the checks' too, so each can tell they are the same). */
  entryId?: ID
  field?: string | null
  /** The keeper's: what the memory says, and what the text says. */
  memory?: string
  text?: string
  /** The world builder's: found in Adam's summary of the world. */
  from?: 'summary'
  /** The AI checks' ('check'), or the free rule checks' ('rule': long story memory fix 8, no AI asked). */
  by?: 'check' | 'rule'
  check?: CheckKind | 'story'
  /** Which rule found it (checks/rules.ts RuleId). */
  rule?: string
  sources?: IssueSource[]
  fix?: string | null
  /** The critic's suggestion in a sentence, when a rewrite of the quote alone can't fix it. */
  advice?: string
  memoryFix?: Issue['memoryFix']
  /** A story issue: the other story it was compared with. */
  otherStoryId?: ID
  /** Which of the quote's appearances in the scene it is (0 for the first), when it was found by a check. */
  occurrence?: number
  /**
   * Where the words are (findings that stay current, 2026-10-16): the editor's id of the paragraph they are in and which
   * of their places in it (0 for the first). Kept by the sweep, so the issue follows its own words when text before them
   * changes, and goes when that paragraph no longer has them.
   */
  at?: { pid: string; n: number }
  /**
   * Put off with Later: hidden until the next check of the scene, or until the paragraph its words are in changes
   * (`words`, a fingerprint of that paragraph then; none for an issue with no words to point at).
   */
  later?: { since: string; words?: string }
  /** Settled by Update the memory (the text was right): never a slip later scenes are warned of (checks/lessons.ts). */
  fixedBy?: 'memory'
  /**
   * Found by checking a draft against its scene's contract (long story memory fix 13): which list the item was in and its
   * words. Only a check that went through the contract replaces such a row (checks/run.ts).
   */
  contract?: {
    part: 'start' | 'change' | 'keep'
    text: string
    /**
     * Something the words go against that a second opinion agreed with (fix 13's review): only such an item may be put
     * right without asking (the chapter writer's review; chapterWriter/run.ts issueFindings).
     */
    confirmed?: true
    /** Something that must change the words don't show yet: asked, never written in by itself. */
    missing?: true
  }
}

// ---------- Telling the window ----------

type Touched = (storyId: ID | null, sceneIds: ID[]) => void
let listener: Touched | null = null
const pending = new Map<string, Set<ID>>()
let timer: ReturnType<typeof setTimeout> | null = null

/** Who hears that issues changed (the checks part, which tells the window). One listener. */
export function onIssuesTouched(fn: Touched | null): void {
  listener = fn
}

/**
 * Notes that a scene's (or a story's) issues changed. Told together a moment later, after the
 * transaction that changed them, so the window reads them once.
 */
export function issuesTouched(storyId: ID | null | undefined, sceneId: ID | null | undefined): void {
  if (!listener) return
  const key = storyId || ''
  const set = pending.get(key) ?? new Set<ID>()
  if (sceneId) set.add(sceneId)
  pending.set(key, set)
  timer ??= setTimeout(() => {
    timer = null
    const all = [...pending]
    pending.clear()
    for (const [story, scenes] of all) listener?.(story || null, [...scenes])
  }, 0)
}

// ---------- Reading rows as issues ----------

/** What reading an issue needs to know beyond its row: entries' names and who wrote their fields, places in plain words. */
export interface IssueNames {
  entry(id: ID): { name: string; kind: string; isAdams: (field: string) => boolean; value: (field: string) => string } | null
  sceneLabel(id: ID): string | null
  storyTitle(id: ID): string | null
}

const SEVERITIES: IssueSeverity[] = ['must-fix', 'warning', 'minor']
const STATUSES: IssueStatus[] = ['open', 'ignored', 'fixed', 'gone']

/** Who wrote an entry's field: its own origin unless the field says otherwise. */
export const fieldOriginOf = (origin: Origin, fieldOrigins: Record<string, Origin>, field: string): Origin => fieldOrigins[field] ?? origin

/** Brings a stored source's name up to date (an entry renamed since, a scene moved), keeping the stored words if it has gone. */
function freshSource(s: IssueSource, names: IssueNames): IssueSource {
  switch (s.kind) {
    case 'entry':
    case 'thread':
      return { ...s, name: names.entry(s.entryId)?.name ?? s.name }
    case 'scene':
      return { ...s, label: names.sceneLabel(s.sceneId) ?? s.label }
    case 'story':
      return { ...s, title: names.storyTitle(s.storyId) ?? s.title }
  }
}

/** An issue row as the contract's Issue. */
export function readIssue(r: Row, names: IssueNames): Issue {
  const p = json<IssuePayload>(r.payload_json, {})
  const entry = p.entryId ? names.entry(p.entryId) : null
  let sources: IssueSource[]
  if (Array.isArray(p.sources)) sources = p.sources.filter((s) => s && typeof s === 'object').map((s) => freshSource(s, names))
  else sources = p.entryId && entry ? [{ kind: 'entry', entryId: p.entryId, name: entry.name, field: p.field ?? null }] : []
  // The keeper's and the world builder's clashes with one of Adam's own fields: the text's value can become his.
  let memoryFix = p.memoryFix ?? null
  // Only for a short value of a one-line field, and only while the memory's value was his note itself (not
  // something an earlier scene's change set).
  if (
    p.memoryFix === undefined &&
    p.entryId &&
    entry &&
    p.field &&
    memoryFixable(entry.kind, p.field, p.text) &&
    entry.isAdams(p.field) &&
    (p.memory === undefined || plain(p.memory) === plain(entry.value(p.field)))
  ) {
    memoryFix = { entryId: p.entryId, field: p.field, value: (p.text ?? '').trim() }
  }
  const severity = r.severity as IssueSeverity
  const status = r.status as IssueStatus
  return {
    id: r.id as ID,
    sceneId: (r.scene_id as string) || null,
    storyId: (r.story_id as string) || null,
    kind: r.kind as IssueKind,
    severity: SEVERITIES.includes(severity) ? severity : 'warning',
    status: STATUSES.includes(status) ? status : 'open',
    quote: (r.quote as string) ?? '',
    message: (r.message as string) ?? '',
    sources,
    fix: typeof p.fix === 'string' && p.fix.trim() ? p.fix : null,
    ...(typeof p.advice === 'string' && p.advice.trim() ? { advice: p.advice } : {}),
    memoryFix,
    ...(typeof p.occurrence === 'number' ? { occurrence: p.occurrence } : {}),
    // An ignored common AI phrase is a phrase row: the Issues tab names it as what it is.
    ...(r.kind === 'phrase' && typeof p.key === 'string' && isSlopKey(p.key) ? { aiPhrase: true as const } : {}),
    ...(p.by === 'rule' ? { byRule: true as const } : {}),
    ...(p.contract ? { byContract: true as const } : {}),
    ...(p.later && status === 'open' ? { later: true as const } : {}),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }
}

/** What reading an issue needs of an entry: its name and kind, who wrote each field, and the fields' values. */
export interface EntryFacts {
  name: string
  kind: string
  origin: Origin
  fieldOrigins: Record<string, Origin>
  value: (field: string) => string
}

/** Entries' names, kinds, who wrote each field and the values, for the entries these rows name (one query). */
export function entryNamesFor(db: DB, rows: Row[]): Map<ID, EntryFacts> {
  const ids = new Set<ID>()
  for (const r of rows) {
    const p = json<IssuePayload>(r.payload_json, {})
    if (p.entryId) ids.add(p.entryId)
    for (const s of p.sources ?? []) if (s && (s.kind === 'entry' || s.kind === 'thread')) ids.add(s.entryId)
  }
  const out = new Map<ID, EntryFacts>()
  if (!ids.size) return out
  const list = [...ids]
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500)
    const got = db
      .prepare(
        `SELECT id, name, kind, origin, field_origins_json, summary, description, fields_json FROM entries WHERE id IN (${part.map(() => '?').join(',')})`
      )
      .all(...part) as Row[]
    for (const e of got) {
      const fields = json<Record<string, string>>(e.fields_json, {})
      out.set(e.id as ID, {
        name: e.name as string,
        kind: e.kind as string,
        origin: ((e.origin as Origin) || 'adam') as Origin,
        fieldOrigins: json<Record<string, Origin>>(e.field_origins_json, {}),
        value: (field) =>
          field === 'summary' ? ((e.summary as string) ?? '') : field === 'description' ? ((e.description as string) ?? '') : (fields[field] ?? '')
      })
    }
  }
  return out
}

/** Every story's title, by id. */
export function storyTitles(db: DB): Map<ID, string> {
  return new Map((db.prepare('SELECT id, title FROM stories').all() as Row[]).map((r) => [r.id as ID, r.title as string]))
}

// ---------- Lists and counts ----------

/**
 * Kinds the live checks keep as rows only for what Adam ignored (milestone 5, Live checks part): never an
 * open issue, never counted. Reopening one deletes its row, as unignoreLive does.
 */
export const LIVE_KINDS = ['phrase', 'repetition', 'spelling'] as const
const LIVE_SQL = "('phrase', 'repetition', 'spelling')"
export const isLiveKind = (kind: unknown): boolean => (LIVE_KINDS as readonly unknown[]).includes(kind)

const RANK: Record<string, number> = { 'must-fix': 0, warning: 1, minor: 2 }
const STATUS_RANK: Record<string, number> = { open: 0, ignored: 1, fixed: 2, gone: 3 }

/** Open first (must fix first, then in reading order), then ignored, then fixed; newest last within each. */
export function sortIssues(rows: Row[], textOf: (sceneId: ID) => string): Row[] {
  const at = new Map<Row, number>()
  for (const r of rows) at.set(r, r.scene_id ? quoteAt(textOf(r.scene_id as ID), (r.quote as string) ?? '') : Infinity)
  return [...rows].sort(
    (a, b) =>
      (STATUS_RANK[a.status as string] ?? 9) - (STATUS_RANK[b.status as string] ?? 9) ||
      (RANK[a.severity as string] ?? 9) - (RANK[b.severity as string] ?? 9) ||
      (at.get(a)! === at.get(b)! ? 0 : at.get(a)! < at.get(b)! ? -1 : 1) ||
      String(a.created_at).localeCompare(String(b.created_at))
  )
}

/** A scene's issues (not those whose words have gone), unsorted. */
export function sceneIssueRows(db: DB, sceneId: ID): Row[] {
  return db
    .prepare(`SELECT * FROM issues WHERE scene_id = ? AND status <> 'gone' AND (kind NOT IN ${LIVE_SQL} OR status = 'ignored')`)
    .all(sceneId) as Row[]
}

/** A story's issues: its scenes' (live scenes only) and its story-wide ones, not those whose words have gone. */
export function storyIssueRows(db: DB, storyId: ID): Row[] {
  return db
    .prepare(
      `SELECT i.* FROM issues i
       WHERE i.status <> 'gone' AND (i.kind NOT IN ${LIVE_SQL} OR i.status = 'ignored') AND (
         i.scene_id IN (SELECT sc.id FROM scenes sc JOIN chapters c ON c.id = sc.chapter_id
                        WHERE c.story_id = ? AND sc.deleted_at IS NULL AND c.deleted_at IS NULL)
         OR ((i.scene_id IS NULL OR i.scene_id = '') AND i.story_id = ?))`
    )
    .all(storyId, storyId) as Row[]
}

/** A row put off with Later (its payload's `later`), as SQL. */
const LATER_ROW = "(json_valid(i.payload_json) AND json_extract(i.payload_json, '$.later') IS NOT NULL)"

/** Open issues per live scene in a story, with how many must be fixed (not those put off with Later). Scenes with none are left out. */
export function openCounts(db: DB, storyId: ID): Record<ID, { count: number; mustFix: number }> {
  const rows = db
    .prepare(
      `SELECT i.scene_id AS scene_id, COUNT(*) AS n, SUM(CASE WHEN i.severity = 'must-fix' THEN 1 ELSE 0 END) AS m
       FROM issues i JOIN scenes sc ON sc.id = i.scene_id JOIN chapters c ON c.id = sc.chapter_id
       WHERE i.status = 'open' AND i.kind NOT IN ${LIVE_SQL} AND NOT ${LATER_ROW} AND c.story_id = ? AND sc.deleted_at IS NULL AND c.deleted_at IS NULL
       GROUP BY i.scene_id`
    )
    .all(storyId) as Row[]
  const out: Record<ID, { count: number; mustFix: number }> = {}
  for (const r of rows) out[r.scene_id as ID] = { count: Number(r.n) || 0, mustFix: Number(r.m) || 0 }
  return out
}

/** The text of these scenes (live or in Recently deleted), by id. */
export function sceneTexts(db: DB, sceneIds: ID[]): Map<ID, string> {
  const out = new Map<ID, string>()
  const ids = [...new Set(sceneIds)]
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500)
    for (const r of db.prepare(`SELECT id, text FROM scenes WHERE id IN (${part.map(() => '?').join(',')})`).all(...part) as Row[]) {
      out.set(r.id as ID, (r.text as string) ?? '')
    }
  }
  return out
}

// ---------- Findings that stay current (2026-10-16) ----------
// Every save of a scene sweeps its issues (ipc/core.ts saveSceneText), as listing them does: an open issue whose words
// have gone becomes 'gone'; one found at a place (`occurrence`) follows its own words, by the paragraph they are in
// (`at`), so fixing one of two identical phrases settles only the issue about that one; a row the sweep put away comes
// back when its words do (Ctrl+Z); and Later lasts until the paragraph its words are in changes. Ignored and fixed ones
// are never touched.

/** A scene's words as the sweep reads them: each paragraph made plain, with the editor's id when every paragraph has one. */
export interface SweepPage {
  text: string
  paras: { pid: string | null; plain: string }[]
  /** True when every paragraph has an editor id (so an issue can follow its paragraph). */
  ids: boolean
}

export function sweepPage(doc: unknown, text: string): SweepPage {
  const ps = sceneParagraphs(doc, text)
  return { text, paras: ps.map((p) => ({ pid: p.pid, plain: plain(p.text) })), ids: ps.length > 0 && ps.every((p) => !!p.pid) }
}

/** Quotation marks a model wraps the words in (as checks/quote.ts). */
const WRAP = /^["“”'‘’«»]+|["“”'‘’«»]+$/g

/** How many times the needle is in the text, overlaps counted, as the page counts them (issuesLogic.ts occurrencesIn). */
function countIn(hay: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n++
  return n
}

/** Where an issue's words are now: their place among the scene's appearances, their paragraph, and its plain words. */
export interface Place {
  occurrence?: number
  at?: { pid: string; n: number }
  /** The plain words of the paragraph they are in (Later comes back when it changes). */
  para?: string
}

/**
 * Where an issue's words are in the page now, or null when they have gone. An issue found at a place (`occurrence`) is
 * about that one appearance: it has gone when the paragraph it was in no longer has it (or has fewer of it than its
 * place there needs), or, with no paragraph to go by, when the scene has fewer appearances than its place needs. Other
 * issues' words count anywhere in the scene. `strict` (bringing back a row the sweep put away): only in the paragraph it
 * was in, when that is known.
 */
export function placeNow(page: SweepPage, quote: string, p: Pick<IssuePayload, 'occurrence' | 'at'>, strict = false): Place | null {
  let needle = plain(quote)
  let counts = page.paras.map((x) => countIn(x.plain, needle))
  let total = counts.reduce((a, b) => a + b, 0)
  if (!total) {
    needle = plain(quote.replace(WRAP, ''))
    counts = page.paras.map((x) => countIn(x.plain, needle))
    total = counts.reduce((a, b) => a + b, 0)
  }
  // Words that run across two paragraphs: still there, with nowhere to pin them.
  if (!total) return stillThere(page.text, quote) ? {} : null
  const before = (i: number): number => counts.slice(0, i).reduce((a, b) => a + b, 0)
  const at = (i: number, n: number): Place => ({
    ...(typeof p.occurrence === 'number' ? { occurrence: before(i) + n } : {}),
    ...(page.ids && page.paras[i].pid ? { at: { pid: page.paras[i].pid!, n } } : {}),
    para: page.paras[i].plain
  })
  const placed = typeof p.occurrence === 'number'
  const first = counts.findIndex((c) => c > 0)
  if (p.at && page.ids) {
    const i = page.paras.findIndex((x) => x.pid === p.at!.pid)
    const n = placed ? p.at.n : 0
    if (i >= 0 && counts[i] > n) return at(i, n)
    if (strict) return null
    // Its paragraph no longer has it: one found at a place has gone (unless it is the scene's only appearance, in a
    // paragraph two were joined into); the rest count anywhere.
    if (placed && !(i < 0 && total === 1)) return null
    return at(first, 0)
  }
  if (placed) {
    const occ = p.occurrence!
    if (total <= occ) return null
    let i = 0
    while (before(i) + counts[i] <= occ) i++
    return at(i, occ - before(i))
  }
  return at(first, 0)
}

/** Sorted keys, so two payloads with the same contents read the same whatever order their fields were added in. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

const samePayload = (a: IssuePayload, b: IssuePayload): boolean => stableJson(a) === stableJson(b)

/** A fingerprint of a paragraph's plain words (Later). */
const wordsPrint = (para: string): string => hashText(para)

/**
 * Sweeps one scene's issues against its words (`page`, the doc and text just saved; read from the scene when left out):
 * open ones whose words have gone become 'gone'; the rest follow their words (`occurrence`, `at`) and come back from
 * Later when their paragraph changed; ones the sweep put away come back when their words are back in the paragraph they
 * were in (never one Adam ignored or fixed, and never beside one about the same thing). Returns the scenes whose issues
 * changed. Cheap: nothing is read when the scene has no quoted issues open, put away or put off.
 */
function sweepScene(db: DB, sceneId: ID, given?: { doc: unknown; text: string }): ID[] {
  const rows = db
    .prepare(`SELECT * FROM issues WHERE scene_id = ? AND kind NOT IN ${LIVE_SQL} AND status IN ('open', 'gone') AND quote <> ''`)
    .all(sceneId) as Row[]
  if (!rows.length) return []
  let page: SweepPage
  if (given) page = sweepPage(given.doc, given.text)
  else {
    const s = db.prepare('SELECT doc_json, text FROM scenes WHERE id = ?').get(sceneId) as Row | undefined
    if (!s) return sweepMissing(db, rows)
    page = sweepPage(json<unknown>(s.doc_json, null), (s.text as string) ?? '')
  }
  const t = now()
  const changes: { row: Row; status: IssueStatus; payload: IssuePayload; tell: boolean }[] = []
  // What stands in the scene (to bring nothing back beside the same thing).
  const standing = db.prepare("SELECT * FROM issues WHERE scene_id = ? AND status IN ('open', 'ignored', 'fixed')").all(sceneId) as Row[]
  for (const r of rows) {
    const quote = String(r.quote ?? '')
    if (!quote.trim()) continue
    const p = json<IssuePayload>(r.payload_json, {})
    if (r.status === 'gone') {
      const place = placeNow(page, quote, p, true)
      if (!place) continue
      const f = { key: p.key ?? '', sceneId, kind: r.kind as IssueKind, quote }
      if (standing.some((s) => (p.key && payloadOf(s).key === p.key) || (s.status !== 'fixed' && sameThing(p, s, f)))) continue
      const next: IssuePayload = { ...p, ...placed(place) }
      delete next.later
      changes.push({ row: r, status: 'open', payload: next, tell: true })
      standing.push({ ...r, status: 'open' })
      continue
    }
    const place = placeNow(page, quote, p)
    if (!place) {
      changes.push({ row: r, status: 'gone', payload: p, tell: true })
      continue
    }
    const next: IssuePayload = { ...p, ...placed(place) }
    // Put off with Later: back once the paragraph its words are in has changed.
    const back = !!p.later?.words && place.para !== undefined && wordsPrint(place.para) !== p.later.words
    if (back) delete next.later
    if (!samePayload(p, next)) changes.push({ row: r, status: 'open', payload: next, tell: back || next.occurrence !== p.occurrence })
  }
  if (!changes.length) return []
  const set = db.prepare('UPDATE issues SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?')
  db.transaction(() => {
    for (const c of changes) set.run(c.status, JSON.stringify(c.payload), c.status !== c.row.status || c.tell ? t : c.row.updated_at, c.row.id)
  })()
  const told = changes.filter((c) => c.tell || c.status !== c.row.status)
  for (const c of told) issuesTouched(c.row.story_id as ID | null, sceneId)
  return told.length ? [sceneId] : []
}

/** The fields a place sets on a payload (an occurrence only for an issue found at one). */
const placed = (place: Place): Pick<IssuePayload, 'occurrence' | 'at'> => ({
  ...(place.occurrence !== undefined ? { occurrence: place.occurrence } : {}),
  ...(place.at ? { at: place.at } : {})
})

/** A scene that no longer exists at all takes its open issues with it. */
function sweepMissing(db: DB, rows: Row[]): ID[] {
  const open = rows.filter((r) => r.status === 'open' && String(r.quote ?? '').trim())
  if (!open.length) return []
  const t = now()
  const set = db.prepare("UPDATE issues SET status = 'gone', updated_at = ? WHERE id = ? AND status = 'open'")
  db.transaction(() => {
    for (const r of open) set.run(t, r.id)
  })()
  for (const r of open) issuesTouched(r.story_id as ID | null, r.scene_id as ID)
  return [...new Set(open.map((r) => r.scene_id as ID))]
}

/**
 * Open issues whose words are no longer in their scene's text become 'gone' (a scene that no longer
 * exists at all takes its issues with it; one in Recently deleted keeps them, as it may come back).
 * Ignored and fixed ones are never touched. For one scene, the full sweep above (`page`: its doc and text
 * just saved); for a story, a cheap pass by the text alone (every save has swept its own scene already).
 * Returns the scenes whose issues changed.
 */
export function sweepGone(db: DB, where: { sceneId: ID } | { storyId: ID }, page?: { doc: unknown; text: string }): ID[] {
  if ('sceneId' in where) return sweepScene(db, where.sceneId, page)
  const rows = db
    .prepare(
      `SELECT id, scene_id, story_id, quote, payload_json FROM issues WHERE status = 'open' AND kind NOT IN ${LIVE_SQL} AND quote <> '' AND scene_id IS NOT NULL AND scene_id <> ''
       AND (story_id = ? OR scene_id IN (SELECT sc.id FROM scenes sc JOIN chapters c ON c.id = sc.chapter_id WHERE c.story_id = ?))`
    )
    .all(where.storyId, where.storyId) as Row[]
  if (!rows.length) return []
  const texts = sceneTexts(
    db,
    rows.map((r) => r.scene_id as ID)
  )
  const plainTexts = new Map<ID, string>()
  const gone = rows.filter((r) => {
    const text = texts.get(r.scene_id as ID)
    const quote = r.quote as string
    if (text === undefined || !stillThere(text, quote)) return true
    // Found at a later place than the scene now has.
    const occ = json<IssuePayload>(r.payload_json, {}).occurrence
    if (typeof occ !== 'number' || occ < 1) return false
    const id = r.scene_id as ID
    if (!plainTexts.has(id)) plainTexts.set(id, plain(text))
    const hay = plainTexts.get(id)!
    return Math.max(countIn(hay, plain(quote)), countIn(hay, plain(quote.replace(WRAP, '')))) <= occ
  })
  if (!gone.length) return []
  const t = now()
  const set = db.prepare("UPDATE issues SET status = 'gone', updated_at = ? WHERE id = ? AND status = 'open'")
  db.transaction(() => {
    for (const r of gone) set.run(t, r.id)
  })()
  const scenes = [...new Set(gone.map((r) => r.scene_id as ID))]
  for (const r of gone) issuesTouched(r.story_id as ID | null, r.scene_id as ID)
  return scenes
}

/**
 * Later: the issue is hidden until the next check of its scene, or until the paragraph its words are in changes. Returns
 * the row as it is now, or null when there is no such issue. Only an open issue can be put off.
 */
export function setLater(db: DB, id: ID): Row | null {
  const r = issueRow(db, id)
  if (!r) return null
  if (r.status !== 'open') return r
  const p = json<IssuePayload>(r.payload_json, {})
  let words: string | undefined
  const quote = String(r.quote ?? '')
  if (quote.trim() && r.scene_id) {
    const s = db.prepare('SELECT doc_json, text FROM scenes WHERE id = ?').get(r.scene_id) as Row | undefined
    const place = s ? placeNow(sweepPage(json<unknown>(s.doc_json, null), (s.text as string) ?? ''), quote, p) : null
    if (place?.para !== undefined) words = wordsPrint(place.para)
  }
  const later: NonNullable<IssuePayload['later']> = { since: now(), ...(words ? { words } : {}) }
  db.prepare('UPDATE issues SET payload_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...p, later }), now(), id)
  issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
  return issueRow(db, id)
}

/** A check of the scene ran: everything put off with Later there shows again. Returns how many came back. */
export function clearLater(db: DB, sceneId: ID): number {
  const rows = db.prepare(`SELECT id, story_id, payload_json FROM issues i WHERE scene_id = ? AND status = 'open' AND ${LATER_ROW}`).all(sceneId) as Row[]
  if (!rows.length) return 0
  const set = db.prepare('UPDATE issues SET payload_json = ?, updated_at = ? WHERE id = ?')
  const t = now()
  db.transaction(() => {
    for (const r of rows) {
      const p = json<IssuePayload>(r.payload_json, {})
      delete p.later
      set.run(JSON.stringify(p), t, r.id)
    }
  })()
  issuesTouched(rows[0].story_id as ID | null, sceneId)
  return rows.length
}

// ---------- One issue ----------

export function issueRow(db: DB, id: ID): Row | null {
  return (db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as Row | undefined) ?? null
}

/** Changes an issue's status. Returns the row as it is now, or null when there is no such issue. */
export function setIssueStatus(db: DB, id: ID, status: IssueStatus): Row | null {
  const r = issueRow(db, id)
  if (!r) return null
  if (r.status !== status) {
    db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
    issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
  }
  return issueRow(db, id)
}

/** Marks an issue fixed by Update the memory: the text was right and the memory took its value (`fixedBy`). */
export function setFixedByMemory(db: DB, id: ID): Row | null {
  const r = issueRow(db, id)
  if (!r) return null
  const p = json<IssuePayload>(r.payload_json, {})
  db.prepare("UPDATE issues SET status = 'fixed', payload_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ...p, fixedBy: 'memory' }), now(), id)
  issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
  return issueRow(db, id)
}

/**
 * Adam saved an entry by hand (findings that stay current, 2026-10-16): each open clash with one of its fields that the
 * memory now settles, because the field says what the scene says (the memory keeper's `text`, or the value Update the
 * memory would set), is fixed by the memory, as Update the memory would have done (`fixedBy`, so never a slip later
 * scenes are warned of). `value` reads the entry's fields as saved. Returns how many were settled.
 */
export function settleByEntry(db: DB, entryId: ID, value: (field: string) => string): number {
  const rows = db
    .prepare(
      `SELECT * FROM issues WHERE status = 'open' AND kind NOT IN ${LIVE_SQL} AND json_valid(payload_json)
       AND (json_extract(payload_json, '$.entryId') = ? OR json_extract(payload_json, '$.memoryFix.entryId') = ?)`
    )
    .all(entryId, entryId) as Row[]
  const settled = rows.filter((r) => {
    const p = json<IssuePayload>(r.payload_json, {})
    const fix = p.memoryFix
    if (fix && fix.entryId === entryId && fix.field && fix.value.trim()) return plain(value(fix.field)) === plain(fix.value)
    return p.entryId === entryId && !!p.field && typeof p.text === 'string' && !!p.text.trim() && plain(value(p.field)) === plain(p.text)
  })
  if (!settled.length) return 0
  const t = now()
  const set = db.prepare("UPDATE issues SET status = 'fixed', payload_json = ?, updated_at = ? WHERE id = ?")
  db.transaction(() => {
    for (const r of settled) set.run(JSON.stringify({ ...json<IssuePayload>(r.payload_json, {}), fixedBy: 'memory' }), t, r.id)
  })()
  for (const r of settled) issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
  return settled.length
}

/**
 * Reopens an issue. A live flag Adam ignored (LIVE_KINDS) is never a stored open issue: its row goes instead,
 * as unignoreLive does. Returns the row as it is now (as it was, with status 'gone', when it went), or null.
 */
export function reopenIssue(db: DB, id: ID): Row | null {
  const r = issueRow(db, id)
  if (!r) return null
  if (!isLiveKind(r.kind)) {
    // Open again, it is no longer settled by the memory: fixed later by the text, it is a slip like any other. Nor is it
    // put off with Later any more (Later's Undo reopens it).
    const p = json<IssuePayload>(r.payload_json, {})
    if (p.fixedBy || p.later) {
      const wasLater = !!p.later && r.status === 'open'
      delete p.fixedBy
      delete p.later
      db.prepare('UPDATE issues SET payload_json = ? WHERE id = ?').run(JSON.stringify(p), id)
      if (wasLater) issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
    }
    return setIssueStatus(db, id, 'open')
  }
  db.prepare('DELETE FROM issues WHERE id = ?').run(id)
  issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
  return { ...r, status: 'gone' }
}

// ---------- Saving what a check found ----------

/** One thing a check found, ready to save. */
export interface FoundIssue {
  sceneId: ID | null
  storyId: ID
  kind: IssueKind
  severity: IssueSeverity
  quote: string
  message: string
  key: string
  payload: IssuePayload
}

/**
 * True when two rows are about the same thing in the same place: the same key, the same entry and field,
 * or the same kind with overlapping words (whatever entry or scene each names, so a reworded or requoted
 * finding is still the issue Adam ignored).
 */
export function sameThing(p: IssuePayload, row: Row, f: Pick<FoundIssue, 'key' | 'sceneId' | 'kind' | 'quote'>): boolean {
  const q = json<IssuePayload>(row.payload_json, {})
  if (q.key && q.key === f.key) return true
  if ((row.scene_id || null) !== (f.sceneId || null)) return false
  // A rule's finding (long story memory fix 8) and the AI's or the keeper's: the same thing when both are about the same
  // entry (and the same field, or neither) and about what is so, whatever their kinds, unless both quote words and those
  // are other words of another kind; with no entry on one side, by their words as below. Two rules' findings are the same
  // only by their keys.
  if (p.by === 'rule' || q.by === 'rule') {
    if (p.by === 'rule' && q.by === 'rule') return false
    if (p.entryId && q.entryId) {
      const a = (row.quote as string) ?? ''
      const words = row.kind === f.kind || !a.trim() || !f.quote.trim() || quotesOverlap(a, f.quote)
      return q.entryId === p.entryId && (p.field ?? null) === (q.field ?? null) && RULE_KINDS.has(f.kind) && RULE_KINDS.has(row.kind as IssueKind) && words
    }
    return row.kind === f.kind && quotesOverlap((row.quote as string) ?? '', f.quote)
  }
  if (p.entryId && q.entryId === p.entryId && p.field && q.field === p.field) return true
  return row.kind === f.kind && quotesOverlap((row.quote as string) ?? '', f.quote)
}

/** The kinds a rule's finding is matched with another's by entry: what is so, never how it reads (voice, style). */
const RULE_KINDS = new Set<IssueKind>(['fact', 'knowledge', 'timeline', 'continuity'])

/**
 * Saves what a check found in one transaction, replacing what the same check found there before:
 * - anything Adam ignored (by key, or the same entry and field or words) is never raised again;
 * - something already open (the memory keeper's clash about the same thing, say) stays as it is, and
 *   takes the check's suggested rewrite if it had none;
 * - something the same check found before is updated in place (fixed or gone ones come back open);
 * - what the same check found before and didn't find this time goes (`replaces` says which rows
 *   this run stands for).
 * `existing` are the rows to compare with. Returns how many new issues were raised.
 */
export function saveFound(db: DB, existing: Row[], found: FoundIssue[], replaces: (p: IssuePayload, row: Row) => boolean): number {
  const t = now()
  let raised = 0
  const kept = new Set<ID>()
  db.transaction(() => {
    const rows = [...existing]
    for (const f of found) {
      const p: IssuePayload = { ...f.payload, key: f.key }
      const same = rows.filter((r) => sameThing(p, r, f))
      if (same.some((r) => r.status === 'ignored')) continue
      const mine = same.find((r) => json<IssuePayload>(r.payload_json, {}).key === f.key)
      const other = same.find((r) => r.status === 'open' && r !== mine)
      if (other && (!mine || mine.status !== 'open')) {
        kept.add(other.id as ID)
        const q = json<IssuePayload>(other.payload_json, {})
        // A rule's finding (fix 8) the AI check found too becomes the check's, in its place: the check's words, with
        // its rewrite or advice. So whichever ran first, the same thing reads the same (the rules never take over).
        if (q.by === 'rule' && p.by === 'check' && !mine) {
          db.prepare('UPDATE issues SET severity = ?, quote = ?, message = ?, payload_json = ?, kind = ?, updated_at = ? WHERE id = ?').run(
            f.severity,
            f.quote,
            f.message,
            JSON.stringify(p),
            f.kind,
            t,
            other.id
          )
          issuesTouched(f.storyId, f.sceneId)
          continue
        }
        // Already raised (by the memory keeper, or another check): it stays, with the rewrite if it lacked one.
        if (!q.fix && p.fix) {
          db.prepare('UPDATE issues SET payload_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...q, fix: p.fix }), t, other.id)
          issuesTouched(f.storyId, f.sceneId)
        }
        continue
      }
      if (mine) {
        kept.add(mine.id as ID)
        const wasOpen = mine.status === 'open'
        // What the sweep keeps stays with it: where its words are (the same words at the same place), and, for the rules
        // (they run after every reading of a scene), Later; a check of the scene ends Later (clearLater).
        const q = json<IssuePayload>(mine.payload_json, {})
        const next: IssuePayload = {
          ...p,
          ...(q.at && mine.quote === f.quote && q.occurrence === p.occurrence ? { at: q.at } : {}),
          ...(q.later && wasOpen && p.by === 'rule' ? { later: q.later } : {})
        }
        // Found again just as it was (the rules run after every reading of a scene): nothing to tell the window.
        const unchanged =
          wasOpen && mine.severity === f.severity && mine.quote === f.quote && mine.message === f.message && mine.kind === f.kind && samePayload(q, next)
        if (unchanged) continue
        db.prepare(
          "UPDATE issues SET status = 'open', severity = ?, quote = ?, message = ?, payload_json = ?, kind = ?, scene_id = ?, story_id = ?, updated_at = ? WHERE id = ?"
        ).run(f.severity, f.quote, f.message, JSON.stringify(next), f.kind, f.sceneId ?? '', f.storyId, t, mine.id)
        if (!wasOpen) raised++
        issuesTouched(f.storyId, f.sceneId)
        continue
      }
      const id = newId()
      db.prepare(
        `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
      ).run(id, f.sceneId ?? '', f.storyId, f.kind, f.severity, f.quote, f.message, JSON.stringify(p), t, t)
      kept.add(id)
      rows.push(issueRow(db, id)!)
      raised++
      issuesTouched(f.storyId, f.sceneId)
    }
    // What this check (or the rules) found before and not this time goes (only open ones: ignored stay ignored, fixed
    // stay fixed). The keeper's own clashes are never taken away here.
    for (const r of existing) {
      if (r.status !== 'open' || kept.has(r.id as ID)) continue
      const q = json<IssuePayload>(r.payload_json, {})
      if ((q.by !== 'check' && q.by !== 'rule') || !replaces(q, r)) continue
      db.prepare('DELETE FROM issues WHERE id = ?').run(r.id)
      issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
    }
  })()
  return raised
}

/**
 * Keeps a slip that was mended as it landed (check and repair, repair/index.ts) as a fixed issue, so the page's Undo
 * can mark it ignored (never raised or mended again). The same key found before is brought up to date in place.
 * Returns its id.
 */
export function saveFixed(db: DB, f: FoundIssue): ID {
  const t = now()
  const p: IssuePayload = { ...f.payload, key: f.key }
  const mine = (db.prepare('SELECT * FROM issues WHERE scene_id = ?').all(f.sceneId ?? '') as Row[]).find((r) => json<IssuePayload>(r.payload_json, {}).key === f.key)
  if (mine) {
    db.prepare("UPDATE issues SET status = 'fixed', severity = ?, quote = ?, message = ?, payload_json = ?, kind = ?, updated_at = ? WHERE id = ?").run(
      f.severity,
      f.quote,
      f.message,
      JSON.stringify(p),
      f.kind,
      t,
      mine.id
    )
    issuesTouched(f.storyId, f.sceneId)
    return mine.id as ID
  }
  const id = newId()
  db.prepare(
    `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'fixed', ?, ?, ?, ?, ?)`
  ).run(id, f.sceneId ?? '', f.storyId, f.kind, f.severity, f.quote, f.message, JSON.stringify(p), t, t)
  issuesTouched(f.storyId, f.sceneId)
  return id
}

/** Every issue row in these scenes (any status). */
/**
 * Takes away the open issues a check through a scene's contract raised (long story memory fix 13's review): with contracts
 * switched off nothing would ever clear them. Ignored ones stay ignored.
 */
export function dropContractIssues(db: DB, sceneId: ID): void {
  for (const r of rowsInScenes(db, [sceneId])) {
    if (r.status !== 'open' || !json<IssuePayload>(r.payload_json, {}).contract) continue
    db.prepare('DELETE FROM issues WHERE id = ?').run(r.id)
    issuesTouched(r.story_id as ID | null, sceneId)
  }
}

export function rowsInScenes(db: DB, sceneIds: ID[]): Row[] {
  if (!sceneIds.length) return []
  const out: Row[] = []
  for (let i = 0; i < sceneIds.length; i += 500) {
    const part = sceneIds.slice(i, i + 500)
    out.push(...(db.prepare(`SELECT * FROM issues WHERE scene_id IN (${part.map(() => '?').join(',')})`).all(...part) as Row[]))
  }
  return out
}

/**
 * The fixed and ignored issues of these kinds in these scenes: what earlier scenes' checks settled (checks/lessons.ts).
 * Never the live checks' rows.
 */
export function settledRows(db: DB, sceneIds: ID[], kinds: IssueKind[]): Row[] {
  if (!sceneIds.length || !kinds.length) return []
  const out: Row[] = []
  const kindList = kinds.map(() => '?').join(',')
  for (let i = 0; i < sceneIds.length; i += 500) {
    const part = sceneIds.slice(i, i + 500)
    out.push(
      ...(db
        .prepare(`SELECT * FROM issues WHERE status IN ('fixed', 'ignored') AND kind IN (${kindList}) AND scene_id IN (${part.map(() => '?').join(',')})`)
        .all(...kinds, ...part) as Row[])
    )
  }
  return out
}

/** Every story issue (kind 'story') a check raised for this story (any status, any scene). */
export function storyKindRows(db: DB, storyId: ID): Row[] {
  return db.prepare("SELECT * FROM issues WHERE kind = 'story' AND story_id = ?").all(storyId) as Row[]
}

/** The payload of a row. */
export const payloadOf = (r: Row): IssuePayload => json<IssuePayload>(r.payload_json, {})

/** A rule's row (fix 8): `by` 'rule' in its payload, as SQL. */
const RULE_ROW = "json_valid(payload_json) AND json_extract(payload_json, '$.by') = 'rule'"

/** The live scenes with a rule's finding open (fix 8: looked at again when a scene before them is read). */
export function openRuleScenes(db: DB): ID[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT i.scene_id AS id FROM issues i JOIN scenes sc ON sc.id = i.scene_id JOIN chapters c ON c.id = sc.chapter_id
         JOIN stories st ON st.id = c.story_id
         WHERE i.status = 'open' AND ${RULE_ROW} AND sc.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`
      )
      .all() as Row[]
  ).map((r) => r.id as ID)
}

/**
 * Takes away the rules' open findings (fix 8) in scenes that are deleted (in Recently deleted, or in a chapter or story
 * that is): they no longer count anywhere. What Adam ignored or fixed there stays, for if the scene comes back. Returns
 * the scenes whose issues changed.
 */
export function clearDeletedRules(db: DB): ID[] {
  const rows = db
    .prepare(
      `SELECT id, scene_id, story_id FROM issues WHERE status = 'open' AND ${RULE_ROW} AND scene_id IN (
         SELECT sc.id FROM scenes sc LEFT JOIN chapters c ON c.id = sc.chapter_id LEFT JOIN stories st ON st.id = c.story_id
         WHERE sc.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL OR st.deleted_at IS NOT NULL)`
    )
    .all() as Row[]
  if (!rows.length) return []
  const del = db.prepare('DELETE FROM issues WHERE id = ?')
  db.transaction(() => {
    for (const r of rows) del.run(r.id)
  })()
  for (const r of rows) issuesTouched(r.story_id as ID | null, r.scene_id as ID)
  return [...new Set(rows.map((r) => r.scene_id as ID))]
}

/**
 * The rules' findings still open in a scene (fix 8), as Adam sees them, oldest first: the plan's reader of the record
 * is told them before the scene is drafted again (long story memory fix 14), so the brief can say what not to repeat.
 */
export function openRuleFindings(db: DB, sceneId: ID, most = 12): string[] {
  return (
    db
      .prepare(`SELECT message FROM issues WHERE scene_id = ? AND status = 'open' AND ${RULE_ROW} ORDER BY created_at, id LIMIT ?`)
      .all(sceneId, Math.max(0, most)) as Row[]
  )
    .map((r) => String(r.message ?? '').trim())
    .filter(Boolean)
}

/** How many open issues a scene has that were raised at or after `since` (by a check, or by the memory keeper). */
export function openSince(db: DB, sceneId: ID, since: string): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM issues WHERE scene_id = ? AND status = 'open' AND created_at >= ?").get(sceneId, since) as Row
  return Number(r.n) || 0
}
