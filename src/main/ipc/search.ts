// Milestone 3: the handlers for src/shared/contracts/search.ts (one part owns both files). The index
// itself is src/main/search/index.ts; it belongs to the open world's database, so opening another
// world (or restoring a backup) starts a fresh one.
import type { Handlers } from './index'
import type { SearchApi } from '@shared/contracts/search'
import * as world from '../world'
import { searchIndex } from '../search'

export const searchHandlers: Handlers<keyof SearchApi> = {
  search: (query, options) => searchIndex(world.db()).search(query, options ?? {}),
  searchPlaces: (places) => searchIndex(world.db()).places(places),
  prepareSearch: () => {
    const ix = searchIndex(world.db())
    if (!ix.fresh) ix.refresh()
  }
}
