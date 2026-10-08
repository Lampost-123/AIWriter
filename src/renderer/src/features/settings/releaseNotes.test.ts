import { describe, expect, it } from 'vitest'
import { notesFor } from './releaseNotes'

const RAW = `<!-- version: 1.2.3 -->
What's new in 1.2.3:

- The lamp lights as the setup goes.
- Usage has real charts.
`

describe("About's What's new", () => {
  it('lists the points of the notes for the version running', () => {
    expect(notesFor(RAW, '1.2.3')).toEqual({ version: '1.2.3', points: ['The lamp lights as the setup goes.', 'Usage has real charts.'] })
  })
  it('shows nothing for another version, or notes with no points', () => {
    expect(notesFor(RAW, '1.2.4')).toBeNull()
    expect(notesFor(RAW, null)).toBeNull()
    expect(notesFor('<!-- version: 1.2.3 -->\nNothing listed.', '1.2.3')).toBeNull()
    expect(notesFor('- a point with no version', '1.2.3')).toBeNull()
  })
})
