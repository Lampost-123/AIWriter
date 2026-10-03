// Adapted from mcreader-v2, src/lib/speech/types.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026). Read-aloud shapes the main process's reading code shares.
import type { CharacterVoice } from '@shared/contracts/readAloud'

/**
 * One line as it is meant to be said: a tone an actor could play, a pace other than normal, and a Breeze sound tag
 * at its start. An empty one records that the line was asked about.
 */
export interface LineDelivery {
  tone?: string
  pace?: 'slow' | 'fast'
  sound?: string
}

/** A paragraph's marks: quote key → speaker, and quote or narration key → how it is said. */
export interface ParagraphMarks {
  speakers?: Record<string, string>
  delivery?: Record<string, LineDelivery>
}

/** A character as reading aloud uses it. */
export interface CastEntry {
  id: string
  name: string
  aliases: string[]
  /** A line about who they are, for the AI that marks who says what. */
  about: string
  voice?: CharacterVoice
  /** How the name is said ("Say it as"). */
  say?: string
}
