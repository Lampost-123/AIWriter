import { describe, expect, it } from 'vitest'
import { castOf, everyone } from './cast'
import { ruleKinds, withRuleKinds, type KindParagraph } from './kinds'
import { NARRATOR } from './speakers'

const cast = castOf([
  { id: 'mara', name: 'Mara', aliases: [], about: '' },
  { id: 'tom', name: 'Tomas', aliases: [], about: '' }
])
const [mara] = cast

/** A paragraph with its *italics* written in asterisks, as the page would send it (italics as ranges). */
function para(pid: string, written: string, block?: 'quote'): KindParagraph {
  const italics: [number, number][] = []
  let text = ''
  let open = -1
  for (const ch of written) {
    if (ch === '*') {
      if (open < 0) open = text.length
      else {
        italics.push([open, text.length])
        open = -1
      }
    } else text += ch
  }
  return { pid, text, ...(italics.length ? { italics } : {}), ...(block ? { block } : {}) }
}

const kinds = (ps: KindParagraph[], c = everyone(cast)) => Object.fromEntries(ruleKinds(ps, c))

describe('what a line is, by the rules', () => {
  it('finds a thought in italics with "she thought", and gives it to who the tag or the paragraph names', () => {
    expect(kinds([para('a', '*Not again,* Mara thought.')]).a).toEqual({ kinds: { '~not again mara thought': 'thought' }, voiced: { '~not again mara thought': 'Mara' } })
    // "she thought": the one character the paragraph names.
    const got = kinds([para('a', 'Mara set the cup down. *He knows,* she thought.')]).a
    expect(got?.kinds).toEqual({ '~he knows she thought': 'thought' })
    expect(got?.voiced).toEqual({ '~he knows she thought': 'Mara' })
  })

  it('finds a whole sentence in italics standing alone as a thought; a word in italics for stress is not one', () => {
    const got = kinds([para('a', 'Tomas stared at the door. *Run. Now.*')]).a
    expect(got?.kinds).toEqual({ '~run': 'thought', '~now': 'thought' })
    expect(kinds([para('b', 'Tomas stared at the door. *Get out of here now.*')]).b?.voiced).toEqual({ '~get out of here now': 'Tomas' })
    expect(kinds([para('c', 'She had *never* been this tired.')]).c).toBeUndefined()
  })

  it('finds a quoted thought and a quoted message by the verb beside it', () => {
    const got = kinds([para('a', '“I’m doomed,” Tomas thought. “Running late,” Mara texted.')]).a
    expect(got?.kinds).toEqual({ 'i m doomed': 'thought', 'running late': 'text_message' })
    expect(got?.speakers).toEqual({ 'i m doomed': 'Tomas', 'running late': 'Mara' })
    expect(kinds([para('b', 'Mara typed, “On my way.”')]).b?.kinds).toEqual({ 'on my way': 'text_message' })
    expect(kinds([para('c', '“Where are you?” Tomas messaged.')]).c?.speakers).toEqual({ 'where are you': 'Tomas' })
  })

  it('finds chat lines written as Name: words, in the writer’s voice', () => {
    const got = kinds([para('a', 'Mara: where are you\nTomas: two minutes')]).a
    expect(got?.kinds).toEqual({ '~mara where are you': 'chat', '~tomas two minutes': 'chat' })
    expect(got?.voiced).toEqual({ '~mara where are you': 'Mara', '~tomas two minutes': 'Tomas' })
    // After a phone buzzing, a written-out message.
    expect(kinds([para('x', 'Her phone buzzed.'), para('b', 'Mara: running late')]).b?.kinds).toEqual({ '~mara running late': 'text_message' })
    // "Note: ..." is not a person, and alone it is not a chat.
    expect(kinds([para('c', 'Note: the gate closes at six.')]).c).toBeUndefined()
  })

  it('reads a message shown in italics after the phone buzzes, and gives one to whoever typed it', () => {
    const got = kinds([
      para('a', 'Tomas checked his phone again.'),
      para('b', 'It buzzed in his hand.'),
      para('c', '*sorry. phone died.*'),
      para('d', 'He typed a reply.'),
      para('e', '*Charge it.*')
    ])
    // Came in: a message, from someone the page doesn't name, read by the narrator.
    expect(got.c).toEqual({ kinds: { '~sorry': 'text_message', '~phone died': 'text_message' } })
    // Typed: "he" is the one the narration last named.
    expect(got.e).toEqual({ kinds: { '~charge it': 'text_message' }, voiced: { '~charge it': 'Tomas' } })
    // "A text from Mara": hers. Only checking the phone isn't a message coming in: that is a thought.
    expect(kinds([para('a', 'A text from Mara lit the screen.'), para('b', '*home soon*')]).b?.voiced).toEqual({ '~home soon': 'Mara' })
    expect(kinds([para('a', 'Tomas checked his phone. Nothing.'), para('b', '*She’s fine.*')]).b?.kinds).toEqual({ '~she s fine': 'thought' })
  })

  it('gives a thought in a paragraph that names nobody to the one the narration last named', () => {
    const got = kinds([para('a', 'Mara waited at the gate.'), para('b', 'The bus was late.'), para('c', '*He isn’t coming.*')])
    expect(got.c?.voiced).toEqual({ '~he isn t coming': 'Mara' })
  })

  it('gives a letter or notice read out loud ("he read") to its reader', () => {
    const got = kinds([para('a', 'Tomas found the notice.'), para('b', '“Dear colleague,” he read. “We regret to inform you.”')])
    expect(got.b?.kinds).toEqual({ 'dear colleague': 'speech' })
    expect(got.b?.speakers).toEqual({ 'dear colleague': 'Tomas' })
  })

  it('reads a letter set apart on the page as its signer’s, to the sign-off', () => {
    const got = kinds([
      para('a', 'The envelope was in the box.'),
      para('b', 'Dear Tomas, the river is high this year.', 'quote'),
      para('c', 'I miss the ferry. “Come home,” Father says.', 'quote'),
      para('d', 'Love, Mara', 'quote'),
      para('e', 'He folded it away.')
    ])
    expect(got.b?.voiced).toEqual({ '~dear tomas the river is high this year': 'Mara' })
    expect(got.c?.kinds).toEqual({ '~i miss the ferry': 'letter', 'come home': 'letter', '~father says': 'letter' })
    expect(got.c?.speakers).toEqual({ 'come home': 'Mara' })
    expect(got.d?.voiced).toEqual({ '~love mara': 'Mara' })
    expect(got.e).toBeUndefined()
  })

  it('reads an unsigned letter as the one the narration before it names, and "Dear ...," without a sign-off only to its first paragraph', () => {
    const set = kinds([para('a', 'A letter from Mara lay on the mat.'), para('b', 'The roof leaks again.', 'quote')])
    expect(set.b?.voiced).toEqual({ '~the roof leaks again': 'Mara' })
    const loose = kinds([para('a', 'Mara had written to him.'), para('b', 'Dear Tomas, the roof leaks.'), para('c', 'He laughed.')])
    expect(loose.b?.kinds).toEqual({ '~dear tomas the roof leaks': 'letter' })
    expect(loose.c).toBeUndefined()
  })

  it('reads signs and words in capitals as nobody’s', () => {
    const got = kinds([para('a', '“NO ENTRY,” the sign read. “Keep out,” said the notice on the gate.')]).a
    expect(got?.kinds).toEqual({ 'no entry': 'sign', 'keep out': 'sign' })
    expect(got?.speakers).toEqual({ 'no entry': NARRATOR, 'keep out': NARRATOR })
  })

  it('gives "I thought" to the one telling the story in the first person', () => {
    const pov = { all: cast, scene: cast, pov: mara! }
    const got = kinds([para('a', '*This is a trap,* I thought.')], pov).a
    expect(got?.voiced).toEqual({ '~this is a trap i thought': 'Mara' })
    expect(kinds([para('b', 'I stopped at the gate. *Too quiet.*')], pov).b?.voiced).toEqual({ '~too quiet': 'Mara' })
  })
})

describe('the rules beside what is kept', () => {
  it('fill only what the writer’s tags and the AI’s marks left empty', () => {
    const kept = new Map([['a', { speakers: { 'running late': 'Tomas' }, kinds: { '~x': 'speech' as const } }]])
    const rules = new Map([['a', { speakers: { 'running late': 'Mara' }, kinds: { 'running late': 'text_message' as const, '~x': 'thought' as const }, voiced: { '~x': 'Mara' } }]])
    const out = withRuleKinds(kept, rules).get('a')
    expect(out?.speakers).toEqual({ 'running late': 'Tomas' })
    expect(out?.kinds).toEqual({ 'running late': 'text_message', '~x': 'speech' })
    // The AI said "~x" is speech, so the rules' owner for it is not used.
    expect(out?.voiced).toBeUndefined()
  })
})
