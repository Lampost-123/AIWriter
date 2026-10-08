// The chat overhaul's routing (AIWRITE_EXP_CHAT_ROUTE, plan E3): what a question to the editor chat asks for, told
// from its words before the model runs, with no model call. Edit wins whenever the writer pressed "Edit this" or picks
// one of the options the last answer offered ("yes", "2", "go ahead"); otherwise the wording decides. Pure.

import type { AskIntent } from '@shared/askIntent'
import { asksForChanges, asksOneQuestion, claimsChanges, PROPOSE_NOW, proposeNow } from '@shared/askChanges'

/** How many times an edit with nothing proposed is asked again in one answer, with routing on. */
export const MAX_EDIT_NUDGES = 2

export interface NudgeInput {
  /** The answer given without tools. */
  answer: string
  /** Which note this would be, from 1. */
  attempt: number
  question: string
  /** How many changes the answer has proposed so far. */
  proposed: number
  /** The routed intent (null with routing off). */
  intent: AskIntent | null
  /** AIWRITE_EXP_CHAT_ROUTE and AIWRITE_EXP_CHAT_CONTRACT. */
  route: boolean
  contract: boolean
}

/**
 * The note sent back to an answer given without tools, or null to keep it. Routing off: today's rule (no proposals,
 * and the answer claims changes or the question's verbs ask for edits). Routing on: an edit with nothing proposed is
 * asked again whatever its wording (up to MAX_EDIT_NUDGES, via the task's maxNudges), unless it only asked one short
 * question; an answer or ideas never are; an unsure request only when its answer claims changes, once. The contract
 * switch picks the note without the "only meant ideas" exit when the request is an edit.
 */
export function editorNudge(n: NudgeInput): string | null {
  if (n.proposed > 0) return null
  if (n.route) {
    if (n.intent === 'edit') return asksOneQuestion(n.answer) ? null : n.contract ? proposeNow('edit', n.attempt) : PROPOSE_NOW
    if (n.intent === 'unsure' && n.attempt === 1 && claimsChanges(n.answer)) return n.contract ? proposeNow(null) : PROPOSE_NOW
    return null
  }
  const asked = asksForChanges(n.question)
  if (!asked && !claimsChanges(n.answer)) return null
  return n.contract ? proposeNow(asked ? 'edit' : null, n.attempt) : PROPOSE_NOW
}

export interface RouteInput {
  question: string
  /** Words selected in the scene when the question was asked, if any. */
  selection?: string | null
  /** What the writer pressed: "Edit this" (or the box's Edit mode) means edit; Talk goes on to the other checks. */
  mode?: 'edit' | 'talk'
  /** The chat's last answer, to tell whether it offered options or asked a question. */
  lastAnswer?: string | null
  /** Set when the caller already knows the last answer offered options or asked something (ask_user). */
  lastHadOptionsOrQuestion?: boolean
}

const norm = (s: string): string => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()

