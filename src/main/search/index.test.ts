// Search over a small world: what is found, how it is grouped and ranked, the snippets, and that the
// index keeps up with every change without reading the whole world again.
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { SearchGroup, SearchHit, SearchResults, TextPart } from '@shared/contracts/search'
import { emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { memoryWorld } from '../../../tests/unit/helpers'
import { SearchIndex, searchIndex } from './index'

const show = (parts: TextPart[]): string => parts.map((p) => (p.hit ? `[${p.text}]` : p.text)).join('')
const titles = (g: SearchGroup | undefined): string[] => (g?.hits ?? []).map((h) => show(h.title))
const group = (r: SearchResults, id: SearchGroup['id']): SearchGroup | undefined => r.groups.find((g) => g.id === id)

/** How many statements a call prepares (one per query). */
function queries(db: Database.Database, fn: () => unknown): number {
  const prepare = db.prepare.bind(db)
  let n = 0
  db.prepare = ((sql: string) => {
    n++
    return prepare(sql)
  }) as typeof db.prepare
  try {
    fn()
  } finally {
    db.prepare = prepare
  }
  return n
}

/** Book 1 (Ch 1: two scenes, Ch 2: one) and Book 2 (one scene), with entries, summaries, notes and a style guide. */
function world() {
  const db = memoryWorld()
  const [book1] = repo.listStories(db)
  const o = repo.getOutline(db, book1.id)
  const ch1 = o.chapters[0]
  const s1 = o.scenes[0]
  repo.updateScene(db, s1.id, { title: 'The ferry' })
  repo.saveSceneText(db, s1.id, null, 'The ferry was late.\n\nMara watched the iron gate from the dock, counting the gulls.')
  const s2 = repo.createScene(db, ch1.id, { title: 'Night watch' })
  repo.saveSceneText(db, s2.id, null, 'Tobin kept watch by the gatehouse. Nobody came; the dragons slept.')
  repo.updateSceneCard(db, s2.id, {
    ...emptySceneCard(),
    goal: 'Tobin learns about the smugglers',
    notes: 'Keep the lantern imagery quiet here'
  })
  const ch2 = repo.createChapter(db, book1.id, { title: 'The Crossing' })
  repo.updateChapter(db, ch2.id, { goal: 'Reach the far shore before the storm' })
  const s3 = repo.createScene(db, ch2.id, { title: 'Storm' })
  repo.saveSceneText(db, s3.id, null, 'Rain lashed the deck. Élodie held the rope while the gate of the hold banged open.')
  repo.updateStory(db, book1.id, { premise: 'A ferry town hides a smuggling ring.' })
  const book2 = repo.createStory(db, { title: 'Book 2', startStoryId: book1.id })
  const ch3 = repo.createChapter(db, book2.id, { title: 'Return' })
  const s4 = repo.createScene(db, ch3.id, { title: 'Homecoming' })
  repo.saveSceneText(db, s4.id, null, 'Mara came back to the iron gate a year later.')

  const mara = repo.createEntry(db, 'character', {
    name: 'Mara Ashford',
    aliases: ['Kestrel'],
    summary: 'A ferry pilot with a secret',
    fields: { fears: 'Deep water at night' },
    notes: 'Maybe she lost her hand in Book 2?'
  })
  const tobin = repo.createEntry(db, 'character', {
    name: 'Tobin',
    summary: 'Mara’s cousin',
    description: 'Quiet, watchful, loyal to Mara'
  })
  const hall = repo.createEntry(db, 'place', { name: 'Ashford Hall', summary: 'The family house above the harbour' })
  const gone = repo.createEntry(db, 'lore', { name: 'Old Tides', description: 'The harbour floods at the turn of the year' })
  repo.deleteEntry(db, gone.id)

  mem.putSummary(db, { level: 'scene', targetId: s1.id, text: 'Mara waits for a ferry that never comes.', origin: 'text' })
  mem.putSummary(db, { level: 'chapter', targetId: ch2.id, text: 'The crossing goes wrong in a storm.', origin: 'text' })
  repo.setMeta(db, 'style', JSON.stringify({ proseStyle: 'Spare sentences, no semicolons.', avoidPhrases: ['suddenly'] }))
  return { db, book1, book2, ch1, ch2, s1, s2, s3, s4, mara, tobin, hall, gone }
}

describe('search', () => {
  it('finds a word across the manuscript, the memory, summaries and notes, grouped by kind', () => {
    const w = world()
    const r = searchIndex(w.db).search('mara')
    expect(r.groups.map((g) => g.id)).toEqual(['character', 'scenes', 'summaries'])
    // Names first: Mara herself, then Tobin, whose summary mentions her.
    expect(titles(group(r, 'character'))).toEqual(['[Mara] Ashford', 'Tobin'])
    expect(show(group(r, 'character')!.hits[1].snippet)).toBe('[Mara]’s cousin')
    expect(titles(group(r, 'scenes'))).toEqual(['The ferry', 'Homecoming'])
    const ferry = group(r, 'scenes')!.hits[0]
    expect(ferry.detail).toBe('Book 1, Ch 1, Sc 1')
    expect(show(ferry.snippet)).toBe('…[Mara] watched the iron gate from the dock, counting the gulls.')
    expect(ferry.prose).toBe(true)
    expect(ferry.open).toEqual({ kind: 'scene', sceneId: w.s1.id, storyId: w.book1.id, words: 'Mara', card: null })
    expect(group(r, 'summaries')!.hits[0].detail).toBe('Scene summary · Book 1, Ch 1, Sc 1')
    expect(r.ms).toBeGreaterThanOrEqual(0)
  })

  it('needs every word, in any order, and matches the last one by its start while it is typed', () => {
    const w = world()
    const ix = searchIndex(w.db)
    expect(titles(group(ix.search('gate iron'), 'scenes'))).toEqual(['The ferry', 'Homecoming'])
    expect(group(ix.search('gate tobin '), 'scenes')).toBeUndefined()
    // "gate" finished doesn't find "gatehouse"; while typing it does.
    expect(titles(group(ix.search('tobin gate '), 'scenes'))).toEqual([])
    expect(titles(group(ix.search('tobin gate'), 'scenes'))).toEqual(['Night watch'])
    // Accents and case don't matter, either way round.
    expect(titles(group(ix.search('ELODIE'), 'scenes'))).toEqual(['Storm'])
    expect(titles(group(ix.search('élodie'), 'scenes'))).toEqual(['Storm'])
    expect(ix.search('   ').groups).toEqual([])
  })

  it('finds an entry by an alias, a field or its summary, saying where', () => {
    const w = world()
    const ix = searchIndex(w.db)
    const kestrel = group(ix.search('kestr'), 'character')!.hits[0]
    expect(show(kestrel.title)).toBe('Mara Ashford')
    expect(show(kestrel.snippet)).toBe('Also called: [Kestr]el')
    // Found by a name (or the summary), the page opens at its top.
    expect(kestrel.open).toEqual({ kind: 'entry', entryId: w.mara.id, entryKind: 'character', part: null, words: null })
    const fears = group(ix.search('deep water'), 'character')!.hits[0]
    expect(show(fears.snippet)).toBe('Fears: [Deep] [water] at night')
    // Found further down, it opens at the field, with the words to select there.
    expect(fears.open).toEqual({
      kind: 'entry',
      entryId: w.mara.id,
      entryKind: 'character',
      part: { kind: 'field', key: 'fears' },
      words: 'Deep water'
    })
    expect(group(ix.search('watchful'), 'character')!.hits[0].open).toMatchObject({
      part: { kind: 'field', key: 'description' },
      words: 'watchful'
    })
    // A deleted entry isn't found.
    expect(ix.search('tides').groups).toEqual([])
  })

  it('reads a possessive as its name', () => {
    const w = world()
    const ix = searchIndex(w.db)
    const r = ix.search("Mara's")
    expect(titles(group(r, 'character'))).toEqual(['[Mara] Ashford', 'Tobin'])
    expect(show(group(r, 'character')!.hits[1].snippet)).toBe('[Mara]’s cousin')
    expect(titles(group(r, 'scenes'))).toEqual(['The ferry', 'Homecoming'])
    // A name with a possessive is the name typed, before one that only starts the same.
    repo.createEntry(w.db, 'place', { name: 'Mara Rests' })
    repo.createEntry(w.db, 'place', { name: 'Mara’s Rest' })
    expect(titles(group(ix.search("mara's rest"), 'place'))).toEqual(['[Mara]’s [Rest]', '[Mara] [Rest]s'])
  })

  it('lists what is found by its name first, then the scenes, then entries found only in what else is known about them', () => {
    const w = world()
    repo.createEntry(w.db, 'place', { name: 'The Iron Gate', summary: 'A sea gate across the harbour mouth' })
    repo.createEntry(w.db, 'character', { name: 'Brannoc', description: 'Afraid of the iron gate since he was a boy' })
    repo.createChapter(w.db, w.book2.id, { title: 'Beyond the Iron Gate' })
    const r = searchIndex(w.db).search('iron gate')
    expect(r.groups.map((g) => g.id)).toEqual(['place', 'stories', 'scenes', 'character'])
    expect(titles(group(r, 'stories'))).toEqual(['Beyond the [Iron] [Gate]'])
    // A chapter found by its goal rather than its title comes after the scenes and summaries.
    expect(searchIndex(w.db).search('far shore').groups.map((g) => g.id)).toEqual(['stories'])
    repo.saveSceneText(w.db, w.s4.id, null, 'They reached the far shore at last.')
    mem.putSummary(w.db, { level: 'scene', targetId: w.s4.id, text: 'The far shore, at last.', origin: 'text' })
    expect(searchIndex(w.db).search('far shore').groups.map((g) => g.id)).toEqual(['scenes', 'summaries', 'stories'])
  })

  it('ranks names first, and puts the kind whose name matches before the others', () => {
    const w = world()
    const r = searchIndex(w.db).search('ashford')
    expect(r.groups.slice(0, 2).map((g) => g.id)).toEqual(['place', 'character'])
    expect(titles(group(r, 'place'))).toEqual(['[Ashford] Hall'])
    repo.createEntry(w.db, 'character', { name: 'Nell', description: 'Works at Ashford Hall' })
    repo.createEntry(w.db, 'character', { name: 'Ashford', summary: 'The old lord' })
    expect(titles(group(searchIndex(w.db).search('ashford'), 'character'))).toEqual(['[Ashford]', 'Mara [Ashford]', 'Nell'])
  })

  it('finds summaries, private notes and scene card notes, chapters, stories and the style guide', () => {
    const w = world()
    const ix = searchIndex(w.db)
    const crossing = ix.search('crossing')
    expect(group(crossing, 'summaries')!.hits[0]).toMatchObject({ detail: 'Chapter summary · Book 1, Ch 2' })
    expect(group(crossing, 'summaries')!.hits[0].open).toEqual({
      kind: 'scene',
      sceneId: w.s3.id,
      storyId: w.book1.id,
      words: null,
      card: null
    })
    expect(titles(group(crossing, 'stories'))).toEqual(['The [Crossing]'])
    expect(group(crossing, 'stories')!.hits[0].detail).toBe('Book 1, Ch 2')

    // A scene's summary and its notes for the AI open the scene card at them.
    expect(group(ix.search('never comes'), 'summaries')!.hits[0].open).toEqual({
      kind: 'scene',
      sceneId: w.s1.id,
      storyId: w.book1.id,
      words: null,
      card: 'summary'
    })
    const lantern = group(ix.search('lantern'), 'notes')!.hits[0]
    expect(lantern.detail).toBe('Notes for the AI · Book 1, Ch 1, Sc 2')
    expect(lantern.open).toEqual({ kind: 'scene', sceneId: w.s2.id, storyId: w.book1.id, words: null, card: 'notes' })
    const note = group(ix.search('lost hand'), 'notes')!.hits[0]
    expect(note).toMatchObject({ detail: 'Private notes · Character' })
    expect(note.open).toEqual({ kind: 'entry', entryId: w.mara.id, entryKind: 'character', part: { kind: 'notes' }, words: 'lost' })
    expect(show(note.snippet)).toBe('Maybe she [lost] her [hand] in Book 2?')

    // The card's goal finds the scene, opening its card.
    const smugglers = ix.search('smugglers')
    expect(show(group(smugglers, 'scenes')!.hits[0].snippet)).toBe('Goal: Tobin learns about the [smugglers]')
    expect(group(smugglers, 'scenes')!.hits[0].open).toMatchObject({ card: 'goal', words: null })
    expect(group(ix.search('smuggling'), 'stories')!.hits[0]).toMatchObject({
      detail: 'Story',
      open: { kind: 'story', storyId: w.book1.id }
    })

    const style = group(ix.search('semicolons'), 'style')!.hits[0]
    expect(style).toMatchObject({ detail: 'Prose style', open: { kind: 'style', storyId: null } })
    expect(group(ix.search('suddenly'), 'style')!.hits[0].detail).toBe('Phrases to avoid')
  })

  it('lists a few per group, more when asked, and the open story first', () => {
    const w = world()
    const ix = searchIndex(w.db)
    const few = group(ix.search('the', { limit: 1 }), 'scenes')!
    expect(few.total).toBe(4)
    expect(few.hits).toHaveLength(1)
    expect(group(ix.search('the', { limit: 1, expand: ['scenes'] }), 'scenes')!.hits).toHaveLength(4)
    expect(titles(group(ix.search('iron gate', { storyId: w.book2.id }), 'scenes'))).toEqual(['Homecoming', 'The ferry'])
  })

  it('ranks scenes with the words in the title, then with the words together', () => {
    const w = world()
    repo.saveSceneText(w.db, w.s3.id, null, 'The gate was iron, and it held.')
    expect(titles(group(searchIndex(w.db).search('iron gate'), 'scenes'))).toEqual(['The ferry', 'Homecoming', 'Storm'])
    repo.updateScene(w.db, w.s3.id, { title: 'The iron gate' })
    expect(titles(group(searchIndex(w.db).search('iron gate'), 'scenes'))[0]).toBe('The [iron] [gate]')
  })

  it('opens a scene at words the editor finds there first', () => {
    const w = world()
    // "the gate" would be found in "the gatehouse" first; the snippet's own spot is chosen.
    repo.saveSceneText(w.db, w.s2.id, null, 'The gatehouse was dark.\n\nLater the gate opened.')
    const hit = group(searchIndex(w.db).search('gate '), 'scenes')!.hits.find((h) => h.open.kind === 'scene' && h.open.sceneId === w.s2.id)!
    expect(hit.open).toMatchObject({ words: 'the gate opened.' })
  })
})

describe('keeping up with changes', () => {
  it('reads again only what was written since the last search', () => {
    const w = world()
    const ix = searchIndex(w.db)
    ix.search('mara')
    expect(ix.fresh).toBe(true)
    // Nothing written: no statements at all.
    expect(queries(w.db, () => ix.search('gate'))).toBe(0)

    repo.saveSceneText(w.db, w.s3.id, null, 'The lighthouse keeper waved.')
    expect(ix.fresh).toBe(false)
    expect(queries(w.db, () => expect(titles(group(ix.search('lighthouse'), 'scenes'))).toEqual(['Storm']))).toBe(1)
    expect(group(ix.search('elodie'), 'scenes')).toBeUndefined()

    // An entry is read again with its changes over the story: two statements.
    repo.updateEntry(w.db, w.tobin.id, { aliases: ['Tob the Quiet'] })
    expect(queries(w.db, () => expect(titles(group(ix.search('quiet tob'), 'character'))).toEqual(['[Tob]in']))).toBe(2)
  })

  it('finds an entry by what the memory has about it over the story, and keeps up as that changes', () => {
    const w = world()
    const ix = searchIndex(w.db)
    expect(group(ix.search('left hand'), 'character')).toBeUndefined()
    const c = mem.insertChange(w.db, {
      entryId: w.mara.id,
      anchor: 'scene',
      sceneId: w.s3.id,
      kind: 'update',
      payload: { note: 'Lost her left hand' },
      origin: 'text'
    })
    mem.insertChange(w.db, {
      entryId: w.mara.id,
      anchor: 'baseline',
      kind: 'knowledge',
      payload: { factId: 'f1', fact: 'The harbourmaster is her uncle' },
      origin: 'adam'
    })
    const mara = group(ix.search('left hand'), 'character')!.hits[0]
    expect(show(mara.title)).toBe('Mara Ashford')
    expect(show(mara.snippet)).toBe('Changes over time: Lost her [left] [hand]')
    expect(mara.open).toMatchObject({ part: { kind: 'changes' }, words: 'left hand' })
    // Labelled as the section of the page that lists it, where the page opens.
    const uncle = group(ix.search('harbourmaster uncle'), 'character')!.hits[0]
    expect(show(uncle.snippet)).toBe('Knows at the start: The [harbourmaster] is her [uncle]')
    expect(uncle.open).toMatchObject({ part: { kind: 'knows' } })

    mem.replaceChange(w.db, c.id, {
      entryId: w.mara.id,
      anchor: 'scene',
      sceneId: w.s3.id,
      kind: 'update',
      payload: { note: 'Lost her right hand' },
      origin: 'adam'
    })
    expect(group(ix.search('left hand'), 'character')).toBeUndefined()
    expect(group(ix.search('right hand'), 'character')!.hits[0].open).toEqual({
      kind: 'entry',
      entryId: w.mara.id,
      entryKind: 'character',
      part: { kind: 'changes' },
      words: 'right hand'
    })
    mem.deleteChange(w.db, c.id)
    expect(group(ix.search('right hand'), 'character')).toBeUndefined()
  })

  it('finds how an entry stands with others at the start under its relationships, or its connections', () => {
    const w = world()
    const ix = searchIndex(w.db)
    const rel = (entryId: string, otherId: string, type: string, feels: string): void =>
      void mem.insertChange(w.db, {
        entryId,
        anchor: 'baseline',
        kind: 'relationship',
        payload: { otherId, type, feels, otherFeels: '' },
        origin: 'adam'
      })
    rel(w.mara.id, w.tobin.id, 'cousin', 'fiercely protective')
    rel(w.hall.id, w.mara.id, 'home of', 'long neglected')
    const mara = group(ix.search('fiercely'), 'character')!.hits[0]
    expect(show(mara.snippet)).toBe('Relationships: cousin · [fiercely] protective')
    expect(mara.open).toMatchObject({ entryId: w.mara.id, part: { kind: 'relationships' }, words: 'fiercely' })
    expect(show(group(ix.search('neglected'), 'place')!.hits[0].snippet)).toBe('Connections: home of · long [neglected]')
    // Later on in the story, it is a change over time.
    void mem.insertChange(w.db, {
      entryId: w.tobin.id,
      anchor: 'scene',
      sceneId: w.s4.id,
      kind: 'relationship',
      payload: { otherId: w.mara.id, type: 'rival', feels: 'bitter', otherFeels: '' },
      origin: 'text'
    })
    expect(group(ix.search('bitter'), 'character')!.hits[0].open).toMatchObject({ entryId: w.tobin.id, part: { kind: 'changes' } })
  })

  it('follows scenes moved, deleted and brought back, and entries deleted and brought back', () => {
    const w = world()
    const ix = searchIndex(w.db)
    expect(group(ix.search('homecoming'), 'scenes')!.hits[0].detail).toBe('Book 2, Ch 1, Sc 1')
    repo.moveScene(w.db, w.s4.id, w.ch1.id, 0)
    expect(group(ix.search('homecoming'), 'scenes')!.hits[0].detail).toBe('Book 1, Ch 1, Sc 1')
    expect(group(ix.search('ferry'), 'scenes')!.hits[0].detail).toBe('Book 1, Ch 1, Sc 2')

    repo.deleteScene(w.db, w.s4.id)
    expect(group(ix.search('homecoming'), 'scenes')).toBeUndefined()
    repo.restoreDeleted(w.db, 'scene', w.s4.id)
    expect(titles(group(ix.search('homecoming'), 'scenes'))).toEqual(['[Homecoming]'])

    // A deleted chapter takes its scenes, summaries and notes with it until it is back.
    repo.deleteChapter(w.db, w.ch1.id)
    const r = ix.search('lantern mara')
    expect(r.groups).toEqual([])
    expect(group(ix.search('ferry'), 'summaries')).toBeUndefined()
    repo.restoreDeleted(w.db, 'chapter', w.ch1.id)
    expect(group(ix.search('lantern'), 'notes')!.total).toBe(1)

    repo.deleteEntry(w.db, w.mara.id)
    expect(group(ix.search('kestrel'), 'character')).toBeUndefined()
    repo.restoreDeleted(w.db, 'entry', w.mara.id)
    expect(titles(group(ix.search('kestrel'), 'character'))).toEqual(['Mara Ashford'])
  })

  it('follows summaries, chapters, stories and the style guide', () => {
    const w = world()
    const ix = searchIndex(w.db)
    ix.search('x')
    mem.putSummary(w.db, { level: 'scene', targetId: w.s1.id, text: 'Everyone waits at the quay.', origin: 'adam' })
    expect(titles(group(ix.search('quay'), 'summaries'))).toEqual(['The ferry'])
    expect(group(ix.search('never comes'), 'summaries')).toBeUndefined()
    repo.updateChapter(w.db, w.ch2.id, { title: 'Breakwater' })
    expect(titles(group(ix.search('breakw'), 'stories'))).toEqual(['[Breakw]ater'])
    repo.updateStory(w.db, w.book2.id, { title: 'The Return Home' })
    expect(group(ix.search('homecoming'), 'scenes')!.hits[0].detail).toBe('The Return Home, Ch 1, Sc 1')
    repo.setMeta(w.db, 'style', JSON.stringify({ notes: 'British spelling throughout' }))
    expect(group(ix.search('british'), 'style')!.hits[0].detail).toBe('Notes')
    expect(group(ix.search('semicolons'), 'style')).toBeUndefined()
  })

  it('works on a world whose changes it cannot follow, by reading it again after a write', () => {
    const w = world()
    const ix = new SearchIndex(w.db)
    // Another index on the same database replaces the change feed's callback.
    ;(ix as unknown as { following: boolean }).following = false
    expect(titles(group(ix.search('ferry'), 'scenes'))).toEqual(['The [ferry]'])
    repo.saveSceneText(w.db, w.s3.id, null, 'A ferry again.')
    expect(titles(group(ix.search('ferry'), 'scenes'))).toEqual(['The [ferry]', 'Storm'])
  })
})

describe('recent places', () => {
  it('names scenes and entries as they are now, leaving out deleted ones', () => {
    const w = world()
    const ix = searchIndex(w.db)
    repo.updateScene(w.db, w.s2.id, { title: 'The long night' })
    repo.deleteScene(w.db, w.s3.id)
    const hits: SearchHit[] = ix.places([
      { kind: 'scene', id: w.s2.id },
      { kind: 'scene', id: w.s3.id },
      { kind: 'entry', id: w.hall.id },
      { kind: 'entry', id: w.gone.id },
      { kind: 'entry', id: 'nothing' }
    ])
    expect(hits.map((h) => [show(h.title), h.detail])).toEqual([
      ['The long night', 'Book 1, Ch 1, Sc 2'],
      ['Ashford Hall', 'Place']
    ])
  })
})
