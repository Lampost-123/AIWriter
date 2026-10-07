// Adapted from mcreader-v2, src/lib/speech/emotion.ts (EMOTIONS, emotionOf) and src/lib/speech/speech.ts (moodFor,
// unhurried) (reading aloud's own text-to-speech code; Adam's rule, 2 October 2026).
//
// The feeling a line is read with, from the few words that say how it is said ("sharp and irritated"): a character
// with a studio voice reads it from their own acted recording of that feeling (the speech server's MOOD_CLIPS), and a
// hushed or shouted line from them whispering or reading loudly. And a hurried line is read only a touch quicker:
// "briskly" came out far too fast to listen to.

/** The feelings a line of an audiobook is played with: a small fixed set, each with an acted clip (but neutral). */
export const EMOTIONS = [
  'neutral',
  'warm',
  'happy',
  'playful',
  'excited',
  'tender',
  'longing',
  'sad',
  'anxious',
  'afraid',
  'angry',
  'contemptuous',
  'surprised',
  'tense'
] as const

export type Emotion = (typeof EMOTIONS)[number]

/** Words in a free-text note that say each feeling, as a reader of the note would take them. */
const WORDS: [Emotion, RegExp][] = [
  [
    'angry',
    /\b(angr\w*|furious|fury|rag(e|ing)|livid|seeth\w*|snap\w*|irritat\w*|annoy\w*|exasperat\w*|heated|hostile|outrage\w*|indignant|through (clenched|gritted) teeth|shout\w*|yell\w*|barked?)\b/
  ],
  ['afraid', /\b(afraid|fear\w*|terrif\w*|frighten\w*|scared|panic\w*|dread\w*|horror|horrified|petrified|trembl\w*|shak(y|ing))\b/],
  [
    'anxious',
    /\b(anxious\w*|nervous\w*|worried|worry\w*|uneas\w*|hesitan\w*|unsure|uncertain|tentative\w*|apprehensi\w*|awkward\w*|flustered|halting)\b/
  ],
  [
    'tense',
    /\b(tense\w*|urgent\w*|taut|strained|guarded|wary|warily|terse\w*|clipped|grim\w*|curt\w*|steely|cold\w*|hard|flat warning|low warning|warning)\b/
  ],
  [
    'contemptuous',
    /\b(contempt\w*|sneer\w*|scorn\w*|disdain\w*|mock\w*|sarcas\w*|dismissive\w*|derisi\w*|withering|condescend\w*|sneering|bitter\w*)\b/
  ],
  [
    'sad',
    /\b(sad\w*|grie\w*|sorrow\w*|tear\w*|crying|cries|sob\w*|mourn\w*|despair\w*|broken|heartbroken|melanchol\w*|weary|resigned|defeated|forlorn|choked|cracking|ache?ing?)\b/
  ],
  ['longing', /\b(longing|yearn\w*|wistful\w*|nostalgi\w*|aching|pining|homesick)\b/],
  ['tender', /\b(tender\w*|gentl\w*|soft\w*|loving\w*|affection\w*|sooth\w*|intimate\w*|caring|hushed and warm|murmur\w*)\b/],
  ['warm', /\b(warm\w*|kind\w*|friendly|fond\w*|reassur\w*|welcoming|encourag\w*|patient\w*|easy)\b/],
  ['happy', /\b(happ\w*|joy\w*|delight\w*|cheer\w*|bright\w*|glad\w*|relie\w*|beaming|smil\w*|laugh\w*|pleased)\b/],
  ['playful', /\b(playful\w*|teas\w*|wry\w*|mischiev\w*|amus\w*|joking\w*|jest\w*|grin\w*|dry\w*|sly\w*|flirt\w*|cheek\w*)\b/],
  ['excited', /\b(excit\w*|eager\w*|thrill\w*|elat\w*|enthusias\w*|breathless\w*|giddy|exuberan\w*|animated)\b/],
  ['surprised', /\b(surpris\w*|astonish\w*|startl\w*|shock\w*|disbelie\w*|stunned|incredul\w*|taken aback|amazed)\b/],
  [
    'neutral',
    /\b(neutral\w*|matter[- ]of[- ]fact\w*|even\w*|calm\w*|flat\w*|plain\w*|level\w*|steady|steadily|measured|businesslike|informative)\b/
  ]
]

