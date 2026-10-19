// The scene card's place keeps its name (free rules, 2026-10-19). The live test's writer named the card's "St Anne's
// church, Ashby" St Chad's, and the memory then kept that. So the words' named places of a kind ("St Chad's", "the Red
// Lion Inn", "Mill Lane", "Harrow Bridge") are held to the scene card's place and the places it is in: when one of
// those has a name of the same kind (St Anne's; the Crown Inn) and the words' name is no place, person or thing in the
// codex, the words have the wrong name for it. No AI call. Said only of the narration (a line of dialogue may name
// another church), never where the codex's own name is in the same paragraph ("from St Anne's she could see St
// Chad's": two churches), and never for a feast or a plant ("St John's Day", "St John's wort").
// A street, a bridge, a hill or a market (`PASSED`) is somewhere people pass by: another one is often named, so it is
// held only to the card's own place (never one it is in: a house on Cobb Lane may look out on Mill Lane), and always
// asked, never mended.
// - `safe`: a building or a saint's name, one card place has that kind, the swap is at most three words each way, and
//   the codex's own name is nowhere else in the scene: check and repair mends it in place (in amber, with Undo).
//   Otherwise it is asked, with the swap as the suggested fix.
// Pure.

import type { ID } from '@shared/types'
import { quoteSpans } from './speakers'

/** A codex place, as the lock reads it. */
export interface LockPlace {
  id: ID
  name: string
  aliases: string[]
  parentId: ID | null
}

export interface PlaceNameContext {
  /** Every codex place. */
  places: LockPlace[]
  /** The scene card's place and the places it is in, nearest first ([] when the card has none). */
  chain: ID[]
  /** Every other codex entry's names and other names, in lower case (people, things, groups): never a slip. */
  otherNames: ReadonlySet<string>
}

/** A named place of a kind, in a text or a codex name. */
interface Named {
  kind: string
  /** The words that name it, less the kind: "Chad" of "St Chad's", "Red Lion" of "the Red Lion Inn". */
  name: string
  /** What would be swapped: "St Chad's" (a saint's), "Red Lion" (a name before its kind). */
  part: string
  start: number
  end: number
  /** The whole name as written ("St Chad's Church", "Red Lion Inn"). */
  whole: string
}

/** A place the words name wrong. */
export interface PlaceSlip {
  /** Where the words to swap are, and what they are. */
  start: number
  end: number
  words: string
  /** The codex's own words for them ("St Anne's", "Crown"). */
  right: string
  placeId: ID
  placeName: string
  /** The words' whole name and the codex's ("St Chad's Church", "St Anne's church, Ashby"). */
  said: string
  /** Mend it in place, without asking (see the top of this file). */
  safe: boolean
  message: string
}

const KINDS =
  'Church|Chapel|Cathedral|Abbey|Priory|Minster|Kirk|Temple|Inn|Tavern|Arms|Hotel|Lane|Street|Road|Row|Square|Hall|Manor|Castle|Tower|Bridge|Gate|Mill|Farm|Wharf|Quay|Market|Close|Court|Green|Wood|Forest|Hill|Moor|Fell|Weir|Station|School|College|Hospital|Prison|Gaol'
/** Kinds of place people pass by or through, where another of the kind is often named (see the top of this file). */
const PASSED = new Set(['lane', 'street', 'road', 'row', 'square', 'close', 'court', 'green', 'wood', 'forest', 'hill', 'moor', 'fell', 'bridge', 'gate', 'market', 'wharf', 'quay', 'weir', 'station'])
/** Kinds a saint's name may have after it in small letters ("St Anne's church"). */
const SAINT_KINDS = 'church|chapel|cathedral|abbey|priory|minster|kirk|well|hospital|college|school'
/**
 * What follows a saint's name when it is no place: a feast, a plant, an illness, something of the saint's ("St John's
 * Day", "St John's wort", "St Anthony's medal").
 */
