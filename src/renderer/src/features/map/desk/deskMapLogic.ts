// Pure helpers for the desk's relationship map (UI overhaul): what kind of tie a relationship is, how warm each side's
// feelings read, both sides' feelings paired up, how big each character's medallion is, the curved lines, fitting the
// map to the window, which names and words have room, moving between characters with the arrow keys, a group's soft
// region, since when two characters are tied and what changed at a stop. Tested in deskMapLogic.test.ts.
import type { ID } from '@shared/types'
import type { MapChangeNote, MapLink, MapNode, MapStopInfo, MapTieEvent } from '@shared/contracts/worldViews'
import type { AsOfStop } from '@shared/types'
import type { View } from '../mapLogic'

// ---------- Kinds of tie ----------

export type TieKind = 'family' | 'love' | 'friend' | 'rival' | 'duty' | 'mentor' | 'other'

/** The kinds in the legend's order, with their names. */
export const TIE_KINDS: { kind: TieKind; label: string }[] = [
  { kind: 'family', label: 'Family' },
  { kind: 'love', label: 'Love' },
  { kind: 'friend', label: 'Friends' },
  { kind: 'mentor', label: 'Mentor' },
  { kind: 'duty', label: 'Duty & work' },
  { kind: 'rival', label: 'Rivals & enemies' },
  { kind: 'other', label: 'Other' }
]

/** Words that say what kind a tie is, checked in this order (a "sworn enemy" is an enemy before it is sworn to anyone). */
const KIND_WORDS: [TieKind, RegExp][] = [
  [
    'rival',
    /\b(rivals?|rivalry|enem(y|ies)|nemes[ie]s|foes?|feud\w*|hates?|hated|hunts?|hunted|hunting|betray\w*|traitor|opponents?|adversar(y|ies)|grudge|vendetta|at war|killed|murder\w*|blackmail\w*|threatens?|captor|prisoner|wants? (him|her|them) dead)\b/i
  ],
  [
    'love',
    /\b(lovers?|loves?|beloved|in love|married|marries|wife|husband|spouses?|widow(er)?|betrothed|engaged|fianc[eé]e?|sweethearts?|courting|courts|romance|romantic|crush|flame|darling|paramour|mistress|kiss(ed|es)?|ex-(wife|husband|lover))\b/i
  ],
  [
    'family',
    /\b(mother|father|mum|mom|dad|parents?|sons?|daughters?|sisters?|brothers?|siblings?|twins?|aunt|uncle|niece|nephew|cousins?|grand\w*|god(father|mother|son|daughter|child|parent)s?|step\w*|half-(sister|brother)|in-laws?|kin|kinsman|kinswoman|family|relative|heir|ward|adopted|foster\w*|children|child)\b/i
  ],
  ['mentor', /\b(mentors?|mentee|teacher|teaches|taught|students?|pupils?|apprentices?|tutors?|prot[eé]g[eé]e?|trains?|trained|trainer|master and apprentice|guardian|disciple)\b/i],
  ['friend', /\b(friends?|friendship|companions?|confidant\w*|comrades?|pals?|chums?|best friends?|neighbou?rs?|acquaint\w*|playmates?|childhood)\b/i],
  [
    'duty',
    /\b(allies|ally|allied|works? (for|with)|employ\w*|boss|masters?|servants?|serves?|clerk|colleagues?|partners?|loyal\w*|sworn|vassal|liege|lord|lady|captain|crew|soldiers?|commands?|commander|members?|leader|lieutenant|owes?|debt\w*|client|patron|business|agents?|spy|spies|informant|hires?|hired|guards?|bodyguard|steward|deputy|harbourmaster|keeper|duty|oath|in league|accomplice)\b/i
  ]
]

/** The kind of a tie, from the words of its relationships (the first that says), else from how they feel. */
export function tieKind(types: string[]): TieKind {
  const text = types.join(' ; ')
  for (const [kind, words] of KIND_WORDS) if (words.test(text)) return kind
  return 'other'
}

// ---------- Warmth ----------

