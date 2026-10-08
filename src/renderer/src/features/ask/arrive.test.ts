import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { fadeText } from './arrive'

/** The words of what fadeText gave, with the arriving stretches in [brackets]. */
function shown(node: ReactNode): string {
  const parts = Array.isArray(node) ? node : [node]
  return parts
    .map((p) => (typeof p === 'string' ? p : isValidElement<{ children: string }>(p) ? `[${p.props.children}]` : ''))
    .join('')
}

describe('an answer’s words arriving', () => {
  it('wraps only the stretches still arriving, wherever they fall in a run of words', () => {
    expect(fadeText('The tide came in.', 0, [])).toBe('The tide came in.')
    expect(shown(fadeText('The tide came in.', 0, [{ from: 9, to: 17, at: 0 }]))).toBe('The tide [came in.]')
    // A run that starts later in the answer: the stretch is counted from the answer's start.
    expect(shown(fadeText('came in.', 9, [{ from: 9, to: 13, at: 0 }]))).toBe('[came] in.')
    // Two stretches, one partly before the run.
    expect(shown(fadeText('in the dark', 20, [{ from: 18, to: 22, at: 0 }, { from: 27, to: 31, at: 0 }]))).toBe('[in] the [dark]')
    // A stretch elsewhere in the answer leaves the run as it is.
    expect(shown(fadeText('Wren', 40, [{ from: 0, to: 10, at: 0 }]))).toBe('Wren')
  })
})
