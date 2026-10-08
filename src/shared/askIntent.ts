// What a question to the editor chat asks for, decided before the model runs (the chat overhaul's routing, rule set
// C1-C8 in the plan). The agent's contract differs per intent:
//   edit        propose the best single version this turn (or ask one question with options)
//   brainstorm  options in words, no proposals until the writer picks one
//   answer      a verdict and facts with sources, no proposals
//   unsure      the model decides; it may ask one question with options (ask_user)
export type AskIntent = 'edit' | 'brainstorm' | 'answer' | 'unsure'

/**
 * The chat overhaul's lab switches, each `AIWRITE_EXP_CHAT_<NAME>=on` in the environment. Off (the default) keeps
 * today's behaviour, so the eval can compare one against the other; a winner later becomes the default and its
 * switch is removed.
 */
export const CHAT_SWITCHES = ['CONTRACT', 'ROUTE', 'TOOLCHOICE', 'ANCHOR', 'HISTORY', 'TEMP', 'ASKUSER', 'DRAFT'] as const
export type ChatSwitch = (typeof CHAT_SWITCHES)[number]
