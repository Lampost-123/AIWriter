// Directed writing's free check for "a coat already off" (Adam's spec, "Directed writing (an option)"): someone whose
// piece of clothing is off, as where things stand told the writer and as the draft's own words since have it, is made to
// use it as worn in the new stretch: pulls it tighter, buttons it, takes it off again. No AI call. Conservative, so it
// never cries wolf: only narration (never dialogue, a dream or a memory); only "her coat", "his boots" or "Wren's coat"
// right after one of a few verbs of wearing; and "her" or "his" only when the sentence opens with that person's name, or
// with "She" or "He" and just one person here goes by it. Pure.

import { isOff, sameGarment, type StageItem } from '@shared/stageItems'
import { quoteSpans } from '../checks/speakers'
import { DREAMLIKE, paragraphOf } from '../checks/rules'
import { sentencesOf } from '../storyIndex/routes'

/** Someone in the scene, with the names they go by and what they have off as the stretch begins. */
export interface Wearer {
  name: string
  names: string[]
  pronoun: 'she' | 'he' | 'they' | null
  /** Their clothing as where things stand has it (on and off). */
  clothes: StageItem[]
}

export interface ClothesSlip {
  message: string
  /** The sentence it is in. */
  quote: string
  /** Where that sentence is in the stretch. */
  start: number
  end: number
}

/** Verbs of using a piece as worn (or taking it off: it can't come off twice). */
const WORN = String.raw`(?:pull(?:s|ed)?|dr(?:ew|aws?)|tug(?:s|ged)?|wrap(?:s|ped)?|hug(?:s|ged)?|clutch(?:es|ed)?|gather(?:s|ed)?|button(?:s|ed)?|unbutton(?:s|ed)?|fasten(?:s|ed)?|unfasten(?:s|ed)?|adjust(?:s|ed)?|straighten(?:s|ed)?|smooth(?:s|ed)?|tighten(?:s|ed)?|loosen(?:s|ed)?|turn(?:s|ed)? up|t(?:ook|akes?) off|pull(?:s|ed)? off|shrug(?:s|ged)? off|slip(?:s|ped)? off|strip(?:s|ped)? off|peel(?:s|ed)? off|kick(?:s|ed)? off|remov(?:es|ed))`
/** Verbs of taking a piece off, in the draft's own words before. */
const OFF = String.raw`(?:t(?:ook|akes?)|pull(?:s|ed)?|shrug(?:s|ged)?|slip(?:s|ped)?|strip(?:s|ped)?|peel(?:s|ed)?|kick(?:s|ed)?|eas(?:es|ed)|tug(?:s|ged)?|wriggl(?:es|ed)) off|hung up|hang(?:s)? up|hung|hangs|remov(?:es|ed)|discard(?:s|ed)|dropp(?:ed)?|drops`
/** Verbs of putting a piece on again. */
const ON = String.raw`(?:put(?:s)?|pull(?:s|ed)?|dr(?:ew|aws?)|shrug(?:s|ged)?|slip(?:s|ped)?|tug(?:s|ged)?|wriggl(?:es|ed)) on`
/** Whose: a possessive word, or a name's. */
const WHOSE = String.raw`(her|his|their|[\p{Lu}][\p{L}’'-]*(?:\s[\p{Lu}][\p{L}’'-]*)?['’]s)`
/** The piece: up to three words. */
const PIECE = String.raw`((?:[\p{L}-]+\s){0,2}[\p{L}-]+)`

