// What the scene has on the page already, found by the app with no model call (Adam, 2026-10-08). An audit of 122 real
// writer calls found the same lines coming back step after step: a character's sample line word for word ("That's the
// way of it" in 14 of 122), stock tics ("the rain went on…" in 27, "neither of them said…" in 11). The writer round
// listed them in the closing instruction; since 0.6.35 the writer prompt names no phrase (naming one can prime it), and
// the stock tics are found after writing and said afresh instead (repair/slop.ts). Also: which beats of the scene card
// are on the page already (Add below), and which sample lines are speech at all (a sample line that is narration is no
// voice). Pure.

/** Stock tics a writer model falls back on, as found in the audit; said afresh after writing (repair/slop.ts). */
export const STOCK_TICS: { label: string; re: RegExp }[] = [
  { label: 'the rain went on', re: /\bthe rain (?:went|kept) on\b/i },
  { label: 'neither of them said', re: /\bneither of them (?:said|spoke)\b/i },
  { label: 'for a long moment', re: /\bfor a long moment\b/i },
  { label: 'the silence stretched', re: /\bthe silence (?:stretched|settled|hung)\b/i },
  { label: 'let out a breath', re: /\blet out a (?:long |slow |shaky )?breath\b/i },
  { label: 'something shifted', re: /\bsomething (?:shifted|changed) (?:in|between)\b/i },
  { label: 'and that was enough', re: /\band that was enough\b/i },
  { label: 'which was answer enough', re: /\bwhich was (?:answer|all the answer) enough\b/i }
]

const norm = (s: string): string => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
const wordsOf = (s: string): string[] => norm(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? []

/**
 * The speech in a character's sample lines, one line each: the words inside quote marks when a line has them (never the
 * narration around them), else the line itself unless it reads as narration ("He looked at the fire.").
 */
export function speechSamples(text: string | null | undefined): string[] {
  const out: string[] = []
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s+/, '')
    if (!line) continue
    const quoted = [
      ...[...line.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1]),
      ...[...line.matchAll(/(?:^|[\s(—–-])‘(.+?)’(?![\p{L}])/gu)].map((m) => m[1]),
      ...[...line.matchAll(/(?:^|[\s(—–-])'(.+?)'(?![\p{L}])/gu)].map((m) => m[1])
    ]
      .map((q) => q.trim().replace(/[,]$/, ''))
      .filter((q) => wordsOf(q).length >= 1)
    if (quoted.length) {
      out.push(...quoted)
      continue
    }
    if (/[“”‘"]/.test(line)) continue
    if (/^(he|she|they|it|his|her|their|the|a|an|then|when|as|there)\b/i.test(line)) continue
    if (/\b(said|says|asked|asks|replied|muttered|whispered|shouted|told)\b/i.test(line)) continue
    out.push(line)
  }
  return [...new Set(out)]
}

// Which beats of the scene card are on the page already: shared with the desk's next-beat chip (src/shared/beats.ts).
export { beatsOnPage } from '@shared/beats'
