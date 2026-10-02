// The fixed test world (spec, Multi-story rules: "Test world"), checked on every build: each story's
// "knows what happened in" sentence and the state of a few entries, through plain data and through
// a real database. If one of these fails, a multi-story rule has changed.

import { describe, expect, it } from 'vitest'
import type { ChangeData, EntryState, ID } from '@shared/types'
import { placementProblem, previousSceneStep } from '../../src/main/memory/line'
import * as mem from '../../src/main/db/memory'
import * as repo from '../../src/main/db/repo'
import { sceneMemory } from '../../src/main/memory/scene'
import { UserError } from '../../src/main/util'
import { KNOWS, ashHairLast, dbWorld, emberFirst, expectedPoints, pureWorld, theWorld, type TestWorld } from './testWorld'

const routes: [string, () => TestWorld][] = [
  ['as plain data', () => pureWorld()],
  ['in a database', () => dbWorld()]
]

const entry = (s: { entries: Map<ID, EntryState> }, w: TestWorld, key: string): EntryState | undefined => s.entries.get(w.id(key))
const notes = (e: EntryState | undefined): string[] => e?.happened.map((h) => h.note) ?? []

describe.each(routes)('the test world %s', (_, make) => {
  const w = make()

  it.each(Object.entries(KNOWS))('%s knows the right stories', (story, sentence) => {
    expect(w.knows(story)).toBe(sentence)
  })

  it('knows sentences inside a story follow the scene', () => {
    expect(w.knows('b1', 'b1.c2.s2')).toBe('This story knows only the starting setup.')
    // Kell's Road ended after Ch 2, so the rest of Book 1 knows it.
    expect(w.knows('b1', 'b1.c3.s1')).toBe("This story knows what happened in: Kell's Road.")
    // Both novellas ended after Ch 3 of Book 2.
    expect(w.knows('b2', 'b2.c3.s1')).toBe("This story knows what happened in: Book 1; Kell's Road; The Quiet Year.")
    expect(w.knows('b2', 'b2.c4.s1')).toBe("This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Ash; Ember.")
    expect(w.knows('b2', 'end')).toBe("This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Ash; Ember; Wolf Winter.")
  })

  it('Mara loses her hand in Book 1 Ch 2 Sc 2, and only from then on', () => {
    const during = w.state('b1', 'b1.c2.s2')
    expect(entry(during, w, 'mara')?.fields.marks).toBe('none')
    expect(notes(entry(during, w, 'mara'))).not.toContain('lost her left hand')
    const after = w.state('b1', 'b1.c3.s1')
    expect(entry(after, w, 'mara')?.fields.marks).toBe('left hand missing')
    expect(entry(after, w, 'mara')?.happened).toEqual([
      expect.objectContaining({ note: 'lost her left hand', where: 'Book 1, Ch 2, Sc 2' })
    ])
    expect(entry(after, w, 'mara')?.changed).toContain('marks')
    expect(entry(w.state('b4'), w, 'mara')?.fields.marks).toBe('left hand missing')
  })

  it('in the what-if she keeps it', () => {
    const s = w.state('keep', 'keep.c1.s1')
    expect(entry(s, w, 'mara')?.fields.marks).toBe('none')
    expect(notes(entry(s, w, 'mara'))).toEqual([])
    expect(
      w
        .state('keep', 'end')
        .entries.get(w.id('mara'))
        ?.happened.map((h) => h.note)
    ).toEqual(['learned to fight with both hands'])
  })

  it('Mara and Tobin go from friends to enemies in Book 2 Ch 2 Sc 2', () => {
    const pair = (s: ReturnType<TestWorld['state']>) =>
      s.relationships.find((r) => [r.aId, r.bId].sort().join() === [w.id('mara'), w.id('tobin')].sort().join())
    const before = pair(w.state('b2', 'b2.c2.s2'))
    expect(before).toMatchObject({
      aId: w.id('mara'),
      bId: w.id('tobin'),
      type: 'friend',
      aFeels: 'trusts him',
      bFeels: 'would die for her',
      where: ''
    })
    const after = pair(w.state('b2', 'b2.c3.s1'))
    expect(after).toMatchObject({
      aId: w.id('tobin'),
      bId: w.id('mara'),
      type: 'enemy',
      aFeels: 'betrayed',
      bFeels: 'guilty',
      where: 'Book 2, Ch 2, Sc 2'
    })
    expect(w.state('b2', 'b2.c3.s1').relationships.filter((r) => r.aId === w.id('mara') || r.bId === w.id('mara'))).toHaveLength(1)
  })

  it('Tobin learns Mara is the heir in Book 1 Ch 3 Sc 1; Kell knew it from his own story', () => {
    const fact = (s: ReturnType<TestWorld['state']>) => s.facts.find((f) => f.factId === 'f-heir')
    expect(fact(w.state('b1', 'b1.c2.s2'))).toBeUndefined()
    // In the scene where he learns it, he doesn't know it yet; Kell's Road has ended, so Kell does.
    expect(fact(w.state('b1', 'b1.c3.s1'))?.knownBy).toEqual([w.id('kell')])
    expect(fact(w.state('b1', 'b1.c3.s2'))?.knownBy.sort()).toEqual([w.id('kell'), w.id('tobin')].sort())
    expect(fact(w.state('b1', 'b1.c3.s2'))?.fact).toBe('Mara is the heir to the Reach.')
  })

  it('a plot thread is opened in Book 1 and resolved in Book 3', () => {
    const thread = (s: ReturnType<TestWorld['state']>) => s.threads.find((t) => t.entryId === w.id('burned'))
    expect(thread(w.state('b1', 'b1.c1.s2'))).toEqual({ entryId: w.id('burned'), status: 'open', setUp: '', paidOff: '' })
    expect(thread(w.state('b2'))).toEqual({ entryId: w.id('burned'), status: 'open', setUp: 'Book 1, Ch 1, Sc 2', paidOff: '' })
    expect(thread(w.state('b3', 'b3.c1.s2'))?.status).toBe('open')
    expect(thread(w.state('b4'))).toEqual({
      entryId: w.id('burned'),
      status: 'resolved',
      setUp: 'Book 1, Ch 1, Sc 2',
      paidOff: 'Book 3, Ch 1, Sc 2'
    })
  })

  it('Wren first appears in Book 2 Ch 4 Sc 1 and is not sent before', () => {
    expect(entry(w.state('b2', 'b2.c3.s1'), w, 'wren')).toBeUndefined()
    expect(w.state('b2', 'b2.c3.s1').absent.has(w.id('wren'))).toBe(true)
    const first = w.state('b2', 'b2.c4.s1')
    expect(entry(first, w, 'wren')).toBeDefined()
    expect([...first.firstHere]).toEqual([w.id('wren')])
    expect(w.state('b3').firstHere.size).toBe(0)
    expect(entry(w.state('b3'), w, 'wren')).toBeDefined()
    // Kell first appears in his own story, and Book 1 hears of him once it has ended.
    expect(entry(w.state('b1', 'b1.c1.s2'), w, 'kell')).toBeUndefined()
    expect([...w.state('kr', 'kr.c1.s1').firstHere]).toEqual([w.id('kell')])
    expect(entry(w.state('b1', 'b1.c3.s1'), w, 'kell')).toBeDefined()
  })

  it('a novella and its host clash over Mara’s hair: the host wins, other changes in the novella count', () => {
    const b3 = entry(w.state('b3'), w, 'mara')
    expect(b3?.fields.hair).toBe('cropped short')
    expect(b3?.fields.age).toBe('19')
    expect(notes(b3)).toEqual(['lost her left hand', 'cut her hair', 'shaved her head', 'turned nineteen', 'wintered in the north'])
    // Inside Ash, Book 2 hadn't cut her hair yet.
    expect(entry(w.state('ash', 'ash.c1.s2'), w, 'mara')?.fields.hair).toBe('shaved')
    // Book 2 itself, after both novellas ended.
    expect(entry(w.state('b2', 'b2.c4.s1'), w, 'mara')?.fields.hair).toBe('cropped short')
  })

  it('the prequel starts from a full description, on both sides of each relationship', () => {
    const s = w.state('ym', 'ym.c1.s1')
    const mara = entry(s, w, 'mara')
    expect(mara?.description).toBe('A girl of nine who has never left the mill town.')
    expect(mara?.fields).toMatchObject({ hair: 'in two plaits', marks: 'none' })
    expect(s.relationships).toEqual([
      expect.objectContaining({ aId: w.id('mara'), bId: w.id('tobin'), type: 'neighbour', where: 'the start of Young Mara' })
    ])
    expect(s.facts).toEqual([{ factId: 'f-weir', fact: 'The river can be crossed at the weir.', knownBy: [w.id('mara')] }])
    // Book 1 never sees it.
    const b1 = w.state('b1', 'b1.c1.s1')
    expect(entry(b1, w, 'mara')?.description).toBe("A smith's daughter with a quick temper.")
    expect(b1.relationships[0]?.type).toBe('friend')
    // A place found in Book 1 exists from Book 1's start, so its prequel sees it; the own version from the beginning doesn't.
    expect(entry(s, w, 'mill')).toBeDefined()
    expect(entry(b1, w, 'mill')).toBeDefined()
    expect(entry(w.state('other', 'other.c1.s1'), w, 'mill')).toBeUndefined()
    expect(entry(w.state('other', 'other.c1.s1'), w, 'mara')).toBeDefined()
  })

  it('a story written later and set between Book 1 and Book 2: Book 2 and later books know it, Book 1 does not', () => {
    expect(w.line('b2', 'start').segments.map((s) => s.storyId)).toEqual([w.id('b1'), w.id('kr'), w.id('qy'), w.id('b2')])
    expect(notes(entry(w.state('b2', 'b2.c1.s1'), w, 'tobin'))).toEqual(['mended the ferry'])
    expect(notes(entry(w.state('b4'), w, 'tobin'))).toContain('mended the ferry')
    expect(notes(entry(w.state('b1', 'end'), w, 'tobin'))).toEqual([])
    expect(previousSceneStep(w.line('b2', 'b2.c1.s1'))?.sceneId).toBe(w.id('qy.c1.s1'))
  })

  it('a time gap: Mara died long ago in The Long Dark, but not in its prequel', () => {
    expect(notes(entry(w.state('ld', 'ld.c1.s1'), w, 'mara'))).toContain('died long ago')
    expect(entry(w.state('ld', 'ld.c1.s1'), w, 'mara')?.happened.at(-1)?.where).toBe('the start of The Long Dark')
    expect(notes(entry(w.state('bd', 'bd.c1.s1'), w, 'mara'))).not.toContain('died long ago')
    // Ilse is made by a start-of-story change: after it, so the prequel doesn't see her; the side story from the start does.
    expect(entry(w.state('bd', 'bd.c1.s1'), w, 'ilse')).toBeUndefined()
    expect(entry(w.state('lan', 'lan.c1.s1'), w, 'ilse')?.description).toBe("Mara's great-granddaughter, keeper of the lamp.")
    expect(notes(entry(w.state('lan', 'lan.c1.s1'), w, 'mara'))).toContain('died long ago')
  })

  it('a character made by hand in North 1 exists from its start, and nowhere in the first series', () => {
    expect(entry(w.state('n1'), w, 'hal')).toBeDefined()
    expect(entry(w.state('s4'), w, 'hal')).toBeDefined()
    expect(entry(w.state('b4'), w, 'hal')).toBeUndefined()
  })

  it('side stories ending at the same point go in the order they start, or in Adam’s order', () => {
    const sides = (x: TestWorld) =>
      x
        .line('wolf', 'start')
        .segments.filter((s) => s.via === 'side')
        .map((s) => s.storyId)
    expect(sides(w)).toEqual([w.id('kr'), w.id('ash'), w.id('ember')])
  })

  it('the previous scene is the last one on the line, never a side story added whole', () => {
    const prev = (story: string, scene: string): ID | null => previousSceneStep(w.line(story, scene))?.sceneId ?? null
    expect(prev('b1', 'b1.c1.s1')).toBeNull()
    expect(prev('b1', 'b1.c3.s1')).toBe(w.id('b1.c2.s2'))
    expect(prev('ym', 'ym.c1.s1')).toBeNull()
    expect(prev('ym2', 'ym2.c1.s1')).toBe(w.id('ym.c1.s2'))
    expect(prev('ash', 'ash.c1.s1')).toBe(w.id('qy.c1.s1'))
    expect(prev('b2', 'b2.c4.s1')).toBe(w.id('b2.c3.s1'))
    expect(prev('b3', 'b3.c1.s1')).toBe(w.id('b2.c6.s1'))
    expect(prev('kret', 'kret.c1.s1')).toBe(w.id('kr.c1.s2'))
    expect(prev('keep', 'keep.c1.s1')).toBe(w.id('b1.c2.s1'))
    expect(prev('n1', 'n1.c1.s1')).toBeNull()
  })

  it('refuses a loop, in plain words', () => {
    const sideDuring = (story: string, ref: string) => ({
      kind: 'side' as const,
      startStoryId: w.id(story),
      startAt: 'chapter' as const,
      startRefId: w.id(ref),
      endAt: 'end' as const,
      endRefId: null,
      leadsIntoId: null
    })
    expect(placementProblem(w.shape, w.id('b1'), sideDuring('kr', 'kr.c1'))).toBe(
      "Book 1 can't start during Kell's Road, because Kell's Road starts during Book 1."
    )
    const after = (story: string) => ({
      kind: 'continues' as const,
      startStoryId: w.id(story),
      startAt: 'end' as const,
      startRefId: null,
      endAt: null,
      endRefId: null,
      leadsIntoId: null
    })
    expect(placementProblem(w.shape, w.id('b2'), after('b4'))).toBe(
      "Book 2 can't continue after Book 4, because Book 4 follows on from Book 2."
    )
    expect(placementProblem(w.shape, w.id('b1'), after('ym3'))).toBe(
      "Book 1 can't continue after Young Mara III, because Young Mara III follows on from Book 1."
    )
    expect(placementProblem(w.shape, w.id('b1'), after('b1'))).toBe("Book 1 can't continue after itself.")
    expect(placementProblem(w.shape, w.id('b3'), after('kret'))).toBeNull()
  })
})

