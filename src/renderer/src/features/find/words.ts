// Plain words find and replace uses on screen.
import type { StorySceneMatches } from '@shared/contracts/find'

/** "once", "twice", "12 times". */
export const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n.toLocaleString()} times`)

export const BUSY_MESSAGE = 'A draft is being written into this scene. Replace once it’s finished.'
export const BUSY_STORY_MESSAGE = 'A draft is being written into the open scene. Replace once it’s finished.'
export const IN_SUGGESTION_MESSAGE = 'That one is inside the AI’s suggested change. Accept or reject the change first.'

/** "Chapter 2, scene 3". */
export const placeWords = (s: Pick<StorySceneMatches, 'chapterNumber' | 'sceneNumber'>): string =>
  `Chapter ${s.chapterNumber}, scene ${s.sceneNumber}`

/**
 * A scene's own name in the results, or '' when it has none worth showing: untitled (a new scene's title is '' until
 * Adam names it) or still called "Scene 2". Such a scene is named by where it is alone.
 */
export const ownSceneTitle = (title: string): string => (/^(Scene \d+)?$/.test(title.trim()) ? '' : title.trim())
