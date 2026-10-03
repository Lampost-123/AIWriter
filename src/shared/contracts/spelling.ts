// Writing by hand: spelling and synonyms. Owned by the Spelling part (features/spelling, src/main/spelling).
//
// Spell check uses Chromium's own checker in the main process (Electron's session): its language follows the
// spelling that applies to the open story (Adam's writing preferences, then the world's style guide, then the
// story's). The open world's names, aliases and glossary terms, and Adam's own "Add to dictionary" words, count as
// correct: the page hides Chromium's underline on them, and the menu offers no spelling suggestions for them. They
// are never put into Chromium's dictionary (on Windows and macOS that is the system's, shared with other programs).
// The right-click menu is built in the main process (src/main/spelling/menu.ts); the word under the pointer is
// worked out in the window, which tells main just before the menu opens (noteContextWord), and a synonym picked
// there comes back to the window as an event to be put into the page by the editor.

import type { ID, Spelling } from '../types'

/** A part of speech as the synonyms menu labels it. */
export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb'

/** One sense of a word: its part of speech and a handful of words for it, in the writer's spelling. */
export interface SynonymSense {
  pos: PartOfSpeech
  words: string[]
}

/** The word right-clicked in the page (or the one word selected), noted by the window as the menu opens. */
export interface ContextWord {
  /** Matches the word to the replacement that comes back. */
  token: number
  word: string
  sceneId: ID
}

/** What the window says about a right-click as it starts: where it was (in the page), and the word there, if any. */
export interface ContextNote {
  x: number
  y: number
  word: ContextWord | null
}

/** How spell check stands after a sync. */
export interface SpellingState {
  enabled: boolean
  spelling: Spelling
  /** 'en-GB' or 'en-US'. */
  language: string
  /** How many of the open world's words count as correct. */
  worldWords: number
  /** Every word that counts as correct now: the open world's and Adam's own (as written). */
  knownWords: string[]
}

export interface SpellingApi {
  /**
   * Brings spell check in line with the open world and the story Adam is in: on or off (Settings › Editor), its
   * language, and the world's names counting as correct. The window calls it when any of those change.
   */
  syncSpelling(storyId: ID | null): Promise<SpellingState>
  /**
   * A right-click is starting at (x, y): the word under the pointer in the page, or null for a right-click elsewhere.
   * The menu for that right-click uses this note and no other (it is matched by where the click was).
   */
  noteContextWord(note: ContextNote): Promise<void>
  /** Synonyms for a word, in the spelling that applies (as the right-click menu shows them). */
  synonymsOf(word: string): Promise<SynonymSense[]>
}

export interface SpellingEvents {
  /** A synonym was picked in the right-click menu: put it in place of the noted word (`token`). */
  'spelling:replaceWord': { token: number; replacement: string }
  /** "Add to this world's glossary" was picked for a word in the right-click menu. */
  'spelling:addToGlossary': { word: string }
  /** Adam added a word to his own list (Add to dictionary): the words that count as correct now. */
  'spelling:wordsChanged': { knownWords: string[] }
}
