import { describe, expect, it } from 'vitest'
import { oneLine } from './text'

describe('oneLine', () => {
  it('runs spaces and line breaks together, and cuts to size without a trailing space', () => {
    expect(oneLine('  The \n long\t night ')).toBe('The long night')
    expect(oneLine(null)).toBe('')
    expect(oneLine(42)).toBe('42')
    expect(oneLine('Rain on the Narrows', 8)).toBe('Rain on')
  })
})
