// A story's book cover, as the desk shows it (UI overhaul, D5.1 and D5.4): its colour (a hue Adam chose, else its
// genre's, else its own) and its drawing (his choice, else the one its title and premise call for).
import { createElement, type ReactNode } from 'react'
import type { Story, World } from '@shared/types'
import { Motif } from '@/components/art/Motif'
import { coverChoice, storyMotif, useArtChoices } from '@/features/world/art/artStore'
import { coverHue } from './homeLogic'

export interface StoryCover {
  hue: number
  motif: string
  art: ReactNode
}

/** The open story's cover. */
export function useStoryCover(story: Story | null, world: World | null): StoryCover {
  const choices = useArtChoices()
  const genres = story?.style?.genres?.length ? story.style.genres : (world?.style?.genres ?? [])
  const chosen = story ? coverChoice(choices, story.id) : {}
  const motif = story ? storyMotif(choices, story) : 'lantern'
  return { hue: story ? coverHue(story.id, genres, chosen.hue) : 30, motif, art: createElement(Motif, { id: motif, size: '100%' }) }
}
