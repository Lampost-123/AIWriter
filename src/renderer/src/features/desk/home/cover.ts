// A story's book cover, as the desk shows it: its colour (a hue Adam chose, else its genre's, else its own) and, from
// D5.4, the drawing on it.
import type { ReactNode } from 'react'
import type { Story, World } from '@shared/types'
import { coverHue } from './homeLogic'

export interface StoryCover {
  hue: number
  art?: ReactNode
}

/** The open story's cover. */
export function useStoryCover(story: Story | null, world: World | null): StoryCover {
  const genres = story?.style?.genres?.length ? story.style.genres : (world?.style?.genres ?? [])
  return { hue: story ? coverHue(story.id, genres) : 30 }
}
