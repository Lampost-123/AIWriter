// The right-click menu for text (writing by hand): spelling suggestions, Add to dictionary, Add to this world's
// glossary, Synonyms for the word right-clicked in the page, then Cut, Copy, Paste and Select all.
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from 'electron'
import type { SynonymSense } from '@shared/contracts/spelling'
import { matchCase } from '@shared/spelling'
import { emit } from '../events'
import { maybeCurrentWorld } from '../world'
import { addToPersonalDictionary, contextWord, spellingState, synonymsOf } from './index'

/** The Synonyms submenu: each sense under its part of speech (a label that can't be picked), between lines. */
export function synonymItems(word: string, senses: SynonymSense[], pick: (replacement: string) => void): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  for (const s of senses) {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: s.pos.charAt(0).toUpperCase() + s.pos.slice(1), enabled: false })
    for (const w of s.words) {
      const shown = matchCase(word, w)
      items.push({ label: shown, click: () => pick(shown) })
    }
  }
  return items
}

/** The menu for a right-click, built once the window has said which word is under the pointer. */
export async function contextMenuFor(win: BrowserWindow, p: ContextMenuParams): Promise<MenuItemConstructorOptions[]> {
  const wc = win.webContents
  const items: MenuItemConstructorOptions[] = []
  const spelling = spellingState()
  const noted = p.isEditable ? await contextWord() : null

  if (p.misspelledWord && spelling.enabled) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) })
    if (p.dictionarySuggestions.length === 0) items.push({ label: 'No suggestions', enabled: false })
    items.push({ label: 'Add to dictionary', click: () => addToPersonalDictionary(p.misspelledWord) })
    if (maybeCurrentWorld()) {
      const word = p.misspelledWord
      items.push({ label: 'Add to this world’s glossary', click: () => emit('spelling:addToGlossary', { word }) })
    }
    items.push({ type: 'separator' })
  }

  if (noted) {
    const senses = synonymsOf(noted.word)
    if (senses.length) {
      const token = noted.token
      items.push({
        label: 'Synonyms',
        submenu: synonymItems(noted.word, senses, (replacement) => emit('spelling:replaceWord', { token, replacement }))
      })
      items.push({ type: 'separator' })
    }
  }

  if (p.isEditable) {
    items.push(
      { role: 'cut', label: 'Cut', enabled: p.editFlags.canCut },
      { role: 'copy', label: 'Copy', enabled: p.editFlags.canCopy },
      { role: 'paste', label: 'Paste', enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Select all', enabled: p.editFlags.canSelectAll }
    )
  } else if (p.selectionText.trim()) {
    items.push({ role: 'copy', label: 'Copy' })
  }
  return items
}
