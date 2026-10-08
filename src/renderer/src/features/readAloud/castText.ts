// Settings › Read aloud › Cast, in words: the voice each character is read in now, and what "Give everyone without a
// voice a voice" did. Pure, so it is tested on its own (castText.test.ts). Owned by the Read aloud part.
import type { CastEntry, ReadAloudVoice } from '@shared/contracts/readAloud'

/** A voice from the list by its name ("Clara"), else the studio voice's own name, else its id without "clip:". */
export function voiceName(voice: string, voices: readonly ReadAloudVoice[] | null, studioName: string | null = null): string {
  return voices?.find((v) => v.id === voice)?.name ?? studioName ?? voice.replace(/^clip:(?:library\/)?/, '').replace(/\.wav$/, '')
}

/** A studio voice: the list says so, or its id is one (clip:library/…). */
const isStudio = (voice: string, voices: readonly ReadAloudVoice[] | null): boolean =>
  voices?.find((v) => v.id === voice)?.studio ?? /^clip:library\//.test(voice)

/**
 * The voice a character's lines are read in now: "Clara (studio voice)", "Auto: Arthur (studio voice)" when the app
 * gave it, "Made from their description", or "Dialogue voice" when they have none of their own.
 */
export function castVoiceText(row: Pick<CastEntry, 'value' | 'auto' | 'studioName'>, voices: readonly ReadAloudVoice[] | null): string {
  const { voice, design } = row.value.voice
  if (voice) {
    const name = `${voiceName(voice, voices, row.studioName)}${isStudio(voice, voices) ? ' (studio voice)' : ''}`
    return row.auto ? `Auto: ${name}` : name
  }
  if (design.trim()) return 'Made from their description'
  return 'Dialogue voice'
}

/** No voice of their own at all: none picked and nothing in How they sound. */
export const voiceless = (row: Pick<CastEntry, 'value'>): boolean => !row.value.voice.voice && !row.value.voice.design.trim()

/** What Give everyone a voice did: "Wren Halloway: Clara · Ansel Crane: Arthur", in the order given. */
export function givenText(given: readonly string[], rows: readonly CastEntry[], voices: readonly ReadAloudVoice[] | null): string {
  return given
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is CastEntry => !!r)
    .map((r) => `${r.name}: ${voiceName(r.value.voice.voice, voices, r.studioName)}`)
    .join(' · ')
}
