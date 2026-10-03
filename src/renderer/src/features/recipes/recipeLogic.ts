// Words and small decisions for the recipe screens. Pure, so it is unit-tested. Owned by the Story recipes part.

import type { OutlineSize } from '@shared/contracts/outline'
import type { RecipeEstimate, RecipeMaking, RecipePartId, RecipeSummary } from '@shared/contracts/recipes'
import { dollars } from '@/features/importing/importLogic'

/** What each part of a recipe is called on screen, and the line under it while it is empty. */
export const PART_WORDS: Record<RecipePartId, { label: string; hint: string; short?: boolean }> = {
  themes: { label: 'Themes', hint: 'What the story is about underneath, how each theme surfaces and where it is tested, and each act’s tone and mood.' },
  tone: { label: 'Tone', hint: 'The story’s tone in a few words.', short: true },
  style: { label: 'Writing style', hint: 'The voice, sentence rhythm, vocabulary, the balance of description, inner thought and dialogue, and how scenes open and close.' },
  pov: { label: 'Point of view', hint: 'Such as close third person, one character at a time.', short: true },
  tense: { label: 'Tense', hint: 'Past or present.', short: true },
  sample: { label: 'Sample passage', hint: 'A short passage written fresh in this style, never taken from the story.' },
  shape: { label: 'Shape', hint: 'The acts and chapters, the job each one does, and where the turning points fall.' },
  beats: { label: 'Beats', hint: 'What happens, chapter by chapter, as general moves anyone could reuse.' },
  cast: { label: 'Cast roles', hint: 'The parts the characters play, each one’s arc, and how they relate.' },
  pacing: { label: 'Pacing', hint: 'Chapter and scene lengths, how much is dialogue, where tension rises and falls.' },
  devices: { label: 'Devices', hint: 'Set-ups and pay-offs, twists and recurring motifs.' }
}

/** The groups the recipe page shows its parts in. */
export const PART_GROUPS: { title: string; parts: RecipePartId[] }[] = [
  { title: 'What it is about', parts: ['themes', 'tone'] },
  { title: 'How it is written', parts: ['style', 'pov', 'tense', 'sample'] },
  { title: 'How it is built', parts: ['shape', 'beats', 'cast', 'pacing', 'devices'] }
]

/** A recipe's name on screen: its own, or words that never give away the story it came from. */
export const recipeName = (r: Pick<RecipeSummary, 'name' | 'status'>): string =>
  r.name.trim() || (r.status === 'ready' ? 'Untitled recipe' : 'New recipe')

const n = (k: number, one: string, many = `${one}s`): string => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`

/** "From a story of 24 chapters, 96,000 words", or "Written by hand". */
export function lengthWords(r: Pick<RecipeSummary, 'words' | 'chapters' | 'byHand'>): string {
  if (r.byHand || !r.words) return 'Written by hand'
  return `From a story of ${n(r.chapters, 'chapter')}, ${n(r.words, 'word')}`
}

/** "3 October 2026". */
export function dateWords(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** "About $0.40 with Claude Haiku, to read 24 chapters (96,000 words)." */
export function estimateWords(e: RecipeEstimate): string {
  const what = `${n(e.chapters, 'chapter')} (${n(e.words, 'word')})`
  const price = dollars(e.cost)
  if (!price) return `The cost isn’t known for ${e.model ?? 'this model'}. It reads ${what}.`
  return `${price}${e.model ? ` with ${e.model}` : ''}, to read ${what}.`
}

/** "Reading chapter 3 of 24", or what it is doing instead. */
export function makingWords(m: RecipeMaking): string {
  if (m.status === 'stopping') return 'Stopping…'
  if (m.status === 'paused') return 'Making the recipe has paused'
  if (m.status === 'starting') return 'Getting ready…'
  if (m.step === 'writing') return 'Writing the recipe'
  if (m.step === 'checking') return 'Checking it keeps none of the story’s words'
  return `Reading chapter ${m.chapter} of ${m.chapters}`
}

/** How far along it is, 0 to 1 (reading is most of the work). */
export function makingShare(m: RecipeMaking): number {
  if (m.step === 'writing') return 0.9
  if (m.step === 'checking') return 0.97
  return m.chapters ? Math.min(0.88, ((m.chapter - 1) / m.chapters) * 0.88) : 0
}

/**
 * The premise at the top of a planned story ("Premise: …", up to the first heading). '' until it has arrived;
 * `complete` once something after it has started or the reply has ended.
 */
export function premiseOf(text: string, ended: boolean): { text: string; complete: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const at = lines.findIndex((l) => /^\s*(?:\*\*)?premise(?:\*\*)?\s*:/i.test(l))
  if (at < 0) return { text: '', complete: ended }
  const out: string[] = [lines[at].replace(/^\s*(?:\*\*)?premise(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i, '')]
  let complete = ended
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\s*(#|\*\*\s*(act|chapter)|(act|chapter)\b)/i.test(lines[i])) {
      complete = true
      break
    }
    out.push(lines[i])
  }
  return { text: out.join(' ').replace(/\s+/g, ' ').trim(), complete }
}

/** How much to plan for a story from a recipe: as many chapters as the story it came from (9 for one written by hand). */
export function sizeForRecipe(chapters: number): OutlineSize {
  const c = Math.max(1, Math.min(30, chapters || 9))
  return { acts: Math.min(3, c), chapters: c, scenes: Math.max(1, Math.min(3, Math.floor(100 / c))) }
}
