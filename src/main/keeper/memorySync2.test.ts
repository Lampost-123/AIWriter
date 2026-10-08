// World memory follows the words, round 2 (World Memory Overhaul part A3 to A7, and two leftovers from round 1):
// scene summaries follow their scene, AI guesses are marked and cleared (and the world builder's drafts count as
// Adam's), empty plot thread pages go to the Trash, the memory reads fresh words before the AI writes, existing worlds
// are tidied once, and the checks and Ask see what the writer sees. All text is invented; the memory model is the fake
// one (tests/fake-provider), its replies shaped per test: no paid calls.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, fakeModel, readScene, saveParas, shapedFetch, testWorld, textOf } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { SUMMARY_MARKER } from './prompts'
import { sceneSummaryDue, writeSceneSummary, type SummaryOptions } from './summaries'
import { Keeper } from './engine'
import { undoItem } from './undo'
import { fillFound } from '../builder/fill'
import { gatherContextInput } from '../ai/gather'
import { formatProfile, storySoFarText } from '../ai/context'
import { mustStayTrue } from '../ai/mustStay'
import { gatherSceneCheck } from '../checks/context'
import { askPoint } from '../ask/context'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0, slowWords: 3000, slowDelayMs: 30 })
})
afterAll(() => fake.close())

type DB = Database.Database

const writerMemory = (db: DB, sceneId: ID) =>
  gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' }).memory
const writerEntry = (db: DB, sceneId: ID, name: string) => writerMemory(db, sceneId).entries.find((e) => e.name === name) ?? null
const mustLines = (db: DB, sceneId: ID, names: string[]): string[] => {
  const m = writerMemory(db, sceneId)
  return mustStayTrue({
    stand: null,
    reach: 'later',
    people: names.map((n) => m.entries.find((e) => e.name === n)!).filter(Boolean),
    named: [],
    facts: m.facts,
    sceneId,
    storyTitle: '',
    places: {}
  })
}

/** Summary calls the fake provider got, as sent (for telling a short patch from a full rewrite). */
function summaryOptions(db: DB, sent: { user: string; maxTokens: number }[] = []): SummaryOptions {
  return {
    db,
    model: fakeModel(fake),
    signal: new AbortController().signal,
    closed: () => false,
    retryDelays: [0],
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: unknown }[]; max_tokens?: number }
      if (textOf(body.messages.find((m) => m.role === 'system')?.content).includes(SUMMARY_MARKER)) {
        sent.push({ user: textOf(body.messages.find((m) => m.role === 'user')?.content), maxTokens: body.max_tokens ?? 0 })
      }
      return fetch(input, init)
    }
  }
}

// Three invented paragraphs of about forty words each.
const HARBOUR =
  'The harbour lay grey under a low sky, and the fishing boats rocked at their moorings while the gulls quarrelled over scraps on the stones. Nobody hurried; the tide would not turn for hours, and the nets still hung drying on the rails.'
const MARKET =
  'Up the hill the market was setting out its stalls, apples and rope and lamp oil, the traders calling to one another across the square. A cart with a broken wheel stood abandoned by the fountain, its load of turnips spilling slowly.'
const CHAPEL =
  'Beyond the square the old chapel kept its doors shut against the wind. Its bell had not rung in years, and the steps were green with moss where the rain ran down from the gutters. A cat slept on the warm sill.'
const CHAPEL_EDITED =
  'Beyond the square the old chapel stood open to the wind, its doors torn from their hinges in the night by the storm that had come in off the sea. Glass lay everywhere on the steps, and the cat was nowhere to be seen.'

