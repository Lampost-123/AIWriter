import { describe, expect, it } from 'vitest'
import { chapterSteps, dealClock, DEAL_MAX_MS, DEAL_STEP_MS, freshPieces, FRESH_MS, recipeSteps, stepsProgress, suggestSteps, worldSteps, type Fresh } from './planLogic'

describe('words fading in', () => {
  const none: Fresh = { text: '', marks: [] }

  it('marks each piece that arrives at the end, and lets it go once its fade has played', () => {
    const a = freshPieces(none, 'The door', true, 0)
    expect(a.parts).toEqual([{ start: 0, text: 'The door', fresh: true }])
    const b = freshPieces(a.state, 'The door left', true, 50)
    expect(b.parts).toEqual([
      { start: 0, text: 'The door', fresh: true },
      { start: 8, text: ' left', fresh: true }
    ])
    const c = freshPieces(b.state, 'The door left open', true, FRESH_MS + 10)
    expect(c.parts).toEqual([
      { start: 0, text: 'The door', fresh: false },
      { start: 8, text: ' left', fresh: true },
      { start: 13, text: ' open', fresh: true }
    ])
  })

  it('shows any other change at once, and plain text when nothing streams', () => {
    const a = freshPieces(none, 'The door', true, 0)
    expect(freshPieces(a.state, 'A door', true, 10).parts).toEqual([{ start: 0, text: 'A door', fresh: false }])
    expect(freshPieces(a.state, 'The door left', false, 10).parts).toEqual([{ start: 0, text: 'The door left', fresh: false }])
    expect(freshPieces(none, '', true, 0).parts).toEqual([])
  })
})

describe('cards dealt in', () => {
  it('deals cards that show together one after another, and one that arrives alone at once', () => {
    const next = dealClock()
    expect([next(1000), next(1001), next(1002)]).toEqual([0, DEAL_STEP_MS, 2 * DEAL_STEP_MS])
    expect(next(1500)).toBe(0)
    const many = dealClock()
    let last = 0
    for (let i = 0; i < 30; i++) last = many(2000)
    expect(last).toBe(DEAL_MAX_MS)
  })
})

describe('the steps', () => {
  it('walks the outline helper from the premise to keeping', () => {
    const from = { label: 'Premise', written: true, sub: 'Written' }
    expect(suggestSteps({ from, size: 'About 9 scenes', running: false, arrived: 0, open: 0, kept: 0 }).map((s) => s.state)).toEqual(['done', 'now', 'todo', 'todo'])
    const working = suggestSteps({ from, size: '', running: true, arrived: 3, open: 3, kept: 0 })
    expect(working.map((s) => s.state)).toEqual(['done', 'done', 'working', 'todo'])
    const deciding = suggestSteps({ from, size: '', running: false, arrived: 12, open: 9, kept: 3 })
    expect(deciding[3]).toMatchObject({ state: 'now', sub: '3 kept, 9 to decide' })
    expect(suggestSteps({ from, size: '', running: false, arrived: 12, open: 0, kept: 12 })[3].state).toBe('done')
    expect(suggestSteps({ from: { ...from, written: false }, size: '', running: false, arrived: 0, open: 0, kept: 0 })[0].state).toBe('now')
  })

  it('walks a chapter through its interview', () => {
    const open = chapterSteps({ goal: true, interview: 'open', answered: 1, running: false, arrived: 0, open: 0, kept: 0 })
    expect(open[1]).toMatchObject({ state: 'now', sub: '1 answer so far' })
    expect(chapterSteps({ goal: false, interview: 'none', answered: 0, running: true, arrived: 0, open: 0, kept: 0 })[2].state).toBe('working')
  })

  it('walks the world builder from the summary to looking it over', () => {
    expect(worldSteps({ words: 0, when: 'From the start', running: false, made: 0, undone: false, ended: false }).map((s) => s.state)).toEqual(['now', 'todo', 'todo', 'todo'])
    const built = worldSteps({ words: 78, when: 'From the start', running: false, made: 11, undone: false, ended: true })
    expect(built.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(built[3].sub).toBe('11 things made')
    expect(worldSteps({ words: 78, when: '', running: false, made: 11, undone: true, ended: true })[3].sub).toBe('Undone')
  })

  it('walks the recipe maker, and says how far along the steps are', () => {
    expect(recipeSteps({ story: true, chapters: 3, making: false }).map((s) => s.state)).toEqual(['done', 'now', 'todo'])
    expect(stepsProgress(recipeSteps({ story: true, chapters: 3, making: true }))).toBeCloseTo(2.5 / 3)
    expect(stepsProgress([])).toBe(0)
  })
})
