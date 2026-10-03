// Writing by hand: spell check (main process side). Chromium's own checker does the checking, in the window
// and in every box: this keeps it on or off (Settings › Editor) and in the spelling that applies to the story
// Adam is in (en-GB or en-US).
//
// Nothing here ever adds words to (or takes words out of) Chromium's spelling dictionary: on Windows and macOS
// that also writes them into the system's own dictionary, which every other program shares. Instead the
// words that count as correct are AI Write's own: the open world's names, aliases and glossary terms, and Adam's
// "Add to dictionary" words (spelling-words.json in the app's data folder, on this computer only). The page marks
// them so Chromium's underline doesn't show on them (features/spelling/knownWords.ts), and the right-click menu
// offers no spelling suggestions for them.
import { session } from 'electron'
import { join } from 'node:path'
import type { ID, Spelling } from '@shared/types'
import type { ContextNote, ContextWord, SpellingState, SynonymSense } from '@shared/contracts/spelling'
import { effectiveStyle } from '@shared/style'
import { isKnownWord, languageFor, NOTE_KEPT_MS, noteAt, synonymsFor, worldWordsOf } from '@shared/spelling'
import * as repo from '../db/repo'
import { liveEntryNames } from '../db/checksLive'
import { emit } from '../events'
import { userDataDir } from '../paths'
import { getSettings, getWritingPrefs } from '../settings'
import { readJson, writeFileAtomic } from '../util'
import { maybeCurrentWorld, onWorldClosing, onWorldOpened } from '../world'
import { thesaurus } from './thesaurus'

/** Adam's own words (Add to dictionary), kept for every world on this computer. */
const wordsFile = (): string => join(userDataDir(), 'spelling-words.json')

/** The story Adam is in, as the window last said. */
let storyId: ID | null = null
let language: string | null = null
let current: SpellingState = { enabled: true, spelling: 'UK', language: 'en-GB', worldWords: 0, knownWords: [] }
/** The words that count as correct now (lower case): the open world's and Adam's own. */
let known = new Set<string>()

const ses = (): Electron.Session => session.defaultSession

/** Adam's own words (Add to dictionary). */
export function ownWords(): string[] {
  const list = readJson<unknown>(wordsFile(), [])
  return Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string' && !!w.trim()) : []
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

/** The open world's names, aliases and glossary words (none with no world open). */
function worldWords(): string[] {
  const w = maybeCurrentWorld()
  if (!w) return []
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
    // Only when it changes: setting it again makes Chromium load its dictionary again, and words typed meanwhile
    // go unchecked.
    const now = ses().getSpellCheckerLanguages()
    if (lang !== language && !(now.length === 1 && now[0] === lang)) ses().setSpellCheckerLanguages([lang])
    language = lang
  } catch (e) {
    console.warn('Could not set the spell checker’s language', e)
  }
  const world = worldWords()
  const words = [...new Set([...world, ...ownWords()])].sort()
  known = new Set(words.map((w) => w.toLocaleLowerCase()))
  current = { enabled, spelling, language: lang, worldWords: world.length, knownWords: words }
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

/** True when a word counts as correct here: one of the world's or one of Adam's own. */
export const knownWord = (word: string): boolean => isKnownWord(known, word)

/** Synonyms for a word in the spelling that applies now. */
export function synonymsOf(word: string): SynonymSense[] {
  const t = thesaurus()
  return t ? synonymsFor(t, String(word ?? ''), current.spelling) : []
}

/** Adam's own "Add to dictionary": into his own list (this computer only), and the page stops underlining it. */
export async function addToPersonalDictionary(word: string): Promise<void> {
  const clean = String(word ?? '').trim()
  if (!clean) return
  const list = ownWords()
  if (!list.some((w) => w.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    writeFileAtomic(wordsFile(), JSON.stringify([...list, clean].sort((a, b) => a.localeCompare(b)), null, 2))
  }
  const state = await syncSpelling()
  emit('spelling:wordsChanged', { knownWords: state.knownWords })
}

// ---------- The word right-clicked in the page ----------

/** What the window said about each right-click lately: where it was, and the word there. */
let notes: (ContextNote & { at: number })[] = []
let waiting: (() => void)[] = []

/** The window says which word (if any) is under the pointer, and where, as a right-click starts. */
export function noteContextWord(n: ContextNote): void {
  if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return
  const word = n.word && typeof n.word.word === 'string' ? n.word : null
  const now = Date.now()
  notes = [...notes.filter((x) => now - x.at < NOTE_KEPT_MS), { x: n.x, y: n.y, word, at: now }].slice(-8)
  const w = waiting
  waiting = []
  w.forEach((fn) => fn())
}

/**
 * The word noted for this right-click (at x, y in the window, as Electron gives them), never one noted for another:
 * the window's note usually arrives first; if not, it is waited for a moment. Null when the click wasn't on a word
 * in the page, or no note for it came.
 */
export async function contextWord(x: number, y: number, zoom: number): Promise<ContextWord | null> {
  const deadline = Date.now() + 300
  let i = noteAt(notes, x, y, zoom, Date.now())
  while (i < 0 && Date.now() < deadline) {
    await new Promise<void>((r) => {
      const t = setTimeout(r, Math.max(0, deadline - Date.now()))
      waiting.push(() => {
        clearTimeout(t)
        r()
      })
    })
    i = noteAt(notes, x, y, zoom, Date.now())
  }
  if (i < 0) return null
  const found = notes[i]
  // Used once: it (and any older one) can never answer another right-click.
  notes = notes.slice(i + 1)
  return found.word
}

// ---------- Start-up ----------

/** At start: spell check follows the settings, and the world's words follow the world that is open. */
export function initSpelling(): void {
  // Offline, the spelling dictionary Chromium needs may not download: nothing is underlined until it can be
  // (it tries again later). Nothing to tell Adam; typing is unaffected.
  ses().on('spellcheck-dictionary-download-failure', (_e, lang) => console.warn(`The ${lang} spelling dictionary couldn't be downloaded.`))
  onWorldClosing(() => {
    storyId = null
    known = new Set()
  })
  onWorldOpened(() => void syncSpelling(null))
  void syncSpelling()
}
