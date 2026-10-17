import { describe, expect, it } from 'vitest'
import type { StoryPlacement } from '@shared/api'
import * as repo from './repo'
import * as mem from './memory'
import {
  createSeries,
  createStoryAs,
  declineFollow,
  retireStarterStory,
  setLeadsIn,
  storyCast,
  storyDetails,
  storyPlacement,
  untouchedStarter,
  updateSeries
} from './stories'
import { memoryWorld } from '../../../tests/unit/helpers'
import { dbWorld, KNOWS } from '../../../tests/unit/testWorld'

const after = (id: string | null): StoryPlacement => ({
  kind: 'continues',
  startStoryId: id,
  startAt: 'end',
  startRefId: null,
  endAt: null,
  endRefId: null,
  leadsIntoId: null
})

describe('series', () => {
  it('makes a series after the others, and uses the one with the same name rather than a twin', () => {
    const db = memoryWorld('The Reach')
    const made = createSeries(db, '  The   Long Dark ')
    expect(made).toMatchObject({ name: 'The Long Dark', themes: '', tone: '', position: 1 })
    expect(createSeries(db, 'the long dark').id).toBe(made.id)
    expect(repo.listSeries(db).map((s) => s.name)).toEqual(['The Reach', 'The Long Dark'])
    expect(() => createSeries(db, '  ')).toThrow('Give the new series a name.')
  })

  it('renames a series and keeps its themes and tone, keeping the old name when the new one is blank', () => {
    const db = memoryWorld('The Reach')
    const [s] = repo.listSeries(db)
    expect(updateSeries(db, s.id, { name: 'Reach', themes: 'Loyalty', tone: 'Grim' })).toMatchObject({
      name: 'Reach',
      themes: 'Loyalty',
      tone: 'Grim'
    })
    expect(updateSeries(db, s.id, { name: ' ' })).toMatchObject({ name: 'Reach', themes: 'Loyalty' })
    expect(() => updateSeries(db, 'gone', { name: 'X' })).toThrow('That series no longer exists.')
  })
})

