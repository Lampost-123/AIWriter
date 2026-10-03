import { describe, expect, it } from 'vitest'
import { defaultStyleGuide } from '@shared/defaults'
import {
  GENRE_RULE,
  genreHint,
  intensityIntro,
  genreRole,
  keepSample,
  LEFT_TO_GENRE,
  pickGenre,
  sampleProblem,
  scaleShown,
  shownGenres,
  styleForSample,
  toggleLevel
} from './feelLogic'

describe('pickGenre', () => {
  it('adds a first pick, then blends a second', () => {
    expect(pickGenre([], 'horror')).toEqual(['horror'])
    expect(pickGenre(['horror'], 'comedy')).toEqual(['horror', 'comedy'])
  })
  it('takes a picked one off, and the other leads', () => {
    expect(pickGenre(['horror', 'comedy'], 'comedy')).toEqual(['horror'])
    expect(pickGenre(['horror', 'comedy'], 'horror')).toEqual(['comedy'])
    expect(pickGenre(['horror'], 'horror')).toEqual([])
  })
  it('replaces the second with a third, keeping the lead', () => {
    expect(pickGenre(['horror', 'comedy'], 'romance')).toEqual(['horror', 'romance'])
  })
  it('ignores unknown stored ids', () => {
    expect(pickGenre(['nonsense', 'horror'], 'fantasy')).toEqual(['horror', 'fantasy'])
  })
})

describe('genreRole', () => {
  it('names the lead and the blend', () => {
    expect(genreRole(['horror', 'comedy'], 'horror')).toBe('main')
    expect(genreRole(['horror', 'comedy'], 'comedy')).toBe('blend')
    expect(genreRole(['horror'], 'fantasy')).toBeNull()
  })
})

describe('shownGenres', () => {
  it("shows a story the world's picks when it has none", () => {
    const shown = shownGenres([], ['horror'], 'story')
    expect(shown).toEqual({ ids: ['horror'], inherited: true })
    expect(genreHint(shown)).toBe("Uses the world's: Horror. Pick here to give this story its own.")
  })
  it("shows a story's own picks over the world's", () => {
    expect(shownGenres(['comedy'], ['horror'], 'story')).toEqual({ ids: ['comedy'], inherited: false })
  })
  it('the world shows only its own', () => {
    const shown = shownGenres([], ['horror'], 'world')
    expect(shown).toEqual({ ids: [], inherited: false })
    expect(genreHint(shown)).toBe(GENRE_RULE)
  })
  it('names a blend', () => {
    expect(genreHint(shownGenres([], ['fantasy', 'romance'], 'story'))).toContain('Fantasy with romance')
  })
})

describe('intensity', () => {
  it('picks a step, and clicking it again leaves it to the genre', () => {
    const one = toggleLevel({}, 'romance', 2)
    expect(one).toEqual({ romance: 2 })
    expect(toggleLevel(one, 'romance', 3)).toEqual({ romance: 3 })
    expect(toggleLevel(one, 'romance', 2)).toEqual({})
    expect(toggleLevel({ violence: 4 }, 'romance', 1)).toEqual({ violence: 4, romance: 1 })
  })
  it('says when a scale is left to the genre', () => {
    const s = scaleShown({}, {}, 'language', 'world')
    expect(s).toMatchObject({ picked: null, inherited: null, hint: LEFT_TO_GENRE })
  })
  it("shows the world's step on a story that has none, and the story's own over it", () => {
    const inherited = scaleShown({}, { violence: 2 }, 'violence', 'story')
    expect(inherited.picked).toBeNull()
    expect(inherited.inherited).toBe(2)
    expect(inherited.hint).toMatch(/^Uses the world's: Restrained\./)
    expect(inherited.hints).toContain(inherited.hint)
    const own = scaleShown({ violence: 4 }, { violence: 2 }, 'violence', 'story')
    expect(own).toMatchObject({ picked: 4, inherited: null })
    expect(own.hints).toContain(own.hint)
    // The world's line keeps its room while the story has its own.
    expect(own.hints).toEqual(inherited.hints)
  })
  it("says what clicking a picked step again does", () => {
    expect(scaleShown({ violence: 3 }, { violence: 2 }, 'violence', 'story').clearTo).toBe("use the world's")
    expect(scaleShown({ violence: 3 }, {}, 'violence', 'story').clearTo).toBe('leave it to the genre')
    expect(scaleShown({ violence: 3 }, { violence: 2 }, 'violence', 'world').clearTo).toBe('leave it to the genre')
    expect(intensityIntro('story', { romance: 1, violence: 2, language: 3 })).toMatch(/use the world's\.$/)
    expect(intensityIntro('story', {})).toMatch(/leave it to the genre/)
    expect(intensityIntro('story', { romance: 1 })).toMatch(/or the genre where the world hasn't set one/)
  })
  it('keeps room for every hint', () => {
    expect(scaleShown({}, {}, 'romance', 'world').hints).toHaveLength(5)
  })
})

describe('samples', () => {
  it('sends a plain style guide', () => {
    const s = styleForSample({ ...defaultStyleGuide(), genres: ['horror', 'bogus'], intensity: { romance: 9 as never, language: 2 }, pov: 'First person' })
    expect(s.genres).toEqual(['horror'])
    expect(s.intensity).toEqual({ language: 2 })
    expect(s.pov).toBe('First person')
    expect(Object.keys(s)).not.toContain('sources')
  })
  it('fills an empty sample passage', () => {
    expect(keepSample('  ', ' The door opened. ')).toEqual({ next: 'The door opened.', previous: '  ', message: 'Put the sample in the sample passage.' })
  })
  it('replaces one already there, keeping it for Undo', () => {
    const k = keepSample('Old words.', 'New words.')
    expect(k?.previous).toBe('Old words.')
    expect(k?.message).toMatch(/^Replaced/)
  })
  it('keeps nothing when the sample is empty', () => {
    expect(keepSample('Old words.', '   ')).toBeNull()
  })
  it('says what went wrong in plain words', () => {
    expect(sampleProblem('Choose a writer model first.')).toBe("Couldn't write a sample. Choose a writer model first.")
    expect(sampleProblem(null)).toMatch(/try again/)
  })
})
