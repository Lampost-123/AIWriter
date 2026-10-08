// Echo and loop detectors for the held-out prose measures (prose.ts), ported from Adam's own
// earlier app, Poor Mans Holodeck (Lampost-123/Poor-Mans-Holodeck at 817ab67, src/lib/prompts/length.ts:73-98,
// 147-194 and 210-368; server/index.mjs:771-783), same owner. The logic is unchanged; the comments are shortened.
// Taken: repeatedParas (a passage's paragraphs already on the page), echoesInScene (what a scene says twice, a line of
// dialogue said again included), echoesAcrossScenes (its helper), loopAt / cutRepeat / looping (a run of 1 to 60
// words repeated back to back). Left out as duplicates of other measures: dropEcho (a restated page end: the
// opening-echo measure and prefix's seam fix), replayedOpening (a retold opening: the recap share) and the 12-word runs
// across scenes as a measure of their own (a chain is one scene; the 6-word echoes and 5-word repeats across
// steps count them). Pure.

/** Words of repetition before it counts as a loop: one word chanted 6 times, a short phrase 3 times, a long one twice. */
export const loopSpan = (p: number): number => (p === 1 ? 6 : p >= 10 ? p * 2 : Math.max(12, p * 3))

/** Where a degenerate loop starts, as a word index just past its first copy, or -1 (a run of 1-60 words back to back). */
export function loopAt(words: string[]): number {
  const w = words.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || t)
  let cut = -1
  for (let p = 1; p <= 60 && p < w.length; p++) {
    const need = loopSpan(p)
    let run = 0
    for (let i = 0; i + p < w.length; i++) {
      run = w[i] === w[i + p] ? run + 1 : 0
      if (run + p < need) continue
      const end = i - run + 1 + p
      if (cut < 0 || end < cut) cut = end
      break
    }
  }
  return cut
}

/** A text with the loop it started cut off: the first copy kept, a stop put at its end. */
export function cutRepeat(s: string): string {
  const toks = [...s.matchAll(/\S+/g)]
  const cut = toks.length >= 6 ? loopAt(toks.map((m) => m[0])) : -1
  if (cut < 0) return s.trim()
  const last = toks[cut - 1]
  const kept = s
    .slice(0, (last.index ?? 0) + last[0].length)
    .trim()
    .replace(/[,;:—-]+$/, '')
  return /[\p{L}\p{N}]$/u.test(kept) ? `${kept}.` : kept
}

/** True when the end of a stream (its last 600 words) loops (server/index.mjs `looping`; the same rule as loopAt). */
export function looping(text: string): boolean {
  const w = (text.match(/\S+/g) ?? []).slice(-600).map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || t)
  for (let p = 1; p <= 60 && p < w.length; p++) {
    const need = loopSpan(p)
    let run = 0
    for (let i = 0; i + p < w.length; i++) {
      run = w[i] === w[i + p] ? run + 1 : 0
      if (run + p >= need) return true
    }
  }
  return false
}

const flatEcho = (s: string): string => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()

