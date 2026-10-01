export interface FakeProviderOptions {
  port?: number
  /** Pause between streamed pieces, in ms. */
  delayMs?: number
  /** Words in a normal reply (capped by max_tokens / 2). */
  words?: number
  slowWords?: number
  slowDelayMs?: number
  /** Use CRLF line endings in the stream. */
  crlf?: boolean
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
export function fakeProse(words: number): string
export function startFakeProvider(options?: FakeProviderOptions): Promise<FakeProvider>
