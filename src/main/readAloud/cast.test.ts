import { describe, expect, it } from 'vitest'
import { attributeRun, castOf, everyone, memberNamed, namesFor, speakerOf, type SceneCast } from './cast'
import { QUOTE } from './speakers'

const world = castOf([
  { id: 'mara', name: 'Mara Quill', aliases: ['the captain'], about: 'Runs the ferry.' },
  { id: 'tom', name: 'Tomas', aliases: [], about: '' },
  { id: 'anselm', name: 'Brother Anselm', aliases: [], about: '' }
])
const [mara, tom, anselm] = world
const all = everyone(world)

/** Who says each quote of these paragraphs, read as one run. */
function speakers(paragraphs: string[], cast: SceneCast = all): (string | null)[] {
  // Every paragraph is in the run (as reading has it), its quotes as pieces of their own.
  const pieces = paragraphs.flatMap((para, i) => [
    { block: `p${i}`, para, at: 0, len: 0, quote: false },
    ...[...para.matchAll(new RegExp(QUOTE.source, 'g'))].map((m) => ({ block: `p${i}`, para, at: m.index!, len: m[0].length, quote: true }))
  ])
  return attributeRun(pieces, cast).flatMap((a, i) => (pieces[i].quote ? [a?.who.id ?? null] : []))
}

describe('the names a character goes by', () => {
  it('has the full name, aliases and the short form, longest first', () => {
    expect(namesFor({ name: 'Mara Quill', aliases: ['the captain'] })).toEqual(['the captain', 'Mara Quill', 'Mara'])
    // After a title, the short form is the name, not the title.
    expect(namesFor({ name: 'Brother Anselm', aliases: [] })).toEqual(['Brother Anselm', 'Anselm'])
  })

  it('finds a character by any name the AI gives back', () => {
    expect(memberNamed(world, 'The Captain')?.id).toBe('mara')
    expect(memberNamed(world, 'anselm')?.id).toBe('anselm')
    expect(memberNamed(world, 'narrator')).toBeNull()
    expect(memberNamed(world, 'the guard')).toBeNull()
  })
})

describe('speech tags', () => {
  it('follows a tag after the quote or before it, by name or alias', () => {
    const at = (para: string): { at: number; len: number } => {
      const m = new RegExp(QUOTE.source).exec(para)!
      return { at: m.index, len: m[0].length }
    }
    const check = (para: string): string | undefined => {
      const { at: a, len } = at(para)
      return speakerOf(para, a, len, all)?.who.id
    }
    expect(check('“Get out,” said Mara.')).toBe('mara')
    expect(check('“Get out,” Tomas snapped.')).toBe('tom')
    expect(check('Brother Anselm whispered, “Not here.”')).toBe('anselm')
    expect(check('“Hold the line!” the captain shouted.')).toBe('mara')
    expect(check('“Hold the line!” she shouted.')).toBeUndefined()
  })

  it('gives "I said" to the viewpoint character', () => {
    const para = '“Not tonight,” I said.'
    expect(speakerOf(para, 0, 14, { ...all, pov: tom })?.who.id).toBe('tom')
    expect(speakerOf(para, 0, 14, all)).toBeNull()
  })
})

describe('who says each line over a conversation', () => {
  it('keeps the same speaker for the quotes after a tagged one in a paragraph', () => {
    expect(speakers(['“Wait,” said Mara. She lifted the lamp. “Do you hear that?”'])).toEqual(['mara', 'mara'])
  })

  it('takes turns in a two-person exchange where lines have no tag', () => {
    expect(speakers(['“Where were you?” said Mara.', '“Out,” Tomas said.', '“Out where?”', '“Just out.”'])).toEqual([
      'mara',
      'tom',
      'mara',
      'tom'
    ])
  })

  it('gives an untagged quote to the one character its paragraph names', () => {
    expect(speakers(['Tomas leaned on the rail. “It’s going to rain.”'])).toEqual(['tom'])
    // Named inside the quote doesn't count: "Where's Tomas?" isn't Tomas talking.
    expect(speakers(['“Where’s Tomas?”'])).toEqual([null])
  })

  it('ends a conversation after two paragraphs with no dialogue', () => {
    expect(speakers(['“Ready?” said Mara.', '“Ready,” Tomas said.', 'They walked.', 'The road was long.', '“Here.”'])).toEqual([
      'mara',
      'tom',
      null
    ])
  })

  it('lets the scene’s own cast narrow who a paragraph names, while a tag can name anyone', () => {
    const scene: SceneCast = { all: world, scene: [mara], pov: null }
    // Tomas isn't in this scene: naming him in the narration doesn't make the line his...
    expect(speakers(['Tomas was gone. “Hello?”'], scene)).toEqual([null])
    // ...but a tag naming him does.
    expect(speakers(['“Hello?” Tomas called.'], scene)).toEqual(['tom'])
  })

  it('gives a quote to the speaker the AI marked, and never guesses a turn for someone the cast lacks', () => {
    const para = '“Who goes there?”'
    expect(attributeRun([{ block: 'a', para, at: 0, len: para.length, quote: true, label: anselm }], all)[0]?.how).toBe('label')
    const run = attributeRun(
      [
        { block: 'a', para: '“Ready?” said Mara.', at: 0, len: 8, quote: true },
        { block: 'b', para: '“Ready,” said Tomas.', at: 0, len: 8, quote: true },
        { block: 'c', para: '“Halt!”', at: 0, len: 7, quote: true, label: null }
      ],
      all
    )
    expect(run.map((a) => a?.who.id ?? null)).toEqual(['mara', 'tom', null])
  })
})
