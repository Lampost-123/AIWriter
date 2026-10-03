// Adapted from mcreader-v2, src/lib/speech/perform.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026). MCreader's per-paragraph "performer" call is left out: AI Write's AI notes come from the
// marks (speakers.ts, "Mark who says what").
//
// Getting a line ready for an expressive voice (Breeze TTS 2) before it is spoken, with rules and no AI call:
// - `tagSounds`: stage directions the page already has ("*giggles*", "[sighs]") and sounds spelled out
//   inside dialogue ("Haha", "Ahem", "Achoo") become Breeze's sound tags, so the voice makes the sound
//   instead of reading the word (Perform written sounds).
// - `cueFor`: the dialogue tag of a quote. `"Go to your room now!" Mom shouted` gives the line a shouting
//   delivery; `"Fine," she sighed` gives it a (sigh).

/**
 * Breeze's 34 sound events, spelled the way the open model's own page writes them: the event's name in
 * parentheses, as a plain verb. Tags go in dialogue; the narrator never performs one unless a mark says so.
 */
export const BREEZE_TAGS = [
  '(laugh)',
  '(chuckle)',
  '(giggle)',
  '(cry)',
  '(sob)',
  '(whimper)',
  '(groan)',
  '(moan)',
  '(sigh)',
  '(gasp)',
  '(inhale)',
  '(exhale)',
  '(breathe heavily)',
  '(whisper)',
  '(shout)',
  '(scream)',
  '(sing)',
  '(hum)',
  '(stutter)',
  '(pause)',
  '(clears throat)',
  '(cough)',
  '(sniff)',
  '(smack lips)',
  '(click tongue)',
  '(yawn)',
  '(sneeze)',
  '(hiccup)',
  '(burp)',
  '(gulp)',
  '(gag)',
  '(grunt)',
  '(scoff)',
  '(snort)'
] as const

const TAGS = new Set<string>(BREEZE_TAGS)

/** A word for a sound, in any form ("laughed", "laughing", "laughs"), and its tag. First match wins. */
const ACTIONS: [RegExp, string][] = [
  [/\bclear(?:s|ed|ing)?\s+(?:\w+\s+)?throat\b/i, '(clears throat)'],
  [/\bsmack(?:s|ed|ing)?\s+(?:\w+\s+)?lips\b|\blip\s*smack\w*/i, '(smack lips)'],
  [/\bclick(?:s|ed|ing)?\s+(?:\w+\s+)?tongue\b|\btsks?\b/i, '(click tongue)'],
  [/\bbreath(?:e|es|ed|ing)?\s+heavily\b|\bpant(?:s|ed|ing)?\b/i, '(breathe heavily)'],
  [/\bchuckl\w*/i, '(chuckle)'],
  [/\bgiggl\w*|\bsnicker\w*|\btitter\w*/i, '(giggle)'],
  [/\blaugh\w*/i, '(laugh)'],
  [/\bsob(?:s|bed|bing)?\b/i, '(sob)'],
  [/\bcr(?:y|ies|ying)\b|\bweep\w*|\bwept\b/i, '(cry)'],
  [/\bwhimper\w*/i, '(whimper)'],
  [/\bgroan\w*/i, '(groan)'],
  [/\bmoan\w*/i, '(moan)'],
  [/\bsigh\w*/i, '(sigh)'],
  [/\bgasp\w*/i, '(gasp)'],
  [/\binhal\w*|\bdeep breath\b/i, '(inhale)'],
  [/\bexhal\w*/i, '(exhale)'],
  [/\bwhisper\w*/i, '(whisper)'],
  [/\bshout\w*|\byell\w*/i, '(shout)'],
  [/\bscream\w*|\bshriek\w*/i, '(scream)'],
  [/\bsing(?:s|ing)?\b|\bsang\b/i, '(sing)'],
  [/\bhum(?:s|med|ming)?\b/i, '(hum)'],
  [/\bstutter\w*|\bstammer\w*/i, '(stutter)'],
  [/\bpause\w*/i, '(pause)'],
  [/\bcough\w*/i, '(cough)'],
  [/\bsniff\w*/i, '(sniff)'],
  [/\byawn\w*/i, '(yawn)'],
  [/\bsneez\w*/i, '(sneeze)'],
  [/\bhiccup\w*/i, '(hiccup)'],
  [/\bburp\w*|\bbelch\w*/i, '(burp)'],
  [/\bgulp\w*|\bswallow\w*/i, '(gulp)'],
  [/\bgag(?:s|ged|ging)?\b/i, '(gag)'],
  [/\bgrunt\w*/i, '(grunt)'],
  [/\bscoff\w*/i, '(scoff)'],
  [/\bsnort\w*/i, '(snort)']
]