describe('the test world with Adam’s answers', () => {
  it.each([
    ['as plain data', () => pureWorld(theWorld, [emberFirst, ashHairLast])],
    ['in a database', () => dbWorld(theWorld, [emberFirst, ashHairLast])]
  ])('%s: Ember before Ash, and Ash’s haircut happened last', (_, make) => {
    const w = make()
    expect(w.knows('wolf')).toBe(
      "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 5; Ember; Ash."
    )
    expect(w.state('b3').entries.get(w.id('mara'))?.fields.hair).toBe('shaved')
    expect(w.state('b2', 'b2.c4.s1').entries.get(w.id('mara'))?.fields.hair).toBe('shaved')
  })
})

describe('the test world in a database', () => {
  const w = dbWorld()
  const { db } = w

  it('gives each entry its default first-exists point', () => {
    for (const e of theWorld.entries) {
      const got = mem.listExistsPoints(db, w.id(e.key)).map((p) => ({ kind: p.kind, storyId: p.storyId, sceneId: p.sceneId }))
      expect(got, e.name).toEqual(expectedPoints(theWorld, w, e.key))
    }
  })

  it('agrees with the plain-data world on every scene', () => {
    const pure = pureWorld()
    for (const s of theWorld.stories) {
      for (const c of s.chapters.flatMap((n, ci) => Array.from({ length: n }, (_, si) => `${s.key}.c${ci + 1}.s${si + 1}`))) {
        expect(w.knows(s.key, c), c).toBe(pure.knows(s.key, c))
        const a = w.state(s.key, c)
        const b = pure.state(s.key, c)
        const names = (x: typeof a) =>
          [...x.entries.values()]
            .map((e) => `${e.name}: ${e.description} ${JSON.stringify(e.fields)} ${e.happened.map((h) => h.note)}`)
            .sort()
        expect(names(a), c).toEqual(names(b))
        expect(a.relationships.length, c).toBe(b.relationships.length)
        expect(
          a.threads.map((t) => t.status),
          c
        ).toEqual(b.threads.map((t) => t.status))
      }
    }
  })

  it('reads a scene: sentence, previous scene, entries, labels for entries not here, bring-about', () => {
    repo.saveSceneText(db, w.id('b1.c3.s2'), null, 'Tobin poled the ferry across the black water.')
    const m = sceneMemory(db, w.id('b1.c1.s2'))
    expect(m.knows).toBe('This story knows only the starting setup.')
    expect(m.previous?.sceneId).toBe(w.id('b1.c1.s1'))
    expect(m.entries.map((e) => e.name).sort()).toEqual(['Harrow Mill', 'Mara', 'Tobin', 'Who burned the mill?'])
    const label = (name: string) => m.elsewhere.find((x) => x.entry.name === name)?.label
    expect(label('Kell')).toBe("from Kell's Road, not in this story so far")
    expect(label('Wren')).toBe('from Book 2, not in this story so far')
    expect(label('Hal')).toBe('from North 1, not in this story so far')
    expect(m.bringAbout.map((c) => c.kind)).toEqual(['thread'])
    expect(m.threads).toEqual([expect.objectContaining({ status: 'open', setUp: '' })])

    const later = sceneMemory(db, w.id('b1.c3.s2'))
    expect(later.knows).toBe("This story knows what happened in: Kell's Road.")
    expect(later.previous?.sceneId).toBe(w.id('b1.c3.s1'))
    expect(later.facts.find((f) => f.factId === 'f-heir')?.knownBy.sort()).toEqual([w.id('kell'), w.id('tobin')].sort())

    expect(later.previous).toMatchObject({ storyId: w.id('b1'), storyTitle: 'Book 1', otherStory: null })
    const b3 = sceneMemory(db, w.id('b3.c1.s1'))
    expect(b3.previous).toMatchObject({
      sceneId: w.id('b2.c6.s1'),
      title: 'Scene 1',
      storyId: w.id('b2'),
      storyTitle: 'Book 2',
      otherStory: { ended: true, timeGap: '' }
    })
    // A later series 200 years on: the previous scene is how Book 4 ended, with The Long Dark's time gap.
    db.prepare('UPDATE stories SET time_gap = ? WHERE id = ?').run('200 years', w.id('ld'))
    expect(sceneMemory(db, w.id('ld.c1.s1')).previous).toMatchObject({
      storyTitle: 'Book 4',
      otherStory: { ended: true, timeGap: '200 years' }
    })
    // A side story starting partway through its book: where that book had got to.
    expect(sceneMemory(db, w.id('ember.c1.s1')).previous).toMatchObject({ storyId: w.id('b2'), otherStory: { ended: false } })
    const wren = sceneMemory(db, w.id('b2.c3.s1')).elsewhere.find((x) => x.entry.name === 'Wren')
    expect(wren?.label).toBe('not in the story yet at this point')
    expect(sceneMemory(db, w.id('b2.c4.s1')).firstHere).toEqual([w.id('wren')])
    const ilse = sceneMemory(db, w.id('bd.c1.s1')).elsewhere.find((x) => x.entry.name === 'Ilse')
    expect(ilse?.label).toBe('not in the story yet at this point')
    expect(sceneMemory(db, w.id('b1.c2.s2')).bringAbout.map((c) => c.kind === 'update' && c.payload.note)).toEqual(['lost her left hand'])
  })

  it('previousScene in the repo goes through the line', () => {
    repo.saveSceneText(db, w.id('b2.c6.s1'), null, 'The last of Book 2.')
    expect(repo.previousScene(db, w.id('b3.c1.s1'))?.text).toBe('The last of Book 2.')
    expect(repo.previousScene(db, w.id('ym.c1.s1'))).toBeNull()
    expect(repo.previousScene(db, w.id('ash.c1.s1'))?.id).toBe(w.id('qy.c1.s1'))
  })

  it('refuses a loop and changes nothing', () => {
    const before = repo.getStory(db, w.id('b1'))
    expect(() =>
      mem.setStoryPlacement(db, w.id('b1'), {
        kind: 'side',
        startStoryId: w.id('kr'),
        startAt: 'chapter',
        startRefId: w.id('kr.c1'),
        endAt: 'end',
        endRefId: null,
        leadsIntoId: null
      })
    ).toThrow(new UserError("Book 1 can't start during Kell's Road, because Kell's Road starts during Book 1."))
    expect(repo.getStory(db, w.id('b1'))).toEqual(before)
  })
})

