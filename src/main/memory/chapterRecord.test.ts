// End-of-chapter snapshots worked out from the story record, with no AI (long story memory fix 15): what changed in a
// chapter (notes, ties, deaths), who learned what and how (fix 9's ledger), the plot threads it set up or paid off (fix
// 10), the days it runs (fix 11), and how each character stands at its end. Invented story (tests/unit/chapterWorld.ts).

import { describe, expect, it } from 'vitest'
import { chapterWorld, change, setCard } from '../../../tests/unit/chapterWorld'
import { saveParas } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import { chapterSnapshot, entryNames, type RecordRead } from './chapterRecord'
import { changedLines, endLines } from './snapshot'
import { loadMemoryData, loadShape, writerData } from './scene'

const readOf = (db: Parameters<typeof loadShape>[0]): RecordRead => ({ shape: loadShape(db), data: writerData(db, loadMemoryData(db)) })

describe('a chapter’s snapshot, from the record', () => {
  it('says what changed in it, who learned what, the threads it set up and paid off, and when it runs', () => {
    const w = chapterWorld()
    const s = chapterSnapshot(w.db, w.chapters[1], readOf(w.db))!
    expect(s).toMatchObject({ chapterId: w.chapters[1], storyId: w.storyId, sceneId: w.scenes[1][2], span: 'Day 3, dusk to Day 5, morning (2 days)', days: 'Day 3 to Day 5' })
    const names = entryNames(w.db)
    expect(changedLines(s, names)).toEqual([
      'When: Day 3, dusk to Day 5, morning (2 days)',
      'Mara: lost her left hand (scene 1)',
      'Mara and Tobin: rival (scene 2)',
      'Edric: died in his chair (scene 3)',
      'Ash and Tobin learned: Mara is the heir (saw it, scene 3)',
      'Tobin came to believe wrongly: Ash sent the letter (scene 3)',
      'Plot thread set up: Who sent the letter? (scene 1)',
      'Plot thread paid off: The ferryman’s debt (scene 3)'
    ])
  })

  it('says how everyone in it stands at its end: where, looks a change set, what they hold, what they believe, who is dead', () => {
    const w = chapterWorld()
    const s = chapterSnapshot(w.db, w.chapters[1], readOf(w.db))!
    expect(endLines(s, entryNames(w.db))).toEqual([
      'Mara: last at The Quay (scene 3); Distinguishing marks: left hand missing; has the brass key',
      'Tobin: last at The Quay (scene 3); wrongly believes: Ash sent the letter',
      'Edric: dead',
      'Plot threads still open: Who sent the letter?'
    ])
  })

  it('is as of its own end: an earlier chapter knows nothing of a later one', () => {
    const w = chapterWorld()
    const s = chapterSnapshot(w.db, w.chapters[0], readOf(w.db))!
    const names = entryNames(w.db)
    expect(changedLines(s, names)).toEqual(['When: Day 1 to Day 2 (1 day)', 'Plot thread set up: The ferryman’s debt (scene 1)'])
    expect(endLines(s, names)).toEqual(['Mara: last at The Mill (scene 2)', 'Tobin: last at The Mill (scene 2)', 'Plot threads still open: The ferryman’s debt'])
  })

  it('carries how things stand into a later chapter where nothing changed them, and only what still holds', () => {
    const w = chapterWorld()
    const s = chapterSnapshot(w.db, w.chapters[2], readOf(w.db))!
    const names = entryNames(w.db)
    expect(changedLines(s, names)).toEqual(['When: Day 6 to Day 7 (1 day)'])
    expect(endLines(s, names)).toEqual([
      'Mara: last at The Mill (scene 2); Distinguishing marks: left hand missing; has the brass key',
      'Tobin: last at The Mill (scene 2); wrongly believes: Ash sent the letter',
      'Plot threads still open: Who sent the letter?'
    ])
    // She gives the key away in chapter 3: she no longer has it at its end.
    change(w.db, w.ids.mara, w.scenes[2][1], { kind: 'relationship', payload: { otherId: w.ids.key, type: 'formerly held', feels: '', otherFeels: '' } })
    const after = chapterSnapshot(w.db, w.chapters[2], readOf(w.db))!
    expect(endLines(after, names)[0]).toBe('Mara: last at The Mill (scene 2); Distinguishing marks: left hand missing')
  })

  it('names things as they are called now, so a rename never makes a snapshot out of date', () => {
    const w = chapterWorld()
    const s = chapterSnapshot(w.db, w.chapters[1], readOf(w.db))!
    repo.updateEntry(w.db, w.ids.mara, { name: 'Mara Venn' })
    expect(endLines(s, entryNames(w.db))[0]).toMatch(/^Mara Venn: /)
  })

  it('is none for a chapter with no words yet, and leaves out a scene with no words', () => {
    const w = chapterWorld()
    const empty = repo.createChapter(w.db, w.storyId).id
    repo.createScene(w.db, empty)
    expect(chapterSnapshot(w.db, empty, readOf(w.db))).toBeNull()
    // The chapter's last scene loses its words: the snapshot is as of the scene before, and its day is left out.
    saveParas(w.db, w.scenes[1][2], [], false)
    const s = chapterSnapshot(w.db, w.chapters[1], readOf(w.db))!
    expect(s.sceneId).toBe(w.scenes[1][1])
    expect(s.days).toBe('Day 3')
    expect(chapterSnapshot(w.db, 'no-such-chapter', readOf(w.db))).toBeNull()
  })

  it('a chapter with no When on its cards says nothing of time', () => {
    const w = chapterWorld()
    for (const id of w.scenes[1]) setCard(w.db, id, { when: '' })
    const s = chapterSnapshot(w.db, w.chapters[1], readOf(w.db))!
    expect(s.span).toBe('')
    expect(changedLines(s, entryNames(w.db))[0]).toBe('Mara: lost her left hand (scene 1)')
  })
})
