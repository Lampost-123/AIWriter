// What a scene's words call someone (long story memory fix 12, 2026-10-15). The memory model reports a "name" item when
// the words call a character something the memory doesn't list for them: a nickname, a title, or "her brother" where in
// that scene it can only mean them (keeper/prompts.ts). Every one is kept for that scene (db/called.ts), so the writer's
// briefing and the page find the character by it there. One that would name them anywhere in the story (a nickname or a
// title: "Red", "the Captain") is also offered to Adam as another name, in Worth a look (keeper/checkQueue.ts), for him
// to add or ignore. A relation ("her brother", "Mother") or a plain description ("the old woman") depends on who is
// speaking, or who "her" is, so nothing can promise it means the same person in another scene: it stays with its scene
// and is never offered as another name. Pure.

/** Words before a name that don't make it a name of its own ("the Captain" is found by "Captain"). */
const ARTICLES = new Set(['the', 'a', 'an', 'this', 'that'])
/** Words that make what follows a relation to whoever they point at ("her brother", "my lord"). */
const POSSESSIVES = new Set(['her', 'his', 'their', 'my', 'your', 'our', 'its', 'whose'])
/** On their own, never someone's name. */
const PRONOUNS = new Set(
  `i me my mine you your yours he him his she her hers it its we us our ours they them their theirs one someone somebody
  anyone anybody everyone everybody nobody who whom this that these those`.split(/\s+/)
)
/**
 * Family words: "Mother", "Brother", "Gran" mean someone different from one speaker to the next, so even capitalised
 * they are only ever kept for their scene. "Brother Aldo" or "Aunt Jo" has a name of its own besides, and can be offered.
 */
const KIN = new Set(
  `mother father mum mom mam ma mama mamma mammy mummy mommy dad da pa papa daddy brother sister son daughter uncle aunt
  auntie aunty grandmother grandfather grandma grandpa gran granny grandad granddad grandpapa grandmama nan nana nanna
  gramps cousin nephew niece husband wife twin sibling child baby stepmother stepfather stepbrother stepsister stepson
  stepdaughter`.split(/\s+/)
)

/** The longest words kept, and the most words. */
const LONGEST = 60
const MOST_WORDS = 6

const wordsOf = (s: string): string[] => s.split(/\s+/).filter(Boolean)

/**
 * The words a "name" item gives, tidied ("the Captain" from “the Captain’s”), or null when they can't be a way of naming
 * someone: too long, a pronoun or "the" alone, or a single word that isn't capitalised ("boss", "girl": too common to
 * look for across a page).
 */
export function cleanCalled(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let t = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’.,;:!?]+$/gu, '')
    .replace(/['’]s$/u, '')
    .trim()
  if (t.length < 2 || t.length > LONGEST || !/^\p{L}/u.test(t)) return null
  const words = wordsOf(t)
  if (words.length > MOST_WORDS) return null
  const lower = words.map((w) => w.toLowerCase())
  if (lower.every((w) => PRONOUNS.has(w) || ARTICLES.has(w) || POSSESSIVES.has(w))) return null
  if (words.length === 1 && !/^\p{Lu}/u.test(t)) return null
  t = words.join(' ')
  return t
}

/**
 * True when what the words call someone would name them anywhere in the story, so it can be offered as another name:
 * besides "the", "a" and the like it has a capitalised word that isn't a family word ("the Captain", "Red", "Aunt Jo").
 * Never a relation to someone ("her brother", "my Lord"), a family word alone ("Mother") or a plain description ("the
 * old woman").
 */
export function aliasWorthy(words: string): boolean {
  const list = wordsOf(words)
  if (!list.length || POSSESSIVES.has(list[0].toLowerCase())) return false
  let i = 0
  while (i < list.length && ARTICLES.has(list[i].toLowerCase())) i++
  return list.slice(i).some((w) => /^\p{Lu}/u.test(w) && !KIN.has(w.toLowerCase()) && !PRONOUNS.has(w.toLowerCase()))
}
