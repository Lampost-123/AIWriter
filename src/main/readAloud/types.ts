// Adapted from mcreader-v2, src/lib/speech/types.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026). Read-aloud shapes the main process's reading code shares.
import type { CharacterVoice } from '@shared/contracts/readAloud'

/**
 * One line as it is meant to be said: a tone an actor could play, a pace other than normal, and a Breeze sound tag
 * at its start. An empty one records that the line was asked about. `feeling` and `intensity` come from the
 * director (director.ts): one of the feelings of emotion.ts, and how strongly (1 a hint, 3 strong). `by`: a note the
 * director wrote (not the writer's tag), which Emotion and tone off leaves unread.
 */
export interface LineDelivery {
  tone?: string
  pace?: 'slow' | 'fast'
  sound?: string
  feeling?: string
  intensity?: 1 | 2 | 3
  by?: 'director'
}

/** What a line is (the director's marks, and the rules' in kinds.ts): said aloud, thought, written, or nobody's words. */
export const LINE_KINDS = ['speech', 'thought', 'text_message', 'chat', 'letter', 'sign', 'narration'] as const
export type LineKind = (typeof LINE_KINDS)[number]

/**
 * A paragraph's marks: quote key → speaker, and quote or narration key → how it is said. From the director,
 * `kinds`: quote or narration key → what the line is; `voiced`: narration key → the character who owns that
 * sentence (a thought, a message, a letter), read in their voice.
 */
export interface ParagraphMarks {
  speakers?: Record<string, string>
  delivery?: Record<string, LineDelivery>
  kinds?: Record<string, LineKind>
  voiced?: Record<string, string>
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
