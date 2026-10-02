// What history.db holds, and every SQL statement that reads or writes it (history.db is a file of its
// own beside world.db, so its SQL lives here rather than in src/main/db/). No Electron imports.
//
// Snapshots: the scene's text (the editor document and its plain text) at a moment worth going back
// to, with why it was taken. The same text as the scene's latest snapshot isn't kept twice: the
// latest one takes the more telling reason instead (Marked done over While writing, say).
//
// Keeping them (thinSnapshots): every snapshot from the last two weeks is kept. Older ones are
// thinned to the last of each day, and every one taken when the scene was marked done is kept, as is
// each scene's newest. Writing adds one at most every 10 minutes, so recent history is always whole.
//
// Drafts: a scene's other versions. The current draft is the scene's own text in world.db (the only
// text the memory reads); its row here holds its name and the text it had when it became current. A
// draft that stops being current keeps the page's text as it was then. Deleted drafts can be brought
// back for 30 days.

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { ID } from '@shared/types'
import type { DraftInfo, DraftText, PageNow, Snapshot, SnapshotInfo, SnapshotKind } from '@shared/contracts/history'
import { countWords } from '@shared/defaults'
import { newId, UserError } from '../util'

type DB = Database.Database
type Row = Record<string, unknown>

/** The layout of history.db this version writes (PRAGMA user_version). */
export const HISTORY_VERSION = 1

const SCHEMA_V1 = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    generation_id TEXT,
    doc_json TEXT,
    text TEXT NOT NULL,
    words INTEGER NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX snapshots_by_scene ON snapshots (scene_id, created_at);
  CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    name TEXT,
    current INTEGER NOT NULL DEFAULT 0,
    doc_json TEXT,
    text TEXT NOT NULL DEFAULT '',
    words INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    kept_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX drafts_by_scene ON drafts (scene_id, number);
`

/** The columns this version reads and writes, to tell its own history.db from some other file. */
const COLUMNS: Record<string, string[]> = {
  snapshots: ['id', 'scene_id', 'kind', 'label', 'generation_id', 'doc_json', 'text', 'words', 'signature', 'created_at'],
  drafts: ['id', 'scene_id', 'number', 'name', 'current', 'doc_json', 'text', 'words', 'created_at', 'kept_at', 'deleted_at']
}

/** history.db was written by a newer AI Write: it is left as it is. */
export class NewerHistoryError extends Error {}

/** history.db isn't AI Write's (its tables aren't the ones this version knows): treated as damaged. */
export class StrangeHistoryError extends Error {
  readonly code = 'SQLITE_CORRUPT'
}

/** Brings a history.db up to this version's layout, and checks it is one. */
export function migrateHistory(db: DB, nowIso: string): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > HISTORY_VERSION) throw new NewerHistoryError(`history.db is version ${version}`)
  if (version < 1) {
    // A new file is empty: one holding tables of its own is some other program's, not history.
    const tables = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as Row).n as number
    if (tables > 0) throw new StrangeHistoryError('history.db holds tables AI Write did not make')
    db.transaction(() => {
      db.exec(SCHEMA_V1)
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('created_at', nowIso)
      db.pragma(`user_version = ${HISTORY_VERSION}`)
    })()
  }
  for (const [table, want] of Object.entries(COLUMNS)) {
    const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => r.name as string))
    if (want.some((c) => !have.has(c))) throw new StrangeHistoryError(`history.db has no ${table} table this version can use`)
  }
}

// ---------- Pure helpers (tested on their own) ----------

/**
 * What makes two versions of a scene the same: its words and their formatting. Paragraph ids don't
 * count (a paragraph keeps its words whatever its id).
 */
export function signatureOf(doc: unknown, text: string): string {
  const h = createHash('sha1').update(text)
  if (isDoc(doc)) h.update('\u0000').update(JSON.stringify(doc, (key, value: unknown) => (key === 'pid' ? undefined : value)))
  return h.digest('hex')
}

/** An editor document (anything else, such as null from a plain-text save, is kept as text only). */
const isDoc = (doc: unknown): doc is Record<string, unknown> => !!doc && typeof doc === 'object' && !Array.isArray(doc)

/** The first words of a draft, to tell it from the others: about two lines' worth, cut at a word. */
export function excerptOf(text: string, max = 160): string {
  const flat = text
    .split(/\n+/)
    .filter((line) => line.trim() && !/^\s*(\*\s*){3,}$/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, '')}…`
}

/** How telling each reason is: the same text keeps the most telling one. */
const RANK: Record<SnapshotKind, number> = { editing: 1, ai: 2, restore: 2, done: 3 }

/** Everything from these last days is kept. */
export const KEEP_ALL_DAYS = 14
const DAY_MS = 86_400_000

