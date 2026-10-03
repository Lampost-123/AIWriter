import type Database from 'better-sqlite3'
import type { Act, DeletedItem, ID } from '@shared/types'
import type { ChapterPlace, KeptItem } from '@shared/contracts/outline'
import { emptySceneCard } from '@shared/defaults'
import { newId, now, UserError } from '../util'

// All SQL for acts (milestone 4: acts in the binder and the outline helper). An act gathers chapters
// that follow one another. A story's order is its chapters' order (chapters.position, which the memory
// goes by), and it is always kept like this: the chapters with no act first (those written before the
// story had acts), then each act's chapters together, acts in their own order. Every write here keeps
// it so (`settle`), and so does bringing a chapter back from Recently deleted (`chapterRestored`, from
// repo.restoreDeleted). A chapter whose act is deleted counts as having none. No Electron imports.

type DB = Database.Database
type Row = Record<string, unknown>

const toAct = (r: Row): Act => ({
  id: r.id as string,
  storyId: r.story_id as string,
  title: r.title as string,
  purpose: r.purpose as string,
  position: r.position as number
})

const ids = (db: DB, sql: string, ...params: unknown[]): ID[] => (db.prepare(sql).all(...params) as Row[]).map((r) => r.id as string)
const clean = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** A story's acts, in order; none for a story without acts. */
export function listActs(db: DB, storyId: ID): Act[] {
  return (
    db.prepare('SELECT * FROM acts WHERE story_id = ? AND deleted_at IS NULL ORDER BY position, created_at').all(storyId) as Row[]
  ).map(toAct)
}

