// Why something failed, as a sentence for Adam. No imports, so it is unit-tested.

/** Said for a part of AI Write that this version doesn't have yet (the main side says "Not built yet"). */
export const NOT_READY = "This isn't ready yet in this version of AI Write."

/** The reason something failed, as one plain sentence ending in a full stop. */
export function plainReason(err: unknown): string {
  const msg = (err instanceof Error ? err.message : typeof err === 'string' ? err : '').trim()
  if (/not built yet/i.test(msg)) return NOT_READY
  if (!msg) return 'Something went wrong.'
  return /[.!?]$/.test(msg) ? msg : `${msg}.`
}
