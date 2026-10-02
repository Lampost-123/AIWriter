// Milestone 4: the handlers for src/shared/contracts/history.ts (the History part owns both files).
// The work is done in src/main/history/*; this file connects it to the open world and the window.
import type { Handlers } from './index'
import type { HistoryApi } from '@shared/contracts/history'
import { currentHistory } from '../history'
import type { WorldHistory } from '../history/worldHistory'
import { UserError } from '../util'

/** The open world's history. Throws a plain-words error if no world is open. */
function history(): WorldHistory {
  const h = currentHistory()
  if (!h) throw new UserError('No world is open. Pick or create a world first.')
  return h
}

export const historyHandlers: Handlers<keyof HistoryApi> = {
  // A snapshot never holds an AI change up: with no world (or no history.db) nothing is kept.
  takeSnapshot: (input) => currentHistory()?.take(input) ?? null,
  listSnapshots: (sceneId) => history().listSnapshots(sceneId),
  getSnapshot: (id) => history().getSnapshot(id),

  listDrafts: (sceneId) => history().listDrafts(sceneId),
  newDraft: (page) => history().newDraft(page),
  undoNewDraft: (sceneId, draftId, keptId) => history().undoNewDraft(sceneId, draftId, keptId),
  switchDraft: (page, draftId) => history().switchDraft(page, draftId),
  setCurrentDraft: (sceneId, draftId) => history().setCurrentDraft(sceneId, draftId),
  renameDraft: (draftId, name) => history().renameDraft(draftId, name),
  deleteDraft: (draftId) => history().deleteDraft(draftId),
  restoreDraft: (draftId) => history().restoreDraft(draftId)
}
