// Common AI phrases: the stock wording that makes a draft read as machine-written. The writer model is given
// the six rules below plus the worst offenders (not the whole list: naming a phrase can prime it), and after a
// draft the editor underlines anything from the full list so it can be fixed in one click with Rewrite.
// Writers' studies of edited AI fiction group the faults as clichés, needless explaining, purple prose, flat
// sentence patterns, vague detail and odd word choice; the rules answer those. All wording is AI Write's own.
// Pure: no Electron or DOM imports, so the window and the main process both use it.

export type SlopGroup = 'body' | 'grand' | 'pattern' | 'closer' | 'word'

export interface SlopPhrase {
  /** Stable: ignores are stored by it. */
  id: string
  group: SlopGroup
  /** How it is shown and named to the model. */
  phrase: string
  /** Matches it and its common variants (case-insensitive, whole words). */
  pattern: RegExp
  /** In the prompt's short list. */
  inPrompt?: boolean
}

/** What each group is called on screen. */
export const SLOP_GROUPS: Record<SlopGroup, string> = {
  body: 'Stock body reaction',
  grand: 'Grand abstraction',
  pattern: 'Stock sentence pattern',
  closer: 'Summing-up line',
  word: 'Overused word'
}

const W = String.raw`(?:\w+ )?`
const re = (source: string): RegExp => new RegExp(String.raw`\b(?:${source})\b`, 'giu')

