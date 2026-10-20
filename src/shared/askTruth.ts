// The editor chat's truth check (Adam, 2026-10-19: "I was still getting responses from the chat claiming it had edited or
// proposed a change while it did nothing"). What an answer says it changed, proposed or made ready, read from its own
// words with no AI call, against the changes actually proposed with the tools in that answer. A claim no proposal backs
// is sent back to the model once, with the propose tool forced (ask/agent.ts recheck, ai/tasks.ts); if it still stands,
// the claim is put right in plain words before Adam sees it (honestReply). Only the answer's own words count: words in
// quotation marks (Adam's, or the scene's), questions, offers ("I'd change…", "I can change…"), conditions ("once I've
// changed it") and what the story's people did are never claims. English, as the app is. Pure.

import type { Proposal, ProposalStatus } from './contracts/ask'

/** What a claim says was changed, when its words say so clearly. */
export type ClaimTarget = 'words' | 'card' | 'beats' | 'chapterCard' | 'thread' | 'plan' | 'entry' | 'new' | 'title'

/** One thing a claim names as changed: a scene by number (in its chapter, or in the story), a chapter, a title, an entry. */
export type ClaimName = { scene: number; chapter?: number } | { chapter: number } | { title: string } | { entry: string }

/** A reword: `length` characters at `at` become `to`. */
export interface Reword {
  at: number
  length: number
  to: string
}

export interface Claim {
  /** The sentence that makes it, as written. */
  sentence: string
  /** Where that sentence is in the answer (from, to). */
  from: number
  to: number
  /** What it says was changed; null when it names nothing clearly ("Done.", "The change is ready"). */
  target: ClaimTarget | null
  /** The scenes, chapters, titles and entries its words name ("the cards for scenes 4 and 5"); none: it names none. */
  names: ClaimName[]
  /**
   * It says a change was made ("I've updated", "Done.", "the plan now reads"), which is never true of a chat (nothing
   * changes until Adam applies it); false: it says one was proposed or is ready ("I've proposed", "the change is
   * ready", a hand-over), true when a proposal backs it.
   */
  made: boolean
  /** It is about a change of an earlier answer ("as I changed earlier", "in my last answer I updated…"). */
  earlier: boolean
  /**
   * How it is put right when nothing backs it: a first-person claim is reworded as an offer ("I've updated" → "I'd
   * update"), a "now reads" or passive one as what would be; anything else (a hand-over, "Done.", a heading) goes.
   */
  fix: ({ kind: 'reword' } & Reword) | { kind: 'drop' }
  /**
   * How a claim of a change made is put right when a proposal backs it: said as waiting. `to` may hold `{ready}`, which
   * becomes "Change 1 is ready to apply" (or "Changes 1 and 2 are…"). None: it goes, and a line says what waits.
   */
  wait?: Reword
}

// ---------- The verbs of a change ----------

/** Each past form a claim uses, and its plain form for the offer that replaces it. */
const VERBS: Record<string, string> = {
  edited: 'edit',
  changed: 'change',
  updated: 'update',
  added: 'add',
  removed: 'remove',
  deleted: 'delete',
  proposed: 'propose',
  applied: 'apply',
  renamed: 'rename',
  retitled: 'retitle',
  moved: 'move',
  rewritten: 'rewrite',
  rewrote: 'rewrite',
  revised: 'revise',
  fixed: 'fix',
  corrected: 'correct',
  tightened: 'tighten',
  trimmed: 'trim',
  cut: 'cut',
  replaced: 'replace',
  inserted: 'insert',
  swapped: 'swap',
  created: 'create',
  marked: 'mark',
  linked: 'link',
  adjusted: 'adjust',
  tweaked: 'tweak',
  reworded: 'reword',
  rephrased: 'rephrase',
  shortened: 'shorten',
  lengthened: 'lengthen',
  expanded: 'expand',
  polished: 'polish',
  sharpened: 'sharpen',
  softened: 'soften',
  darkened: 'darken',
  restructured: 'restructure',
  reordered: 'reorder',
  merged: 'merge',
  revamped: 'revamp',
  reworked: 'rework',
  overhauled: 'overhaul',
  streamlined: 'streamline',
  condensed: 'condense',
  refined: 'refine',
  incorporated: 'incorporate',
  written: 'write',
  wrote: 'write',
  drafted: 'draft',
  rearranged: 'rearrange',
  shifted: 'shift',
  planned: 'plan',
  toned: 'tone',
  punched: 'punch',
  cleaned: 'clean',
  tidied: 'tidy',
  saved: 'save',
  set: 'set',
  made: 'make',
  put: 'put',
  filled: 'fill'
}
const VERB_ALT = Object.keys(VERBS).join('|')
/** Verbs that are a claim only with the words that follow them (checked in `follows`). */
const GUARDED = new Set(['set', 'made', 'put', 'filled', 'toned', 'punched', 'cleaned'])
/** Verbs that say a change was put forward, not made: true when a proposal backs them. */
const PROPOSING = new Set(['proposed'])

/** The verbs that make a passive claim ("Mara's entry has been updated"). */
const PASSIVE_LIST =
  'edited|changed|updated|added|removed|deleted|proposed|applied|renamed|retitled|moved|rewritten|revised|fixed|corrected|tightened|trimmed|replaced|inserted|swapped|reworded|rephrased|shortened|expanded|polished|saved|reworked|revamped|refined|condensed|streamlined|rearranged|drafted|written|incorporated'
const PASSIVE_ALT = `${PASSIVE_LIST}|made`
/** With "is" or "are", only the verbs that can't describe the story as it stands ("the text is written in first person"). */
const PASSIVE_IS = PASSIVE_LIST.split('|')
  .filter((v) => !['written', 'drafted', 'incorporated', 'saved', 'moved', 'added', 'linked'].includes(v))
  .join('|')

/** The app's own things, the subjects of a passive claim (a character's name changed in the story is no claim). */
const THINGS =
  'scene|scenes|chapter|chapters|entry|entries|card|cards|paragraph|paragraphs|passage|sentence|sentences|line|lines|opening|ending|title|text|draft|summary|description|field|fields|beat|beats|change|changes|edit|edits|fix|fixes|codex|wording|prose|version|dialogue|typo|typos|plan|plans|outline|goal|goals|mood|conflict|outcome|pov|thread|threads|reveal'
