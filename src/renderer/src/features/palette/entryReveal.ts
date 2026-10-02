// Opening a search result found further down an entry's page than its name and summary (a field
// like Fears, its private notes, or what the memory has about it) shows that part of the page: once
// the page is open, the part is scrolled into view (its section opened if it is closed) and the
// words found are selected in the box they are in, as a scene opens at its words. The page belongs
// to the entry views (features/world/EntryForm.tsx and memory/); its parts are found by their labels
// and section titles there.

import type { EntryPart } from '@shared/contracts/search'
import { FIELD_GROUPS } from '@shared/fields'
import type { EntryKind, ID } from '@shared/types'
import { useApp } from '@/lib/store'

/** How long the page may take to show before this gives up (usually a few frames). */
const WAIT_MS = 3000

/** The fields at the top of every entry's page that a result opens at (not in a section), by their labels there. */
const TOP_FIELDS: Record<string, string> = { description: 'Description', tags: 'Tags' }

/** The private notes' label starts with this. */
const NOTES = 'Private notes'

type Section = Exclude<EntryPart['kind'], 'field' | 'notes'>

/** The sections listing what the memory has about an entry, by their titles on its page (memory/EntryMemory.tsx). */
function sectionTitle(kind: EntryKind, section: Section): string {
  if (section === 'knows') return 'Knows at the start'
  if (section === 'changes') return 'Changes over time'
  return kind === 'character' || kind === 'group' ? 'Relationships' : 'Connections'
}

const textOf = (el: Element | null | undefined): string => el?.textContent?.trim() ?? ''

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' }

/** Lower case with plain quotes and dashes, a character for a character, so places in it are places in the text. */
const loose = (s: string): string =>
  Array.from(s, (ch) => {
    const c = QUOTES[ch] ?? ch.toLowerCase()
    return c.length === ch.length ? c : ch
  }).join('')

/** The open entry's page (`data-entry-page`), while its name can be edited (not the writing page kept underneath). */
function pageOf(): HTMLElement | null {
  const name = [...document.querySelectorAll<HTMLElement>('textarea[aria-label="Name"]')].find((el) => !el.closest('[inert]'))
  return name?.closest<HTMLElement>('[data-entry-page]') ?? null
}

/** A section of the page by its title: the button that opens and closes it, and what is in it while it is open. */
function sectionOf(page: HTMLElement, title: string): { button: HTMLButtonElement; body: HTMLElement | null } | null {
  for (const button of page.querySelectorAll<HTMLButtonElement>('button[aria-expanded][aria-controls]')) {
    if (textOf(button.querySelector('span')) !== title) continue
    const id = button.getAttribute('aria-expanded') === 'true' ? button.getAttribute('aria-controls') : null
    return { button, body: id ? document.getElementById(id) : null }
  }
  return null
}

/** A field by its label: the field (its label, box and note) and the box Adam types in. */
function fieldOf(root: HTMLElement, isLabel: (text: string) => boolean): { field: HTMLElement; box: HTMLElement | null } | null {
  for (const label of root.querySelectorAll('label')) {
    if (!isLabel(textOf(label))) continue
    return { field: label.parentElement ?? label, box: label.htmlFor ? document.getElementById(label.htmlFor) : null }
  }
  return null
}

const isTextBox = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text')

/** What lays out a box's text, copied to measure it. */
const TEXT_STYLE = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-feature-settings',
  'font-variation-settings',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'text-transform',
  'text-indent',
  'tab-size',
  'white-space',
  'word-break',
  'overflow-wrap'
]

/**
 * How far down a box's text the character at `at` is (the middle of its line), measured on a hidden
 * copy of the text laid out as the box lays it out.
 */
function lineMiddle(box: HTMLTextAreaElement, at: number, style: CSSStyleDeclaration): number {
  const pad = (side: string): number => parseFloat(style.getPropertyValue(`padding-${side}`)) || 0
  const copy = document.createElement('div')
  for (const p of TEXT_STYLE) copy.style.setProperty(p, style.getPropertyValue(p))
  Object.assign(copy.style, {
    position: 'absolute',
    left: '-10000px',
    top: '0',
    visibility: 'hidden',
    width: `${box.clientWidth - pad('left') - pad('right')}px`
  })
  copy.textContent = box.value.slice(0, at)
  const mark = copy.appendChild(document.createElement('span'))
  mark.textContent = '\u200b'
  document.body.appendChild(copy)
  const y = mark.offsetTop + mark.offsetHeight / 2
  copy.remove()
  return y
}

