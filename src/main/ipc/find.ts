// Writing by hand: the handlers for src/shared/contracts/find.ts (find and replace across the story). The
// work is done in src/main/find/story.ts; this file connects it to the open world, History, saving (the way
// the editor's saves go, so the memory keeper and search see the new text) and Adam's own entry edits.
import type { Handlers } from './index'
import type { FindApi } from '@shared/contracts/find'
import * as world from '../world'
import { currentHistory } from '../history'
import { isDrafting } from '../ai/drafts'
import { findInStory, forgetWorld, replaceInStory, undoReplaceInStory, type StoryFindDeps } from '../find/story'
import { coreHandlers } from './core'

let watching = false

function deps(): StoryFindDeps {
  if (!watching) {
    watching = true
    // An Undo is only for the world it was made in.
    world.onWorldClosing((w) => forgetWorld(w.db))
  }
  return {
    snapshot: (sceneId, doc, text) => {
      currentHistory()?.take({ sceneId, kind: 'restore', label: 'Before find and replace', doc, text })
    },
    save: (sceneId, doc, text) => {
      coreHandlers.saveSceneText(sceneId, doc, text)
    },
    updateEntry: (entryId, patch) => {
      coreHandlers.updateEntry(entryId, patch)
    },
    drafting: isDrafting
  }
}

export const findHandlers: Handlers<keyof FindApi> = {
  findInStory: (input) => findInStory(world.db(), input),
  replaceInStory: (input) => {
    const d = deps()
    const db = world.db()
    return db.transaction(() => replaceInStory(db, input, d))()
  },
  undoReplaceInStory: (token, page) => {
    const d = deps()
    const db = world.db()
    return db.transaction(() => undoReplaceInStory(db, token, page, d))()
  }
}