describe('story so far, from the summaries', () => {
  const w = dbWorld()
  const { db } = w
  const put = (level: 'scene' | 'chapter' | 'story' | 'series', key: string, text: string) =>
    mem.putSummary(db, { level, targetId: level === 'series' ? w.id(key) : w.id(key), text, origin: 'text' })
  put('story', 'b1', 'Book 1 in short.')
  put('chapter', 'b1.c1', 'Mara finds the burned mill.')
  put('story', 'kr', "Kell's Road in short.")
  put('story', 'qy', 'A quiet year.')
  put('story', 'b2', 'Book 2 in short (never used for a cut).')
  for (const c of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) put('chapter', `b2.${c}`, `Book 2 ${c}.`)
  put('story', 'ash', 'Ash in short.')
  put('scene', 'ember.c1.s1', 'Tobin takes the ferry north.')
  put('story', 'wolf', 'Wolf Winter in short.')
  put('scene', 'b3.c1.s1', 'Book 3 opens.')
  put('story', 'b3', 'Book 3 in short.')
  put('story', 'b4', 'Book 4 in short.')
  put('series', 'reach', 'The Reach, all four books.')
  put('series', 'kell', 'Kell, both books.')
  put('scene', 'kr.c1.s1', 'Kell sets out.')

  it('earlier stories one paragraph each, side stories meanwhile, a cut story from its chapters', () => {
    const s = sceneMemory(db, w.id('wolf.c1.s1')).storySoFar
    expect(s.stories.map((x) => [x.title, x.meanwhile, x.cut, x.text])).toEqual([
      ['Book 1', false, false, 'Book 1 in short.'],
      ["Kell's Road", true, false, "Kell's Road in short."],
      ['The Quiet Year', false, false, 'A quiet year.'],
      ['Book 2', false, true, 'Book 2 c1. Book 2 c2. Book 2 c3. Book 2 c4. Book 2 c5.'],
      ['Ash', true, false, 'Ash in short.'],
      // No story summary yet: built from its scene summaries.
      ['Ember', true, false, 'Tobin takes the ferry north.']
    ])
    expect(s.series).toEqual([])
    expect(s.scenes).toEqual([])
  })

  it('a cut inside a chapter uses that chapter’s scene summaries', () => {
    const s = sceneMemory(db, w.id('kret.c1.s1')).storySoFar
    expect(s.stories.map((x) => [x.title, x.cut, x.text])).toEqual([
      ['Book 1', true, 'Mara finds the burned mill.'],
      ["Kell's Road", false, "Kell's Road in short."]
    ])
    const keep = sceneMemory(db, w.id('keep.c1.s1')).storySoFar
    expect(keep.stories).toEqual([expect.objectContaining({ title: 'Book 1', cut: true, text: 'Mara finds the burned mill.' })])
  })

  it('this story’s own scenes and chapters, and a series roll-up only when all of it is on the walk', () => {
    const s = sceneMemory(db, w.id('b3.c1.s2')).storySoFar
    expect(s.scenes).toEqual([{ sceneId: w.id('b3.c1.s1'), chapterId: w.id('b3.c1'), label: 'Book 3, Ch 1, Sc 1', text: 'Book 3 opens.' }])
    const b2 = sceneMemory(db, w.id('b2.c4.s1')).storySoFar
    expect(b2.chapters.map((c) => c.label)).toEqual(['Book 2, Ch 1', 'Book 2, Ch 2', 'Book 2, Ch 3'])
    const ld = sceneMemory(db, w.id('ld.c1.s1')).storySoFar
    expect(ld.series.map((x) => [x.name, x.text])).toEqual([['The Reach', 'The Reach, all four books.']])
    expect(ld.series[0].storyIds.map((id) => repo.getStory(db, id).title).sort()).toEqual(
      ['Ash', 'Book 1', 'Book 2', 'Book 3', 'Book 4', 'Ember', 'The Quiet Year', 'Wolf Winter'].sort()
    )
  })

  it('the story that leads into a book ends with how that book begins', () => {
    expect(sceneMemory(db, w.id('ym.c1.s1')).storySoFar.leadsInto).toBeNull()
    expect(sceneMemory(db, w.id('ym2.c1.s1')).storySoFar.leadsInto).toBeNull()
    const lead = sceneMemory(db, w.id('ym3.c1.s1')).storySoFar.leadsInto
    expect(lead?.title).toBe('Book 1')
    expect(lead?.text).toBe(
      "Mara finds the burned mill.\n\nHow the cast is when Book 1 begins:\nMara: Heir to the Reach, raised as a smith's daughter.\nTobin: A ferryman."
    )
    // A single prequel leads into its book by itself.
    expect(sceneMemory(db, w.id('bd.c1.s1')).storySoFar.leadsInto?.title).toBe('The Long Dark')
  })
})

