// The stage piece by piece (step 2b of the consistency plan, Adam 2026-10-07): every piece of clothing someone has on or
// took off is its own line, with how it is now, and so is each thing in the place that matters (a door barred, a case
// put on the windowsill, a lamp lit), each with the story's words for it. A real model's test run showed why: a door
// barred and then opened from outside with nothing keeping track of it, and a case put on a windowsill back in
// someone's hand. Here: how a change finds the piece or thing it is about (boots taken off never touch the coat), how an
// old one-line "wearing" (kept before step 2b) reads as pieces with nothing lost, and how each reads. Pure; shared by
// the main process and the Recall panel.

/** One piece of clothing someone has on or took off (jewellery, a pack and a sword belt count), or one thing in the place. */
export interface StageItem {
  /** What it is, short: "grey cloak", "left boot", "the back door", "the survey case". */
  name: string
  /**
   * How it is now. Clothing: "on" or "off" first, then where it is when off, then how it sits ("off, over the chair";
   * "on, unbuttoned to the waist"). A thing: where it is and how ("on the windowsill"; "shut and barred from inside").
   * '' for a piece read from an old one-line "wearing", whose own words say it all ("cloak off (over the beam)").
   */
  state: string
}

/** The most pieces of clothing kept for each person, and things for the scene: those changed longest ago go first. */
export const MOST_CLOTHES = 12
export const MOST_THINGS = 12
/** The longest a name and a state are kept, in characters. */
export const LONGEST_NAME = 80
export const LONGEST_STATE = 200

/** What a change's state says when a piece or a thing is no longer there at all (given away, burnt, picked up, carried off). */
export const GONE = 'gone'

/**
 * True when a state says the piece or thing is gone: it is taken off the list. A piece of clothing is gone only when it
 * is no longer theirs ("gone", given away, burnt); "removed" or "no longer worn" says it is off, and it stays, off
 * (offState). A thing in the place is gone when it is no longer there (picked up, carried off, removed).
 */
export const isGone = (state: string, clothing = false): boolean =>
  (clothing ? /^(?:gone|no longer theirs)\b/i : /^(?:gone|no longer (?:here|there)|removed)\b/i).test(state.trim())
/** True when a piece of clothing is off (taken off, wherever it is now). */
export const isOff = (state: string): boolean => /^off\b/i.test(state.trim())
/** A piece's state with "removed", "taken off" or "no longer worn" said as "off" ("removed, by the door" is "off, by the door"). */
export const offState = (state: string): string => state.replace(/^\s*(?:removed|taken off|pulled off|kicked off|no longer worn)\b/i, 'off')

/** Words before a name that don't say which it is: "her grey cloak" is "grey cloak". */
const LEAD = new Set(['a', 'an', 'the', 'her', 'his', 'their', 'its', 'my', 'your', 'our', 'one', 'some'])
const SIDES = new Set(['left', 'right'])

