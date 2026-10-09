// "Skip 'he said' after a voiced line" (Adam, 2026-10-09: "it breaks immersion"): when a quote is read in its
// speaker's own voice, the dialogue tag beside it ("she said", "said Mara", "I whispered to him") tells the listener
// nothing the voice hasn't, so it isn't spoken. An action the tag carries is still read ("she said, slamming the
// door" reads "Slamming the door."). Only what is spoken: the page keeps its words. Pure, so it is unit-tested
// (speechTags.test.ts); plan.ts uses it for the narration either side of such a quote.
import { VERBS } from './cast'

/** Who a tag names: a pronoun, "the guard", "her brother", or a name of one or two words. */
const SUBJECT =
  String.raw`(?:[Ii]|[Hh]e|[Ss]he|[Tt]hey|[Ww]e|[Yy]ou|(?:[Tt]he|[Aa]n?|[Hh]is|[Hh]er|[Mm]y|[Tt]heir|[Oo]ur) [a-z][\w'’-]*(?: [a-z][\w'’-]*)?|\p{Lu}[\p{L}'’-]+(?: \p{Lu}[\p{L}'’-]+)?)`
/** Whom: "him", "the guard", "Mara". */
const WHOM = String.raw`(?:him|her|them|me|us|you|the [a-z][\w'’-]*|\p{Lu}[\p{L}'’-]+)`
/** What may follow the verb and still be only a tag: "quietly", "to her", "him" (told him), "quietly to Mara". */
const TAIL = String.raw`(?: \w+ly)?(?: (?:to )?${WHOM})?(?: \w+ly)?`
const TAG = String.raw`(?:${SUBJECT} (?:${VERBS})|(?:${VERBS}) ${SUBJECT})${TAIL}`

/** A tag at the start of narration after a quote, and what it may be followed by: the end, punctuation, an action. */
const AFTER = new RegExp(String.raw`^\s*${TAG}(?=$|\s*[,.!?;:…—–-]|\s+(?:as|while|before|after|and|then|with|without|through|between|until)\b)`, 'u')
/** A tag ending narration before a quote: "Mara said, ", "He turned. She said: ". */
const BEFORE = new RegExp(String.raw`(^|[.!?…]["”’)]?\s+)${TAG}\s*[,:]?\s*$`, 'u')
/** "He turned and said, ": the action stays, "and said" goes. */
const AND_SAID = new RegExp(String.raw`\s+and (?:${VERBS})${TAIL}\s*[,:]?\s*$`, 'u')

const capital = (s: string): string => s.replace(/^(\W*)(\p{Ll})/u, (_, lead: string, c: string) => lead + c.toUpperCase())

/**
 * A piece of narration with the dialogue tags beside an own-voiced quote taken out: `after` the quote just before it
 * (its start), `before` the quote just after it (its end). What a tag carries besides (an action) is kept, starting
 * with a capital letter. Text with no such tag comes back as it was.
 */
export function withoutSpeechTags(text: string, side: { after?: boolean; before?: boolean }): string {
  let out = text
  if (side.after) {
    const m = out.match(AFTER)
    if (m) {
      let rest = out.slice(m[0].length)
      if (/^\s*[.!?…]/.test(rest)) rest = rest.replace(/^\s*[.!?…]+["”’)]?/, '')
      else rest = rest.replace(/^\s*[,;:—–-]+/, '')
      rest = rest.trimStart().replace(/^and\s+/i, '')
      out = capital(rest)
    }
  }
  if (side.before) {
    if (BEFORE.test(out)) out = out.replace(BEFORE, '$1').trimEnd()
    else if (AND_SAID.test(out)) out = out.replace(AND_SAID, '.')
  }
  // Nothing but punctuation left: nothing to say.
  return /[\p{L}\p{N}]/u.test(out) ? out : ''
}
