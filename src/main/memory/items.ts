// What someone gave away or lost stays known, and an item is found by its main word (Adam, 2026-10-07: in a real-model
// trap run Wren gave her brass compass to Mother Agate in scene 7, and in scene 23 the writer had her take it out of
// her pocket. The codex had it, but only as about the nineteenth newest thing that had happened to her, and "the
// compass" on the card or in the words never found the entry "The brass compass").
//
// Who has what is read from the codex as of a point, on that point's own line (memory/state.ts), so nothing from a later
// scene or another storyline counts:
//   - what has happened to each character ("gave her brass compass to Mother Agate", "got the compass back"), to each
//     item ("given to Mother Agate as a toll", "stolen by Bryn") and in each event ("Wren paid the toll with her compass");
//   - relationships between a character and an item ("holds", "owned by", "formerly owned").
// An item has one holder at a time: the latest of these says who has it now, and anyone who had it before no longer
// does. So an item given away and got back is had again, and only what is true now is said. Only items that are entries
// of the codex count, so "lost her temper" or "lost her left hand" never does. Pure.

import type { EntryState, ID, RelationshipState } from '@shared/types'

type Named = Pick<EntryState, 'id' | 'kind' | 'name' | 'aliases'>

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
const wordsOf = (s: string): string[] => s.toLowerCase().match(WORD) ?? []
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Each name's pattern, made once (a big world reads thousands of notes for the same few hundred names). */
const patterns = new Map<string, RegExp>()

/** A whole word or phrase: a single capitalised word must be capitalised there; anything else ignores case. */
const nameRe = (name: string): RegExp => {
  const n = name.trim()
  let re = patterns.get(n)
  if (!re) {
    if (patterns.size > 5_000) patterns.clear()
    const flags = `g${/\s/.test(n) || !/^\p{Lu}/u.test(n) ? 'iu' : 'u'}`
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, flags)
    patterns.set(n, re)
  }
  re.lastIndex = 0
  return re
}

/** The last word of a name, small: a quick check that it may be in a text before the pattern is tried. */
const lastOf = (name: string): string => wordsOf(name).at(-1) ?? ''

/** True when `name` is in `text` as a whole word or phrase, read as the briefing reads names (ai/context.ts `mentions`). */
export function nameIn(text: string, name: string): boolean {
  return name.trim().length >= 2 && !!text && text.toLowerCase().includes(lastOf(name)) && nameRe(name).test(text)
}

// ---------- An item's main word ----------

/**
 * Words too common to find an item by on their own: "the Dragon's Eye" is never found by "eye", nor "the silver hand"
 * by "hand". Any other main word counts only when no other entry has that word in its name (itemHeads).
 */
const COMMON = new Set(
  `thing things item items object objects one ones piece pieces part parts bit bits set sets pair pairs lot kind sort
  way ways place places time times day days night nights year years week weeks hour hours moment end side top bottom
  back front middle edge hand hands head heads eye eyes face faces heart hearts arm arms foot feet leg legs finger fingers
  tooth teeth bone bones blood skin hair mouth lip lips tongue neck throat chest shoulder shoulders knee knees body mind
  soul word words name names voice light dark fire water air earth sky sun moon star stars wind rain snow ice stone stones
  rock rocks wood tree trees grass ground floor wall walls door doors window windows room rooms house home road roads path
  street town city world land sea river life death man men woman women boy girl child children people person friend
  friends family mother father sister brother son daughter king queen lord lady master old new big small little`.split(/\s+/)
)

const ARTICLES = new Set(['the', 'a', 'an'])

/**
 * The main word of a name that has other words besides it: "compass" in "The brass compass" and in "Wren's compass",
 * "seal" in "The Duke's seal", "key" in "The iron key of Harrow". '' for a name of one word ("Stormbringer", "The
 * Ring": the name itself is how it is found), and for "The Blade of Dawn" ("blade" alone says too little).
 */