/** Sounds spelled out in dialogue. Only inside quotes: in narration "Ha" is rarely a laugh to perform. */
const SPELLED: [RegExp, string][] = [
  [/\b(?:bwa)?(?:a?ha(?:[- ]?ha)+h?)\b/gi, '(laugh)'],
  [/\b(?:hee(?:[- ]?hee)+|he(?:[- ]?he)+|tee[- ]?hee)\b/gi, '(giggle)'],
  [/\bheh(?:[- ]?heh)*\b/gi, '(chuckle)'],
  [/\bahem\b/gi, '(clears throat)'],
  [/\b(?:a+h?[- ]?choo+|atchoo+|achoo+)\b/gi, '(sneeze)'],
  [/\bboo[- ]?hoo+\b/gi, '(sob)'],
  [/\bhic\b/gi, '(hiccup)'],
  [/\bpf+t+\b/gi, '(scoff)'],
  [/\btsk(?:[- ]?tsk)*\b/gi, '(click tongue)'],
  [/\ba{3,}h*\b/gi, '(scream)']
]

/** The tag a stage direction or a tag in another spelling stands for; null when it is longer than a few words. */
export function canonicalTag(inner: string): string | null {
  const t = inner.trim().toLowerCase()
  if (TAGS.has(`(${t})`)) return `(${t})`
  if (!t || t.split(/\s+/).length > 5) return null
  return ACTIONS.find(([re]) => re.test(t))?.[1] ?? null
}

/**
 * Words a short note has besides the sound it names, not counting "a", "his" and the like: "frightened" in
 * "frightened whisper", "" in "sighs" or "clears his throat".
 */
export function besideSound(inner: string): string {
  const t = inner
    .trim()
    .toLowerCase()
    .replace(/^\((.*)\)$/, '$1')
  if (TAGS.has(`(${t})`)) return ''
  const hit = ACTIONS.find(([re]) => re.test(t))
  const rest = hit ? t.replace(hit[0], ' ') : t
  return rest
    .split(/[^a-z']+/)
    .filter((w) => w && !/^(?:a|an|the|his|her|their|its|one|and|with)$/.test(w))
    .join(' ')
}

/**
 * Written sounds as Breeze tags: `*giggles*`, `_sighs_`, `[laughs]` and `(laughing)` anywhere; "Haha", "Ahem",
 * "Achoo"… inside quotes. The words around them are left exactly as they were.
 */
export function tagSounds(text: string): string {
  let out = text.replace(
    /(?<![\w*])\*{1,2}([^*\n]{1,48})\*{1,2}(?![\w*])|(?<!\w)_([^_\n]{1,48})_(?!\w)|\[([^\]\n]{1,48})\]|\(([^)\n]{1,48})\)/g,
    (whole, a?: string, b?: string, c?: string, d?: string) => canonicalTag(a ?? b ?? c ?? d ?? '') ?? whole
  )
  out = out.replace(/["“][^"”]*["”]/g, (quote) => {
    let q = quote
    // A spelled sound and the comma or "!" straight after it: `"Haha! Fine."` reads `"(laugh) Fine."`.
    for (const [re, tag] of SPELLED) q = q.replace(new RegExp(`${re.source}[,!]?`, re.flags), tag)
    return q
  })
  return out
}

