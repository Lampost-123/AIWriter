// The live checks (milestone 5, spec "Consistency checker"): phrases to avoid, repetition nearby and
// name spelling, worked out from the scene's text as Adam types. Pure, so it is unit-tested; the page
// (features/liveChecks/) turns the flags into underlines.
//
// - Phrases to avoid: each phrase on the list (Adam's writing preferences, then the world's and the
//   story's style guides) as a whole word or phrase, whatever its case, with either kind of apostrophe.
// - Repetition nearby: a distinctive word (not a common little word, a short word or a name) used 3
//   times or more within about 150 words, and a phrase of 2 to 4 words used again in the scene (a
//   two-word one only nearby). The repeats after the first are flagged.
// - Name spelling: a capitalised word that isn't a name, an alias or a common English word, and is a
//   letter away from a name (two for names of 7 letters or more), starting with the same letter.
//
// Fast enough to run after every pause in the typing: each paragraph's words, phrase matches and
// spellings are kept by its text (LiveCache), so only the paragraphs that changed are read again;
// repetition looks across paragraphs, but over words already split up.

import type { CheckWords, LiveIgnore } from './contracts/checks'

export type LiveKind = LiveIgnore['kind']

/** How many words "nearby" spans. */
export const NEAR_WORDS = 150
/** A word used this many times nearby is flagged. */
export const REPEAT_MIN = 3
/** Words shorter than this are never flagged as repeated. */
export const REPEAT_MIN_LENGTH = 4
/** Names shorter than this are never matched for spelling (too many ordinary words are a letter away). */
export const SPELL_MIN_NAME = 4

export interface LiveParagraph {
  /** The paragraph's stable id (paragraphIds.ts). */
  pid: string | null
  /** Its text; a line break inside it is one character. */
  text: string
}

export interface LiveFlag {
  kind: LiveKind
  /** Which paragraph (index in the list checked). */
  para: number
  /** Character range in that paragraph's text. */
  from: number
  to: number
  /** The words as they stand. */
  word: string
  /** What Ignore stores (see liveKey). */
  key: string
  /** One plain sentence for the card. */
  message: string
  /** Spelling: the name it is closest to, as the name is written. */
  suggestion: string | null
}

/** The words the checks use, worked out once for each CheckWords. */
export interface LiveWords {
  /** Changes whenever any name, alias or phrase to avoid does. */
  key: string
  namesKey: string
  avoidKey: string
  /** Every name and alias, whole and word by word, in lower case: never misspellings. */
  known: Set<string>
  /** Words of names that aren't ordinary words ("mara", "kell"): never repetition. */
  nameWords: Set<string>
  /** Names to match spellings against, by their first letter. */
  byFirst: Map<string, { name: string; lower: string }[]>
  avoid: { phrase: string; lower: string; re: RegExp }[]
}

// ---------- Words ----------

/** Lower case, with curly apostrophes made straight. */
export const norm = (s: string): string => s.toLowerCase().replace(/[’‘]/g, "'")

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface Token {
  start: number
  end: number
  /** In lower case ("mara's"). */
  lower: string
  /** Without a possessive "'s" ("mara"), and where that ends. */
  base: string
  baseEnd: number
  /** Starts with a capital letter. */
  cap: boolean
  /** All capitals (two letters or more): shouting or an abbreviation. */
  caps: boolean
  /** Starts a sentence (or a line, or words in quotes). */
  first: boolean
  /** Follows the word before it with nothing but spaces (or a hyphen) between: part of one phrase. */
  joined: boolean
}

