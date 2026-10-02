import { describe, expect, it } from 'vitest'
import { deletedSummary, type Noun } from './deleteWords'

const scene: Noun = ['scene', 'scenes']
const chapter: Noun = ['chapter', 'chapters']
const character: Noun = ['character', 'characters']

describe('deletedSummary', () => {
  it('counts each kind, in the order first deleted', () => {
    expect(deletedSummary([scene, scene])).toBe('2 scenes deleted.')
    expect(deletedSummary([chapter, scene, scene])).toBe('1 chapter and 2 scenes deleted.')
    expect(deletedSummary([scene, chapter, scene, character])).toBe('2 scenes, 1 chapter and 1 character deleted.')
  })

  it('reads sensibly for one thing too', () => {
    expect(deletedSummary([scene])).toBe('1 scene deleted.')
  })
})
