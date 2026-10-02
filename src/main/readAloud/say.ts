// Adapted from mcreader-v2, src/lib/speech/say.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026).
//
// "Say it as": how the voice says the names a narrator would misread. An entry's `say` is either a respelling
// of its name ("shiv-AWN") or, for a name of several words, pairs for the words that need it ("Siobhan =
// shiv-AWN; Nguyen = win"). The words are swapped in the text sent to the voice only, never on the page.

export interface SayRule {
  word: string
  say: string
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The rules one entry gives. */
export function sayRules(e: { name: string; say?: string }): SayRule[] {
  const raw = e.say?.trim()
  if (!raw) return []
  if (raw.includes('=')) {
    return raw.split(/[;\n]+/).flatMap((pair) => {
      const [word, say] = pair.split('=').map((x) => x.trim())
      return word && say ? [{ word, say }] : []
    })
  }
  const name = e.name.trim()
  if (!name) return []
  // One respelling for the whole name; its first word alone (how the page mostly names a person) is left as
  // it is, since the respelling is for all of it.
  return [{ word: name, say: raw }]
}

/** Every rule in the world, longest word first so "Aris Thorne" is swapped before "Aris". */
export function lexiconOf(entries: readonly { name: string; say?: string }[] | undefined): SayRule[] {
  const seen = new Set<string>()
  return (entries ?? [])
    .flatMap(sayRules)
    .filter((r) => {
      const k = r.word.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => b.word.length - a.word.length)
}

/**
 * The text as the voice should read it: each name swapped for its respelling, whole words only, and only as the
 * name is written (capitalised, or in capitals), so a place called Reading leaves "she kept reading" alone.
 */
export function sayAs(text: string, rules: readonly SayRule[]): string {
  if (!rules.length || !text) return text
  const forms = (w: string): string[] => [...new Set([w, w[0]!.toUpperCase() + w.slice(1), w.toUpperCase()])]
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${rules
      .flatMap((r) => forms(r.word))
      .map(escape)
      .join('|')})(?![\\p{L}\\p{N}])`,
    'gu'
  )
  const by = new Map(rules.map((r) => [r.word.toLowerCase(), r.say]))
  return text.replace(re, (m) => by.get(m.toLowerCase()) ?? m)
}
