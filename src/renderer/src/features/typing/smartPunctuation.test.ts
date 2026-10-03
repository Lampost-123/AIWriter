import { describe, expect, it } from 'vitest'
import { curlyQuote, ELLIPSIS, EM_DASH, EN_DASH, smartChange } from './smartPunctuation'

/** Types `keys` one at a time into a paragraph, applying each swap as the page would. */
function typed(keys: string, start = ''): string {
  let text = start
  for (const ch of keys) {
    text += ch
    const c = smartChange(text)
    if (c) text = text.slice(0, text.length - c.remove) + c.insert
  }
  return text
}

describe('smart punctuation', () => {
  it('curls double quotes, opening or closing by what comes before', () => {
    expect(typed('"Wait," she said. "The boat."')).toBe('“Wait,” she said. “The boat.”')
    expect(typed('("Never")')).toBe('(“Never”)')
    expect(typed('He was 6" taller')).toBe('He was 6” taller')
  })

  it('curls single quotes, with apostrophes inside and at the end of words', () => {
    expect(typed("'Don't,' said Ilsa.")).toBe('‘Don’t,’ said Ilsa.')
    expect(typed("the dogs' bowls")).toBe('the dogs’ bowls')
    expect(typed("\"She said 'no'.\"")).toBe('“She said ‘no’.”')
  })

  it('knows an apostrophe for left-out digits and letters', () => {
    expect(typed("back in the '90s")).toBe('back in the ’90s')
    expect(typed("tell 'em now")).toBe('tell ’em now')
    expect(typed("'tis late")).toBe('’tis late')
    expect(typed("rock 'n' roll")).toBe('rock ’n’ roll')
    // A capital after the quote is the start of quoted words (a name), not a left-out word.
    expect(typed("'Em, come here'")).toBe('‘Em, come here’')
  })

  it('after a dash, closes words broken off and opens new ones', () => {
    expect(typed('"I was going to--"')).toBe(`“I was going to${EM_DASH}”`)
    expect(typed('He turned--"Who is it?"')).toBe(`He turned${EM_DASH}“Who is it?”`)
    expect(typed("'I don't--'")).toBe(`‘I don’t${EM_DASH}’`)
    expect(curlyQuote('He paused—', "'")).toBe('‘')
  })

  it('makes dashes and ellipses', () => {
    expect(typed('one--two')).toBe(`one${EM_DASH}two`)
    expect(typed('north - south')).toBe(`north ${EN_DASH} south`)
    expect(typed('And then...')).toBe(`And then${ELLIPSIS}`)
    // A hyphen in a word, or at the start of a line, stays.
    expect(typed('well-known')).toBe('well-known')
    expect(typed('- a list')).toBe('- a list')
  })

  it('leaves alone what was put back as typed', () => {
    // Ctrl+Z put "--" back; another hyphen makes "---" (a scene break at the start of a paragraph), not "-—".
    expect(smartChange('---')).toBeNull()
    expect(smartChange('wait....')).toBeNull()
    expect(smartChange('')).toBeNull()
    expect(smartChange('plain words')).toBeNull()
  })

  it('says exactly what to swap at the end', () => {
    expect(smartChange('"')).toEqual({ remove: 1, insert: '“' })
    expect(smartChange('a--')).toEqual({ remove: 2, insert: EM_DASH })
    expect(smartChange('a - ')).toEqual({ remove: 2, insert: `${EN_DASH} ` })
    expect(smartChange('so...')).toEqual({ remove: 3, insert: ELLIPSIS })
    expect(smartChange('the ‘9')).toEqual({ remove: 2, insert: '’9' })
  })
})
