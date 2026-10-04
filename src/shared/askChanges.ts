// The editor chat's answers that claim changes (Adam, 2026-10-04: "No changes came with this answer" kept showing):
// a model that writes the new words into its answer, or says it changed or proposed things, without using its
// propose tools. The main process asks it once more to propose them (ipc/ask.ts); if it still doesn't, the chat says
// nothing came with the answer. Only clear claims count: "apply pressure" in a brainstorm doesn't. Pure.

const CLAIMS = [
  // "Apply the changes", "accept these edits", "apply my fix".
  /\b(apply|accept|approve)\s+(the|these|this|those|my|all|both|each)\s+(changes?|edits?|fix(es)?|corrections?|revisions?|rewrites?|suggestions?)\b/i,
  // "the changes below", "edits above".
  /\b(changes?|edits?|fix(es)?|corrections?|revisions?)\s+(below|above)\b/i,
  // "my proposed edits", "the proposed changes".
  /\bproposed\s+(changes?|edits?|fix(es)?|corrections?|revisions?)\b/i,
  // "I've fixed", "I have rewritten", "I made the changes".
  /\bI(?:['’]ve| have)?\s+(fixed|changed|updated|rewritten|rewrote|corrected|tightened|edited|revised|made (the|these|those|some|a few) (changes|edits|fixes))\b/i,
  // "Here's the revised paragraph", "Here is a tightened version".
  /\bhere(?:['’]s| is)\s+(the|a|your|my)\s+(revised|edited|corrected|rewritten|updated|tightened|fixed|new|cleaner|polished)\s+(version|paragraph|passage|scene|text|opening|ending|line|draft)\b/i
]

/** True when an answer clearly says it made or proposed changes, or hands over rewritten words. */
export const claimsChanges = (answer: string): boolean => CLAIMS.some((re) => re.test(answer))

/** Sent back to a model whose answer claims changes it never proposed (once). */
export const PROPOSE_NOW =
  "[AI Write, not the writer] Your answer says you changed or rewrote things, but nothing was proposed: words written in your answer change nothing, and the writer can't apply them. If the writer asked for changes, propose each one now with the propose_ tools (propose_edit for words in a scene; read the scene first if you need its exact words), then say briefly what you proposed. If you only meant to suggest ideas, answer again without telling the writer to apply or accept anything."