const WARM =
  /^(love[sd]?|loving|fond(ly|ness)?|adores?|adored|admires?|admired|admiring|admiration|trusts?|trusted|trusting|protective|protects?|proud|grateful|gratitude|devoted|loyal|respects?|respected|cares?|caring|warm|warmly|affection(ate)?|tender|close|relies|rely|dotes?|hopeful|kind|likes?|liked|friendly|sympath\w*|cherish\w*|delight\w*|happy|glad|safe|comfort\w*|believes|forgives?|forgiven|thankful)$/
const COLD =
  /^(hates?|hated|hatred|distrust\w*|mistrust\w*|wary|suspicious|suspects?|afraid|fears?|feared|fearful|frightened|scared|resent\w*|jealous\w*|envy|envious|bitter\w*|angry|anger|furious|rage|contempt\w*|despise[sd]?|scorn\w*|betrayed|guilty|ashamed|shame|impatient|uneasy|cold|hostile|annoyed|irritat\w*|loathe[sd]?|loathing|disgust\w*|threaten\w*|tense|grudging\w*|spite\w*|dislikes?|disliked|dread\w*|wounded|hurt|cruel|vengeful|disappoint\w*|uncertain|torn)$/
const NOT = /^(not|never|no|nor|doesn['’]?t|don['’]?t|didn['’]?t|isn['’]?t|wasn['’]?t|won['’]?t|can['’]?t|cannot|hardly|barely|longer|without)$/

/**
 * How warm one side's feelings read, from -1 (cold: wary, resentful) to 1 (warm: fond, trusting); 0 for mixed
 * ("proud of her, and ashamed"), null when there are none or none of the words say. "Doesn't trust her" reads cold.
 */
export function warmth(feels: string): number | null {
  const words = feels.toLowerCase().split(/[^a-z'’-]+/).filter(Boolean)
  let warm = 0
  let cold = 0
  words.forEach((w, i) => {
    const kind = WARM.test(w) ? 1 : COLD.test(w) ? -1 : 0
    if (!kind) return
    const negated = words.slice(Math.max(0, i - 3), i).some((p) => NOT.test(p))
    const v = negated ? -kind : kind
    if (v > 0) warm++
    else cold++
  })
  if (!warm && !cold) return null
  return (warm - cold) / (warm + cold)
}

export type Mood = 'warm' | 'mixed' | 'cold'

export const moodOf = (feels: string): Mood | null => {
  const w = warmth(feels)
  return w === null ? null : w > 0.25 ? 'warm' : w < -0.25 ? 'cold' : 'mixed'
}

export const MOOD_WORD: Record<Mood, string> = { warm: 'warm', mixed: 'mixed', cold: 'tense' }

/** One side of a tie: how `from` feels about `to`. */
export interface Side {
  from: ID
  to: ID
  feels: string
  mood: Mood | null
}

/** Joins different feelings from several relationships of one pair, each once. */
const joinFeels = (list: string[]): string => [...new Set(list.map((f) => f.trim()).filter(Boolean))].join('; ')

/** Both sides of a tie, `first` first: how each feels about the other, from all their relationships. */
export function sidesOf(links: MapLink[], first: ID, second: ID): [Side, Side] {
  const of = (from: ID): string => joinFeels(links.map((l) => (l.aId === from ? l.aFeels : l.bId === from ? l.bFeels : '')))
  const a = of(first)
  const b = of(second)
  return [
    { from: first, to: second, feels: a, mood: moodOf(a) },
    { from: second, to: first, feels: b, mood: moodOf(b) }
  ]
}

/** The tie's temperature at a glance: both warm, both tense, one each way (lopsided), or mixed; null with no feelings. */
export function temperature(sides: [Side, Side]): 'warm' | 'tense' | 'lopsided' | 'mixed' | null {
  const [a, b] = sides.map((s) => s.mood)
  if (!a && !b) return null
  const set = new Set([a, b].filter(Boolean))
  if (set.has('warm') && set.has('cold')) return 'lopsided'
  if (set.size === 1 && set.has('warm')) return 'warm'
  if (set.size === 1 && set.has('cold')) return 'tense'
  return set.has('cold') ? 'tense' : set.has('warm') ? 'warm' : 'mixed'
}

/** The words on a tie's pill: its relationships' own words, each once ("daughter", "rival, owes money"). */
export const tieWords = (links: MapLink[]): string => [...new Set(links.map((l) => l.type).filter(Boolean))].join(', ')

// ---------- Medallions ----------

export type Rank = 'lead' | 'major' | 'support' | 'minor'

/** How much a character matters to the map: its role in the story, else how many ties it has. */
export function rankOf(role: string | undefined, degree: number, maxDegree: number): Rank {
  const r = (role ?? '').toLowerCase()
  if (/protagonist|hero|heroine|main character|lead/.test(r)) return 'lead'
  if (/antagonist|villain|deuteragonist/.test(r)) return 'major'
  if (/support/.test(r)) return 'support'
  if (/minor|walk-?on|background|extra/.test(r)) return 'minor'
  if (maxDegree >= 3 && degree >= Math.max(3, maxDegree * 0.75)) return 'major'
  return degree >= 2 ? 'support' : 'minor'
}

/** A medallion's width at life size, in pixels. */
export const MEDAL: Record<Rank, number> = { lead: 92, major: 78, support: 66, minor: 56 }

/** How big medallions are on screen at a zoom, as a share of life size: life size from 80% up, never below 42%. */
export const medalScale = (k: number): number => Math.min(1, Math.max(0.42, k / 0.8))

/** The words in a medallion's role chip: Adam's own words, with the usual ones in a capital. */
export function roleWords(role: string | undefined): string {
  const r = (role ?? '').trim()
  if (!r) return ''
  return r.charAt(0).toUpperCase() + r.slice(1)
}

// ---------- Lines ----------

export interface Pt {
  x: number
  y: number
}

/** A small, stable number in [0, 1) from a string (FNV-1a). */
export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * A tie's gentle arc from a to b: a quadratic curve bowed away from `centre` (so lines across the middle fan outwards
 * instead of crossing on top of each other), by 12-16% of its length. `mid` is the curve's middle, where its pill sits.
 */
export function arcOf(a: Pt, b: Pt, centre: Pt, key: string): { c: Pt; mid: Pt; d: string } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const away = (mx + nx - centre.x) ** 2 + (my + ny - centre.y) ** 2 - ((mx - nx - centre.x) ** 2 + (my - ny - centre.y) ** 2)
  const sign = Math.abs(away) < 1e-6 ? (hash01(key) < 0.5 ? -1 : 1) : away > 0 ? 1 : -1
  const bend = len * (0.12 + hash01(key) * 0.04) * sign
  const c = { x: mx + nx * bend, y: my + ny * bend }
  const mid = { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 }
  const r = (v: number): number => Math.round(v * 10) / 10
  return { c, mid, d: `M${r(a.x)},${r(a.y)} Q${r(c.x)},${r(c.y)} ${r(b.x)},${r(b.y)}` }
}

/** The point a share t of the way along a quadratic curve. */
export const onCurve = (a: Pt, c: Pt, b: Pt, t: number): Pt => ({
  x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
  y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y
})

// ---------- Fitting ----------

/** Room kept clear of the map around the edges of the canvas: the timeline strip above, the legend below. */
export interface Pad {
  left: number
  right: number
  top: number
  bottom: number
}

/** The most a small cast is spread out to fill the canvas (its places pushed apart; the medallions keep their size). */
export const SPREAD_MAX = 2.4
export const DESK_MIN_ZOOM = 0.15
export const DESK_MAX_ZOOM = 3

/**
 * The view that fills the canvas with these places, inside `pad`: a small cast is spread out (up to SPREAD_MAX) so it
 * uses the whole canvas instead of sitting small in the middle of it; a big one is shrunk to fit.
 */
export function spreadView(points: Pt[], width: number, height: number, pad: Pad, max = SPREAD_MAX): View {
  if (!points.length || width <= 0 || height <= 0) return { tx: width / 2, ty: height / 2, k: 1 }
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const w = Math.max(1, width - pad.left - pad.right)
  const h = Math.max(1, height - pad.top - pad.bottom)
  const kx = maxX > minX ? w / (maxX - minX) : max
  const ky = maxY > minY ? h / (maxY - minY) : max
  const k = Math.min(max, Math.max(DESK_MIN_ZOOM, Math.min(kx, ky)))
  const cx = pad.left + w / 2
  const cy = pad.top + h / 2
  return { k, tx: cx - ((minX + maxX) / 2) * k, ty: cy - ((minY + maxY) / 2) * k }
}

/** Zooms by `factor` about the window point (cx, cy). */
export function zoomAbout(view: View, factor: number, cx: number, cy: number): View {
  const k = Math.min(DESK_MAX_ZOOM, Math.max(DESK_MIN_ZOOM, view.k * factor))
  if (k === view.k) return view
  const f = k / view.k
  return { k, tx: cx - (cx - view.tx) * f, ty: cy - (cy - view.ty) * f }
}

// ---------- Room for names and pills ----------

export interface Placeable {
  key: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Which names and pills have room, greedily in the order given (most important first): a box is shown when it covers
 * no medallion (`discs`, centre and radius; its own owner's excepted) and no box already shown. Screen pixels.
 */
export function roomFor(discs: { key: string; x: number; y: number; r: number }[], boxes: (Placeable & { owner?: string })[]): Set<string> {
  const CELL = 80
  const cells = new Map<string, { x0: number; y0: number; x1: number; y1: number; owner: string }[]>()
  const each = (b: { x0: number; y0: number; x1: number; y1: number }, visit: (k: string) => boolean | void): boolean => {
    for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++)
      for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++) if (visit(`${gx},${gy}`) === false) return false
    return true
  }
  const put = (b: { x0: number; y0: number; x1: number; y1: number; owner: string }): void => {
    each(b, (k) => {
      const l = cells.get(k)
      if (l) l.push(b)
      else cells.set(k, [b])
    })
  }
  for (const d of discs) put({ x0: d.x - d.r, y0: d.y - d.r, x1: d.x + d.r, y1: d.y + d.r, owner: d.key })
  const shown = new Set<string>()
  const GAP = 3
  for (const b of boxes) {
    const box = { x0: b.x - b.w / 2, y0: b.y - b.h / 2, x1: b.x + b.w / 2, y1: b.y + b.h / 2, owner: b.owner ?? b.key }
    const free = each(box, (k) =>
      !(cells.get(k) ?? []).some(
        (o) => o.owner !== box.owner && box.x0 < o.x1 + GAP && o.x0 < box.x1 + GAP && box.y0 < o.y1 + GAP && o.y0 < box.y1 + GAP
      )
    )
    if (!free) continue
    put(box)
    shown.add(b.key)
  }
  return shown
}

// ---------- The keyboard ----------

export type Direction = 'left' | 'right' | 'up' | 'down'

/**
 * The character an arrow key moves to from `from`: the nearest one that way (within 70 degrees of it), the straighter
 * the better; null when there is none.
 */
export function nextOver<T extends Pt & { id: ID }>(nodes: T[], from: T, dir: Direction): T | null {
  const [ux, uy] = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1]
  let best: T | null = null
  let bestScore = Infinity
  for (const n of nodes) {
    if (n.id === from.id) continue
    const dx = n.x - from.x
    const dy = n.y - from.y
    const d = Math.hypot(dx, dy)
    if (!d) continue
    const cos = (dx * ux + dy * uy) / d
    if (cos < Math.cos((70 * Math.PI) / 180)) continue
    const score = d * (1 + (1 - cos) * 2.5)
    if (score < bestScore || (score === bestScore && best && n.id < best.id)) [best, bestScore] = [n, score]
  }
  return best
}

// ---------- A group's region ----------

/** The convex hull of some points, in order round it (Andrew's monotone chain). */
export function hull(points: Pt[]): Pt[] {
  const ps = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (ps.length <= 2) return ps
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const p of ps) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (const p of [...ps].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** A path round a hull (a point, a line or a polygon), for a thick round-joined stroke to soften into a region. */
export function hullPath(points: Pt[]): string {
  const h = hull(points)
  if (!h.length) return ''
  const r = (v: number): number => Math.round(v)
  if (h.length === 1) return `M${r(h[0].x)},${r(h[0].y)} l0.01,0`
  return `M${h.map((p) => `${r(p.x)},${r(p.y)}`).join(' L')}${h.length > 2 ? ' Z' : ''}`
}

// ---------- Time ----------

export const pairKeyOf = (a: ID, b: ID): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** A tie's events up to and including a stop, and since when it has held without a break: its first and latest. */
export function sinceOf(events: MapTieEvent[], atStop: number): { first: MapTieEvent; last: MapTieEvent } | null {
  const upTo = events.filter((e) => e.stop <= atStop)
  if (!upTo.length || upTo[upTo.length - 1].ended) return null
  let i = upTo.length - 1
  while (i > 0 && !upTo[i - 1].ended) i--
  return { first: upTo[i], last: upTo[upTo.length - 1] }
}

/** "Before the story" or where. */
export const whereWords = (e: MapTieEvent): string => (e.where ? e.where : 'Before the story begins')

/** The chapters along the timeline strip: each a span of stops, with its title. */
export function chapterSpans(stops: AsOfStop[], info: MapStopInfo[]): { chapterId: ID; title: string; from: number; to: number; n: number }[] {
  const out: { chapterId: ID; title: string; from: number; to: number; n: number }[] = []
  info.forEach((s, i) => {
    if (!s.chapterId || i >= stops.length) return
    const last = out[out.length - 1]
    if (last && last.chapterId === s.chapterId) last.to = i
    else out.push({ chapterId: s.chapterId, title: s.chapter, from: i, to: i, n: out.length + 1 })
  })
  return out
}

/** Plain words for what changed at a stop: a sentence for each of the first few, and how many more. */
export function changeWords(here: MapChangeNote[], name: (id: ID) => string, max = 2): { lead: string; lines: string[]; more: number } {
  if (!here.length) return { lead: '', lines: [], more: 0 }
  const kinds = new Set(here.map((h) => h.what))
  const lead = kinds.size > 1 ? 'Changed' : here[0].what === 'new' ? 'New' : here[0].what === 'ended' ? 'Ended' : 'Changed'
  const lines = here.slice(0, max).map((h) => {
    const who = `${name(h.aId)} and ${name(h.bId)}`
    if (h.what === 'new') return h.type ? `${who}: ${h.type}` : `${who} are tied`
    if (h.what === 'ended') return `${who}: no longer ${h.before || 'tied'}`
    return h.before && h.before !== h.type ? `${who}: ${h.before} → ${h.type}` : `${who}: ${h.type || 'tied'}, feelings changed`
  })
  return { lead, lines, more: Math.max(0, here.length - max) }
}

/** Ties by key, keeping those leaving the map for their exit (`leaving` since when), dropped after `ms`. */
export function withLeaving<T extends { key: string }>(prev: Map<string, { item: T; leaving: number | null }>, next: T[], now: number, ms: number) {
  const out = new Map<string, { item: T; leaving: number | null }>()
  for (const item of next) out.set(item.key, { item, leaving: null })
  for (const [key, p] of prev) {
    if (out.has(key)) continue
    const since = p.leaving ?? now
    if (now - since < ms) out.set(key, { item: p.item, leaving: since })
  }
  return out
}

/** Every character's ties counted. */
export function degrees(ties: { a: { id: ID }; b: { id: ID } }[]): Map<ID, number> {
  const d = new Map<ID, number>()
  for (const t of ties) {
    d.set(t.a.id, (d.get(t.a.id) ?? 0) + 1)
    d.set(t.b.id, (d.get(t.b.id) ?? 0) + 1)
  }
  return d
}

export type { MapNode }