describe('A3: a scene summary follows its scene', () => {
  const setUp = async () => {
    const w = testWorld(2)
    const s1 = w.scenes[0]
    saveParas(w.db, s1, [
      ['p1', HARBOUR],
      ['p2', MARKET],
      ['p3', CHAPEL]
    ])
    expect(await writeSceneSummary(summaryOptions(w.db), s1, null, 'Ch 1, Sc 1')).toBe(true)
    return { ...w, s1 }
  }

  it('is due after an edit of forty words or more, or one that names someone, but not after a small edit', async () => {
    const w = await setUp()
    repo.createEntry(w.db, 'character', { name: 'Ottoline' })
    // A small edit naming no one: not due.
    saveParas(w.db, w.s1, [
      ['p1', HARBOUR],
      ['p2', MARKET.replace('apples and rope', 'pears and rope')],
      ['p3', CHAPEL]
    ])
    expect(sceneSummaryDue(w.db, w.s1, false)).toBe(false)
    // A small edit that names someone: due.
    saveParas(w.db, w.s1, [
      ['p1', HARBOUR],
      ['p2', MARKET.replace('the traders', 'Ottoline and the traders')],
      ['p3', CHAPEL]
    ])
    expect(sceneSummaryDue(w.db, w.s1, false)).toBe(true)
    // A paragraph rewritten (about forty words changed, the scene's length much the same): due.
    saveParas(w.db, w.s1, [
      ['p1', HARBOUR],
      ['p2', MARKET],
      ['p3', CHAPEL_EDITED]
    ])
    expect(sceneSummaryDue(w.db, w.s1, false)).toBe(true)
  })

  it('is patched from the old summary and the changed paragraphs only, in a short reply', async () => {
    const w = await setUp()
    const before = kdb.summaryRow(w.db, 'scene', w.s1)!.text
    saveParas(w.db, w.s1, [
      ['p1', HARBOUR],
      ['p2', MARKET],
      ['p3', CHAPEL_EDITED]
    ])
    const sent: { user: string; maxTokens: number }[] = []
    expect(await writeSceneSummary(summaryOptions(w.db, sent), w.s1, null, 'Ch 1, Sc 1')).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].user).toContain(before)
    expect(sent[0].user).toContain(CHAPEL_EDITED)
    expect(sent[0].user).not.toContain(HARBOUR)
    expect(sent[0].user).not.toContain(MARKET)
    expect(sent[0].maxTokens).toBeLessThan(700)
    expect(kdb.summaryRow(w.db, 'scene', w.s1)!.text).not.toBe(before)
    // With a paragraph deleted, the whole scene is summarised again.
    saveParas(w.db, w.s1, [
      ['p1', HARBOUR],
      ['p3', CHAPEL_EDITED]
    ])
    const again: { user: string; maxTokens: number }[] = []
    expect(await writeSceneSummary(summaryOptions(w.db, again), w.s1, null, 'Ch 1, Sc 1')).toBe(true)
    expect(again[0].user).toContain(HARBOUR)
  })

  it('goes to the writer marked as being updated until it is, with a short excerpt of how the scene now ends', async () => {
    const w = await setUp()
    const [s1, s2, s3] = w.scenes
    saveParas(w.db, s2, [['q1', 'The ferry came in late that evening.']])
    saveParas(w.db, s1, [
      ['p1', HARBOUR],
      ['p2', MARKET],
      ['p3', CHAPEL_EDITED]
    ])
    const sf = writerMemory(w.db, s3).storySoFar
    const one = sf.scenes.find((x) => x.sceneId === s1)!
    expect(one.updating).toBe(true)
    expect(one.excerpt).toContain('the cat was nowhere to be seen')
    const text = storySoFarText(sf, 'Book 1')
    expect(text).toContain(one.text)
    expect(text).toMatch(/being brought up to date/i)
    // Adam's own summary is never marked or rewritten.
    mem.putSummary(w.db, { level: 'scene', targetId: s1, text: 'Adam’s own words about the harbour.', origin: 'adam' })
    expect(writerMemory(w.db, s3).storySoFar.scenes.find((x) => x.sceneId === s1)!.updating).toBeFalsy()
    expect(sceneSummaryDue(w.db, s1, true)).toBe(false)
  })

  it('is refreshed when a draft reads the memory, even for a scene already read', async () => {
    const w = await setUp()
    const [s1, , s3] = w.scenes
    // The edit is read with summaries off, so nothing refreshes the summary then.
    saveParas(w.db, s1, [
      ['p1', HARBOUR],
      ['p2', MARKET],
      ['p3', CHAPEL_EDITED]
    ])
    const quiet = new Keeper({ db: w.db, model: () => fakeModel(fake), emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, summaries: false, retryDelays: [0], fetchImpl: shapedFetch({}) })
    await quiet.catchUpBefore(s3)
    quiet.stop()
    const before = kdb.summaryRow(w.db, 'scene', s1)!.text
    const k = new Keeper({ db: w.db, model: () => fakeModel(fake), emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, retryDelays: [0], fetchImpl: shapedFetch({}) })
    await k.catchUpBefore(s3)
    await k.whenIdle()
    k.stop()
    expect(kdb.summaryRow(w.db, 'scene', s1)!.text).not.toBe(before)
    expect(writerMemory(w.db, s3).storySoFar.scenes.find((x) => x.sceneId === s1)!.updating).toBeFalsy()
  })
})

