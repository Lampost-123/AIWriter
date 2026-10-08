// Settings › About in the New look: "What's new" in the version running, read from the release notes this build was
// made with (build/release-notes.md, the same words as the release page). Pure parsing, so it is unit-tested.

/** The notes' version and their points, or null when they are for another version than `version` (or empty). */
export function notesFor(raw: string, version: string | null): { version: string; points: string[] } | null {
  const marker = /<!--\s*version:\s*([\w.-]+)\s*-->/.exec(raw)
  const noted = marker?.[1] ?? null
  if (!noted || !version || noted !== version) return null
  const points = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''))
  return points.length ? { version: noted, points } : null
}
