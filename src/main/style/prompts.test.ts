// What the writer model is told for "Write a sample for me" and for the polish pass. Made-up style guides only.
import { describe, expect, it } from 'vitest'
import type { StyleGuide } from '@shared/types'
import { genreById } from '@shared/genres'
import { INTENSITY } from '@shared/intensity'
import { SLOP_RULES } from '@shared/slop'
import { POLISH_CHECKS, polishMessages, polishReplyTokens, sampleMessages, STYLE_MARKER } from './prompts'

const guide = (over: Partial<StyleGuide & { avoidAiPhrases: boolean }> = {}): StyleGuide & { avoidAiPhrases?: boolean } => ({
  pov: 'Close third person',
  tense: 'Past tense',
  proseStyle: 'Spare and wry, with short paragraphs.',
  samplePassage: 'The kettle sang twice before anyone moved to it.',
  avoidPhrases: ['suddenly'],
  spelling: 'UK',
  contentLimits: '',
  notes: '',
  genres: ['horror', 'comedy'],
  genreNotes: 'Cosy on the surface, rotten underneath.',
  intensity: { violence: 3, language: 2 },
  avoidAiPhrases: true,
  ...over
})

describe('the sample passage prompt', () => {
  it('starts with its marker and asks for a fresh passage of about 200 words', () => {
    const [system, user] = sampleMessages(guide(), 'Bleak but tender.')
    expect(system.role).toBe('system')
    expect(system.content.startsWith(`${STYLE_MARKER} sample\n`)).toBe(true)
    expect(system.content).toContain('about 200 words')
    expect(system.content).toMatch(/small, self-contained moment you invent/)
    expect(system.content).toMatch(/give nothing of any plot away/)
    expect(system.content).toMatch(/\*asterisks\*/)
    expect(user.role).toBe('user')
    expect(user.content).toMatch(/^Write the sample passage now\./)
    expect(user.content).toContain('About 200 words of prose only')
  })

  it('carries the whole voice the style guide describes', () => {
    const [system, user] = sampleMessages(guide(), 'Bleak but tender.')
    const horror = genreById('horror')!
    const comedy = genreById('comedy')!
    // The genre picks, the blend and the author's own take.
    expect(system.content).toContain('Genre and feel')
    expect(system.content).toContain(horror.guidance)
    expect(system.content).toContain(`with the feel of ${comedy.label.toLocaleLowerCase()}`)
    expect(system.content).toContain("The author's own take on it: Cosy on the surface, rotten underneath.")
    // Prose style, point of view, tense and spelling.
    expect(system.content).toContain('- Prose style: Spare and wry, with short paragraphs.')
    expect(system.content).toContain('- Point of view: Close third person')
    expect(system.content).toContain('- Tense: Past tense')
    expect(system.content).toContain('- Spelling: UK English')
    expect(user.content).toContain('- Keep to close third person, past tense and UK spelling.')
    // The content levels that are set.
    expect(system.content).toContain(INTENSITY[1].steps[2].prompt)
    expect(system.content).toContain(INTENSITY[2].steps[1].prompt)
    // The rules against AI phrasing, and the words to avoid.
    expect(system.content).toContain('Write like a person, not like an AI')
    expect(system.content).toContain(SLOP_RULES[0])
    expect(system.content).toContain('- suddenly')
    // The genre and the tone, last.
    expect(user.content).toContain(`- Keep the ${horror.feel} of horror, with the ${comedy.feel} of comedy, and the story's tone: Bleak but tender.`)
  })

  it('writes from the description, not from a sample passage already there', () => {
    const [system] = sampleMessages(guide(), '')
    expect(system.content).not.toContain('The kettle sang twice')
    expect(system.content).not.toContain('Sample passage\n')
  })

  it('leaves out what isn’t set, and the AI phrasing rules when Adam turned them off', () => {
    const [system, user] = sampleMessages(
      guide({ pov: '', tense: '', spelling: '', proseStyle: '', genres: [], genreNotes: '', intensity: {}, avoidPhrases: [], avoidAiPhrases: false }),
      ''
    )
    expect(system.content).not.toContain('Genre and feel')
    expect(system.content).not.toContain('Content\n')
    expect(system.content).not.toContain('Write like a person, not like an AI')
    expect(user.content).toContain('Pick a point of view and a tense that suit the style guide')
    expect(user.content).not.toContain("story's tone")
  })
})

describe('the polish pass prompt', () => {
  const draft = 'Mara set the lantern down.\n\n"Again," said the ferryman.'

  it('starts with its marker and names every weakness to look for', () => {
    const [system] = polishMessages(guide(), '', draft)
    expect(system.content.startsWith(`${STYLE_MARKER} polish\n`)).toBe(true)
    for (const check of POLISH_CHECKS) expect(system.content).toContain(`- ${check}`)
    for (const word of ['Clichés', 'Needless explaining', 'Purple prose', 'repetitive sentence patterns', 'Vague detail', 'Odd word choice', 'Tense or point-of-view slips'])
      expect(system.content).toContain(word)
    expect(system.content).toMatch(/return the whole scene revised/)
    expect(system.content).toMatch(/same events in the same order/)
  })

  it('checks against the genre and the style guide, sample passage included, and sends the draft', () => {
    const [system, user] = polishMessages(guide(), 'Bleak but tender.', draft)
    expect(system.content).toContain(genreById('horror')!.guidance)
    expect(system.content).toContain('- Prose style: Spare and wry, with short paragraphs.')
    expect(system.content).toContain('The kettle sang twice before anyone moved to it.')
    expect(system.content).toContain('Write like a person, not like an AI')
    expect(user.content).toContain(`"""\n${draft}\n"""`)
    expect(user.content).toContain('- Return the whole revised scene, from its first line to its last, and nothing else.')
    expect(user.content).toContain('- Keep to close third person, past tense and UK spelling.')
    expect(user.content).toContain("the story's tone: Bleak but tender.")
  })

  it('leaves room for a reply as long as the draft', () => {
    const long = 'word '.repeat(2000)
    expect(polishReplyTokens(long)).toBeGreaterThan(polishReplyTokens(draft))
    expect(polishReplyTokens(long)).toBeGreaterThan(long.length / 3.5)
  })
})