const wordCount = (s: string): number => (s.match(/[\p{L}\p{N}']+/gu) ?? []).length

/** True when an answer offered options (a list of two or more) or ends by asking the writer something. */
export function offersChoice(answer: string | null | undefined): boolean {
  const a = (answer ?? '').trim()
  if (!a) return false
  const items = a.split('\n').filter((l) => /^\s*(\d+[.)]|[-*•]|\(?[a-e]\))\s+\S/i.test(l)).length
  if (items >= 2) return true
  // A question among its last two lines ("Which do you prefer?", "Shall I tighten the second one?").
  const lines = a
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.slice(-2).some((l) => /\?["”')\]*_]*$/.test(l))
}

/** The writer says to leave the words alone: an answer, whatever verbs follow. */
const HANDS_OFF =
  /\b(don'?t|do not|without|no need to|never)\s+(change|edit|touch|rewrite|alter|propose|fix|modify)\w*\b|\b(no|without)\s+(changes|edits|proposals)\b|\bjust (tell|explain|answer|say)\b|\bleave (it|the \w+|this|that) (alone|as (it is|is))\b/

/** A short reply picking up what the last answer offered: "yes", "2", "option 2", "the second", "go ahead", "both". */
const PICK = new RegExp(
  '^(?:ok(?:ay)?|sure|yes|yeah|yep|yup|please|great|perfect|good|cool|alright|right)?[,.! ]*(?:' +
    [
      'yes|yeah|yep|yup|sure|ok(?:ay)?|please',
      'go (?:ahead|for it|with (?:it|that|this|the \\w+|option \\w+|#?\\d+|both|all)\\b)',
      "let'?s (?:do|go with|use|try) (?:it|that|this|the \\w+|option \\w+|#?\\d+|both|all)\\b",
      "(?:i'?ll take|take|use|pick|i like|i'?d go with) (?:it|that|this|that one|this one|the \\w+|option \\w+|#?\\d+|both|all)\\b",
      'do (?:it|that|this|both|all(?: of them| three| two)?|the \\w+|option \\w+|#?\\d+)\\b',
      'both(?: of them)?|all(?: of them| three| two)?|that one|this one|that|this|that works|sounds good|make it so',
      'the (?:first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th|other)(?: one| option| idea| version)?',
      '(?:option|number|idea|version|no\\.?) ?#?(?:\\d+|[a-e]|one|two|three|four|five)\\b',
      '#?\\d+(?:st|nd|rd|th)?(?: and #?\\d+)?'
    ].join('|') +
    ')(?![\\w-])'
)

/** Asking for ideas or options in words: brainstorm. */
const IDEAS =
  /\b(what (else )?could|what (else )?might|what else|what would happen|what if|ideas?\b|brainstorm|suggest(ions?)?\b|options?\b|alternatives?\b|possibilit(y|ies)|ways (to|i could|she could|he could|they could)|give me (some|a few|\d+|two|three|four|five|several)\b(?! (more )?(edits|changes|fixes)))/

/**
 * An edit verb, as the first word of an instruction ("tighten", "please cut", "can you rewrite", "I want you to fix"),
 * at the start or after a clause ("In Hesper's note, change…", "…seventh lamp. Make it…", "About this passage: “…” fix this").
 */
const EDIT_VERB =
  'rewrite|re-write|redo|rework|revise|edit|fix|correct|tighten|trim|cut|shorten|lengthen|expand|extend|add|insert|remove|delete|drop|replace|swap|change|rename|retitle|rephrase|reword|polish|punch (?:\\w+ ){0,2}up|sharpen|strengthen|soften|intensify|tone down|tone up|smooth|simplify|clean up|clarify|improve|update|adjust|split|merge|combine|join|move|reorder|condense|streamline|turn|give (?:her|him|them|it|this|the \\w+)|put|write|draft|continue|finish|end|open|start|push|heighten|raise|lower|slow|speed up|break up|fill in|flesh out|spell out|let (?:her|him|them)'
const IMPERATIVE = new RegExp(
  `(?:^|[.!?:;,"”)] )(?:(?:ok(?:ay)?|right|now|so|then|also|and|alright)[, ]+)?(?:please |pls |kindly )?(?:(?:can|could|would|will) you (?:please )?|i (?:want|need|'d like|would like) you to |i want to |let'?s |try (?:to |and )?|go ahead and |help me )?(?:${EDIT_VERB})\\b`
)

/** Edit cues anywhere in the request: "make her angrier", "this drags", "it should", "needs more", "the next bit". */
const EDIT_CUES = [
  /\bmake (it|this|that|these|those|her|him|them|the \w+|[a-z]+'s \w+|\w+)( \w+){0,2} (more|less|\w+er|\w+ier)\b/,
  /\bmake (it|this|that|these|those|her|him|them|the \w+|\w+) (sound|feel|read|seem|look) /,
  /(?:^|[.!?:;,"”] )make (it|this|that|them|him|her) (the|a|an) /,
  /\b(can|could|would) (this|it|that|these|those|the \w+)( \w+)? be (more|less|\w+er|\w+ier)\b/,
  /\b(this|it|that|these|those|the|my)( \w+){0,2} (drags|sags|is (too )?(clunky|flat|slow|wordy|long|dull|weak|stiff|awkward|rushed|repetitive|confusing|boring|bland|overwritten|purple|choppy)|feels? (flat|off|slow|rushed|clunky|wrong|weak)|reads? (badly|awkwardly|flat))\b/,
  /^should (?!i\b|we\b)(\w+ ){1,3}(be|sound|feel|read|have|say|hesitate|react|notice|end|start)\b/,
  /\b(should|needs? to|need to|ought to) (be|sound|feel|read|have|say|end|start|open|come|happen|move|get|show|hesitate|react|notice)\b/,
  /\bneeds? (more|less|work|a |an |tightening|cutting|fixing|a rewrite|to be)\b/,
  /\b(too (long|short|slow|fast|wordy|flat|much|little))\b/,
  /\b(re-?write|tighten|punch up|rephrase|reword|rename|retitle|fix (the|this|that|it|a|my)|typos?)\b/,
  /\b(write|draft) (the|a|an|my) (next|new|opening|closing|first|last|missing|rest)\b/,
  /\b(continue|carry on|keep going|what happens next in (the )?(text|prose))\b(?! to)/,
  /\b(the next bit|next paragraph|next scene|the rest of (the|this) scene)\b/,
  /\bpush\b.{0,40}\b(harder|further)\b/,
  /\b(add|insert|cut|remove|delete) (a|an|the|this|that|some|more|her|his|their|one|two|\d+)\b/
]

/** A question about what is so, asked of the memory ("Did I…", "Who knows…", "How old is…"). */
const FACT_START =
  /^(?:(?:ok(?:ay)?|so|and|wait|hm+|quick question)[, ]+)?(?:who|whom|whose|when|where|which|did|does|do (?:i|you|we|they|any|all|both)|has|have|had|is|are|was|were|am|how (?:old|many|much|long|far|tall|did|does|do|is|are|was|were)|what(?:'s| is| are| was| were| did| does| do| happened| happens| colou?r| year| day| time| age))\b/

/**
 * The intent of one question. Order: Edit mode; "don't change anything" (answer); a short pick of what the last answer
 * offered (edit); an edit instruction (edit, or brainstorm when it asks for options); ideas (brainstorm); a question of
 * fact (answer); an edit cue anywhere (edit); any other question (answer); else unsure (the model decides).
 */
export function routeIntent(input: RouteInput): AskIntent {
  if (input.mode === 'edit') return 'edit'
  const q = norm(input.question)
  if (!q) return 'unsure'
  if (HANDS_OFF.test(q)) return 'answer'
  const offered = input.lastHadOptionsOrQuestion ?? offersChoice(input.lastAnswer)
  if (offered && wordCount(q) <= 12 && PICK.test(q)) return 'edit'
  const ideas = IDEAS.test(q)
  if (IMPERATIVE.test(q)) return ideas ? 'brainstorm' : 'edit'
  if (ideas) return 'brainstorm'
  if (FACT_START.test(q)) return 'answer'
  if (EDIT_CUES.some((re) => re.test(q))) return 'edit'
  // With words selected, a short complaint about them ("too stiff", "clunky?") is about changing them.
  if (
    input.selection?.trim() &&
    wordCount(q) <= 6 &&
    /\b(clunky|flat|stiff|wordy|awkward|weak|slow|rushed|off|wrong|better|tighter|shorter|longer)\b/.test(q)
  )
    return 'edit'
  if (/\?\s*$/.test(q) || /^(why|how|what|explain|tell me|remind me|check|summari[sz]e|list)\b/.test(q)) return 'answer'
  return 'unsure'
}

/** The sampling temperature for an intent (AIWRITE_EXP_CHAT_TEMP, plan E10): exact for edits, freer for ideas. */
export function temperatureFor(intent: AskIntent): number {
  return intent === 'brainstorm' ? 0.8 : intent === 'answer' ? 0.5 : 0.3
}