export function mainWord(name: string): string {
  const head = clean(name).split(/\s*[,;:()]\s*|\s+[–—]\s+/)[0] ?? ''
  const core = head.split(/\s+(?:of|from|for|with|in|on|at|to|called|named|that|which)\s+/i)[0] ?? ''
  if (wordsOf(core).filter((w) => !ARTICLES.has(w)).length < 2) return ''
  const w = wordsOf(core).at(-1) ?? ''
  return w.length >= 3 && /^\p{L}+$/u.test(w) ? w : ''
}

/** A name without "the", "a" or "an" before it ("brass compass" for "The brass compass"); '' when it has none. */
const withoutArticle = (name: string): string => /^(?:the|a|an)\s+(.+)$/i.exec(clean(name))?.[1] ?? ''

/**
 * For each item entry, the main words it can be found by alone ("compass" for "The brass compass"): only a word no other
 * entry has in its name or other names, and not a common word (COMMON). An item with none is found by its names alone.
 */
export function itemHeads(entries: Named[]): Map<ID, string[]> {
  const uses = new Map<string, Set<ID>>()
  for (const e of entries) {
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      for (const w of wordsOf(n)) {
        const k = w.replace(/['’]s$/, '')
        let ids = uses.get(k)
        if (!ids) uses.set(k, (ids = new Set()))
        ids.add(e.id)
      }
    }
  }
  const out = new Map<ID, string[]>()
  for (const e of entries) {
    if (e.kind !== 'item') continue
    const heads = [...new Set([e.name, ...(e.aliases ?? [])].map(mainWord).filter(Boolean))].filter(
      (w) => !COMMON.has(w) && (uses.get(w)?.size ?? 0) <= 1
    )
    if (heads.length) out.set(e.id, heads)
  }
  return out
}

/**
 * The words an entry can be found by in a text: its name and other names; for an item also each without "the" ("brass
 * compass") and its own main words (itemHeads).
 */
export function namesOf(e: Named, heads: Map<ID, string[]>): string[] {
  const names = [e.name, ...(e.aliases ?? [])].map(clean).filter((n) => n.length >= 2)
  if (e.kind !== 'item') return names
  const bare = names.map(withoutArticle).filter((n) => n.length >= 2)
  return [...new Set([...names, ...bare, ...(heads.get(e.id) ?? [])])]
}

// ---------- Reading what moved ----------

type VerbKind = 'give' | 'lose' | 'taken' | 'get'

const verbList = (words: string, kind: VerbKind): [string, VerbKind][] => words.split(',').map((v) => [v.trim(), kind])

/** The words that move a thing. Several words ("gave away") are read before one ("gave"). */
const VERBS: [string, VerbKind][] = [
  // It goes from the doer to someone else, or to no one named.
  ...verbList('gave away, gave back, gave up, give up, given up, given away, given back, handed over, handed back, hands over, passed on, parted with', 'give'),
  ...verbList(
    'gave, give, gives, giving, given, handed, hands, passed, sold, sells, traded, trades, swapped, bartered, exchanged, paid, pays, lent, lends, loaned, pawned, surrendered, returned, returns, entrusted, bequeathed, left, leaves, sent, delivered',
    'give'
  ),
  // It is gone, to no one. (Broken isn't gone: a broken compass may still be in her pocket.)
  ...verbList('left behind, threw away, thrown away, robbed of, stripped of, relieved of, no longer has, no longer have, no longer carries, no longer holds, no longer owns, no longer wears', 'lose'),
  ...verbList('lost, loses, dropped, drops, abandoned, threw, tossed, discarded, smashed, shattered, destroyed, burned, burnt, melted, buried, sank, sunk, sacrificed, without', 'lose'),
  // Someone takes it (as a participle: from whoever had it, "stolen by Bryn").
  ...verbList('stolen, taken, seized, confiscated, snatched', 'taken'),
  // The doer has it.
  ...verbList('got back, gets back, took back, takes back, picked up, picks up, now has, now carries, now holds, now keeps, now owns, now wears, now wields, now bears', 'get'),
  ...verbList(
    'got, gets, took, takes, retrieved, retrieves, recovered, recovers, regained, reclaimed, received, receives, accepted, accepts, bought, buys, purchased, found, finds, stole, steals, won, wins, inherited, inherits, acquired, obtained, pocketed, pockets, kept, keeps, carries, carried, holds, held, wears, wore, worn, wields, wielded, owns, owned, has',
    'get'
  )
]

/** The verbs by their first word, longest first. */
const VERBS_BY_FIRST = new Map<string, { parts: string[]; kind: VerbKind }[]>()
for (const [v, kind] of VERBS) {
  const parts = v.split(' ')
  const at = VERBS_BY_FIRST.get(parts[0]) ?? []
  at.push({ parts, kind })
  at.sort((a, b) => b.parts.length - a.parts.length)
  VERBS_BY_FIRST.set(parts[0], at)
}

/** A quick test for any of them, so most notes are passed over at once. */
const ANY_VERB = new RegExp(`(?<![\\p{L}])(?:${[...VERBS_BY_FIRST.keys()].map(escapeRe).join('|')})(?![\\p{L}])`, 'iu')

/** Words just before a verb that say it didn't happen, or hasn't yet ("did not give", "would never sell"). */
const NOT_DONE = new Set(
  'not never nor refused refuses tried tries wanted wants would will could might may must should shall planned plans meant means hoped hopes offered offers promised promises threatened threatens considered considers if unless almost nearly wished wishes pretended pretends'.split(
    ' '
  )
)
/** Words that may not stand between a verb and its thing ("took a bearing with the compass" is no taking). */
const BREAKS = new Set(
  'with at on in into onto by about over under through across after before near beside toward towards around against for of off from to as than where when that which who whose because since until or'.split(' ')
)
const BE = new Set(['was', 'were', 'is', 'are', 'been', 'being'])
/** "traded her knife for the compass": the compass is got. */
const TRADES = new Set(['traded', 'trades', 'swapped', 'bartered', 'exchanged', 'sold', 'sells', 'gave', 'gives', 'give'])
/** "paid the toll with her compass": the compass is given. */
const PAYS = new Set(['paid', 'pays', 'bought', 'buys', 'purchased', 'bribed', 'bribes'])
/** Verbs of having, not getting: "kept it hidden from Bryn" takes nothing from Bryn. */
const HAVING = new Set(['kept', 'keeps', 'carries', 'carried', 'holds', 'held', 'wears', 'wore', 'worn', 'wields', 'wielded', 'owns', 'owned', 'has', 'now'])
/** Titles, never a first name to know someone by ("Mother Agate" isn't "Mother"). */
const TITLES = new Set(
  'mother father sister brother aunt uncle old young lady lord sir dame master mistress captain king queen prince princess doctor dr mr mrs miss ms saint st abbot abbess the'.split(' ')
)

interface Token {
  w: string
  start: number
  end: number
}
interface Span {
  id: ID
  start: number
  end: number
}
interface Verb {
  i: number
  n: number
  kind: VerbKind
  /** Its first word. */
  w: string
}

const tokensOf = (s: string): Token[] => [...s.matchAll(WORD)].map((m) => ({ w: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))

/** Each list of names by the last word of each name, made once per list, so a text is matched only with the names it may hold. */
const lexicons = new WeakMap<object, Map<string, { id: ID; n: string }[]>>()
function lexiconOf(named: { id: ID; names: string[] }[]): Map<string, { id: ID; n: string }[]> {
  let l = lexicons.get(named)
  if (!l) {
    l = new Map()
    for (const x of named) {
      for (const n of x.names) {
        const last = lastOf(n)
        l.set(last, [...(l.get(last) ?? []), { id: x.id, n }])
      }
    }
    lexicons.set(named, l)
  }
  return l
}

/** Every place one of these names appears in `text`, as a whole word or phrase (longest names first, no overlaps). */
function spansOf(text: string, named: { id: ID; names: string[] }[]): Span[] {
  const found: Span[] = []
  const byLast = lexiconOf(named)
  const words = new Set(wordsOf(text).flatMap((w) => [w, w.replace(/['’]s$/, '')]))
  const maybe = [...words].flatMap((w) => byLast.get(w) ?? []).sort((a, b) => b.n.length - a.n.length)
  for (const { id, n } of maybe) {
    for (const m of text.matchAll(nameRe(n))) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (!found.some((f) => f.start < end && start < f.end)) found.push({ id, start, end })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/** What one clause says moved: an item, who has it after (null: no one named), and who no longer has it. */
export interface Moved {
  item: ID
  to: ID | null
  from: ID[]
}

export interface Reading {
  /** The character a note is about: a note has no subject of its own ("gave her compass to Mother Agate"). */
  self: ID | null
  /** The item a note is about, for an item's own note ("given to Mother Agate as a toll"). */
  itemSelf: ID | null
  items: { id: ID; names: string[] }[]
  people: { id: ID; names: string[] }[]
  /** The last word of each item's names: a note with none of them names no item, and is passed over at once. */
  keys?: Set<string>
}

/** Splits a note into clauses: sentences, and the parts joined by "and", "but" or "then". */
const clausesOf = (text: string): string[] =>
  text
    .split(/[.;!?]+|,?\s+(?:and then|and|but|then|while|whereupon)\s+/i)
    .map((c) => c.trim())
    .filter(Boolean)

/** What a note says moved, clause by clause. "It" in a clause is the item the clause before named. */
export function movesIn(text: string, r: Reading): Moved[] {
  if (!r.itemSelf && r.keys && !wordsOf(text).some((w) => r.keys!.has(w))) return []
  if (!ANY_VERB.test(text)) return []
  const out: Moved[] = []
  let last: ID | null = r.itemSelf
  for (const clause of clausesOf(text)) {
    const got = movesInClause(clause, r, last)
    out.push(...got.moves)
    last = got.named ?? last
  }
  return out
}

function movesInClause(clause: string, r: Reading, last: ID | null): { moves: Moved[]; named: ID | null } {
  const tokens = tokensOf(clause)
  const items = spansOf(clause, r.items)
  const firstItem = items[0]?.id ?? null
  const verbs: Verb[] = []
  for (let i = 0; i < tokens.length; i++) {
    const v = (VERBS_BY_FIRST.get(tokens[i].w) ?? []).find((x) => x.parts.every((p, k) => tokens[i + k]?.w === p))
    if (!v) continue
    verbs.push({ i, n: v.parts.length, kind: v.kind, w: v.parts[0] })
    i += v.parts.length - 1
  }
  if (!verbs.length) return { moves: [], named: firstItem }
  const people = spansOf(clause, r.people).filter((p) => !items.some((it) => it.start < p.end && p.start < it.end))
  /** The index of the first token at or after a place in the clause (the number of tokens when there is none). */
  const tokenAt = (pos: number): number => {
    const k = tokens.findIndex((t) => t.start >= pos)
    return k < 0 ? tokens.length : k
  }
  const done = (v: Verb): boolean => {
    for (let k = Math.max(0, v.i - 4); k < v.i; k++) if (NOT_DONE.has(tokens[k].w) || /n['’]t$/.test(tokens[k].w)) return false
    return tokens[v.i - 1]?.w !== 'to'
  }
  /** The person right after one of these words from token `from` on ("to Mother Agate", "from the old Bryn"). */
  const personAfter = (words: string[], from: number): ID | null => {
    for (let k = from; k < tokens.length; k++) {
      if (!words.includes(tokens[k].w)) continue
      const end = tokens[k].end
      const p = people.find((x) => x.start >= end && /^\s+(?:(?:the|old|young|little)\s+)?$/i.test(clause.slice(end, x.start)))
      if (p) return p.id
    }
    return null
  }
  /**
   * The person named just before the verb (two words between at most), who does it: "Mother Agate took her compass",
   * "Ash quietly took it"; not one it is to or from, nor someone met earlier in the clause ("having met Ash, gave…").
   */
  const doer = (v: Verb): ID | null => {
    const p = people.filter((x) => x.end <= tokens[v.i].start).at(-1)
    if (!p || v.i - tokenAt(p.end) > 2) return null
    const k = tokenAt(p.start) - 1
    return k >= 0 && ['to', 'from', 'with', 'by', 'for', 'of', 'off'].includes(tokens[k].w) ? null : p.id
  }

  // The item where the clause names it; else "it" for the one named just before; else an item's own note.
  const it = tokens.find((t) => t.w === 'it')
  const mentions: Span[] = items.length
    ? items
    : last && it && (r.itemSelf !== last || !r.itemSelf)
      ? [{ id: last, start: it.start, end: it.end }]
      : r.itemSelf
        ? [{ id: r.itemSelf, start: -1, end: -1 }]
        : []
  const moves: Moved[] = []
  const seen = new Set<ID>()
  for (const m of mentions) {
    if (seen.has(m.id)) continue
    // "the compass's needle" is part of it, not it.
    if (m.end >= 0 && /^['’]s(?![\p{L}])/u.test(clause.slice(m.end))) continue
    let v: Verb | undefined
    let mode: 'pre' | 'post' | 'own' = 'own'
    if (m.start < 0) v = verbs.find(done)
    else {
      const at = tokenAt(m.start)
      // The verb before the thing, a few words back at most, with nothing between that ends its reach.
      const before = verbs.filter((x) => x.i + x.n <= at).at(-1)
      if (before && at - (before.i + before.n) <= 5) {
        const between = tokens.slice(before.i + before.n, at).map((t) => t.w)
        const stops = between.filter((w) => BREAKS.has(w))
        if (!stops.length) v = before
        else if (stops.length === 1 && stops[0] === 'for' && TRADES.has(before.w)) v = { ...before, kind: 'get' }
        else if (stops.length === 1 && stops[0] === 'with' && PAYS.has(before.w)) v = { ...before, kind: 'give' }
        if (v) mode = 'pre'
      }
      // Or the verb just after it ("her compass was taken", "the compass, stolen by Bryn").
      if (!v) {
        const endAt = tokenAt(m.end)
        const after = verbs.find((x) => x.i >= endAt && x.i - endAt <= 3)
        if (after && tokens.slice(endAt, after.i).every((t) => BE.has(t.w) || ['got', 'had', 'has', 'have', 'now', 'then'].includes(t.w))) {
          v = after
          mode = 'post'
        }
      }
    }
    if (!v || !done(v)) continue
    seen.add(m.id)
    const passive = BE.has(tokens[v.i - 1]?.w ?? '')
    const after = v.i + v.n
    const by = personAfter(['by'], after)
    const source = HAVING.has(v.w) ? null : personAfter(['from', 'off'], after)
    const named = doer(v)
    const who = named ?? r.self
    // Someone named between the verb and the thing is who it went to ("gave Mother Agate her compass"), but not "Ash's".
    const between =
      mode === 'pre' ? people.find((p) => p.start >= tokens[after - 1].end && p.end <= m.start && !/^['’]s(?![\p{L}])/u.test(clause.slice(p.end))) : undefined
    const to = between?.id ?? personAfter(['to', 'with', 'for'], mode === 'pre' ? Math.max(after, tokenAt(m.end)) : after)
    const ids = (xs: (ID | null)[]): ID[] => [...new Set(xs.filter((x): x is ID => !!x))]
    let move: Omit<Moved, 'item'> | null = null
    switch (v.kind) {
      case 'give':
        if (mode === 'pre' && (passive || (v.w === 'given' && v.n === 1 && v.i === 0 && !named) || (by && ['given', 'handed', 'lent', 'sent'].includes(v.w)))) {
          // "was given the compass by Agate", "given a sword by the king": the doer gets it.
          move = who ? { to: who, from: ids([by, source]) } : null
        } else if (mode === 'own') {
          // An item's own note: "given to Mother Agate", "Wren gave it to Mother Agate", "sold by Wren".
          move = { to, from: ids([named, by]) }
        } else if (named && r.self && named !== r.self && !to) {
          // In a character's own note, someone else gave it, to no one named: "Mother Agate gave her the compass".
          move = { to: r.self, from: ids([named]) }
        } else move = { to, from: ids([who]) }
        break
      case 'lose':
        move = { to: null, from: ids(mode === 'own' ? [named, by] : [who]) }
        break
      case 'taken':
        if (mode === 'pre' && !passive) move = who ? { to: who, from: ids([source]) } : null
        else move = { to: by, from: ids(mode === 'post' ? [who, source] : [source]) }
        break
      case 'get':
        // "held by Ash", "was found by Ash": Ash has it. Not "found the compass, guarded by Ash": she has it.
        if (by && (passive || mode !== 'pre')) move = { to: by, from: ids([source]) }
        else if (who) move = { to: who, from: ids([source, named && r.self && named !== r.self ? r.self : null]) }
        break
    }
    if (move) moves.push({ item: m.id, ...move })
  }
  return { moves, named: firstItem }
}

// ---------- Who has what ----------

/** One thing someone in the scene had and no longer has, or has now. */
export interface Holding {
  personId: ID
  person: string
  itemId: ID
  /** The item as a sentence names it: "the brass compass". */
  item: string
  /** The words the item can be found by in a text (namesOf), so lines about items the scene names can come first. */
  words: string[]
  /** True: they have it now, and got it during the story. False: they had it, and no longer do. */
  has: boolean
  /** They have it again, after losing it or giving it away. */
  again: boolean
  /** What happened, in the codex's words: "gave her grandmother's brass compass to Mother Agate as a toll". */
  how: string
  /** Where it happened, in plain words ("Book 1, Ch 2, Sc 7"; '' for the starting setup), and its step on the line. */
  where: string
  at: number
}

/** Where a move came from, so it can be told in words that fit whoever's line it is on. */
type Source = { kind: 'note'; entryId: ID; entryName: string; entryKind: EntryState['kind']; note: string } | { kind: 'tie'; text: string }

interface Move extends Moved {
  source: Source
  where: string
  at: number
  /** Breaks ties at the same place: a character's own note first, then an item's, an event's, then relationships. */
  order: number
}

/** A relationship's words that say a character had the item, or has it ("formerly owned", "holds", "owned by"). */
const HAD_TIE = /\b(?:former(?:ly)?|once|used to|no longer|lost|gave|given away|sold|traded|pawned|surrendered|stolen from|taken from)\b/i
const HAS_TIE =
  /\b(?:holds?|held|holder|has|have|owns?|owned|owner|keeps?|kept|keeper|carr(?:y|ies|ied|ier)|bearer|bears|wields?|wielder|wears?|worn|possess(?:es|ed|or|ion)?|belongs?|given to|guards?|guardian|custodian|steward|in the hands of)\b/i

/**
 * Who among `people` has or no longer has an item at the point `entries` and `relationships` are worked out at: one
 * holding per person and item, what is true now only (see the top of this file). `entries` is every entry that exists
 * there, each with what has happened to it in line order (memory/state.ts).
 */
export function holdingsOf(o: { entries: EntryState[]; relationships: RelationshipState[]; people: ID[] }): Holding[] {
  const wanted = new Set(o.people)
  if (!wanted.size || !o.entries.some((e) => e.kind === 'item')) return []
  const byId = new Map(o.entries.map((e) => [e.id, e]))
  const heads = itemHeads(o.entries)
  const items = o.entries.filter((e) => e.kind === 'item').map((e) => ({ id: e.id, names: namesOf(e, heads) }))
  const keys = new Set(items.flatMap((i) => i.names.map(lastOf)))
  const characters = o.entries.filter((e) => e.kind === 'character')
  // A character by name, other name, or a first name only they have ("Wren" for Wren Calloway; never a title).
  const firstOf = (c: EntryState): string => {
    const [f, ...rest] = clean(c.name).split(' ')
    return rest.length && f.length >= 3 && /^\p{Lu}/u.test(f) && !TITLES.has(f.toLowerCase()) ? f : ''
  }
  const firsts = new Map<string, number>()
  for (const c of characters) if (firstOf(c)) firsts.set(firstOf(c), (firsts.get(firstOf(c)) ?? 0) + 1)
  const people = characters.map((c) => {
    const f = firstOf(c)
    return { id: c.id, names: [...new Set([c.name, ...(c.aliases ?? []), ...(f && firsts.get(f) === 1 ? [f] : [])].map(clean).filter((n) => n.length >= 2))] }
  })

  const moves: Move[] = []
  const fromNotes = (e: EntryState, order: number, reading: Reading): void => {
    ;(e.happened ?? []).forEach((h, i) => {
      for (const m of movesIn(h.note, reading)) {
        moves.push({ ...m, source: { kind: 'note', entryId: e.id, entryName: e.name, entryKind: e.kind, note: clean(h.note) }, where: clean(h.where), at: h.at ?? -1, order: order + i / 10_000 })
      }
    })
  }
  for (const c of characters) fromNotes(c, 0, { self: c.id, itemSelf: null, items, people, keys })
  for (const it of o.entries) if (it.kind === 'item') fromNotes(it, 1, { self: null, itemSelf: it.id, items, people, keys })
  // An event: its summary, at the place those in it were linked to it.
  const involved = new Map<ID, RelationshipState[]>()
  for (const r of o.relationships) {
    if (!/involved/i.test(r.type)) continue
    for (const id of [r.aId, r.bId]) if (byId.get(id)?.kind === 'event') involved.set(id, [...(involved.get(id) ?? []), r])
  }
  for (const ev of o.entries) {
    if (ev.kind !== 'event' || !clean(ev.summary)) continue
    const links = involved.get(ev.id) ?? []
    if (!links.length) continue
    const last = links.reduce((a, b) => ((b.at ?? -1) > (a.at ?? -1) ? b : a))
    for (const m of movesIn(ev.summary, { self: null, itemSelf: null, items, people, keys })) {
      moves.push({ ...m, source: { kind: 'note', entryId: ev.id, entryName: ev.name, entryKind: 'event', note: clean(ev.summary) }, where: clean(last.where), at: last.at ?? -1, order: 2 })
    }
  }
  // A character and an item tied together, read from either side: who holds it, or who once did.
  for (const r of o.relationships) {
    const a = byId.get(r.aId)
    const b = byId.get(r.bId)
    if (!a || !b) continue
    const person = a.kind === 'character' && b.kind === 'item' ? a : b.kind === 'character' && a.kind === 'item' ? b : null
    const item = person === a ? b : person === b ? a : null
    if (!person || !item) continue
    const type = clean(r.type)
    const had = HAD_TIE.test(type)
    if (!had && !HAS_TIE.test(type)) continue
    moves.push({
      item: item.id,
      to: had ? null : person.id,
      from: had ? [person.id] : [],
      source: { kind: 'tie', text: `${nameOf(a)} ${type} ${nameOf(b)}` },
      where: clean(r.where),
      at: r.at ?? -1,
      order: 3
    })
  }

  const out: Holding[] = []
  const byItem = new Map<ID, Move[]>()
  for (const m of moves) {
    const got = byItem.get(m.item)
    if (got) got.push(m)
    else byItem.set(m.item, [m])
  }
  for (const [itemId, list] of byItem) {
    list.sort((a, b) => a.at - b.at || a.order - b.order)
    let holder: ID | null = null
    const status = new Map<ID, { has: boolean; move: Move; lost: boolean }>()
    const set = (p: ID, has: boolean, m: Move): void => {
      const cur = status.get(p)
      // Since when it holds: the first move of the stretch it has held for.
      if (cur && cur.has === has) return
      status.set(p, { has, move: m, lost: !!cur && (!cur.has || cur.lost) })
    }
    for (const m of list) {
      const losers = new Set(m.from)
      if (holder && holder !== m.to) losers.add(holder)
      for (const p of losers) if (p !== m.to) set(p, false, m)
      if (m.to) set(m.to, true, m)
      holder = m.to
    }
    const item = byId.get(itemId)!
    for (const [personId, s] of status) {
      if (!wanted.has(personId)) continue
      // Something had from the starting setup is no change; something got during the story is.
      if (s.has && (s.move.at < 0 || !s.move.where)) continue
      out.push({
        personId,
        person: byId.get(personId)!.name,
        itemId,
        item: itemName(item.name),
        words: namesOf(item, heads),
        has: s.has,
        again: s.has && s.lost,
        how: howText(s.move.source, personId),
        where: s.move.where,
        at: s.move.at
      })
    }
  }
  return out
}

/** An entry as a sentence names it: an item with a small "the", anyone else as they are. */
const nameOf = (e: Named): string => (e.kind === 'item' ? itemName(e.name) : clean(e.name))

/** An item as a sentence names it: "The brass compass" is "the brass compass"; "Stormbringer" stays as it is. */
export const itemName = (name: string): string => clean(name).replace(/^(The|A|An)\s/, (a) => a.toLowerCase())

/** A note's first word made small when it is a verb, not a name ("Gave her compass…" is "gave her compass…"). */
const tidy = (note: string): string => {
  const first = (note.split(/\s+/)[0] ?? '').toLowerCase()
  return VERBS_BY_FIRST.has(first) || ['now', 'no', 'was', 'is', 'had'].includes(first) ? note.charAt(0).toLowerCase() + note.slice(1) : note
}

/** What happened, for a person's line: their own note as it is, someone else's with their name, a tie as it reads. */
function howText(s: Source, personId: ID): string {
  if (s.kind === 'tie') return s.text
  const note = tidy(s.note.replace(/[.]+$/, ''))
  return s.entryKind !== 'character' || s.entryId === personId ? note : `${s.entryName} ${note}`
}

/** The longest "how" a line keeps, in characters. */
const LONGEST_HOW = 160

/**
 * A holding as one line: "Wren: no longer has the brass compass (gave it to Mother Agate as a toll; since Ch 2, Sc 7)",
 * "Wren: has the brass compass again (got it back from Mother Agate; since Ch 5, Sc 1)". `place` says where it happened
 * as the reader should see it (this story's title left off, say).
 */
export function holdingLine(h: Holding, place: (where: string) => string = (w) => w): string {
  const how = h.how.length > LONGEST_HOW ? `${h.how.slice(0, LONGEST_HOW - 1).trimEnd()}…` : h.how
  const where = place(h.where)
  const what = h.has ? `has ${h.item}${h.again ? ' again' : ''}` : `no longer has ${h.item}`
  return `${h.person}: ${what} (${[how, where ? `since ${where}` : ''].filter(Boolean).join('; ')})`
}

/** True when a text names the holding's item (its names, or its own main word). */
export const namesItem = (text: string, h: Pick<Holding, 'words'>): boolean => !!text.trim() && h.words.some((w) => nameIn(text, w))

/**
 * The holdings that matter most first: those whose item `text` names (the scene card, beats, direction, the scene so
 * far, or the new words being checked), then what someone no longer has before what they have, then the most recent.
 */
export function holdingsFirst(holdings: Holding[], text: string): Holding[] {
  const named = new Map(holdings.map((h) => [h, namesItem(text, h)]))
  return [...holdings].sort((a, b) => Number(named.get(b)) - Number(named.get(a)) || Number(a.has) - Number(b.has) || b.at - a.at)
}
