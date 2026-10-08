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

const STOP = new Set(
  (
    'a an the and or but if so as at by for from in into of off on onto out over to up with without about after before ' +
    'he she it they them him her his hers its their theirs i me my we us our you your this that these those there here ' +
    'was were is are be been being had has have do did does not no nor then than too very just only all any some ' +
    'what which who whom when where why how one two'
  ).split(' ')
)

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

const stem = (w: string): string => (w.length > 4 ? w.slice(0, 4) : w)

/**
 * How many of the scene card's beats, from the first, are on the page already (Add below, Adam 2026-10-08: "They talk
 * about what comes next" was written at steps 1, 6 and 11, since nothing marked a beat done). A beat is on the page
 * when most of its own words (not little ones; matched by their first four letters) are in the scene so far, at least
 * two of them (both, for a beat of two); beats come in order, so every beat before the last one found is done.
 */
export function beatsOnPage(beats: readonly string[], soFar: string | null | undefined): number {
  const page = new Set(wordsOf(soFar ?? '').map(stem))
  if (!page.size) return 0
  let done = 0
  beats.forEach((b, i) => {
    const own = [...new Set(wordsOf(b).filter((w) => !STOP.has(w) && w.length >= 3).map(stem))]
    if (own.length < 2) return
    const hit = own.filter((w) => page.has(w)).length
    const need = own.length <= 2 ? own.length : Math.ceil(own.length * 0.6)
    if (hit >= need) done = i + 1
  })
  return done
}