const re = (verbs: string, after = ''): RegExp => new RegExp(String.raw`\b(${verbs})\s+(?:the\s+)?${WHOSE}\s+${PIECE}${after}`, 'gu')

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Who a possessive in a sentence is: a name's, or "her"/"his" read from the sentence's opening. */
function ownerOf(whose: string, sentence: string, people: readonly Wearer[]): Wearer | null {
  const w = whose.toLowerCase()
  if (/['’]s$/.test(whose)) {
    const name = whose.replace(/['’]s$/, '')
    return people.find((p) => p.names.some((n) => n.toLowerCase() === name.toLowerCase())) ?? null
  }
  const pronoun = w === 'her' ? 'she' : w === 'his' ? 'he' : 'they'
  const open = sentence.replace(/^[\s“"‘']+/, '')
  // The sentence opens with someone's name: theirs, when the pronoun is theirs (or not known).
  const named = people.find((p) => p.names.some((n) => open.startsWith(n) && !/^[\p{L}]/u.test(open.slice(n.length, n.length + 1))))
  if (named) return named.pronoun === null || named.pronoun === pronoun ? named : null
  // "She …": the one person here who goes by it.
  const lead = /^(She|He|They)\b/.exec(open)?.[1]?.toLowerCase()
  if (lead !== pronoun) return null
  const by = people.filter((p) => p.pronoun === pronoun)
  return by.length === 1 ? by[0] : null
}

/** Words that end a piece's name in a phrase ("coat and hung it" is the coat). */
const ENDS = new Set('and then to on by over from in into onto off at with behind beside back up down away tighter closer round around'.split(' '))

/** A piece's own words in a phrase: up to the first word that isn't part of it; '' for none. */
function pieceWords(phrase: string): string {
  const out: string[] = []
  for (const w of clean(phrase).toLowerCase().split(' ')) {
    if (ENDS.has(w)) break
    out.push(w)
  }
  return out.join(' ')
}

/** The piece of theirs a phrase names ("coat tighter" is the coat): the longest run of its words that names one, first first. */
function pieceOf(phrase: string, clothes: readonly StageItem[]): StageItem | null {
  const words = clean(phrase).toLowerCase().split(' ')
  for (let len = words.length; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const name = words.slice(i, i + len).join(' ')
      const hit = clothes.find((c) => sameGarment(name, c))
      if (hit) return hit
    }
  }
  return null
}

/** True when `at` is inside a quotation, or in a paragraph that is a dream, a memory or a vision. */
function notNarration(text: string, at: number, quotes: readonly { start: number; end: number }[]): boolean {
  return quotes.some((q) => at >= q.start && at < q.end) || DREAMLIKE.test(paragraphOf(text, at))
}

/** Pieces taken off or put on in `text` (narration only), in order, laid over each person's clothes. */
function layOver(text: string, people: Wearer[]): Wearer[] {
  const quotes = quoteSpans(text)
  const out = people.map((p) => ({ ...p, clothes: p.clothes.map((c) => ({ ...c })) }))
  for (const s of sentencesOf(text)) {
    const sentence = text.slice(s.start, s.end)
    const moves: { at: number; off: boolean; whose: string; piece: string }[] = []
    for (const m of sentence.matchAll(re(OFF))) moves.push({ at: m.index ?? 0, off: true, whose: m[2], piece: m[3] })
    for (const m of sentence.matchAll(re(ON))) moves.push({ at: m.index ?? 0, off: false, whose: m[2], piece: m[3] })
    for (const m of sentence.matchAll(re(String.raw`(?:put(?:s)?|pull(?:s|ed)?|shrug(?:s|ged)?|slip(?:s|ped)?)`, String.raw`\s+(?:back\s+)?on\b`)))
      moves.push({ at: m.index ?? 0, off: false, whose: m[2], piece: m[3] })
    for (const mv of moves.sort((a, b) => a.at - b.at)) {
      if (notNarration(text, s.start + mv.at, quotes)) continue
      const who = ownerOf(mv.whose, sentence, out)
      if (!who) continue
      const piece = pieceOf(mv.piece, who.clothes)
      const named = pieceWords(mv.piece)
      if (piece) piece.state = mv.off ? `off${piece.state.replace(/^\s*(?:on|off)\b/i, '')}` : 'on'
      else if (mv.off && named) who.clothes.push({ name: named, state: 'off' })
    }
  }
  return out
}

/** What a piece being off says, with where it went when the record says ("off (on the peg behind the door)"). */
function offWords(piece: StageItem): string {
  const where = piece.state.replace(/^\s*off\b[\s,;:—-]*/i, '').trim()
  return where ? `off (${where})` : 'off'
}

/**
 * The stretch's slips: someone uses as worn a piece that is off. `before`: the draft's (and the scene's) words before the
 * stretch, whose own taking off and putting on count. Never throws.
 */
export function clothesSlips(stretch: string, before: string, people: readonly Wearer[]): ClothesSlip[] {
  try {
    let now = layOver(before, [...people])
    const quotes = quoteSpans(stretch)
    const out: ClothesSlip[] = []
    for (const s of sentencesOf(stretch)) {
      const sentence = stretch.slice(s.start, s.end)
      for (const m of sentence.matchAll(re(WORN))) {
        if (notNarration(stretch, s.start + (m.index ?? 0), quotes)) continue
        const who = ownerOf(m[2], sentence, now)
        const piece = who ? pieceOf(m[3], who.clothes) : null
        if (!who || !piece || !isOff(piece.state)) continue
        const did = clean(m[0])
        out.push({
          message: `${who.name}’s ${piece.name} is ${offWords(piece)}, but here: “${did}”.`,
          quote: clean(sentence),
          start: s.start,
          end: s.end
        })
      }
      // What this sentence takes off or puts on counts for the sentences after it.
      now = layOver(sentence, now)
    }
    return out
  } catch (e) {
    console.warn('Could not check the stretch for clothes already off', e)
    return []
  }
}
