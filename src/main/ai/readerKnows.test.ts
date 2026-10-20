// The reader ledger (overhaul, 2026-10-19): what the reader has been shown that someone in the scene doesn't know, with
// where the reader saw it, for secrets the people here hold first. Built from the who-knows-what ledger and the scenes'
// points of view; no AI call. Invented names and facts throughout.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, FactState, ID, Learned } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { READER_LINES, readerKnows, readerLines, type ReaderInput } from './readerKnows'

let seq = 0
const person = (name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `r${++seq}`,
  kind: 'character' as EntryKind,
  name,
  aliases: [],
  summary: '',
  description: '',
  tags: [],
  notes: '',
  fields: {},
  parentId: null,
  hardRule: false,
  origin: 'adam',
  fieldOrigins: {},
  originStoryId: null,
  originSceneId: null,
  originStart: false,
  byHand: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  happened: [],
  changed: [],
  ...extra
})

const mara = person('Mara', { fields: { pronouns: 'she/her' } })
const tobin = person('Tobin', { fields: { pronouns: 'he/him' } })
const ash = person('Ash')

const learned = (at: number, sceneId: string | null, where: string): Learned => ({ at, where, ...(sceneId ? { sceneId } : {}) })
const fact = (factId: string, text: string, knownBy: ID[], since: Record<ID, Learned>, extra: Partial<FactState> = {}): FactState => ({
  factId,
  fact: text,
  knownBy,
  since,
  at: Math.max(...Object.values(since).map((l) => l.at)),
  ...extra
})

function input(over: Partial<ReaderInput> = {}): ReaderInput {
  return { facts: [], present: [mara], happened: [], povOf: () => null, storyTitle: 'The Mill', ...over }
}

describe('what the reader knows that someone here doesn’t', () => {
  it('says what the reader was shown, where, and who here doesn’t know it', () => {
    const f = fact('f1', 'Ash stole the ledger.', [tobin.id], { [tobin.id]: learned(3, 's2', 'The Mill, Ch 1, Sc 2') })
    expect(readerLines(input({ facts: [f] }))).toEqual([
      'The reader knows Ash stole the ledger (Ch 1, Sc 2); Mara doesn’t: don’t explain it again, or let her learn or guess it without cause.'
    ])
    // Two who don't know it: named together.
    expect(readerLines(input({ facts: [f], present: [mara, ash] }))).toEqual([
      'The reader knows Ash stole the ledger (Ch 1, Sc 2); Mara doesn’t: don’t explain it again, or let her learn or guess it without cause.'
    ])
    const g = fact('f2', 'The weir will fail at the spring tide', [tobin.id], { [tobin.id]: learned(4, 's3', 'The Mill, Ch 1, Sc 3') })
    expect(readerLines(input({ facts: [g], present: [mara, ash] }))).toEqual([
      'The reader knows the weir will fail at the spring tide (Ch 1, Sc 3); Mara and Ash don’t: don’t explain it again, or let them learn or guess it without cause.'
    ])
  })

  it('puts the secrets someone here holds first, then the most lately shown', () => {
    const old = fact('f1', 'The mill is mortgaged', [ash.id], { [ash.id]: learned(2, 's1', 'The Mill, Ch 1, Sc 1') })
    const late = fact('f2', 'The abbot is alive', [ash.id], { [ash.id]: learned(9, 's4', 'The Mill, Ch 2, Sc 1') })
    const held = fact('f3', 'The flour tax was forged', [tobin.id], { [tobin.id]: learned(1, 's1', 'The Mill, Ch 1, Sc 1') })
    const lines = readerLines(input({ facts: [old, late, held], present: [mara, tobin] }))
    expect(lines.map((l) => /knows (.+?) \(/.exec(l)?.[1])).toEqual(['the flour tax was forged', 'the abbot is alive', 'the mill is mortgaged'])
    expect(lines[0]).toContain('Mara doesn’t')
  })

  it('says nothing the reader wasn’t shown, nothing resting on a plain read, nor of someone it is about or whose eyes it was seen through', () => {
    const start = fact('f1', 'Ash was born in the marsh', [ash.id], { [ash.id]: learned(-1, null, '') })
    const loose = fact('f2', 'Ash stole the ledger', [tobin.id], { [tobin.id]: learned(3, 's2', 'The Mill, Ch 1, Sc 2') }, { backed: false })
    const about = fact('f3', 'Mara is the heir', [tobin.id], { [tobin.id]: learned(3, 's2', 'The Mill, Ch 1, Sc 2') })
    const pov = fact('f4', 'The ferry sank', [tobin.id], { [tobin.id]: learned(5, 's5', 'The Mill, Ch 1, Sc 5') })
    const lines = readerLines(input({ facts: [start, loose, about, pov], povOf: (id) => (id === 's5' ? mara.id : null) }))
    expect(lines).toEqual([])
    // The dead and animals are never told as not knowing anything.
    const shown = fact('f5', 'The well is poisoned', [tobin.id], { [tobin.id]: learned(3, 's2', 'The Mill, Ch 1, Sc 2') })
    const dead = person('Osric', { happened: [{ note: 'Died of the fever.', where: '', changeId: 'd' }] })
    const dog = person('Bramble', { summary: 'A sheepdog.', tags: ['animal'] })
    expect(readerLines(input({ facts: [shown], present: [dead, dog] }))).toEqual([])
  })

  it(`gives ${READER_LINES} lines at most`, () => {
    const many = Array.from({ length: 7 }, (_, i) => fact(`m${i}`, `Secret number ${i + 1}`, [tobin.id], { [tobin.id]: learned(i + 1, `s${i}`, `The Mill, Ch 1, Sc ${i + 1}`) }))
    expect(readerLines(input({ facts: many }))).toHaveLength(READER_LINES)
  })
})

describe('from the open world', () => {
  it('reads the ledger as a scene begins, with the points of view of the scenes things were learned in', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const chapter = o.chapters[0].id
    const [s1, s2, s3] = [o.scenes[0].id, repo.createScene(db, chapter).id, repo.createScene(db, chapter).id]
    const m = repo.createEntry(db, 'character', { name: 'Mara', fields: { pronouns: 'she/her' } })
    const t = repo.createEntry(db, 'character', { name: 'Tobin' })
    // Scene 2 is told from Tobin's point of view: he overhears the plot there, with Adam's own knowledge change.
    repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, povId: t.id })
    mem.insertChange(db, { entryId: t.id, anchor: 'scene', sceneId: s2, kind: 'knowledge', payload: { factId: 'plot', fact: 'The miller plans to flood the valley' }, origin: 'adam' })
    const lines = readerKnows(db, story.id, s3, [m.id, t.id])
    expect(lines).toEqual([
      `The reader knows the miller plans to flood the valley (Ch 1, Sc 2); Mara doesn’t: don’t explain it again, or let her learn or guess it without cause.`
    ])
    // As scene 2 begins the reader hasn't been shown it yet; another story's id, or no one present: nothing.
    expect(readerKnows(db, story.id, s2, [m.id])).toEqual([])
    expect(readerKnows(db, 'another-story', s3, [m.id])).toEqual([])
    expect(readerKnows(db, story.id, s3, [])).toEqual([])
    // Had Mara been scene 2's point of view, the reader learned it through her: never told as not knowing it.
    repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, povId: m.id })
    expect(readerKnows(db, story.id, s3, [m.id])).toEqual([])
    expect(readerKnows(db, story.id, s1, [m.id])).toEqual([])
  })
})
