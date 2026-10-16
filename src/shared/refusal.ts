// Telling a model's refusal from prose: a reply that declines to write rather than writing. Used by drafting
// (ai/errors.ts, the refusal note at strong content levels), by the memory model's calls (keeper/model.ts, so a
// refusal is never kept as a summary or a plan) and by the polish pass in the window, so it is shared. Pure, so it is
// unit-tested.

import { countWords } from './defaults'

/** How a refusal opens: an apology, "I can't", "I won't", "As an AI". */
const OPENING =
  /^(?:I['’]?m sorry|I am sorry|sorry,? but\b|I apologi[sz]e|(?:my )?apologies\b|unfortunately,? I\b|I can(?:['’]?t|not)\b|I(?:['’]m| am) (?:not able|unable|not comfortable)\b|I (?:won['’]?t|will not)\b|I (?:must|have to|need to|will have to|['’]ll have to) (?:decline|refuse)\b|As an AI\b)/i

/** What makes it addressed to the person asking rather than a line of the story: the writing, the request, the rules. */
const ADDRESSED =
  /\b(?:content|request|requests|scene|story|passage|guidelines?|polic(?:y|ies)|explicit|graphic|sexual|as an ai|language model|assistant|assist|comply|fulfil+|fulfill?ing|generate|depict|depicting)\b|\b(?:write|help with|assist with) (?:that|this|it)\s*[.!]?\s*$/im

/** A model's own rules or the kind of content: words a narrator doesn't use of the story they are in. */
const RULES =
  /\b(?:as an ai|ai (?:language )?model|language model|(?:content|usage|safety) polic(?:y|ies)|(?:my|these|the|our) (?:content |safety )?guidelines|(?:explicit|sexual|graphic|adult|nsfw|pornographic|erotic) (?:content|material|scenes?|descriptions?|details?|writing|nature|acts?))\b/i
/** Declining "this scene" or "that request" ... */
const THIS_WRITING =
  /\b(?:write|writing|continue|continuing|generate|generating|produce|producing|create|creating|depict|depicting|describe|describing|provide|providing)(?: with)? (?:this|that|such|any|more) (?:kind of |type of )?(?:explicit |sexual |graphic )?(?:content|scene|material|request|passage)\b/i
/** ... and offering something else, as a model does when it turns a request down. */
const OFFER =
  /\b(?:I(?:['’]d| would) be happy|I can (?:help|offer|write|try|provide)|if you(?:['’]d| would) like|would you like|something else|instead|let me know)\b/i

/**
 * For a refusal at the start or end of a long reply, where a narrator's "I can't do this, not this request" must
 * still read as prose: it talks about a model's rules or the kind of content, or declines "this scene" and offers
 * something else.
 */
const aboutTheWriting = (t: string): boolean => RULES.test(t) || (THIS_WRITING.test(t) && OFFER.test(t))

/** True when one paragraph (or a short reply) reads as a model declining, by `about` (what it must talk about). */
function declines(text: string, about: (t: string) => boolean): boolean {
  const t = text.trim().replace(/^[*_\s]+/, '')
  if (!t || countWords(t) > 80) return false
  if (/^["“”‘'«]/.test(t)) return false
  return OPENING.test(t) && about(t)
}

/** A reply's paragraphs, in order, without empty ones. */
const paragraphs = (text: string): string[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

/**
 * Where a reply declines to write, if it does: 'whole' when the reply is a refusal and nothing else; 'start' when a
 * longer reply opens with one (often a toned-down version follows); 'end' when it writes some way and then stops with
 * one ("I'm sorry, but I can't continue with this explicit scene."). Null when it reads as prose.
 */
export function refusalIn(text: string): 'whole' | 'start' | 'end' | null {
  if (declines(text, (t) => ADDRESSED.test(t))) return 'whole'
  const paras = paragraphs(text)
  if (paras.length < 2) return null
  if (declines(paras[0], aboutTheWriting)) return 'start'
  if (declines(paras[paras.length - 1], aboutTheWriting)) return 'end'
  return null
}

/**
 * A reply that is plainly the model declining rather than writing: short, opening like a refusal (never with
 * a quotation mark: that is dialogue), and talking about the writing or the request; or a longer reply that opens or
 * ends with a paragraph like that which talks about the writing itself (refusalIn). "I can't go back there." and
 * "Sorry I'm late, he said." are prose; "I'm sorry, but I can't write that scene." is a refusal.
 */
export function looksLikeRefusalReply(text: string): boolean {
  return refusalIn(text) !== null
}
