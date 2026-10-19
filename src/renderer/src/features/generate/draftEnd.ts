// What the message at the end of a Generate draft offers (draftRun.ts). Pure, so it is unit-tested.

/** A button on the message: the draft options, Settings › Models, Continue from here, or What the AI saw. */
export type DraftEndAction = 'options' | 'settings' | 'continue' | 'record'

/**
 * The buttons on the message a draft that went wrong or stopped short ends with, the main one first. The button goes
 * where the message says the fix is: the draft options (a length the model can't manage) or Settings (key, credit,
 * model). Otherwise, a draft that stopped short with its words in the page on screen (cut off at the reply limit, or
 * the connection dropped part-way) offers Continue from here, which writes on from the end of the scene, with What
 * the AI saw beside it; anything else, What the AI saw.
 */
export function draftEndActions(o: {
  /** The plain-words problem, when the draft ended with one. */
  error: string | null
  /** The draft ran into the reply limit. */
  cutOff: boolean
  /** Some of the draft's words arrived. */
  wrote: boolean
  /** It ended in the scene on screen (not one Adam had left). */
  here: boolean
}): DraftEndAction[] {
  if (o.error && /\bdraft options\b/.test(o.error)) return ['options']
  if (o.error && /\bSettings\b/.test(o.error)) return ['settings']
  if ((o.error || o.cutOff) && o.wrote && o.here) return ['continue', 'record']
  return ['record']
}
