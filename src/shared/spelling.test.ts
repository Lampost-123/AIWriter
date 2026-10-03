import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  inSpelling,
  isOneWord,
  languageFor,
  matchCase,
  MAX_SYNONYMS,
  parseThesaurus,
  synonymsFor,
  wordAt,
  worldWordChanges,
  worldWordsOf
} from './spelling'

// A small made-up thesaurus in the shipped file's format (build/thesaurus.mjs).
const SMALL = parseThesaurus(
  [
    'AIWRITE-THESAURUS 1',
    '#variants',
    'color\tcolour',
    'center\tcentre',
    'coloring\tcolouring',
    'colorize\tcolourise\tcolorise\tcolourize',
    'realize\trealise',
    'theater\ttheatre',
    '#words',
    'color\tn|coloring|hue|tint\tv|tinge|color in',
    'happy\tadj|glad|cheerful|content|joyful|merry|jolly\tadj|felicitous|fortunate\tadj|willing\tadv|gladly',
    'middle\tn|center|heart|core\tadj|central|midway',
    'show\tn|theater show|performance\tv|display|exhibit',
    'big\tadj|large|huge|vast|giant|great|massive\tadj|important|major|weighty|grand|serious|key\tadj|loud|booming|resonant|thundering|full|rich\tadj|grown|adult|mature|older|elder|senior'
  ].join('\n')
)

describe('the spell checker’s language', () => {
  it('is en-GB for UK spelling and en-US for US', () => {
    expect(languageFor('UK')).toBe('en-GB')
    expect(languageFor('US')).toBe('en-US')
  })
})

describe('the world’s words', () => {
  it('takes every word of names and aliases, hyphenated names whole and in parts, and possessives', () => {
    const words = worldWordsOf([
      { name: 'Mara Vell', aliases: ['the Grey Warden'] },
      { name: 'Ash-Kel', aliases: [] },
      { name: 'Kal’dor', aliases: ['K'] },
      { name: 'Seventh Bell 1204', aliases: ['  '] }
    ])
    for (const w of ['Mara', 'Vell', "Mara's", 'the', 'Grey', 'Warden', 'Ash-Kel', 'Ash', 'Kel', "Kal'dor", 'Seventh', 'Bell']) expect(words).toContain(w)
    expect(words).not.toContain('K')
    expect(words).not.toContain('1204')
    expect(words).not.toContain("the's")
    expect(new Set(words).size).toBe(words.length)
  })

  it('adds only words that aren’t Adam’s own, and takes away only words it added', () => {
    const c = worldWordChanges(['Mara', 'Vell'], ['Mara', 'Teshra', 'Quill'], ['Mara', 'Vell', 'Quill'])
    // Quill was already in the dictionary (Adam's own): never added, so never taken away.
    expect(c.add).toEqual(['Teshra'])
    expect(c.remove).toEqual(['Vell'])
    expect(worldWordChanges(['Mara'], [], ['Mara'])).toEqual({ add: [], remove: ['Mara'] })
  })
})

