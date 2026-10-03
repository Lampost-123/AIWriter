// Telling a model's refusal from prose: a reply that declines to write rather than writing. Used by drafting
// (ai/errors.ts, the refusal note at strong content levels) and by the polish pass in the window, so it is
// shared. Pure, so it is unit-tested.

import { countWords } from './defaults'

/** How a refusal opens: an apology, "I can't", "I won't", "As an AI". */
const OPENING =
  /^(?:I['’]?m sorry|I am sorry|sorry,? but\b|I apologi[sz]e|(?:my )?apologies\b|unfortunately,? I\b|I can(?:['’]?t|not)\b|I(?:['’]m| am) (?:not able|unable|not comfortable)\b|I (?:won['’]?t|will not)\b|I (?:must|have to|need to|will have to|['’]ll have to) (?:decline|refuse)\b|As an AI\b)/i

/** What makes it addressed to the person asking rather than a line of the story: the writing, the request, the rules. */
const ADDRESSED =
  /\b(?:content|request|requests|scene|story|passage|guidelines?|polic(?:y|ies)|explicit|graphic|sexual|as an ai|language model|assistant|assist|comply|fulfil+|fulfill?ing|generate|depict|depicting)\b|\b(?:write|help with|assist with) (?:that|this|it)\s*[.!]?\s*$/im

/**
 * A reply that is plainly the model declining rather than writing: short, opening like a refusal (never with
 * a quotation mark: that is dialogue), and talking about the writing or the request. "I can't go back there."
 * and "Sorry I'm late, he said." are prose; "I'm sorry, but I can't write that scene." is a refusal.
 */
export function looksLikeRefusalReply(text: string): boolean {
  const t = text.trim().replace(/^[*_\s]+/, '')
  if (!t || countWords(t) > 80) return false
  if (/^["“”‘'«]/.test(t)) return false
  return OPENING.test(t) && ADDRESSED.test(t)
}