export const SLOP_PHRASES: readonly SlopPhrase[] = [
  // Stock body reactions
  { id: 'breath-holding', group: 'body', phrase: "a breath she didn't know she was holding", pattern: re(String.raw`breath ${W}(?:didn['’]t|did not|hadn['’]t|had not) (?:known|know|realised|realized) ${W}(?:was|were|had been) holding`), inPrompt: true },
  { id: 'spine-shiver', group: 'body', phrase: 'a shiver ran down her spine', pattern: re(String.raw`(?:shiver|chill)s? (?:ran|run|runs|running|went|crept|raced|skittered|traced|travell?ed) (?:up|down) ${W}spine`), inPrompt: true },
  { id: 'heart-ribs', group: 'body', phrase: 'heart hammering against her ribs', pattern: re(String.raw`heart ${W}(?:hammer|pound|thunder|slam|thrash|beat)\w* (?:against|in) ${W}(?:ribs|ribcage|chest)`), inPrompt: true },
  { id: 'jaw-muscle', group: 'body', phrase: 'a muscle ticked in his jaw', pattern: re(String.raw`muscle (?:ticked|ticking|twitched|twitching|feathered|jumped|jumping) in ${W}jaw`), inPrompt: true },
  { id: 'jaw-clench', group: 'body', phrase: 'his jaw clenched', pattern: re(String.raw`jaw (?:clenched|clenching|tightened|tightening|set)`) },
  { id: 'eyes-sparkle', group: 'body', phrase: 'eyes sparkling', pattern: re(String.raw`eyes (?:sparkl|twinkl|glitter)\w*`) },
  { id: 'smile-tug', group: 'body', phrase: 'a smile tugged at her lips', pattern: re(String.raw`(?:smile|grin|smirk) (?:tug|pull|play|quirk)\w* (?:at )?(?:the corners? of )?${W}(?:lips|mouth)`), inPrompt: true },
  { id: 'ghost-smile', group: 'body', phrase: 'the ghost of a smile', pattern: re(String.raw`ghost of a (?:smile|grin)`) },
  { id: 'blood-cold', group: 'body', phrase: 'her blood ran cold', pattern: re(String.raw`blood (?:ran|run|runs|running|turned|went) cold`) },
  { id: 'stomach-knot', group: 'body', phrase: 'a knot in her stomach', pattern: re(String.raw`(?:knot|pit) (?:in|of) ${W}(?:stomach|gut)`) },
  { id: 'breath-hitch', group: 'body', phrase: 'her breath hitched', pattern: re(String.raw`breath (?:hitched|hitching|caught in ${W}throat)`), inPrompt: true },
  { id: 'heart-skip', group: 'body', phrase: 'her heart skipped a beat', pattern: re(String.raw`heart skipp?(?:ed|ing|s)? a beat`) },
  { id: 'whisper', group: 'body', phrase: 'her voice barely a whisper', pattern: re(String.raw`voice ${W}(?:was )?(?:barely|scarcely|hardly) (?:above |more than )?a whisper`), inPrompt: true },
  { id: 'flicker', group: 'body', phrase: 'something flickered in his eyes', pattern: re(String.raw`flicker(?:ed|ing|s)? (?:across|in|through|over|behind) ${W}(?:eyes|face|features|gaze|expression)`), inPrompt: true },
  { id: 'wave-washed', group: 'body', phrase: 'a wave of relief washed over her', pattern: re(String.raw`wave of \w+ (?:wash|crash|surg|roll|sweep|swept)\w* (?:over|through)`), inPrompt: true },
  { id: 'steeled', group: 'body', phrase: 'she steeled herself', pattern: re(String.raw`steel(?:ed|ing|s)? (?:herself|himself|themselves|themself|myself|yourself|ourselves)`) },
  { id: 'pang', group: 'body', phrase: 'a pang of guilt', pattern: re(String.raw`(?:a|another|the) pang of`) },

  // Grand abstractions
  { id: 'testament', group: 'grand', phrase: 'a testament to', pattern: re(String.raw`(?:a|the) testament to`), inPrompt: true },
  { id: 'tapestry', group: 'grand', phrase: 'a tapestry of', pattern: re(String.raw`tapestry of`), inPrompt: true },
  { id: 'symphony', group: 'grand', phrase: 'a symphony of', pattern: re(String.raw`symphony of`), inPrompt: true },
  { id: 'kaleidoscope', group: 'grand', phrase: 'a kaleidoscope of', pattern: re(String.raw`kaleidoscope of`) },
  { id: 'dance-of', group: 'grand', phrase: 'a dance of', pattern: re(String.raw`(?:a|the|their|this) (?:delicate |intricate |careful |strange )?dance of`) },
  { id: 'beacon', group: 'grand', phrase: 'a beacon of hope', pattern: re(String.raw`beacon of (?:hope|light|safety|warmth)`) },
  { id: 'hung-air', group: 'grand', phrase: 'the words hung in the air', pattern: re(String.raw`(?:words|silence|tension|question|unspoken \w+) hung (?:heavy |thick )?(?:in the air|between (?:them|us))`), inPrompt: true },
  { id: 'air-thick', group: 'grand', phrase: 'the air was thick with tension', pattern: re(String.raw`air (?:was |hung |grew |felt )?(?:thick|heavy|electric|charged) with`) },
  { id: 'palpable', group: 'grand', phrase: 'palpable tension', pattern: re(String.raw`palpable (?:tension|silence|fear|relief)|(?:tension|silence|fear) (?:was )?palpable`) },
  { id: 'world-breath', group: 'grand', phrase: 'the world held its breath', pattern: re(String.raw`(?:world|room|forest|air|city|night|house) (?:seemed to )?(?:hold|held|holding) (?:its|their) breath`) },
  { id: 'unspoken', group: 'grand', phrase: 'an unspoken understanding', pattern: re(String.raw`unspoken (?:promise|understanding|agreement|question|words)`) },
  { id: 'electricity', group: 'grand', phrase: 'a jolt of electricity', pattern: re(String.raw`(?:jolt|spark|current|shock) of electricity`) },
  { id: 'comfortable-silence', group: 'grand', phrase: 'a comfortable silence', pattern: re(String.raw`(?:comfortable|companionable) silence`) },

  // Stock sentence patterns
  { id: 'not-x-but-y', group: 'pattern', phrase: "it wasn't fear, it was something else", pattern: re(String.raw`(?:it|this|that) (?:wasn['’]t|was not|isn['’]t|is not) (?:just |merely |only |simply )?(?:a |an |the )?\w+(?: \w+)?[,;.—–] ?(?:but|it was|it['’]s|this was)`), inPrompt: true },
  { id: 'mix-of', group: 'pattern', phrase: 'a mixture of fear and excitement', pattern: re(String.raw`(?:a|an) (?:strange |odd |heady |curious )?(?:mix|mixture|blend|cocktail) of \w+ and \w+`) },
  { id: 'help-but', group: 'pattern', phrase: "couldn't help but", pattern: re(String.raw`(?:couldn['’]t|could not|can['’]t|cannot) help but`) },
  { id: 'something-shifted', group: 'pattern', phrase: 'something shifted between them', pattern: re(String.raw`something (?:shifted|changed|broke|cracked) (?:in|between|inside)`) },
  { id: 'in-that-moment', group: 'pattern', phrase: 'in that moment', pattern: re(String.raw`in that moment`) },
  { id: 'little-know', group: 'pattern', phrase: 'little did she know', pattern: re(String.raw`little did (?:he|she|they|i|we|you) know`) },
  { id: 'first-time', group: 'pattern', phrase: 'for the first time in a long time', pattern: re(String.raw`for the first time in (?:a long time|years|what felt like (?:years|forever|an eternity)|forever)`) },

  // Summing-up lines
  { id: 'was-enough', group: 'closer', phrase: 'and somehow, that was enough', pattern: re(String.raw`(?:and )?(?:somehow,? )?(?:that|it|this) (?:was|would be) enough`), inPrompt: true },
  { id: 'face-together', group: 'closer', phrase: 'whatever came next, they would face it together', pattern: re(String.raw`whatever (?:came|comes|happened|lay ahead|awaited)(?: next)?,? (?:they|we|she|he|I) (?:would|will|could) face`), inPrompt: true },
  { id: 'only-beginning', group: 'closer', phrase: 'this was only the beginning', pattern: re(String.raw`(?:this|it|that) was (?:only|just) the beginning`) },

  // Overused words
  { id: 'delve', group: 'word', phrase: 'delve', pattern: re(String.raw`delv(?:e|ed|es|ing)`) },
  { id: 'orbs', group: 'word', phrase: 'orbs (for eyes)', pattern: re(String.raw`(?:his|her|their|my|your) (?:\w+ )?orbs(?! of)`) },
  { id: 'ministrations', group: 'word', phrase: 'ministrations', pattern: re(String.raw`ministrations`) },
  { id: 'smirk', group: 'word', phrase: 'smirked', pattern: re(String.raw`smirk(?:ed|ing|s)?`) }
]