describe('synonyms', () => {
  it('groups by sense with the part of speech, at most twelve words', () => {
    const s = synonymsFor(SMALL, 'big', 'US')
    expect(s.map((x) => x.pos)).toEqual(['adjective', 'adjective', 'adjective', 'adjective'])
    expect(s.reduce((n, x) => n + x.words.length, 0)).toBeLessThanOrEqual(MAX_SYNONYMS)
    expect(s[0].words).toEqual(['large', 'huge', 'vast'])
    const happy = synonymsFor(SMALL, 'Happy', 'UK')
    expect(happy[0]).toEqual({ pos: 'adjective', words: ['glad', 'cheerful', 'content'] })
    expect(happy.at(-1)).toEqual({ pos: 'adverb', words: ['gladly'] })
  })

  it('shows synonyms in UK spelling for a UK writer, and US for a US one', () => {
    expect(synonymsFor(SMALL, 'middle', 'UK')[0].words).toEqual(['centre', 'heart', 'core'])
    expect(synonymsFor(SMALL, 'middle', 'US')[0].words).toEqual(['center', 'heart', 'core'])
    expect(synonymsFor(SMALL, 'show', 'UK')[0].words).toEqual(['theatre show', 'performance'])
    expect(inSpelling(SMALL, 'colour-coded', 'US')).toBe('color-coded')
    // A word spelt more than two ways comes out in the one spelling for each.
    expect(inSpelling(SMALL, 'colorise', 'UK')).toBe('colourise')
    expect(inSpelling(SMALL, 'colourize', 'US')).toBe('colorize')
  })

  it('looks a UK word up by its US form when the UK one isn’t listed', () => {
    const s = synonymsFor(SMALL, 'colour', 'UK')
    expect(s[0]).toEqual({ pos: 'noun', words: ['colouring', 'hue', 'tint'] })
    expect(s[1]).toEqual({ pos: 'verb', words: ['tinge', 'colour in'] })
    expect(synonymsFor(SMALL, 'Colour’s', 'UK')).toEqual([])
    expect(synonymsFor(SMALL, 'zzz', 'UK')).toEqual([])
  })

  it('keeps the word’s capitals', () => {
    expect(matchCase('happy', 'glad')).toBe('glad')
    expect(matchCase('Happy', 'glad')).toBe('Glad')
    expect(matchCase('HAPPY', 'glad')).toBe('GLAD')
    expect(matchCase('Big', 'very large')).toBe('Very large')
    expect(matchCase('I', 'me')).toBe('Me')
  })
})

describe('the shipped thesaurus', () => {
  const file = join(__dirname, '../../resources/thesaurus/en-thesaurus.txt.gz')
  const real = parseThesaurus(gunzipSync(readFileSync(file)).toString('utf8'))

  it('has common words, in a few senses each', () => {
    expect(real.words.size).toBeGreaterThan(40_000)
    const happy = synonymsFor(real, 'happy', 'UK')
    expect(happy.length).toBeGreaterThan(0)
    expect(happy.flatMap((s) => s.words)).toContain('glad')
    const run = synonymsFor(real, 'run', 'UK')
    expect(run.some((s) => s.pos === 'verb')).toBe(true)
  })

  it('never offers the word in its other spelling, and spells for the writer', () => {
    const uk = synonymsFor(real, 'colour', 'UK').flatMap((s) => s.words)
    expect(uk).not.toContain('color')
    expect(uk).not.toContain('colour')
    expect(uk.some((w) => w.includes('color'))).toBe(false)
    const us = synonymsFor(real, 'color', 'US').flatMap((s) => s.words)
    expect(us.some((w) => w.includes('colour'))).toBe(false)
    expect(synonymsFor(real, 'realise', 'UK').flatMap((s) => s.words)).not.toContain('realize')
  })
})

describe('the word under the pointer', () => {
  const text = 'She said, “Mara’s well-worn coat.”'
  it('finds the whole word, with inner apostrophes and hyphens', () => {
    expect(wordAt(text, 1)?.word).toBe('She')
    expect(wordAt(text, 3)?.word).toBe('She')
    expect(wordAt(text, text.indexOf('Mara') + 2)?.word).toBe('Mara’s')
    expect(wordAt(text, text.indexOf('well') + 6)?.word).toBe('well-worn')
    expect(wordAt(text, text.indexOf('coat') + 4)?.word).toBe('coat')
  })
  it('finds nothing between words or in punctuation', () => {
    expect(wordAt('a , b', 2)).toBeNull()
    expect(wordAt('1204', 1)).toBeNull()
  })
  it('knows a one-word selection', () => {
    expect(isOneWord('happy')).toBe(true)
    expect(isOneWord('well-worn')).toBe(true)
    expect(isOneWord('two words')).toBe(false)
    expect(isOneWord('word.')).toBe(false)
  })
})