/** A day on Adam's calendar (local time), so "the last of each day" means his days. */
const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * The snapshots of one scene that can go: older than KEEP_ALL_DAYS, not the last of their day, not
 * taken when the scene was marked done, and not the scene's newest.
 */
export function snapshotsToThin(rows: { id: ID; kind: SnapshotKind; createdAt: string }[], nowMs: number): ID[] {
  const newestFirst = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const daysSeen = new Set<string>()
  const drop: ID[] = []
  newestFirst.forEach((r, i) => {
    const at = Date.parse(r.createdAt)
    if (Number.isNaN(at)) return
    const day = dayOf(at)
    const lastOfDay = !daysSeen.has(day)
    daysSeen.add(day)
    if (i === 0 || nowMs - at < KEEP_ALL_DAYS * DAY_MS || lastOfDay || r.kind === 'done') return
    drop.push(r.id)
  })
  return drop
}

/** A draft's name as shown: the one Adam gave it, or its number. */
export const draftName = (number: number, name: string | null | undefined): string => name?.trim() || `Draft ${number}`

/** Longest name a draft can have. */
const NAME_MAX = 80

// ---------- The store ----------

export interface SnapshotInput {
  sceneId: ID
  kind: SnapshotKind
  label: string
  generationId?: ID | null
  doc: unknown
  text: string
}

export interface TakeResult {
  info: SnapshotInfo
  /** A new snapshot was kept (false: the latest one already had this text). */
  added: boolean
  /** Anything changed in history.db (a new snapshot, or the latest one's reason). */
  changed: boolean
}

const toSnapshotInfo = (r: Row): SnapshotInfo => ({
  id: r.id as string,
  sceneId: r.scene_id as string,
  kind: r.kind as SnapshotKind,
  label: r.label as string,
  generationId: (r.generation_id as string | null) ?? null,
  words: r.words as number,
  createdAt: r.created_at as string
})

const parseDoc = (json: unknown): unknown | null => {
  if (typeof json !== 'string' || !json) return null
  try {
    return JSON.parse(json) as unknown
  } catch {
    return null
  }
}

const docJson = (doc: unknown): string | null => (isDoc(doc) ? JSON.stringify(doc) : null)

export class HistoryStore {
  constructor(
    readonly db: DB,
    private readonly nowMs: () => number = Date.now
  ) {}

  private iso(): string {
    return new Date(this.nowMs()).toISOString()
  }

  close(): void {
    if (this.db.open) this.db.close()
  }

  // ---------- Snapshots ----------

