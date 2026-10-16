import { describe, expect, it } from 'vitest'
import type { EntryState } from '@shared/types'
import type { StorySoFar } from '../memory/types'
import { DETAILED, RECORD_FACTS, TIMELINE_LEAD, TIMELINE_LEVELS, TIMELINE_WORDS, timelineMarks, timelineShape, timelineText, type TimelineContext } from './timeline'
import type { ChapterSnapshot } from '../memory/snapshot'
import { MOST_SCALE } from './memoryRoom'

const names: Record<string, string> = { w: 'Wren', a: 'Ash', o: 'Oskar', inn: 'The inn', ferry: 'The Linn ferry', toll: 'The toll', bell: 'Who rang the bell?' }
const person = (name: string, happened: EntryState['happened'] = []) => ({ kind: 'character' as const, name, happened })
const ctx = (entries: TimelineContext['entries'] = []): TimelineContext => ({ storyTitle: 'Fell Road', name: (id) => names[id] ?? null, entries })
const words = (n: number, w = 'rain'): string => `${Array.from({ length: n }, () => w).join(' ')}.`

function story(chapters = 4, perChapter = 3, summaryWords = 20): StorySoFar {
  const scenes: StorySoFar['scenes'] = []
  for (let c = 1; c <= chapters; c++)
    for (let k = 1; k <= perChapter; k++)
      scenes.push({
        sceneId: `s${c}${k}`,
        chapterId: `c${c}`,
        label: `Fell Road, Ch ${c}, Sc ${k}`,
        text: `Scene ${c}.${k} happened. ${words(summaryWords)}`,
        when: `Day ${c * 10 + k}`,
        whereId: c === 2 ? 'ferry' : 'inn',
        whoIds: c === 2 ? ['w', 'a', 'o'] : ['w', 'a']
      })
  return {
    scenes,
    chapters: Array.from({ length: chapters - 1 }, (_, i) => ({ chapterId: `c${i + 1}`, label: `Fell Road, Ch ${i + 1}`, text: `Chapter ${i + 1} in short. ${words(30)}` })),
    stories: [{ storyId: 'b0', title: 'The Survey', meanwhile: false, cut: false, text: 'Edric made the survey.' }],
    series: [],
    leadsInto: null
  }
}