/**
 * Selects the words where they first appear in a box Adam types in, and says how far down the box
 * they are on screen. Null when they aren't there (any more).
 */
function selectIn(box: HTMLElement | null, words: string | null): number | null {
  if (!words || !isTextBox(box)) return null
  const at = loose(box.value).indexOf(loose(words))
  if (at < 0) return null
  box.focus({ preventScroll: true })
  box.setSelectionRange(at, at + words.length)
  if (!(box instanceof HTMLTextAreaElement)) return box.offsetHeight / 2
  const style = getComputedStyle(box)
  const y = (parseFloat(style.paddingTop) || 0) + lineMiddle(box, at, style)
  // A long note scrolls inside its box, and the browser doesn't bring a selection made from code
  // into view there: the words go to the middle of the box.
  if (box.scrollHeight > box.clientHeight) box.scrollTop = y - box.clientHeight / 2
  return box.clientTop + y - box.scrollTop
}

/** The page around `el` that scrolls, if it does. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/** Scrolls the page so the point `y` down `el` is in the middle of it (the words, in a box taller than the window). */
function centerOn(el: HTMLElement, y: number): void {
  const page = scrollerOf(el)
  if (!page) return
  const middle = page.getBoundingClientRect().top + page.clientHeight / 2
  page.scrollTop += el.getBoundingClientRect().top + y - middle
}

/** What to show: the part, and the box to select the words in. */
interface Target {
  el: HTMLElement
  box: HTMLElement | null
}

/**
 * Scrolls a part of an entry's page into view once the page is on screen, opening its section if it
 * is closed, and selects `words` there. Gives up quietly if Adam goes to another page first, or the
 * part can't be found (the page then stays at its top, as it opens).
 */
export function revealEntryPart(entryId: ID, kind: EntryKind, part: EntryPart, words: string | null): void {
  const until = performance.now() + WAIT_MS
  let frames = 0
  let opened = false
  // A section found while what is in it is still loading: shown if that takes too long.
  let fallback: HTMLElement | null = null

  /** The part, once it is on the page; null while it isn't yet. */
  const find = (page: HTMLElement): Target | null => {
    if (part.kind === 'notes') {
      const f = fieldOf(page, (t) => t.startsWith(NOTES))
      return f && { el: f.field, box: f.box }
    }
    const top = part.kind === 'field' ? TOP_FIELDS[part.key] : undefined
    if (top) {
      const f = fieldOf(page, (t) => t === top)
      return f && { el: f.field, box: f.box }
    }
    const group = part.kind === 'field' ? FIELD_GROUPS[kind]?.find((g) => g.fields.some((f) => f.key === part.key)) : undefined
    const title = part.kind === 'field' ? group?.label : sectionTitle(kind, part.kind)
    const section = title ? sectionOf(page, title) : null
    if (!section) return null
    if (!section.body) {
      // Opened as Adam would open it (it stays open, as one he opens does); only once, so it is never closed again.
      if (!opened) section.button.click()
      opened = true
      return null
    }
    if (part.kind === 'field') {
      const label = group?.fields.find((f) => f.key === part.key)?.label
      const f = label ? fieldOf(section.body, (t) => t === label) : null
      return f && { el: f.field, box: f.box }
    }
    // What the memory has: once loaded, the box or the change holding the words, else the section itself.
    fallback = section.button
    if (!section.body.querySelector('li, p, input, textarea')) return null
    if (words) {
      const w = loose(words)
      const box = [...section.body.querySelectorAll('input, textarea')].find((b) => isTextBox(b) && loose(b.value).includes(w))
      if (box instanceof HTMLElement) return { el: box, box }
      const row = [...section.body.querySelectorAll<HTMLElement>('li')].find((li) => loose(li.textContent ?? '').includes(w))
      if (row) return { el: row, box: null }
    }
    return { el: section.button, box: null }
  }

  const look = (): void => {
    const a = useApp.getState()
    if (a.view.kind !== 'entries' || a.view.entryId !== entryId) return
    if (performance.now() > until) {
      fallback?.scrollIntoView({ block: 'start' })
      return
    }
    // Not in the first frames, while the page on show may still be the last entry's.
    const page = ++frames > 2 ? pageOf() : null
    const target = page ? find(page) : null
    if (!target) {
      requestAnimationFrame(look)
      return
    }
    // The words selected in their box and brought to the middle of the page; else the part.
    const y = selectIn(target.box, words)
    if (y !== null && target.box) centerOn(target.box, y)
    else target.el.scrollIntoView({ block: target.el === fallback ? 'start' : 'center' })
  }
  requestAnimationFrame(look)
}
