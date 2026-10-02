// Words for "deleted" toasts. No React, so it can be unit-tested.

/** What was deleted, for counting: e.g. ['scene', 'scenes']. */
export type Noun = readonly [one: string, many: string]

/**
 * The toast for several deletes at once: "2 scenes deleted.", "1 chapter and 2 scenes deleted.",
 * "2 scenes, 1 chapter and 1 character deleted." Nouns are listed in the order they were first deleted.
 */
export function deletedSummary(nouns: readonly Noun[]): string {
  const counts = new Map<string, { noun: Noun; n: number }>()
  for (const noun of nouns) {
    const c = counts.get(noun[0])
    if (c) c.n++
    else counts.set(noun[0], { noun, n: 1 })
  }
  const parts = [...counts.values()].map(({ noun, n }) => `${n} ${n === 1 ? noun[0] : noun[1]}`)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'Nothing')
  return `${list} deleted.`
}
