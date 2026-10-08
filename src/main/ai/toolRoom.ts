// The editor chat's room for what its tools bring back. Its own small file (pure, no imports) so both the briefing
// (ai/context.ts, computeBudget) and the tool loop (ai/tasks.ts) use the same figure.

/** This share of the context is kept for tool results... */
export const TOOL_ROOM_SHARE = 0.2
/** ...but never more than this many tokens (a whole scene read is about 7,000; a big model needs no more than a few). */
export const TOOL_ROOM_MOST = 12_000
/** Context length assumed when the model's is unknown (as ai/context.ts and ai/tasks.ts assume). */
const UNKNOWN_CONTEXT = 16_000

/**
 * Room kept free, beside the reply's, for what the editor chat's tools bring back over its steps (read_scene alone can
 * bring 24,000 characters): a fifth of the context, at most TOOL_ROOM_MOST tokens. The briefing is fitted without it
 * (computeBudget's `toolRoom`), and the chat's reply limit leaves it free (ai/tasks.ts), so tool results have that much
 * room before the oldest are taken out again (ai/tasks.ts, fitToRoom).
 */
export function toolRoomFor(contextLength: number | null | undefined): number {
  const length = contextLength && contextLength > 0 ? contextLength : UNKNOWN_CONTEXT
  return Math.min(TOOL_ROOM_MOST, Math.ceil(length * TOOL_ROOM_SHARE))
}
