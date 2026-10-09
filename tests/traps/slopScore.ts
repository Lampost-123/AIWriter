// The "not X, but Y" family of contrast patterns, for the held-out prose measure (prose.ts heldOut). The app's own
// code never uses these: they measure what nothing in the writer aims at, so they stay a fair test.
//
// Ported from slop-score by Sam Paech, js/regexes-stage1.js (the ten surface regexes) and the sentence merging of
// js/contrast-detector.js and js/utils.js (normalizeText, sentenceSpans), https://github.com/sam-paech/slop-score,
// read 2026-10-08. The regex sources are unchanged; the port to TypeScript is AI Write's.
//
// MIT License
//
// Copyright (c) 2025 Sam Paech
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const MAXG = 160

const PRON = '(?:it|they|this|that)'
const BE = '(?:is|are|was|were)'
const BE_NEG = "(?:is\\s+not|are\\s+not|was\\s+not|were\\s+not|isn't|aren't|wasn't|weren't|ain't)"

// 1) "not X, but Y"
const RE_NOT_BUT = new RegExp(
  `\\b(?:(?:${BE_NEG})|not(?!\\s+(?:that|only)\\b))\\s+` +
    `(?:(?!\\bbut\\b|[.?!]).)` +
    `{1,100}?` +
    `[,;:]\\s*but\\s+` +
    `(?!when\\b|while\\b|which\\b|who\\b|whom\\b|whose\\b|where\\b|if\\b|that\\b|as\\b|because\\b|although\\b|though\\b|till\\b|until\\b|unless\\b|` +
    `here\\b|there\\b|then\\b|my\\b|we\\b|I\\b|you\\b|it\\s+seems\\b|it\\s+appears\\b|it\\s+felt\\b|it\\s+looks?\\b|anything\\b)`,
  'gi'
)

// 2) Dash form "… not/n't … — pron + (BE or lexical) …"
const RE_NOT_DASH = new RegExp(
  `\\b(?:\\w+n't|not)\\s+(?:just|only|merely)?\\s+` +
    `(?:(?![.?!]).){1,${MAXG}}?` +
    `(?:-|\\s-\\s|[\\u2014\\u2013])\\s*` +
    `${PRON}\\s+(?:(?:'re|are|'s|is|were|was)\\b|(?!'re|are|'s|is|were|was)[*_~]*[a-z]\\w*)`,
  'gi'
)

// 3) Pronoun-led "It/They … not … . It/They BE …"
const RE_PRON_BE_NOT_SEP_BE = new RegExp(
  `(?:(?<=^)|(?<=[.?!]\\s))\\s*[""']?` +
    `(?:(?:${PRON}\\s+${BE}\\s+not)|(?:${PRON}\\s+${BE}n't)|(?:it's|they're|that's)\\s+not)\\b` +
    `[^.?!]{0,${MAXG}}[.;:?!]\\s*[""']?` +
    `${PRON}\\s+(?:${BE}|(?:'s|'re))\\b(?!\\s+not\\b)`,
  'gi'
)

// 4) NP-led "… was/weren't not … . It/They BE …" with reporter-frame + "not put" guards
const RE_NP_BE_NOT_SEP_THEY_BE = new RegExp(
  `(?:(?<=^)|(?<=[.?!]\\s))\\s*` +
    `(?![^.?!]{0,80}\\b(?:knew|know|thought|think|said|says|told|heard|learned)\\b[^.?!]{0,40}?\\bthat\\b)` +
    `(?!\\s*not\\s+without\\b)` +
    `(?![^.?!]{0,50}\\bnot\\s+put\\b)` +
    `[^.?!]{0,${MAXG}}?\\b(?:${BE_NEG})\\b[^.?!]{0,${MAXG}}[.;:?!]\\s*` +
    `[""']?${PRON}\\b(?:'re|\\s+(?:are|were|is|was))\\b(?!\\s+not\\b)`,
  'gi'
)

// 5) "no longer … ; it/they was …"
const RE_NO_LONGER = new RegExp(
  `(?:(?<=^)|(?<=[.?!]\\s))\\s*[^.?!]{0,${MAXG}}\\bno\\s+longer\\b[^.;:?!]{0,${MAXG}}` + `[.;:?!]\\s*(?:it|they|this|that)\\s+(?:is|are|was|were)\\b(?!\\s+not\\b)`,
  'gi'
)

// 6) "not just … . It/They …"
const RE_NOT_JUST_SEP = new RegExp(
  `(?:(?<=^)|(?<=[.?!]\\s))\\s*[""']?` +
    `${PRON}\\b(?:'s|'re|\\s+(?:is|are|was|were))?\\s+not\\s+just\\b[^.?!]{0,${MAXG}}[.?!]\\s*[""']?` +
    `${PRON}\\b(?:'s|'re|\\s+(?:is|are|was|were))\\b(?!\\s+not\\b)`,
  'gi'
)