const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** One word as compared: "boots" is "boot", "dresses" "dress", "glasses" "glass". */
export function singular(w: string): string {
  if (w.length > 4 && /(?:sses|shes|ches|xes)$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
  return w
}

/** A name as compared: lower case, words only, without "the", "her" and the like before it ("grey cloak" for "Her grey cloak"). */
export function itemKey(name: string): string {
  const ws = wordsOf(name)
  let i = 0
  while (i < ws.length - 1 && LEAD.has(ws[i])) i++
  return ws.slice(i).join(' ')
}

const headOf = (key: string): string => singular(key.split(' ').at(-1) ?? '')
const sideOf = (key: string): string => key.split(' ').find((w) => SIDES.has(w)) ?? ''

const wordSet = (key: string): Set<string> => new Set(key.split(' ').map(singular))
const within = (a: Set<string>, b: Set<string>): boolean => [...a].every((w) => b.has(w))

/**
 * Which of `list` a change named `name` is about: the one with the same name; else one that has the change's last word
 * and says no more or no less than it ("cloak" is the "grey cloak", and "grey cloak" the "cloak"; "boots" is "boots off
 * (by the door)" read from an old line), but never another of its kind ("blue cloak" is not the "grey cloak": changing
 * clothes keeps both), never across left and right, and never a plain pair for a "left boot" (both are kept). When
 * several fit, a bare word ("boots") is about all of them for clothing; otherwise it is about none, and the change is a
 * new one.
 */
export function matching(list: readonly StageItem[], name: string, clothing: boolean): number[] {
  const key = itemKey(name)
  if (!key) return []
  const same = list.findIndex((x) => itemKey(x.name) === key)
  if (same >= 0) return [same]
  const head = headOf(key)
  const side = sideOf(key)
  const mine = wordSet(key)
  const near: number[] = []
  list.forEach((x, i) => {
    const k = itemKey(x.name)
    const theirs = wordSet(k)
    if (!theirs.has(head)) return
    if (side && sideOf(k) !== side) return
    // One read from an old line has more words than its name: its own word is enough.
    if (x.state && !within(mine, theirs) && !within(theirs, mine)) return
    near.push(i)
  })
  if (near.length <= 1) return near
  // Only a bare plural ("boots") is about every piece that has it: "boot" is one of them, not knowing which.
  return clothing && !key.includes(' ') && singular(key) !== key ? near : []
}

/** The name a piece or thing keeps when a change is about it: the change's for one read from an old line, else the fuller. */
function keptName(had: StageItem, change: string): string {
  if (!had.state) return change
  return itemKey(change).split(' ').length > itemKey(had.name).split(' ').length ? change : had.name
}

export interface Merged {
  items: StageItem[]
  /** Each change kept: the name it came as, and the name it is kept under (so its words go with it). */
  changed: { from: string; to: string }[]
}

/**
 * A list with changes laid over it, each on the piece or thing it is about (`matching`): a new state replaces the old,
 * "gone" takes it off, and anything new goes at the end; what no change names carries on. At most `most`: the ones
 * longest unchanged go first.
 */
export function mergeItems(before: readonly StageItem[], changes: readonly StageItem[], clothing: boolean, most: number): Merged {
  let items = before.map((x) => ({ ...x }))
  const changed: Merged['changed'] = []
  const fresh = new Set<StageItem>()
  for (const c of changes) {
    const at = matching(items, c.name, clothing)
    if (isGone(c.state, clothing)) {
      items = items.filter((_, i) => !at.includes(i))
      continue
    }
    const next: StageItem = { name: at.length === 1 ? keptName(items[at[0]], c.name) : c.name, state: c.state }
    if (at.length) {
      items[at[0]] = next
      items = items.filter((_, i) => i === at[0] || !at.includes(i))
    } else items.push(next)
    fresh.add(next)
    changed.push({ from: c.name, to: next.name })
  }
  // Too many: the ones longest unchanged go first (never one this change set made, unless there are more of those).
  while (items.length > most) {
    const old = items.findIndex((x) => !fresh.has(x))
    items.splice(old >= 0 ? old : 0, 1)
  }
  return { items, changed: changed.filter((c) => items.some((x) => x.name === c.to)) }
}

/** Words that only say how or where the piece before them is, so they stay with it when an old line is read as pieces. */
const DESCRIBES = new Set(
  `undone unbuttoned buttoned unlaced laced untied tied tucked untucked rolled pushed pulled half with without sleeves
  sleeve collar hood buttons laces cuffs hem still now done hanging slipping askew crooked belted fastened unfastened
  sagging gaping on in into by over under beside at against across round around behind near from hung set laid put
  placed thrown draped folded`.split(/\s+/)
)
/**
 * Words that say how a piece is, but may as well start the next one ("wet through" says more of the piece before; "wet
 * cloak" is another piece): they stay with the piece before only alone or before a little word.
 */
const SAYS_HOW = new Set('open closed loose torn ripped soaked wet damp dry muddy bloodied bloody stained'.split(' '))
const LINKS = new Set('through at from to with in on by up down and across along around about over under'.split(' '))

/** True when a piece of an old line only says more about the piece before it. */
function saysMore(piece: string): boolean {
  const [first = '', next] = wordsOf(piece)
  if (DESCRIBES.has(first)) return true
  return SAYS_HOW.has(first) && (next === undefined || LINKS.has(next))
}

/** A line split at commas and semicolons outside brackets. */
function pieces(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++
    if ((ch === ')' || ch === ']') && depth > 0) depth--
    if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
    .map((p) =>
      p
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^and\s+/i, '')
    )
    .filter(Boolean)
}

/**
 * A piece's name and how it is, where its words say "on" or "off" after the name ("boots off, by the door"; "boots on,
 * laced"); "boots on the floor" is not split ("on the floor" is where they are, not that they are worn).
 */