describe('making a story', () => {
  it('makes it with its placement, first chapter and scene, time gap and new series in one go', () => {
    const db = memoryWorld('The Reach')
    const [book1] = repo.listStories(db)
    const made = createStoryAs(db, {
      title: 'The Long Dark',
      seriesId: null,
      newSeries: 'The Long Dark',
      placement: after(book1.id),
      timeGap: ' 200 years '
    })
    expect(made.story).toMatchObject({
      title: 'The Long Dark',
      kind: 'continues',
      startStoryId: book1.id,
      startAt: 'end',
      timeGap: '200 years'
    })
    expect(repo.listSeries(db).find((s) => s.id === made.story.seriesId)?.name).toBe('The Long Dark')
    const outline = repo.getOutline(db, made.story.id)
    expect(outline.chapters.map((c) => c.title)).toEqual(['Chapter 1'])
    expect(outline.scenes.map((s) => s.id)).toEqual([made.sceneId])
  })

  it('makes a side story with where it starts and ends', () => {
    const w = dbWorld()
    const made = createStoryAs(w.db, {
      title: 'Thorn',
      seriesId: w.id('reach'),
      placement: {
        kind: 'side',
        startStoryId: w.id('b2'),
        startAt: 'chapter',
        startRefId: w.id('b2.c3'),
        endAt: 'chapter',
        endRefId: w.id('b2.c4'),
        leadsIntoId: null
      }
    })
    expect(made.story).toMatchObject({
      kind: 'side',
      startAt: 'chapter',
      startRefId: w.id('b2.c3'),
      endAt: 'chapter',
      endRefId: w.id('b2.c4')
    })
    expect(storyDetails(w.db, made.story.id).preview.knows).toBe(
      "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 3; Ash; Ember."
    )
  })

  it('leaves nothing behind when the placement is refused', () => {
    const db = memoryWorld('The Reach')
    const before = { stories: repo.listStories(db).length, series: repo.listSeries(db).length }
    const side: StoryPlacement = { ...after(null), kind: 'side' }
    expect(() => createStoryAs(db, { title: 'Ash', seriesId: null, newSeries: 'Ash', placement: side })).toThrow(
      'A side story needs a story to run alongside.'
    )
    expect({ stories: repo.listStories(db).length, series: repo.listSeries(db).length }).toEqual(before)
  })

  it('ends a still-running side story first in the same go, and says what it was before', () => {
    const w = dbWorld()
    const ash = repo.getStory(w.db, w.id('ash'))
    const placement: StoryPlacement = {
      kind: 'side',
      startStoryId: w.id('b2'),
      startAt: 'chapter',
      startRefId: w.id('b2.c1'),
      endAt: 'end',
      endRefId: null,
      leadsIntoId: null
    }
    const made = createStoryAs(w.db, {
      title: 'Thorn',
      seriesId: w.id('reach'),
      placement,
      endFirst: [{ storyId: ash.id, endRefId: w.id('b2.c1') }]
    })
    expect(repo.getStory(w.db, ash.id)).toMatchObject({ endAt: 'chapter', endRefId: w.id('b2.c1') })
    expect(made.endedFirst).toEqual([
      {
        storyId: ash.id,
        title: 'Ash',
        chapter: 'Ch 1',
        was: {
          kind: 'side',
          startStoryId: w.id('b2'),
          startAt: 'post',
          startRefId: null,
          endAt: 'chapter',
          endRefId: w.id('b2.c3'),
          leadsIntoId: null
        }
      }
    ])
    expect(storyDetails(w.db, made.story.id).preview.knows).toBe(
      "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 1; Ash. Does not know: Ember, which is still running here."
    )
  })

  it('leaves a story it can no longer end first as it is', () => {
    const w = dbWorld()
    const made = createStoryAs(w.db, {
      title: 'X',
      seriesId: null,
      placement: after(w.id('b4')),
      endFirst: [{ storyId: w.id('b3'), endRefId: w.id('b2.c1') }]
    })
    expect(made.endedFirst).toEqual([])
    expect(repo.getStory(w.db, w.id('b3'))).toMatchObject({ kind: 'continues', endAt: null })
  })

  it('refuses a series that no longer exists', () => {
    const db = memoryWorld('The Reach')
    expect(() => createStoryAs(db, { title: 'X', seriesId: 'gone', placement: after(null) })).toThrow('That series no longer exists.')
  })
})

describe('which story leads into the book', () => {
  it('is the last of the prequel chain until Adam marks another, and back again when he unmarks it', () => {
    const w = dbWorld()
    const leader = (): string | undefined => storyDetails(w.db, w.id('ym')).leadsInto?.leader.title
    expect(leader()).toBe('Young Mara III')
    setLeadsIn(w.db, w.id('ym2'), true)
    expect(leader()).toBe('Young Mara II')
    expect(storyDetails(w.db, w.id('ym3')).leadsInto).toMatchObject({
      book: { title: 'Book 1' },
      leader: { title: 'Young Mara II' },
      marked: true
    })
    setLeadsIn(w.db, w.id('ym'), true)
    expect(leader()).toBe('Young Mara')
    expect(
      repo
        .listStories(w.db)
        .filter((s) => s.leadsIn)
        .map((s) => s.title)
    ).toEqual(['Young Mara'])
    setLeadsIn(w.db, w.id('ym'), false)
    expect(leader()).toBe('Young Mara III')
  })

  it('is only for stories in a prequel chain', () => {
    const w = dbWorld()
    expect(() => setLeadsIn(w.db, w.id('b2'), true)).toThrow('Only a prequel, or a story that continues after one, leads into a book.')
  })
})

