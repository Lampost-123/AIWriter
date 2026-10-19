// The editor chat's side of the tool loop (ai/tasks.ts runs it): the tools, when to make a request call one, the notes
// sent back to an answer, the last words, and the truth check that keeps an answer from claiming a change it never
// made (Adam, 2026-10-19). ipc/ask.ts hands this to startTask; the tests run it the same way. No Electron imports.

import { contractLastWords } from '@shared/askChanges'
import type { AskIntent } from '@shared/askIntent'
import type { TaskRequest } from '../ai/tasks'
import { MAX_STEPS, type EditorAgent } from './agent'
import { stepPreamble } from './history'
import { editorNudge, MAX_EDIT_NUDGES } from './route'

export interface ChatLoopOptions {
  /** Adam's question. */
  question: string
  /** The routed intent (null with routing off). */
  intent: AskIntent | null
  /** AIWRITE_EXP_CHAT_ROUTE and AIWRITE_EXP_CHAT_CONTRACT. */
  route: boolean
  contract: boolean
  /** ACTFIRST, with a scene open: an edit's question asked before reading is sent back to read first. */
  readFirst: boolean
}

/** The agent part of the chat's task request. */
export function chatLoop(agent: EditorAgent, o: ChatLoopOptions): NonNullable<TaskRequest['agent']> {
  return {
    // The same list on every request of the answer (the lab switches are read once, by the agent).
    tools: agent.tools,
    maxSteps: MAX_STEPS,
    ended: () => agent.ended(),
    forceTool: () => agent.forceTool(),
    // With the contract on, a short "I'll read the scene first" written before tool calls is left out of the reply.
    ...(o.contract ? { dropBeforeTools: stepPreamble } : {}),
    run: (calls, step, info) => agent.runAll(calls, step, info?.cutOff ?? false),
    onCallStart: (slot, name, step) => agent.callStarted(slot, name, step),
    // With the contract on, the last words say what was proposed or what blocked it (never "ask again").
    lastWords: () => (o.contract ? contractLastWords(agent.proposals.map((x) => x.id), o.intent, agent.lastFailure()) : agent.lastWords()),
    // An answer with no proposals is asked once more when it claims changes or the writer asked for edits; with
    // routing on, an edit is asked again whatever its wording, twice at most, and an answer or ideas never are.
    // Never once the chat has asked the writer a question with options (ask_user ends the answer).
    maxNudges: o.route ? MAX_EDIT_NUDGES : 1,
    nudge: (answer, attempt) =>
      editorNudge({
        answer,
        attempt,
        question: o.question,
        proposed: agent.proposals.length,
        intent: o.intent,
        route: o.route,
        contract: o.contract,
        asked: !!agent.choice,
        ...(o.readFirst ? { read: agent.knowsWords() } : {})
      }),
    // The truth check, whatever the intent: a claim of a change none of the proposals is goes back once with the
    // propose tool forced, and if it still stands it is put right in plain words before Adam sees it.
    recheck: (reply) => agent.recheck(reply),
    settle: (reply) => agent.settle(reply),
    // The proposals and the question it ended with (agent.extraParams), and the routed intent.
    extraParams: () => ({ ...agent.extraParams(), ...(o.intent ? { intent: o.intent } : {}) })
  }
}