/** A paragraph's words. */
export function tokenize(text: string): Token[] {
  const out: Token[] = []
  let prevEnd = -1
  for (const m of text.matchAll(WORD)) {
    const start = m.index
    const raw = m[0]
    const end = start + raw.length
    const lower = norm(raw)
    const possessive = lower.length > 3 && lower.endsWith("'s")
    const gap = prevEnd < 0 ? '' : text.slice(prevEnd, start)
    const firstChar = raw[0]
    out.push({
      start,
      end,
      lower,
      base: possessive ? lower.slice(0, -2) : lower,
      baseEnd: possessive ? end - 2 : end,
      cap: firstChar !== firstChar.toLowerCase(),
      caps: raw.length > 1 && raw === raw.toUpperCase() && raw !== raw.toLowerCase(),
      first: prevEnd < 0 || /[.!?…:;“"‘\n]/.test(gap),
      joined: prevEnd >= 0 && /^[\s-]*$/.test(gap) && !gap.includes('\n')
    })
    prevEnd = end
  }
  return out
}

/**
 * Edit distance with adjacent letters swapped counting as one (optimal string alignment), giving up
 * (returning max + 1) as soon as it can't be `max` or less.
 */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const n = b.length
  let prev2 = new Array<number>(n + 1).fill(0)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    ;[prev2, prev, cur] = [prev, cur, prev2]
  }
  return prev[n]
}

/** The regular expression for one phrase to avoid: whole words, any case, either apostrophe, any spacing. */
export function phraseRe(phrase: string): RegExp | null {
  const p = phrase.trim().replace(/\s+/g, ' ')
  if (!p || !LETTER_OR_NUMBER.test(p)) return null
  const body = [...p].map((ch) => (ch === "'" || ch === '’' || ch === '‘' ? "['’‘]" : ch === ' ' ? '\\s+' : escapeRe(ch))).join('')
  const pre = /^[\p{L}\p{N}]/u.test(p) ? '(?<![\\p{L}\\p{N}])' : ''
  const post = /[\p{L}\p{N}]$/u.test(p) ? '(?![\\p{L}\\p{N}])' : ''
  return new RegExp(pre + body + post, 'giu')
}

