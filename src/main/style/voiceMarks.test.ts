import { describe, expect, it } from 'vitest'
import { marksOf, spokenWords, voiceMarksFor, type SpokenBy } from './voiceMarks'

// Invented lines only.
const BRYN = [
  'Get the lamp, girl.',
  'Aye. Leave it.',
  'No. Not that one, girl.',
  'Tide turns soon. Aye.',
  'Move.',
  'Nets first. Then supper.',
  'Aye, I heard.',
  'Shut the door, girl.',
  'Stop that. Aye.',
  'Too late now.',
  'Rope. Now.',
  'We go at dawn.'
]
const WREN = [
  'Could you please pass the salt, if it isn’t too much trouble for you this evening?',
  'Why would anyone build a mill so close to the river when everyone knows it floods every single spring?',
  'Please, Bryn, can we go and look at the boats before it gets too dark to see anything?',
  'I don’t understand why we always have to leave before the sun is even properly up over the hill.',
  'What happens to the fish that nobody buys at the market by the end of the day?'
]
const ABBOT = [
  'I do not think that wise, child.',
  'We cannot leave the bells unrung, whatever the hour may be.',
  'It is not for us to ask what the river wants of us.',
  'I am too old to run, and too stubborn to hide.'
]

const lines = (entryId: string, texts: string[], own = true): SpokenBy[] => texts.map((text) => ({ entryId, text, own }))

describe('reading how someone talks from their lines', () => {
  it('a terse speaker: short sentences, what they call people, a word they favour, never please', () => {
    const marks = marksOf(BRYN, { others: [...WREN, ...ABBOT, 'Please wait.', 'Please, no.'], names: new Set(['bryn', 'wren']) })
    expect(marks[0]).toMatch(/^short sentences \(about \d words\)$/)
    expect(marks).toContain('calls people "girl"')
    expect(marks).toContain('often says "aye"')
    expect(marks).toContain('never says "please"')
    expect(marks.length).toBeLessThanOrEqual(5)
  })

  it('a formal speaker never uses contractions; a curious one asks a lot of questions and says please', () => {
    expect(marksOf(ABBOT, { others: BRYN })).toContain('never uses contractions ("do not", "cannot")')
    const wren = marksOf(WREN, { others: BRYN, names: new Set(['bryn']) })
    expect(wren).toContain('long sentences (about 18 words)')
    expect(wren).toContain('asks a lot of questions')
    expect(wren).toContain('says "please" a lot')
  })

  it('a dropped g, swearing, trailing off', () => {
    const texts = [
      'Ain’t goin’ nowhere tonight, not with the tide like this, bloody fool…',
      'Nothin’ to see out there. Bloody cold, and the nets all wet…',
      'Damn this rain, I tell you, it never stops…',
      'Bloody boats, the lot of them.'
    ]
    const marks = marksOf(texts, { others: WREN })
    expect(marks).toContain(`drops the g ("goin'" and "nothin'")`)
    expect(marks.some((m) => m.startsWith('swears ("bloody"'))).toBe(true)
    expect(marks).toContain('trails off ("…")')
  })

  it('another name someone goes by: who is called it', () => {
    const texts = [
      'Come over here and sit by the fire, Wrennie.',
      'Wrennie, not now, I am counting the takings.',
      'Eat your supper before it goes cold, Wrennie.',
      'Bed now, and no arguing with me about it.'
    ]
    const marks = marksOf(texts, { others: [], aliasOf: new Map([['wrennie', 'Wren Hollis']]) })
    expect(marks).toContain('calls Wren Hollis "Wrennie"')
    // Calling someone by their own name tells nothing; "my god" is no one.
    const plain = marksOf(
      ['Wren, come here and look at this.', 'Sit down by the stove, Wren.', 'Oh, my god, the whole roof is going.', 'Wren, eat something before we go.'],
      { others: [], names: new Set(['wren']) }
    )
    expect(plain.filter((m) => m.startsWith('calls'))).toEqual([])
  })

  it('too few lines or words: nothing said', () => {
    expect(marksOf(['Aye.', 'Aye.'], { others: [] })).toEqual([])
    expect(marksOf(['No.', 'Yes.', 'Go.'], { others: [] })).toEqual([])
  })
})

describe('each character’s marks, Adam’s own lines first', () => {
  const people = [
    { id: 'bryn', name: 'Bryn' },
    { id: 'wren', name: 'Wren Hollis', aliases: ['Wrennie'] },
    { id: 'quiet', name: 'Ash' }
  ]

  it('uses his own lines alone when there are enough, else all of theirs; nothing for someone with too few', () => {
    // Bryn's own lines are terse; the AI's lines for him are long-winded. His own win.
    const aiBryn = lines('bryn', WREN, false)
    const all = [...lines('bryn', BRYN), ...aiBryn, ...lines('wren', WREN, false), ...lines('quiet', ['Hm.'])]
    const marks = voiceMarksFor(all, people, all.map((l) => l.text))
    expect(marks.get('bryn')).toMatchObject({ own: true, lines: BRYN.length })
    expect(marks.get('bryn')!.text).toMatch(/^short sentences/)
    // Wren has only the AI's lines: still read, but not as his own.
    expect(marks.get('wren')).toMatchObject({ own: false })
    expect(marks.has('quiet')).toBe(false)
  })

  it('takes the words inside the quotation marks of a line', () => {
    expect(spokenWords('“Get the lamp, girl,” Bryn said. “The one that works.”')).toEqual(['Get the lamp, girl,', 'The one that works.'])
    expect(spokenWords('"Ain’t got nothin’," said Bryn.')).toEqual(['Ain’t got nothin’,'])
    expect(spokenWords('A line with no marks')).toEqual(['A line with no marks'])
  })
})