/** The words for a change itself ("the edit is in", "the changes are in place"). */
const CHANGE_WORDS = 'change|changes|edit|edits|fix|fixes|update|updates|revision|revisions|rewrite|rewrites'

/** "I've (also) updated", "I have rewritten", "I changed", "We've cut", "Ive updated". `I` stays a capital so "i" in a word never counts. */
const FIRST_PERSON = new RegExp(
  String.raw`(?<![\p{L}'’])(?:I|We|we)(?:['’]?ve| have)?\s+((?:(?:also|just|now|already|quickly|then|gone ahead and|went ahead and)\s+)*)(${VERB_ALT})\b`,
  'gu'
)

/** A second change after a first-person one: "I've kept your voice and tightened the opening". */
const COORD = new RegExp(
  String.raw`(?<![\p{L}'’])(?:I|We|we)(?:['’]?ve| have)\s+(?:\p{L}+\s+)?\p{L}+(?:ed|en|t)\b[^.!?\n]{0,80}?(?:\band|\bthen|,)\s+(?:also\s+)?(${VERB_ALT})\b`,
  'gu'
)

/** A list mark at a line's start, and a lead-in before what was done ("Okay — updated the plan"). */
const MARK = /^(?:[-*•]\s+|\d+[.)]\s+|#{1,6}\s+)/
const LEAD_IN = /^(?:ok(?:ay)?|alright|all right|right|sure|great|good|got it|yes|yep|perfect)\s*(?:[,!.]\s*)?(?:[—–]|--?)\s*|^(?:ok(?:ay)?|alright|sure|got it|perfect)\s*,\s+/i

const BARE_VERBS =
  'Updated|Changed|Edited|Added|Removed|Deleted|Renamed|Moved|Rewrote|Rewritten|Revised|Fixed|Corrected|Tightened|Trimmed|Replaced|Inserted|Swapped|Applied|Proposed|Reworded|Rephrased|Shortened|Expanded|Polished|Marked|Linked|Revamped|Reworked|Overhauled|Streamlined|Condensed|Refined|Incorporated|Drafted|Rearranged|Shifted|Wrote|Made'
/** A sentence that starts with what was done, as a summary of changes does ("Tightened the opening.", "- Reworded line 3"). */
const BARE_START = new RegExp(
  String.raw`^(?:\*\*)?(${BARE_VERBS})(?:\*\*)?\s+(?!by\b|up\b|over\b|with\b|from\b|for\b|in\b|to\b|into\b|at\b|as\b|and\b)(?:the|her|his|their|its|your|a|an|this|that|these|those|both|all|some|one|two|three|paragraph|line|${THINGS}|[A-Z][\p{L}'’-]*)\b(?![^.!?\n]{0,30}?\b(?:would|could|might|may|can|will|should)\b)`,
  'u'
)

/** A heading or a line that says changes were made ("## Changes made", "Plan updated.", "Updated: …", "Here's what I did:"). */
const HEAD_MADE = new RegExp(
  String.raw`^(?:\*\*|__)?\s*(?:(?:changes?|edits?|updates?|revisions?|fixes)\s+(?:made|applied|done|complete)|summary of (?:the |my )?(?:edits|changes|updates|revisions)|here(?:['’]s| is) what I (?:did|changed|updated|edited|fixed)|what I (?:did|changed)|(?:the |your )?(?:\p{L}+\s+)?(?:${THINGS})(?:\s+\d+)?\s+(?:updated|changed|edited|revised|rewritten|fixed|saved|applied|done)|updated\s+(?:the\s+|your\s+)?(?:\p{L}+\s+)?(?:${THINGS})|(?:updated|changed|edited|done)(?=\s*(?:\*\*|__)?\s*:))\s*(?:\*\*|__)?\s*(?:[:.!]+\s*|$)`,
  'iu'
)
/** A heading that hands over new parts ("Revised chapter plan:", "New scene card:"): true when a proposal backs it. */
const HEAD_HAND = new RegExp(
  String.raw`^(?:\*\*|__)?\s*(?:revised|new|edited|rewritten|reworked|improved|tightened|corrected|updated)\s+(?:\p{L}+\s+)?(?:${THINGS}|beat list|list)\s*(?:\*\*|__)?\s*(?::\s*|$)`,
  'iu'
)

/** "Mara's entry has been updated", "the beats are updated", "the opening was revised as you asked". */
const PASSIVE = [
  new RegExp(String.raw`\b(?:${THINGS})\b[^.!?\n]{0,40}?\b((?:has|have)\s+(?:now\s+|also\s+|just\s+|already\s+)?been)\s+(?:${PASSIVE_ALT})\b`, 'iu'),
  new RegExp(String.raw`\b(?:${THINGS})\b[^.!?\n]{0,40}?\b((?:is|are)\s+(?:now\s+)?)(?:${PASSIVE_IS})\b`, 'iu'),
  new RegExp(String.raw`\b(?:${THINGS})\b[^.!?\n]{0,40}?\b((?:was|were)\s+(?:now\s+)?)(?:${PASSIVE_LIST})\b(?=[^.!?\n]{0,30}\b(?:as you (?:asked|wanted|requested)|for you|per your|as requested)\b)`, 'iu')
]
/** "The edit is in.", "the changes are in place", "the fix is now live". */
const IN_PLACE = new RegExp(
  String.raw`\b(?:${CHANGE_WORDS})\b[^.!?\n]{0,30}?\b(?:is|are)\s+(?:now\s+|all\s+)?(?:in place|in(?=\s*(?:[.!,]|$))|done|live|complete|in the (?:scene|text|memory|entry|card|plan|story))\b`,
  'iu'
)

/** What "now X" becomes as what would be ("the plan now reads" → "the plan would read"). */
const NOW_VERBS: Record<string, string> = {
  reads: 'read',
  read: 'read',
  says: 'say',
  say: 'say',
  has: 'have',
  have: 'have',
  opens: 'open',
  open: 'open',
  ends: 'end',
  end: 'end',
  starts: 'start',
  start: 'start',
  includes: 'include',
  include: 'include',
  shows: 'show',
  show: 'show',
  lists: 'list',
  list: 'list',
  gives: 'give',
  names: 'name',
  describes: 'describe',
  covers: 'cover',
  focuses: 'focus',
  centers: 'center',
  centres: 'centre',
  goes: 'go',
  closes: 'close',
  begins: 'begin',
  features: 'feature',
  contains: 'contain'
}
/** "The plan now reads: …", "Beat 3 now reads…", "Your scene now opens with…", "The chapter card now has…". */
const NOW = new RegExp(String.raw`\b(?:${THINGS})\b(?:\s+\d+)?[^.!?\n]{0,40}?\b(now\s+(${Object.keys(NOW_VERBS).join('|')}))\b`, 'iu')

