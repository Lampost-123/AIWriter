export interface FakeProviderOptions {
  port?: number
  /** Pause between streamed pieces, in ms. */
  delayMs?: number
  /** Words in a normal reply (capped by max_tokens / 2). */
  words?: number
  slowWords?: number
  slowDelayMs?: number
  /** How long fake/wait holds its first words back, in ms. */
  waitMs?: number
  /** Use CRLF line endings in the stream. */
  crlf?: boolean
  /** Beat by beat's beats each read differently (by their number), rather than all alike. */
  varyBeats?: boolean
  /** The editor chat: a pause after each tool call's name before its arguments, in ms (the call shows running). */
  toolDelayMs?: number
}

export interface FakeProvider {
  port: number
  url: string
  lastRequest(): { body: Record<string, unknown> & { messages: { role: string; content: string }[] }; headers: Record<string, string | string[] | undefined> } | null
  requestCounts(): Record<string, number>
  reset(): void
  close(): Promise<void>
}

export const FAKE_MODELS: { id: string; name: string; context_length: number; pricing: { prompt: string; completion: string } }[]
export function fakeProse(words: number, sentences?: string[]): string
/** A deterministic reply to a memory keeper reading request (its user message). */
export function fakeMemoryReply(user: string): string
/** A deterministic summary of a summary request (its user message). */
export function fakeSummary(user: string): string
/** A deterministic reply to a story flow request (its system prompt and user message). */
export function fakeStoryFlowReply(system: string, user: string): string
export function startFakeProvider(options?: FakeProviderOptions): Promise<FakeProvider>
/** A deterministic reply to a builder request (see the end of server.mjs), or null when the request isn't one. */
export function fakeBuilderReply(system: string, messages: { role: string; content: string }[], model?: string): string | null
