// The editor chat's answers that claim changes (Adam, 2026-10-04: "No changes came with this answer" kept showing):
// a model that writes the new words into its answer, or says it changed or proposed things, without using its
// propose tools. The main process asks it once more to propose them (ipc/ask.ts); if it still doesn't, the chat says
// nothing came with the answer. Only clear claims count: "apply pressure" in a brainstorm doesn't. Pure.

import type { AskIntent } from './askIntent'

const CLAIMS = [
  // "Apply the changes", "accept these edits", "apply my fix".
  /\b(apply|accept|approve)\s+(the|these|this|those|my|all|both|each)\s+(changes?|edits?|fix(es)?|corrections?|revisions?|rewrites?|suggestions?)\b/i,
  // "the changes below", "edits above".
  /\b(changes?|edits?|fix(es)?|corrections?|revisions?)\s+(below|above)\b/i,
  // "my proposed edits", "the proposed changes".
  /\bproposed\s+(changes?|edits?|fix(es)?|corrections?|revisions?)\b/i,
  // "I've fixed", "I have rewritten", "I made the changes".
  /\bI(?:['’]ve| have)?\s+(fixed|changed|updated|rewritten|rewrote|corrected|tightened|edited|revised|made (the|these|those|some|a few) (changes|edits|fixes))\b/i,
  // "Apply what you want", "use whichever you like", "copy it in", "swap these in": changes handed over to do by hand.
  /\b(apply|use|take|keep)\s+(what(ever)?|which(ever)?|any|the ones?)\s+(you|of)\b/i,
  /\b(copy|paste|swap|drop)\s+(it|them|this|these|those|that)\s+(in|into|over)\b/i,
  // "Here's the revised paragraph", "Here is a tightened version".
  /\bhere(?:['’]s| is)\s+(the|a|your|my)\s+(revised|edited|corrected|rewritten|updated|tightened|fixed|new|cleaner|polished)\s+(version|paragraph|passage|scene|text|opening|ending|line|draft)\b/i
]

/**
 * True when the writer asks for changes to their words or plans: rewrite, fix, tighten, cut, make it darker, push it
 * harder... (an answer with no proposals to such a question is asked once more for them).
 */
export const asksForChanges = (question: string): boolean =>
  /\b(re-?write|fix|correct|tighten|edit|revise|polish|cut|trim|shorten|lengthen|expand|punch up|sharpen|strengthen|intensify|tone down|change|rephrase|reword|improve|redo|update)\b/i.test(question) ||
  /\bmake\s+(it|them|(this|that|these|those|the|my)(\s+\w+)?)\s+(more|less|darker|lighter|harder|softer|tenser|shorter|longer|scarier|funnier|sadder|better|clearer|punchier|tighter)\b/i.test(question) ||
  /\bpush(es|ing)?\b.{0,40}\b(harder|further)\b/i.test(question)

/** True when an answer clearly says it made or proposed changes, or hands over rewritten words. */
export const claimsChanges = (answer: string): boolean => CLAIMS.some((re) => re.test(answer))

/** Sent back to a model whose answer claims changes it never proposed (once). */
export const PROPOSE_NOW =
  "[AI Write, not the writer] Your answer gives or describes changes, but nothing was proposed: words written in your answer change nothing, and the writer can't apply them. If the writer asked for changes, propose each one now with the propose_ tools (propose_edit for words in one paragraph, propose_rewrite for a passage across paragraphs; read the scene first if you need its exact words), then say briefly what you proposed. If you only meant to suggest ideas, answer again without telling the writer to apply or accept anything."

// ---------- The chat overhaul's contract (AIWRITE_EXP_CHAT_CONTRACT, plan E2): no "ask again" exits ----------

const AI = '[AI Write, not the writer]'

/**
 * The contract's note to a model that answered an edit (or an answer that claims changes) without proposing: no way
 * out but proposing its best version, or saying in one line what truly stops it. `attempt` counts from 1. Without a
 * known edit intent (routing off, and only the answer's wording claims changes) the old note's ideas exit stays.
 */
export function proposeNow(intent: AskIntent | null | undefined, attempt = 1): string {
  if (intent !== 'edit') return PROPOSE_NOW
  // The note starts as PROPOSE_NOW does ("Your answer gives"), so the eval and the fake provider know it for a nudge.
  const again = attempt > 1 ? ' again' : ''
  return `${AI} Your answer gives no proposal${again}, and the writer asked for a change: words in your answer change nothing and can't be applied. Propose your best single version now with the propose_ tools (propose_edit for words in one paragraph, propose_rewrite for a passage across paragraphs; read the scene first if you need its exact words). Don't offer options and don't ask permission: the writer can decline it. Then answer in one line, starting with how many changes are ready. Only if something truly stops you (the words aren't in the scene, the scene can't be found) say in one line what it is.`
}

/**
 * The contract's last words, before the last request (the one without tools): what was proposed, or, when nothing
 * was, what blocked it. Never that the writer can ask again.
 */
export function contractLastWords(proposed: string[], intent?: AskIntent | null): string {
  if (proposed.length) {
    const list = proposed.map((id) => `change ${id}`).join(', ')
    return `${AI} No more tools can be used for this answer. Proposed: ${list}. Answer the writer now: the first line says how many changes are ready; mention only these and don't repeat them in words. If something you meant to change is missing, say in one line what stopped it.`
  }
  const stop = "nothing was proposed, so there is nothing for the writer to apply: don't tell them to apply or accept anything, and don't write a change out in words."
  if (intent === 'answer' || intent === 'brainstorm') return `${AI} No more tools can be used for this answer. Answer the writer now from what you have found; ${stop}`
  const blocked =
    'Say in one or two lines what stopped you from proposing it (the words you couldn’t find, the scene you couldn’t read, or the one thing you need to know).'
  if (intent === 'edit') return `${AI} No more tools can be used for this answer, and ${stop} ${blocked}`
  return `${AI} No more tools can be used for this answer, and ${stop} If the writer asked for a change: ${blocked.charAt(0).toLowerCase()}${blocked.slice(1)} Otherwise answer from what you have found.`
}

/**
 * True when an answer is only a short clarifying question (the contract allows one line when there is no ask_user
 * tool), so an edit's nudge leaves it be.
 */
export const asksOneQuestion = (answer: string): boolean => {
  const a = answer.trim()
  return !!a && /\?["”')\]]*$/.test(a) && a.split(/\s+/).length <= 45 && !/\n\s*(\d+[.)]|[-*•])\s/.test(a)
}