describe('the canon timeline', () => {
  it('is marked as canon, oldest first: earlier stories, older chapters rolled up, the recent chapters a line a scene', () => {
    const t = timelineText(story(), ctx())
    expect(t.startsWith(TIMELINE_LEAD)).toBe(true)
    const lines = t.split('\n').filter((l) => l.startsWith('- '))
    expect(lines[0]).toBe('- The Survey: Edric made the survey.')
    expect(lines[1].startsWith('- Ch 1: Chapter 1 in short.')).toBe(true)
    expect(lines[2].startsWith('- Ch 2: Chapter 2 in short.')).toBe(true)
    // The last two chapters (DETAILED.chapters) a line a scene, with when, where and who.
    expect(DETAILED.chapters).toBe(2)
    expect(lines[3].startsWith('- Ch 3, Sc 1, Day 31, The inn (Wren, Ash): Scene 3.1 happened.')).toBe(true)
    expect(lines.at(-1)!.startsWith('- Ch 4, Sc 3, Day 43, The inn (Wren, Ash): Scene 4.3 happened.')).toBe(true)
    // Nothing from this scene or later: only what the story so far holds.
    expect(t).not.toContain('Ch 4, Sc 4')
  })

  it('a chapter without its summary yet is told scene by scene, with who was there', () => {
    const s = story(2, 3)
    const t = timelineText({ ...s, chapters: [] }, ctx())
    expect(t).toContain('- Ch 2, Sc 1, Day 21, The Linn ferry (Wren, Ash, Oskar): ')
  })

  it('marks deaths, departures and things changing hands on the scene they happened in', () => {
    const entries = [
      person('Edric', [{ note: 'died this afternoon in his chair', where: 'Fell Road, Ch 4, Sc 1', changeId: '1' }]),
      person('Bryn', [
        { note: 'left Carrow, driving south', where: 'Fell Road, Ch 4, Sc 2', changeId: '2' },
        { note: 'laughed at the joke', where: 'Fell Road, Ch 4, Sc 2', changeId: '3' }
      ]),
      { kind: 'item' as const, name: 'The brass compass', happened: [{ note: 'given by Wren to Pell', where: 'Fell Road, Ch 1, Sc 2', changeId: '4' }] }
    ]
    const marks = timelineMarks(entries)
    expect(marks.get('Fell Road, Ch 4, Sc 1')).toEqual(['Edric died in his chair'])
    expect(marks.get('Fell Road, Ch 4, Sc 2')).toEqual(['Bryn: left Carrow, driving south'])
    const t = timelineText(story(), ctx(entries))
    expect(t).toMatch(/- Ch 4, Sc 1, .*\[Edric died in his chair\]/)
    // A rolled-up chapter keeps the marks of its scenes.
    expect(t).toMatch(/- Ch 1: .*\[The brass compass: given by Wren to Pell\]/)
  })

  it('keeps to its cap, the oldest detail going first, and the smallest forms say what was left out', () => {
    const big = story(10, 5, 120)
    for (let lv = 0; lv < 3; lv++) {
      const t = timelineText(big, ctx(), lv)
      expect((t.match(/\S+/g) ?? []).length).toBeLessThanOrEqual(TIMELINE_WORDS[lv] + 60)
      // The most recent scene is always there, in detail at full size.
      expect(t).toContain('- Ch 10, Sc 5, Day 105')
    }
    expect(timelineText(big, ctx(), 0)).toContain('Scene 10.5 happened. rain rain')
    const smallest = timelineText(big, ctx(), TIMELINE_LEVELS - 1)
    expect(smallest).toContain('left out here to save space')
    expect(smallest.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1)
    // It costs less than the story so far in prose summaries did.
    const prose = big.scenes.reduce((n, x) => n + (x.text.match(/\S+/g) ?? []).length, 0)
    expect((timelineText(big, ctx(), 0).match(/\S+/g) ?? []).length).toBeLessThan(prose / 2)
  })

  it('reads the same from one step to the next (the cache): it depends only on scenes before this one', () => {
    const s = story()
    const entries = [person('Edric', [{ note: 'died in his chair', where: 'Fell Road, Ch 4, Sc 1', changeId: '1' }])]
    const a = timelineText(s, ctx(entries))
    // The memory learns something in this scene (Ch 4, Sc 4): the timeline is the same.
    const later = [...entries, person('Ash', [{ note: 'went out to the stable', where: 'Fell Road, Ch 4, Sc 4', changeId: '9' }])]
    expect(timelineText(s, ctx(later))).toBe(a)
  })

  it('marks a scene summary being brought up to date, as the prose story so far does, and leaves the others plain', () => {
    const s = story()
    const last = s.scenes.length - 1
    s.scenes[last] = { ...s.scenes[last], updating: true, excerpt: 'and the lamps went out one by one' }
    s.scenes[last - 1] = { ...s.scenes[last - 1], updating: true }
    const lines = timelineText(s, ctx())
      .split('\n')
      .filter((l) => l.startsWith('- '))
    expect(lines[lines.length - 1]).toContain(
      '(This summary is being brought up to date: the scene has changed since it was written. The scene now ends: “…and the lamps went out one by one”)'
    )
    expect(lines[lines.length - 2]).toContain('(This summary is being brought up to date: the scene has changed since it was written.)')
    expect(lines.slice(0, -2).some((l) => l.includes('brought up to date'))).toBe(false)
    // The brief forms say it in a few words, without the excerpt.
    const brief = timelineText(s, ctx(), 3)
    expect(brief).toContain('(This summary is being brought up to date.)')
    expect(brief).not.toContain('lamps went out')
  })

  describe('grows with how much the writer model reads (2026-10-15)', () => {
    const NL = String.fromCharCode(10)
    const wordsIn = (t: string): number => (t.match(/\S+/g) ?? []).length
    const scaled = (scale: number, entries: TimelineContext['entries'] = []): TimelineContext => ({ ...ctx(entries), scale })

    it('is exactly as before for the smallest model, and up to MOST_SCALE times longer for one that reads a lot', () => {
      expect(timelineShape(1)).toEqual(timelineShape())
      expect(timelineShape(1).words).toEqual(TIMELINE_WORDS)
      expect(timelineShape(1).chapters).toBe(DETAILED.chapters)
      const big = story(30, 6, 150)
      expect(timelineText(big, scaled(1))).toBe(timelineText(big, ctx()))
      const most = timelineShape(MOST_SCALE)
      expect(most.words[0]).toBe(Math.round(TIMELINE_WORDS[0] * MOST_SCALE))
      // Only the full and short forms grow; Continue's and the smallest forms stay as they were.
      expect(most.words.slice(2)).toEqual(TIMELINE_WORDS.slice(2))
      expect(most.chapters).toBe(4)
      // Beyond the cap it is the same as the most.
      expect(timelineShape(10)).toEqual(most)
      const small = wordsIn(timelineText(big, ctx(), 0))
      const large = wordsIn(timelineText(big, scaled(MOST_SCALE), 0))
      expect(small).toBeLessThanOrEqual(TIMELINE_WORDS[0] + 60)
      // Here everything fits: about twice as much, nothing left out.
      expect(large).toBeGreaterThan(small * 1.8)
      expect(large).toBeLessThanOrEqual(most.words[0] + 60)
      // The smaller one had to make its oldest lines brief.
      const ch1 = `- Ch 1: Chapter 1 in short. ${words(30)}`
      expect(timelineText(big, ctx(), 0)).not.toContain(ch1)
      expect(timelineText(big, scaled(MOST_SCALE), 0)).toContain(ch1)
    })

    it('tells more of each older chapter and more chapters a scene at a time, so less is left out', () => {
      const big = story(12, 5, 150)
      const small = timelineText(big, ctx(), 0)
      const large = timelineText(big, scaled(MOST_SCALE), 0)
      // Four chapters scene by scene, not two.
      expect(small).not.toContain('- Ch 9, Sc 1,')
      expect(large).toContain('- Ch 9, Sc 1, Day 91')
      // Every older chapter still has its line, where the smaller one had to make them brief or leave them out.
      for (let c = 1; c <= 8; c++) expect(large).toContain(`- Ch ${c}: Chapter ${c} in short.`)
      expect(large).not.toContain('left out here to save space')
    })

    it('with room, a new scene adds a line and changes none before it (the cache)', () => {
      const s = story(6, 6, 150)
      const before = { ...s, scenes: s.scenes.slice(0, -1) }
      const lines = (x: StorySoFar): string[] => timelineText(x, scaled(MOST_SCALE)).split(NL).filter((l) => l.startsWith('- '))
      const was = lines(before)
      const now = lines(s)
      expect(now.slice(0, was.length)).toEqual(was)
      expect(now).toHaveLength(was.length + 1)
      // The smallest model's timeline tells the last five scenes in more detail, so a line changes as a scene drops out.
      const small = (x: StorySoFar): string[] => timelineText(x, ctx()).split(NL).filter((l) => l.startsWith('- '))
      expect(small(s).slice(0, small(before).length)).not.toEqual(small(before))
    })
  })

  it('is empty when nothing came before', () => {
    expect(timelineText({ scenes: [], chapters: [], stories: [], series: [], leadsInto: null }, ctx())).toBe('')
  })
})

