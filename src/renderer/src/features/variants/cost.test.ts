import { describe, expect, it } from 'vitest'
import { costLabel, costWords } from './cost'

describe('what variants cost, in words', () => {
  it('says a free model is free, with no "about" in front', () => {
    expect(costWords(0)).toBe('Free')
    expect(costWords(0, true)).toBe('Free')
    expect(costLabel(0, true)).toBe('Free')
  })

  it('says a tiny amount in words rather than a symbol, estimated or not', () => {
    expect(costWords(0.0004)).toBe('under $0.001')
    expect(costWords(0.0004, true)).toBe('under $0.001')
    expect(costLabel(0.0004, true)).toBe('Under $0.001')
  })

  it("puts 'about' in front of AI Write's own estimates only", () => {
    expect(costWords(0.0042)).toBe('$0.004')
    expect(costWords(0.0042, true)).toBe('about $0.004')
    expect(costLabel(0.0042, true)).toBe('About $0.004')
    expect(costLabel(0.36)).toBe('$0.36')
  })
})