type ParaKey = { words: string; grams: Set<string>; n: number; talk: boolean }
const paraKey = (p: string): ParaKey => {
  const w = flatEcho(p).match(/[\p{L}\p{N}']+/gu) ?? []
  return { words: w.join(' '), grams: new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`)), n: w.length, talk: /^["“'‘]/.test(p.trim()) }
}
/** Words from which a paragraph counts as long: a repeat of one is never deliberate. */
const LONG_PARA = 12
/** A short line repeated this close (in paragraphs) is a loop; further apart it can be a refrain. */
const NEAR_PARAS = 8
const repeats = (a: ParaKey, b: ParaKey, near: boolean): boolean => {
  const long = a.n >= LONG_PARA && b.n >= LONG_PARA
  if (a.words === b.words) return long || (near && !a.talk)
  if (!long) return false
  let shared = 0
  for (const g of a.grams) if (b.grams.has(g)) shared++
  return shared / Math.min(a.grams.size, b.grams.size) >= 0.6
}

/**
 * Which paragraphs of a new passage are already on the page: word for word, or nearly (a long one sharing 60% of its
 * word pairs). `page` is the scene's prose in order; `nearby` is prose next to it, where only a long paragraph counts. A
 * short line counts only word for word and close by, and never a line of dialogue. Returns their indexes in `paras`.
 */
export function repeatedParas(paras: string[], page: string[], nearby: string[] = []): number[] {
  const seen = [...nearby.map((p) => ({ k: paraKey(p), at: -Infinity })), ...page.map((p, at) => ({ k: paraKey(p), at }))]
  const out: number[] = []
  paras.forEach((p, i) => {
    const k = paraKey(p)
    const at = page.length + i
    if (k.n < 3) return
    if (seen.some((s) => repeats(k, s.k, at - s.at <= NEAR_PARAS))) out.push(i)
    else seen.push({ k, at })
  })
  return out
}

/** Words from which a stretch standing twice in one scene is a slip: "She does not answer." can come twice on purpose. */
const ECHO_WORDS = 8
/** A shorter paragraph said again counts when it comes back within NEAR_CLOSE paragraphs, or NEAR_FAR from NEAR_FAR_WORDS words. */
const NEAR_WORDS = 3
const NEAR_CLOSE = 2
const NEAR_FAR = 8
const NEAR_FAR_WORDS = 5
/** An exchange said twice counts from three lines in the same order, two of them this many words, SCATTER_WORDS in all. */
const SCATTER_LINE = 4
const SCATTER_WORDS = 12
/** Lines the first telling may skip between two it shares (the second may skip twice as many). */
const SCATTER_GAP = 3

const SENTENCES = /[^.!?…]*[.!?…]+["”’)\]*_]*|[^.!?…]+$/g

/**
 * What a scene says twice: a paragraph of ECHO_WORDS words or more standing again, alone or inside another, or a
 * sentence that long in two paragraphs, or a shorter line again a few paragraphs on, an exchange of short lines of
 * dialogue said again, a short paragraph the next one opens with, an exchange told twice with other lines between.
 * `paras` is the scene's prose in order. Each pair of paragraphs comes once, `first` before `again`, with the longest
 * stretch they share.
 */
export function echoesInScene(paras: string[]): { first: number; again: number; text: string }[] {
  const keys = paras.map(paraKey)
  const found = new Map<string, { first: number; again: number; text: string; n: number }>()
  const add = (a: number, b: number, text: string, n: number): void => {
    const [first, again] = a < b ? [a, b] : [b, a]
    const had = found.get(`${first}:${again}`)
    if (!had || n > had.n) found.set(`${first}:${again}`, { first, again, text: text.trim(), n })
  }
  const seen = new Map<string, number>()
  keys.forEach((k, i) => {
    if (k.n >= ECHO_WORDS)
      keys.forEach((o, j) => {
        if (j !== i && o.n >= k.n && ` ${o.words} `.includes(` ${k.words} `) && (o.n > k.n || i < j)) add(i, j, paras[i], k.n)
      })
    for (const s of paras[i].match(SENTENCES) ?? []) {
      const sk = paraKey(s)
      if (sk.n < ECHO_WORDS) continue
      const at = seen.get(sk.words)
      if (at === undefined) seen.set(sk.words, i)
      else if (at !== i) add(at, i, s, sk.n)
    }
  })
  // A long run of words said again with other stops between them.
  for (const e of echoesAcrossScenes(paras.map((p) => [p]))) add(e.first[0], e.again[0], e.text, e.text.split(/\s+/).length)
  // A short line said again close by.
  keys.forEach((k, i) => {
    if (k.n < NEAR_WORDS || k.n >= ECHO_WORDS) return
    for (let j = i + 1; j < keys.length && j - i <= NEAR_FAR; j++) {
      const o = keys[j]
      if (o.words !== k.words || o.talk !== k.talk || (j - i > NEAR_CLOSE && k.n < NEAR_FAR_WORDS)) continue
      add(i, j, paras[i], k.n)
      break
    }
  })
  // An exchange of short lines of dialogue said again, word for word.
  const exchanges = new Map<string, number>()
  for (let i = 0; i < keys.length; i++) {
    for (let len = 2; len <= 4 && i + len <= keys.length; len++) {
      const run = keys.slice(i, i + len)
      if (run.some((k) => !k.n || k.n >= ECHO_WORDS || !k.talk)) break
      const n = run.reduce((m, k) => m + k.n, 0)
      if (n < ECHO_WORDS || run.filter((k) => k.n >= 3).length < 2) continue
      const key = run.map((k) => k.words).join(' | ')
      const at = exchanges.get(key)
      if (at === undefined) exchanges.set(key, i)
      else if (i >= at + len)
        add(
          at,
          i,
          paras
            .slice(i, i + len)
            .map((p) => p.trim())
            .join(' / '),
          n
        )
    }
  }
  const sentences = paras.map((p) => (p.match(SENTENCES) ?? []).map((x) => ({ text: x.trim(), ...paraKey(x) })).filter((x) => x.n))
  // A short paragraph that the next one opens with, or the one before ends with.
  keys.forEach((k, i) => {
    if (k.n < NEAR_WORDS || k.n >= ECHO_WORDS) return
    const next = sentences[i + 1]
    const before = sentences[i - 1]
    const same = (x: { words: string; talk: boolean } | undefined): boolean => !!x && x.words === k.words && x.talk === k.talk
    if (next && next.length > 1 && same(next[0])) add(i, i + 1, paras[i], k.n)
    else if (before && before.length > 1 && same(before.at(-1))) add(i - 1, i, paras[i], k.n)
  })
  // An exchange told twice with other lines between.
  const flat = sentences.flatMap((ss, p) => ss.map((x) => ({ ...x, p })))
  const walked = new Set<string>()
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].n < SCATTER_LINE) continue
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].words !== flat[i].words || flat[j].p === flat[i].p || walked.has(`${i}:${j}`)) continue
      const hits = [i]
      let a = i
      let b = j
      for (;;) {
        let best: [number, number] | undefined
        for (let da = 1; da <= SCATTER_GAP && a + da < j; da++) {
          for (let db = 1; db <= SCATTER_GAP * 2 && b + db < flat.length; db++) {
            if (flat[a + da].words === flat[b + db].words && flat[a + da].n >= 2 && (!best || da + db < best[0] + best[1])) best = [da, db]
          }
        }
        if (!best) break
        a += best[0]
        b += best[1]
        walked.add(`${a}:${b}`)
        hits.push(a)
      }
      const n = hits.reduce((m, h) => m + flat[h].n, 0)
      if (hits.length >= 3 && hits.filter((h) => flat[h].n >= SCATTER_LINE).length >= 2 && n >= SCATTER_WORDS) {
        add(
          flat[i].p,
          flat[j].p,
          hits.map((h) => flat[h].text).join(' / '),
          n
        )
      }
    }
  }
  return [...found.values()].sort((a, b) => a.again - b.again || a.first - b.first).map(({ first, again, text }) => ({ first, again, text }))
}

/** Words in a row that make a stretch standing in two scenes a copy. */
const COPY_RUN = 12
type Word = { w: string; at: number; end: number }
const wordsAt = (p: string): Word[] => [...p.matchAll(/[\p{L}\p{N}'’]+/gu)].map((m) => ({ w: m[0].toLowerCase().replace(/’/g, "'"), at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))

/**
 * What is told twice in two scenes: a run of COPY_RUN words or more, word for word, in a paragraph of each. `scenes` is
 * each scene's prose in order. Each pair of paragraphs comes once, the earlier as `first` ([scene, paragraph]), with the
 * longest run they share. With `only`, just the pairs with a paragraph in one of those scenes.
 */
export function echoesAcrossScenes(scenes: string[][], only?: Set<number>): { first: [number, number]; again: [number, number]; text: string }[] {
  const words = scenes.map((ps) => ps.map(wordsAt))
  const seen = new Map<string, [number, number]>()
  const found = new Map<string, { first: [number, number]; again: [number, number]; text: string; n: number }>()
  words.forEach((ps, s) =>
    ps.forEach((t, p) => {
      for (let i = 0; i + COPY_RUN <= t.length; i++) {
        const key = t
          .slice(i, i + COPY_RUN)
          .map((x) => x.w)
          .join(' ')
        const at = seen.get(key)
        if (!at) {
          seen.set(key, [s, p])
          continue
        }
        if (at[0] === s || (only && !only.has(s) && !only.has(at[0]))) continue
        const o = words[at[0]][at[1]]
        let j = o.findIndex((_, k) =>
          o
            .slice(k, k + COPY_RUN)
            .map((x) => x.w)
            .join(' ') === key
        )
        let a = i
        let b = i + COPY_RUN - 1
        let e = j + COPY_RUN - 1
        while (a > 0 && j > 0 && t[a - 1].w === o[j - 1].w) {
          a--
          j--
        }
        while (b + 1 < t.length && e + 1 < o.length && t[b + 1].w === o[e + 1].w) {
          b++
          e++
        }
        const id = `${at[0]}:${at[1]}:${s}:${p}`
        const n = b - a + 1
        const had = found.get(id)
        if (!had || n > had.n) found.set(id, { first: at, again: [s, p], text: scenes[s][p].slice(t[a].at, t[b].end), n })
      }
    })
  )
  return [...found.values()].map(({ first, again, text }) => ({ first, again, text }))
}
