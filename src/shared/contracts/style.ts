// The style guide's helper ("Story feel" on the Style guide screen): "Write a sample for me" writes a short
// passage from the genre picks, the prose style and the point of view and tense, so a world without any of
// Adam's own writing still gets a sample passage to show the AI how the book should sound.
//
// It runs through the shared task runner (task:* events, contracts/tasks.ts) with the writer model and its own
// Thinking (`settings.thinking.sample`, Off). Nothing is saved to the style guide until Adam keeps the sample.
import type { ID, StyleGuide } from '../types'

export interface StyleSampleInput {
  /** Made by the interface (any unique id), so every task event can be matched to it. */
  taskId: ID
  /** The story whose guide the sample is for, or null for the world's guide (its tone is used when set). */
  storyId: ID | null
  /** The style guide in effect as the screen shows it: unsaved typing included, the levels underneath merged in. */
  style: StyleGuide
}

export interface StyleApi {
  /** Starts writing a sample passage (about 200 words): its words arrive as task events for `taskId`. */
  writeStyleSample(input: StyleSampleInput): Promise<{ generationId: ID }>
}

export interface StyleEvents {
  // The task events (contracts/tasks.ts) carry everything the sample needs.
}
