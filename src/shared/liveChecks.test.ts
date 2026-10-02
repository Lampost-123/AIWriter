import { describe, expect, it } from 'vitest'
import type { CheckWords } from './contracts/checks'
import {
  checkScene,
  closestName,
  countFlags,
  editDistance,
  findAvoided,
  LiveCache,
  liveKey,
  phraseRe,
  prepareLiveWords,
  tokenize,
  type LiveFlag,
  type LiveParagraph
} from './liveChecks'

const WORDS: CheckWords = {
  names: [
    { entryId: 'e1', name: 'Mara', kind: 'character' },
    { entryId: 'e1', name: 'Mara Venn', kind: 'character' },
    { entryId: 'e2', name: 'Kell', kind: 'character' },
    { entryId: 'e3', name: 'Thornwick', kind: 'place' },
    { entryId: 'e4', name: 'The Dark Forest', kind: 'place' },
    { entryId: 'e5', name: "Kel'oran", kind: 'glossary' },
    { entryId: 'e6', name: 'Rose', kind: 'character' },
    { entryId: 'e7', name: 'Who took the Crown', kind: 'thread' }
  ],
  avoid: ['suddenly', 'all of a sudden', "couldn't help but", 'very']
}
const words = prepareLiveWords(WORDS)

const paras = (...texts: string[]): LiveParagraph[] => texts.map((text, i) => ({ pid: `p${i + 1}`, text }))
const check = (texts: string[], ignored: string[] = [], w = words): LiveFlag[] => checkScene(paras(...texts), w, new Set(ignored))
const of = (flags: LiveFlag[], kind: LiveFlag['kind']): string[] => flags.filter((f) => f.kind === kind).map((f) => f.word)

describe('words', () => {
  it('splits a paragraph into words, knowing possessives, capitals and where sentences start', () => {
    const t = tokenize('“Mara’s here,” said Kell. NASA called. Old-fashioned.')
    expect(t.map((x) => x.lower)).toEqual(["mara's", 'here', 'said', 'kell', 'nasa', 'called', 'old', 'fashioned'])
    expect(t[0]).toMatchObject({ base: 'mara', baseEnd: 5, cap: true, first: true })
    expect(t[2].first).toBe(false)
    expect(t[2].joined).toBe(false)
    expect(t[4]).toMatchObject({ caps: true, first: true })
    expect(t[7].joined).toBe(true)
  })

  it('measures how far apart two words are, with a swap of neighbours counting as one', () => {
    expect(editDistance('marra', 'mara')).toBe(1)
    expect(editDistance('maar', 'mara')).toBe(1)
    expect(editDistance('thornwik', 'thornwick')).toBe(1)
    expect(editDistance('thronwik', 'thornwick')).toBe(2)
    expect(editDistance('kitten', 'sitting', 1)).toBe(2)
  })
})

describe('phrases to avoid', () => {
  it('matches whole words and phrases whatever their case, with either apostrophe and around punctuation', () => {
    const flags = check([
      'Suddenly, the door opened. All of a  sudden she was there.',
      'He couldn’t help but laugh. It was very cold — "very."',
      'Everything happened suddenly! Unsuddenly and veryish are not words.'
    ])
    expect(of(flags, 'phrase')).toEqual(['Suddenly', 'All of a  sudden', 'couldn’t help but', 'very', 'very', 'suddenly'])
    expect(flags[0]).toMatchObject({ key: 'phrase:p1:suddenly', message: '“suddenly” is on your list of phrases to avoid.' })
  })

  it('takes the longest phrase where two overlap', () => {
    const w = prepareLiveWords({ names: [], avoid: ['sudden', 'all of a sudden'] })
    expect(findAvoided('All of a sudden.', w.avoid).map((s) => s.word)).toEqual(['All of a sudden'])
  })

  it('ignores blank and punctuation-only phrases', () => {
    expect(phraseRe('  ')).toBeNull()
    expect(phraseRe('...')).toBeNull()
    expect(phraseRe('a (b)')!.test('a (b)')).toBe(true)
  })
})

