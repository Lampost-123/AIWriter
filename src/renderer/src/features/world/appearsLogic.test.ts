import { describe, expect, it } from 'vitest'
import { howText, ownTitle, showMoreText } from './appearsLogic'

describe('"Appears in"', () => {
  it('says how the entry is in each scene', () => {
    expect(howText(['pov', 'present', 'named'], true, 'character')).toBe('Point of view · In the scene')
    expect(howText(['named'], false, 'character')).toBe('Named')
    expect(howText(['location', 'changes'], false, 'place')).toBe('Where it’s set · Changed here')
    expect(howText(['changes'], false, 'character')).toBe('Changes here')
  })

  it('lists a busy entry’s scenes a page at a time', () => {
    expect(showMoreText(50, 400)).toBe('Show 50 more')
    expect(showMoreText(50, 62)).toBe('Show the last 12')
    expect(showMoreText(50, 51)).toBe('Show the last one')
  })

  it('shows a scene’s own title, not the one every new scene gets', () => {
    expect(ownTitle('Scene 12')).toBe('')
    expect(ownTitle(' The ferry ')).toBe('The ferry')
  })
})