describe('drafting an earlier scene does not show later changes (milestone 2 acceptance)', () => {
  it('holds for every kind of change, first-exists point and summary', () => {
    const w = dbWorld()
    const { db } = w
    // Book 2 Ch 2 Sc 1: Ash and Ember are still running, and everything after it is later.
    const scene = w.id('b2.c2.s1')
    const before = sceneMemory(db, scene)
    const at = (key: string) => (key.split('.').length === 3 ? { anchor: 'scene' as const, sceneId: w.id(key) } : null)
    const add = (entry: string, where: string, data: ChangeData) =>
      mem.insertChange(db, {
        ...data,
        entryId: w.id(entry),
        ...(at(where) ?? { anchor: 'story-start' as const, storyId: w.id(where) }),
        origin: 'text'
      })

    add('mara', 'b2.c2.s2', {
      kind: 'update',
      payload: { note: 'braided her hair', fields: { hair: 'braided' }, description: 'Later.', summary: 'Later.' }
    })
    add('tobin', 'ash.c1.s1', { kind: 'update', payload: { note: 'met the Ash folk', fields: { marks: 'burned hand' } } })
    add('tobin', 'ember.c1.s1', { kind: 'knowledge', payload: { factId: 'f-ember', fact: 'Ember burns.' } })
    add('tobin', 'b3', {
      kind: 'full',
      payload: {
        description: 'An old ferryman.',
        knows: [{ factId: 'f-old', fact: 'The ferry is failing.' }],
        relationships: [{ otherId: w.id('mara'), type: 'stranger', feels: '', otherFeels: '' }]
      }
    })
    add('mara', 'b2.c3.s1', { kind: 'relationship', payload: { otherId: w.id('tobin'), type: 'allies', feels: '', otherFeels: '' } })
    add('mara', 'b4.c1.s1', { kind: 'knowledge', payload: { factId: 'f-heir', fact: 'She is the heir.' } })
    add('burned', 'b2.c2.s2', { kind: 'thread', payload: { status: 'resolved', note: 'Solved early.' } })
    const own = add('mara', 'b2.c2.s1', { kind: 'update', payload: { note: 'what this scene brings about' } })
    // New entries first existing later, and a later point for one that doesn't exist here yet.
    const bram = repo.createEntry(db, 'character', { name: 'Bram', originStoryId: w.id('b3') })
    const found = repo.createEntry(db, 'item', { name: 'The Lamp' }, { origin: 'text', originSceneId: w.id('b2.c4.s1') })
    mem.addExistsPoint(db, { entryId: w.id('wren'), kind: 'scene', storyId: w.id('b2'), sceneId: w.id('b2.c2.s2'), byHand: false })
    // Summaries of this scene, later scenes, this chapter (not ended), this story, running side stories, later books and the series.
    const put = (level: 'scene' | 'chapter' | 'story' | 'series', key: string) =>
      mem.putSummary(db, { level, targetId: w.id(key), text: `Later: ${key}.`, origin: 'text' })
    for (const key of ['b2.c2.s1', 'b2.c2.s2', 'ash.c1.s1', 'ember.c1.s1']) put('scene', key)
    put('chapter', 'b2.c2')
    for (const key of ['b2', 'ash', 'ember', 'b3']) put('story', key)
    put('series', 'reach')

    const after = sceneMemory(db, scene)
    const { elsewhere, bringAbout, ...rest } = after
    const { elsewhere: elsewhereBefore, bringAbout: bringAboutBefore, ...restBefore } = before
    expect(rest).toEqual(restBefore)
    expect(elsewhere.filter((x) => elsewhereBefore.some((y) => y.entry.id === x.entry.id))).toEqual(elsewhereBefore)
    expect(elsewhere.find((x) => x.entry.id === bram.id)?.label).toBe('from Book 3, not in this story so far')
    expect(elsewhere.find((x) => x.entry.id === found.id)?.label).toBe('not in the story yet at this point')
    expect(bringAbout.map((c) => c.id)).toEqual([...bringAboutBefore.map((c) => c.id), own.id])

    // They do count later on.
    const later = sceneMemory(db, w.id('b4.c1.s1'))
    const state = (id: ID) => later.entries.find((e) => e.id === id)
    expect(state(w.id('mara'))?.fields.hair).toBe('braided')
    expect(state(w.id('tobin'))?.description).toBe('An old ferryman.')
    expect(sceneMemory(db, w.id('b2.c4.s1')).facts.find((f) => f.factId === 'f-ember')?.knownBy).toEqual([w.id('tobin')])
    // Book 3's full description of Tobin starts what he knows again.
    expect(later.facts.map((f) => [f.factId, f.knownBy])).toEqual([
      ['f-heir', [w.id('kell')]],
      ['f-old', [w.id('tobin')]]
    ])
    expect(later.threads.find((t) => t.entryId === w.id('burned'))?.status).toBe('resolved')
    expect(state(bram.id) && state(found.id)).toBeTruthy()
    expect(later.storySoFar.stories.map((s) => s.text)).toContain('Later: b3.')
  })
})
