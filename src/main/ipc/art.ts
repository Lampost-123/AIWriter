// The desk's drawing and cover choices (UI overhaul, D5.4): the handlers for src/shared/contracts/art.ts.
import type { Handlers } from './index'
import type { ArtApi } from '@shared/contracts/art'
import * as world from '../world'
import { readArtChoices, setEntryMotif, setStoryCover } from '../db/art'

export const artHandlers: Handlers<keyof ArtApi> = {
  getArtChoices: () => readArtChoices(world.db()),
  setEntryMotif: (entryId, motif) => setEntryMotif(world.db(), entryId, motif),
  setStoryCover: (storyId, cover) => setStoryCover(world.db(), storyId, cover)
}
