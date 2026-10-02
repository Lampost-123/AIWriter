// Milestone 4: the handlers for src/shared/contracts/history.ts (the History part owns both files).
// The work is done in src/main/history/*; this file connects it to the open world and the window.
import type { Handlers } from './index'
import type { HistoryApi } from '@shared/contracts/history'
import { currentHistory } from '../history'
import type { WorldHistory } from '../history/worldHistory'
import { sceneRestored } from '../keeper'
import { aiChangeComing } from '../readAloud'
import { UserError } from '../util'

/** The open world's history. Throws a plain-words error if no world is open. */
function history(): WorldHistory {
  const h = currentHistory()
  if (!h) throw new UserError('No world is open. Pick or create a world first.')
  return h
}

export const historyHandlers: Handlers<keyof HistoryApi> = {
  // A snapshot never holds an AI change up: with no world (or no history.db) nothing is kept.
  takeSnapshot: (input) => {
    // AI-written text is about to go in: reading aloud marks what it adds once it has (never holds this up).
    if (input?.kind === 'ai') aiChangeComing(input.sceneId, input.doc)
    return currentHistory()?.take(input) ?? null
  },
  listSnapshots: (sceneId, options) => history().listSnapshots(sceneId, options),
  getSnapshot: (id) => history().getSnapshot(id),
  // The memory keeper reads a restored version straight away (docs/ARCHITECTURE.md: it runs "after a scene version is restored").
  restored: (sceneId) => sceneRestored(sceneId),

  listDrafts: (sceneId, options) => history().listDrafts(sceneId, options),
  newDraft: (page) => history().newDraft(page),
  undoNewDraft: (input) => history().undoNewDraft(input),
  switchDraft: (page, draftId) => history().switchDraft(page, draftId),
  setCurrentDraft: (sceneId, draftId) => history().setCurrentDraft(sceneId, draftId),
  renameDraft: (draftId, name) => history().renameDraft(draftId, name),
  deleteDraft: (draftId) => history().deleteDraft(draftId),
  restoreDraft: (draftId) => history().restoreDraft(draftId)
}
