// What a question to the editor chat asks for, decided before the model runs (the chat overhaul's routing, rule set
// C1-C8 in the plan). The agent's contract differs per intent:
//   edit        propose the best single version this turn (or ask one question with options)
//   brainstorm  options in words, no proposals until the writer picks one
//   answer      a verdict and facts with sources, no proposals
//   unsure      the model decides; it may ask one question with options (ask_user)
export type AskIntent = 'edit' | 'brainstorm' | 'answer' | 'unsure'

/**
 * The chat overhaul's lab switches. All are on by default (the Phase 1 A/B on DeepSeek Flash showed all-on winning
 * clearly); `AIWRITE_EXP_CHAT_<NAME>=off` in the environment turns one off, for the eval's A/B or as a fallback to the
 * old behaviour. Once each has proven itself in use, its switch and the old path go. FORMAT (Phase 2): answers in the
 * block format (shared/answerBlocks.ts); off, the plain-text answer rules. TEXTTOOLS (Phase 3): the text tools, i.e.
 * find_mentions and propose_changes' kinds insert, cut and beats; off, none of them is offered.
 */
export const CHAT_SWITCHES = ['CONTRACT', 'ROUTE', 'TOOLCHOICE', 'ANCHOR', 'HISTORY', 'TEMP', 'ASKUSER', 'DRAFT', 'FORMAT', 'TEXTTOOLS'] as const
export type ChatSwitch = (typeof CHAT_SWITCHES)[number]

/** A switch's environment variable. */
export const chatSwitchVar = (name: ChatSwitch): string => `AIWRITE_EXP_CHAT_${name}`

/** Whether a switch is on, from its environment value: on unless set to `off`. */
export const chatSwitchOn = (value: string | undefined): boolean => value?.trim().toLowerCase() !== 'off'
