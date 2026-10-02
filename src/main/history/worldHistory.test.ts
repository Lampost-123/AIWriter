import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import { purgeTrash } from '../db/trash'
import { historyPath } from './open'
import { HistoryStore, migrateHistory } from './store'
import { PROBLEM_TEXT, RETRY_MS, WorldHistory, WRITING_EVERY_MS } from './worldHistory'

const MIN = 60_000
const DAY = 86_400_000
const T0 = Date.parse('2026-10-02T12:00:00.000Z')

const doc = (...paras: string[]) => ({
  type: 'doc',
  content: paras.map((p, i) => ({ type: 'paragraph', attrs: { pid: `p${i}` }, content: [{ type: 'text', text: p }] }))
})

const made: { folder: string; history: WorldHistory; db: Database.Database }[] = []
afterEach(() => {
  for (const m of made.splice(0)) {
    m.history.close()
    m.db.close()
    rmSync(m.folder, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

/** A world with two scenes, and its history (not started, so a test can prepare history.db first). */
function world(opts: { defer?: (fn: () => void) => void } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'aiwrite-worldhistory-'))
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  const outline = repo.getOutline(db, repo.listStories(db)[0].id)
  const scene = outline.scenes[0].id
  const other = repo.createScene(db, outline.chapters[0].id, { title: 'The knock' }).id
  let now = T0
  const changed: string[] = []
  const drafting = new Set<string>()
  const history = new WorldHistory({
    folder,
    worldDb: db,
    changed: (sceneId) => changed.push(sceneId),
    nowMs: () => now,
    defer: opts.defer ?? ((fn) => fn()),
    drafting: (sceneId) => drafting.has(sceneId)
  })
  made.push({ folder, history, db })
  /** Saves the scene like the editor does, then tells History. */
  const save = (text: string, id = scene) => {
    repo.saveSceneText(db, id, doc(...text.split('\n\n')), text)
    history.textSaved(id)
  }
  return {
    folder,
    db,
    scene,
    other,
    history,
    changed,
    drafting,
    save,
    later: (ms: number) => void (now += ms),
    now: () => now,
    list: (id = scene) => history.listSnapshots(id).snapshots
  }
}

describe('snapshots while writing', () => {
  it("keeps one on a scene's first save, then one every 10 minutes", () => {
    const w = world()
    w.history.start(-1)
    w.save('The rain.')
    expect(w.list()).toMatchObject([{ kind: 'editing', label: 'While writing', words: 2 }])
    expect(w.changed).toEqual([w.scene])

    w.later(2 * MIN)
    w.save('The rain had not stopped.')
    expect(w.list()).toHaveLength(1)

    w.later(WRITING_EVERY_MS - 2 * MIN)
    w.save('The rain had not stopped. She left.')
    const list = w.list()
    expect(list).toHaveLength(2)
    expect(w.history.getSnapshot(list[0].id).text).toBe('The rain had not stopped. She left.')
    expect(w.history.getSnapshot(list[1].id).text).toBe('The rain.')
  })

  it("doesn't keep the same text twice", () => {
    const w = world()
    w.history.start(-1)
    w.save('Same words.')
    w.later(WRITING_EVERY_MS)
    w.save('Same words.')
    expect(w.list()).toHaveLength(1)
  })

  it('counts the 10 minutes from any snapshot, such as one before an AI change', () => {
    const w = world()
    w.history.start(-1)
    w.history.take({ sceneId: w.scene, kind: 'ai', label: 'Before Condense', doc: doc('Long text.'), text: 'Long text.' })
    w.later(5 * MIN)
    w.save('Short.')
    expect(w.list().map((s) => s.label)).toEqual(['Before Condense'])
    w.later(5 * MIN)
    w.save('Short again.')
    expect(w.list().map((s) => s.label)).toEqual(['While writing', 'Before Condense'])
  })

  it('keeps nothing while a draft is being written into the scene', () => {
    const w = world()
    w.history.start(-1)
    w.drafting.add(w.scene)
    w.save('Half a draft')
    expect(w.list()).toEqual([])
    w.drafting.delete(w.scene)
    w.save('The whole draft.')
    expect(w.list()).toHaveLength(1)
  })

  it('takes its time: a save returns before the snapshot is kept', () => {
    const queued: (() => void)[] = []
    const w = world({ defer: (fn) => queued.push(fn) })
    w.history.start(-1)
    w.save('Words.')
    w.save('More words.')
    expect(queued).toHaveLength(1)
    expect(w.list()).toEqual([])
    queued[0]()
    expect(w.list()).toMatchObject([{ words: 2 }])
  })
})

describe('snapshots before AI changes and when marked done', () => {
  it('keeps the page as it shows before an AI change, with the AI call it came before', () => {
    const w = world()
    w.history.start(-1)
    const info = w.history.take({
      sceneId: w.scene,
      kind: 'ai',
      label: 'Before a new draft',
      generationId: 'g1',
      doc: doc('Unsaved words.'),
      text: 'Unsaved words.'
    })
    expect(info).toMatchObject({ kind: 'ai', label: 'Before a new draft', generationId: 'g1', words: 2 })
    expect(w.history.getSnapshot(info!.id)).toMatchObject({ text: 'Unsaved words.', doc: doc('Unsaved words.') })
    expect(w.changed).toEqual([w.scene])
  })

  it('keeps nothing for an empty page, a scene that is gone, or a closed world', () => {
    const w = world()
    w.history.start(-1)
    expect(w.history.take({ sceneId: w.scene, kind: 'ai', label: 'Before Expand', doc: doc(), text: '' })).toBeNull()
    expect(w.history.take({ sceneId: 'no-such-scene', kind: 'ai', label: 'Before Expand', doc: doc('A.'), text: 'A.' })).toBeNull()
    repo.deleteScene(w.db, w.other)
    expect(w.history.take({ sceneId: w.other, kind: 'ai', label: 'Before Expand', doc: doc('A.'), text: 'A.' })).toBeNull()
    w.history.close()
    expect(w.history.take({ sceneId: w.scene, kind: 'ai', label: 'Before Expand', doc: doc('A.'), text: 'A.' })).toBeNull()
    expect(() => w.history.textSaved(w.scene)).not.toThrow()
    expect(() => w.history.markedDone(w.scene)).not.toThrow()
  })

  it('keeps one when the scene is marked done, giving the same text that reason', () => {
    const w = world()
    w.history.start(-1)
    w.save('Finished at last.')
    w.later(MIN)
    w.history.markedDone(w.scene)
    expect(w.list()).toMatchObject([{ kind: 'done', label: 'Marked done' }])
    w.later(MIN)
    w.save('Finished at last. One more line.')
    w.history.markedDone(w.scene)
    expect(w.list().map((s) => s.label)).toEqual(['Marked done', 'Marked done'])
  })

  it('names a restore plainly when the label is missing', () => {
    const w = world()
    w.history.start(-1)
    const info = w.history.take({ sceneId: w.scene, kind: 'restore', label: '  ', doc: doc('A.'), text: 'A.' })
    expect(info).toMatchObject({ kind: 'restore', label: 'Before restoring' })
  })
})

describe('when history.db is damaged, locked or newer', () => {
  it('starts afresh from a damaged file, keeps it aside and says so', () => {
    const w = world()
    writeFileSync(historyPath(w.folder), 'not a database '.repeat(100))
    w.history.start(-1)
    const h = w.history.listSnapshots(w.scene)
    expect(h.available).toBe(true)
    const aside = readdirSync(w.folder).find((f) => f.startsWith('history.db.damaged-'))!
    expect(aside).toBeTruthy()
    expect(h.notice).toContain('History had to start afresh')
    expect(h.notice).toContain(aside)
    // The note goes after a while.
    w.later(31 * DAY)
    expect(w.history.listSnapshots(w.scene).notice).toBeNull()
  })

  it('starts afresh when the file turns out damaged while in use, and still keeps the snapshot', () => {
    const w = world()
    w.history.start(-1)
    const take = HistoryStore.prototype.take
    let failed = false
    vi.spyOn(HistoryStore.prototype, 'take').mockImplementation(function (this: HistoryStore, input) {
      if (!failed) {
        failed = true
        throw Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' })
      }
      return take.call(this, input)
    })
    const info = w.history.take({ sceneId: w.scene, kind: 'ai', label: 'Before Rewrite', doc: doc('Kept.'), text: 'Kept.' })
    expect(info).toMatchObject({ label: 'Before Rewrite' })
    expect(readdirSync(w.folder).some((f) => f.startsWith('history.db.damaged-'))).toBe(true)
    expect(w.history.listSnapshots(w.scene)).toMatchObject({ available: true, snapshots: [{ label: 'Before Rewrite' }] })
  })

  it('carries on without history while the file is locked, and tries again later', () => {
    const w = world()
    const other = new Database(historyPath(w.folder))
    other.pragma('journal_mode = DELETE')
    migrateHistory(other, new Date(T0).toISOString())
    other.exec('BEGIN EXCLUSIVE')
    other.prepare("INSERT INTO meta (key, value) VALUES ('held', 'yes')").run()
    w.history.start(-1)

    expect(() => w.save('Typing on.')).not.toThrow()
    expect(w.history.take({ sceneId: w.scene, kind: 'ai', label: 'Before Expand', doc: doc('A.'), text: 'A.' })).toBeNull()
    expect(w.history.listSnapshots(w.scene)).toEqual({ available: false, problem: PROBLEM_TEXT.locked, notice: null, snapshots: [] })
    expect(w.history.listDrafts(w.scene)).toEqual({ available: false, problem: PROBLEM_TEXT.locked, drafts: [] })
    expect(() => w.history.newDraft({ sceneId: w.scene, doc: doc('A.'), text: 'A.' })).toThrow(PROBLEM_TEXT.locked)
    expect(readdirSync(w.folder).filter((f) => f.includes('damaged'))).toEqual([])

    other.exec('COMMIT')
    other.close()
    // Not straight away: History waits a little before trying again.
    w.later(RETRY_MS / 2)
    expect(w.history.listSnapshots(w.scene).available).toBe(false)
    w.later(RETRY_MS)
    expect(w.history.listSnapshots(w.scene).available).toBe(true)
    expect(w.history.take({ sceneId: w.scene, kind: 'ai', label: 'Before Expand', doc: doc('A.'), text: 'A.' })).not.toBeNull()
  })

  it('leaves a history.db from a newer AI Write alone and says to update', () => {
    const w = world()
    const newer = new Database(historyPath(w.folder))
    newer.pragma('user_version = 5')
    newer.close()
    w.history.start(-1)
    expect(w.history.listSnapshots(w.scene)).toMatchObject({ available: false, problem: PROBLEM_TEXT.newer })
    w.later(DAY)
    expect(w.history.listSnapshots(w.scene).available).toBe(false)
    expect(w.history.take({ sceneId: w.scene, kind: 'ai', label: 'Before Expand', doc: doc('A.'), text: 'A.' })).toBeNull()
    expect(existsSync(historyPath(w.folder))).toBe(true)
    expect(readdirSync(w.folder).filter((f) => f.includes('damaged'))).toEqual([])
  })

  it('says plainly when an earlier version is gone', () => {
    const w = world()
    w.history.start(-1)
    expect(() => w.history.getSnapshot('missing')).toThrow("That earlier version can't be found any more.")
  })
})

describe('drafts', () => {
  const page = (sceneId: string, text: string) => ({ sceneId, doc: doc(text), text })

  it('lists the current draft with the words the scene has', () => {
    const w = world()
    w.history.start(-1)
    w.save('Four words right here.')
    expect(w.history.listDrafts(w.scene)).toMatchObject({
      available: true,
      problem: null,
      drafts: [{ name: 'Draft 1', current: true, words: 4 }]
    })
  })

  it('starts, switches, renames, deletes and brings back drafts, saying each change', () => {
    const w = world()
    w.history.start(-1)
    w.save('The first way.')
    const made = w.history.newDraft(page(w.scene, 'The first way.'))
    expect(made.created).toMatchObject({ name: 'Draft 2', current: true })
    expect(made.kept).toMatchObject({ name: 'Draft 1', current: false, excerpt: 'The first way.' })
    expect(made.drafts.drafts.map((d) => d.name)).toEqual(['Draft 1', 'Draft 2'])

    // Adam rewrites it, then switches back to Draft 1: the page as it was is kept, and a snapshot taken first.
    w.changed.length = 0
    const sw = w.history.switchDraft(page(w.scene, 'The second way, longer.'), made.kept.id)
    expect(sw.to).toMatchObject({ name: 'Draft 1', current: true, text: 'The first way.' })
    expect(sw.from).toMatchObject({ name: 'Draft 2', excerpt: 'The second way, longer.' })
    expect(sw.drafts.drafts.find((d) => d.current)).toMatchObject({ name: 'Draft 1', words: 3 })
    expect(w.list()[0]).toMatchObject({ kind: 'restore', label: 'Before switching drafts' })
    expect(w.history.getSnapshot(w.list()[0].id).text).toBe('The second way, longer.')
    expect(w.changed).toEqual([w.scene])

    // Ctrl+Z in the page took the switch back.
    const back = w.history.setCurrentDraft(w.scene, made.created.id)
    expect(back.drafts.find((d) => d.current)!.name).toBe('Draft 2')

    expect(w.history.renameDraft(made.kept.id, 'By the river').name).toBe('By the river')
    w.history.deleteDraft(made.kept.id)
    expect(w.history.listDrafts(w.scene).drafts.map((d) => d.name)).toEqual(['Draft 2'])
    w.history.restoreDraft(made.kept.id)
    expect(w.history.listDrafts(w.scene).drafts.map((d) => d.name)).toEqual(['By the river', 'Draft 2'])
    expect(() => w.history.deleteDraft(made.created.id)).toThrow("The current draft can't be deleted")
  })

  it('undoes a new draft', () => {
    const w = world()
    w.history.start(-1)
    const made = w.history.newDraft(page(w.scene, 'Text.'))
    const after = w.history.undoNewDraft(w.scene, made.created.id, made.kept.id)
    expect(after.drafts).toMatchObject([{ name: 'Draft 1', current: true }])
  })

  it("won't make drafts for a scene that is gone", () => {
    const w = world()
    w.history.start(-1)
    repo.deleteScene(w.db, w.other)
    expect(() => w.history.newDraft(page(w.other, 'Text.'))).toThrow('That scene no longer exists.')
  })
})

describe('tidying up', () => {
  it('forgets scenes gone for good after a while, and drafts deleted 30 days ago, but keeps the rest', () => {
    const w = world()
    w.history.start(-1)
    w.save('Kept scene.')
    w.save('Gone scene.', w.other)
    const made = w.history.newDraft(page(w.scene, 'Kept scene.'))
    w.history.deleteDraft(made.kept.id)

    repo.deleteScene(w.db, w.other)
    w.later(40 * DAY)
    purgeTrash(w.db, 30, w.now())
    w.history.tidy()
    // Gone for good, but only for 40 days: kept a while longer (a backup could bring the scene back).
    expect(w.list(w.other)).toHaveLength(1)
    // The deleted draft is forgotten after 30 days.
    expect(() => w.history.restoreDraft(made.kept.id)).toThrow("can't be brought back")

    w.later(30 * DAY)
    w.history.tidy()
    expect(w.list(w.other)).toEqual([])
    expect(w.list(w.scene)).toHaveLength(1)
  })

  function page(sceneId: string, text: string) {
    return { sceneId, doc: doc(text), text }
  }
})
