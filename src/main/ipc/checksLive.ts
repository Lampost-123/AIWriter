// Milestone 5, Live checks part: the words the live checks need and the flags Adam ignored. Groundwork stubs.
import type { Handlers } from './index'

export const liveHandlers: Handlers<'getCheckWords' | 'listLiveIgnores' | 'ignoreLive' | 'unignoreLive'> = {
  getCheckWords: () => ({ names: [], avoid: [] }),
  listLiveIgnores: () => [],
  ignoreLive: () => undefined,
  unignoreLive: () => undefined
}