const ON_OFF = /^(.+?)\s+((?:on(?=$|\s*[,;(])|off\b).*)$/i

/** One piece's words as a piece: its name, and how it is when the words say "on" or "off"; else all of it as its name. */
function asPiece(words: string): StageItem {
  const m = ON_OFF.exec(words)
  return m ? { name: m[1].trim(), state: m[2].trim() } : { name: words, state: '' }
}

/**
 * An old one-line "wearing" (kept before step 2b, or given by a model in the old way) as pieces, so nothing it said is
 * lost: split where a comma or a semicolon starts another piece, with words that only say how or where the piece before
 * is ("unbuttoned to the waist", "sleeves rolled up", "over the chair") left with it. Each piece reads exactly as its
 * words did: "boots off (by the door)" is the boots, off (by the door); "dark trousers" is all name, with no state.
 */
export function itemsFromText(text: string): StageItem[] {
  const out: string[] = []
  for (const p of pieces(text)) {
    if (out.length && saysMore(p)) out[out.length - 1] += `, ${p}`
    else out.push(p)
  }
  return out.map(asPiece)
}

/** A piece of clothing as words: "boots off, by the door", "grey cloak on, hood up"; one from an old line as it was. */
export function pieceText(x: StageItem): string {
  if (!x.state) return x.name
  return /^(?:on|off)\b/i.test(x.state.trim()) ? `${x.name} ${x.state}` : `${x.name}: ${x.state}`
}

/** A thing as words: "the door: barred from inside". */
export const thingText = (x: StageItem): string => (x.state ? `${x.name}: ${x.state}` : x.name)

/** Little words that never say which piece or thing it is. */
const LITTLE = new Set('with from into onto over under about just still then them they this that there were have been'.split(' '))

/**
 * True when `text` names the piece or thing: its last word ("case" for "the survey case"; "boots" in "her boot"); for a
 * piece read from an old line, any word of it that isn't about how it sits ("shirt" or "white" for "a white shirt
 * unbuttoned to the waist").
 */
export function namesItem(text: string, x: StageItem): boolean {
  const said = new Set(wordsOf(text).map(singular))
  if (x.state) {
    const head = headOf(itemKey(x.name))
    return head.length >= 3 && said.has(head)
  }
  const core = (pieces(x.name)[0] ?? '').split(/\s+(?:on|off)\b|\(/i)[0] ?? ''
  return wordsOf(core).some(
    (w) => w.length >= 4 && !DESCRIBES.has(w) && !SAYS_HOW.has(w) && !LEAD.has(w) && !LITTLE.has(w) && said.has(singular(w))
  )
}

const tidy = (s: string, most: number): string => s.replace(/\s+/g, ' ').trim().slice(0, most)

/**
 * A piece of clothing as Adam writes it in Recall: "boots off, by the door" (its name, then "on" or "off" and the rest),
 * "shirt: torn at the shoulder", or just "dark trousers". Null when empty.
 */
export function parsePiece(text: string): StageItem | null {
  const t = tidy(text, LONGEST_NAME + LONGEST_STATE)
  if (!t) return null
  const colon = /^(.+?):\s*(.*)$/.exec(t)
  if (colon) return { name: tidy(colon[1], LONGEST_NAME), state: tidy(colon[2], LONGEST_STATE) }
  const p = asPiece(t)
  return { name: tidy(p.name, LONGEST_NAME), state: tidy(p.state, LONGEST_STATE) }
}

/** A thing as Adam writes it in Recall: "the door: barred from inside", or just "the lamp". Null when empty. */
export function parseThing(text: string): StageItem | null {
  const t = tidy(text, LONGEST_NAME + LONGEST_STATE)
  if (!t) return null
  const colon = /^(.+?):\s*(.*)$/.exec(t)
  return colon ? { name: tidy(colon[1], LONGEST_NAME), state: tidy(colon[2], LONGEST_STATE) } : { name: t, state: '' }
}

/** A piece or thing from a reply: {item or thing, state}, made tidy; null without a name. */
export function readItem(v: unknown, nameKey: 'item' | 'thing'): StageItem | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const raw = o[nameKey] ?? o.name
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, LONGEST_NAME) : ''
  const state = typeof o.state === 'string' ? o.state.replace(/\s+/g, ' ').trim().slice(0, LONGEST_STATE) : ''
  return name ? { name, state } : null
}
