import { describe, expect, it } from 'vitest'
import { boardLayout } from './boardLayout'
import { placeOf, shortName, stringLine, stringTags, TAG_LIFT } from './stringNotes'

// The sample world's board: the sealed letter opens in Ch 1, Sc 2 and is resolved in Ch 2, Sc 1; midwinter opens there
// and is still open.
const columns = [
  { id: 'c1', sceneIds: ['s1', 's2'] },
  { id: 'c2', sceneIds: ['s3', 's4'] }
]
const layout = boardLayout(columns, [
  { id: 'letter', sceneIds: ['s2', 's3'], paidOffSceneId: 's3', open: false },
  { id: 'midwinter', sceneIds: ['s3'], paidOffSceneId: null, open: true }
])
const [letter, midwinter] = layout.strings

describe('what the strings say', () => {
  it('names where a scene is, by chapter and scene', () => {
    expect(placeOf(layout, 's2')).toBe('Ch 1, Sc 2')
    expect(placeOf(layout, 's3')).toBe('Ch 2, Sc 1')
    expect(placeOf(layout, 'elsewhere')).toBeNull()
  })

  it('says where a string opens and where it is resolved, or that it is still open', () => {
    expect(stringLine(layout, letter, 'What is in the sealed letter?', 's3', false)).toBe(
      'What is in the sealed letter? · opened in Ch 1, Sc 2 · resolved in Ch 2, Sc 1'
    )
    expect(stringLine(layout, midwinter, 'Will the light go dark at midwinter?', null, true)).toBe(
      'Will the light go dark at midwinter? · opened in Ch 2, Sc 1 · still open'
    )
  })

  it('shortens a long name for its tag', () => {
    expect(shortName('What is in the sealed letter?')).toBe('What is in the sealed letter')
    expect(shortName('A very long question about the lighthouse and the harbour board?', 20)).toBe('A very long questio…')
  })

  it('puts each name tag above the pin where its string starts, and the end tags by the knot and the arrow', () => {
    const tags = stringTags(layout)
    const opens = tags.filter((t) => t.kind === 'opens')
    expect(opens.map((t) => t.id)).toEqual(['letter', 'midwinter'])
    const p2 = layout.pins.get('s2')!
    expect(opens[0]).toMatchObject({ side: 'right', x: p2.x + 12, y: p2.y - TAG_LIFT })
    // Midwinter starts where the letter is resolved: its name takes the right of that pin, "resolved here" the left.
    const p3 = layout.pins.get('s3')!
    expect(opens[1]).toMatchObject({ side: 'right', x: p3.x + 12 })
    expect(tags.find((t) => t.kind === 'resolved')).toMatchObject({ id: 'letter', side: 'left', x: p3.x - 12 })
    // Still open: its tag by the arrow, in the next chapter's column.
    const open = tags.find((t) => t.kind === 'open')!
    expect(open.id).toBe('midwinter')
    expect(open.x).toBeGreaterThan(layout.next.x)
  })
})