describe('story settings', () => {
  it('says what the story knows, who starts in it and its prequel cast', () => {
    const w = dbWorld()
    const ember = storyDetails(w.db, w.id('ember'))
    expect(ember.preview.knows).toBe(KNOWS.ember)
    expect(ember.preview.label).toBe('Side story during Book 2, after Ch 1 until the end of Ch 3')
    expect(storyDetails(w.db, w.id('kr')).startingHere).toEqual([
      { storyId: w.id('kret'), title: "Kell's Return", wouldStart: 'after Book 1, Ch 1' }
    ])
    // Young Mara's start-of-story description of Mara makes her part of its cast.
    expect(storyDetails(w.db, w.id('ym')).cast).toEqual([w.id('mara')])
    expect(storyDetails(w.db, w.id('b2')).cast).toEqual([])
  })

  it('has the placement as the memory has it once the story or chapter it starts in is deleted, which can be saved as it is', () => {
    const w = dbWorld()
    repo.deleteStory(w.db, w.id('b2'))
    // Ash takes over Book 2's start: after The Quiet Year, running to its end.
    const ash = storyDetails(w.db, w.id('ash'))
    expect(ash.placement).toEqual({
      kind: 'side',
      startStoryId: w.id('qy'),
      startAt: 'end',
      startRefId: null,
      endAt: 'end',
      endRefId: null,
      leadsIntoId: null
    })
    expect(ash.preview.problem).toBeNull()
    expect(repo.getStory(w.db, w.id('ash')).startStoryId).toBe(w.id('b2'))
    expect(() => mem.setStoryPlacement(w.db, w.id('ash'), ash.placement)).not.toThrow()

    repo.deleteChapter(w.db, w.id('b1.c1'))
    expect(storyPlacement(w.db, w.id('kr'))).toEqual({
      kind: 'side',
      startStoryId: w.id('b1'),
      startAt: 'post',
      startRefId: null,
      endAt: 'chapter',
      endRefId: w.id('b1.c2'),
      leadsIntoId: null
    })
    expect(() => storyPlacement(w.db, 'gone')).toThrow('That story no longer exists.')
  })

  it('stops asking "Should … now continue after it?" once Adam says No', () => {
    const w = dbWorld()
    const made = createStoryAs(w.db, { title: 'Interlude', seriesId: w.id('reach'), placement: after(w.id('b1')) })
    expect(storyDetails(w.db, made.story.id).mightFollow).toEqual([{ storyId: w.id('qy'), title: 'The Quiet Year' }])
    declineFollow(w.db, made.story.id)
    expect(storyDetails(w.db, made.story.id).mightFollow).toEqual([])
    // The answer is kept with the world, and the memory ignores it.
    expect(
      mem
        .listAnswers(w.db)
        .filter((a) => a.key === made.story.id)
        .map((a) => a.kind)
    ).toEqual(['follow-declined'])
    expect(storyDetails(w.db, w.id('ember')).preview.knows).toBe(KNOWS.ember)
    // His Undo of that No asks again.
    declineFollow(w.db, made.story.id, false)
    expect(storyDetails(w.db, made.story.id).mightFollow).toEqual([{ storyId: w.id('qy'), title: 'The Quiet Year' }])
    expect(mem.listAnswers(w.db).filter((a) => a.key === made.story.id)).toEqual([])
  })

  it('offers "When did these happen?" for a book written earlier that now continues after the story', () => {
    const w = dbWorld()
    expect(storyDetails(w.db, w.id('qy')).followers).toEqual([{ storyId: w.id('b2'), title: 'Book 2' }])
    expect(storyDetails(w.db, w.id('b1')).followers).toEqual([])
    const made = createStoryAs(w.db, { title: 'Interlude', seriesId: w.id('reach'), placement: after(w.id('b1')) })
    mem.setStoryPlacement(w.db, w.id('qy'), after(made.story.id))
    expect(storyDetails(w.db, made.story.id).followers).toEqual([{ storyId: w.id('qy'), title: 'The Quiet Year' }])
  })

  it('counts an entry the prequel was given a first-exists point for, and leaves deleted entries out', () => {
    const w = dbWorld()
    mem.addExistsPoint(w.db, { entryId: w.id('mill'), kind: 'story-pre', storyId: w.id('ym'), sceneId: null, byHand: false })
    expect(storyCast(w.db, w.id('ym')).sort()).toEqual([w.id('mara'), w.id('mill')].sort())
    repo.deleteEntry(w.db, w.id('mill'))
    expect(storyCast(w.db, w.id('ym'))).toEqual([w.id('mara')])
  })
})

