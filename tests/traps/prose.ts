// The prose check (Adam, 2026-10-08): how the AI writes, not only what it keeps true. An audit of 122 real writer
// calls (rounds 7 and 8) found Add below inventing action to reach its length, closing the scene off, doing the card's
// beats again; sample lines of dialogue copied word for word ("That's the way of it" in 14 of 122); tics ("the rain
// went on" in 27, "neither of them said" in 11); phrases echoed from step to step. These metrics measure that with no
// model call, from the passage, the scene before it and the writer's own prompt; the judge adds a 1 to 5 rubric in the
// call it makes anyway (judge.ts). Pure, so it can be tested and run again offline (--rescore).

import { outsideQuotes, sentences } from './patterns'
import { contrastHits } from './slopScore'
import { echoesInScene, repeatedParas } from './echo'

/** The judge's 1 to 5 marks for one passage (null: not rated, or unreadable). */
export interface ProseRubric {
  voices: number | null
  subtext: number | null
  direction: number | null
  ending: number | null
}

export const RUBRIC_KEYS = ['voices', 'subtext', 'direction', 'ending'] as const

export interface ProseMetrics {
  words: number
  /** Words asked for (Add below, Generate, a beat); null for Continue, which sets its own length. */
  target: number | null
  /** words / target. */
  ratio: number | null
  /** Share of the passage's 4-word runs already in the scene before it: recap. */
  recap: number
  /** The first sentence shares two or more 4-word runs with the last paragraph before it. */
  openingEcho: boolean
  /** 6-word runs of this passage already used in an earlier AI step of the same chain, and one of them. */
  echoes: number
  echo: string | null
  /** Sample lines of dialogue from the writer's prompt that the passage copies word for word. */
  voiceLines: string[]
  /** Stock tics found, with how often. */
  tics: { tic: string; n: number }[]
  /** The words that close the scene off at the passage's end (sleep, silence, a summing-up), or null. */
  closing: string | null
  /** "and" per 100 words. */
  andRate: number
  /** The scene card's beats (1-based) this passage does again, after the scene had already done them. */
  beatsRedone: number[]
  /** The judge's marks, when it rated the passage. */
  rubric?: ProseRubric
  // Held-out measures: nothing in the writer aims at them, so they stay a fair test. Older reports lack them.
  /** "not X, but Y" contrasts (slop-score's stage-1 patterns, slopScore.ts), and per 1,000 words. */
  contrasts?: number
  contrastRate?: number
  /** Paragraphs, and one-line fragment paragraphs among them (5 words or fewer, no speech), and their share. */
  paragraphs?: number
  fragments?: number
  fragmentRate?: number
  /** Different 5-word runs of this passage already in an earlier step of the same chain. */
  repeat5?: number
  /** Paragraphs of this passage already on the page, word for word or nearly (echo.ts repeatedParas). */
  repeatedParas?: number
  /** What the scene says twice with the second time in this passage, a line of dialogue included (echo.ts echoesInScene). */
  sceneEchoes?: number
}

