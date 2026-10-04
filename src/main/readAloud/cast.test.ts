import { describe, expect, it } from 'vitest'
import { attributeRun, castOf, everyone, memberNamed, namesFor, speakerOf, strangerTag, type SceneCast } from './cast'
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

  it('finds names in any alphabet, and a capitalised name only as it is written', () => {
    const cast = everyone(
      castOf([
        { id: 'zoe', name: 'Zoë', aliases: [], about: '' },
        { id: 'elodie', name: 'Élodie Marchand', aliases: [], about: '' },
        { id: 'will', name: 'Will', aliases: [], about: '' }
      ])
    )
    expect(speakers(['“Wait,” said Zoë.'], cast)).toEqual(['zoe'])
    expect(speakers(['“Wait,” Élodie whispered.'], cast)).toEqual(['elodie'])
    expect(speakers(['Zoë leaned on the rail. “Rain again.”'], cast)).toEqual(['zoe'])
    // "will" is not Will.
    expect(speakers(['They will go at dawn. “Ready?”'], cast)).toEqual([null])
    expect(speakers(['Will leaned in. “Ready?”'], cast)).toEqual(['will'])
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
    // Tomas isn't in this scene: naming him in the narration doesn't make the line his; Mara is alone, so it's hers...
    expect(speakers(['Tomas was gone. “Hello?”'], scene)).toEqual(['mara'])
    // ...but a tag naming him does.
    expect(speakers(['“Hello?” Tomas called.'], scene)).toEqual(['tom'])
  })

  it('leaves a line whose tag names someone outside the cast to the AI, and the exchange keeps its turns around it', () => {
    const exchange = ['“Where were you?” said Mara.', '“Out,” Tomas said.']
    expect(speakers([...exchange, '“Fine,” someone muttered.', '“Out where?”'])).toEqual(['mara', 'tom', null, 'mara'])
    // The verb first, and the lines after it in the same paragraph.
    expect(speakers([...exchange, '“Tickets,” said the driver. “All of them.”'])).toEqual(['mara', 'tom', null, null])
    // Someone named after a character is not that character.
    expect(speakers([...exchange, '“Not me,” Mara’s brother said.'])).toEqual(['mara', 'tom', null])
    expect(speakers(['“Not me,” said Mara’s brother.'])).toEqual([null])
    // "She said" is someone in the exchange: whose turn it is.
    expect(speakers([...exchange, '“Go,” she said.'])).toEqual(['mara', 'tom', 'mara'])
    expect(strangerTag('“Fine,” someone muttered.', 0, 7, all)).toBe(true)
    expect(strangerTag('The driver said, “Out.”', 17, 6, all)).toBe(true)
    expect(strangerTag('“Fine,” the captain muttered.', 0, 7, all)).toBe(false)
    expect(strangerTag('“Fine.” He turned away.', 0, 7, all)).toBe(false)
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

describe('a name the AI gives back', () => {
  const people = castOf([
    { id: 'a', name: 'Adam', aliases: [], about: '' },
    { id: 'm', name: 'Mara Quill', aliases: [], about: '' },
    { id: 'r', name: 'Ring', aliases: [], about: '' }
  ])
  const who = (w: string): string | null => memberNamed(people, w)?.name ?? null

  it('is the character, however it is written', () => {
    expect(who('Adam')).toBe('Adam')
    expect(who('ADAM.')).toBe('Adam')
    expect(who('Adam (whispering)')).toBe('Adam')
    expect(who('Adam Reyes')).toBe('Adam')
    expect(who('“Mara”')).toBe('Mara Quill')
    expect(who('the Ring')).toBe('Ring')
  })

  it('is nobody in the cast when it only mentions them, or names two', () => {
    expect(who('Adam’s brother')).toBeNull()
    expect(who("Adam's brother")).toBeNull()
    expect(who('Adam and Mara')).toBeNull()
    expect(who('the guard')).toBeNull()
    expect(who('narrator')).toBeNull()
  })
})

describe('someone who isn’t in the scene', () => {
  const jane = castOf([
    { id: 'jane', name: 'Jane', aliases: [], about: '' },
    { id: 'laura', name: 'Laura', aliases: [], about: '' }
  ])
  const [j, l] = jane
  it('isn’t given a line because the narration thinks of them', () => {
    const anyone = everyone(jane)
    expect(speakers(['She thought of Laura. “Where are you?”'], anyone)).toEqual([null])
    expect(speakers(['Laura had always laughed at that. “Not funny now.”'], anyone)).toEqual(['laura'])
    // A sentence that opens with the speaker's name still gives them the line.
    expect(speakers(['Jane set the phone down. “Fine.”'], anyone)).toEqual(['jane'])
  })

  it('isn’t given a turn after speaking in a memory, when the card has only Jane', () => {
    const alone: SceneCast = { all: jane, scene: [j], pov: j }
    const lines = ['“Be careful,” Laura said once, years ago.', '“I am careful,” Jane whispered.', 'She waited.', '“Are you there?”']
    expect(speakers(lines, alone)).toEqual(['laura', 'jane', 'jane'])
    expect(l.id).toBe('laura')
  })
})