// 7) Cross-sentence same-verb: "didn't V. It/They V…"
const RE_NOT_PERIOD_SAMEVERB = new RegExp(
  `(?:(?<=^)|(?<=[.?!]\\s))[^.?!]*?\\b(?:do|does|did)n't\\b\\s+` + `(?:(?:\\w+\\s+){0,2})([a-z]{3,})\\b[^.?!]*[.?!]\\s*` + `${PRON}\\s+\\1(?:ed|es|s|ing)?\\b`,
  'gi'
)

// 8) Simple BE: "… isn't/wasn't … . It's/It is …" (+ reporter-frame guard)
const RE_SIMPLE_BE_NOT_IT_BE = new RegExp(
  `(?:(?<=^)|(?<=[.?!]\\s))\\s*[""']?` +
    `(?!he\\b|she\\b|i\\b|you\\b|we\\b)` +
    `(?![^.?!]{0,80}\\b(?:knew|know|thought|think|said|says|told|heard|learned)\\b[^.?!]{0,40}?\\bthat\\b)` +
    `[^.?!]{0,${MAXG}}?\\b${BE_NEG}\\b[^.?!]{0,${MAXG}}[.;:?!]\\s*` +
    `[""']?it(?:'s|\\s+(?:is|are|was|were))\\b`,
  'gi'
)

// 9) Embedded "not just … ; It/They …" (allows a lead-in like "That means …")
const RE_EMBEDDED_NOT_JUST_SEP = new RegExp(
  `(?:(?<=^)|(?<=[.?!]\\s))` +
    `[^.?!]{0,80}?\\b(?:(?:it|they)\\s+(?:is|are)|(?:it's|they're))\\s+not\\s+just\\b` +
    `[^.?!]{0,${MAXG}}[.?!]\\s*` +
    `(?:(?:it|they)\\s+(?:is|are)|(?:it's|they're))\\b`,
  'gi'
)

// 10) Dialogue-aware: "You're not just X," <said Y>. "You're Z."
const RE_DIALOGUE_NOT_JUST = new RegExp(
  `[""']?${PRON}(?:'re|'s|\\s+(?:are|is|was|were))\\s+not\\s+just\\b[^""']{0,${MAXG}}[""']?\\s*` +
    `(?:[^.?!]{0,80}\\b(?:said|asked|whispered|muttered|replied|added|shouted|cried)\\b[^.?!]{0,80}[.?!]\\s*)?` +
    `[""']?${PRON}(?:'re|'s|\\s+(?:are|is|was|were))\\s+[*_~]?[a-z]\\w*`,
  'gi'
)

export const STAGE1_REGEXES: Record<string, RegExp> = {
  RE_NOT_BUT,
  RE_NOT_DASH,
  RE_PRON_BE_NOT_SEP_BE,
  RE_NP_BE_NOT_SEP_THEY_BE,
  RE_NO_LONGER,
  RE_NOT_JUST_SEP,
  RE_NOT_PERIOD_SAMEVERB,
  RE_SIMPLE_BE_NOT_IT_BE,
  RE_EMBEDDED_NOT_JUST_SEP,
  RE_DIALOGUE_NOT_JUST
}

/** slop-score's normalizeText: curly quotes made straight, long dashes made hyphens. */
export function normalizeText(text: string): string {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[—–]/g, '-')
}

/** slop-score's sentenceSpans: [start, end) of each sentence (up to and with its stop), the rest as the last. */
export function sentenceSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  let last = 0
  for (const m of text.matchAll(/[^.!?]*[.!?]/gs)) {
    spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
    last = (m.index ?? 0) + m[0].length
  }
  if (last < text.length) spans.push([last, text.length])
  return spans
}

/** One contrast found: the pattern, and the sentences it covers. */
export interface ContrastHit {
  pattern: string
  sentence: string
}

/**
 * The contrasts in a text, as slop-score counts them at stage 1: every match of the ten patterns, mapped to the
 * sentences it covers, overlapping ones merged into one.
 */
export function contrastHits(text: string): ContrastHit[] {
  const t = normalizeText(text)
  const spans = sentenceSpans(t)
  if (!spans.length) return []
  const items: { lo: number; hi: number; start: number; pattern: string }[] = []
  for (const [name, re] of Object.entries(STAGE1_REGEXES)) {
    for (const m of t.matchAll(new RegExp(re.source, re.flags))) {
      const s = m.index ?? 0
      const e = s + m[0].length
      if (s >= e) continue
      // The sentences the match covers: the first whose end is past its start, to the last that starts before its end.
      const lo = spans.findIndex(([, end]) => end > s)
      let hi = -1
      for (let k = spans.length - 1; k >= 0; k--)
        if (spans[k][0] < e) {
          hi = k
          break
        }
      if (lo < 0 || hi < lo) continue
      items.push({ lo, hi, start: s, pattern: name })
    }
  }
  items.sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.start - b.start)
  const merged: typeof items = []
  for (const it of items) {
    const cur = merged[merged.length - 1]
    if (cur && it.lo <= cur.hi) cur.hi = Math.max(cur.hi, it.hi)
    else merged.push({ ...it })
  }
  return merged.map((m) => ({ pattern: m.pattern, sentence: t.slice(spans[m.lo][0], spans[m.hi][1]).trim() }))
}
