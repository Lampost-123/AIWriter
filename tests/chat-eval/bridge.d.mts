export const BRIDGE_MODEL: string
export function jobOf(messages: { role: string; content: unknown }[]): 'ask' | 'other'
export function readReply(raw: string): { content: string; toolCalls: { name: string; arguments: string }[] }
export function startBridge(options: {
  dir: string
  seqPrefix?: string
  pollMs?: number
  timeoutMs?: number
  log?: (line: string) => void
}): Promise<{ url: string; close(): Promise<void> }>
