export interface StandinRequest {
  id: string
  model: string
  max_tokens: number | null
  job: string
  estimated_tokens_in: number
  messages: Array<{ role: string; content: string; name?: string; tool_call_id?: string; tool_calls?: unknown }>
  tools: Array<{ name: string; description?: string; parameters?: unknown }>
  tool_choice: unknown
  response_format: unknown
}

export interface StandinReply {
  content?: string
  tool_calls?: Array<{ id?: string; name: string; arguments?: unknown }>
  error?: string
}

export interface StandinOptions {
  dir: string
  port?: number
  timeoutMs?: number
  pollMs?: number
  answer?: ((request: StandinRequest) => StandinReply | null | Promise<StandinReply | null>) | null
}

export interface Standin {
  url: string
  waiting(): string[]
  close(): Promise<void>
}

export function estimateTokens(chars: number): number
export function jobOf(messages: Array<{ role: string; content: unknown }>): string
export function requestRecord(id: string, body: unknown): StandinRequest
export function replyBody(id: string, model: string, reply: StandinReply, tokensIn: number): unknown
export function startStandin(options: StandinOptions): Promise<Standin>