/** Prepares the words the checks use. */
export function prepareLiveWords(words: CheckWords): LiveWords {
  const known = new Set<string>()
  const nameWords = new Set<string>()
  const byFirst = new Map<string, { name: string; lower: string }[]>()
  const seen = new Set<string>()
  for (const n of words.names) {
    const name = n.name.trim()
    if (!name) continue
    known.add(norm(name))
    for (const m of name.matchAll(WORD)) {
      const word = m[0]
      let lower = norm(word)
      if (lower.length > 3 && lower.endsWith("'s")) lower = lower.slice(0, -2)
      known.add(lower)
      if (COMMON.has(lower)) continue
      nameWords.add(lower)
      // Plot threads are named like titles ("Who took the crown"), not like people and places.
      if (n.kind === 'thread' || lower.length < SPELL_MIN_NAME || !/^\p{Lu}/u.test(word) || /\d/.test(lower) || seen.has(lower)) continue
      seen.add(lower)
      const list = byFirst.get(lower[0]) ?? []
      list.push({ name: word.replace(/['’]s$/, ''), lower })
      byFirst.set(lower[0], list)
    }
  }
  const avoid: LiveWords['avoid'] = []
  const avoidSeen = new Set<string>()
  for (const raw of words.avoid) {
    const phrase = raw.trim().replace(/\s+/g, ' ')
    const lower = norm(phrase)
    const re = phraseRe(phrase)
    if (!re || avoidSeen.has(lower)) continue
    avoidSeen.add(lower)
    avoid.push({ phrase, lower, re })
  }
  const namesKey = [...known].sort().join('|') + '#' + [...byFirst.values()].flat().map((c) => c.name).sort().join('|')
  const avoidKey = avoid.map((a) => a.lower).join('|')
  return { key: `${namesKey}##${avoidKey}`, namesKey, avoidKey, known, nameWords, byFirst, avoid }
}

export const EMPTY_WORDS: LiveWords = prepareLiveWords({ names: [], avoid: [] })

// ---------- Keys and messages ----------

/** What Ignore stores for a flag: a spelling anywhere in the world, a phrase in one paragraph, a repetition in the scene. */
export function liveKey(kind: LiveKind, words: string, pid: string | null = null): string {
  const w = norm(words).replace(/\s+/g, ' ').trim()
  if (kind === 'phrase') return `phrase:${pid ?? ''}:${w}`
  return `${kind}:${w}`
}

const times = (n: number): string => (n === 2 ? 'twice' : `${n} times`)

// ---------- Per paragraph ----------

interface Spot {
  from: number
  to: number
  word: string
  suggestion?: string
  lower: string
}

/** The phrases to avoid in a paragraph, longest first where they overlap. */
export function findAvoided(text: string, avoid: LiveWords['avoid']): Spot[] {
  const found: Spot[] = []
  for (const a of avoid) {
    a.re.lastIndex = 0
    for (const m of text.matchAll(a.re)) found.push({ from: m.index, to: m.index + m[0].length, word: m[0], lower: a.lower })
  }
  found.sort((x, y) => x.from - y.from || y.to - y.from - (x.to - x.from))
  const out: Spot[] = []
  for (const f of found) if (!out.length || f.from >= out[out.length - 1].to) out.push(f)
  return out
}

/**
 * The name a word looks like a misspelling of, or null. `opener`: the word starts a sentence or words in
 * quotes, where ordinary words that aren't on the common list ("Huh", "Halt", "Brat") are capitalised
 * too, so only a word of 5 letters or more a single letter from a name of 5 letters or more counts.
 */
export function closestName(lower: string, words: LiveWords, opener = false): string | null {
  const list = words.byFirst.get(lower[0])
  if (!list || (opener && lower.length < 5)) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const c of list) {
    if (opener && c.lower.length < 5) continue
    const max = opener ? 1 : c.lower.length >= 7 ? 2 : 1
    if (Math.abs(c.lower.length - lower.length) > max) continue
    // Two letters out only for a word long enough to be the same name.
    const allowed = Math.min(max, lower.length >= 6 ? 2 : 1)
    const d = editDistance(lower, c.lower, allowed)
    if (d > 0 && d <= allowed && d < bestDist) {
      best = c.name
      bestDist = d
    }
  }
  return best
}

/** Endings that make a word from a name: "the Kells", "two Maras", "Eldorian soldiers", "the Asharan coast". */
const NAME_ENDINGS = ['s', 'es', 'n', 'an', 'ian', 'ans', 'ians', 'ish', 'ese', 'i', 'is', 'er', 'ers', 'ite', 'ites', 'ic']

/** True when a word is a whole name (or a word of one) with only an ending added. */
export function derivedFromName(lower: string, words: LiveWords): boolean {
  for (const e of NAME_ENDINGS) {
    if (lower.length < e.length + 3 || !lower.endsWith(e)) continue
    const stem = lower.slice(0, -e.length)
    if (words.nameWords.has(stem) || (words.known.has(stem) && !COMMON.has(stem))) return true
  }
  return false
}

/** Capitalised words in a paragraph that look like misspelt names. */
export function findMisspelt(tokens: Token[], text: string, words: LiveWords): Spot[] {
  if (!words.byFirst.size) return []
  const out: Spot[] = []
  for (const t of tokens) {
    if (!t.cap || t.caps) continue
    const w = t.base
    if (w.length < 3 || words.known.has(w) || words.known.has(t.lower) || COMMON.has(w) || /\d/.test(w)) continue
    if (derivedFromName(w, words)) continue
    const name = closestName(w, words, t.first)
    if (name) out.push({ from: t.start, to: t.baseEnd, word: text.slice(t.start, t.baseEnd), suggestion: name, lower: w })
  }
  return out
}

interface ParaInfo {
  tokens: Token[]
  avoided: { key: string; spots: Spot[] } | null
  misspelt: { key: string; spots: Spot[] } | null
}

/** Each paragraph's words and per-paragraph findings, by its text. Keeps only the paragraphs of the last check. */
export class LiveCache {
  private map = new Map<string, ParaInfo>()
  private next: Map<string, ParaInfo> | null = null

  begin(): void {
    this.next = new Map()
  }

  get(text: string): ParaInfo {
    let p = this.map.get(text) ?? this.next?.get(text)
    if (!p) p = { tokens: tokenize(text), avoided: null, misspelt: null }
    this.next?.set(text, p)
    return p
  }

  end(): void {
    if (this.next) this.map = this.next
    this.next = null
  }

  get size(): number {
    return this.map.size
  }
}

// ---------- Repetition (across paragraphs) ----------

interface Placed {
  para: number
  tok: Token
}

/** How words are written across a scene: those seen in lower case, and those capitalised other than at the start of a sentence. */
export interface SceneCase {
  lower: Set<string>
  capitalMid: Set<string>
}

export function sceneCase(tokens: Token[][]): SceneCase {
  const lower = new Set<string>()
  const capitalMid = new Set<string>()
  for (const list of tokens) {
    for (const t of list) {
      if (!t.cap) lower.add(t.base)
      else if (!t.first) capitalMid.add(t.base)
    }
  }
  return { lower, capitalMid }
}

/** Words used too often nearby, and phrases used again; the repeats after the first. */
export function findRepeats(paras: LiveParagraph[], tokens: Token[][], words: LiveWords, cased = sceneCase(tokens)): LiveFlag[] {
  const all: Placed[] = []
  tokens.forEach((list, para) => {
    for (const tok of list) all.push({ para, tok })
  })
  const flags: LiveFlag[] = []
  const used = new Uint8Array(all.length)
  const slice = (start: number, n: number): string => {
    const a = all[start]
    return paras[a.para].text.slice(a.tok.start, all[start + n - 1].tok.end)
  }
  const flagAt = (start: number, n: number, key: string, message: string): void => {
    const a = all[start]
    const b = all[start + n - 1]
    flags.push({ kind: 'repetition', para: a.para, from: a.tok.start, to: b.tok.end, word: slice(start, n), key, message, suggestion: null })
  }
  /**
   * The words as written, for the message: from a use not at the start of a sentence if there is one,
   * else with the sentence's capital taken off.
   */
  const shown = (starts: number[], n: number): string => {
    const mid = starts.find((g) => !all[g].tok.first)
    if (mid !== undefined) return slice(mid, n)
    const w = slice(starts[0], n)
    return w[0].toLowerCase() + w.slice(1)
  }
  // Names not in the codex yet ("Tamsin ran. Tamsin hid."): words capitalised other than at the start of
  // a sentence, or never written in lower case in the scene.
  const proper = (t: Token): boolean => cased.capitalMid.has(t.base) || !cased.lower.has(t.base)

  // Phrases first, longest first, so a repeated phrase isn't flagged again for the shorter phrases in it.
  // Built up from two words: a phrase can only repeat where its first words do, so each longer length
  // looks only where the shorter one repeated.
  const n = all.length
  const DIGIT = /\d/
  const usable = new Uint8Array(n)
  const isContent = new Uint8Array(n)
  const link = new Uint8Array(n)
  for (let g = 0; g < n; g++) {
    const t = all[g].tok
    if (DIGIT.test(t.lower) || words.nameWords.has(t.base) || proper(t)) continue
    usable[g] = 1
    if (t.lower.length >= 3 && !PHRASE_STOP.has(t.lower)) isContent[g] = 1
    if (g > 0 && t.joined && all[g - 1].para === all[g].para) link[g] = 1
  }
  const byLength: Map<string, number[]>[] = []
  let prefix: string[] = new Array<string>(n)
  let prefixCount = new Map<string, number>()
  let contentCount = new Uint8Array(n)
  for (let g = 0; g < n; g++) {
    if (!isContent[g]) continue
    prefix[g] = all[g].tok.lower
    contentCount[g] = 1
    prefixCount.set(prefix[g], 2)
  }
  for (let len = 2; len <= 4; len++) {
    const next: string[] = new Array<string>(n)
    const nextCount = new Map<string, number>()
    const nextContent = new Uint8Array(n)
    const grams = new Map<string, number[]>()
    for (let g = 0; g + len <= n; g++) {
      const p = prefix[g]
      if (p === undefined || (prefixCount.get(p) ?? 0) < 2) continue
      const last = g + len - 1
      if (!usable[last] || !link[last]) continue
      const key = `${p} ${all[last].tok.lower}`
      next[g] = key
      nextCount.set(key, (nextCount.get(key) ?? 0) + 1)
      nextContent[g] = contentCount[g] + isContent[last]
      if (!isContent[last] || nextContent[g] < 2) continue
      const list = grams.get(key)
      if (list) list.push(g)
      else grams.set(key, [g])
    }
    byLength[len] = grams
    prefix = next
    prefixCount = nextCount
    contentCount = nextContent
  }
  for (const len of [4, 3, 2]) {
    const grams = byLength[len]
    for (const [phrase, starts] of grams) {
      if (starts.length < 2) continue
      // Not again for words already part of a longer repeated phrase (or overlapping itself).
      const free: number[] = []
      for (const g of starts) {
        let clear = true
        for (let k = 0; k < len; k++) if (used[g + k]) clear = false
        if (clear && (!free.length || g >= free[free.length - 1] + len)) free.push(g)
      }
      // A phrase of two words counts only nearby; longer ones anywhere in the scene.
      const near = len === 2 ? free.filter((g, i) => (i > 0 && g - free[i - 1] < NEAR_WORDS) || (i + 1 < free.length && free[i + 1] - g < NEAR_WORDS)) : free
      if (near.length < 2) continue
      for (const g of near) for (let k = 0; k < len; k++) used[g + k] = 1
      const where = len === 2 ? 'in a few paragraphs' : 'in this scene'
      const message = `“${shown(near, len)}” is used ${times(near.length)} ${where}.`
      for (const g of near.slice(1)) flagAt(g, len, liveKey('repetition', phrase), message)
    }
  }

  // Words used too often nearby.
  const byWord = new Map<string, number[]>()
  all.forEach(({ tok }, g) => {
    const w = tok.base
    if (w.length < REPEAT_MIN_LENGTH || STOP.has(w) || words.nameWords.has(w) || /\d/.test(w) || proper(tok)) return
    const list = byWord.get(w)
    if (list) list.push(g)
    else byWord.set(w, [g])
  })
  for (const [w, list] of byWord) {
    if (list.length < REPEAT_MIN) continue
    const crowded = new Uint8Array(list.length)
    for (let i = 0; i + REPEAT_MIN - 1 < list.length; i++) {
      if (list[i + REPEAT_MIN - 1] - list[i] < NEAR_WORDS) for (let k = 0; k < REPEAT_MIN; k++) crowded[i + k] = 1
    }
    // Runs of crowded uses, each close to the one before.
    let run: number[] = []
    const close = (): void => {
      if (run.length >= REPEAT_MIN) {
        const message = `“${shown(run, 1)}” is used ${run.length} times in a few paragraphs.`
        for (const g of run.slice(1)) if (!used[g]) flagAt(g, 1, liveKey('repetition', w), message)
      }
      run = []
    }
    list.forEach((g, i) => {
      if (!crowded[i]) return close()
      if (run.length && g - run[run.length - 1] >= NEAR_WORDS) close()
      run.push(g)
    })
    close()
  }
  return flags
}

// ---------- The whole scene ----------

/**
 * Every live flag in a scene's paragraphs, in reading order, leaving out the ignored keys. Pass the
 * same cache each time, so only paragraphs whose text changed are read again.
 */
export function checkScene(paras: LiveParagraph[], words: LiveWords, ignored: ReadonlySet<string>, cache = new LiveCache()): LiveFlag[] {
  cache.begin()
  const tokens: Token[][] = []
  const flags: LiveFlag[] = []
  paras.forEach((p, para) => {
    const info = cache.get(p.text)
    tokens.push(info.tokens)
    if (words.avoid.length) {
      if (info.avoided?.key !== words.avoidKey) info.avoided = { key: words.avoidKey, spots: findAvoided(p.text, words.avoid) }
      for (const s of info.avoided.spots) {
        flags.push({
          kind: 'phrase',
          para,
          from: s.from,
          to: s.to,
          word: s.word,
          key: liveKey('phrase', s.lower, p.pid),
          message: `“${s.lower}” is on your list of phrases to avoid.`,
          suggestion: null
        })
      }
    }
    if (info.misspelt?.key !== words.namesKey) info.misspelt = { key: words.namesKey, spots: findMisspelt(info.tokens, p.text, words) }
    for (const s of info.misspelt.spots) {
      flags.push({
        kind: 'spelling',
        para,
        from: s.from,
        to: s.to,
        word: s.word,
        key: liveKey('spelling', s.lower),
        message: `“${s.word}” looks like a misspelling of ${s.suggestion}.`,
        suggestion: s.suggestion ?? null
      })
    }
  })
  cache.end()
  const cased = sceneCase(tokens)

  // A capitalised word also written in lower case in the scene ("Coin by coin") is an ordinary word.
  const spelt = flags.filter((f) => f.kind !== 'spelling' || !cased.lower.has(norm(f.word)))

  // A repeat inside a phrase to avoid or a misspelling is left to that flag.
  const taken = spelt.filter((f) => !ignored.has(f.key))
  const byPara = new Map<number, LiveFlag[]>()
  for (const f of taken) byPara.set(f.para, [...(byPara.get(f.para) ?? []), f])
  const overlaps = (r: LiveFlag): boolean => !!byPara.get(r.para)?.some((f) => f.from < r.to && r.from < f.to)
  for (const r of findRepeats(paras, tokens, words, cased)) if (!ignored.has(r.key) && !overlaps(r)) taken.push(r)
  return taken.sort((a, b) => a.para - b.para || a.from - b.from)
}

/** How many flags of each kind. */
export function countFlags(flags: { kind: LiveKind }[]): Record<LiveKind, number> {
  const out: Record<LiveKind, number> = { phrase: 0, repetition: 0, spelling: 0 }
  for (const f of flags) out[f.kind]++
  return out
}

// ---------- Word lists ----------

const set = (s: string): Set<string> => new Set(s.trim().split(/\s+/))

/** Little words that join phrases; a repeated phrase needs two words that aren't these. */
const PHRASE_STOP = set(`
a an the and or but nor so yet if then than as at by for from in into of off on onto out over to up upon with
without within about above across after against along among around before behind below beneath beside between
beyond down during except inside near outside past since through toward towards under until via
i me my mine myself you your yours yourself we us our ours ourselves he him his himself she her hers herself
it its itself they them their theirs themselves this that these those who whom whose which what where when why how
am is are was were be been being have has had having do does did doing done will would shall should can could may
might must let lets let's not no nor too very just also still even only again ever never now here there all any
both each every few more most other some such own same one ones much many lot lots
i'm i'd i'll i've you're you'd you'll you've he's he'd he'll she's she'd she'll it's it'd it'll we're we'd we'll
we've they're they'd they'll they've that's there's here's what's who's where's when's how's
isn't aren't wasn't weren't don't doesn't didn't haven't hasn't hadn't won't wouldn't shan't shouldn't can't
cannot couldn't mustn't mightn't needn't
said says say asked ask told tell replied answered
`)

/**
 * Words too ordinary to count as repeated: the little words above, and the common verbs, adverbs and
 * words of dialogue that prose leans on without anyone noticing.
 */
const STOP = new Set([
  ...PHRASE_STOP,
  ...set(`
  like back away once while because though although unless whether either neither rather quite almost enough
  perhaps maybe really actually already always sometimes often soon later today tonight tomorrow yesterday
  well yeah okay sure right yes oh ah hm hmm
  something nothing anything everything someone somebody everyone everybody anyone anybody nobody none
  another others thing things way ways time times
  know knew known think thought want wanted need needed seem seemed seems
  come comes came coming go goes went gone going get gets got getting make makes made making take takes took taken
  give gives gave given keep kept look looks looked looking see sees saw seen feel feels felt
  turn turns turned turning find found put puts left right across around
  first last next then every each whole half
  mr mrs ms miss sir
`)
])

/**
 * Common English words, so a capitalised one at the start of a sentence ("Many", "Mark my words") is
 * never taken for a misspelt name, and words of names that are ordinary words ("Rose", "The Dark")
 * aren't matched as names.
 */
const COMMON = new Set([
  ...STOP,
  ...set(`
  able about above accept across act action add afraid after afternoon again age ago agree ahead air alive all allow
  alone along aloud already alright also always among amount anger angry animal annoy another answer anxious apart
  appear apple area arm arms army around arrive art ash ashes aside asleep attack aunt autumn avoid awake aware away
  baby back bad bag ball band bank bar bare bark barn base basket bath battle beach bear beard beast beat beautiful
  became become bed beer began begin behind being believe bell belly belong below belt bench bend beneath bent beside
  best better big bill bind bird birth bit bite bitter black blade blame blank blind block blood blow blue board boat
  body bold bone book boot boots border bore born borrow boss both bother bottle bottom bound bow bowl box boy brain
  branch brave bread break breath breathe brick bride bridge brief bright bring broad broke broken brother brought
  brown brush build built burn burst bury bush busy butter button buy call calm camp candle cap captain car card care
  careful carry cart case castle cat catch caught cause cave cell centre center chain chair chance change chapter
  charge chase cheap check cheek cheer chest chicken chief child children chin choice choose church circle city claim
  class clean clear clever cliff climb clock close cloth clothes cloud coal coast coat cold collar colour color comb
  comfort command common company complete cook cool copy corn corner cost cotton couch cough count country couple
  courage course court cousin cover cow crack crash crawl cream creature creep crew cried crime cross crowd crown cruel
  crush cry cup curious current curse curtain curve cut daily damp dance danger dare dark darling date daughter dawn
  day days dead deal dear death debt decide deep deer demand deny desk despite detail devil die dinner direction dirt
  dirty discover dish distance doctor dog doll door doors double doubt dragon drag draw drawn dream dress drew drink
  drive drop drown drum drunk dry duck dull dust duty each eager ear early earn earth ease east easy eat edge egg
  eight either elbow else empty end enemy engine enjoy enter entire equal escape evening event ever every evil exact
  except excuse expect explain eye eyes face fact fade fail faint fair faith fall false fame family famous fancy far
  farm fast fat fate father fault fear feast feather fed feed fell fellow fence fever few field fierce fight figure
  fill final fine finger finish fire firm fish fist fit five fix flag flame flash flat flesh flew flight float floor
  flow flower fly fog fold folk follow food fool foot force forest forget fork form fort forth fortune forward four fox
  frame free fresh friend fright front frost frown fruit full fun funny fur future gain game garden gate gather gaze
  gentle ghost gift girl glad glance glass glove glow god gods gold golden good goods grab grace grain grand grass
  grave gray great green greet grew grey grief grin grip ground group grow growl guard guess guest guide guilt gun guy
  habit hair half hall hand hands handle hang happen happy hard harm hat hate head heal health heap hear heard heart
  heat heaven heavy heel held hell hello help hen herd hide high hill hint hire hit hold hole holy home honest honey
  honour honor hood hook hope horn horse host hot hour hours house huge human hundred hung hunger hungry hunt hurry
  hurt husband ice idea ill image imagine inch indeed inn inner iron island issue item jacket jaw job join joke journey
  joy judge jump just keen key kick kid kill kind king kiss kitchen knee kneel knife knock knot lady laid lake lamp
  land lane language large late laugh law lay lead leaf lean learn least leather leave led leg legs lend length less
  lesson letter level lie life lift light like limb limit line lip lips list listen little live load loaf local lock
  long lord lose loss lost loud love low luck lunch lung mad magic maid main major man manner map march mark market
  marry mask master match mate matter meal mean meat meet melt member memory men mend mention mere mess message met
  metal middle midnight mild mile milk mill mind minute mirror miss mist mistake mix moment money monster month mood
  moon morning moss mother mount mountain mouse mouth move much mud murder muscle music mutter nail name narrow nation
  nature near nearly neat neck need needle neighbour neighbor nephew nerve nest net new news nice niece night nine
  noble nod noise none noon normal north nose note notice number nurse nut oak oath obey ocean odd offer office officer
  oil old open order ordinary other oven owe owl own pace pack page pain paint pair pale palm pan paper parent park
  part party pass past path patient pause pay peace pearl pen people pepper perfect pick piece pig pile pillow pin pine
  pink pipe pit pity place plain plan plant plate play plead please pleasure plenty pocket poem point poison pole
  polite pool poor pop porch possible post pot pour powder power praise pray prayer press pretend pretty prey price
  pride priest prince princess prison private prize promise proof proper proud prove pull pulse pupil purple purpose
  push queen question quick quiet quite race rag rage rail rain raise ran rang range rank rare rat rate raw reach read
  ready real reason rebel recall red reach relief remain remember remind rent repeat reply rest return rich rid ride
  ring rise risk river road roar rob robe rock rod roll roof room root rope rose rough round row royal rub rude ruin
  rule run rush rust sad saddle safe sail saint sake salt sand sat save scale scar scare scene scent school scream sea
  seal search season seat second secret seed seize sell send sense sent serve set settle seven shade shadow shake shall
  shame shape share sharp shed sheep sheet shelf shell shield shift shine ship shirt shock shoe shook shoot shop shore
  short shot shoulder shout shove show shut shy sick side sigh sight sign silence silent silk silly silver simple sin
  sing single sink sister sit six size skin skirt skull sky slave sleep slept slid slide slight slip slope slow small
  smart smell smile smoke smooth snake snap snow soft soil sold soldier son song sorry sort soul sound soup south space
  spare speak spear speech speed spell spend spent spin spirit spit spoke spoon spot spread spring spy square staff
  stage stair stairs stand star stare start state stay steal steam steel steep step stick stiff still sting stir
  stock stomach stone stood stool stop store storm story stove straight strange stranger straw stream street strength
  stretch strike string strip stroke strong struck stuck student study stuff stupid sudden sugar suit summer sun
  supper suppose surface surprise swallow swear sweat sweep sweet swim sword table tail tale talk tall taste taught tea
  teach team tear teeth temple ten tent terror test thank thick thief thin third thirst thorn thread threat three
  threw throat throne throw thumb thunder tide tie tight till tiny tip tired title toe together told tomb tone tongue
  tool tooth top torch tore torn toss total touch tough tower town toy track trade trail train trap travel tray tread
  treat tree trial trick trip trouble truck true trust truth try tube tune tunnel turn twelve twenty twice twin twist
  two type ugly uncle understand unknown upper upset urge use used useful usual valley value various vast veil voice
  wagon waist wait wake walk wall wander war warm warn wash waste watch water wave wax weak wealth weapon wear weather
  wedding week weep weight welcome west wet wheel whip whisper whistle white wicked wide wife wild win wind window
  wine wing winter wipe wire wise wish witch woke wolf woman women wonder wood wooden wool word words wore work world
  worm worry worse worst worth wound wrap wrist write wrong wrote yard year years yell yellow young youth
  monday tuesday wednesday thursday friday saturday sunday
  january february april june july august september october november december
  king queen prince princess lord lady sir dame duke duchess earl count baron captain general major colonel sergeant
  doctor father mother brother sister uncle aunt grandma grandpa granny mum mom dad papa mama master mistress madam
  god gods lord heaven hell
  mars venus jupiter saturn mercury earth sun moon
  english french german spanish italian latin greek roman
  dear darling honey love sweetheart please thanks thank sorry hello goodbye hey hi
`)
])
