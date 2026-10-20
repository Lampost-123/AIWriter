// The editor chat's truth check (Adam, 2026-10-19: "I was still getting responses from the chat claiming it had edited or
// proposed a change while it did nothing"). What an answer says it changed, proposed or made ready, read from its own
// words with no AI call, against the changes actually proposed with the tools in that answer. A claim no proposal backs
// is sent back to the model once, with the propose tool forced (ask/agent.ts recheck, ai/tasks.ts); if it still stands,
// the claim is put right in plain words before Adam sees it (honestReply). Only the answer's own words count: words in
// quotation marks (Adam's, or the scene's), questions, offers ("I'd change…", "I can change…"), conditions ("once I've
// changed it") and what the story's people did are never claims. English, as the app is. Pure.

import type { Proposal } from './contracts/ask'

/** What a claim says was changed, when its words say so clearly. */
export type ClaimTarget = 'words' | 'card' | 'entry' | 'new' | 'title'

export interface Claim {
  /** The sentence that makes it, as written. */
  sentence: string
  /** Where that sentence is in the answer (from, to). */
  from: number
  to: number
  /** What it says was changed; null when it names nothing clearly ("Done.", "The change is ready"). */
  target: ClaimTarget | null
  /**
   * How it is put right when nothing backs it: a first-person claim is reworded as an offer ("I've updated" → "I'd
   * update", at `at` for `length` characters); anything else (a hand-over, "Done.", "the change is ready") goes.
   */
  fix: { kind: 'reword'; at: number; length: number; to: string } | { kind: 'drop' }
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

/** The verbs that make a passive claim ("Mara's entry has been updated"). */
const PASSIVE_ALT =
  'edited|changed|updated|added|removed|deleted|proposed|applied|renamed|retitled|moved|rewritten|revised|fixed|corrected|tightened|trimmed|replaced|inserted|swapped|reworded|rephrased|shortened|expanded|polished|saved|made'

/** The app's own things, the subjects of a passive claim (a character's name changed in the story is no claim). */
const THINGS =
  'scene|scenes|chapter|chapters|entry|entries|card|cards|paragraph|paragraphs|passage|sentence|sentences|line|lines|opening|ending|title|text|draft|summary|description|field|fields|beat|beats|change|changes|edit|edits|fix|fixes|codex|wording|prose|version|dialogue|typo|typos'

/** "I've (also) updated", "I have rewritten", "I changed", "We've cut". `I` stays a capital so "i" in a word never counts. */
const FIRST_PERSON = new RegExp(
  String.raw`(?<![\p{L}'’])(?:I|We|we)(?:['’]ve| have)?\s+((?:(?:also|just|now|already|quickly|then|gone ahead and|went ahead and)\s+)*)(${VERB_ALT})\b`,
  'gu'
)

/** A second change after a first-person one: "I've kept your voice and tightened the opening". */
const COORD = new RegExp(
  String.raw`(?<![\p{L}'’])(?:I|We|we)(?:['’]ve| have)\s+(?:\p{L}+\s+)?\p{L}+(?:ed|en|t)\b[^.!?\n]{0,80}?(?:\band|\bthen|,)\s+(?:also\s+)?(${VERB_ALT})\b`,
  'gu'
)

/** A sentence that starts with what was done, as a summary of changes does ("Tightened the opening.", "- Reworded line 3"). */
const BARE_START = new RegExp(
  String.raw`^(?:[-*•]\s+|\d+[.)]\s+)?(?:\*\*)?(Updated|Changed|Edited|Added|Removed|Deleted|Renamed|Moved|Rewrote|Rewritten|Revised|Fixed|Corrected|Tightened|Trimmed|Replaced|Inserted|Swapped|Applied|Proposed|Reworded|Rephrased|Shortened|Expanded|Polished|Marked|Linked)(?:\*\*)?\s+(?!by\b|up\b|over\b|with\b|from\b|for\b|in\b|to\b|into\b|at\b|as\b|and\b)(?:the|her|his|their|its|your|a|an|this|that|these|those|both|all|some|one|two|three|paragraph|line|[A-Z][\p{L}'’-]*)\b`,
  'u'
)

const PASSIVE = new RegExp(
  String.raw`\b(?:${THINGS})\b[^.!?\n]{0,40}?\b(?:has|have)\s+(?:now\s+|also\s+)?been\s+(?:${PASSIVE_ALT})\b|\b(?:${THINGS})\b[^.!?\n]{0,40}?\b(?:is|are)\s+now\s+(?:${PASSIVE_ALT}|in place|in the (?:scene|text|memory|entry|card))\b`,
  'iu'
)

/** "The change is ready", "2 changes are waiting for you", "ready to apply", "Changes made:". */
const READY = new RegExp(
  String.raw`\b(?:changes?|edits?|fix|fixes|rewrite|rewrites|proposals?)\b[^.!?\n]{0,30}?\b(?:is|are)\s+(?:now\s+)?(?:ready|waiting)\b|\bready (?:for you )?to (?:apply|be applied)\b|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:changes?|edits?) (?:is |are )?(?:ready|waiting)\b|^(?:changes|edits) made\s*:`,
  'iu'
)

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
  /\bhere(?:['’]s| is)\s+(the|a|your|my)\s+(revised|edited|corrected|rewritten|updated|tightened|fixed|new|cleaner|polished)\s+(version|paragraph|passage|scene|text|opening|ending|line|draft)\b/i
]

/** Words before "I" that make it a condition or an offer, not a claim ("once I've changed it", "if I cut that"). */
const CONDITION = /\b(?:if|once|when|whenever|unless|whether|until|after|before|so that|in case|what if|should|would|could)\s+(?:\S+\s+){0,2}$/i
/** A sentence about an earlier answer, or about what the writer did, is no claim about this one. */
const ELSEWHERE = /\b(?:earlier|previously|last time|before this|in my (?:last|previous|earlier) (?:answer|reply|message)|you applied|you accepted|you(?:['’]ve| have) (?:changed|edited|updated|applied))\b/i
/** What follows a verb that says nothing was changed ("I've changed nothing", "I've changed my mind"). */
const NOTHING = /^\s*(?:nothing|no\b|none\b|anything\b|my mind\b)/i

/** True when a guarded verb is followed by the words that make it a change ("made the change", "set her age to"). */
function follows(verb: string, after: string): boolean {
  switch (verb) {
    case 'set':
      return /^[^.;!?\n]{0,60}\bto\b/.test(after)
    case 'made':
      return /^\s*(?:the|these|this|that|those|some|a few|a couple of|your|a|an|one|two|three|four|several|all the|both)\s+(?:\w+\s+)?(?:change|changes|edit|edits|fix|fixes|update|updates|corrections?|adjustments?|tweaks?|revisions?|cuts?)\b/i.test(after)
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
  if (/\b(entry|entries|memory|codex|field|fields|profile|aliases?|summary|description|eye colou?r)\b|['’]s (eyes|hair|age|eye|colour|color|role|pronouns)\b/.test(clause)) return 'entry'
  if (/\b(card|cards|beats?|goal|mood|pov|point of view|thread|threads)\b/.test(clause)) return 'card'
  if (/\b(paragraphs?|sentences?|lines?|passage|opening|ending|dialogue|prose|wording|text|scene|words?|typos?|spelling|punctuation|verbs?|adjectives?|it|them|that|this)\b/.test(clause)) return 'words'
  return null
}

/** Each claim of a change in an answer, in order (one a sentence). */
export function changeClaims(answer: string): Claim[] {
  const masked = withoutQuotes(answer)
  const out: Claim[] = []
  for (const { from, to } of sentencesOf(masked)) {
    const s = masked.slice(from, to)
    const trimmed = s.trim()
    if (!trimmed || /\?["”’')\]*]*\s*$/.test(trimmed) || ELSEWHERE.test(s)) continue
    const make = (target: ClaimTarget | null, fix: Claim['fix']): Claim => ({ sentence: answer.slice(from, to).trim(), from, to, target, fix })
    // Every first-person claim in the sentence: "I've tightened the opening and I've updated Mara's entry".
    const mine: Claim[] = []
    // First-person: "I've updated Mara's entry", "I changed the opening".
    for (const m of s.matchAll(FIRST_PERSON)) {
      const at = m.index ?? 0
      const verb = m[2]
      const after = s.slice(at + m[0].length)
      if (CONDITION.test(s.slice(0, at)) || NOTHING.test(after) || !follows(verb, after)) continue
      const adverbs = (m[1] ?? '').replace(/\b(?:gone|went) ahead and\s+/g, '')
      mine.push(make(targetOf(verb, after), { kind: 'reword', at: from + at, length: m[0].length, to: `I’d ${adverbs}${VERBS[verb]}` }))
    }
    // A second verb after a first-person one: "I've kept your voice and tightened the opening".
    if (!mine.length) {
      for (const m of s.matchAll(COORD)) {
        const at = m.index ?? 0
        const verbAt = at + m[0].length - m[1].length
        const after = s.slice(verbAt + m[1].length)
        if (CONDITION.test(s.slice(0, at)) || NOTHING.test(after) || GUARDED.has(m[1])) continue
        mine.push(make(targetOf(m[1], after), { kind: 'reword', at: from + verbAt, length: m[1].length, to: `would ${VERBS[m[1]]}` }))
      }
    }
    if (mine.length) {
      out.push(...mine)
      continue
    }
    let found: Claim | null = null
    // A summary line: "Tightened the opening.", "- Reworded paragraph 3".
    if (!found) {
      const bare = BARE_START.exec(trimmed)
      if (bare) found = make(targetOf(bare[1], trimmed.slice(trimmed.indexOf(bare[1]) + bare[1].length)), { kind: 'drop' })
    }
    // Passive: "Mara's entry has been updated", "the opening is now tightened".
    if (!found) {
      const m = PASSIVE.exec(s)
      if (m && !/\byou(?:['’]ve| have)?\b/i.test(s) && !CONDITION.test(s.slice(0, m.index))) found = make(targetOf('changed', s.slice(m.index)), { kind: 'drop' })
    }
    // "The change is ready", "Done." at the start of a line, and the hand-overs.
    const lineStart = from === 0 || masked[from - 1] === '\n'
    if (!found && (READY.test(trimmed) || (lineStart && DONE.test(trimmed)) || HANDOVER.some((re) => re.test(s)))) found = make(null, { kind: 'drop' })
    if (found) out.push(found)
  }
  return out
}

// ---------- Against what was proposed ----------

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
    case 'beats':
    case 'chapterCard':
    case 'thread':
      return ['card']
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

/**
 * The claims no proposal of this answer backs: every claim when nothing was proposed; else those that name a kind of
 * change (an entry, a card, a title, something new, words) none of the proposals is. A claim that names nothing is
 * backed by any proposal.
 */
export function unbackedClaims(answer: string, proposals: readonly (Pick<Proposal, 'kind'> & { how?: string })[]): Claim[] {
  const claims = changeClaims(answer)
  if (!claims.length || !proposals.length) return claims
  const groups = new Set(proposals.flatMap(groupsOf))
  return claims.filter((c) => c.target !== null && !groups.has(c.target))
}

/** True when an answer claims a change no proposal of its backs. */
export const claimsUnmade = (answer: string, proposals: readonly (Pick<Proposal, 'kind'> & { how?: string })[]): boolean =>
  unbackedClaims(answer, proposals).length > 0

// ---------- Putting it right ----------

/** A claim's sentence, short, for the note sent back to the model. */
export const claimWords = (c: Claim): string => {
  const s = c.sentence.replace(/\s+/g, ' ').trim()
  return s.length > 140 ? `${s.slice(0, 137).replace(/\s+\S*$/, '')}…` : s
}

const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** How every answer put right by honestReply starts, when nothing was proposed (the window and the tests know it by this). */
export const NO_CHANGE_LEAD = 'No change was made'

/**
 * The answer with every unbacked claim put right, never shown as made: a first-person claim becomes an offer ("I'd
 * update…"), a hand-over or "Done." goes, and a plain line leads: "No change was made" (with why, when a tool turned the
 * change down: `failure`, in plain words) and "Here's what I'd suggest:" before what is left; with some changes
 * proposed, which ones are ready and that nothing else was changed.
 */
export function honestReply(answer: string, claims: Claim[], o: { proposed: string[]; failure?: string | null }): string {
  if (!claims.length) return answer
  let text = answer
  const place = (c: Claim): number => (c.fix.kind === 'reword' ? c.fix.at : c.from)
  for (const c of [...claims].sort((a, b) => place(b) - place(a))) {
    if (c.fix.kind === 'reword') {
      text = text.slice(0, c.fix.at) + c.fix.to + text.slice(c.fix.at + c.fix.length)
      continue
    }
    // The sentence goes, with the space after it; a list item or line that held only it goes too.
    let end = c.to
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++
    let start = c.from
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    if (/^\s*(?:[-*•]|\d+[.)])?\s*$/.test(text.slice(lineStart, start))) start = lineStart
    text = text.slice(0, start) + text.slice(end)
  }
  const rest = text
    .split('\n')
    .filter((l) => !/^\s*(?:[-*•]|\d+[.)])\s*$/.test(l))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const reason = o.failure?.trim().replace(/[.!]+$/, '')
  let lead: string
  if (!o.proposed.length) {
    lead = reason ? `${NO_CHANGE_LEAD}: I couldn’t make it because ${reason}.` : `${NO_CHANGE_LEAD}, so there’s nothing to apply.`
    if (rest) lead += ' Here’s what I’d suggest:'
  } else {
    const n = o.proposed.length
    const which = n === 1 ? `change ${o.proposed[0]} is` : `${NUMBER[n] ?? n} changes (${o.proposed.join(', ')}) are`
    lead = `Only ${which} ready to apply; nothing else was changed${reason ? `: ${reason}` : ''}.`
  }
  return rest ? `${lead}\n\n${rest}` : lead
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