describe('an older chapter’s line, from the story record (long story memory fix 15)', () => {
  const record = (over: Partial<ChapterSnapshot> = {}): ChapterSnapshot => ({
    v: 1,
    chapterId: 'c1',
    storyId: 'b1',
    sceneId: 's13',
    span: 'Day 11 to Day 13 (2 days)',
    days: 'Day 11 to Day 13',
    changed: [{ who: 'w', note: 'cut her hand', sc: 1 }],
    learned: [{ who: ['a'], fact: 'Wren is the heir', sc: 2, how: 'saw' }],
    threads: [
      { thread: 'toll', step: 'paid off', sc: 3 },
      { thread: 'bell', step: 'set up', sc: 3 }
    ],
    people: [{ who: 'w', at: 'inn', atSc: 3 }],
    open: ['bell'],
    ...over
  })
  const lineOf = (t: string, head: string): string => t.split('\n').find((l) => l.startsWith(head)) ?? ''

  it('says the days it runs, and in full what its opening words may have lost: who learned what, threads paid off', () => {
    const s = story()
    s.chapters[0] = { ...s.chapters[0], record: record() }
    expect(RECORD_FACTS).toBe(2)
    expect(lineOf(timelineText(s, ctx()), '- Ch 1')).toBe(
      `- Ch 1, Day 11 to Day 13: Chapter 1 in short. ${words(30)} [Ash learned: Wren is the heir; paid off: The toll]`
    )
    // A chapter whose record says nothing of time or of these keeps its line as it was.
    s.chapters[1] = { ...s.chapters[1], record: record({ span: '', days: '', learned: [], threads: [] }) }
    expect(lineOf(timelineText(s, ctx()), '- Ch 2')).toBe(`- Ch 2: Chapter 2 in short. ${words(30)}`)
  })

  it('in its brief form keeps the days but not the facts, so a line made brief to fit grows no longer', () => {
    const big = story(20, 5, 120)
    big.chapters[0] = { ...big.chapters[0], record: record() }
    const t = timelineText(big, ctx(), 1)
    expect(t).not.toContain('left out here')
    const line = lineOf(t, '- Ch 1')
    expect(line.startsWith('- Ch 1, Day 11 to Day 13: Chapter 1 in short.')).toBe(true)
    expect(line).not.toContain('learned')
  })

  it('says when a chapter summary is being brought up to date, of the chapter', () => {
    const s = story()
    s.chapters[0] = { ...s.chapters[0], updating: true }
    expect(lineOf(timelineText(s, ctx()), '- Ch 1')).toMatch(/\(This summary is being brought up to date: the chapter has changed since it was written\.\)$/)
    expect(lineOf(timelineText(s, ctx()), '- Ch 2')).not.toContain('brought up to date')
  })

  it('reads the same from one scene to the next: a new scene in a later chapter changes no older line', () => {
    const s = story()
    s.chapters[0] = { ...s.chapters[0], record: record() }
    const before = timelineText(s, ctx())
    const next: StorySoFar = {
      ...s,
      scenes: [...s.scenes, { sceneId: 's44', chapterId: 'c4', label: 'Fell Road, Ch 4, Sc 4', text: 'Scene 4.4 happened.', when: 'Day 44', whereId: 'inn', whoIds: ['w'] }]
    }
    const after = timelineText(next, ctx())
    expect(after.startsWith(before.slice(0, before.indexOf('- Ch 3')))).toBe(true)
    expect(lineOf(after, '- Ch 1')).toBe(lineOf(before, '- Ch 1'))
  })
})