describe('A4: what the AI guessed', () => {
  it('a detail filled in from the story keeps a link to its words, and goes when they go', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Kell lost his hat.'],
      ['p2', "Kell's hair was black and cut short."]
    ])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    await fillFound(w.db, [kell.id], fakeModel(fake), { prefs: defaultWritingPrefs(), retryDelays: [0] })
    const filled = entryNamed(w.db, 'Kell')!
    expect(filled.fields.hair).toBe('black and cut short')
    expect(hist.linksForEntry(w.db, kell.id).filter((l) => l.factKind === 'field' && l.field === 'hair').map((l) => [l.state, l.paragraphId])).toEqual([
      ['ok', 'p2']
    ])
    saveParas(w.db, s1, [['p1', 'Kell lost his hat.']])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Kell')!.fields.hair ?? '').toBe('')
  })

  it('a guess with no words goes to the writer labelled as a guess, never into must stay true', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [['p1', 'Kell lost his hat.']])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, hair: 'black', marks: 'a scar on his chin' } }, { origin: 'ai' })
    const e = writerEntry(w.db, s2, 'Kell')!
    expect(e.guesses?.sort()).toEqual(['hair', 'marks'])
    expect(formatProfile(e)).toMatch(/Hair \(guess\): black/)
    expect(mustLines(w.db, s2, ['Kell']).join('\n')).not.toContain('scar')
  })

  it('guesses go when the entry loses its last words, even when it stays', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Kell lost his hat.'],
      ['p2', 'The ferry was late.']
    ])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, hair: 'black' } }, { origin: 'ai' })
    // On a later scene's card, so he stays when the text no longer names him.
    repo.updateSceneCard(w.db, s2, { ...repo.getScene(w.db, s2).card, presentIds: [kell.id] })
    saveParas(w.db, s1, [['p2', 'The ferry was late.']])
    await readScene(w.db, fake, s1)
    const after = entryNamed(w.db, 'Kell')
    expect(after).not.toBeNull()
    expect(after!.fields.hair ?? '').toBe('')
  })

  it('what the world builder drafted counts as Adam’s: kept when the text says otherwise, never a guess', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    const oskar = repo.createEntry(w.db, 'character', { name: 'Oskar' })
    repo.updateEntry(w.db, oskar.id, { fields: { eyes: 'blue', marks: 'burned right hand' } }, { origin: 'ai' })
    saveParas(w.db, s1, [['p1', "Oskar's eyes were green."]])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Oskar')!.fields.eyes).toBe('blue')
    const e = writerEntry(w.db, s2, 'Oskar')!
    expect(e.guesses ?? []).toEqual([])
    expect(mustLines(w.db, s2, ['Oskar']).join('\n')).toContain('burned right hand')
    saveParas(w.db, s1, [['p1', 'The street was dark.']])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Oskar')!.fields).toMatchObject({ eyes: 'blue', marks: 'burned right hand' })
  })
})

