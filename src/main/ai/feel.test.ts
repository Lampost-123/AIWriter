import { describe, expect, it } from 'vitest'
import { defaultStyleGuide } from '@shared/defaults'
import { cleanGenres, genreLabel, GENRES, MAX_GENRES } from '@shared/genres'
import { cleanIntensity, INTENSITY, intensityHigh, intensityLines } from '@shared/intensity'
import { PLAIN_RULE, PROMPT_SLOP, SLOP_RULES } from '@shared/slop'
import { stylePresetById, withPreset } from '@shared/stylePresets'
import { effectiveStyle } from '@shared/style'
import type { StyleGuide, WritingPrefs } from '@shared/types'
import { getEncoding } from 'js-tiktoken'
import { aiPhrasesText, asksForRichProse, avoidLine, contentText, feelLine, finalInstruction, genreText, instructionsText, sexSceneText, writerInstructions } from './prompts'

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

  it('adds the sex-scene craft only when romance is explicit and the job writes prose', () => {
    expect(sexSceneText(guide())).toBe('')
    expect(sexSceneText(guide({ intensity: { romance: 3 } }))).toBe('')
    const skill = sexSceneText(guide({ intensity: { romance: 4 } }))
    expect(skill).toMatch(/^Sex scenes\n/)
    expect(skill).toContain('blunt words')
    expect(skill).toContain('overrides the rule about subtext')
    const explicit = guide({ intensity: { romance: 4 } })
    expect(instructionsText(explicit)).toContain('Sex scenes')
    expect(instructionsText(explicit, { trimSample: true })).toContain('Sex scenes')
    expect(instructionsText(explicit, { proseRules: false })).not.toContain('Sex scenes')
    expect(instructionsText(guide({ intensity: { romance: 3 } }))).not.toContain('Sex scenes')
  })

  it('says each content level plainly and lets the content limits win', () => {
    expect(contentText(guide())).toBe('')
    const text = contentText(guide({ intensity: { romance: 2 }, contentLimits: 'No harm to animals.' }))
    expect(text).toContain('- Romance: attraction, tension and kisses are fine')
    expect(text).toContain('For anything not covered here, judge by the genre.')
    expect(text).toContain('follow the content limits')
  })

  it('gives the rules against AI phrasing, naming no stock phrase (naming one can prime it)', () => {
    const full = aiPhrasesText()
    for (const r of SLOP_RULES) expect(full).toContain(r)
    for (const p of PROMPT_SLOP) expect(full).not.toContain(p)
    expect(full).not.toContain('Never use stock phrases like these')
    // Nor does the craft rule list clichés by example: it says what to do instead.
    const prompt = instructionsText(guide())
    expect(prompt).not.toContain("a breath someone didn't know they were holding")
    expect(prompt).toContain('Show feeling through what someone does or says')
  })

  it('leaves the AI phrasing rules out when I turn them off, or for jobs that write no prose', () => {
    // The writer's own rules carry them, merged (the overhaul, 2026-10-19); other jobs get them as their own list.
    const on = instructionsText(guide())
    const off = instructionsText({ ...guide(), avoidAiPhrases: false })
    expect(on).toContain(`avoid "it wasn't X, it was Y" and lists of three adjectives`)
    expect(on).toContain(PLAIN_RULE)
    expect(off).not.toContain(`it wasn't X, it was Y`)
    expect(off).not.toContain(PLAIN_RULE)
    // The craft itself stays either way.
    for (const t of [on, off]) expect(t).toContain('Show feeling through what someone does or says')
    expect(on).not.toContain('Write like a person')
    expect(instructionsText(guide(), { intro: 'Answer questions.', proseRules: false })).not.toContain('Write like a person')
    expect(instructionsText(guide(), { intro: 'Revise it.' })).toContain('Write like a person')
    expect(instructionsText({ ...guide(), avoidAiPhrases: false }, { intro: 'Revise it.' })).not.toContain('Write like a person')
  })

  it('grows block 1 by about 550 tokens at most (a blend, all three content levels, the AI phrases), and much less in its short form', () => {
    const enc = getEncoding('o200k_base')
    const estimateTokens = (s: string): number => enc.encode(s).length
    const plain = { ...guide({ pov: 'Close third person', tense: 'Past tense' }), avoidAiPhrases: false }
    const feel = { ...plain, genres: ['fantasy', 'romance'], intensity: { romance: 2, violence: 3, language: 2 } as StyleGuide['intensity'], avoidAiPhrases: true }
    const grow = estimateTokens(instructionsText(feel)) - estimateTokens(instructionsText(plain))
    // The AI phrases are two clauses of the writer's own rules since the overhaul, not a list of six.
    expect(grow).toBeGreaterThan(250)
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
    expect(text).not.toContain('blunt words')
  })

  it('reminds an explicit draft to play the sex on the page', () => {
    const text = finalInstruction({
      targetWords: 1000,
      style: guide({ intensity: { romance: 4 } }),
      hasBeats: true,
      hasPrevious: false,
      hasDirection: false
    })
    expect(text).toContain('play every act on the page in blunt words and direct talk')
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

// ---------- The writing instructions overhaul (2026-10-19) ----------

describe("the writer's rules, each said once", () => {
  const epic = stylePresetById('epic-fantasy')!
  const style = { ...withPreset(guide(), epic), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' as const, avoidPhrases: ['suddenly', 'a beat'], avoidAiPhrases: true }
  const rules = (text: string): string[] => text.split('\n\n').find((p) => /^How to (write|carry)/.test(p))!.split('\n').filter((l) => l.startsWith('- '))
  const times = (text: string, words: string): number => text.split(words).length - 1

  it('merges the craft rules and the rules against AI phrasing into about ten', () => {
    const text = instructionsText(style)
    expect(rules(text)).toHaveLength(10)
    expect(text).not.toContain('Write like a person, not like an AI')
    // Each meaning once: feeling, explaining, sentences, the ending, the facts, the format, the point of view.
    expect(times(text, 'body reactions')).toBe(1)
    expect(times(text, "don't explain")).toBe(1)
    expect(times(text, 'Vary sentence')).toBe(1)
    expect(times(text, 'sums up')).toBe(1)
    expect(times(text, 'contradict')).toBe(1)
    expect(times(text, '*asterisks*')).toBe(1)
    expect(times(text, 'point of view the style guide sets')).toBe(1)
    // What must stay: the point of view, the tense, the format, canon, the words to avoid.
    expect(text).toContain('- Point of view: Close third person')
    expect(text).toContain('- Tense: Past tense')
    expect(text).toContain('wrap them in single *asterisks*')
    expect(text).toContain("Never contradict it or break the world's rules")
    expect(text).toContain('Keep every name, title and spelling exactly as given.')
    expect(text).toContain('Words and phrases to avoid\nNever use any of these:\n- suddenly\n- a beat')
    // Add below keeps its own rules, with the same craft after them.
    const add = instructionsText(style, { addBelow: true })
    expect(rules(add)).toHaveLength(13)
    expect(times(add, 'body reactions')).toBe(1)
    expect(add).toContain('never stop on a line that sums up or looks ahead')
  })

  it('wants and pushing against each other happen within the planned events, not as new ones', () => {
    expect(writerInstructions('Close third person')).toContain(
      'Tension comes from what the characters want and how they push against each other within those events, not from new ones.'
    )
    expect(writerInstructions('Close third person', true)).toContain('Invent no new events of your own')
  })
})

describe('the style guide outranks the plain-word rules', () => {
  it('says so first, and keeps the plain-word rule only where the prose style doesn’t ask for rich prose', () => {
    const lead = 'Where the style guide or the sample passage below asks for a different style, follow it over these rules.'
    const plain = instructionsText({ ...guide(), proseStyle: 'Measured, textured prose.' })
    expect(plain).toContain(`How to write the scene\n${lead}`)
    expect(plain).toContain(PLAIN_RULE)
    expect(PLAIN_RULE).toContain('unless the style guide asks for richer prose')
    for (const id of ['lyrical-literary', 'spicy-romantasy', 'steamy-romance']) {
      const preset = stylePresetById(id)!
      expect(asksForRichProse(preset.style.proseStyle), id).toBe(true)
      expect(instructionsText(withPreset(guide(), preset)), id).not.toContain(PLAIN_RULE)
      expect(aiPhrasesText(preset.style.proseStyle), id).not.toContain(PLAIN_RULE)
    }
    for (const id of ['epic-fantasy', 'spare-minimalist', 'pacy-thriller']) expect(asksForRichProse(stylePresetById(id)!.style.proseStyle), id).toBe(false)
    expect(aiPhrasesText()).toContain(PLAIN_RULE)
  })
})

describe("Generate's closing instruction", () => {
  const base = { targetWords: 1500, style: guide({ pov: 'Close third person', tense: 'Past tense', spelling: 'UK' }), hasBeats: true, hasPrevious: true, hasDirection: false }

  it("opens with the scene's point and two craft priorities, and keeps the beats with the goal, conflict and outcome", () => {
    const text = finalInstruction({
      ...base,
      hasGoal: true,
      hasOutcome: true,
      point: { pov: 'Wren Hollis', goal: 'Get the case across the river.', conflict: 'The ferryman wants a toll', outcome: 'She trades the compass' }
    })
    expect(text).toMatch(
      /^Write the scene now\.\nThe scene's point: what Wren Hollis wants here, what stands against it, and how it turns\.\nWants: Get the case across the river\.\nAgainst it: The ferryman wants a toll\.\nHow it turns: She trades the compass\.\n\n- Play it out moment by moment/
    )
    expect(text).toContain('- Make it particular:')
    expect(text).toContain('- Hit every beat on the scene card, in order, and let them carry the goal, the conflict and the outcome.')
    expect(text).toContain('- Aim for about 1,500 words.')
    expect(text).toContain("- Continue seamlessly from where the previous scene ends. Don't repeat or recap it.")
  })

  it('asks for the point in general terms when the card gives none', () => {
    const text = finalInstruction(base)
    expect(text).toContain("First find the scene's point: what the point-of-view character wants here, what stands against it, and how it turns by the end.")
    expect(text).toContain('- Hit every beat on the scene card, in order.')
  })

  it('no longer says again what the system prompt and what must stay true say', () => {
    const text = finalInstruction(base)
    expect(text).not.toContain('Prose only')
    expect(text).not.toContain('Keep to close third person')
    expect(text).not.toContain('Never contradict')
    // Add below's closing is its own, as the writer lab left it.
    const add = finalInstruction({ ...base, addBelow: true, direction: 'Ash comes back' })
    expect(add).toContain('- Never contradict the facts given above.')
    expect(add).not.toContain("The scene's point")
  })
})