/** Puts a tag just inside a quote's opening mark, unless the line already has it. */
export function withTag(quote: string, tag: string): string {
  if (quote.includes(tag)) return quote
  const m = /^(\s*["“]?)\s*/.exec(quote)!
  return `${m[1]}${tag} ${quote.slice(m[0].length)}`
}

// ---------- The dialogue tag: tone and sound without an AI call ----------

/** Speech verbs that say how a line sounds. The first that matches the tag wins. */
const TONES: [RegExp, string][] = [
  [/\bscream\w*|\bshriek\w*/i, 'screaming, at the top of their lungs'],
  [/\bshout\w*|\byell\w*|\bbellow\w*|\bholler\w*|\broar\w*|\bcalled out\b/i, 'shouting, loud and forceful'],
  [/\bsnap\w*/i, 'sharp and irritated'],
  [/\bbark\w*|\border\w*|\bcommand\w*|\bdemand\w*/i, 'stern and commanding'],
  [/\bwhisper\w*|\bmurmur\w*|\bbreathed\b/i, 'whispering, soft and close'],
  [/\bmutter\w*|\bmumbl\w*/i, 'muttering under their breath'],
  [/\bhiss\w*/i, 'a tense, angry hiss'],
  [/\bgrowl\w*|\bsnarl\w*/i, 'low, rough and threatening'],
  [/\bpleaded\b|\bplead\w*|\bbeg(?:s|ged|ging)?\b/i, 'pleading, desperate'],
  [/\bsob\w*|\bwept\b|\bweep\w*|\bwail\w*|\bthrough (?:her|his|their) tears\b/i, 'crying, the voice breaking'],
  [/\bcried\b/i, 'crying out, emotional'],
  [/\blaugh\w*|\bgiggl\w*|\bchuckl\w*/i, 'laughing as they speak'],
  [/\bsigh\w*/i, 'weary, on a sigh'],
  [/\bgasp\w*/i, 'breathless and shocked'],
  [/\bstammer\w*|\bstutter\w*/i, 'stammering, nervous'],
  [/\bteas\w*/i, 'teasing, playful'],
  [/\bgroan\w*/i, 'groaning, fed up'],
  [/\bsneer\w*|\bscoff\w*/i, 'scornful'],
  [/\bwarn\w*/i, 'a serious warning'],
  [/\bcalled\b/i, 'calling out, voice raised']
]

/** The sound a dialogue tag says was made with the line. Delivery verbs (whispered, shouted) stay a tone. */
const TAG_SOUNDS = new Set([
  '(laugh)',
  '(chuckle)',
  '(giggle)',
  '(sob)',
  '(cry)',
  '(sigh)',
  '(gasp)',
  '(cough)',
  '(sniff)',
  '(groan)',
  '(whimper)',
  '(scoff)',
  '(snort)',
  '(yawn)',
  '(grunt)',
  '(clears throat)',
  '(gulp)',
  '(stutter)'
])

const NOT_ADVERBS = new Set([
  'only',
  'early',
  'family',
  'reply',
  'rely',
  'ally',
  'holy',
  'belly',
  'jelly',
  'bully',
  'lily',
  'fly',
  'apply',
  'supply',
  'silly',
  'ugly',
  'lovely',
  'friendly',
  'lonely',
  'likely',
  'daily',
  'curly',
  'surly',
  'burly',
  'hilly',
  'chilly',
  'jolly',
  'rally',
  'sully',
  'tally',
  'wily',
  'oily',
  'italy',
  'july'
])

export interface Cue {
  delivery?: string
  tag?: string
}

/**
 * What the words around a quote say about how it is spoken: `Mom snapped`, `she said softly`, `he sighed`, and
 * the quote's own punctuation. Reads the tag straight after the quote (to the end of that sentence), and the
 * narration before it when this is the paragraph's first quote.
 */
export function cueFor(para: string, at: number, len: number): Cue {
  const quote = para.slice(at, at + len)
  const rest = para.slice(at + len)
  const after = rest.slice(0, Math.max(0, rest.search(/["“]/)) || rest.length).match(/^[^.!?"“]{0,80}[.!?]?/)?.[0] ?? ''
  const earlier = para.slice(0, at)
  const before = /["”]/.test(earlier) ? '' : (earlier.match(/[^.!?]*[.!?]?\s*[^.!?]*$/)?.[0] ?? '').slice(-100)
  const around = `${before} ${after}`
  const tone = TONES.find(([re]) => re.test(around))?.[1]
  const adverb = after.match(/\b([a-z]{3,}ly)\b/i)?.[1]?.toLowerCase()
  const manner = adverb && !NOT_ADVERBS.has(adverb) ? adverb : ''
  const words = quote.match(/[A-Za-z]{3,}/g) ?? []
  const caps = words.length > 0 && words.filter((w) => w === w.toUpperCase()).length >= Math.max(1, Math.ceil(words.length / 2))
  const bang = /!["”]?\s*$/.test(quote.trim()) || /![,”"]/.test(quote)
  const parts = [
    tone ?? (caps ? 'shouting, loud and forceful' : ''),
    manner,
    !tone && !caps && bang ? 'emphatic, voice raised' : ''
  ].filter(Boolean)
  const sound = ACTIONS.find(([re, tag]) => TAG_SOUNDS.has(tag) && re.test(around))?.[1]
  return {
    ...(parts.length ? { delivery: parts.join(', ') } : {}),
    ...(sound ? { tag: sound } : {})
  }
}
