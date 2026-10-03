import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  excerptOf,
  HistoryStore,
  KEEP_ALL_DAYS,
  migrateHistory,
  NewerHistoryError,
  signatureOf,
  snapshotsToThin,
  StrangeHistoryError,
  type SnapshotInput
} from './store'

const DAY = 86_400_000
const MIN = 60_000
// Noon UTC, with same-day times kept within the hour after it: on the same day in every time zone.
const T0 = Date.parse('2026-10-02T12:00:00.000Z')

/** A doc the way the editor sends it: paragraphs with ids. */
const doc = (...paras: string[]) => ({
  type: 'doc',
  content: paras.map((p, i) => ({ type: 'paragraph', attrs: { pid: `p${i}` }, content: [{ type: 'text', text: p }] }))
})

/** The same, with every word in italics. */
const italicDoc = (...paras: string[]) => ({
  type: 'doc',
  content: paras.map((p, i) => ({
    type: 'paragraph',
    attrs: { pid: `p${i}` },
    content: [{ type: 'text', text: p, marks: [{ type: 'italic' }] }]
  }))
})

function setup(start = T0) {
  const db = new Database(':memory:')
  migrateHistory(db, new Date(start).toISOString())
  let now = start
  const store = new HistoryStore(db, () => now)
  return {
    db,
    store,
    at: (ms: number) => void (now = ms),
    later: (ms: number) => void (now += ms),
    now: () => now
  }
}

const snap = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  sceneId: 's1',
  kind: 'editing',
  label: 'While writing',
  doc: doc('The rain had not stopped.'),
  text: 'The rain had not stopped.',
  ...over
})

describe('signatureOf', () => {
  it('is the same for the same words, whatever the paragraph ids', () => {
    const a = doc('One.', 'Two.')
    const b = JSON.parse(JSON.stringify(a)) as typeof a
    b.content[0].attrs.pid = 'other'
    expect(signatureOf(a, 'One.\n\nTwo.')).toBe(signatureOf(b, 'One.\n\nTwo.'))
  })

  it('differs when the words or their formatting differ', () => {
    const plain = doc('One.')
    const bold = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One.', marks: [{ type: 'bold' }] }] }] }
    expect(signatureOf(plain, 'One.')).not.toBe(signatureOf(doc('Two.'), 'Two.'))
    expect(signatureOf(plain, 'One.')).not.toBe(signatureOf(bold, 'One.'))
    expect(signatureOf(null, 'One.')).not.toBe(signatureOf(plain, 'One.'))
  })

  it("is the same with an empty line more or less (the scene's text leaves those out too)", () => {
    const withEmpty = {
      type: 'doc',
      content: [
        ...doc('One.').content,
        { type: 'paragraph', attrs: { pid: 'e1' } },
        { type: 'paragraph', attrs: { pid: 'e2' }, content: [{ type: 'text', text: '   ' }, { type: 'hardBreak' }] }
      ]
    }
    expect(signatureOf(withEmpty, 'One.')).toBe(signatureOf(doc('One.'), 'One.'))
    // A paragraph id only, or none at all, is the same paragraph.
    const noIds = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One.' }] }] }
    expect(signatureOf(noIds, 'One.')).toBe(signatureOf(doc('One.'), 'One.'))
  })
})

describe('excerptOf', () => {
  it('runs the first lines together, skipping scene breaks', () => {
    expect(excerptOf('The rain.\n\n* * *\n\nShe left.')).toBe('The rain. She left.')
  })

  it('cuts a long text at a word', () => {
    const text = 'word '.repeat(100)
    const out = excerptOf(text, 40)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(41)
    expect(out).not.toMatch(/wor…$/)
  })
})

