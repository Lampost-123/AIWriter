import { describe, expect, it } from 'vitest'
import { asSpoken, speechSpans } from './italicSpeech'

/** The italic stretches of `text`, written with asterisks: its plain text, and where the italics are. */
function page(marked: string): { text: string; italics: [number, number][] } {
  let text = ''
  const italics: [number, number][] = []
  let open = -1
  for (const ch of marked) {
    if (ch === '*') {
      if (open < 0) open = text.length
      else {
        italics.push([open, text.length])
        open = -1
      }
    } else text += ch
  }
  return { text, italics }
}

const spoken = (marked: string): string => {
  const p = page(marked)
  return asSpoken({ pid: 'p', ...p }).para.text
}

describe('speech in italics', () => {
  it('is speech beside a dialogue tag, and so is what the same speaker carries on with', () => {
    expect(spoken('*Go on,* said the ring. *Take the floor, boy. You won’t get a better view.*')).toBe(
      '“Go on,” said the ring. “Take the floor, boy. You won’t get a better view.”'
    )
    expect(spoken('The ring said, *Take the floor.*')).toBe('The ring said, “Take the floor.”')
    expect(spoken('*Run,* she whispered.')).toBe('“Run,” she whispered.')
    // The comma just after the italics, and a tag that goes on to say how.
    expect(spoken('*She can feel it*, the ring said, low and soft, like a voice in the dark.')).toBe(
      '“She can feel it”, the ring said, low and soft, like a voice in the dark.'
    )
  })

  it('leaves a stressed word, a thought, a title and italics inside quotes as they are', () => {
    expect(spoken('She had *never* said that.')).toBe('She had never said that.')
    expect(spoken('She had *never*, she said, been there.')).toBe('She had never, she said, been there.')
    expect(spoken('*Never,* she thought.')).toBe('Never, she thought.')
    expect(spoken('He read *The Long Road* twice.')).toBe('He read The Long Road twice.')
    expect(spoken('“I *told* you,” said Mara.')).toBe('“I told you,” said Mara.')
    expect(speechSpans('No italics here.', undefined)).toEqual([])
  })

  it('keeps every place on the page where it was', () => {
    const p = page('*Go on,* said the ring. *Take the floor.* He did.')
    const s = asSpoken({ pid: 'p', ...p })
    for (let i = 0; i <= p.text.length; i++) expect(s.back(s.forward(i))).toBe(i)
    // The quote as read, back on the page: the italic words.
    const at = s.para.text.indexOf('“Take')
    const end = s.para.text.indexOf('”', at) + 1
    expect(p.text.slice(s.back(at), s.back(end))).toBe('Take the floor.')
    // The speech is no longer italics (so it isn't stressed), and other italics stay.
    expect(s.para.italics).toBeUndefined()
  })
})