describe('name spelling', () => {
  it('flags a word a letter away from a name, possessives included, and suggests the name', () => {
    const flags = check(['Marra ran. Then Marra’s sword fell, and Kel came after.'])
    const sp = flags.filter((f) => f.kind === 'spelling')
    expect(sp.map((f) => [f.word, f.suggestion])).toEqual([
      ['Marra', 'Mara'],
      ['Marra', 'Mara'],
      ['Kel', 'Kell']
    ])
    expect(sp[1]).toMatchObject({ from: 16, to: 21, key: 'spelling:marra', message: '“Marra” looks like a misspelling of Mara.' })
  })

  it('allows two letters for long names, one for short ones', () => {
    expect(closestName('thronwik', words)).toBe('Thornwick')
    expect(closestName('marrra', words)).toBeNull()
    expect(closestName('kelll', words)).toBe('Kell')
    expect(closestName('kellll', words)).toBeNull()
  })

  it('leaves names, aliases, ordinary words, capitals, short names and other first letters alone', () => {
    const flags = check([
      'Mara Venn met Kell in Thornwick. Many came. Mark my words, said Rose.',
      'MARRA! Sara and Tara waved. The Crown was lost. Venn nodded. Kel’oran is old.',
      'Dark clouds. Forest paths. Roses. Mars.'
    ])
    expect(of(flags, 'spelling')).toEqual([])
  })

  it('never flags lower-case words', () => {
    expect(of(check(['the marra was here']), 'spelling')).toEqual([])
  })
})

describe('repetition nearby', () => {
  it('flags a word used three times nearby, after the first, saying how often', () => {
    const flags = check(['The dark room was cold. Outside, the dark sky pressed down.', 'She stepped into the dark and waited.'])
    const rep = flags.filter((f) => f.kind === 'repetition')
    expect(rep.map((f) => f.word)).toEqual(['dark', 'dark'])
    expect(rep[0]).toMatchObject({ para: 0, key: 'repetition:dark', message: '“dark” is used 3 times in a few paragraphs.' })
    expect(rep[1].para).toBe(1)
  })

  it('doesn’t flag a word used three times far apart', () => {
    const filler = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    expect(of(check([`The lantern swung. ${filler}`, `A lantern glowed. ${filler}`, `The lantern died.`]), 'repetition')).toEqual([])
  })

  it('flags a phrase used again in the scene, and not its words again', () => {
    const filler = Array.from({ length: 160 }, (_, i) => `w${i}`).join(' ') + '.'
    const flags = check([`A cold wind blew through the pass. ${filler}`, 'Again a cold wind blew through the trees.'])
    const rep = flags.filter((f) => f.kind === 'repetition')
    expect(rep.map((f) => f.word)).toEqual(['cold wind blew'])
    expect(rep[0].message).toBe('“cold wind blew” is used twice in this scene.')
  })

  it('flags a two-word phrase only nearby', () => {
    const filler = Array.from({ length: 160 }, (_, i) => `w${i}`).join(' ') + '.'
    expect(of(check(['His iron grip held. Her iron grip slipped.']), 'repetition')).toEqual(['iron grip'])
    expect(of(check([`His iron grip held. ${filler}`, 'Her iron grip slipped.']), 'repetition')).toEqual([])
  })

  it('leaves names, little words and dialogue tags alone', () => {
    const flags = check(['“Go,” said Mara. “Now,” said Mara. “Please,” said Mara, and she could not, would not, could not wait.'])
    expect(of(flags, 'repetition')).toEqual([])
  })

  it('stays calm on ordinary prose', () => {
    const passage = [
      'The tavern was warm and loud. Rain hammered the shutters, and somewhere near the hearth a man was singing badly about a ship that never came home.',
      'Mara pushed through the crowd to the back table. Kell was already there, his hood down, a cup of something dark in front of him. He did not look up when she sat.',
      '“You’re late,” he said.',
      '“The road from Thornwick flooded. I had to go round by the mill.” She shrugged off her wet cloak and hung it on the peg behind her. “Did he come?”',
      'Kell turned the cup slowly in his hands. “He came. He left a message.” He slid a folded paper across the table. The wax seal was broken, and the paper was soft from handling.',
      'She read it twice. The words did not change. Her brother was alive, and he was in the north, and he did not want to be found.',
      '“When did he leave?”',
      '“An hour before you came. He said you would understand.” Kell finally looked at her. His eyes were tired, and older than she remembered. “Do you?”',
      'Mara folded the paper and put it inside her shirt, against her skin, where the rain had not reached. Outside, the wind changed, and the shutters banged once and were still.',
      '“No,” she said. “But I will.”'
    ]
    const flags = check(passage, [], prepareLiveWords({ names: WORDS.names, avoid: [] }))
    // Only “paper”, which is there three times in four sentences.
    expect(flags.map((f) => f.word)).toEqual(['paper', 'paper'])
  })
})

