// How a scene is named in Find in the whole story's results. Invented titles only.
import { describe, expect, it } from 'vitest'
import { ownSceneTitle, placeWords } from './words'

describe('a scene in the results', () => {
  it('is named by where it is when untitled or still called "Scene 2", and by its own title otherwise', () => {
    expect(ownSceneTitle('')).toBe('')
    expect(ownSceneTitle('   ')).toBe('')
    expect(ownSceneTitle('Scene 2')).toBe('')
    expect(ownSceneTitle('  The weir ')).toBe('The weir')
    expect(ownSceneTitle('Scene 2 at the weir')).toBe('Scene 2 at the weir')
    expect(placeWords({ chapterNumber: 3, sceneNumber: 2 })).toBe('Chapter 3, scene 2')
  })
})