const NOT_A_PLACE =
  /^\s+(?:Day|Eve|Night|Mass|Tide|Feast|feast|day|eve|night|wort|fire|dance|mass|tide|cross|blessing|name|medal|relics?|bones|image|statue|icon|prayer|gospel|letter|epistle|creed|words|bread|cake|feast-day|fair|fast)\b/u
const WORD = String.raw`\p{Lu}[\p{L}'’-]*`
/** A word of a saint's name: no apostrophe, so "Chad's" is "Chad" and its "'s". */
const SAINT_WORD = String.raw`\p{Lu}[\p{L}-]*`
/** Words that open a sentence before a name, never part of it ("Down Mill Lane", "At the Crown Inn"). */
const LEADING = new Set(
  'the a an at in into onto on to from down up along past across through beyond toward towards over under near behind before after by with then and but so when while as outside inside she he they we it our their his her my'.split(
    ' '
  )
)

/** The kinds a name of the codex may end in: as in prose, or in small letters ("St Anne's church", "the Crown inn"). */
const kindsFor = (codex: boolean): string => (codex ? `${KINDS}|${KINDS.toLowerCase()}|${SAINT_KINDS}` : `${KINDS}|${SAINT_KINDS}`)
const saintRe = (codex: boolean): RegExp =>
  new RegExp(
    String.raw`(?<![\p{L}])(St\.?|Saint)\s+(${SAINT_WORD}(?:\s+(?!(?:${KINDS})(?![\p{L}]))${SAINT_WORD})?)(['’]s?)?(?:\s+(${kindsFor(codex)}))?(?![\p{L}])`,
    'gu'
  )
const suffixRe = (codex: boolean): RegExp =>
  new RegExp(String.raw`(?<![\p{L}])((?:${WORD})(?:\s+(?:and|&|of|on|upon|le|la|de)?\s*${WORD}){0,3})\s+(${codex ? `${KINDS}|${KINDS.toLowerCase()}` : KINDS})(?![\p{L}])`, 'gu')