const paragraphsIn = (text: string): string[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

/** A one-line fragment paragraph: 5 words or fewer on one line, with no speech in it (EQ-Bench Longform's penalty). */
export const isFragment = (para: string): boolean => {
  const p = para.trim()
  const n = wordsOf(p).length
  return !!p && !/\n/.test(p) && !/["“”]|(?:^|\s)[‘']/.test(p) && n > 0 && n <= 5
}

/** The held-out measures of one passage (see ProseMetrics), from its words, the page before it and the earlier steps. */
export function heldOut(
  text: string,
  before: string,
  earlier: string[] = []
): Required<Pick<ProseMetrics, 'contrasts' | 'contrastRate' | 'paragraphs' | 'fragments' | 'fragmentRate' | 'repeat5' | 'repeatedParas' | 'sceneEchoes'>> {
  const w = wordsOf(text)
  const contrasts = contrastHits(text).length
  const paras = paragraphsIn(text)
  const fragments = paras.filter(isFragment).length
  const earlier5 = new Set(earlier.flatMap((t) => runs(wordsOf(t), 5)))
  const page = paragraphsIn(before)
  const echoes = echoesInScene([...page, ...paras]).filter((e) => e.again >= page.length)
  return {
    contrasts,
    contrastRate: w.length ? (contrasts / w.length) * 1000 : 0,
    paragraphs: paras.length,
    fragments,
    fragmentRate: paras.length ? fragments / paras.length : 0,
    repeat5: [...new Set(runs(w, 5))].filter((g) => earlier5.has(g)).length,
    repeatedParas: repeatedParas(paras, page).length,
    sceneEchoes: echoes.length
  }
}

/** Lower-case words, with straight apostrophes made curly ("that's" and "that’s" are one word). */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/'/g, '’').match(/[a-z’]+/g) ?? []
}

const runs = (w: string[], n: number): string[] => {
  const out: string[] = []
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '))
  return out
}

/** A saved request's text (its messages, as the world records them: a JSON list), every message in turn. */
export function promptText(messagesJson: string): string {
  try {
    const list = JSON.parse(messagesJson) as { content?: unknown }[]
    return Array.isArray(list) ? list.map((m) => (typeof m?.content === 'string' ? m.content : '')).join('\n\n') : ''
  } catch {
    return ''
  }
}

/**
 * The sample lines of dialogue in a writer's prompt ("- Sample lines of dialogue:" then one indented line each), with
 * their quote marks and dialogue tags as written.
 */
export function sampleLines(prompt: string): string[] {
  const out: string[] = []
  const lines = prompt.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-\s*Sample lines of dialogue:\s*$/i.test(lines[i])) continue
    for (let k = i + 1; k < lines.length && /^\s{2,}\S/.test(lines[k]); k++) out.push(lines[k].trim())
  }
  return [...new Set(out)]
}

/**
 * Whether a passage copies a sample line: the whole line (four words or more), or, for a long line, any eight words of
 * it in a row. Shorter lines ("To anyone. Ever.") are too common to tell.
 */
export function copiesLine(passageWords: string[], line: string): boolean {
  const w = wordsOf(line)
  if (w.length < 4) return false
  const have = new Set(runs(passageWords, Math.min(w.length, 8)))
  return runs(w, Math.min(w.length, 8)).some((r) => have.has(r))
}