describe('the starter story', () => {
  const mother = (db: ReturnType<typeof memoryWorld>, startStoryId: string | null) =>
    createStoryAs(db, { title: 'Mother', seriesId: null, placement: after(startStoryId) })

  it('stays while it is the only story: Adam starts writing in it', () => {
    const db = memoryWorld()
    expect(untouchedStarter(db)).toBeNull()
    expect(retireStarterStory(db)).toBe(false)
    expect(repo.listStories(db).map((s) => s.title)).toEqual(['Book 1'])
  })

  it('goes to Recently deleted once a story of his own is made, keeping the codex where it was', () => {
    const db = memoryWorld()
    const [book1] = repo.listStories(db)
    const early = repo.createEntry(db, 'event', { name: 'The storm' }, { origin: 'ai', originStoryId: book1.id })
    const made = mother(db, book1.id)
    expect(repo.listStories(db).map((s) => s.title)).toEqual(['Mother'])
    expect((db.prepare('SELECT deleted_at FROM stories WHERE id = ?').get(book1.id) as { deleted_at: string | null }).deleted_at).toBeTruthy()
    expect(repo.getEntry(db, early.id).originStoryId).toBeNull()
    expect(mem.listExistsPoints(db).filter((p) => p.entryId === early.id).map((p) => p.kind)).toEqual(['world'])
    // The new story now opens the world.
    expect(mem.firstStoryId(db)).toBe(made.story.id)
  })

  it('stays once anything is in it: words, a card, a title, its memory', () => {
    const touched: ((db: ReturnType<typeof memoryWorld>, sceneId: string, storyId: string) => void)[] = [
      (db, sceneId) => void db.prepare("UPDATE scenes SET text = 'It began.', word_count = 2 WHERE id = ?").run(sceneId),
      (db, sceneId) => void repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, when: 'Day 1' }),
      (db, _scene, storyId) => void repo.updateStory(db, storyId, { title: 'The Reach' }),
      (db, _scene, storyId) => void repo.updateStory(db, storyId, { premise: 'A long winter.' }),
      (db, sceneId) => void repo.createScene(db, repo.getSceneMeta(db, sceneId).chapterId, {}),
      (db, sceneId, storyId) => {
        const e = repo.createEntry(db, 'character', { name: 'Ann' })
        mem.insertChange(db, { kind: 'update', payload: { note: '' }, entryId: e.id, anchor: 'scene', storyId, sceneId, origin: 'text' })
      }
    ]
    for (const touch of touched) {
      const db = memoryWorld()
      const [book1] = repo.listStories(db)
      touch(db, repo.getOutline(db, book1.id).scenes[0].id, book1.id)
      mother(db, book1.id)
      expect(repo.listStories(db).some((s) => s.id === book1.id)).toBe(true)
    }
  })

  it('is put away in a world that made its story before this, when asked', () => {
    const db = memoryWorld()
    const [book1] = repo.listStories(db)
    const later = repo.createStory(db, { title: 'Mother' })
    repo.createChapter(db, later.id, {})
    expect(untouchedStarter(db)).toBe(book1.id)
    expect(retireStarterStory(db)).toBe(true)
    expect(repo.listStories(db).map((s) => s.title)).toEqual(['Mother'])
    expect(retireStarterStory(db)).toBe(false)
  })
})
