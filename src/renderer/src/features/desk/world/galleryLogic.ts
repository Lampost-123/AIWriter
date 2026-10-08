// The desk's World room (UI overhaul phase 4, D4.1): what the gallery shows, worked out without the window. The kind tabs
// and their counts, the sections and which card each kind is drawn as, the words on cards, the tab underline's clip,
// the stagger's delays and each card's art colour. Tested in galleryLogic.test.ts.
import { KIND_LABELS } from '@shared/fields'
import type { BoardPlace, BoardThread } from '@shared/contracts/worldViews'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { EntryKind } from '@shared/types'
import { GALLERY_KINDS, featuredCard, groupCards, type CodexSort } from '@/features/codex/codexLogic'

/** How a kind's card is drawn: a portrait (characters), a landscape (places), parchment (groups), a scroll (lore), an index card (plot threads), plain paper (the rest). */
export type CardShape = 'portrait' | 'landscape' | 'parchment' | 'scroll' | 'index' | 'plain'

export const SHAPE_OF: Record<EntryKind, CardShape> = {
  character: 'portrait',
  place: 'landscape',
  group: 'parchment',
  lore: 'scroll',
  thread: 'index',
  item: 'plain',
  event: 'plain',
  glossary: 'plain'
}

export interface GalleryTab {
  /** null: All. */
  kind: EntryKind | null
  label: string
  /** How many entries of the kind the world has (every one, whatever is searched for). */
  count: number
}

/** The tabs: All, then each kind the world has, in the gallery's order, each with how many it holds. */
export function galleryTabs(cards: CodexCard[]): GalleryTab[] {
  const counts = new Map<EntryKind, number>()
  for (const c of cards) if (GALLERY_KINDS.includes(c.kind)) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1)
  const all = [...counts.values()].reduce((a, b) => a + b, 0)
  return [
    { kind: null, label: 'All', count: all },
    ...GALLERY_KINDS.filter((k) => counts.has(k)).map((kind) => ({ kind, label: KIND_LABELS[kind].many, count: counts.get(kind)! }))
  ]
}

/** One kind's section: its heading, the quiet words after the rule, and its cards with how each is drawn. */
export interface GallerySection {
  kind: EntryKind
  label: string
  /** "in order of importance", "questions the story has asked". */
  hint: string
  shape: CardShape
  cards: CodexCard[]
  /** The character drawn larger (the story's lead), or null. */
  featured: string | null
}

const SORT_HINT: Record<CodexSort, string> = {
  name: 'by name',
  importance: 'most important first',
  last: 'latest in the story first'
}

/** The sections for the cards shown (already filtered and sorted), in the gallery's order of kinds. */
export function gallerySections(shown: CodexCard[], sort: CodexSort): GallerySection[] {
  return groupCards(shown, GALLERY_KINDS).map((g) => ({
    kind: g.kind,
    label: g.cards.length === 1 && g.kind !== 'lore' && g.kind !== 'glossary' ? KIND_LABELS[g.kind].one : g.label,
    hint: g.kind === 'thread' ? 'questions the story has asked' : SORT_HINT[sort],
    shape: SHAPE_OF[g.kind],
    cards: g.cards,
    featured: g.kind === 'character' ? featuredCard(g.cards) : null
  }))
}

/** The line under the world's name: "4 characters · 3 places · 1 group · 1 lore · 2 plot threads". */
export function worldLine(tabs: GalleryTab[]): string {
  return tabs
    .filter((t) => t.kind)
    .map((t) => {
      const k = t.kind!
      const word =
        k === 'lore'
          ? 'lore'
          : k === 'glossary'
            ? t.count === 1
              ? 'term'
              : 'terms'
            : (t.count === 1 ? KIND_LABELS[k].one : KIND_LABELS[k].many).toLowerCase()
      return `${t.count.toLocaleString('en-GB')} ${word}`
    })
    .join(' · ')
}

