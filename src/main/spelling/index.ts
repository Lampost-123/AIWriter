// Writing by hand: spell check (main process side). Chromium's own checker does the checking, in the window
// and in every box: this keeps it on or off (Settings › Editor), in the spelling that applies to the story
// Adam is in (en-GB or en-US), and makes the open world's names count as correct.
//
// The world's words go into the personal dictionary while the world is open and come out again when it closes
// or its names change. Which words were put there for a world is kept in a small file (spelling-world-words.json
// in the app's data folder), written before they are added, so after a crash the next start takes them out
// again. A word already in the dictionary is Adam's own and is never added or taken out for a world. On Windows
// and macOS Chromium also writes these words to the system's own dictionary, and takes them out again with them.
import { app, session } from 'electron'
import { join } from 'node:path'
import type { ID, Spelling } from '@shared/types'
import type { ContextWord, SpellingState, SynonymSense } from '@shared/contracts/spelling'
import { effectiveStyle } from '@shared/style'
import { languageFor, synonymsFor, worldWordChanges, worldWordsOf } from '@shared/spelling'
import * as repo from '../db/repo'
import { liveEntryNames } from '../db/checksLive'
import { userDataDir } from '../paths'
import { getSettings, getWritingPrefs } from '../settings'
import { readJson, writeFileAtomic } from '../util'
import { maybeCurrentWorld, onWorldClosing, onWorldOpened } from '../world'
import { thesaurus } from './thesaurus'

const trackFile = (): string => join(userDataDir(), 'spelling-world-words.json')

/** The story Adam is in, as the window last said. */
let storyId: ID | null = null
/** The world words in the personal dictionary now (added for the open world). */
let tracked = new Set<string>()
let language: string | null = null
let current: SpellingState = { enabled: true, spelling: 'UK', language: 'en-GB', worldWords: 0 }
/**
 * The personal dictionary is only read from disk once the window has loaded: a word added or taken out before then
 * is lost when it is read. So world words wait for this, and words left from a crash come out first.
 */
let dictionaryReady: Promise<void> = Promise.resolve()

/**
 * App tests run with their own data folder, but on Windows and macOS the system's dictionary is shared with
 * every other program: their worlds' names stay out of it unless a test asks (AIWRITE_SPELL_WORLD_WORDS=1).
 */
const worldWordsAllowed = (): boolean => !process.env.AIWRITE_DATA_DIR || process.env.AIWRITE_SPELL_WORLD_WORDS === '1'

const ses = (): Electron.Session => session.defaultSession

function saveTracked(words: Iterable<string>): void {
  try {
    writeFileAtomic(trackFile(), JSON.stringify([...words].sort(), null, 2))
  } catch (e) {
    console.warn('Could not note the world words added to the dictionary', e)
  }
}

/** Takes every world word out of the personal dictionary (the world closed, or spell check went off). */
function removeTracked(): void {
  for (const w of tracked) {
    try {
      ses().removeWordFromSpellCheckerDictionary(w)
    } catch {
      /* already gone */
    }
  }
  tracked = new Set()
  saveTracked(tracked)
}

/** Every word in the personal dictionary, or null when it can't be read in time. */
async function personalWords(): Promise<string[] | null> {
  try {
    return await Promise.race([ses().listWordsInSpellCheckerDictionary(), new Promise<null>((r) => setTimeout(() => r(null), 3000))])
  } catch {
    return null
  }
}

/** The spelling for the story Adam is in: his preferences, then the world's style guide, then the story's. */
function spellingNow(): Spelling {
  const prefs = getWritingPrefs()
  const w = maybeCurrentWorld()
  if (!w) return prefs.spelling === 'US' ? 'US' : 'UK'
  let storyStyle = {}
  if (storyId) {
    try {
      storyStyle = repo.getStory(w.db, storyId).style
    } catch {
      // The story went meanwhile: the world's spelling applies.
    }
  }
  const s = effectiveStyle(prefs, repo.getWorldStyle(w.db), storyStyle).spelling
  return s === 'US' ? 'US' : 'UK'
}

/** The open world's words that count as correct (none with no world open or spell check off). */
function desiredWords(enabled: boolean): string[] {
  const w = maybeCurrentWorld()
  if (!w || !enabled || !worldWordsAllowed()) return []
  try {
    return worldWordsOf(liveEntryNames(w.db))
  } catch (e) {
    console.warn('Could not read the world’s names for spell check', e)
    return []
  }
}

