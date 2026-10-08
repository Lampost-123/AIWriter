// Ways into the builder (the World room's New entry menu and empty slots, the story home's cast, the palette).
import type { BuilderKind } from '@shared/contracts/builder'
import { useApp } from '@/lib/store'

/** Opens the builder for a new entry of this kind: at its first step, or at Quick start (a few notes in, a whole profile out). */
export function openBuilder(kind: BuilderKind, mode: 'guided' | 'quick' = 'guided'): void {
  useApp.getState().navigate({ kind: 'builder', entryKind: kind, entryId: null, start: { mode } })
}

/** What each builder is called where it is offered. */
export const BUILD_WORDS: Record<BuilderKind, string> = {
  character: 'Build a character with AI',
  place: 'Build a place with AI',
  group: 'Build a group with AI',
  item: 'Build an item with AI'
}
