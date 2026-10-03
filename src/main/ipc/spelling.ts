// Writing by hand: the handlers for src/shared/contracts/spelling.ts (spell check and synonyms). The work is in
// src/main/spelling/.
import type { Handlers } from './index'
import type { SpellingApi } from '@shared/contracts/spelling'
import { noteContextWord, syncSpelling, synonymsOf } from '../spelling'

export const spellingHandlers: Handlers<keyof SpellingApi> = {
  syncSpelling: (storyId) => syncSpelling(typeof storyId === 'string' ? storyId : null),
  noteContextWord: (note) => noteContextWord(note),
  synonymsOf: (word) => synonymsOf(word)
}
