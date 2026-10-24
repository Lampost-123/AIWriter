// Under suggestion (the story map, phase 2): the page's data, tracking on and off, and Adam's own commands and changes.
import type { Handlers } from './index'
import type { CommandsApi } from '@shared/contracts/commands'
import * as world from '../world'
import * as store from '../db/commands'
import { emit } from '../events'
import { UserError } from '../util'
import { addCommand, changeCommand, storyOfStep, underSuggestion, undoStep } from '../commands'
import { readingProgress, readStoryCommands } from '../commands/reader'

const changed = (storyId: string | null): void => {
  if (storyId) emit('commands:changed', { storyId })
}

export const commandsHandlers: Handlers<keyof CommandsApi> = {
  getUnderSuggestion: (storyId, sceneId) => {
    const db = world.db()
    return underSuggestion(db, storyId, sceneId ?? null, readingProgress(db, storyId))
  },
  setCommandTracking: (storyId, on) => {
    const db = world.db()
    store.setTracking(db, storyId, on)
    if (on) readStoryCommands(db, storyId)
    return underSuggestion(db, storyId, null, readingProgress(db, storyId))
  },
  addCommand: (input) => {
    const db = world.db()
    const id = addCommand(db, input)
    changed(input.storyId)
    return id
  },
  changeCommand: (input) => {
    const db = world.db()
    const id = changeCommand(db, input)
    changed(storyOfStep(db, id))
    return id
  },
  undoCommandStep: (stepId) => {
    const db = world.db()
    const step = store.getStep(db, stepId)
    if (step && step.origin !== 'adam') throw new UserError('Only a change you made can be undone here. Say it isn’t right instead.')
    changed(undoStep(db, stepId))
  },
  answerCommandStep: (stepId, answer) => {
    const db = world.db()
    if (!store.getStep(db, stepId)) throw new UserError('That step is gone. Close this and look again.')
    store.setAnswer(db, stepId, answer)
    changed(storyOfStep(db, stepId))
  },
  clearCommandAnswer: (stepId) => {
    const db = world.db()
    store.setAnswer(db, stepId, '')
    changed(storyOfStep(db, stepId))
  }
}
