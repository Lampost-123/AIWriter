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
  first: 'in order of first appearance',
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

// ---------- A kind's own page (World › By kind) ----------

/** Each card's size at life size (CSS pixels), for working out how far a kind's few cards can grow. */
export const CARD_SIZE: Record<CardShape, { w: number; h: number }> = {
  portrait: { w: 190, h: 262 },
  landscape: { w: 300, h: 172 },
  parchment: { w: 332, h: 172 },
  plain: { w: 332, h: 172 },
  scroll: { w: 560, h: 170 },
  index: { w: 400, h: 180 }
}

/** The most a kind's cards grow, by how they're drawn (the full-width scrolls and index cards hardly at all). */
const MAX_ZOOM: Record<CardShape, number> = { portrait: 1.6, landscape: 1.5, parchment: 1.45, plain: 1.45, scroll: 1.15, index: 1.15 }

/**
 * How a kind's cards are laid out on its own page: up to ten grow to fill the room, in as many columns as let them grow
 * most while every row fits its width and height and no last row is less than half full (four places on a wide page
 * make two rows of two rather than three and one); more come back down towards life size, never under it. `cols` is
 * the columns to wrap at (null: as many as fit). `n` counts the "New" card too; `extra` is the width a card drawn
 * wider takes (the story's lead). The room is the gallery's width and the height left under the kind's banner.
 */
export function heroLayout(
  shape: CardShape,
  n: number,
  room: { width: number; height: number },
  gap = 28,
  extra = 0
): { zoom: number; cols: number | null } {
  const floor2 = (z: number): number => Math.floor(Math.max(1, z) * 100 + 1e-9) / 100
  if (n <= 0 || room.width <= 0) return { zoom: 1, cols: null }
  const { w, h } = CARD_SIZE[shape]
  const max = MAX_ZOOM[shape]
  if (n > 10 || shape === 'scroll' || shape === 'index') {
    // Many (or the full-width kinds): as many as fit across at life size, grown just enough to fill the row.
    const cols = Math.max(1, Math.floor((room.width + gap) / (w + gap)))
    return { zoom: floor2(Math.min(n > 10 ? 1.25 : max, max, room.width / (cols * w + (cols - 1) * gap))), cols: null }
  }
  let best = { zoom: 1, cols: n }
  for (let cols = n; cols >= 1; cols--) {
    const rows = Math.ceil(n / cols)
    const last = n - (rows - 1) * cols
    if (rows > 3 || (rows > 1 && last * 2 < cols)) continue
    const across = (room.width * 0.97) / (cols * w + (cols - 1) * gap + extra)
    const down = room.height > 0 ? room.height / (rows * h + (rows - 1) * gap) : max
    const z = Math.min(max, across, down)
    if (z > best.zoom + 0.005) best = { zoom: z, cols }
  }
  return { zoom: floor2(best.zoom), cols: best.cols < n ? best.cols : null }
}

/** How large a kind's cards are drawn on its own page (heroLayout's zoom). */
export const heroZoom = (shape: CardShape, n: number, room: { width: number; height: number }, gap = 28, extra = 0): number =>
  heroLayout(shape, n, room, gap, extra).zoom

/** The world's name as a banner says it: "Sample world: Gullhaven" is Gullhaven. */
export const placeName = (world: string): string => world.trim().split(': ').pop()?.trim() || 'your world'

const KIND_TITLE: Record<EntryKind, (w: string) => string> = {
  character: (w) => `The people of ${w}`,
  place: (w) => `The places of ${w}`,
  group: (w) => `The groups of ${w}`,
  item: (w) => `The things that matter in ${w}`,
  lore: (w) => `How ${w} works`,
  event: (w) => `What has happened in ${w}`,
  thread: () => 'The questions the story has asked',
  glossary: (w) => `The words of ${w}`
}

const ROLE_ORDER = ['protagonist', 'antagonist', 'supporting', 'minor']

/** A kind's banner on its own page: a title from the world's name, facts from its entries, and the few drawn on it. */
export interface KindBanner {
  title: string
  /** "4 characters", "1 protagonist", "2 supporting"…, each from the entries themselves. */
  facts: string[]
  /** Who is in the most scenes, in words; '' when none is in a scene yet (and for plot threads). */
  most: string
  /** The entries drawn in the banner's fan: the most important first (up to three). */
  lead: CodexCard[]
  /** Every scene each entry is in, added up. */
  appearances: number
}

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

export function kindBanner(
  kind: EntryKind,
  cards: CodexCard[],
  world: string,
  extra: { threads?: Map<string, Pick<BoardThread, 'column'>>; parentOf?: (id: string) => string | null } = {}
): KindBanner {
  const mine = cards.filter((c) => c.kind === kind)
  const words = KIND_LABELS[kind]
  const facts: string[] = [
    kind === 'lore' ? `${mine.length.toLocaleString('en-GB')} lore` : count(mine.length, words.one.toLowerCase(), words.many.toLowerCase())
  ]
  if (kind === 'character') {
    const roles = new Map<string, number>()
    for (const c of mine) {
      const r = c.role.trim().toLocaleLowerCase()
      if (r) roles.set(r, (roles.get(r) ?? 0) + 1)
    }
    const order = [...roles.keys()].sort((a, b) => {
      const ia = ROLE_ORDER.indexOf(a)
      const ib = ROLE_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
    })
    for (const r of order) facts.push(`${roles.get(r)!.toLocaleString('en-GB')} ${r}`)
  }
  if (kind === 'place' && extra.parentOf) {
    const parents = mine.map((c) => extra.parentOf!(c.id)).filter((p): p is string => !!p)
    if (parents.length)
      facts.push(new Set(parents).size === 1 ? `${parents.length} inside ${parents[0]}` : `${parents.length} inside other places`)
  }
  if (kind === 'lore') {
    const hard = mine.filter((c) => c.hardRule).length
    if (hard) facts.push(count(hard, 'hard rule'))
  }
  if (kind === 'thread' && extra.threads) {
    const by = { open: 0, resolved: 0, planned: 0 }
    for (const c of mine) {
      const t = extra.threads.get(c.id)
      if (t?.column === 'open') by.open++
      else if (t?.column === 'resolved') by.resolved++
      else by.planned++
    }
    if (by.open) facts.push(`${by.open} open`)
    if (by.resolved) facts.push(`${by.resolved} resolved`)
    if (by.planned) facts.push(`${by.planned} not set up yet`)
  }
  const idle = mine.filter((c) => !c.scenes).length
  if (idle && idle < mine.length) facts.push(`${idle} not in a scene yet`)
  const ranked = [...mine].sort((a, b) => b.importance - a.importance || b.scenes - a.scenes || a.name.localeCompare(b.name))
  const top = [...mine].sort((a, b) => b.scenes - a.scenes || b.importance - a.importance)[0]
  return {
    title: KIND_TITLE[kind](placeName(world)),
    facts,
    most:
      !top || !top.scenes || kind === 'thread'
        ? ''
        : kind === 'character'
          ? `${top.name.trim() || 'Unnamed'} is in the most scenes (${top.scenes.toLocaleString('en-GB')})`
          : `Most often in a scene: ${top.name.trim() || 'Unnamed'} (${top.scenes.toLocaleString('en-GB')})`,
    lead: ranked.slice(0, 3),
    appearances: mine.reduce((a, c) => a + c.scenes, 0)
  }
}