/** Lower case, one kind of apostrophe, "Saint" as "st", no full stop after "St", no "the". */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bst\./g, 'st')
    .replace(/^the\s+/, '')
    .replace(/'s?$/, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The named places of a kind in a text (or a codex name: `codex`, any case for the kind word). */
function namedIn(text: string, codex = false): Named[] {
  const out: Named[] = []
  for (const m of text.matchAll(saintRe(codex))) {
    const start = m.index ?? 0
    // In prose, a saint's name is a place only with "'s" or a kind after it ("prayed to St Anthony" is the saint), and
    // never a feast, a plant or something of the saint's.
    if (!codex && ((!m[3] && !m[4]) || NOT_A_PLACE.test(text.slice(start + m[0].length)))) continue
    const partEnd = start + m[1].length + m[0].slice(m[1].length).indexOf(m[2]) + m[2].length + (m[3]?.length ?? 0)
    const part = text.slice(start, partEnd)
    out.push({ kind: 'saint', name: m[2], part, start, end: partEnd, whole: m[0] })
    if (m[4]) out.push({ kind: m[4].toLowerCase(), name: `St ${m[2]}`, part, start, end: partEnd, whole: m[0] })
  }
  for (const m of text.matchAll(suffixRe(codex))) {
    let start = m.index ?? 0
    let name = m[1]
    // A word that opens the sentence ("Down", "At") is no part of the name.
    for (;;) {
      const first = /^(\S+)\s+/.exec(name)
      if (!first || !LEADING.has(first[1].toLowerCase())) break
      start += first[0].length
      name = name.slice(first[0].length)
    }
    if (!name || /^(?:St\.?|Saint)\b/.test(name)) continue
    out.push({ kind: m[2].toLowerCase(), name, part: name, start, end: start + name.length, whole: `${name} ${m[2]}` })
  }
  return out
}

/** The kinds of name a codex place has, from its name and other names ("St Anne's church, Ashby": a saint's and a church). */
function codexKinds(p: LockPlace): Named[] {
  const out: Named[] = []
  for (const n of [p.name, ...p.aliases]) for (const part of n.split(',')) out.push(...namedIn(part.trim().replace(/^the\s+/i, ''), true))
  return out
}

/** Every slip in a text (see the top of this file). `scene`: the whole scene's words, when `text` is only part of them. */
export function placeNameSlips(text: string, ctx: PlaceNameContext, scene = text): PlaceSlip[] {
  if (!ctx.chain.length || !text.trim()) return []
  const byId = new Map(ctx.places.map((p) => [p.id, p]))
  const chain = ctx.chain.map((id) => byId.get(id)).filter((p): p is LockPlace => !!p)
  const kinds = chain.map((p) => ({ p, named: codexKinds(p) }))
  if (!kinds.some((k) => k.named.length)) return []
  // Every codex place name, whole and as a name of its kind: a name the words give that is one of these is a real place.
  const real = new Set<string>()
  for (const p of ctx.places) {
    for (const n of [p.name, ...p.aliases]) for (const part of n.split(',')) real.add(norm(part))
    for (const k of codexKinds(p)) {
      real.add(norm(k.name))
      real.add(norm(k.whole))
    }
  }
  const quotes = quoteSpans(text)
  const out: PlaceSlip[] = []
  for (const w of namedIn(text)) {
    if (quotes.some((q) => q.start <= w.start && w.start < q.end) || out.some((o) => o.start < w.end && w.start < o.end)) continue
    const said = norm(w.name)
    if (real.has(said) || real.has(norm(w.whole)) || ctx.otherNames.has(said) || ctx.otherNames.has(said.replace(/^st /, ''))) continue
    // The nearest card place with a name of this kind.
    // A street and the like only against the card's own place.
    const passed = PASSED.has(w.kind)
    const owners = kinds.filter((k, i) => (!passed || i === 0) && k.named.some((n) => n.kind === w.kind))
    if (!owners.length) continue
    const { p, named } = owners[0]
    const own = named.find((n) => n.kind === w.kind)!
    if (norm(own.name) === said) continue
    // The codex's name in the same paragraph: two places, not one named wrong.
    const paraStart = text.lastIndexOf('\n', w.start) + 1
    const paraEnd = text.indexOf('\n', w.end)
    const para = text.slice(paraStart, paraEnd < 0 ? text.length : paraEnd)
    const has = (t: string): boolean => norm(t).includes(norm(own.part))
    if (has(para)) continue
    // The codex's words, a saint's written as the words write saints ("Saint Anne's" where they say "Saint Chad's").
    const right = /^(?:St\.?|Saint)\s/.test(own.part) ? own.part.replace(/^(?:St\.?|Saint)(?=\s)/, /^Saint\s/.test(w.part) ? 'Saint' : /^St\.\s/.test(w.part) ? 'St.' : 'St') : own.part
    const words = text.slice(w.start, w.end)
    const count = (s: string): number => s.split(/\s+/).filter(Boolean).length
    const unclear = owners.length > 1 && owners.some((o) => o.named.some((n) => n.kind === w.kind && norm(n.name) !== norm(own.name)))
    const safe = !passed && !unclear && count(words) <= 3 && count(right) <= 3 && !has(scene)
    out.push({
      start: w.start,
      end: w.end,
      words,
      right,
      placeId: p.id,
      placeName: p.name,
      said: w.whole,
      safe,
      message: `This scene is at ${p.name}, but the words call it ${words}. ${words} isn’t in the codex: use ${right}?`
    })
  }
  return out
}

/** Why a slip was mended, for the page's note and the issue kept: "This scene is at St Anne's church, Ashby, so it is St Anne's, not St Chad's." */
export const placeFixWhy = (s: Pick<PlaceSlip, 'placeName' | 'right' | 'words'>): string =>
  `This scene is at ${s.placeName}, so it is ${s.right}, not ${s.words}.`