describe('A5: an empty plot thread page', () => {
  it('a card counts only the threads on its lists, not marks of links taken off', () => {
    const w = testWorld(1)
    const t = repo.createEntry(w.db, 'thread', { name: 'Who rang the bell' }, { origin: 'text' })
    const card = repo.getScene(w.db, w.scenes[1]).card
    repo.updateSceneCard(w.db, w.scenes[1], { ...card, setsUpIds: [], threadLinks: { [`setsUp:${t.id}`]: 'undone' } })
    expect(kdb.entryReferenced(w.db, t.id)).toBe(false)
    repo.updateSceneCard(w.db, w.scenes[1], { ...card, setsUpIds: [t.id], threadLinks: { [`setsUp:${t.id}`]: 'ai' } })
    expect(kdb.entryReferenced(w.db, t.id)).toBe(true)
  })

  it('a thread read from the text goes to the Trash when its words go; one Adam made never does', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    const own = repo.createEntry(w.db, 'thread', { name: 'Where the ledger went' })
    saveParas(w.db, s1, [
      ['p1', 'Nobody knew who rang the bell.'],
      ['p2', 'Tobin waited at the quay.']
    ])
    await readScene(w.db, fake, s1)
    const bell = entryNamed(w.db, 'Who rang the bell')!
    expect(bell.kind).toBe('thread')
    saveParas(w.db, s1, [['p2', 'Tobin waited at the quay.']])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Who rang the bell')).toBeNull()
    const line = kdb.listLog(w.db).find((l) => l.entryId === bell.id && l.text.startsWith('Moved to Trash'))!
    undoItem(w.db, line.id)
    expect(entryNamed(w.db, 'Who rang the bell')).not.toBeNull()
    expect(entryNamed(w.db, 'Where the ledger went')?.id).toBe(own.id)
  })
})

describe('A6: fresh words before the AI writes', () => {
  it('a scene with unread words is read right away before a draft, without waiting for the quiet time', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    const k = new Keeper({ db: w.db, model: () => fakeModel(fake), emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, summaries: false, retryDelays: [0], fetchImpl: shapedFetch({}) })
    saveParas(w.db, s1, [['p1', 'Bryn lost her map.']], false)
    k.sceneSaved(s1)
    expect(entryNamed(w.db, 'Bryn')).toBeNull()
    await k.beforeDraft(s1)
    expect(entryNamed(w.db, 'Bryn')).not.toBeNull()
    k.stop()
  })

  it('waits only so long, then goes ahead, and the read finishes later', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    const slow = fakeModel(fake, 'fake/slow')
    const k = new Keeper({ db: w.db, model: () => slow, emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, summaries: false, retryDelays: [0] })
    saveParas(w.db, s1, [['p1', 'Bryn lost her map.']], false)
    k.sceneSaved(s1)
    const t = Date.now()
    await k.beforeDraft(s1, 100)
    expect(Date.now() - t).toBeLessThan(2000)
    k.stop()
  })
})

