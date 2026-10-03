/** What the fake answers when asked for a character's voice (Suggest, or the AI filling one in by itself). */
export const SUGGESTED_VOICE: string
/** How the fake says a character called Siobhan is said, when the voice request asks ("SAY IT AS:"). */
export const SUGGESTED_SAY: string
/** The fake reply to a read-aloud request ("[AIWRITE-READ-ALOUD v1] <job>"), or null for any other request. */
export function readAloudReply(system: string, messages: { role: string; content?: unknown }[], model?: string): string | null
