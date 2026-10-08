// "What the AI saw" for an editor chat answer that used tools (chat Phase 4, E18): each request of the answer as a
// numbered step, named for what it brought ("Request 2 · after read_scene"), with what it added to the one before.
// Records from before Phase 4 have no requests, and show the first request alone, as they always did.
import type { AgentRequest, ChatMessage, GenerationRecord } from '@shared/types'

/** The requests to show as steps: only when the answer made more than one (one request is the messages as they are). */
export function requestsOf(params: GenerationRecord['params']): AgentRequest[] {
  const list = Array.isArray(params.requests) ? params.requests.filter((r) => r && typeof r === 'object' && Array.isArray(r.added)) : []
  return list.length > 1 ? list : []
}

/** Names in order, each once, with how many times when more than once ("read_scene ×2, propose_changes"). */
function namesOnce(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ')
}

/** A request's title: "Request 1 · briefing + question", "Request 2 · after read_scene", "Request 3 · after a note". */
export function requestTitle(r: AgentRequest): string {
  if (r.n === 1) return 'Request 1 · briefing + question'
  if (r.after?.length) return `Request ${r.n} · after ${namesOnce(r.after)}`
  return `Request ${r.n} · after a note sent back`
}

/** The quiet line under a request's title: how it was asked, and what the provider counted. */
export function requestNote(r: AgentRequest): string {
  const parts: string[] = []
  parts.push(r.toolChoice ? `Made to call ${r.toolChoice}` : r.tools ? 'Tools offered' : 'No tools: asked for its answer')
  if (r.removed) parts.push(`${r.removed} earlier ${r.removed === 1 ? 'result' : 'results'} taken out to save room`)
  if (r.promptTokens != null) parts.push(`${r.promptTokens.toLocaleString('en-GB')} tokens sent`)
  if (r.completionTokens != null) parts.push(`${r.completionTokens.toLocaleString('en-GB')} written`)
  return parts.join(' · ')
}

/** The label of a message in a request after the first: a later user message is AI Write's note, not Adam's question. */
export function laterMessageLabel(m: ChatMessage, roles: Record<ChatMessage['role'], string>): string {
  if (m.role === 'assistant') return m.toolCalls?.length ? 'Asked for tools' : 'Answer sent back'
  if (m.role === 'user') return 'Note from AI Write'
  return roles[m.role]
}

/** What a message in a request shows: its words, and each tool it asked for with the arguments as sent. */
export function messageText(m: ChatMessage): string {
  const calls = (m.toolCalls ?? []).map((c) => `→ ${c.name} ${c.arguments}`)
  return [m.content, ...calls].filter((x) => x.trim()).join('\n\n')
}

/** The tool a result answers, by its call's id among the request's own calls. */
export function toolOfResult(m: ChatMessage, added: ChatMessage[]): string | null {
  if (m.role !== 'tool' || !m.toolCallId) return null
  for (const a of added) for (const c of a.toolCalls ?? []) if (c.id === m.toolCallId) return c.name
  return null
}