describe('A7: an existing world is tidied once when it first opens', () => {
  it('takes away facts whose words are gone, asks again about edited ones, marks stale summaries, and says so once', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Mara lost her knife in the river.'],
      ['p2', "Kell's eyes were grey."],
      ['p3', HARBOUR]
    ])
    await readScene(w.db, fake, s1)
    expect(await writeSceneSummary(summaryOptions(w.db), s1, null, 'Ch 1, Sc 1')).toBe(true)
    const oskar = repo.createEntry(w.db, 'character', { name: 'Oskar', fields: { eyes: 'brown' } })
    const own = mem.insertChange(w.db, { kind: 'update', payload: { note: 'burned his hand' }, entryId: oskar.id, anchor: 'scene', sceneId: s1, origin: 'adam' })
    // An older version of AI Write let the words change under the memory without it noticing.
    saveParas(
      w.db,
      s1,
      [
        ['p1', "Mara's knife slipped into the reeds."],
        ['p3', CHAPEL_EDITED]
      ],
      false
    )
    w.db.prepare("DELETE FROM meta WHERE key = 'memory_tidy'").run()
    expect(kdb.needsReading(w.db, s1)).toBe(false)
    const k = new Keeper({ db: w.db, model: () => ({ error: 'none' }), emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, summaries: false })
    k.start()
    k.stop()
    expect(entryNamed(w.db, 'Kell')).toBeNull()
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
    expect(mem.changesForEntry(w.db, entryNamed(w.db, 'Mara')!.id)).toHaveLength(1)
    expect(kdb.needsReading(w.db, s1)).toBe(true)
    expect(kdb.summaryRow(w.db, 'scene', s1)!.stale).toBe(true)
    expect(mem.getChange(w.db, own.id).payload).toEqual({ note: 'burned his hand' })
    expect(entryNamed(w.db, 'Oskar')!.fields.eyes).toBe('brown')
    const tidy = kdb.listLog(w.db).filter((l) => l.text.startsWith('Memory tidy-up'))
    expect(tidy.map((l) => l.text)).toEqual(['Memory tidy-up: 2 removed, 1 to check again'])
    const removed = kdb.listLog(w.db).find((l) => l.text.startsWith('Eyes:'))!
    expect(removed.runId).toBe(tidy[0].runId)
    // Only once.
    const again = new Keeper({ db: w.db, model: () => ({ error: 'none' }), emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, summaries: false })
    again.start()
    again.stop()
    expect(kdb.listLog(w.db).filter((l) => l.text.startsWith('Memory tidy-up'))).toHaveLength(1)
  })
})

describe('leftovers from round 1', () => {
  const unconfirmed = async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', 'Mara lost her knife in the river.']
    ])
    await readScene(w.db, fake, s1)
    saveParas(w.db, s1, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', 'The knife slipped from her belt into the reeds.']
    ])
    await readScene(w.db, fake, s1, { verdicts: 'none' })
    saveParas(w.db, s2, [['q1', 'Mara waited by the gate.']])
    return { ...w, s1, s2 }
  }

  it('the checks and Ask leave out a text fact nothing confirms, as the writer does', async () => {
    const w = await unconfirmed()
    const check = gatherSceneCheck(w.db, w.s2, defaultWritingPrefs())
    const mara = check.entries.find((c) => c.entry.name === 'Mara')!
    expect(mara.entry.fields.marks ?? '').not.toContain('knife')
    const ask = askPoint(w.db, w.storyId, w.s2)
    expect(ask.here.find((e) => e.name === 'Mara')!.fields.marks ?? '').not.toContain('knife')
  })

  it('Adam’s own fact that the scene no longer supports gets a quiet note he can dismiss, never a question', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Mara lost her knife in the river.'],
      ['p2', 'The ferry was late.']
    ])
    await readScene(w.db, fake, s1)
    const [c] = mem.listAllChanges(w.db)
    saveParas(w.db, s1, [['p2', 'The ferry was very late.']])
    // Adam edits the change while the memory reads the scene: it is his now.
    const fetchImpl = shapedFetch({})
    let once = false
    const { runScene } = await import('./run')
    await runScene(
      {
        db: w.db,
        model: fakeModel(fake),
        signal: new AbortController().signal,
        closed: () => false,
        retryDelays: [0],
        fetchImpl: async (input, init) => {
          if (!once) {
            once = true
            mem.replaceChange(w.db, c.id, { kind: 'update', payload: { note: 'lost her knife in the Sel' }, entryId: c.entryId, anchor: 'scene', sceneId: s1, origin: 'adam' })
          }
          return fetchImpl(input, init)
        }
      },
      s1
    )
    expect(mem.getChange(w.db, c.id).payload).toEqual({ note: 'lost her knife in the Sel' })
    const lines = kdb.listLog(w.db).filter((l) => l.factId === c.id && l.action !== 'added')
    expect(lines.filter((l) => l.question)).toEqual([])
    const note = lines.find((l) => (l.undo as { op?: string } | null)?.op === 'note')!
    expect(note.text).toMatch(/the scene no longer says this/)
    undoItem(w.db, note.id)
    expect(mem.getChange(w.db, c.id).payload).toEqual({ note: 'lost her knife in the Sel' })
  })
})
