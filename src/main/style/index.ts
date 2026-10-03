// The style guide's helpers on the open world, both written by the writer model through the shared task runner
// (ai/tasks.ts), each with its own Thinking in Settings › Models:
//   "Write a sample for me" (contracts/style.ts): a short passage that shows the voice the style guide on screen
//   describes. A 'sample' record with no scene. Nothing is saved to the style guide until Adam keeps it.
//   The polish pass (contracts/polish.ts): a revision of a finished Generate draft. A 'polish' record of the
//   scene with `params.polishOf`; the revision waits in the page for Accept or Reject.

import type Database from 'better-sqlite3'
import type { PolishInput } from '@shared/contracts/polish'
import type { StyleSampleInput } from '@shared/contracts/style'
import type { ID, StyleGuide } from '@shared/types'
import { effectiveStyle } from '@shared/style'
import * as world from '../world'
import * as repo from '../db/repo'
import { emit } from '../events'
import { getSettings, getWritingPrefs } from '../settings'
import * as providers from '../ai/providers'
import { writerModelFor } from '../ai/jobModel'
import { providerNotes } from '../ai/draftFlow'
import { startTask } from '../ai/tasks'
import { UserError } from '../util'
import { POLISH_SAMPLING, polishMessages, polishReplyTokens, SAMPLE_REPLY_TOKENS, SAMPLE_SAMPLING, sampleMessages } from './prompts'

type DB = Database.Database

const sources = (): Parameters<typeof writerModelFor>[1] => ({
  settings: getSettings(),
  getProvider: providers.getProvider,
  providerTarget: providers.providerTarget
})

/** The tone in effect for a story (its own, else its series', else the world's), or the world's for none. */
function toneFor(db: DB, storyId: ID | null): string {
  const worldTone = repo.getMeta(db, 'tone') ?? ''
  if (!storyId) return worldTone
  try {
    const story = repo.getStory(db, storyId)
    const series = story.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
    return [story.tone, series?.tone, worldTone].map((t) => (t ?? '').trim()).find(Boolean) ?? ''
  } catch {
    // The story has gone: the world's tone still applies.
    return worldTone
  }
}

/** Starts a sample passage for the style guide on screen. Throws (plain words) when there's no writer model. */
export function writeStyleSample(input: StyleSampleInput): { generationId: ID } {
  const model = writerModelFor('sample', sources())
  const db = world.db()
  // The guide as the screen shows it, cleaned (the levels underneath are merged in already), with Adam's
  // preference about common AI phrases.
  const style = effectiveStyle(getWritingPrefs(), input.style ?? ({} as StyleGuide), {})
  return startTask({
    db,
    taskId: input.taskId,
    job: 'sample',
    sceneId: '',
    model,
    messages: sampleMessages(style, toneFor(db, input.storyId ?? null)),
    reply: SAMPLE_REPLY_TOKENS,
    temperature: SAMPLE_SAMPLING.temperature,
    topP: SAMPLE_SAMPLING.topP,
    minP: SAMPLE_SAMPLING.minP,
    emit,
    onKeyRejected: providerNotes(model.target.id).onKeyRejected
  })
}

/** Starts the polish pass on a finished draft. Throws (plain words) when there's no writer model or no draft. */
export function startPolish(input: PolishInput): { generationId: ID } {
  const draft = (input.text ?? '').trim()
  if (!draft) throw new UserError('There is no draft to polish.')
  const model = writerModelFor('polish', sources())
  const db = world.db()
  const { story } = repo.sceneLocation(db, input.sceneId)
  const style = effectiveStyle(getWritingPrefs(), repo.getWorldStyle(db), story.style)
  return startTask({
    db,
    taskId: input.taskId,
    job: 'polish',
    sceneId: input.sceneId,
    model,
    messages: polishMessages(style, toneFor(db, story.id), draft),
    reply: polishReplyTokens(draft),
    temperature: POLISH_SAMPLING.temperature,
    topP: POLISH_SAMPLING.topP,
    extra: { polishOf: input.draftId },
    emit,
    onKeyRejected: providerNotes(model.target.id).onKeyRejected
  })
}
