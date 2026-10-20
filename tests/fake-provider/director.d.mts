/** The fake director's reply (JSON), or null when the request isn't the director's. */
export function directorReply(system: string, messages: { role: string; content: unknown }[]): string | null
/** Sentences for a paragraph written again. */
export const RETAKE_SENTENCES: string[]
/** The writer's stretch, or null for any other request. */
export function stretchProse(lastUser: string, words: number, sentences: string[], prose: (words: number, sentences: string[]) => string): string | null
