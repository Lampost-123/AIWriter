// Adam's own writing as the writer's voice sample (2026-10-19): the style guide's sample passage is empty unless Adam
// fills it, and "Write a sample for me" has the AI write it, so the writer copied the AI's own voice. Passages Adam wrote
// or rewrote himself (src/main/style/ownWords.ts) are shown instead, when he has written enough. Shared by the main
// process (which picks them) and the screens (the switch, and What the AI saw). Pure.

import type { ContextBlock, WritingPrefs } from './types'

/** How much of Adam's own writing the sample takes, in words. */
export const OWN_SAMPLE = {
  /** Fewer words of his own than this and the writer goes on as before (the style guide's sample passage, if any). */
  min: 150,
  /** What the picking aims for. */
  target: 400,
  /** Never more than this. */
  max: 500,
  /** The most taken from one stretch of one scene, so the sample comes from more than one scene. */
  perPassage: 220,
  /** About how much is said again right above the closing instruction ("Sound like this"). */
  echo: 120
} as const

/** The block that says some of Adam's own words again just above the closing instruction. */
export const SOUND_BLOCK = { id: 'sound-like', title: 'Sound like this' } as const

/** The switch's words, on the style screen and in Settings › My writing preferences. */
export const OWN_SAMPLE_LABEL = 'Use my own writing as the sample'
export const OWN_SAMPLE_HINT =
  'While the sample passage is empty, the AI is shown passages you wrote or rewrote yourself in the story so far, never its own words, so its drafts sound like you. It needs about 150 words of yours.'
/** Under a sample passage that has words in it. */
export const OWN_SAMPLE_OVER_HINT =
  'Show the AI passages you wrote or rewrote yourself in the story so far in place of this sample passage. It needs about 150 words of yours.'

/**
 * Whether Adam's own writing takes the place of the sample passage: his choice when he made one, else only while the
 * style guide's sample passage is empty.
 */
export function ownSampleOn(pref: WritingPrefs['ownSample'], samplePassage: string | null | undefined): boolean {
  if (pref === true || pref === false) return pref
  return !(samplePassage ?? '').trim()
}

/**
 * What the switch saves when Adam flips it, for the sample passage it sits under: left out (on while the sample passage
 * is empty) wherever that already gives what he asked for, so filling the sample passage later still wins.
 */
export function ownSamplePref(on: boolean, samplePassage: string | null | undefined): WritingPrefs['ownSample'] {
  const empty = !(samplePassage ?? '').trim()
  if (on) return empty ? undefined : true
  return false
}

const joinAnd = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** "Ch 3, Sc 2, Ch 1, Sc 4 and 2 more", at most `most` places named. */
function placesText(from: string[], most = 3): string {
  const named = from.filter(Boolean)
  if (!named.length) return 'the story so far'
  if (named.length <= most) return joinAnd(named)
  const rest = named.length - most
  return `${named.slice(0, most).join(', ')} and ${rest} more ${rest === 1 ? 'scene' : 'scenes'}`
}

/**
 * What What the AI saw and the Context tab say about a part that holds Adam's own writing; null for any other part.
 * "The sample passage is your own writing: 412 words from Ch 3, Sc 2 and Ch 1, Sc 4. Nothing the AI wrote is in it."
 */
export function ownWritingNote(block: Pick<ContextBlock, 'id' | 'ownWriting'>): string | null {
  const own = block.ownWriting
  if (!own || own.words <= 0) return null
  const words = `${own.words.toLocaleString('en-GB')} ${own.words === 1 ? 'word' : 'words'}`
  if (block.id === SOUND_BLOCK.id) return `Your own words again, from ${placesText(own.from)}, said just before the AI writes so it keeps your voice.`
  return `The sample passage is your own writing: ${words} from ${placesText(own.from)}. Nothing the AI wrote unchanged is in it.`
}
