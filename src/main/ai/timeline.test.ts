import { describe, expect, it } from 'vitest'
import type { EntryState } from '@shared/types'
import type { StorySoFar } from '../memory/types'
import { DETAILED, TIMELINE_LEAD, TIMELINE_LEVELS, TIMELINE_WORDS, timelineMarks, timelineText, type TimelineContext } from './timeline'

const names: Record<string, string> = { w: 'Wren', a: 'Ash', o: 'Oskar', inn: 'The inn', ferry: 'The Linn ferry' }
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

  it('is empty when nothing came before', () => {
    expect(timelineText({ scenes: [], chapters: [], stories: [], series: [], leadsInto: null }, ctx())).toBe('')
  })
})