  /**
   * Keeps the text as a snapshot of its scene. Nothing is kept for an empty page (returns null). The
   * same text as the scene's latest snapshot isn't kept twice: that one is returned, given this
   * reason if it is more telling (and a link to the AI call that came next if it had none).
   */
  take(input: SnapshotInput): TakeResult | null {
    const text = input.text ?? ''
    if (!text.trim()) return null
    const signature = signatureOf(input.doc, text)
    const at = this.iso()
    const latest = this.db
      .prepare('SELECT * FROM snapshots WHERE scene_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(input.sceneId) as Row | undefined
    if (latest && latest.signature === signature) {
      const kind = latest.kind as SnapshotKind
      const telling = RANK[input.kind] > RANK[kind]
      const link = !telling && !latest.generation_id && !!input.generationId && input.kind === 'ai'
      if (telling) {
        // A link to an AI call belongs to the reason it came with.
        const generationId = input.kind === 'ai' ? (input.generationId ?? null) : null
        this.db
          .prepare('UPDATE snapshots SET kind = ?, label = ?, generation_id = ?, created_at = ? WHERE id = ?')
          .run(input.kind, input.label, generationId, at, latest.id)
      } else if (link) {
        this.db.prepare('UPDATE snapshots SET generation_id = ? WHERE id = ?').run(input.generationId, latest.id)
      }
      return { info: this.info(latest.id as string)!, added: false, changed: telling || link }
    }
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO snapshots (id, scene_id, kind, label, generation_id, doc_json, text, words, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.sceneId,
        input.kind,
        input.label,
        input.generationId ?? null,
        docJson(input.doc),
        text,
        countWords(text),
        signature,
        at
      )
    this.thinSnapshots(input.sceneId)
    return { info: this.info(id)!, added: true, changed: true }
  }

  private info(id: ID): SnapshotInfo | null {
    const r = this.db.prepare('SELECT id, scene_id, kind, label, generation_id, words, created_at FROM snapshots WHERE id = ?').get(id) as
      | Row
      | undefined
    return r ? toSnapshotInfo(r) : null
  }

  /** When the scene's latest snapshot was taken (ms), or null if it has none. */
  latestAt(sceneId: ID): number | null {
    const r = this.db.prepare('SELECT MAX(created_at) AS at FROM snapshots WHERE scene_id = ?').get(sceneId) as Row | undefined
    const at = typeof r?.at === 'string' ? Date.parse(r.at) : NaN
    return Number.isNaN(at) ? null : at
  }

  /** The scene's snapshots, newest first (no text). */
  list(sceneId: ID): SnapshotInfo[] {
    const rows = this.db
      .prepare(
        'SELECT id, scene_id, kind, label, generation_id, words, created_at FROM snapshots WHERE scene_id = ? ORDER BY created_at DESC, rowid DESC'
      )
      .all(sceneId) as Row[]
    return rows.map(toSnapshotInfo)
  }

  /** One snapshot with its text, or null if it is gone. */
  get(id: ID): Snapshot | null {
    const r = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Row | undefined
    if (!r) return null
    return { ...toSnapshotInfo(r), doc: parseDoc(r.doc_json), text: r.text as string }
  }

  /** Lets go of the scene's snapshots that the keeping rules (above) say can go. Returns how many went. */
  thinSnapshots(sceneId: ID): number {
    const rows = (this.db.prepare('SELECT id, kind, created_at FROM snapshots WHERE scene_id = ?').all(sceneId) as Row[]).map((r) => ({
      id: r.id as string,
      kind: r.kind as SnapshotKind,
      createdAt: r.created_at as string
    }))
    const drop = snapshotsToThin(rows, this.nowMs())
    if (!drop.length) return 0
    const del = this.db.prepare('DELETE FROM snapshots WHERE id = ?')
    this.db.transaction(() => drop.forEach((id) => del.run(id)))()
    return drop.length
  }

  /** Every scene this history knows, with when anything of it was last written (for tidying up). */
  scenes(): { sceneId: ID; lastAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT scene_id, MAX(at) AS last_at FROM (
           SELECT scene_id, created_at AS at FROM snapshots
           UNION ALL SELECT scene_id, MAX(kept_at, COALESCE(deleted_at, '')) AS at FROM drafts
         ) GROUP BY scene_id`
      )
      .all() as Row[]
    return rows.map((r) => ({ sceneId: r.scene_id as string, lastAt: r.last_at as string }))
  }

  /** Forgets a scene that is gone for good (emptied from the Trash): its snapshots and drafts. */
  forgetScene(sceneId: ID): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM snapshots WHERE scene_id = ?').run(sceneId)
      this.db.prepare('DELETE FROM drafts WHERE scene_id = ?').run(sceneId)
    })()
  }

  // ---------- Drafts ----------

  private draftRow(id: ID): Row | undefined {
    return this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as Row | undefined
  }

  private toDraft(r: Row, currentWords?: number): DraftInfo {
    const current = r.current === 1
    return {
      id: r.id as string,
      sceneId: r.scene_id as string,
      name: draftName(r.number as number, r.name as string | null),
      current,
      words: current && currentWords != null ? currentWords : (r.words as number),
      excerpt: current ? '' : excerptOf(r.text as string),
      createdAt: r.created_at as string,
      keptAt: r.kept_at as string
    }
  }

  /** The scene's current draft, made (as "Draft 1") the first time it is asked for. */
  private currentRow(sceneId: ID): Row {
    const found = this.db.prepare('SELECT * FROM drafts WHERE scene_id = ? AND current = 1 AND deleted_at IS NULL').get(sceneId) as
      | Row
      | undefined
    if (found) return found
    const id = newId()
    const at = this.iso()
    this.db
      .prepare('INSERT INTO drafts (id, scene_id, number, current, created_at, kept_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, sceneId, this.nextNumber(sceneId), at, at)
    return this.draftRow(id)!
  }

  /** The number the scene's next draft gets (never one a deleted draft still has). */
  private nextNumber(sceneId: ID): number {
    const r = this.db.prepare('SELECT MAX(number) AS n FROM drafts WHERE scene_id = ?').get(sceneId) as Row | undefined
    return ((r?.n as number | null) ?? 0) + 1
  }

  /** A draft of this scene that can be used: not deleted. Throws a plain-words error otherwise. */
  private liveDraft(sceneId: ID | null, id: ID): Row {
    const r = this.draftRow(id)
    if (!r || r.deleted_at || (sceneId && r.scene_id !== sceneId)) {
      throw new UserError(
        "That draft can't be found. It may have been deleted; the Drafts tab shows the ones this scene has.",
        'draft-gone'
      )
    }
    return r
  }

  /**
   * The scene's drafts, Draft 1 first. A scene always has its current draft. `currentWords` is the
   * scene's own word count, shown for the current draft.
   */
  drafts(sceneId: ID, currentWords?: number): DraftInfo[] {
    this.db.transaction(() => this.currentRow(sceneId))()
    const rows = this.db.prepare('SELECT * FROM drafts WHERE scene_id = ? AND deleted_at IS NULL ORDER BY number').all(sceneId) as Row[]
    return rows.map((r) => this.toDraft(r, currentWords))
  }

  /** Keeps the page's text with the current draft, which stops being current. */
  private keepCurrent(page: PageNow, at: string): Row {
    const cur = this.currentRow(page.sceneId)
    this.db
      .prepare('UPDATE drafts SET current = 0, doc_json = ?, text = ?, words = ?, kept_at = ? WHERE id = ?')
      .run(docJson(page.doc), page.text, countWords(page.text), at, cur.id)
    return this.draftRow(cur.id as string)!
  }

  /** A new current draft, a copy of the page; the draft that was current keeps the page's text as it is. */
  newDraft(page: PageNow): { created: DraftInfo; kept: DraftInfo } {
    return this.db.transaction(() => {
      const at = this.iso()
      const kept = this.keepCurrent(page, at)
      const id = newId()
      this.db
        .prepare(
          'INSERT INTO drafts (id, scene_id, number, current, doc_json, text, words, created_at, kept_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)'
        )
        .run(id, page.sceneId, this.nextNumber(page.sceneId), docJson(page.doc), page.text, countWords(page.text), at, at)
      return { created: this.toDraft(this.draftRow(id)!), kept: this.toDraft(kept) }
    })()
  }

  /** Undoes newDraft: the copy goes for good and the draft it was made from is current again. */
  undoNewDraft(sceneId: ID, draftId: ID, keptId: ID): void {
    this.db.transaction(() => {
      const made = this.liveDraft(sceneId, draftId)
      const kept = this.liveDraft(sceneId, keptId)
      if (made.current !== 1) return
      this.db.prepare('DELETE FROM drafts WHERE id = ?').run(made.id)
      this.db.prepare('UPDATE drafts SET current = 1 WHERE id = ?').run(kept.id)
    })()
  }

  /**
   * Makes another draft current: the page's text is kept with the draft that was current, and the
   * chosen draft's text is returned, to go in the page.
   */
  switchDraft(page: PageNow, draftId: ID): { to: DraftText; from: DraftInfo } {
    return this.db.transaction(() => {
      const to = this.liveDraft(page.sceneId, draftId)
      if (to.current === 1) throw new UserError('That draft is already the current one.', 'draft-current')
      const from = this.keepCurrent(page, this.iso())
      this.db.prepare('UPDATE drafts SET current = 1 WHERE id = ?').run(to.id)
      const now = this.draftRow(to.id as string)!
      return {
        to: { ...this.toDraft(now), words: now.words as number, doc: parseDoc(now.doc_json), text: now.text as string },
        from: this.toDraft(from)
      }
    })()
  }

  /** Marks a draft current, changing no text (the page already shows it: Ctrl+Z took a switch back). */
  setCurrent(sceneId: ID, draftId: ID): void {
    this.db.transaction(() => {
      const r = this.liveDraft(sceneId, draftId)
      if (r.current === 1) return
      this.db.prepare('UPDATE drafts SET current = 0 WHERE scene_id = ? AND current = 1').run(sceneId)
      this.db.prepare('UPDATE drafts SET current = 1 WHERE id = ?').run(draftId)
    })()
  }

  /** Renames a draft; an empty name gives it back its number. */
  rename(draftId: ID, name: string): DraftInfo {
    this.liveDraft(null, draftId)
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
    this.db.prepare('UPDATE drafts SET name = ? WHERE id = ?').run(clean || null, draftId)
    return this.toDraft(this.draftRow(draftId)!)
  }

  /** Deletes a draft that isn't current (it can be brought back for 30 days). Returns its scene. */
  remove(draftId: ID): ID {
    const r = this.liveDraft(null, draftId)
    if (r.current === 1) {
      throw new UserError("The current draft can't be deleted: it is the scene's text. Switch to another draft first.", 'draft-current')
    }
    this.db.prepare('UPDATE drafts SET deleted_at = ? WHERE id = ?').run(this.iso(), draftId)
    return r.scene_id as string
  }

  /** Brings back a deleted draft. Returns its scene. */
  unremove(draftId: ID): ID {
    const r = this.draftRow(draftId)
    if (!r) throw new UserError("That draft can't be brought back any more.", 'draft-gone')
    this.db.prepare('UPDATE drafts SET deleted_at = NULL WHERE id = ?').run(draftId)
    return r.scene_id as string
  }

  /** Forgets drafts deleted more than `days` ago. Returns how many went. */
  purgeDeletedDrafts(days = 30): number {
    const cutoff = new Date(this.nowMs() - days * DAY_MS).toISOString()
    return this.db.prepare('DELETE FROM drafts WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff).changes
  }

  /** Gives some of the space freed by thinning back to the disk (a little at a time, so it never holds anything up). */
  giveBackSpace(pages = 2000): void {
    this.db.pragma(`incremental_vacuum(${Math.max(1, Math.floor(pages))})`)
  }
}