/**
 * The six rules the writer model is given, written as what to do. Each answers one kind of fault writers
 * fix most in AI fiction; tense slips are covered by the style guide's own tense line.
 */
export const SLOP_RULES: readonly string[] = [
  'Show feelings through what the body does and what the character chooses, in fresh, specific terms, never stock reactions.',
  "Say each thing once and trust the reader: don't explain what the scene already shows or restate what a line of dialogue meant.",
  'Prefer the plain, exact word to the ornate one. One sharp image beats three adjectives; keep metaphors rare and earned.',
  'Use details that belong to this world and these people, not ones that could sit in any story.',
  "Vary sentence shapes. Avoid \"it wasn't X, it was Y\" contrasts, lists of three adjectives, and sentences that all open the same way.",
  'End on action, dialogue or an image, never on a line that sums up what it all meant or promises what comes next.'
]

/** The phrases named in the prompt: the worst offenders only. */
export const PROMPT_SLOP: readonly string[] = SLOP_PHRASES.filter((p) => p.inPrompt).map((p) => p.phrase)

export interface SlopMatch {
  id: string
  group: SlopGroup
  phrase: string
  /** Character offsets in the text. */
  from: number
  to: number
  /** The words as written. */
  text: string
}

/** Every common AI phrase in the text, in order, never overlapping (the earliest and then longest wins). */
export function findSlop(text: string): SlopMatch[] {
  const found: SlopMatch[] = []
  for (const p of SLOP_PHRASES) {
    p.pattern.lastIndex = 0
    for (const m of text.matchAll(p.pattern)) {
      const from = m.index ?? 0
      found.push({ id: p.id, group: p.group, phrase: p.phrase, from, to: from + m[0].length, text: m[0] })
    }
  }
  found.sort((a, b) => a.from - b.from || b.to - a.to)
  const out: SlopMatch[] = []
  for (const m of found) if (!out.length || m.from >= out[out.length - 1].to) out.push(m)
  return out
}

/** The phrase by id (for ignores and hover cards), or null. */
export function slopById(id: string): SlopPhrase | null {
  return SLOP_PHRASES.find((p) => p.id === id) ?? null
}
