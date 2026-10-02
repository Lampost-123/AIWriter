// Milestone 3: the handlers for src/shared/contracts/stories.ts (one part owns both files).
import type { Handlers } from './index'
import type { StoriesApi } from '@shared/contracts/stories'

export const storiesHandlers: Handlers<keyof StoriesApi> = {}