/** Stock tics the audit found again and again, and a few the writer's own instructions forbid. */
export const TICS: { tic: string; re: RegExp }[] = [
  { tic: 'the rain went on', re: /\bthe rain (?:went|kept|was going) on\b/gi },
  { tic: 'neither of them said', re: /\bneither of them (?:said|spoke|moved|troubled)\b/gi },
  { tic: 'said nothing more', re: /\b(?:said nothing (?:more|else)|said anything (?:more|else)|did not say anything|didn['’]t say anything)\b/gi },
  { tic: 'unhurried', re: /\bunhurried\b/gi },
  { tic: 'did not ask', re: /\b(?:did not|didn['’]t) ask\b/gi },
  { tic: 'the whole of it', re: /\bthe whole of it\b/gi },
  { tic: 'red core', re: /\bred core\b/gi },
  { tic: 'three knocks', re: /\bthree (?:soft |quick |slow |short )?(?:taps|knocks|raps)\b/gi },
  { tic: 'a long while', re: /\ba long while\b/gi },
  { tic: 'stock phrase', re: /\b(?:a breath (?:she|he) didn['’]t know|the words hung in the air|a testament to|a tapestry of|something flickered|a shiver (?:ran|went) down)\b/gi }
]

export function ticsIn(text: string): { tic: string; n: number }[] {
  return TICS.map(({ tic, re }) => ({ tic, n: (text.match(re) ?? []).length })).filter((x) => x.n > 0)
}

/** How a passage closes the scene off: sleep, silence, the night going on, a summing-up line. */
export const CLOSING =
  /\b(?:slept|asleep|fell asleep|sleep (?:came|took)|closed (?:her|his) eyes|drifted off|and that was (?:that|all|enough)|(?:it|that) was enough|nothing (?:more|else) (?:to say|was said)|neither of them (?:said|spoke)|said nothing (?:more|else)|(?:the )?(?:fire|lamp|candle) (?:burned|burnt|died|sank|guttered) (?:down|low|out)|the (?:night|rain|sea) went on|(?:until|till) (?:morning|the morning|dawn|first light)|lay (?:awake|listening)|the house (?:was quiet|went quiet|slept))\b/i

/** The closing-off words in a passage's last sentence of narration (and the one before, when the last is short), or null. */
export function closingOf(text: string): string | null {
  const narration = outsideQuotes(text.trim())
  const ss = sentences(narration).filter((s) => /[a-z]/i.test(s.text))
  const last = ss.slice(-1)
  const tail = last.length && wordsOf(last[0].text).length < 6 ? ss.slice(-2) : last
  for (const s of tail) {
    const m = CLOSING.exec(s.text)
    if (m) return m[0]
  }
  return null
}

/** What is said aloud in a passage (everything between quote marks), the rest blanked. */
export function speechOf(text: string): string {
  const narration = outsideQuotes(text)
  let out = ''
  for (let i = 0; i < text.length; i++) out += narration[i] === ' ' && text[i] !== ' ' ? text[i] : narration[i] === '\n' ? '\n' : ' '
  return out
}

/** A scene card beat, and how it shows on the page (in the narration, or said aloud). */
export interface BeatSign {
  beat: string
  sign: RegExp
  /** Shown only by what is said aloud (talk about what comes next). */
  spoken?: boolean
  /** Shown only with this many different matches (a talk about plans, not one "in the morning"); default 1. */
  min?: number
}

/** The beats (1-based) a text shows. */
export function beatsShown(text: string, beats: BeatSign[]): number[] {
  const narration = outsideQuotes(text)
  const speech = speechOf(text)
  return beats.flatMap((b, i) => {
    const flags = b.sign.flags.includes('g') ? b.sign.flags : `${b.sign.flags}g`
    const found = new Set([...(b.spoken ? speech : narration).matchAll(new RegExp(b.sign.source, flags))].map((m) => m[0].toLowerCase()))
    return found.size >= (b.min ?? 1) ? [i + 1] : []
  })
}

export interface ProseInput {
  text: string
  /** The scene's words before this passage. */
  before: string
  target: number | null
  /** Sample lines of dialogue the writer was sent. */
  samples: string[]
  /** Earlier AI steps of the same chain (for phrases echoed from step to step). */
  earlier?: string[]
  /** The scene card's beats, with how each shows on the page. */
  beats?: BeatSign[]
}

/** The prose metrics of one passage. No model call. */
export function proseMetrics(p: ProseInput): ProseMetrics {
  const w = wordsOf(p.text)
  const four = new Set(runs(w, 4))
  const before4 = new Set(runs(wordsOf(p.before), 4))
  const recap = four.size ? [...four].filter((g) => before4.has(g)).length / four.size : 0
  const lastPara = p.before.trim().split(/\n\s*\n/).pop() ?? ''
  const first = sentences(p.text.trim())[0]?.text ?? ''
  const last4 = new Set(runs(wordsOf(lastPara), 4))
  const openingEcho = runs(wordsOf(first), 4).filter((g, i, all) => all.indexOf(g) === i && last4.has(g)).length >= 2
  const earlier6 = new Set((p.earlier ?? []).flatMap((t) => runs(wordsOf(t), 6)))
  const echoed = [...new Set(runs(w, 6))].filter((g) => earlier6.has(g))
  const voiceLines = p.samples.filter((line) => copiesLine(w, line))
  const ands = w.filter((x) => x === 'and').length
  const beats = p.beats ?? []
  const done = new Set(beatsShown(p.before, beats))
  return {
    words: w.length,
    target: p.target,
    ratio: p.target ? w.length / p.target : null,
    recap,
    openingEcho,
    echoes: echoed.length,
    echo: echoed[0] ?? null,
    voiceLines,
    tics: ticsIn(p.text),
    closing: closingOf(p.text),
    andRate: w.length ? (ands / w.length) * 100 : 0,
    beatsRedone: beatsShown(p.text, beats).filter((b) => done.has(b)),
    ...heldOut(p.text, p.before, p.earlier ?? [])
  }
}

// ---------- Summing up ----------

/** One measured passage, with where it was written (for the worst examples). */
export interface ProseEntry {
  where: string
  kind: string
  text: string
  prose: ProseMetrics
}

export interface ProseSummary {
  passages: number
  /** Median words / target, and how many passages ran over 1.5 times the length asked. */
  ratio: number | null
  overLength: number
  withTarget: number
  recap: number | null
  openingEcho: number
  /** Median echoed 6-word runs per passage, and passages with any. */
  echoes: number | null
  withEchoes: number
  /** Passages copying a sample line, and the lines most copied. */
  voiceCopies: number
  topLines: { line: string; n: number }[]
  /** Passages with a tic, and the tics by passages. */
  withTics: number
  topTics: { tic: string; n: number }[]
  closing: number
  andRate: number | null
  beatsRedone: number
  /** The judge's marks: medians and how many passages it rated. */
  rubric: Record<(typeof RUBRIC_KEYS)[number], number | null> & { rated: number }
  /** The worst examples, at most a line each. */
  worst: string[]
  /** Held-out: contrasts per 1,000 words and fragment share (means), 5-word repeats (median), passages with a repeated paragraph or a scene echo; null or 0 when no passage was measured for them. */
  heldOut?: { measured: number; contrastRate: number | null; fragmentRate: number | null; repeat5: number | null; withRepeatedParas: number; withSceneEchoes: number }
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const clip = (s: string, n = 110): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

const tally = <T extends string>(items: T[]): { key: T; n: number }[] => {
  const m = new Map<T, number>()
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n)
}

export function summariseProse(entries: ProseEntry[]): ProseSummary {
  const ms = entries.map((e) => e.prose)
  const withTarget = ms.filter((m) => m.ratio != null)
  const rated = ms.filter((m) => m.rubric && RUBRIC_KEYS.some((k) => m.rubric![k] != null))
  const rubric = { rated: rated.length } as ProseSummary['rubric']
  for (const k of RUBRIC_KEYS) rubric[k] = median(rated.map((m) => m.rubric![k]).filter((x): x is number => x != null))
  const worst: string[] = []
  const byRecap = [...entries].sort((a, b) => b.prose.recap - a.prose.recap)[0]
  if (byRecap && byRecap.prose.recap >= 0.1) worst.push(`Most recap (${Math.round(byRecap.prose.recap * 100)}%), ${byRecap.where}: “${clip(sentences(byRecap.text)[0]?.text ?? '')}”`)
  const longest = [...entries].filter((e) => e.prose.ratio != null).sort((a, b) => b.prose.ratio! - a.prose.ratio!)[0]
  if (longest && longest.prose.ratio! > 1.5) worst.push(`Longest against its target (${longest.prose.words} words for ${longest.prose.target}), ${longest.where}`)
  const echo = entries.filter((e) => e.prose.echo).sort((a, b) => b.prose.echoes - a.prose.echoes)[0]
  if (echo) worst.push(`Echoed from an earlier step (${echo.prose.echoes} six-word runs), ${echo.where}: “${echo.prose.echo}”`)
  const lines = tally(ms.flatMap((m) => m.voiceLines))
  if (lines[0]) worst.push(`Sample line copied most (${lines[0].n} passages): “${clip(lines[0].key, 80)}”`)
  const closing = entries.find((e) => e.prose.closing)
  if (closing) worst.push(`Closes the scene off, ${closing.where}: “${clip(sentences(closing.text.trim()).pop()?.text ?? '')}”`)
  const redone = entries.find((e) => e.prose.beatsRedone.length)
  if (redone) worst.push(`Does beat ${redone.prose.beatsRedone.join(' and ')} again, ${redone.where}`)
  const tics = tally(ms.flatMap((m) => m.tics.map((t) => t.tic)))
  return {
    passages: entries.length,
    ratio: median(withTarget.map((m) => m.ratio!)),
    overLength: withTarget.filter((m) => m.ratio! > 1.5).length,
    withTarget: withTarget.length,
    recap: median(ms.map((m) => m.recap)),
    openingEcho: ms.filter((m) => m.openingEcho).length,
    echoes: median(ms.map((m) => m.echoes)),
    withEchoes: ms.filter((m) => m.echoes > 0).length,
    voiceCopies: ms.filter((m) => m.voiceLines.length).length,
    topLines: lines.slice(0, 3).map((x) => ({ line: x.key, n: x.n })),
    withTics: ms.filter((m) => m.tics.length).length,
    topTics: tics.slice(0, 4).map((x) => ({ tic: x.key, n: x.n })),
    closing: ms.filter((m) => m.closing).length,
    andRate: median(ms.map((m) => m.andRate)),
    beatsRedone: ms.filter((m) => m.beatsRedone.length).length,
    rubric,
    worst: worst.slice(0, 6),
    ...heldOutSummary(ms)
  }
}

/** The held-out measures summed up, over the passages that have them (older reports' passages don't). */
function heldOutSummary(ms: ProseMetrics[]): Pick<ProseSummary, 'heldOut'> {
  const h = ms.filter((m) => m.contrastRate != null)
  if (!h.length) return {}
  return {
    heldOut: {
      measured: h.length,
      contrastRate: avg(h.map((m) => m.contrastRate!)),
      fragmentRate: avg(h.map((m) => m.fragmentRate ?? 0)),
      repeat5: median(h.map((m) => m.repeat5 ?? 0)),
      withRepeatedParas: h.filter((m) => (m.repeatedParas ?? 0) > 0).length,
      withSceneEchoes: h.filter((m) => (m.sceneEchoes ?? 0) > 0).length
    }
  }
}

const pc = (v: number | null): string => (v == null ? '–' : `${Math.round(v * 100)}%`)
const n1 = (v: number | null): string => (v == null ? '–' : v.toFixed(1))
const of = (n: number, all: number): string => `${n} of ${all}`

/** The prose table's rows: [what, value], so a run and a comparison share them. */
export function proseRows(s: ProseSummary): [string, string][] {
  return [
    ['Passages measured', String(s.passages)],
    ['Length against the words asked (median; over 1.5 times)', s.withTarget ? `${n1(s.ratio)}×; ${of(s.overLength, s.withTarget)}` : '–'],
    ['Recap: 4-word runs already in the scene (median)', pc(s.recap)],
    ['Opening echoes the last paragraph', of(s.openingEcho, s.passages)],
    ['Echoes from earlier steps: 6-word runs (median; passages with any)', `${n1(s.echoes)}; ${of(s.withEchoes, s.passages)}`],
    ['Sample lines of dialogue copied word for word', `${of(s.voiceCopies, s.passages)}${s.topLines[0] ? ` (most: “${clip(s.topLines[0].line, 40)}”, ${s.topLines[0].n})` : ''}`],
    ['Stock tics', `${of(s.withTics, s.passages)}${s.topTics.length ? ` (${s.topTics.map((t) => `${t.tic} ${t.n}`).join(', ')})` : ''}`],
    ['Ends by closing the scene off', of(s.closing, s.passages)],
    ['"and" per 100 words (median)', n1(s.andRate)],
    ['Does a card beat again', of(s.beatsRedone, s.passages)],
    [
      `Judge, 1 to 5 (median; ${s.rubric.rated} rated): voices, subtext, direction, ending`,
      s.rubric.rated ? RUBRIC_KEYS.map((k) => n1(s.rubric[k])).join(', ') : 'not rated'
    ],
    ...(s.heldOut
      ? ([
          ['Held out: "not X, but Y" contrasts per 1,000 words (mean)', n2(s.heldOut.contrastRate)],
          ['Held out: one-line fragment paragraphs (mean share)', pc(s.heldOut.fragmentRate)],
          ['Held out: 5-word runs from earlier steps (median)', n1(s.heldOut.repeat5)],
          ['Held out: a paragraph already on the page', of(s.heldOut.withRepeatedParas, s.heldOut.measured)],
          ['Held out: says again what the scene said (a line of dialogue included)', of(s.heldOut.withSceneEchoes, s.heldOut.measured)]
        ] as [string, string][])
      : [])
  ]
}
const n2 = (v: number | null): string => (v == null ? '–' : v.toFixed(2))

/** The report's Prose section. */
export function proseMarkdown(s: ProseSummary | undefined): string[] {
  if (!s || !s.passages) return []
  const out = ['## Prose', '', 'How the AI writes, measured with no model call (and the judge’s marks where it was asked anyway). Lower is better, except the judge’s marks.', '']
  out.push('| | |', '|---|---|', ...proseRows(s).map(([a, b]) => `| ${a} | ${b} |`), '')
  if (s.worst.length) out.push('Worst examples:', '', ...s.worst.map((w) => `- ${w}`), '')
  return out
}
