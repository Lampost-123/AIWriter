// Who speaks a line, read without the AI (long story memory fix 8): only the plain ways a line is given to someone.
// Invented test text only.
import { describe, expect, it } from 'vitest'
import { namedPlaces, narratorI, quoteSpans, spokenLines } from './speakers'

const PEOPLE = [
  { id: 'tobin', names: ['Tobin'] },
  { id: 'mara', names: ['Mara'] },
  { id: 'venn', names: ['Mara Venn'] }
]
const said = (text: string, people = PEOPLE) => spokenLines(text, people).map((l) => [l.entryId, l.quote])
const spans = (text: string) => quoteSpans(text).map((s) => text.slice(s.start, s.end))

describe('quotations', () => {
  it('finds curly, straight and single quotation marks, but not apostrophes', () => {
    expect(spans('“Go,” she said. "Now," he said.')).toEqual(['“Go,”', '"Now,"'])
    expect(spans("‘I can’t,’ said Mara. The boys’ coats hung by the door.")).toEqual(['‘I can’t,’'])
    expect(spans("'Don't,' Tobin said. It's late.")).toEqual(["'Don't,'"])
    // Marks of the other kind inside one are part of it.
    expect(spans('“She said ‘never’ to me,” Mara said.')).toEqual(['“She said ‘never’ to me,”'])
  })

  it('runs one left open to the end of its paragraph (speech over several paragraphs)', () => {
    expect(spans('“It was late,\n“and we were cold.”')).toEqual(['“It was late,', '“and we were cold.”'])
  })
})

describe('who speaks a line', () => {
  it('reads the plain ways a line is given to someone', () => {
    expect(said('“You took your time,” said Tobin.')).toEqual([['tobin', '“You took your time,” said Tobin.']])
    expect(said('“You took your time,” Tobin said quietly. Mara shrugged.')).toEqual([['tobin', '“You took your time,” Tobin said quietly.']])
    expect(said('Tobin said, “You took your time.” Mara shrugged.')).toEqual([['tobin', 'Tobin said, “You took your time.”']])
    expect(said('"Where were you?" asked Tobin.')).toEqual([['tobin', '"Where were you?" asked Tobin.']])
    expect(said('‘Go,’ Tobin whispered.')).toEqual([['tobin', '‘Go,’ Tobin whispered.']])
    // The line before, in the paragraph before, is someone else's.
    expect(said('“Where were you?”\nTobin said, “Out.”')).toEqual([['tobin', 'Tobin said, “Out.”']])
  })

  it('never takes someone spoken of or to, or remembered, for the speaker', () => {
    // Named inside the line.
    expect(said('“Tobin would have laughed,” Mara said.')).toEqual([['mara', '“Tobin would have laughed,” Mara said.']])
    expect(said('“Where is Tobin?” she asked.')).toEqual([])
    // A memory: "had said", "would say".
    expect(said('Tobin had said, “Go.”')).toEqual([])
    expect(said('“Go,” Tobin had said, years ago.')).toEqual([])
    // Not opening the sentence: "remembered how Tobin said".
    expect(said('She remembered how Tobin said, “Go.”')).toEqual([])
    // Someone else's: "said Tobin's sister".
    expect(said('“Go,” said Tobin’s sister.')).toEqual([])
    // No line next to it.
    expect(said('Tobin said nothing at all.')).toEqual([])
  })

  it('tells two people named alike apart: the longest name, and never words two people go by', () => {
    expect(said('“Go,” said Mara Venn.')).toEqual([['venn', '“Go,” said Mara Venn.']])
    expect(said('“Go,” said Mara.')).toEqual([['mara', '“Go,” said Mara.']])
    const twoCaptains = [
      { id: 'a', names: ['Ash', 'the Captain'] },
      { id: 'b', names: ['Bryn', 'the Captain'] }
    ]
    expect(said('“Hold fast,” said the Captain.', twoCaptains)).toEqual([])
    expect(namedPlaces('the Captain and Ash', twoCaptains).map((n) => n.id)).toEqual([null, 'a'])
  })

  it('reads what this scene calls someone as one of their names', () => {
    expect(said('“Go home,” said her brother.', [{ id: 'tobin', names: ['Tobin', 'her brother'] }])).toEqual([['tobin', '“Go home,” said her brother.']])
  })
})

describe('first person', () => {
  it('counts "I", "me" and "my" in the narration, not in what is said', () => {
    expect(narratorI('I walked to the gate. My hands were cold, and the wind found me.')).toBe(3)
    expect(narratorI('“I will go,” she said. “Give me the key.”')).toBe(0)
  })
})