async function applyNow(): Promise<SpellingState> {
  const enabled = getSettings().editor?.spellCheck !== false
  const spelling = spellingNow()
  const lang = languageFor(spelling)
  try {
    ses().setSpellCheckerEnabled(enabled)
    if (lang !== language) {
      ses().setSpellCheckerLanguages([lang])
      language = lang
    }
  } catch (e) {
    console.warn('Could not set the spell checker’s language', e)
  }
  await dictionaryReady
  const desired = desiredWords(enabled)
  if (!desired.length) {
    if (tracked.size) removeTracked()
  } else {
    const personal = await personalWords()
    // Without knowing which words are Adam's own, nothing is added (it could be taken out later).
    const changes = worldWordChanges(tracked, desired, personal ?? desired)
    if (changes.add.length || changes.remove.length) {
      // Noted first, so a crash part-way still lets the next start take them out.
      saveTracked(new Set([...tracked, ...changes.add]))
      for (const w of changes.add) {
        try {
          if (ses().addWordToSpellCheckerDictionary(w)) tracked.add(w)
        } catch {
          /* a word the dictionary won't take */
        }
      }
      for (const w of changes.remove) {
        try {
          ses().removeWordFromSpellCheckerDictionary(w)
        } catch {
          /* already gone */
        }
        tracked.delete(w)
      }
      saveTracked(tracked)
    }
  }
  current = { enabled, spelling, language: lang, worldWords: desired.length }
  return current
}

let running: Promise<SpellingState> | null = null
let again = false

/** Brings spell check in line now (one at a time; a call while one runs runs once more after it). */
export function syncSpelling(story?: ID | null): Promise<SpellingState> {
  if (story !== undefined) storyId = story
  if (running) {
    again = true
    return running.then(() => (running ?? Promise.resolve(current)))
  }
  const run = async (): Promise<SpellingState> => {
    try {
      let state = await applyNow()
      while (again) {
        again = false
        state = await applyNow()
      }
      return state
    } finally {
      running = null
    }
  }
  running = run()
  return running
}

export const spellingState = (): SpellingState => current

/** Synonyms for a word in the spelling that applies now. */
export function synonymsOf(word: string): SynonymSense[] {
  const t = thesaurus()
  return t ? synonymsFor(t, String(word ?? ''), current.spelling) : []
}

/**
 * Adam's own "Add to dictionary". A word that was only there for the world becomes his: it stays when the
 * world closes.
 */
export function addToPersonalDictionary(word: string): void {
  if (tracked.delete(word)) saveTracked(tracked)
  else ses().addWordToSpellCheckerDictionary(word)
}

// ---------- The word right-clicked in the page ----------

let note: { value: ContextWord | null; at: number } = { value: null, at: 0 }
let waiting: (() => void)[] = []

/** The window says which word is under the pointer, as a right-click starts. */
export function noteContextWord(value: ContextWord | null): void {
  note = { value: value && typeof value.word === 'string' ? value : null, at: Date.now() }
  const w = waiting
  waiting = []
  w.forEach((fn) => fn())
}

/**
 * The word noted for the right-click that just happened. The window's note usually arrives first; if not, it is
 * waited for a moment. Null when the click wasn't on a word in the page.
 */
export async function contextWord(): Promise<ContextWord | null> {
  const fresh = (): boolean => Date.now() - note.at < 500
  if (!fresh()) await new Promise<void>((r) => {
    const t = setTimeout(r, 150)
    waiting.push(() => {
      clearTimeout(t)
      r()
    })
  })
  return fresh() ? note.value : null
}

// ---------- Start-up ----------

/** At start: world words left from a crash come out of the dictionary, and spell check follows the settings. */
export function initSpelling(): void {
  const windowLoaded = new Promise<void>((resolve) => {
    app.once('browser-window-created', (_e, win) => win.webContents.once('did-finish-load', () => resolve()))
    // Never wait for ever.
    setTimeout(resolve, 30_000)
  })
  dictionaryReady = windowLoaded.then(async () => {
    // Read from disk by now (listing waits until it is).
    await personalWords()
    const left = readJson<unknown>(trackFile(), [])
    if (!Array.isArray(left) || !left.length) return
    for (const w of left) {
      if (typeof w !== 'string') continue
      try {
        ses().removeWordFromSpellCheckerDictionary(w)
      } catch {
        /* already gone */
      }
    }
    saveTracked([])
  })
  onWorldClosing(() => {
    storyId = null
    removeTracked()
  })
  onWorldOpened(() => void syncSpelling(null))
  void syncSpelling()
}