/** "The change is ready", "2 changes are waiting for you", "ready to apply". */
const READY = new RegExp(
  String.raw`\b(?:changes?|edits?|fix|fixes|rewrite|rewrites|proposals?)\b[^.!?\n]{0,30}?\b(?:is|are)\s+(?:now\s+)?(?:ready|waiting)\b|\bready (?:for you )?to (?:apply|be applied)\b|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:changes?|edits?) (?:is |are )?(?:ready|waiting)\b`,
  'iu'
)

/** "Done —", "All done,", "There you go:" before a first-person claim in the same sentence. */
const DONE_BEFORE = /^(?:\*\*)?(?:done|all done|there you go|there we go|all set|sorted|finished)(?:\*\*)?\s*(?:[,:—–]|--?)\s*$/iu

/** "Done.", "All done!", "There you go —" at the start of the answer or of a line. */
const DONE = /^(?:\*\*)?(?:done|all done|there you go|there we go|all set|sorted|finished)\b(?:\*\*)?\s*(?:[.!:,—–-]|$)/iu

/**
 * The older hand-over claims (shared/askChanges.ts CLAIMS: "apply the changes below", "here's the revised paragraph",
 * "copy these in"): changes handed to Adam to do by hand, or words said to be new.
 */
const HANDOVER = [
  /\b(apply|accept|approve)\s+(the|these|this|those|my|all|both|each)\s+(changes?|edits?|fix(es)?|corrections?|revisions?|rewrites?|suggestions?)\b/i,
  /\b(changes?|edits?|fix(es)?|corrections?|revisions?)\s+(below|above)\b/i,
  /\bproposed\s+(changes?|edits?|fix(es)?|corrections?|revisions?)\b/i,
  /\b(apply|use|take|keep)\s+(what(ever)?|which(ever)?|any|the ones?)\s+(you|of)\b/i,
  /\b(copy|paste|swap|drop)\s+(it|them|this|these|those|that)\s+(in|into|over)\b/i,
  /\bhere(?:['’]s| is)\s+(the|a|your|my)\s+(revised|edited|corrected|rewritten|updated|tightened|fixed|new|cleaner|polished|reworked)\s+(?:(?:scene|chapter|beat)\s+)?(version|paragraph|passage|scene|text|opening|ending|line|draft|plan|outline|card|beats|list|goal|entry|summary|sheet)\b/i
]

/** Words before "I" that make it a condition or an offer, not a claim ("once I've changed it", "if I cut that"). */
const CONDITION = /\b(?:if|once|when|whenever|unless|whether|until|after|before|so that|in case|what if|should|would|could)\s+(?:\S+\s+){0,2}$/i
/** A sentence about an earlier answer ("as I changed earlier", "in my last answer"): checked against what Adam did with it. */
const EARLIER =
  /\b(?:in my (?:last|previous|earlier|first) (?:answer|reply|message|response)|earlier in (?:our|this) (?:talk|chat|conversation)|(?:as|what) (?:I|we) (?:\S+\s+){0,3}?(?:earlier|before|previously|last time)\b|last time\b)|^\s*(?:earlier|previously)\s*,?\s+(?:I|we)\b/i
/** A sentence about what the writer did is no claim of the chat's ("you applied it", "you've updated her entry"). */
const WRITER_DID = /\byou(?:['’]ve| have)?\s+(?:just\s+|already\s+)?(?:applied|accepted|changed|edited|updated)\b/i
/** What follows a verb that says nothing was changed ("I've changed nothing", "I've changed my mind"). */
const NOTHING = /^\s*(?:nothing|no\b|none\b|anything\b|my mind\b)/i

/**
 * "made" a thing of the story into something ("I made the first chapter a betrayal", "I've made the opening punchier",
 * "I've made scene 3 darker"): a determiner (or a scene, chapter or beat by number), one of the app's things, then what
 * it became. Never "made a note", "made sure", "made up", "made the opening line." (nothing it became), nor "made the
 * scene for you" (a word like "for" or "you" after the thing).
 */
const MADE_INTO = new RegExp(
  String.raw`^\s*(?:(?:the|a|an|your|this|that|these|those|its|her|his|their)\s+(?:\p{L}+\s+){0,2}?(?:${THINGS})(?:['’]s\s+\p{L}+)?|(?:scene|chapter|beat|line|paragraph)\s+\d+)\s+(?!(?:of|for|with|in|on|at|to|from|about|by|that|which|who|when|where|while|and|but|so|as|because|I|you|we|he|she|they|it|is|was|were|are|${THINGS})\b)\p{L}`,
  'iu'
)

/** True when a guarded verb is followed by the words that make it a change ("made the change", "set her age to"). */
function follows(verb: string, after: string): boolean {
  switch (verb.toLowerCase()) {
    case 'set':
      return (
        /^[^.;!?\n]{0,60}\bto\b/.test(after) ||
        /^\s*(?:the|her|his|their|its|your|a|an|this|that)\s+(?:\p{L}+\s+){0,2}?(?:goal|mood|conflict|outcome|beats?|card|pov|point of view|when|notes|title|length|target|word count|location|age|field)\b/iu.test(after)
      )
    case 'made':
      return (
        /^\s*(?:the|these|this|that|those|some|a few|a couple of|your|a|an|one|two|three|four|several|all the|both)\s+(?:\w+\s+)?(?:change|changes|edit|edits|fix|fixes|update|updates|corrections?|adjustments?|tweaks?|revisions?|cuts?)\b/i.test(after) ||
        MADE_INTO.test(after)
      )
    case 'put':
      return /^[^.;!?\n]{0,50}\b(?:in|into)\b/.test(after)
    case 'filled':
      return /^\s*in\b/.test(after)
    case 'toned':
      return /^\s*down\b/.test(after)
    case 'punched':
    case 'cleaned':
      return /^\s*up\b/.test(after)
    default:
      return true
  }
}

// ---------- Reading an answer ----------

/** The answer with quoted words blanked out (the same length, so places stay): “…”, "…", «…», `…`, and > quote lines. */
export function withoutQuotes(text: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return text
    .replace(/^>.*$/gm, blank)
    .replace(/“[^”\n]*”|«[^»\n]*»|`[^`\n]*`/g, blank)
    .replace(/(^|[\s(:—–-])"[^"\n]*"/g, (m, lead: string) => lead + blank(m.slice(lead.length)))
}

/** The answer's sentences, with where each is: split at . ! ? before a space or the end, and at line ends. */
function sentencesOf(text: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const line of text.matchAll(/[^\n]+/g)) {
    const start = line.index ?? 0
    const s = line[0]
    let from = 0
    for (const m of s.matchAll(/[.!?]+["”’')\]*]*(?=\s|$)/g)) {
      const at = (m.index ?? 0) + m[0].length
      // A full stop after a short abbreviation (Ch. 2, Sc. 1, e.g.) doesn't end the sentence.
      const before = s.slice(Math.max(0, (m.index ?? 0) - 4), m.index ?? 0)
      if (m[0].startsWith('.') && /(?:^|\s)(?:Ch|Sc|e\.g|i\.e|Mr|Mrs|Ms|Dr|St|vs)$/i.test(before)) continue
      if (s.slice(from, at).trim()) out.push({ from: start + from, to: start + at })
      from = at
    }
    if (s.slice(from).trim()) out.push({ from: start + from, to: start + s.length })
  }
  return out
}

/** What a claim's words name as changed: the words after its verb, up to the clause's end. */
export function targetOf(verb: string, after: string): ClaimTarget | null {
  const clause = after.split(/[.;:!?\n]|\s(?:and|but|so|because|which)\s/)[0].slice(0, 90).toLowerCase()
  const v = verb.toLowerCase()
  if (/^(renamed|retitled)$/.test(v) || /\b(title|titles|retitled)\b/.test(clause)) return 'title'
  if (/^(added|created)$/.test(v) && /\b(new|an? (character|place|group|item|entry|lore|event|chapter|scene))\b/.test(clause)) return 'new'
  if (/\b(entry|entries|memory|codex|field|fields|profile|aliases?|description|eye colou?r)\b|['’]s (eyes|hair|age|eye|colour|color|role|pronouns)\b/.test(clause)) return 'entry'
  // A chapter's own card, plan, goal or length ("chapter 3's goal", "the length of Ch 3"), never a scene in it.
  if (
    /\b(?:chapter|ch)\.?(?:\s*\d+)?(?:['’]s)?\s+(?:card|plan|goal|length|target|outline|summary)s?\b|\b(?:length|word) target\b/.test(clause) ||
    /\b(?:card|plan|goal|length|target|word count)s? (?:of|for) (?:the )?(?:chapter|ch)\b(?!\.?\s*\d+\s*,?\s*(?:scene|sc)\b)/.test(clause)
  )
    return 'chapterCard'
  if (/\b(?:plot )?threads?\b/.test(clause)) return 'thread'
  if (/\b(cards?|goal|mood|pov|point of view|conflict|outcome)\b/.test(clause)) return 'card'
  if (/\b(beats?|beat list)\b/.test(clause)) return 'beats'
  if (v === 'planned' || /\b(plan|plans|outline)\b/.test(clause)) return 'plan'
  if (/\bsummary\b/.test(clause)) return 'entry'
  if (/\b(paragraphs?|sentences?|lines?|passages?|openings?|endings?|dialogue|prose|wording|text|scene|words?|typos?|spelling|punctuation|verbs?|adjectives?|it|them|that|this)\b/.test(clause)) return 'words'
  return null
}

const NUMBERS = String.raw`\d+(?:(?:\s*,\s*|\s+and\s+|\s*&\s*|\s+or\s+|\s*(?:-|–|to)\s*)\d+)*`

/** What a claim's words name (scenes and chapters by number or title, entries by name), read from `text` (as written). */
export function namesIn(text: string): ClaimName[] {
  const out: ClaimName[] = []
  const nums = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number)
  let rest = text
  for (const m of text.matchAll(/\b(?:chapter|ch)\.?\s*(\d+)\s*,?\s*(?:scene|sc)\.?\s*(\d+)\b/giu)) {
    out.push({ scene: Number(m[2]), chapter: Number(m[1]) })
    rest = rest.replace(m[0], ' ')
  }
  for (const m of rest.matchAll(new RegExp(String.raw`\b(?:scenes?|sc)\.?\s+(${NUMBERS})\b`, 'giu'))) for (const n of nums(m[1])) out.push({ scene: n })
  for (const m of rest.matchAll(new RegExp(String.raw`\b(?:chapters?|ch)\.?\s+(${NUMBERS})\b`, 'giu'))) for (const n of nums(m[1])) out.push({ chapter: n })
  for (const m of text.matchAll(/\b(?:scene|chapter)\s+(?:called\s+|titled\s+)?[“"]([^”"\n]{1,80})[”"]/giu)) out.push({ title: m[1].trim() })
  const NAME = String.raw`([A-Z][\p{L}-]+(?:\s+[A-Z][\p{L}-]+)?)`
  for (const m of text.matchAll(new RegExp(String.raw`${NAME}['’]s\s+(?:entry|profile|memory|eyes|hair|age|role|pronouns|summary|description|aliases|eye colou?r|hair colou?r|backstory|history|fields?)\b`, 'gu')))
    if (!/^(?:The|This|That|Scene|Chapter|Your|My|Her|His)\b/.test(m[1])) out.push({ entry: m[1] })
  for (const m of text.matchAll(new RegExp(String.raw`\bentry\s+(?:for|on|about)\s+${NAME}`, 'gu'))) out.push({ entry: m[1] })
  return out
}

/** The words a claim's names are read from: after its verb to the clause's end (lists of numbers kept whole). */
const clauseOf = (after: string): string =>
  after.split(/[.;!?\n]|,?\s(?:but|so|because|which|while|since)\s|,?\s(?:and\s+|then\s+)?(?:I|we|We)(?:['’]?ve| have)?\s/)[0].slice(0, 120)

/** Each claim of a change in an answer, in order. */
export function changeClaims(answer: string): Claim[] {
  const masked = withoutQuotes(answer)
  const out: Claim[] = []
  for (const { from, to } of sentencesOf(masked)) {
    const s = masked.slice(from, to)
    const trimmed = s.trim()
    if (!trimmed || /\?["”’')\]*]*\s*$/.test(trimmed) || WRITER_DID.test(s)) continue
    const earlier = EARLIER.test(s)
    const written = answer.slice(from, to)
    const make = (target: ClaimTarget | null, names: ClaimName[], made: boolean, fix: Claim['fix'], wait?: Reword): Claim => ({
      sentence: written.trim(),
      from,
      to,
      target,
      names,
      made,
      earlier,
      fix,
      ...(wait ? { wait } : {})
    })
    const lead = s.length - s.trimStart().length
    const markLen = MARK.exec(trimmed)?.[0].length ?? 0
    // Every first-person claim in the sentence: "I've tightened the opening and I've updated Mara's entry".
    const mine: Claim[] = []
    for (const m of s.matchAll(FIRST_PERSON)) {
      const at = m.index ?? 0
      const verb = m[2]
      const after = s.slice(at + m[0].length)
      if (CONDITION.test(s.slice(0, at)) || NOTHING.test(after) || !follows(verb, after)) continue
      const adverbs = (m[1] ?? '').replace(/\b(?:gone|went) ahead and\s+/g, '')
      const offer = `I’d ${adverbs}${VERBS[verb]}`
      // "Done — I've updated…": the "Done" before it goes with the claim, or it would still say the change was made.
      const head = lead + markLen
      const at0 = at > head && DONE_BEFORE.test(s.slice(head, at)) ? head : at
      const len = m[0].length + (at - at0)
      // At the sentence's start (a list mark aside), a backed claim is said as waiting: "Change 1 is ready to apply: cut…".
      const starts = at0 <= head
      const names = namesIn(clauseOf(written.slice(at + m[0].length)))
      mine.push(
        make(targetOf(verb, after), names, !PROPOSING.has(verb), { kind: 'reword', at: from + at0, length: len, to: offer }, {
          at: from + at0,
          length: len,
          to: starts ? `{ready}: ${VERBS[verb]}` : offer
        })
      )
    }
    // A second verb after a first-person one: "I've kept your voice and tightened the opening".
    if (!mine.length) {
      for (const m of s.matchAll(COORD)) {
        const at = m.index ?? 0
        const verbAt = at + m[0].length - m[1].length
        const after = s.slice(verbAt + m[1].length)
        if (CONDITION.test(s.slice(0, at)) || NOTHING.test(after) || GUARDED.has(m[1])) continue
        const fix = { at: from + verbAt, length: m[1].length, to: `would ${VERBS[m[1]]}` }
        mine.push(make(targetOf(m[1], after), namesIn(clauseOf(written.slice(verbAt + m[1].length))), !PROPOSING.has(m[1]), { kind: 'reword', ...fix }, fix))
      }
    }
    if (mine.length) {
      out.push(...mine)
      continue
    }
    const names = namesIn(written)
    // A heading that says changes were made, or hands over new parts; what follows it on the line is read on.
    let body = trimmed.slice(markLen)
    let bodyAt = lead + markLen
    const head = HEAD_MADE.exec(body) ?? HEAD_HAND.exec(body)
    if (head) {
      const made = HEAD_MADE.test(body)
      const rest = body.slice(head[0].length)
      const fix: Claim['fix'] = rest.trim() ? { kind: 'reword', at: from + bodyAt, length: head[0].length, to: '' } : { kind: 'drop' }
      out.push(make(targetOf('updated', body), names, made, fix, fix.kind === 'reword' ? { at: fix.at, length: fix.length, to: '' } : undefined))
      if (!rest.trim()) continue
      bodyAt += head[0].length
      body = rest
    }
    // A lead-in before a summary line: "Okay — updated the chapter plan."
    const leadIn = LEAD_IN.exec(body)?.[0].length ?? 0
    const plain = body.slice(leadIn)
    let found: Claim | null = null
    // A summary line: "Tightened the opening.", "- Reworded paragraph 3", "Okay — updated the plan".
    const bare = BARE_START.exec(plain.charAt(0).toUpperCase() + plain.slice(1))
    if (bare) {
      const verb = bare[1].toLowerCase()
      const verbAt = plain.toLowerCase().indexOf(verb)
      const after = plain.slice(verbAt + verb.length)
      if (follows(verb, after)) {
        const at = from + bodyAt + leadIn + verbAt
        const p = VERBS[verb] ?? verb
        found = make(targetOf(verb, after), names, !PROPOSING.has(verb), { kind: 'drop' }, { at, length: verb.length, to: p.charAt(0).toUpperCase() + p.slice(1) })
      }
    }
    // "The plan now reads: …": said as what would be.
    if (!found) {
      const m = NOW.exec(s)
      if (m && !CONDITION.test(s.slice(0, m.index))) {
        const at = from + (m.index ?? 0) + m[0].length - m[1].length
        const fix = { at, length: m[1].length, to: `would ${NOW_VERBS[m[2].toLowerCase()]}` }
        found = make(targetOf('changed', s.slice(m.index)), names, true, { kind: 'reword', ...fix }, fix)
      }
    }
    // Passive: "Mara's entry has been updated", "the beats are updated", "revised as you asked".
    if (!found) {
      for (const re of PASSIVE) {
        const m = re.exec(s)
        if (!m || CONDITION.test(s.slice(0, m.index))) continue
        const at = from + (m.index ?? 0) + m[0].lastIndexOf(m[1])
        const fix = { at, length: m[1].replace(/\s+$/, '').length, to: 'would be' }
        found = make(targetOf('changed', s.slice(m.index)), names, !/\bproposed\b/i.test(m[0]), { kind: 'reword', ...fix }, fix)
        break
      }
    }
    // "The edit is in", "the changes are in place".
    if (!found && IN_PLACE.test(s) && !CONDITION.test(s)) found = make(null, names, true, { kind: 'drop' })
    // "Done." at the start of a line.
    const lineStart = from === 0 || masked[from - 1] === '\n'
    if (!found && lineStart && DONE.test(trimmed.slice(markLen))) found = make(null, [], true, { kind: 'drop' })
    // "The change is ready" and the hand-overs.
    if (!found && (READY.test(trimmed) || HANDOVER.some((re) => re.test(s)))) found = make(null, names, false, { kind: 'drop' })
    if (found) out.push(found)
  }
  return out
}

// ---------- Against what was proposed ----------

/**
 * What a proposal changes, as the truth check compares it with a claim: its kind, and the scenes (by chapter and
 * number, in the story, and title), chapters, entries and titles it changes. `status`: what Adam made of it (earlier
 * answers' proposals).
 */
export interface ChangeTarget {
  kind: Proposal['kind']
  id?: string
  how?: string
  status?: ProposalStatus
  scenes?: { chapter?: number; scene?: number; inStory?: number; title?: string }[]
  chapters?: { n?: number; title?: string }[]
  entries?: string[]
  titles?: string[]
}

/** A proposal, or the light list of what it changes (ChangeTarget), or only its kind. */
export type Proposed = Pick<Proposal, 'kind'> & { id?: string; how?: string; status?: ProposalStatus }

/** "Ch 2, Sc 1 “The Ford”" read back. */
function sceneOfLabel(label: unknown): NonNullable<ChangeTarget['scenes']>[number] | null {
  if (typeof label !== 'string') return null
  const m = /\bCh\s*(\d+),\s*Sc\s*(\d+)(?:\s*[“"](.+?)[”"])?/.exec(label)
  return m ? { chapter: Number(m[1]), scene: Number(m[2]), ...(m[3] ? { title: m[3] } : {}) } : null
}

/** "Ch 3 “Low Water”" read back. */
function chapterOfLabel(label: unknown): NonNullable<ChangeTarget['chapters']>[number] | null {
  if (typeof label !== 'string') return null
  const m = /\bCh\s*(\d+)(?:\s*[“"](.+?)[”"])?/.exec(label)
  return m ? { n: Number(m[1]), ...(m[2] ? { title: m[2] } : {}) } : null
}

/** What a proposal changes, read from its own fields and labels (a ChangeTarget is kept as it is). */
export function changeTarget(p: Proposed | ChangeTarget): ChangeTarget {
  if ('scenes' in p || 'chapters' in p || 'entries' in p || 'titles' in p) return p as ChangeTarget
  const r = p as Record<string, unknown>
  const t: ChangeTarget = { kind: p.kind, ...(p.id ? { id: p.id } : {}), ...(p.how ? { how: p.how } : {}), ...(p.status ? { status: p.status } : {}) }
  const scene = sceneOfLabel(r.sceneLabel)
  const chapter = chapterOfLabel(r.chapterLabel)
  const entries: string[] = []
  const titles: string[] = []
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  if (p.kind === 'entry' || p.kind === 'newEntry') entries.push(str(r.name) ?? '')
  if (p.kind === 'thread') entries.push(str(r.name) ?? '')
  if (p.kind === 'issueFix') entries.push(str((r.memory as { name?: unknown } | undefined)?.name) ?? '')
  if (p.kind === 'replaceAll') entries.push(str((r.rename as { name?: unknown } | null | undefined)?.name) ?? '')
  if (p.kind === 'rename') titles.push(str(r.from) ?? '', str(r.to) ?? '')
  if (p.kind === 'newScene' || p.kind === 'newChapter') titles.push(str(r.title) ?? '')
  if (scene) t.scenes = [scene]
  if (chapter) t.chapters = [chapter]
  if (entries.some(Boolean)) t.entries = entries.filter(Boolean)
  if (titles.some(Boolean)) t.titles = titles.filter(Boolean)
  return t
}

/** What a proposal changes, in the groups claims name. */
export function groupsOf(p: Pick<Proposal, 'kind'> & { how?: string }): ClaimTarget[] {
  switch (p.kind) {
    case 'text':
    case 'passage':
    case 'insert':
    case 'cut':
    case 'replaceAll':
    case 'draft':
      return ['words']
    case 'issueFix':
      return p.how === 'memory' ? ['entry'] : ['words']
    case 'card':
      return ['card']
    case 'beats':
      return ['beats']
    case 'chapterCard':
      return ['chapterCard']
    case 'thread':
      return ['thread']
    case 'entry':
      return ['entry']
    case 'newEntry':
      return ['new', 'entry']
    case 'newScene':
    case 'newChapter':
      return ['new']
    case 'rename':
      return ['title']
    default:
      return []
  }
}

/** The kinds of proposal that back a claim naming each target ("the plan" is any change to the plan). */
const BACKERS: Record<ClaimTarget, ClaimTarget[]> = {
  words: ['words'],
  entry: ['entry'],
  new: ['new'],
  title: ['title'],
  card: ['card', 'beats'],
  beats: ['beats', 'card'],
  chapterCard: ['chapterCard'],
  thread: ['thread'],
  plan: ['card', 'beats', 'chapterCard', 'thread', 'new', 'title']
}

const lowerName = (s: string): string => s.trim().toLocaleLowerCase()
/** "Mara" names "Mara Venn" (and the other way round). */
const sameName = (a: string, b: string): boolean => {
  const x = lowerName(a)
  const y = lowerName(b)
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)
}

/** True when a proposal changes what a name names. */
function namesMatch(n: ClaimName, t: ChangeTarget): boolean {
  // A proposal known only by its kind (no labels) can't say otherwise.
  if (!t.scenes && !t.chapters && !t.entries && !t.titles) return true
  if ('scene' in n) return (t.scenes ?? []).some((s) => (s.scene === n.scene || s.inStory === n.scene) && (n.chapter == null || s.chapter === n.chapter))
  if ('chapter' in n) return (t.chapters ?? []).some((c) => c.n === n.chapter) || (t.scenes ?? []).some((s) => s.chapter === n.chapter)
  if ('title' in n)
    return [...(t.scenes ?? []).map((s) => s.title), ...(t.chapters ?? []).map((c) => c.title), ...(t.titles ?? [])].some((x) => !!x && lowerName(x) === lowerName(n.title))
  return (t.entries ?? []).some((e) => sameName(e, n.entry))
}

/** The proposals that back a claim: of a kind its words name (any, when it names none), and every name it gives. */
function backersOf(c: Claim, targets: ChangeTarget[]): ChangeTarget[] {
  const kinds = c.target ? BACKERS[c.target] : null
  const of = targets.filter((t) => !kinds || groupsOf(t).some((g) => kinds.includes(g)))
  // Entries a claim names count for a change to the memory; words, cards and plans are matched by scene and chapter.
  const names = c.names.filter((n) => !('entry' in n) || c.target === 'entry' || c.target === 'new' || c.target === 'thread')
  if (!names.length) return of
  return names.every((n) => of.some((t) => namesMatch(n, t))) ? of.filter((t) => names.some((n) => namesMatch(n, t))) : []
}

/** A claim, and whether what was proposed (or, for one about an earlier answer, what Adam applied) backs it. */
export interface CheckedClaim {
  claim: Claim
  ok: boolean
  /** The ids of the proposals that back it (this answer's). */
  ids: string[]
  /** A claim about an earlier change that doesn't stand: whether that change waits or was turned down. */
  earlierWas?: 'pending' | 'declined'
}

/**
 * Each claim of an answer against what was proposed. A claim of this answer is backed by a proposal of the kind it
 * names, changing what it names (scene, chapter, entry), or by any proposal when it names nothing. A claim about an
 * earlier answer's change is backed only when that change was applied (`earlier`, with each one's status); with no
 * earlier answers given it is left be.
 */
export function checkClaims(answer: string, proposals: readonly Proposed[], earlier?: readonly Proposed[]): CheckedClaim[] {
  const targets = proposals.map(changeTarget)
  const before = earlier?.map(changeTarget)
  const out: CheckedClaim[] = []
  for (const claim of changeClaims(answer)) {
    if (claim.earlier) {
      if (!before) continue
      const like = backersOf(claim, before)
      const ok = like.some((t) => t.status === 'applied')
      out.push({ claim, ok, ids: [], ...(ok ? {} : { earlierWas: like.length && like.every((t) => t.status === 'declined') ? 'declined' : 'pending' }) })
      continue
    }
    if (!targets.length) {
      out.push({ claim, ok: false, ids: [] })
      continue
    }
    const by = backersOf(claim, targets)
    out.push({ claim, ok: by.length > 0, ids: by.flatMap((t) => (t.id ? [t.id] : [])) })
  }
  return out
}

/**
 * The claims nothing backs: every claim when nothing was proposed; else those naming a kind of change (an entry, a
 * scene card, beats, a chapter card, a title, something new, words) or a scene, chapter or entry none of the proposals
 * is. A claim that names nothing is backed by any proposal. Claims about an earlier answer count only given `earlier`.
 */
export function unbackedClaims(answer: string, proposals: readonly Proposed[], earlier?: readonly Proposed[]): Claim[] {
  return checkClaims(answer, proposals, earlier)
    .filter((c) => !c.ok)
    .map((c) => c.claim)
}

/** True when an answer claims a change no proposal of its backs. */
export const claimsUnmade = (answer: string, proposals: readonly Proposed[], earlier?: readonly Proposed[]): boolean =>
  unbackedClaims(answer, proposals, earlier).length > 0

// ---------- Putting it right ----------

/** A claim's sentence, short, for the note sent back to the model. */
export const claimWords = (c: Claim): string => {
  const s = c.sentence.replace(/\s+/g, ' ').trim()
  return s.length > 140 ? `${s.slice(0, 137).replace(/\s+\S*$/, '')}…` : s
}

const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** "1", "1 and 2", "1, 2 and 3". */
const andList = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** "Change 1 is ready to apply", "Changes 1 and 2 are ready to apply". */
const readyWords = (ids: string[]): string =>
  ids.length === 1 ? `Change ${ids[0]} is ready to apply` : ids.length ? `Changes ${andList(ids)} are ready to apply` : 'The change is ready to apply'

/** How every answer put right by honestReply starts, when nothing was proposed (the window and the tests know it by this). */
export const NO_CHANGE_LEAD = 'No change was made'

/** Words that already say a change waits: no line is added to say it again. */
const SAYS_WAITING = /\bready to apply\b|\bwaiting for you\b|\bpress apply\b/i

/**
 * The answer with every unbacked claim put right, never shown as made: a first-person claim becomes an offer ("I'd
 * update…"), a hand-over or "Done." goes, and a plain line leads: "No change was made" (with why, when a tool turned the
 * change down: `failure`, in plain words) and "Here's what I'd suggest:" before what is left; with some changes
 * proposed, which ones are ready and that nothing else was changed. `backed`: claims a proposal backs that still say
 * the change was made, said as waiting ("Change 1 is ready to apply: tighten…"). A claim about an earlier change that
 * was never applied (`earlierWas`) says what was done instead ("As I suggested earlier"), with a line saying so.
 */
export function honestReply(
  answer: string,
  claims: Claim[],
  o: {
    proposed: string[]
    failure?: string | null
    backed?: { claim: Claim; ids: string[] }[]
    earlierWas?: 'pending' | 'declined' | null
    /** The words on the button that makes the change ("Make this change" on the Plan hub); Apply when not given. */
    applyLabel?: string
  }
): string {
  const backed = o.backed ?? []
  if (!claims.length && !backed.length) return answer
  type Edit = { at: number; length: number; to: string } | { drop: Claim }
  const edits: Edit[] = []
  for (const c of claims) {
    if (c.fix.kind === 'drop') edits.push({ drop: c })
    else if (c.earlier) {
      const said = answer.slice(c.fix.at, c.fix.at + c.fix.length)
      edits.push({ at: c.fix.at, length: c.fix.length, to: /^I\b|^we\b/i.test(said) ? said.replace(/\S+$/, 'suggested') : c.fix.to })
    } else edits.push({ at: c.fix.at, length: c.fix.length, to: c.fix.to })
  }
  for (const { claim: c, ids } of backed) {
    if (!c.wait) edits.push({ drop: c })
    else edits.push({ ...c.wait, to: c.wait.to.replace('{ready}', readyWords(ids.length ? ids : o.proposed)) })
  }
  const place = (e: Edit): number => ('drop' in e ? e.drop.from : e.at)
  let text = answer
  for (const e of [...edits].sort((a, b) => place(b) - place(a))) {
    if (!('drop' in e)) {
      text = text.slice(0, e.at) + e.to + text.slice(e.at + e.length)
      // A heading taken off the front of a line: what is left on it starts with a capital.
      if (!e.to && /^\s*(?:[-*•]|\d+[.)]|#{1,6})?[\s*_]*$/.test(text.slice(text.lastIndexOf('\n', e.at - 1) + 1, e.at))) {
        const i = e.at + (/^[ \t]*/.exec(text.slice(e.at))?.[0].length ?? 0)
        text = text.slice(0, i) + text.charAt(i).toUpperCase() + text.slice(i + 1)
      }
      continue
    }
    // The sentence goes, with the space after it; a list item or line that held only it goes too.
    const c = e.drop
    let end = c.to
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++
    let start = c.from
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    if (/^\s*(?:[-*•]|\d+[.)])?\s*$/.test(text.slice(lineStart, start))) start = lineStart
    text = text.slice(0, start) + text.slice(end)
  }
  const rest = text
    .split('\n')
    .filter((l) => !/^\s*(?:[-*•]|\d+[.)]|#{1,6})\s*$/.test(l))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const reason = o.failure?.trim().replace(/[.!]+$/, '')
  const now = claims.filter((c) => !c.earlier)
  const leads: string[] = []
  if (now.length && !o.proposed.length) {
    let lead = reason ? `${NO_CHANGE_LEAD}: I couldn’t make it because ${reason}.` : `${NO_CHANGE_LEAD}, so there’s nothing to apply.`
    if (rest) lead += ' Here’s what I’d suggest:'
    leads.push(lead)
  } else if (now.length) {
    const n = o.proposed.length
    const which = n === 1 ? `change ${o.proposed[0]} is` : `${NUMBER[n] ?? n} changes (${o.proposed.join(', ')}) are`
    leads.push(`Only ${which} ready to apply; nothing else was changed${reason ? `: ${reason}` : ''}.`)
  } else if (backed.length && !SAYS_WAITING.test(rest)) {
    leads.push(`${readyWords(o.proposed)}. Nothing changes until you press ${o.applyLabel ?? 'Apply'}.`)
  }
  if (claims.some((c) => c.earlier)) leads.push(`That earlier change isn’t in the story: ${o.earlierWas === 'declined' ? 'it was turned down' : 'it hasn’t been applied'}.`)
  const lead = leads.join(' ')
  return rest ? (lead ? `${lead}\n\n${rest}` : rest) : lead
}

/**
 * The answer as Adam sees it: every claim put right (shared by every chat). A claim nothing backs is put right as
 * honestReply does; a claim a proposal backs that says the change was made is said as waiting, since nothing in a
 * chat is applied by the AI; a claim about an earlier change stands only when Adam applied it (`earlier`: the earlier
 * answers' proposals, with their status). `failure`: why the last proposal was turned down, in plain words.
 */
export function settleAnswer(
  answer: string,
  proposals: readonly Proposed[],
  o: { failure?: string | null; earlier?: readonly Proposed[]; applyLabel?: string } = {}
): string {
  const checked = checkClaims(answer, proposals, o.earlier)
  const bad = checked.filter((c) => !c.ok)
  const backed = checked.filter((c) => c.ok && c.claim.made && !c.claim.earlier)
  if (!bad.length && !backed.length) return answer
  const proposed = proposals.map((p, i) => p.id ?? String(i + 1))
  const earlierWas = bad.find((c) => c.earlierWas)?.earlierWas ?? null
  return honestReply(
    answer,
    bad.map((c) => c.claim),
    { proposed, failure: o.failure ?? null, backed: backed.map((c) => ({ claim: c.claim, ids: c.ids })), earlierWas, applyLabel: o.applyLabel }
  )
}

// ---------- Why a change wasn't made, in Adam's words ----------

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * Why a proposal was turned down, for Adam: the check's message to the model (which names tools and fields) said as a
 * reason he can read ("the words it meant to change aren't in the scene as written"). One clause, no full stop.
 */
export function writerReason(message: string): string {
  // A propose_changes result names each item: "2. entry: Not proposed. “Eye colour” isn't one of…".
  const item = /^\d+\.\s*[\w_]+:\s*Not proposed\.?\s*(.+)$/m.exec(message)
  const m = (item ? item[1] : message.replace(/^Not proposed(?: \(\w+\))?[:.]?\s*(?:nothing is waiting for the writer\.)?\s*/i, '')).trim()
  const rules: [RegExp, (x: RegExpExecArray) => string][] = [
    [/^Those words are not in the scene as written/i, () => 'the words it meant to change aren’t in the scene as written'],
    [/^The `?(start|end)`? words are not in the scene/i, () => 'the passage it meant to rewrite isn’t in the scene as written'],
    [/occur more than once|occurs? \d+ times/i, () => 'the words it meant to change come up more than once in the scene'],
    [/^[“"](.+?)[”"] isn['’]t one of (.+?)['’]s fields/i, (x) => `${x[2]} has no “${x[1]}” field`],
    [/^There is no entry called [“"](.+?)[”"]/i, (x) => `there’s no entry called “${x[1]}” in this story’s memory`],
    [/^There is no (character|place|group|item|lore|event|thread|plot thread) called [“"](.+?)[”"]/i, (x) => `there’s no ${x[1]} called “${x[2]}” in this story’s memory`],
    [/^There is no scene [“"](.+?)[”"]/i, (x) => `there’s no scene called “${x[1]}” in this story`],
    [/^There is no chapter [“"](.+?)[”"]/i, (x) => `there’s no chapter called “${x[1]}” in this story`],
    [/^[“"](.+?)[”"] fits more than one entry/i, (x) => `“${x[1]}” could mean more than one entry`],
    [/^(.+?) (?:is|was) (?:from|known|only).*?can['’]t be changed from (?:this story|here)/i, (x) => `${x[1]} isn’t in this story so far, so it can’t be changed from here`],
    [/^That scene is in (.+?)\./i, (x) => `that scene is in ${x[1]}, not this story`],
    [/^No scene is open/i, () => 'no scene is open'],
    [/^No story is open/i, () => 'no story is open'],
    [/^That scene no longer exists/i, () => 'that scene no longer exists'],
    [/overlaps? change|inside the passage change/i, () => 'it overlapped another change'],
    [/same as the old/i, () => 'the new words were the same as the old'],
    [/cut off at the reply limit|was cut off/i, () => 'the change was too long and got cut off'],
    [/^There is already an entry called [“"](.+?)[”"]/i, (x) => `there’s already an entry called “${x[1]}”`],
    [/being written by|Write the chapter/i, () => 'that scene is being written by the AI right now']
  ]
  for (const [re, say] of rules) {
    const x = re.exec(m)
    if (x) return say(x)
  }
  const first = (m.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0] ?? '').replace(/[.!]+$/, '').replace(/`/g, '')
  if (!first || /\b[a-z]+_[a-z_]+\b|^(?:give|call|use|read|keep|make|copy|name)\b/i.test(first)) return 'what it sent couldn’t be used'
  return lowerFirst(first)
}