describe('the whole scene', () => {
  it('keeps ignored keys out: a spelling anywhere, a phrase in its paragraph, a repetition in the scene', () => {
    const texts = ['Suddenly Marra saw the dark, dark, dark sky.', 'Suddenly it rained.']
    expect(countFlags(check(texts))).toEqual({ phrase: 2, repetition: 2, spelling: 1 })
    const ignored = [liveKey('spelling', 'Marra'), liveKey('phrase', 'suddenly', 'p1'), liveKey('repetition', 'dark')]
    const flags = check(texts, ignored)
    expect(flags.map((f) => [f.kind, f.para])).toEqual([['phrase', 1]])
  })

  it('leaves a repeat inside a phrase to avoid to that flag', () => {
    const flags = check(['It was very very very cold.'])
    expect(countFlags(flags)).toEqual({ phrase: 3, repetition: 0, spelling: 0 })
  })

  it('reads again only the paragraphs whose text changed', () => {
    const cache = new LiveCache()
    const ps = paras('One Marra.', 'Two.', 'Three.')
    checkScene(ps, words, new Set(), cache)
    expect(cache.size).toBe(3)
    const before = cache.get('Two.')
    ps[0] = { ...ps[0], text: 'One Mara.' }
    const flags = checkScene(ps, words, new Set(), cache)
    expect(cache.size).toBe(3)
    expect(cache.get('Two.')).toBe(before)
    expect(flags).toEqual([])
  })

  it('checks a 10,000-word scene again within a frame after one paragraph changes', () => {
    const sentences = [
      'The tavern was warm and loud, and rain hammered the shutters all night.',
      'Mara pushed through the crowd to the back table where Kell sat waiting.',
      'He slid a folded paper across the table without a word.',
      'Outside, the wind changed, and the lanterns along the quay swung and hissed.',
      'She read the letter twice and put it inside her shirt.'
    ]
    const texts = Array.from({ length: 500 }, (_, i) => `${sentences[i % 5]} ${sentences[(i + 2) % 5]} Number ${i}.`)
    const ps = paras(...texts)
    const cache = new LiveCache()
    const w = prepareLiveWords({ names: WORDS.names, avoid: [...WORDS.avoid, 'quay'] })
    checkScene(ps, w, new Set(), cache)
    let worst = 0
    for (let k = 0; k < 30; k++) {
      ps[250] = { ...ps[250], text: `${texts[250]} Suddenly ${k}.` }
      const t0 = performance.now()
      checkScene(ps, w, new Set(), cache)
      const dt = performance.now() - t0
      // After a few runs, once the code is warmed up as it is in the app.
      if (k >= 10) worst = Math.max(worst, dt)
    }
    expect(worst).toBeLessThan(16)
  })
})
