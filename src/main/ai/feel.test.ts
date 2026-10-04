import { describe, expect, it } from 'vitest'
import { defaultStyleGuide } from '@shared/defaults'
import { cleanGenres, genreLabel, GENRES, MAX_GENRES } from '@shared/genres'
import { cleanIntensity, INTENSITY, intensityHigh, intensityLines } from '@shared/intensity'
import { PROMPT_SLOP, SLOP_RULES } from '@shared/slop'
import { effectiveStyle } from '@shared/style'
import type { StyleGuide, WritingPrefs } from '@shared/types'
import { getEncoding } from 'js-tiktoken'
import { aiPhrasesText, avoidLine, contentText, feelLine, finalInstruction, genreText, instructionsText } from './prompts'

const prefs = (p: Partial<WritingPrefs> = {}): WritingPrefs => ({ spelling: 'UK', pov: 'Close third person', tense: 'Past tense', voiceNotes: '', avoidWords: [], ...p })
const guide = (g: Partial<StyleGuide> = {}): StyleGuide => ({ ...defaultStyleGuide(), ...g })

describe('genre presets', () => {
  it('has about fourteen presets with unique ids, each with guidance and clichés', () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(12)
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(GENRES.length)
    for (const g of GENRES) {
      const words = g.guidance.split(/\s+/).length
      expect(words, g.id).toBeGreaterThan(55)
      expect(words, g.id).toBeLessThan(100)
      expect(g.cliches.length, g.id).toBeGreaterThanOrEqual(5)
      expect(g.blurb.length, g.id).toBeLessThan(80)
      expect(g.hue).toBeGreaterThanOrEqual(0)
      expect(g.hue).toBeLessThan(360)
    }
  })

  it('keeps known ids, in order, without repeats, at most two', () => {
    expect(cleanGenres(['horror', 'nope', 'horror', 'romance', 'fantasy'])).toEqual(['horror', 'romance'])
    expect(cleanGenres('horror')).toEqual([])
    expect(MAX_GENRES).toBe(2)
    expect(genreLabel(['fantasy', 'romance'])).toBe('Fantasy with romance')
    expect(genreLabel([])).toBe('')
  })
})

describe('content intensity', () => {
  it('reads only known levels and turns each into one sentence', () => {
    expect(cleanIntensity({ romance: 2, violence: 9, language: '3', other: 1 })).toEqual({ romance: 2 })
    expect(intensityLines({ romance: 2, language: 1 })).toEqual([INTENSITY[0].steps[1].prompt, INTENSITY[2].steps[0].prompt])
    expect(intensityHigh({ romance: 2, violence: 2 })).toBe(false)
    expect(intensityHigh({ violence: 3 })).toBe(true)
  })
})

describe('the story feel in the effective style', () => {
  it("uses the story's genre picks over the world's, and each scale it sets over the world's", () => {
    const s = effectiveStyle(prefs(), guide({ genres: ['horror'], intensity: { violence: 3, language: 2 } }), { genres: ['cosy'], intensity: { language: 1 } })
    expect(s.genres).toEqual(['cosy'])
    expect(s.sources.genres).toBe('story')
    expect(s.intensity).toEqual({ violence: 3, language: 1 })
    expect(s.sources.intensity).toBe('story')
  })

  it("falls back to the world's picks when the story has none, and turns the AI phrases on unless I turned them off", () => {
    const s = effectiveStyle(prefs(), guide({ genres: ['horror', 'mystery'] }), { genres: [] })
    expect(s.genres).toEqual(['horror', 'mystery'])
    expect(s.sources.genres).toBe('world')
    expect(s.sources.intensity).toBe('none')
    expect(s.avoidAiPhrases).toBe(true)
    expect(effectiveStyle(prefs({ avoidAiPhrases: false }), guide(), {}).avoidAiPhrases).toBe(false)
  })

  it('reads older style guides with none of the new keys', () => {
    const old = { pov: 'First person' } as unknown as StyleGuide
    const s = effectiveStyle(prefs(), old, {})
    expect(s.genres).toEqual([])
    expect(s.genreNotes).toBe('')
    expect(s.intensity).toEqual({})
  })
})