export function getAct(db: DB, id: ID): Act {
  const r = db.prepare('SELECT * FROM acts WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new UserError('That act no longer exists.')
  return toAct(r)
}

function storyOfChapter(db: DB, chapterId: ID): ID {
  const r = db.prepare('SELECT story_id FROM chapters WHERE id = ? AND deleted_at IS NULL').get(chapterId) as Row | undefined
  if (!r) throw new UserError('That chapter no longer exists.')
  return r.story_id as string
}

/** Numbers the acts 0, 1, 2... in the order given (their order now by default). */
function renumberActs(db: DB, storyId: ID, order: ID[] = listActs(db, storyId).map((a) => a.id)): void {
  const stmt = db.prepare('UPDATE acts SET position = ? WHERE id = ? AND position <> ?')
  order.forEach((id, i) => stmt.run(i, id, i))
}

/**
 * Puts a story's chapters in their proper order (see the top of this file). With `move`, that chapter
 * goes into the act it names (or among the chapters with no act, when `actId` is null): just after
 * `afterId`, else just before `beforeId`, else at `index` among that act's other chapters, else at the
 * end of them. Only chapters whose place changes are written.
 */
function settle(db: DB, storyId: ID, move?: ChapterPlace & { chapterId: ID }): void {
  const acts = listActs(db, storyId)
  const live = new Set(acts.map((a) => a.id))
  if (move?.actId && !live.has(move.actId)) throw new UserError('That act no longer exists.')
  const rows = db
    .prepare('SELECT id, act_id, position FROM chapters WHERE story_id = ? AND deleted_at IS NULL ORDER BY position')
    .all(storyId) as Row[]
  const groups = new Map<ID | null, ID[]>([[null, []], ...acts.map((a): [ID, ID[]] => [a.id, []])])
  for (const r of rows) {
    if (r.id === move?.chapterId) continue
    const actId = r.act_id as string | null
    groups.get(actId && live.has(actId) ? actId : null)!.push(r.id as string)
  }
  if (move) {
    const list = groups.get(move.actId ?? null)!
    let at = list.length
    if (move.afterId && list.includes(move.afterId)) at = list.indexOf(move.afterId) + 1
    else if (move.beforeId && list.includes(move.beforeId)) at = list.indexOf(move.beforeId)
    else if (move.index != null && Number.isFinite(move.index)) at = Math.max(0, Math.min(Math.floor(move.index), list.length))
    list.splice(at, 0, move.chapterId)
    db.prepare('UPDATE chapters SET act_id = ? WHERE id = ? AND act_id IS NOT ?').run(
      move.actId ?? null,
      move.chapterId,
      move.actId ?? null
    )
  }
  const order = [...groups.get(null)!, ...acts.flatMap((a) => groups.get(a.id)!)]
  const was = new Map(rows.map((r) => [r.id as string, r.position as number]))
  const stmt = db.prepare('UPDATE chapters SET position = ? WHERE id = ?')
  order.forEach((id, i) => {
    if (was.get(id) !== i) stmt.run(i, id)
  })
}

/** Puts a story's chapters back in their proper order, if anything has put them out of it. */
export function keepActsTogether(db: DB, storyId: ID): void {
  db.transaction(() => settle(db, storyId))()
}

/** Makes an act, with no chapters yet: just after the act `afterId`, else just before `beforeId`, else after every act. */
export function createAct(
  db: DB,
  storyId: ID,
  input: { title?: string; purpose?: string; afterId?: ID | null; beforeId?: ID | null } = {}
): Act {
  if (!db.prepare('SELECT 1 FROM stories WHERE id = ? AND deleted_at IS NULL').get(storyId))
    throw new UserError('That story no longer exists.')
  const id = newId()
  const t = now()
  return db.transaction(() => {
    const order = listActs(db, storyId).map((a) => a.id)
    const title = clean(input.title) || `Act ${order.length + 1}`
    db.prepare('INSERT INTO acts (id, story_id, title, purpose, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      storyId,
      title,
      (input.purpose ?? '').trim(),
      order.length,
      t,
      t
    )
    let at = order.length
    if (input.afterId && order.includes(input.afterId)) at = order.indexOf(input.afterId) + 1
    else if (input.beforeId && order.includes(input.beforeId)) at = order.indexOf(input.beforeId)
    order.splice(at, 0, id)
    renumberActs(db, storyId, order)
    settle(db, storyId)
    return getAct(db, id)
  })()
}

/** Renames an act or changes its purpose. A blank title keeps the one it has. */
export function updateAct(db: DB, id: ID, patch: Partial<Pick<Act, 'title' | 'purpose'>>): Act {
  const a = getAct(db, id)
  const title = patch.title !== undefined && clean(patch.title) ? clean(patch.title) : a.title
  const purpose = patch.purpose !== undefined ? patch.purpose.trim() : a.purpose
  db.prepare('UPDATE acts SET title = ?, purpose = ?, updated_at = ? WHERE id = ?').run(title, purpose, now(), id)
  return getAct(db, id)
}

/**
 * Deletes an act with its chapters and their scenes, all at the same moment, as deleting a chapter
 * takes its scenes: they go to Recently deleted, and restoreAct brings back exactly those.
 */
export function deleteAct(db: DB, id: ID): { chapterIds: ID[]; sceneIds: ID[] } {
  const act = getAct(db, id)
  const t = now()
  return db.transaction(() => {
    const chapterIds = ids(
      db,
      'SELECT id FROM chapters WHERE act_id = ? AND story_id = ? AND deleted_at IS NULL ORDER BY position',
      id,
      act.storyId
    )
    const sceneIds = chapterIds.flatMap((c) =>
      ids(db, 'SELECT id FROM scenes WHERE chapter_id = ? AND deleted_at IS NULL ORDER BY position', c)
    )
    db.prepare(
      'UPDATE scenes SET deleted_at = ? WHERE deleted_at IS NULL AND chapter_id IN (SELECT id FROM chapters WHERE act_id = ? AND story_id = ? AND deleted_at IS NULL)'
    ).run(t, id, act.storyId)
    db.prepare('UPDATE chapters SET deleted_at = ? WHERE act_id = ? AND story_id = ? AND deleted_at IS NULL').run(t, id, act.storyId)
    // Its place number stays as it is, so bringing it back puts it where it was.
    db.prepare('UPDATE acts SET deleted_at = ? WHERE id = ?').run(t, id)
    return { chapterIds, sceneIds }
  })()
}

/** Undoes deleteAct: the act comes back with the chapters and scenes deleted with it, and its story too if that is deleted. */
export function restoreAct(db: DB, id: ID): void {
  db.transaction(() => {
    const r = db.prepare('SELECT * FROM acts WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new UserError('That act could not be found to restore.')
    const storyId = r.story_id as string
    const t = r.deleted_at as string | null
    if (t) {
      db.prepare(
        'UPDATE scenes SET deleted_at = NULL WHERE deleted_at = ? AND chapter_id IN (SELECT id FROM chapters WHERE act_id = ? AND deleted_at = ?)'
      ).run(t, id, t)
      db.prepare('UPDATE chapters SET deleted_at = NULL WHERE act_id = ? AND deleted_at = ?').run(id, t)
      db.prepare('UPDATE acts SET deleted_at = NULL WHERE id = ?').run(id)
    }
    db.prepare('UPDATE stories SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(storyId)
    renumberActs(db, storyId)
    settle(db, storyId)
  })()
}

/**
 * The acts in Recently deleted (repo.listDeleted), each with the chapters and scenes deleted along with
 * it, which come back with it (restoreAct). Those chapters are listed in their act, not on their own.
 */
export function deletedActs(db: DB): { items: DeletedItem[]; chapterIds: Set<ID> } {
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.deleted_at, a.story_id, st.title AS story_title,
         (SELECT COUNT(*) FROM chapters c WHERE c.act_id = a.id AND c.deleted_at = a.deleted_at) AS chapter_count,
         (SELECT COUNT(*) FROM scenes s JOIN chapters c ON c.id = s.chapter_id
           WHERE c.act_id = a.id AND c.deleted_at = a.deleted_at AND s.deleted_at = a.deleted_at) AS scene_count
       FROM acts a JOIN stories st ON st.id = a.story_id
       WHERE a.deleted_at IS NOT NULL`
    )
    .all() as Row[]
  const items = rows.map(
    (r): DeletedItem => ({
      kind: 'act',
      id: r.id as string,
      title: (r.title as string) ?? '',
      deletedAt: r.deleted_at as string,
      entryKind: null,
      storyId: r.story_id as string,
      storyTitle: (r.story_title as string) ?? null,
      chapterTitle: null,
      sceneCount: (r.scene_count as number) ?? 0,
      chapterCount: (r.chapter_count as number) ?? 0
    })
  )
  const chapterIds = new Set(
    ids(db, 'SELECT c.id FROM chapters c JOIN acts a ON a.id = c.act_id WHERE a.deleted_at IS NOT NULL AND c.deleted_at = a.deleted_at')
  )
  return { items, chapterIds }
}

/**
 * Removes for good the acts that have been in Recently deleted since before `cutoff` (the chapters
 * deleted with them go in the same purge, being as old). Runs inside db/trash.ts purgeTrash.
 */
export function purgeActs(db: DB, cutoff: string): number {
  const gone = ids(db, 'SELECT id FROM acts WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff)
  const unlink = db.prepare('UPDATE chapters SET act_id = NULL WHERE act_id = ?')
  const remove = db.prepare('DELETE FROM acts WHERE id = ?')
  for (const id of gone) {
    unlink.run(id)
    remove.run(id)
  }
  return gone.length
}

/** Puts a chapter into an act (or among the chapters with no act): see settle for where. */
export function placeChapter(db: DB, chapterId: ID, place: ChapterPlace): void {
  const storyId = storyOfChapter(db, chapterId)
  db.transaction(() => settle(db, storyId, { ...place, chapterId }))()
}

/** A story's chapters as runs: those with no act (key null), then each act's, each in the story's order. */
function chapterRunsOf(db: DB, storyId: ID): Map<ID | null, ID[]> {
  const acts = listActs(db, storyId)
  const live = new Set(acts.map((a) => a.id))
  const runs = new Map<ID | null, ID[]>([[null, []], ...acts.map((a): [ID, ID[]] => [a.id, []])])
  const rows = db
    .prepare('SELECT id, act_id FROM chapters WHERE story_id = ? AND deleted_at IS NULL ORDER BY position')
    .all(storyId) as Row[]
  for (const r of rows) {
    const actId = r.act_id as string | null
    runs.get(actId && live.has(actId) ? actId : null)!.push(r.id as string)
  }
  return runs
}

/**
 * A new act (titled "Act N") starting at this chapter. It takes the chapter and the ones after it in its
 * act, or, for a chapter with no act, the ones after it with none; it goes just after that act, or before
 * every act. So the story reads in the same order, and a story written without acts can be given them.
 * Says which chapters it took. Undone by joinActBack.
 */
export function startActAt(db: DB, chapterId: ID): { act: Act; chapterIds: ID[] } {
  const storyId = storyOfChapter(db, chapterId)
  return db.transaction(() => {
    const from = actOfChapter(db, chapterId)
    const run = chapterRunsOf(db, storyId).get(from) ?? []
    const at = run.indexOf(chapterId)
    if (at < 0 || (from && at === 0)) throw new UserError('That chapter already starts its act.')
    const first = listActs(db, storyId)[0]?.id ?? null
    const act = createAct(db, storyId, from ? { afterId: from } : { beforeId: first })
    const chapterIds = run.slice(at)
    const stmt = db.prepare('UPDATE chapters SET act_id = ? WHERE id = ?')
    for (const id of chapterIds) stmt.run(act.id, id)
    settle(db, storyId)
    return { act: getAct(db, act.id), chapterIds }
  })()
}

/**
 * Undo for startActAt: the act's chapters go back to the end of the act before it (or, for the first
 * act, among the chapters with no act), so the story reads in the same order, and the act goes for good.
 */
export function joinActBack(db: DB, id: ID): void {
  const act = getAct(db, id)
  db.transaction(() => {
    const order = listActs(db, act.storyId)
    const before = order[order.findIndex((a) => a.id === id) - 1]?.id ?? null
    db.prepare('UPDATE chapters SET act_id = ? WHERE act_id = ? AND story_id = ?').run(before, id, act.storyId)
    db.prepare('DELETE FROM acts WHERE id = ?').run(id)
    renumberActs(db, act.storyId)
    settle(db, act.storyId)
  })()
}

/** The act a chapter is in; null when it has none (or its act is deleted). */
export function actOfChapter(db: DB, chapterId: ID): ID | null {
  const r = db
    .prepare(
      'SELECT a.id FROM chapters c JOIN acts a ON a.id = c.act_id AND a.story_id = c.story_id WHERE c.id = ? AND a.deleted_at IS NULL'
    )
    .get(chapterId) as Row | undefined
  return (r?.id as string | undefined) ?? null
}

/**
 * After repo.createChapter: in a story with acts, the new chapter goes in the act of the chapter it was
 * added after (`afterId`, which may have none), or else at the end of the story's last act, so it is
 * where the binder shows it. A story without acts is left as it is. Runs inside the create.
 */
export function chapterCreated(db: DB, chapterId: ID, afterId: ID | null | undefined): void {
  const storyId = storyOfChapter(db, chapterId)
  const all = listActs(db, storyId)
  if (!all.length) return
  const after = afterId
    ? (db.prepare('SELECT act_id FROM chapters WHERE id = ? AND story_id = ? AND deleted_at IS NULL').get(afterId, storyId) as
        | Row
        | undefined)
    : undefined
  const live = new Set(all.map((a) => a.id))
  const actId = after ? (after.act_id && live.has(after.act_id as string) ? (after.act_id as string) : null) : all[all.length - 1].id
  settle(db, storyId, { chapterId, actId, afterId: after ? afterId : null })
}

/** After repo.moveChapter: a chapter stays in its act, so in a story with acts the order is put right. Runs inside the move. */
export function chapterMoved(db: DB, chapterId: ID): void {
  const storyId = storyOfChapter(db, chapterId)
  if (listActs(db, storyId).length) settle(db, storyId)
}

/**
 * After a chapter comes back from Recently deleted (or with a scene of it): its act comes back too if
 * it is deleted (just the act, none of its other chapters), so the chapter is where it was rather
 * than among the chapters with no act, and the story's order is put right. Runs inside the restore.
 */
export function chapterRestored(db: DB, chapterId: ID): void {
  const r = db.prepare('SELECT story_id, act_id FROM chapters WHERE id = ?').get(chapterId) as Row | undefined
  if (!r) return
  const storyId = r.story_id as string
  if (r.act_id) {
    const back = db
      .prepare('UPDATE acts SET deleted_at = NULL WHERE id = ? AND story_id = ? AND deleted_at IS NOT NULL')
      .run(r.act_id, storyId)
    if (back.changes > 0) renumberActs(db, storyId)
  }
  settle(db, storyId)
}

// ---------- What the outline helper reads ----------

/** The goal, beats and When on each live scene card of a story, by scene id, in one query. A damaged card reads as empty. */
export function storyCards(db: DB, storyId: ID): Map<ID, { goal: string; beats: string[]; when: string }> {
  const rows = db
    .prepare(
      `SELECT s.id, s.card_json FROM scenes s JOIN chapters c ON c.id = s.chapter_id
       WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL`
    )
    .all(storyId) as Row[]
  const out = new Map<ID, { goal: string; beats: string[]; when: string }>()
  for (const r of rows) {
    let card: { goal?: unknown; beats?: unknown; when?: unknown } = {}
    try {
      card = JSON.parse(String(r.card_json ?? '{}')) as typeof card
    } catch {
      // Read as empty.
    }
    out.set(r.id as string, {
      goal: typeof card.goal === 'string' ? card.goal : '',
      beats: Array.isArray(card.beats) ? card.beats.filter((b): b is string => typeof b === 'string') : [],
      when: typeof card.when === 'string' ? card.when : ''
    })
  }
  return out
}

// ---------- What the outline helper keeps ----------

/**
 * Marks something the outline helper just made as untouched, so its Undo can tell whether Adam has
 * changed it since. Its last change is set a millisecond before it was made: any change after that,
 * even within the same millisecond, leaves it no earlier than when it was made. Runs inside the keep.
 */
export function markMade(db: DB, kind: KeptItem['kind'], id: ID): void {
  const table = { act: 'acts', chapter: 'chapters', scene: 'scenes' }[kind]
  const r = db.prepare(`SELECT created_at FROM ${table} WHERE id = ?`).get(id) as Row | undefined
  const made = Date.parse(String(r?.created_at ?? ''))
  if (Number.isNaN(made)) return
  db.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(new Date(made - 1).toISOString(), id)
}

/** Whether a row was changed after the outline helper made it (see markMade). */
const changedSince = (r: Row): boolean => (r.updated_at as string) >= (r.created_at as string)

/**
 * Another story starts or ends at this scene or chapter. Taken back, it waits in Recently deleted, where
 * that story's start still finds its place (the scene or chapter before it), rather than going for good.
 */
const storyPoint = (db: DB, id: ID): boolean =>
  !!db.prepare('SELECT 1 FROM stories WHERE start_ref_id = ? OR end_ref_id = ? LIMIT 1').get(id, id)

/** Whether a scene has anything in it beyond what the outline helper made: words, a draft, or something the memory or Adam tied to it. */
function sceneUsed(db: DB, id: ID, r: Row): boolean {
  if ((r.word_count as number) > 0 || String(r.text ?? '').trim() || changedSince(r)) return true
  return sceneReferenced(db, id)
}

/**
 * Something points at the scene: an AI call made for it, a change, a summary, an issue, a pin, an entry
 * found there, or a story that starts there. Such a scene is never treated as untouched.
 */
export function sceneReferenced(db: DB, id: ID): boolean {
  if (storyPoint(db, id)) return true
  const any = (sql: string): boolean => !!db.prepare(sql).get(id)
  return (
    any('SELECT 1 FROM generations WHERE scene_id = ? LIMIT 1') ||
    any('SELECT 1 FROM changes WHERE scene_id = ? LIMIT 1') ||
    any('SELECT 1 FROM exists_points WHERE scene_id = ? LIMIT 1') ||
    any('SELECT 1 FROM issues WHERE scene_id = ? LIMIT 1') ||
    any("SELECT 1 FROM summaries WHERE level = 'scene' AND target_id = ? LIMIT 1") ||
    any('SELECT 1 FROM entries WHERE origin_scene_id = ? LIMIT 1') ||
    any("SELECT 1 FROM pins WHERE scope = 'scene' AND scope_id = ? LIMIT 1")
  )
}

/**
 * Takes back what the outline helper added (its Undo). Something still as it was made goes for good;
 * a scene with words, a draft or a change in it, or a chapter or act changed or holding something made
 * since, goes to Recently deleted instead (with what is in it), so nothing Adam did is lost.
 */
export function takeBackKept(db: DB, kept: Pick<KeptItem, 'kind' | 'id' | 'reused' | 'whenKept'>[]): { storyIds: ID[]; sceneIds: ID[] } {
  const t = now()
  const of = (kind: KeptItem['kind']): ID[] => kept.filter((k) => k.kind === kind && !k.reused).map((k) => k.id)
  const changed = changedSince
  const stories = new Set<ID>()
  const gone: ID[] = []
  return db.transaction(() => {
    // The story's first chapter and scene, which the kept ones took the place of, stay: put back as they
    // were ("Chapter 1", "Scene 1", empty) while untouched since, else just out of the act going.
    for (const k of kept.filter((k) => k.reused && k.kind === 'scene')) {
      const r = db
        .prepare(
          'SELECT s.word_count, s.text, s.card_json, s.deleted_at, s.created_at, s.updated_at, c.story_id FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?'
        )
        .get(k.id) as Row | undefined
      if (!r || r.deleted_at || sceneUsed(db, k.id, r)) continue
      // Only what the keep put on its card goes: the goal and beats, and the When unless it was there before.
      let card = emptySceneCard()
      try {
        card = { ...card, ...(JSON.parse(String(r.card_json ?? '{}')) as Partial<typeof card>) }
      } catch {
        // Put back empty.
      }
      const back = { ...card, goal: '', beats: [], when: k.whenKept && typeof card.when === 'string' ? card.when : '' }
      db.prepare("UPDATE scenes SET title = 'Scene 1', card_json = ? WHERE id = ?").run(JSON.stringify(back), k.id)
      markMade(db, 'scene', k.id)
    }
    for (const k of kept.filter((k) => k.reused && k.kind === 'chapter')) {
      const r = db.prepare('SELECT story_id, deleted_at, created_at, updated_at FROM chapters WHERE id = ?').get(k.id) as Row | undefined
      if (!r || r.deleted_at) continue
      stories.add(r.story_id as string)
      if (!changed(r)) db.prepare("UPDATE chapters SET title = 'Chapter 1', goal = '' WHERE id = ?").run(k.id)
      settle(db, r.story_id as string, { chapterId: k.id, actId: null, index: 0 })
      if (!changed(r)) markMade(db, 'chapter', k.id)
    }
    for (const id of of('scene')) {
      const r = db
        .prepare(
          'SELECT s.word_count, s.text, s.deleted_at, s.created_at, s.updated_at, c.story_id FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?'
        )
        .get(id) as Row | undefined
      if (!r || r.deleted_at) continue
      stories.add(r.story_id as string)
      gone.push(id)
      if (sceneUsed(db, id, r)) db.prepare('UPDATE scenes SET deleted_at = ? WHERE id = ?').run(t, id)
      else db.prepare('DELETE FROM scenes WHERE id = ?').run(id)
    }
    for (const id of of('chapter')) {
      const r = db.prepare('SELECT story_id, deleted_at, created_at, updated_at FROM chapters WHERE id = ?').get(id) as Row | undefined
      if (!r || r.deleted_at) continue
      stories.add(r.story_id as string)
      const left = ids(db, 'SELECT id FROM scenes WHERE chapter_id = ? AND deleted_at IS NULL', id)
      if (left.length || changed(r) || storyPoint(db, id) || db.prepare('SELECT 1 FROM scenes WHERE chapter_id = ? LIMIT 1').get(id)) {
        gone.push(...left)
        db.prepare('UPDATE scenes SET deleted_at = ? WHERE chapter_id = ? AND deleted_at IS NULL').run(t, id)
        db.prepare('UPDATE chapters SET deleted_at = ? WHERE id = ?').run(t, id)
      } else db.prepare('DELETE FROM chapters WHERE id = ?').run(id)
    }
    for (const id of of('act')) {
      const r = db.prepare('SELECT story_id, deleted_at, created_at, updated_at FROM acts WHERE id = ?').get(id) as Row | undefined
      if (!r || r.deleted_at) continue
      stories.add(r.story_id as string)
      const left = ids(db, 'SELECT id FROM chapters WHERE act_id = ? AND story_id = ? AND deleted_at IS NULL', id, r.story_id)
      // A chapter of it in Recently deleted brings the act back if it is restored, so the act stays too.
      if (left.length || changed(r) || db.prepare('SELECT 1 FROM chapters WHERE act_id = ? LIMIT 1').get(id)) {
        for (const c of left) gone.push(...ids(db, 'SELECT id FROM scenes WHERE chapter_id = ? AND deleted_at IS NULL', c))
        db.prepare(
          'UPDATE scenes SET deleted_at = ? WHERE deleted_at IS NULL AND chapter_id IN (SELECT id FROM chapters WHERE act_id = ? AND deleted_at IS NULL)'
        ).run(t, id)
        db.prepare('UPDATE chapters SET deleted_at = ? WHERE act_id = ? AND deleted_at IS NULL').run(t, id)
        db.prepare('UPDATE acts SET deleted_at = ? WHERE id = ?').run(t, id)
      } else db.prepare('DELETE FROM acts WHERE id = ?').run(id)
    }
    for (const storyId of stories) {
      renumberActs(db, storyId)
      settle(db, storyId)
    }
    return { storyIds: [...stories], sceneIds: gone }
  })()
}
