// Matching a name the AI gave to one of the world's entries (the interview's fill, chapter cards). No imports
// beyond types, so anything in the outline helper can use it without import loops.
import type { ID } from '@shared/types'

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The entry a name means: its name or an alias exactly, else the only one whose name starts with it ("Mara" for "Mara Venn"). */
export function matchEntry<T extends { id: ID; name: string; aliases: string[] }>(name: string, entries: T[]): T | null {
  const n = norm(name)
  if (!n) return null
  const exact = entries.filter((e) => [e.name, ...e.aliases].some((a) => norm(a) === n))
  if (exact.length) return exact[0]
  const starts = entries.filter((e) => [e.name, ...e.aliases].some((a) => norm(a).startsWith(`${n} `) || n.startsWith(`${norm(a)} `)))
  return starts.length === 1 ? starts[0] : null
}