/** The stagger: each card (and its section's heading) comes in 30ms after the one before, the eleventh and later together. */
export const STAGGER_MS = 30
export const staggerDelay = (i: number): number => Math.min(Math.max(0, i), 10) * STAGGER_MS

/**
 * The tab underline: one bar as wide as the row of tabs, clipped to the chosen tab (inset by `pad` either side), so moving
 * it is a clip-path transition (no layout).
 */
export function tabClip(rowWidth: number, tab: { left: number; width: number }, pad = 10): string {
  const left = Math.max(0, Math.round(tab.left + pad))
  const right = Math.max(0, Math.round(rowWidth - tab.left - tab.width + pad))
  return `inset(0 ${right}px 0 ${left}px round 1px)`
}

/** Each kind's art hue (its ink's), and how far an entry's own hue may stray from it either way. */
const KIND_HUE: Record<EntryKind, number> = {
  character: 266,
  place: 172,
  group: 218,
  item: 34,
  lore: 238,
  event: 340,
  thread: 96,
  glossary: 208
}
const HUE_SPREAD = 16

/** A small steady hash of a string (the same entry always gets the same picture). */
export function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** An entry's art hue: its kind's, turned a little its own way. */
export function artHue(kind: EntryKind, id: string): number {
  const shift = (hashOf(id) % (2 * HUE_SPREAD + 1)) - HUE_SPREAD
  return (KIND_HUE[kind] + shift + 360) % 360
}

/** Which of `n` drawings an entry gets (steady per entry). */
export const variantOf = (id: string, n: number): number => hashOf(`${id}:v`) % n

/** The foot of a card: "in 5 scenes", "in 1 scene", or "not in a scene yet". */
export function appearsShort(c: Pick<CodexCard, 'scenes'>): string {
  if (!c.scenes) return 'not in a scene yet'
  return `in ${c.scenes.toLocaleString('en-GB')} ${c.scenes === 1 ? 'scene' : 'scenes'}`
}

/** "Book 1, Ch 2, Sc 1" → "Ch 2, Sc 1": the book is the story Adam is in. */
export const shortPlace = (label: string): string => label.replace(/^.*?(?=Ch \d)/, '') || label

/** A character's role, as its pill says it: "Protagonist". '' when none. */
export const roleLabel = (c: Pick<CodexCard, 'kind' | 'role'>): string =>
  c.kind === 'character' && c.role.trim() ? c.role.trim()[0].toLocaleUpperCase() + c.role.trim().slice(1) : ''

/** A plot thread's state over its title: "Open", "Resolved", or "Planned". */
export function threadState(t: Pick<BoardThread, 'column'> | null): { label: string; tone: 'open' | 'done' | 'planned' } {
  if (!t) return { label: 'Not set up yet', tone: 'planned' }
  if (t.column === 'resolved') return { label: 'Resolved', tone: 'done' }
  if (t.column === 'open') return { label: 'Open', tone: 'open' }
  return { label: 'Planned', tone: 'planned' }
}

const placeWords = (p: BoardPlace | null): string => (p ? (p.label ? shortPlace(p.label) : 'before the story') : '')

/** The foot of a plot thread's card: where it was set up and paid off, or that it has no payoff written yet. */
export function threadLine(t: Pick<BoardThread, 'column' | 'setUp' | 'paidOff' | 'openChapters'> | null): string {
  if (!t || (!t.setUp && !t.paidOff)) return 'Not on a scene card or in a scene yet'
  if (t.column === 'resolved') {
    const up = placeWords(t.setUp)
    const off = placeWords(t.paidOff)
    return up ? `Opened ${up} · resolved ${off || 'in the story'}` : `Resolved ${off}`
  }
  if (t.column === 'planned') return `Planned for ${placeWords(t.setUp) || 'later'}`
  const open = t.openChapters && t.openChapters > 1 ? ` · open for ${t.openChapters} chapters` : ''
  return `Set up in ${placeWords(t.setUp)}${open || ' · no payoff written yet'}`
}
