// Where the monthly spending limit (milestone 6, Usage and cost) meets the AI calls. Every AI call, whatever
// its job, is recorded as a generation (db/generations.ts insertGeneration) just before it is sent, and its
// record is finished (finishGeneration) when it ends, so those two are the one place no call slips past:
// insertGeneration asks `beforeAiCall`, which refuses in plain words, with the code SPEND_LIMIT, while this
// month's spending has reached the limit and Adam hasn't chosen "Carry on this month"; finishGeneration tells
// `aiCallFinished`, so the spending is added up again. The rules live in usage/index.ts, which sets the hooks;
// this file is pure (no Electron), so the AI code and its tests don't depend on the settings.

import type Database from 'better-sqlite3'
import { SPEND_LIMIT, reachedWords } from '@shared/contracts/usage'
import { UserError } from '../util'

type DB = Database.Database

export interface SpendHooks {
  /** The limit reached and not carried on: the limit (US dollars), else null. */
  held: () => number | null
  /** An AI call's record was finished in `db`. */
  finished: (db: DB) => void
}

let hooks: SpendHooks | null = null

/** Set once by usage/index.ts (null for tests: nothing is held). */
export function setSpendHooks(h: SpendHooks | null): void {
  hooks = h
}

/** The limit while AI calls are held (reached, and Adam hasn't carried on), else null. Never throws. */
export function heldAt(): number | null {
  try {
    return hooks?.held() ?? null
  } catch (e) {
    console.warn('Could not work out the monthly spending', e)
    return null
  }
}

/** Refuses an AI call before anything is sent while the monthly limit holds them. */
export function beforeAiCall(): void {
  const limit = heldAt()
  if (limit != null) throw new UserError(reachedWords(limit), SPEND_LIMIT)
}

/** An AI call's record was finished. Never throws (the call itself is done). */
export function aiCallFinished(db: DB): void {
  try {
    hooks?.finished(db)
  } catch (e) {
    console.warn('Could not add up the spending after an AI call', e)
  }
}

/**
 * Automatic work (the memory keeper, checks after Mark done, the import catch-up) waits while the limit holds
 * AI calls. The words for its quiet note, else null to go ahead. They don't name Settings, so the memory's
 * note offers "Try again" (which asks Adam) rather than a link to Settings › Models.
 */
export function pausedNote(): string | null {
  const limit = heldAt()
  return limit == null
    ? null
    : `${reachedWords(limit)} Memory updates are paused until you choose Carry on this month, raise the limit on the Usage and cost page, or the month turns. Your writing is safe.`
}