describe('the genre and feel in the writer instructions', () => {
  it('describes one genre with its worn-out moves and the author’s own take', () => {
    const text = genreText(guide({ genres: ['horror'], genreNotes: 'Folk horror, not gothic.' }))
    expect(text).toMatch(/^Genre and feel\nThis story is horror\./)
    expect(text).toContain('Build dread slowly')
    expect(text).toContain("The author's own take on it: Folk horror, not gothic.")
    expect(text).toContain('Steer clear of worn-out moves such as a jump scare')
  })

  it('blends two genres, leading with the first; the short form keeps only the first', () => {
    const style = guide({ genres: ['fantasy', 'romance'] })
    const full = genreText(style)
    expect(full).toContain('This story is mostly fantasy, with the feel of romance.')
    expect(full).toContain('From romance, bring in its slow-burning tension and longing: put the emotional beat first')
    const short = genreText(style, true)
    expect(short).toContain('This story is fantasy. It also has the feel of romance.')
    expect(short).not.toContain('worn-out moves')
    expect(short).not.toContain('emotional beat')
    expect(genreText(guide())).toBe('')
  })

  it('says each content level plainly and lets the content limits win', () => {
    expect(contentText(guide())).toBe('')
    const text = contentText(guide({ intensity: { romance: 2 }, contentLimits: 'No harm to animals.' }))
    expect(text).toContain('- Romance: attraction, tension and kisses are fine')
    expect(text).toContain('For anything not covered here, judge by the genre.')
    expect(text).toContain('follow the content limits')
  })

  it('gives the rules against AI phrasing, naming the worst phrases only in full', () => {
    const full = aiPhrasesText()
    for (const r of SLOP_RULES) expect(full).toContain(r)
    expect(full).toContain(`"${PROMPT_SLOP[0]}"`)
    expect(PROMPT_SLOP.length).toBeGreaterThanOrEqual(12)
    expect(PROMPT_SLOP.length).toBeLessThanOrEqual(18)
    expect(aiPhrasesText(true)).not.toContain(PROMPT_SLOP[0])
  })

  it('leaves the AI phrasing rules out when I turn them off, or for jobs that write no prose', () => {
    expect(instructionsText({ ...guide(), avoidAiPhrases: false })).not.toContain('Write like a person')
    expect(instructionsText(guide(), { intro: 'Answer questions.', proseRules: false })).not.toContain('Write like a person')
    expect(instructionsText(guide())).toContain('Write like a person')
  })

  it('grows block 1 by about 550 tokens at most (a blend, all three content levels, the AI phrases), and much less in its short form', () => {
    const enc = getEncoding('o200k_base')
    const estimateTokens = (s: string): number => enc.encode(s).length
    const plain = { ...guide({ pov: 'Close third person', tense: 'Past tense' }), avoidAiPhrases: false }
    const feel = { ...plain, genres: ['fantasy', 'romance'], intensity: { romance: 2, violence: 3, language: 2 } as StyleGuide['intensity'], avoidAiPhrases: true }
    const grow = estimateTokens(instructionsText(feel)) - estimateTokens(instructionsText(plain))
    expect(grow).toBeGreaterThan(350)
    expect(grow).toBeLessThan(600)
    const growShort = estimateTokens(instructionsText(feel, { trimSample: true })) - estimateTokens(instructionsText(plain, { trimSample: true }))
    expect(growShort).toBeLessThan(350)
  })
})

describe('the closing reminder of the genre and tone', () => {
  it('names the genre’s feel and the tone, or nothing', () => {
    expect(feelLine(guide({ genres: ['horror'] }), 'Bleak and quiet.')).toBe("- Keep the slow-building dread of horror, and the story's tone: Bleak and quiet.")
    expect(feelLine(guide({ genres: ['fantasy', 'romance'] }))).toBe('- Keep the grounded wonder of fantasy, with the slow-burning tension and longing of romance.')
    expect(feelLine(guide(), '')).toBeNull()
  })

  it('goes in the closing instruction', () => {
    const text = finalInstruction({
      targetWords: 1000,
      style: guide({ genres: ['thriller'] }),
      hasBeats: true,
      hasPrevious: false,
      hasDirection: false,
      tone: 'Tense'
    })
    expect(text).toContain("- Keep the relentless momentum of thriller, and the story's tone: Tense.")
  })
})

describe('the closing reminder of the phrases to avoid', () => {
  it('gives a short list again, points to a long one, and says nothing without one', () => {
    expect(avoidLine(guide({ avoidPhrases: ['the shape of her'] }))).toBe('- Never use “the shape of her”, or any close variation of it.')
    expect(avoidLine(guide({ avoidPhrases: ['the shape of her', ' a  beat '] }))).toBe(
      '- Never use “the shape of her”, “a beat”, or any close variation of them.'
    )
    const many = Array.from({ length: 40 }, (_, i) => `worn-out phrase number ${i}`)
    expect(avoidLine(guide({ avoidPhrases: many }))).toBe(
      "- Never use any of the author's words and phrases to avoid, given above, or any close variation of them."
    )
    expect(avoidLine(guide({ avoidPhrases: [] }))).toBeNull()
    expect(avoidLine(guide({ avoidPhrases: ['  '] }))).toBeNull()
  })

  it('goes in the closing instruction', () => {
    const text = finalInstruction({ targetWords: 1000, style: guide({ avoidPhrases: ['the shape of her'] }), hasBeats: true, hasPrevious: false, hasDirection: false })
    expect(text).toContain('- Never use “the shape of her”, or any close variation of it.')
  })
})

describe('speech in quote marks', () => {
  it('asks the writer to put everything said aloud in quote marks, a talking object’s too, but not in the short form', () => {
    expect(instructionsText(guide())).toContain('Put everything said aloud in quote marks, whoever or whatever says it')
    expect(instructionsText(guide(), { trimSample: true })).not.toContain('Put everything said aloud')
    expect(instructionsText(guide(), { proseRules: false })).not.toContain('Put everything said aloud')
  })
})