describe('snapshotsToThin (the keeping rules)', () => {
  const row = (id: string, ms: number, kind: 'editing' | 'done' | 'ai' = 'editing') => ({ id, kind, createdAt: new Date(ms).toISOString() })

  it('keeps everything from the last two weeks', () => {
    const now = T0
    const rows = Array.from({ length: 40 }, (_, i) => row(`r${i}`, now - i * 8 * 60 * MIN))
    expect(rows.every((r) => now - Date.parse(r.createdAt) < KEEP_ALL_DAYS * DAY)).toBe(true)
    expect(snapshotsToThin(rows, now)).toEqual([])
  })

  it('thins older days to the last of each day, keeping every Marked done and the newest', () => {
    const now = T0
    const old = now - 30 * DAY
    const rows = [
      row('newest', old + 40 * MIN),
      row('same-day-earlier', old + 30 * MIN),
      row('done', old + 20 * MIN, 'done'),
      row('first', old + 10 * MIN),
      row('day-before-last', old - DAY + 10 * MIN),
      row('day-before-first', old - DAY)
    ]
    expect(snapshotsToThin(rows, now).sort()).toEqual(['day-before-first', 'first', 'same-day-earlier'])
  })
})

describe('migrateHistory', () => {
  it('makes the tables once and marks the version', () => {
    const { db } = setup()
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    migrateHistory(db, new Date().toISOString())
    expect(db.prepare('SELECT COUNT(*) AS n FROM meta').get()).toEqual({ n: 1 })
  })

  it('leaves a history.db from a newer AI Write alone', () => {
    const db = new Database(':memory:')
    db.pragma('user_version = 7')
    expect(() => migrateHistory(db, new Date().toISOString())).toThrow(NewerHistoryError)
  })

  it('takes a file with other tables for a damaged one', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE snapshots (id TEXT)')
    db.pragma('user_version = 1')
    const err = (() => {
      try {
        migrateHistory(db, new Date().toISOString())
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(StrangeHistoryError)
    expect((err as StrangeHistoryError).code).toBe('SQLITE_CORRUPT')
  })
})

describe('HistoryStore snapshots', () => {
  it('keeps a snapshot with its words, doc and text, and lists them newest first', () => {
    const h = setup()
    const first = h.store.take(snap())!
    expect(first.added).toBe(true)
    expect(first.info).toMatchObject({ sceneId: 's1', kind: 'editing', label: 'While writing', words: 5, generationId: null })
    h.later(MIN)
    const second = h.store.take(
      snap({ kind: 'ai', label: 'Before a new draft', generationId: 'g1', text: 'Something else.', doc: doc('Something else.') })
    )!
    expect(h.store.list('s1').map((s) => s.id)).toEqual([second.info.id, first.info.id])
    expect(h.store.list('other')).toEqual([])
    const got = h.store.get(first.info.id)!
    expect(got.text).toBe('The rain had not stopped.')
    expect(got.doc).toEqual(doc('The rain had not stopped.'))
    expect(h.store.get('missing')).toBeNull()
  })

  it('keeps nothing for an empty page', () => {
    const h = setup()
    expect(h.store.take(snap({ text: '  \n ', doc: doc() }))).toBeNull()
    expect(h.store.list('s1')).toEqual([])
  })

  it("doesn't keep the same text twice, and gives it the more telling reason", () => {
    const h = setup()
    const a = h.store.take(snap())!
    h.later(5 * MIN)
    // Same words, other paragraph ids: still the same version.
    const sameDoc = doc('The rain had not stopped.')
    sameDoc.content[0].attrs.pid = 'new-id'
    const b = h.store.take(snap({ doc: sameDoc }))!
    expect(b).toMatchObject({ added: false, changed: false })
    expect(b.info.id).toBe(a.info.id)

    h.later(MIN)
    const done = h.store.take(snap({ kind: 'done', label: 'Marked done' }))!
    expect(done).toMatchObject({ added: false, changed: true })
    expect(done.info).toMatchObject({ id: a.info.id, kind: 'done', label: 'Marked done', createdAt: new Date(h.now()).toISOString() })

    // A less telling reason leaves it as it is.
    h.later(MIN)
    const again = h.store.take(snap())!
    expect(again).toMatchObject({ added: false, changed: false })
    expect(again.info.kind).toBe('done')
    expect(h.store.list('s1')).toHaveLength(1)
  })

  it('links an AI call to the same text kept just before it', () => {
    const h = setup()
    const a = h.store.take(snap({ kind: 'ai', label: 'Before Condense' }))!
    const b = h.store.take(snap({ kind: 'ai', label: 'Before a new draft', generationId: 'g9' }))!
    expect(b).toMatchObject({ added: false, changed: true })
    expect(b.info).toMatchObject({ id: a.info.id, label: 'Before Condense', generationId: 'g9' })
  })

  it('keeps text that went back to an earlier version (only the latest counts as the same)', () => {
    const h = setup()
    h.store.take(snap())
    h.store.take(snap({ text: 'Other.', doc: doc('Other.') }))
    expect(h.store.take(snap())!.added).toBe(true)
    expect(h.store.list('s1')).toHaveLength(3)
  })

  it('finds the snapshots with the same text as the scene now', () => {
    const h = setup()
    const a = h.store.take(snap())!
    h.later(MIN)
    h.store.take(snap({ text: 'Other.', doc: doc('Other.') }))
    h.later(MIN)
    const c = h.store.take(snap())!
    expect(h.store.sameAs('s1', doc('The rain had not stopped.'), 'The rain had not stopped.')).toEqual([c.info.id, a.info.id])
    expect(h.store.sameAs('s1', doc('Something new.'), 'Something new.')).toEqual([])
    expect(h.store.sameAs('s2', doc('Other.'), 'Other.')).toEqual([])
  })

  it("counts a version whose formatting isn't known as the same when its words are", () => {
    const h = setup()
    const plain = h.store.take(snap({ text: 'The rain fell.', doc: null }))!
    h.later(MIN)
    const italic = h.store.take(snap({ text: 'The rain fell.', doc: italicDoc('The rain fell.') }))!
    h.later(MIN)
    const asIs = h.store.take(snap({ text: 'The rain fell.', doc: doc('The rain fell.') }))!
    // The page now (its formatting known): the one with the same formatting, and the one without any known.
    expect(h.store.sameAs('s1', doc('The rain fell.'), 'The rain fell.')).toEqual([asIs.info.id, plain.info.id])
    // The scene saved as text only: every one with the same words.
    expect(h.store.sameAs('s1', null, 'The rain fell.')).toEqual([asIs.info.id, italic.info.id, plain.info.id])
  })

  it('thins old snapshots as new ones come in, and tells when the latest was taken', () => {
    const h = setup()
    // Three a day for 20 days.
    for (let d = 0; d < 20; d++) {
      for (let k = 0; k < 3; k++) {
        h.at(T0 + d * DAY + k * 20 * MIN)
        h.store.take(snap({ text: `Day ${d}, take ${k}.`, doc: doc(`Day ${d}, take ${k}.`) }))
      }
    }
    const list = h.store.list('s1')
    const cutoff = h.now() - KEEP_ALL_DAYS * DAY
    const recent = list.filter((s) => Date.parse(s.createdAt) >= cutoff)
    const older = list.filter((s) => Date.parse(s.createdAt) < cutoff)
    expect(recent.length).toBeGreaterThanOrEqual(KEEP_ALL_DAYS * 3 - 3)
    // One a day once older than two weeks, the last of each day.
    expect(new Set(older.map((s) => s.createdAt.slice(0, 10))).size).toBe(older.length)
    expect(older.every((s) => / take 2\.$/.test(h.store.get(s.id)!.text))).toBe(true)
    expect(h.store.latestAt('s1')).toBe(h.now())
    expect(h.store.latestAt('none')).toBeNull()
  })

  it('knows its scenes and forgets one', () => {
    const h = setup()
    h.store.take(snap())
    h.store.take(snap({ sceneId: 's2' }))
    h.store.drafts('s3')
    expect(
      h.store
        .scenes()
        .map((s) => s.sceneId)
        .sort()
    ).toEqual(['s1', 's2', 's3'])
    h.store.forgetScene('s1')
    expect(h.store.list('s1')).toEqual([])
    expect(
      h.store
        .scenes()
        .map((s) => s.sceneId)
        .sort()
    ).toEqual(['s2', 's3'])
  })
})

describe('HistoryStore drafts', () => {
  const page = (text: string, sceneId = 's1') => ({ sceneId, doc: doc(text), text })

  it('gives every scene its current draft, Draft 1', () => {
    const h = setup()
    const list = h.store.drafts('s1', 42)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ sceneId: 's1', name: 'Draft 1', current: true, words: 42, excerpt: '' })
    expect(h.store.drafts('s1')).toHaveLength(1)
  })

  it('starts a new draft as a copy, keeping the one it came from as it is', () => {
    const h = setup()
    const { created, kept } = h.store.newDraft(page('The first way it went.'))
    expect(kept).toMatchObject({ name: 'Draft 1', current: false, words: 5, excerpt: 'The first way it went.' })
    expect(created).toMatchObject({ name: 'Draft 2', current: true, words: 5 })
    expect(h.store.drafts('s1').map((d) => [d.name, d.current])).toEqual([
      ['Draft 1', false],
      ['Draft 2', true]
    ])
  })

  it('undoes a new draft while it is still as it started', () => {
    const h = setup()
    const { created, kept } = h.store.newDraft(page('Text.'))
    // The page as it shows now: the copy, untouched (paragraph ids and an empty line after it don't count).
    const now = { doc: { type: 'doc', content: [...doc('Text.').content, { type: 'paragraph', attrs: { pid: 'p9' } }] }, text: 'Text.' }
    expect(h.store.undoNewDraft('s1', created.id, kept.id, now)).toBe(true)
    expect(h.store.drafts('s1').map((d) => [d.name, d.current])).toEqual([['Draft 1', true]])
    // The next new draft is Draft 2 again: the undone one is gone for good.
    expect(h.store.newDraft(page('Text.')).created.name).toBe('Draft 2')
  })

  it('never throws away a new draft that has changes', () => {
    const h = setup()
    const { created, kept } = h.store.newDraft(page('The first way.'))
    // Adam wrote on in the copy, then pressed Undo: both drafts stay as they are.
    expect(h.store.undoNewDraft('s1', created.id, kept.id, page('The first way, and more.'))).toBe(false)
    expect(h.store.drafts('s1').map((d) => [d.name, d.current])).toEqual([
      ['Draft 1', false],
      ['Draft 2', true]
    ])
    expect(h.store.drafts('s1')[0].excerpt).toBe('The first way.')
    // Formatting counts as a change too.
    const italic = page('The first way.')
    Object.assign(italic.doc.content[0].content[0], { marks: [{ type: 'italic' }] })
    expect(h.store.undoNewDraft('s1', created.id, kept.id, italic)).toBe(false)
  })

  it('takes back a copy that is no longer in the page only while it is as it started', () => {
    const h = setup()
    const first = h.store.newDraft(page('One.'))
    // Switched back to Draft 1 with the copy untouched: the copy can go, and Draft 1 stays current.
    h.store.switchDraft(page('One.'), first.kept.id)
    expect(h.store.undoNewDraft('s1', first.created.id, first.kept.id, page('One.'))).toBe(true)
    expect(h.store.drafts('s1').map((d) => [d.name, d.current])).toEqual([['Draft 1', true]])
    // A copy rewritten before switching away keeps its words.
    const second = h.store.newDraft(page('One.'))
    h.store.switchDraft(page('One, rewritten.'), first.kept.id)
    expect(h.store.undoNewDraft('s1', second.created.id, second.kept.id, page('One.'))).toBe(false)
    expect(h.store.drafts('s1').map((d) => d.excerpt)).toEqual(['', 'One, rewritten.'])
  })

  it("says when a draft was started, except the scene's first, which began with the scene", () => {
    const h = setup()
    const [first] = h.store.drafts('s1')
    expect(first.startedAt).toBeNull()
    h.later(MIN)
    const { created, kept } = h.store.newDraft(page('Text.'))
    expect(created.startedAt).toBe(new Date(h.now()).toISOString())
    expect(kept.startedAt).toBeNull()
  })

  it('switches drafts: the page is kept with the draft it was, and the chosen text comes back', () => {
    const h = setup()
    const { kept } = h.store.newDraft(page('First version.'))
    // Adam rewrites Draft 2, then goes back to Draft 1.
    const { to, from } = h.store.switchDraft(page('Second version, rewritten.'), kept.id)
    expect(to).toMatchObject({ id: kept.id, name: 'Draft 1', current: true, text: 'First version.', words: 2 })
    expect(to.doc).toEqual(doc('First version.'))
    expect(from).toMatchObject({ name: 'Draft 2', current: false, excerpt: 'Second version, rewritten.', words: 3 })
    // And back again.
    const back = h.store.switchDraft(page('First version.'), from.id)
    expect(back.to.text).toBe('Second version, rewritten.')
    expect(() => h.store.switchDraft(page('x'), back.to.id)).toThrow('That draft is already the current one.')
  })

  it('marks a draft current without changing text (Ctrl+Z took a switch back)', () => {
    const h = setup()
    const { kept, created } = h.store.newDraft(page('One.'))
    h.store.switchDraft(page('Two.'), kept.id)
    h.store.setCurrent('s1', created.id)
    const list = h.store.drafts('s1')
    expect(list.filter((d) => d.current).map((d) => d.id)).toEqual([created.id])
    expect(list.find((d) => d.id === kept.id)!.excerpt).toBe('One.')
  })

  it('renames a draft, and an empty name gives it its number back', () => {
    const h = setup()
    const [d1] = h.store.drafts('s1')
    expect(h.store.rename(d1.id, '  The   tavern  version ').name).toBe('The tavern version')
    expect(h.store.rename(d1.id, 'x'.repeat(200)).name).toHaveLength(80)
    expect(h.store.rename(d1.id, '   ').name).toBe('Draft 1')
    expect(() => h.store.rename('missing', 'A')).toThrow("That draft can't be found.")
  })

  it("deletes a draft that isn't current, brings it back, and never reuses its number", () => {
    const h = setup()
    const { kept, created } = h.store.newDraft(page('One.'))
    expect(() => h.store.remove(created.id)).toThrow("The current draft can't be deleted")
    expect(h.store.remove(kept.id)).toBe('s1')
    expect(h.store.drafts('s1').map((d) => d.name)).toEqual(['Draft 2'])
    expect(() => h.store.switchDraft(page('Two.'), kept.id)).toThrow("That draft can't be found.")
    expect(h.store.newDraft(page('Two.')).created.name).toBe('Draft 3')
    expect(h.store.unremove(kept.id)).toBe('s1')
    expect(h.store.drafts('s1').map((d) => d.name)).toEqual(['Draft 1', 'Draft 2', 'Draft 3'])
  })

  it('forgets drafts deleted more than 30 days ago', () => {
    const h = setup()
    const { kept } = h.store.newDraft(page('One.'))
    h.store.remove(kept.id)
    h.later(29 * DAY)
    expect(h.store.purgeDeletedDrafts()).toBe(0)
    h.later(2 * DAY)
    expect(h.store.purgeDeletedDrafts()).toBe(1)
    expect(() => h.store.unremove(kept.id)).toThrow("can't be brought back")
  })

  it("keeps each scene's drafts to itself", () => {
    const h = setup()
    const { kept } = h.store.newDraft(page('One.'))
    expect(() => h.store.switchDraft(page('Other scene.', 's2'), kept.id)).toThrow("That draft can't be found.")
    expect(h.store.drafts('s2').map((d) => d.name)).toEqual(['Draft 1'])
  })
})