/**
 * The feeling a free-text note says most, or null when it names none: the one with the most matching words, the
 * earliest in the note on a tie ("angry, then quietly sad" is angry).
 */
export function emotionOf(note: string | undefined): Emotion | null {
  const text = (note ?? '').toLowerCase()
  if (!text.trim()) return null
  let best: { emotion: Emotion; count: number; first: number } | null = null
  for (const [emotion, words] of WORDS) {
    const hits = [...text.matchAll(new RegExp(words.source, 'g'))]
    if (!hits.length) continue
    const found = { emotion, count: hits.length, first: hits[0].index! }
    if (!best || found.count > best.count || (found.count === best.count && found.first < best.first)) best = found
  }
  return best?.emotion ?? null
}

const HUSHED = /\b(?:whisper\w*|hushed|under (?:his|her|their|my) breath|barely audible|sotto voce|breathed)\b/i
const SHOUTED = /\b(?:shout\w*|yell\w*|scream\w*|bellow\w*|roar\w*)\b/i
/** Only a hint of the feeling ("a little irritated"): read from the calm clip, which the note shapes (MCreader's Mood strength). */
const HINT = /\b(?:slight(?:ly)?|a (?:little|touch|hint|trace) (?:of )?|faint(?:ly)?|mild(?:ly)?|somewhat|vaguely)\b/i

/**
 * Which of a studio voice's clips a line of dialogue is copied from (the speech server's MOOD_CLIPS): the speaker
 * whispering for a hushed line, reading loudly for a shout, else acting the line's feeling. A calm line, or one with
 * only a hint of its feeling, has none and is read from the calm clip.
 */
export function moodFor(note: string | undefined): string | undefined {
  if (!note?.trim()) return undefined
  if (HUSHED.test(note)) return 'whisper'
  if (SHOUTED.test(note)) return 'loud'
  const feeling = emotionOf(note)
  if (!feeling || feeling === 'neutral' || HINT.test(note)) return undefined
  return feeling
}

/** A studio voice (one of the speech server's voices/library/ clips), from its voice id. */
export const isStudioVoice = (voice: string | undefined): boolean => /^clip:library\/[A-Za-z0-9_-]+\.wav$/.test(voice ?? '')

/** A note with these words taken out, and the "and"s they leave behind. */
function without(tone: string, words: RegExp): string {
  return tone
    .replace(words, '')
    .split(',')
    .map((part) =>
      part
        .replace(/\s{2,}/g, ' ')
        .trim()
        .replace(/^(?:and|but|yet|then)\s+|\s+(?:and|but|yet|then)$/i, '')
        .trim()
    )
    .filter(Boolean)
    .join(', ')
}

/** Words in a note that ask for a hurried reading, with an "and" or a "very" before them. */
const FAST_WORDS = new RegExp(
  String.raw`(?:\b(?:and|but|yet|then)\s+)?\b(?:very\s+|a\s+little\s+|slightly\s+|more\s+)?(?:` +
    [
      String.raw`at\s+an?\s+(?:quick|fast|rapid|brisk|hurried|breakneck)\s+pace`,
      String.raw`quick(?:ly|er|ening)?`,
      String.raw`fast(?:er)?`,
      String.raw`rapid(?:ly|-fire)?`,
      String.raw`rapid\s+fire`,
      String.raw`rush(?:ed|ing)?`,
      String.raw`in\s+a\s+rush`,
      String.raw`hurried(?:ly)?`,
      String.raw`hurrying`,
      String.raw`brisk(?:ly)?`,
      String.raw`racing`,
      String.raw`(?:(?:the\s+)?words?\s+)?tumbling(?:\s+out)?`,
      String.raw`speeding\s+up`,
      String.raw`picking\s+up\s+(?:the\s+)?pace`
    ].join('|') +
    String.raw`)\b`,
  'gi'
)

/**
 * A hurried line, read only a touch quicker (MCreader's "A little faster", its default): the pace says it ('lively'),
 * and the note's own words for hurrying are taken out, since Breeze follows them a long way.
 */
export function calmed(tone: string, pace: string | undefined): { tone: string; pace: '' | 'slow' | 'lively' } {
  const rushed = pace === 'fast' || new RegExp(FAST_WORDS.source, 'i').test(tone)
  return { tone: without(tone, FAST_WORDS), pace: rushed ? 'lively' : pace === 'slow' ? 'slow' : '' }
}
