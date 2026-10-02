/** The fake reply to an outline part request ("[AIWRITE-OUTLINE v1] outline" or "ideas"), or null for any other request. */
export function outlineReply(system: string, messages: { role: string; content?: unknown }[], model?: string): string | null
