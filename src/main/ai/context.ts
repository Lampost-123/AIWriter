// Context assembly: builds the writer model's briefing for one scene from what the memory says
// counts there (SceneMemory, from src/main/memory/scene.ts), in the spec's fixed priority order,
// measures it, and fits it to the model. Pure: the caller supplies the data and a token counter,
// so every rule here is unit-tested.
//
// What is selected (spec, "What gets selected"), each entry with why in plain words for the Context tab:
// - everything on the scene card: point of view, characters present, location, its plot threads;
// - anything whose name or alias appears in the beats, the notes or Adam's direction;
// - the places around the location and the groups the people present belong to, one line each;
// - relationships and knowledge among the people present, as of this scene;
// - lore flagged as a hard rule, always;
// - anything Adam pinned for this scene, story or world;
// - the people tied to the characters present who aren't in the scene, as of this scene (milestone 5).
// Only entries that exist at this scene count. One that doesn't is sent only if Adam pins it or
// lists it on the scene card, with its label ("not in the story yet at this point"); one that
// first appears in this scene says so. Entries Adam kept out ('hide' pins) are left out.
//
// Priorities, with each block's short form in brackets:
//  1 instructions, style guide, sample passage, phrases to avoid (sample passage trimmed); never dropped
//  2 scene card and Adam's direction, and on a redraft what the scene should bring about; never dropped
//  3 the end of the previous scene on the story's line, 400 to 800 words (the last 200 words)
//  4 point-of-view character as of this scene: profile, what has happened, what they know, voice (without backstory;
//    smaller: the core of the profile, then less)
//  5 others present as of this scene: profile and voice (summary plus voice)
//  6 relationships and who knows what among those present (none; with many facts, the ones that matter here)
//  7 setting (location, places around it, groups), hard-rule lore, open plot threads on the card (one line each)
//  8 story so far: recent scenes, this story's chapters, earlier stories, "Leads into" (fewer scenes, series roll-ups;
//    smaller: only the most recent parts)
//  9 other entries named in the beats, notes or direction, and pins (one line each)
// 10 themes, tone and premise (one line)
// 11 ties to people not in this scene: for each character present, the people they're tied to who aren't
//    there, with where things stand and what has happened between them, newest first (names and relationship
//    only; smaller: the closest few)
//
// Fitting (spec, "Priority order and budget"): when the briefing is too long, blocks switch to
// their short form from the bottom up (11 to 3, then block 1). Blocks 4 and 8 can shrink further,
// a step at a time, so a small model still gets a usable point-of-view character and what happened
// just before; only then are whole blocks dropped (11 up to 3). Anything that fits again afterwards
// is put back, then given its longest form that fits, most important first. Adam's choice in the
// Context tab wins: 'full' is never shortened (it is dropped only as a last resort), 'short' is
// always short. The briefing never goes past the budget unless blocks 1 and 2 alone do.
//
// The order the blocks are sent in is separate (SEND_ORDER): what stays the same across a story
// comes first, right after the instructions, so providers that cache repeated prompts can reuse
// it; the story so far, the previous scene's ending and the scene card come last, right above
// "Write the scene now".

import type {
  BlockMode,
  Change,
  ChatMessage,
  ContextBlock,
  ContextBudget,
  ContextEntry,
  ContextPreview,
  DraftOptions,
  Entry,
  EntryState,
  ID,
  Pin,
  PinScope,
  RelationshipState,
  SceneCard,
  StyleGuide,
  ThinkingLevel,
  ThreadState
} from '@shared/types'
import { FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import { AUTO_LENGTH } from '@shared/defaults'
import type { SceneMemory, StorySoFar } from '../memory/types'
import { finalInstruction, indentMore, instructionsText, type FinalOptions } from './prompts'

export const DEFAULT_CONTEXT_LENGTH = 16_000
export const TOKENS_PER_WORD = 1.35
/** Room for the reply: the target length (with Auto, the longest Auto allows) plus 40%. */
export const REPLY_HEADROOM = 1.4
export const SAFETY_MARGIN = 0.1
/** Tokens for the chat format around each message. */
const MESSAGE_OVERHEAD = 4

export interface ContextInput {
  /** The style guide in effect (preferences, world and story merged). */
  style: StyleGuide
  scene: { title: string; card: SceneCard }
  /** What counts at this scene: entries as of here, the previous scene, the story so far... */
  memory: SceneMemory
  /** The pins that apply to this scene: its own, its story's and the world's. */
  pins: Pin[]
  /** Adam's choice for each block of this scene's briefing, by block id (missing = 'auto'). */
  blockModes: Record<string, BlockMode>
  world: { themes: string; tone: string }
  /** The story's series, if it has one. */
  series: { name: string; themes: string; tone: string } | null
  story: { title: string; premise: string; themes: string; tone: string }
  options: DraftOptions
  /** From the model choice; null when unknown. */
  contextLength: number | null
  /** The model's own reply limit in tokens, from the model choice; null or left out when unknown. Lowers Auto's ceiling. */
  maxOutput?: number | null
}

export interface BlockDraft {
  id: string
  priority: number
  title: string
  /** The full form. */
  text: string
  /** The short form, or null when the block has none (or it would be the same as the full form). */
  short: string | null
  /**
   * Still shorter forms, each smaller than the one before, for models with very little room: tried
   * once every block is short, before any block is dropped. Empty for most blocks.
   */
  smaller: string[]
  entryIds: ID[]
}

/** Every form of a block, longest first: full, short, then any smaller ones. */
export const formsOf = (b: Pick<BlockDraft, 'text' | 'short' | 'smaller'>): string[] =>
  b.short == null ? [b.text] : [b.text, b.short, ...b.smaller]

export interface PreparedContext {
  blocks: BlockDraft[]
  /** Adam's choice for each block, by block id. */
  modes: Record<string, BlockMode>
  finals: { withPrevious: string; withoutPrevious: string }
  /**
   * Every text to measure, in order: each block's forms as sent (formsOf: full, then short, then
   * any smaller ones), block after block, then both closing instructions.
   */
  texts: string[]
  contextLength: number
  /** The length asked for, or null for Auto (room is kept for autoMax words). */
  targetWords: number | null
  /** With Auto: the longest scene Auto allows this model (AUTO_LENGTH.max, or less for a model with a small reply limit). */
  autoMax?: number
  /** With Auto: both closing instructions again for a lower ceiling, when the window can't fit autoMax beside the briefing. */
  autoFinals?: (maxWords: number) => { withPrevious: string; withoutPrevious: string }
  knows: string
  entries: ContextEntry[]
}

// ---------- Budget ----------

/** Room for a reply of `targetWords` words (null is Auto: the longest Auto allows) plus 40%. */
export const replyTokens = (targetWords: number | null): number =>
  Math.ceil(Math.max(0, targetWords ?? AUTO_LENGTH.max) * TOKENS_PER_WORD * REPLY_HEADROOM)

/**
 * The longest scene Auto may ask this model for: AUTO_LENGTH.max, lowered (in hundreds, never under
 * AUTO_LENGTH.min) for a model whose own reply limit is smaller than that.
 */
export function autoCeiling(maxOutput?: number | null): number {
  if (!maxOutput || maxOutput <= 0) return AUTO_LENGTH.max
  const words = Math.floor(maxOutput / TOKENS_PER_WORD / 100) * 100
  return Math.max(AUTO_LENGTH.min, Math.min(AUTO_LENGTH.max, words))
}

export function computeBudget(contextLength: number | null, targetWords: number | null): Omit<ContextBudget, 'used'> {
  const length = contextLength && contextLength > 0 ? contextLength : DEFAULT_CONTEXT_LENGTH
  const reserved = replyTokens(targetWords)
  const available = Math.max(0, length - reserved - Math.ceil(length * SAFETY_MARGIN))
  return { contextLength: length, reserved, available }
}

/** Beyond the room kept for the reply, extra headroom is only given up to this many tokens. */
export const REPLY_LIMIT_CAP = 16_384
/** Extra room always asked for beyond the reply room, for models that think before they write. */
export const THINKING_ROOM = 4000
/**
 * The share of the reply limit, in percent, a model's thinking may take at each thinking level
 * (OpenRouter gives a model that thinks to a token budget this much of max_tokens), so a reply limit
 * asked with a level leaves the reply its own room beside the thinking.
 */
export const THINKING_SHARE: Record<ThinkingLevel, number> = { auto: 0, off: 0, low: 20, medium: 50, high: 80 }
/** The reply limit that still leaves `reply` tokens to answer with once thinking at this level has taken its share. */
export const withThinkingShare = (reply: number, level?: ThinkingLevel): number => Math.ceil((reply * 100) / (100 - THINKING_SHARE[level ?? 'auto']))

/**
 * The reply limit (max_tokens) for a draft, and a smaller one to fall back on
 * if the provider rejects it.
 *
 * The room kept for the reply (target length + 40%) is what the briefing is
 * budgeted around, but used as a hard limit it cuts off a scene that runs a
 * little long, and models that think before writing (their thinking counts
 * against the limit) can run out before the scene is done. So when the model
 * has room, the limit goes up to twice the reply room (no higher than
 * REPLY_LIMIT_CAP unless the reply room itself is bigger), and always at least
 * THINKING_ROOM beyond the reply room; never past what the context window has
 * left after the briefing, and never past the model's own output limit when
 * the provider says what it is. A model asked to think more gets room for its
 * thinking's share on top (THINKING_SHARE).
 */
export function replyTokenLimit(
  budget: Pick<ContextBudget, 'contextLength' | 'reserved' | 'used'>,
  maxOutput?: number | null,
  thinking?: ThinkingLevel
): { limit: number; fallback: number } {
  const out = maxOutput && maxOutput > 0 ? maxOutput : Infinity
  const fallback = Math.max(1, Math.min(budget.reserved, out))
  const wanted = Math.max(budget.reserved + THINKING_ROOM, Math.min(budget.reserved * 2, REPLY_LIMIT_CAP), withThinkingShare(budget.reserved, thinking))
  // What the window has left after the briefing, keeping 5% spare since providers count differently.
  const room = replyRoom(budget)
  if (room <= fallback) return { limit: fallback, fallback }
  return { limit: Math.max(fallback, Math.min(wanted, room, out)), fallback }
}

/** What the context window has left for the reply once the briefing is in (5% spare, since providers count differently). */
export const replyRoom = (budget: Pick<ContextBudget, 'contextLength' | 'used'>): number =>
  budget.contextLength - budget.used - Math.ceil(budget.contextLength * 0.05)

/** About how many words the model can write in one go after this briefing, in hundreds. */
export function maxTargetWords(budget: Pick<ContextBudget, 'contextLength' | 'used'>): number {
  const room = replyRoom(budget)
  return room <= 0 ? 0 : Math.floor(room / (TOKENS_PER_WORD * REPLY_HEADROOM) / 100) * 100
}

/**
 * When the length asked for can't fit in the model's window next to the briefing:
 * how many words would. Null when it fits. Only meaningful when the window is known.
 */
export function lengthTooLong(budget: Pick<ContextBudget, 'contextLength' | 'used' | 'reserved'>): { maxWords: number } | null {
  return budget.reserved > replyRoom(budget) ? { maxWords: maxTargetWords(budget) } : null
}

/** Token estimate with a 10% allowance, since providers count differently (in whole numbers: 100 * 1.1 isn't exactly 110). */
export const withAllowance = (rawTokens: number): number => Math.ceil((Math.round(rawTokens) * 11) / 10)

/**
 * Wraps a token counter with a cache, so a preview made again as Adam edits the scene card only
 * counts the blocks that changed. Keeps the `limit` most recently used texts.
 */
export function cachedCounter(count: (texts: string[]) => Promise<number[]>, limit = 400): (texts: string[]) => Promise<number[]> {
  const cache = new Map<string, number>()
  return async (texts) => {
    const missing = [...new Set(texts.filter((t) => t && !cache.has(t)))]
    if (missing.length) {
      const counts = await count(missing)
      missing.forEach((t, i) => cache.set(t, counts[i] ?? 0))
    }
    const out = texts.map((t) => {
      if (!t) return 0
      const n = cache.get(t) ?? 0
      // Most recently used last, so the oldest go first.
      cache.delete(t)
      cache.set(t, n)
      return n
    })
    for (const key of cache.keys()) {
      if (cache.size <= limit) break
      cache.delete(key)
    }
    return out
  }
}

// ---------- Formatting memory entries ----------

const clean = (s: string | undefined | null): string => (s ?? '').trim()

/** Ends a phrase with a full stop unless it already ends with punctuation. */
const sentence = (s: string): string => (/[.!?…:;]["'”’)\]]*$/.test(s) ? s : `${s}.`)

/**
 * Every filled kind-specific field, grouped under the labels from src/shared/fields.ts. Never private notes.
 * `onlyGroups` keeps just those groups (by id); `short` leaves out the fields marked optionalInShort (backstory);
 * `onlyKeys` keeps just those fields.
 */
export function fieldSections(e: Entry, onlyGroups?: string[], short = false, onlyKeys?: ReadonlySet<string>): string[] {
  const groups = FIELD_GROUPS[e.kind] ?? []
  const out: string[] = []
  for (const g of groups) {
    if (onlyGroups && !onlyGroups.includes(g.id)) continue
    const lines: string[] = []
    for (const f of g.fields) {
      if (short && f.optionalInShort) continue
      if (onlyKeys && !onlyKeys.has(f.key)) continue
      const v = clean(e.fields?.[f.key])
      if (!v) continue
      if (v.includes('\n')) {
        lines.push(
          `- ${f.label}:\n${v
            .split(/\r?\n/)
            .filter((l) => l.trim())
            .map((l) => `    ${l.trim()}`)
            .join('\n')}`
        )
      } else {
        lines.push(`- ${f.label}: ${v}`)
      }
    }
    // A kind with a single group (places, lore) doesn't need the group's label.
    if (lines.length) out.push(groups.length > 1 ? `${g.label}\n${lines.join('\n')}` : lines.join('\n'))
  }
  return out
}

/**
 * A profile: name line, aliases, summary, description and every filled field (or only `onlyGroups`).
 * `short` leaves out the backstory fields.
 */
export function formatProfile(e: Entry, heading: string | null = `### ${e.name}`, onlyGroups?: string[], short = false): string {
  const head: string[] = []
  if (heading) head.push(heading)
  const aliases = (e.aliases ?? []).map((a) => a.trim()).filter(Boolean)
  if (aliases.length) head.push(`Also called: ${aliases.join(', ')}`)
  if (clean(e.summary)) head.push(`In short: ${clean(e.summary)}`)
  const parts = [head.join('\n')]
  if (clean(e.description)) parts.push(clean(e.description))
  parts.push(...fieldSections(e, onlyGroups, short))
  return parts.filter(Boolean).join('\n\n')
}

const lookKeys = FIELD_GROUPS.character?.find((g) => g.id === 'looks')?.fields.map((f) => f.key) ?? []
/**
 * The point-of-view character's fields kept in the two smallest forms. Core: who they are, how they
 * look, what drives them now and their voice. Least: who they are, the mark anyone would notice,
 * what drives them now and how they speak, with two sample lines.
 */
const POV_FIELDS = {
  core: new Set(['pronouns', 'age', 'role', ...lookKeys, 'traits', 'wants', 'motivation', 'speech', 'tics', 'neverSays', 'sampleLines']),
  least: new Set(['pronouns', 'age', 'role', 'marks', 'motivation', 'speech', 'sampleLines'])
}

/** Words of the description kept in the point-of-view character's two smallest forms. */
export const CORE_DESCRIPTION_WORDS = { core: 70, least: 35 }

/**
 * The opening of a text, about `words` words long, in whole sentences, so nothing is cut off mid-thought.
 * A first sentence longer than that is cut at a word with an ellipsis. Short texts come back whole.
 */
export function openingSentences(text: string, words: number): string {
  const t = clean(text)
  const ends = [...t.matchAll(/\S+/g)].map((m) => (m.index ?? 0) + m[0].length)
  if (ends.length <= words) return t
  let best = -1
  for (const m of t.matchAll(/[.!?…]["'”’)\]]*(?=\s|$)/g)) {
    const end = (m.index ?? 0) + m[0].length
    if (end > ends[words - 1]) break
    best = end
  }
  if (best > 0) return t.slice(0, best)
  return `${t.slice(0, ends[words - 1]).replace(/[,;:]$/, '')}…`
}

/**
 * The point-of-view character in fewer words, never the backstory: the name line, the opening of
 * the description and the fields above. The least form gives the description only when there is
 * no one-line summary, and only two sample lines.
 */
function coreProfile(e: Entry, size: 'core' | 'least'): string {
  const head: string[] = []
  const aliases = (e.aliases ?? []).map((a) => a.trim()).filter(Boolean)
  if (aliases.length) head.push(`Also called: ${aliases.join(', ')}`)
  if (clean(e.summary)) head.push(`In short: ${clean(e.summary)}`)
  const parts = [head.join('\n')]
  if (clean(e.description) && (size === 'core' || !clean(e.summary))) {
    parts.push(openingSentences(e.description, CORE_DESCRIPTION_WORDS[size]))
  }
  const lines = (e.fields?.sampleLines ?? '').split(/\r?\n/).filter((l) => l.trim())
  const shown = size === 'least' ? { ...e, fields: { ...e.fields, sampleLines: lines.slice(0, 2).join('\n') } } : e
  parts.push(...fieldSections(shown, undefined, true, POV_FIELDS[size]))
  return parts.filter(Boolean).join('\n\n')
}

/** One line for an entry: its name and one-line summary. */
export function oneLine(e: Entry, note = ''): string {
  const name = note ? `${e.name} (${note})` : e.name
  return clean(e.summary) ? `${name}: ${clean(e.summary)}` : name
}

/** What has happened to an entry so far, oldest first; `last` keeps only the most recent few. */
export function happenedText(e: Pick<EntryState, 'happened'>, last?: number): string {
  const all = (e.happened ?? []).filter((h) => clean(h.note))
  const items = last != null ? all.slice(-last) : all
  if (!items.length) return ''
  return `What has happened so far:\n${items.map((h) => `- ${indentMore(clean(h.note).replace(/\.$/, ''))}${clean(h.where) ? ` (${clean(h.where)})` : ''}`).join('\n')}`
}

/** The places containing this one, nearest first (cycle-safe). */
export function parentChain(place: Entry, byId: Map<ID, Entry>): Entry[] {
  const out: Entry[] = []
  const seen = new Set<ID>([place.id])
  let next = place.parentId ? byId.get(place.parentId) : undefined
  while (next && !seen.has(next.id) && out.length < 12) {
    out.push(next)
    seen.add(next.id)
    next = next.parentId ? byId.get(next.parentId) : undefined
  }
  return out
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * True when `name` appears in `text` as a whole word or phrase. A single
 * capitalised word ("Will", "Rose", "Red") must appear capitalised, so ordinary
 * words don't count; phrases and lower-case aliases ("The Duke", "the old
 * woman") ignore case.
 */
export function mentions(text: string, name: string): boolean {
  const n = name.trim()
  if (n.length < 2 || !text) return false
  const flags = /\s/.test(n) || !/^\p{Lu}/u.test(n) ? 'iu' : 'u'
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, flags).test(text)
}

const squash = (s: string): string => s.toLocaleLowerCase().replace(/\s+/g, ' ')

/** A text to look for names in, with a plain copy for a quick check first, so a big world stays fast. */
const haystack = (text: string): { text: string; plain: string } => ({ text, plain: squash(text) })

/** True when any of the names appears in the text. */
function namedIn(h: { text: string; plain: string }, names: string[]): boolean {
  if (!h.plain.trim()) return false
  return names.some((n) => n.trim().length >= 2 && h.plain.includes(squash(n.trim())) && mentions(h.text, n))
}

// ---------- The end of the previous scene ----------

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

/**
 * The last 400 to 800 words of a scene, aiming for about 600, cut at the start
 * of a paragraph if possible, otherwise at the start of a sentence.
 */
export function sceneTail(text: string, o: { min: number; target: number; max: number } = { min: 400, target: 600, max: 800 }): string {
  const t = text.trim()
  const starts: number[] = []
  for (const m of t.matchAll(WORD_RE)) starts.push(m.index ?? 0)
  const n = starts.length
  if (n <= o.max) return t

  // Words from position p to the end.
  const wordsFrom = (p: number): number => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] < p) lo = mid + 1
      else hi = mid
    }
    return n - lo
  }
  const best = (re: RegExp): number | null => {
    let pick: number | null = null
    let dist = Infinity
    for (const m of t.matchAll(re)) {
      const p = (m.index ?? 0) + m[0].length
      const w = wordsFrom(p)
      if (w < o.min || w > o.max) continue
      const d = Math.abs(w - o.target)
      if (d < dist) {
        dist = d
        pick = p
      }
    }
    return pick
  }
  const para = best(/\n\s*/g)
  if (para != null) return t.slice(para).trim()
  const sentence = best(/[.!?…]["'”’)\]]*\s+/g)
  if (sentence != null) return t.slice(sentence).trim()
  return `…${t.slice(starts[n - o.target])}`.trim()
}

/** Block 3's short form: about the last 200 words. */
export const SHORT_TAIL = { min: 150, target: 200, max: 250 }

/** The story the previous scene is in, when it isn't this one (this story's first scene); null otherwise. */
function previousStory(input: ContextInput): { title: string; ended: boolean; timeGap: string } | null {
  const p = input.memory.previous
  if (!p?.otherStory || !p.storyId || p.storyId === input.memory.storyId) return null
  return { title: p.storyTitle.trim() || 'the story before', ended: p.otherStory.ended, timeGap: p.otherStory.timeGap.trim() }
}

// ---------- Selection ----------

/** Why an entry is in the briefing, in plain words, as the Context tab shows it. */
export const WHY = {
  card: 'On the scene card',
  location: 'Where the scene happens',
  around: "Around the scene's location",
  group: 'A group someone here belongs to',
  beats: 'Named in the beats',
  notes: 'Named in the scene notes',
  direction: 'Named in your direction',
  rule: 'A world rule',
  tie: 'Tied to someone in the scene',
  pin: { scene: 'Pinned for this scene', story: 'Pinned for this story', world: 'Pinned for every scene' },
  hide: { scene: 'Kept out of this scene', story: 'Kept out of this story', world: 'Kept out of every scene' }
} as const

/** The label for an entry whose first appearance is the scene being drafted. */
export const FIRST_HERE = 'first appears in this scene'

const SCOPE_RANK: Record<PinScope, number> = { scene: 0, story: 1, world: 2 }

/** The pin that decides for each entry: the most specific one (scene, then story, then world). */
export function effectivePins(pins: Pin[]): Map<ID, Pin> {
  const out = new Map<ID, Pin>()
  for (const p of pins) {
    const cur = out.get(p.entryId)
    if (!cur || SCOPE_RANK[p.scope] < SCOPE_RANK[cur.scope]) out.set(p.entryId, p)
  }
  return out
}

export interface Chosen {
  entry: EntryState
  why: string
  /** Where Adam pinned it, if he did. */
  pinned: PinScope | null
  /** "first appears in this scene", or the label for an entry that doesn't exist here. */
  label: string | null
}

export interface Selection {
  /** Every entry the briefing could name: those that exist here and those that don't (for names on the card). */
  known: Map<ID, EntryState>
  /** The entries in the briefing, in the order chosen, with why. */
  chosen: Map<ID, Chosen>
  /** Entries Adam kept out, with which pin did it. */
  hidden: { entry: EntryState; why: string }[]
  pov: EntryState | null
  /** The others present (not the point-of-view character). */
  present: EntryState[]
  location: EntryState | null
  /** The places containing the location, nearest first. */
  around: EntryState[]
  /** Groups the people present belong to, with who belongs and how. */
  groups: { group: EntryState; ties: { memberId: ID; type: string }[] }[]
  rules: EntryState[]
  /** Plot threads on the scene card that are still open here. */
  threads: { entry: EntryState; role: 'sets up' | 'pays off'; state: ThreadState | null }[]
  /** Other entries named in the beats, notes or direction, and pins. */
  others: EntryState[]
  /** For each character present, the people they're tied to who aren't in the scene, closest and most recent first. */
  ties: { person: EntryState; ties: Tie[] }[]
  label: (id: ID) => string | null
}

/** Decides which entries the briefing holds and why (spec, "What gets selected"). */
export function selectEntries(input: ContextInput): Selection {
  const m = input.memory
  const card = input.scene.card
  const here = new Map(m.entries.map((e) => [e.id, e]))
  const away = new Map(m.elsewhere.map((x) => [x.entry.id, x]))
  const known = new Map<ID, EntryState>([...m.elsewhere.map((x) => [x.entry.id, x.entry] as const), ...here])
  const firstHere = new Set(m.firstHere)
  const pins = effectivePins(input.pins)
  const label = (id: ID): string | null => away.get(id)?.label ?? (firstHere.has(id) ? FIRST_HERE : null)
  const chosen = new Map<ID, Chosen>()

  /** Adds an entry for a reason, once. One that doesn't exist here comes in only when it is on the card or pinned. */
  const take = (id: ID | null | undefined, why: string, listed: boolean): EntryState | null => {
    if (!id || chosen.has(id)) return null
    const pin = pins.get(id)
    if (pin?.action === 'hide') return null
    const e = here.get(id) ?? (listed || pin?.action === 'pin' ? away.get(id)?.entry : undefined)
    if (!e) return null
    chosen.set(id, { entry: e, why, pinned: pin?.action === 'pin' ? pin.scope : null, label: label(id) })
    return e
  }
  const some = <T>(x: T | null): x is T => x != null

  const pov = take(card.povId, WHY.card, true)
  const present = card.presentIds
    .filter((id) => id !== card.povId)
    .map((id) => take(id, WHY.card, true))
    .filter(some)
  const location = take(card.locationId, WHY.location, true)

  const threads: Selection['threads'] = []
  for (const [ids, role] of [
    [card.setsUpIds ?? [], 'sets up'],
    [card.paysOffIds ?? [], 'pays off']
  ] as const) {
    for (const id of ids) {
      const state = m.threads.find((t) => t.entryId === id) ?? null
      if (state?.status === 'resolved') continue
      const e = take(id, WHY.card, true)
      if (e) threads.push({ entry: e, role, state })
    }
  }

  // The places around the location, as far as they exist here.
  const around = location
    ? parentChain(location, known)
        .filter((p) => here.has(p.id))
        .map((p) => take(p.id, WHY.around, false))
        .filter(some)
    : []

  // Groups the people present belong to: a relationship between one of them and a group.
  const people = new Set([pov, ...present].filter(some).map((e) => e.id))
  const ties = new Map<ID, { memberId: ID; type: string }[]>()
  for (const r of m.relationships) {
    for (const [member, other] of [
      [r.aId, r.bId],
      [r.bId, r.aId]
    ]) {
      if (!people.has(member) || here.get(other)?.kind !== 'group') continue
      ties.set(other, [...(ties.get(other) ?? []), { memberId: member, type: clean(r.type) }])
    }
  }
  const groups: Selection['groups'] = []
  for (const [groupId, list] of ties) {
    const group = take(groupId, WHY.group, false)
    if (group) groups.push({ group, ties: list })
  }

  const rules = m.entries
    .filter((e) => e.kind === 'lore' && e.hardRule)
    .map((e) => take(e.id, WHY.rule, false))
    .filter(some)

  // Anything else named in the beats, the notes or the direction (only what exists here).
  const others: EntryState[] = []
  const texts = [
    [haystack(card.beats.join('\n')), WHY.beats],
    [haystack(card.notes), WHY.notes],
    [haystack(input.options.direction), WHY.direction]
  ] as const
  for (const e of m.entries) {
    if (chosen.has(e.id)) continue
    const names = [e.name, ...(e.aliases ?? [])]
    const hit = texts.find(([h]) => namedIn(h, names))
    const got = hit ? take(e.id, hit[1], false) : null
    if (got) others.push(got)
  }

  // Adam's pins.
  for (const p of pins.values()) {
    if (p.action !== 'pin') continue
    const got = take(p.entryId, WHY.pin[p.scope], true)
    if (got) others.push(got)
  }

  const tiesAway = absentTies(input, [pov, ...present].filter(some), here, (id) => take(id, WHY.tie, false) ?? chosen.get(id)?.entry ?? null)

  const hidden: Selection['hidden'] = []
  for (const p of pins.values()) {
    const e = known.get(p.entryId)
    if (p.action === 'hide' && e) hidden.push({ entry: e, why: WHY.hide[p.scope] })
  }

  return { known, chosen, hidden, pov, present, location, around, groups, rules, threads, others, ties: tiesAway, label }
}

/** One tie between a character in the scene and someone who isn't there, as of this scene. */
export interface Tie {
  other: EntryState
  rel: RelationshipState
  /** What has happened between them (events naming both, and changes to either that name the other), newest first. */
  history: { text: string; at: number }[]
}

/** Block 11's priority: the lowest, shortened and dropped first. */
export const TIES_PRIORITY = 11
/** How many ties per character, and how much history per tie, the full form of block 11 holds at most. */
export const TIES_FULL = { ties: 10, history: 5 }
/** Block 11's smallest form: the closest few ties per character, names and relationship only. */
export const TIES_FEWEST = 3

/**
 * The people each character present is tied to who aren't in the scene (spec, "What gets selected"). Only
 * characters that exist here and that Adam hasn't kept out (`take` returns null for those). Closest (most
 * shared history) and most recent (the latest change to the tie or its history) come first: each tie is
 * ranked on both, and the two ranks are added.
 */
function absentTies(
  input: ContextInput,
  people: EntryState[],
  here: Map<ID, EntryState>,
  take: (id: ID) => EntryState | null
): Selection['ties'] {
  const m = input.memory
  const inScene = new Set(people.map((p) => p.id))
  const isCharacter = (id: ID): boolean => here.get(id)?.kind === 'character'
  const out: Selection['ties'] = []
  for (const person of people) {
    if (person.kind !== 'character') continue
    const found: Tie[] = []
    for (const r of m.relationships) {
      if (r.aId !== person.id && r.bId !== person.id) continue
      const otherId = r.aId === person.id ? r.bId : r.aId
      if (inScene.has(otherId) || !isCharacter(otherId)) continue
      const other = here.get(otherId)!
      found.push({ other, rel: r, history: sharedHistory(m.relationships, here, person, other) })
    }
    if (!found.length) continue
    const latest = (t: Tie): number => Math.max(t.rel.at ?? -1, ...t.history.map((h) => h.at))
    const byRecent = [...found].sort((a, b) => latest(b) - latest(a))
    const byClose = [...found].sort((a, b) => b.history.length - a.history.length)
    const score = (t: Tie): number => byRecent.indexOf(t) + byClose.indexOf(t)
    const ranked = found
      .sort((a, b) => score(a) - score(b) || b.history.length - a.history.length || latest(b) - latest(a))
      .filter((t) => take(t.other.id))
    if (ranked.length) out.push({ person, ties: ranked })
  }
  return out
}

/**
 * What has happened between two characters, newest first: the events both were involved in (the memory keeper
 * ties each to an event with an "involved in" relationship) and the things that happened to either one whose
 * note names the other.
 */
function sharedHistory(rels: RelationshipState[], here: Map<ID, EntryState>, a: EntryState, b: EntryState): Tie['history'] {
  const out: Tie['history'] = []
  const involved = new Map<ID, number[]>()
  for (const r of rels) {
    for (const [who, what] of [
      [r.aId, r.bId],
      [r.bId, r.aId]
    ]) {
      if ((who === a.id || who === b.id) && here.get(what)?.kind === 'event') {
        involved.set(what, [...(involved.get(what) ?? []), r.at ?? -1])
      }
    }
  }
  for (const [eventId, ats] of involved) {
    // Both must be involved: a link to the event from each of them (one relationship per pair).
    const e = here.get(eventId)!
    if (ats.length < 2) continue
    const when = clean(e.fields.when)
    out.push({ text: [`${e.name}${when ? ` (${when})` : ''}`, clean(e.summary)].filter(Boolean).join(': '), at: Math.min(...ats) })
  }
  for (const [who, other] of [
    [a, b],
    [b, a]
  ]) {
    // Notes name people as the text does, often by first name alone ("Pulled Ana out of the water").
    const first = other.name.trim().split(/\s+/)[0]
    const names = [other.name, ...(other.aliases ?? []), ...(first.length > 2 && first !== other.name.trim() ? [first] : [])]
    for (const h of who.happened ?? []) {
      if (!clean(h.note) || !namedIn(haystack(h.note), names)) continue
      const note = clean(h.note).replace(/\.$/, '')
      out.push({ text: `${who.name}: ${note}${clean(h.where) ? ` (${clean(h.where)})` : ''}`, at: h.at ?? -1 })
    }
  }
  return out.sort((x, y) => y.at - x.at)
}

// ---------- Blocks ----------

const withLabel = (name: string, label: string | null): string => (label ? `${name} (${label})` : name)

function relationshipLine(r: RelationshipState, name: (id: ID) => string): string {
  const parts = [`${name(r.aId)} and ${name(r.bId)}: ${sentence(clean(r.type) || 'linked')}`]
  if (clean(r.aFeels)) parts.push(`${name(r.aId)} feels: ${sentence(clean(r.aFeels))}`)
  if (clean(r.bFeels)) parts.push(`${name(r.bId)} feels: ${sentence(clean(r.bFeels))}`)
  return parts.join(' ')
}

const joinAnd = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** A change pinned to this scene, as an aim for the draft ("Mara: loses her left hand"). */
export function bringAboutLine(c: Change, name: (id: ID) => string): string | null {
  const who = name(c.entryId)
  switch (c.kind) {
    case 'update':
      return clean(c.payload.note) ? `${who}: ${clean(c.payload.note)}` : null
    case 'full':
      return clean(c.payload.summary) || clean(c.payload.description)
        ? `${who}: ${clean(c.payload.summary) || clean(c.payload.description)}`
        : null
    case 'relationship': {
      const p = c.payload
      const type = clean(p.type) || 'linked'
      const feels = [
        clean(p.feels) ? `${who} feels: ${sentence(clean(p.feels))}` : '',
        clean(p.otherFeels) ? `${name(p.otherId)} feels: ${sentence(clean(p.otherFeels))}` : ''
      ]
        .filter(Boolean)
        .join(' ')
      return `${who} and ${name(p.otherId)}: ${p.ended ? `no longer ${type}` : type}${feels ? `. ${feels}` : ''}`
    }
    case 'knowledge':
      return clean(c.payload.fact) ? `${who} ${c.payload.forgets ? 'forgets' : 'learns'}: ${clean(c.payload.fact)}` : null
    case 'thread':
      return `${c.payload.status === 'resolved' ? 'Pays off' : 'Sets up'} the plot thread ${who}${clean(c.payload.note) ? `: ${clean(c.payload.note)}` : ''}`
  }
}

function sceneCardText(input: ContextInput, sel: Selection): string {
  const { card, title } = input.scene
  const name = (id: ID): string | null => {
    const e = sel.known.get(id)
    return e ? withLabel(e.name, sel.label(id)) : null
  }
  const names = (ids: ID[]): string[] => ids.map(name).filter((n): n is string => !!n)
  const lines: string[] = []
  if (clean(title)) lines.push(`Scene: ${clean(title)}`)
  if (clean(card.when)) lines.push(`When: ${clean(card.when)}`)
  const pov = card.povId ? name(card.povId) : null
  if (pov) lines.push(`Point of view: ${pov}`)
  const others = names(card.presentIds.filter((id) => id !== card.povId))
  if (others.length) lines.push(`Also in the scene: ${others.join(', ')}`)
  const where = card.locationId ? name(card.locationId) : null
  if (where) lines.push(`Where: ${where}`)
  const setsUp = names(card.setsUpIds ?? [])
  if (setsUp.length) lines.push(`Sets up: ${setsUp.join(', ')}`)
  const paysOff = names(card.paysOffIds ?? [])
  if (paysOff.length) lines.push(`Pays off: ${paysOff.join(', ')}`)

  const parts: string[] = []
  if (lines.length) parts.push(lines.join('\n'))
  const beats = card.beats.map((b) => b.trim()).filter(Boolean)
  if (beats.length) parts.push(`Beats, in order:\n${beats.map((b, i) => `${i + 1}. ${indentMore(b, '   ')}`).join('\n')}`)
  const shape: string[] = []
  if (clean(card.goal)) shape.push(`Goal: ${indentMore(card.goal)}`)
  if (clean(card.conflict)) shape.push(`Conflict: ${indentMore(card.conflict)}`)
  if (clean(card.outcome)) shape.push(`Outcome: ${indentMore(card.outcome)}`)
  if (clean(card.mood)) shape.push(`Mood: ${indentMore(card.mood)}`)
  const words = input.options.targetWords
  shape.push(words == null ? 'Length: as long as the scene needs' : `Length: about ${words.toLocaleString('en-GB')} words`)
  parts.push(shape.join('\n'))
  const aims = bringAboutLines(input, sel)
  if (aims.length) {
    parts.push(
      `What this scene should bring about (aims for this draft, not facts yet):\n${aims.map((a) => `- ${indentMore(a)}`).join('\n')}`
    )
  }
  if (clean(card.notes)) parts.push(`Notes from the author:\n${clean(card.notes)}`)
  if (clean(input.options.direction)) parts.push(`The author's direction for this draft:\n${clean(input.options.direction)}`)
  return parts.join('\n\n')
}

function bringAboutLines(input: ContextInput, sel: Selection): string[] {
  const name = (id: ID): string => sel.known.get(id)?.name ?? 'Someone'
  return (input.memory.bringAbout ?? []).map((c) => bringAboutLine(c, name)).filter((l): l is string => !!l)
}

/**
 * The point-of-view character: 0 the full profile and everything that has happened to them (their ties to
 * people not in the scene are block 11); 1 (short) the profile without backstory and the last 5 things that
 * happened; 2 the core of the profile and the last 3; 3 the least of it and the last 2. Every form
 * says what they know.
 */
function povText(e: EntryState, input: ContextInput, sel: Selection, level: 0 | 1 | 2 | 3): string {
  const known = input.memory.facts.filter((f) => f.knownBy.includes(e.id) && clean(f.fact))
  // In the smaller forms a long list of what they know (a long series) is cut to what matters here.
  const { kept, left } = level >= 2 ? someFacts(known, sel, level === 2 ? 12 : 6) : { kept: known, left: 0 }
  const knows = kept.map((f) => `- ${indentMore(sentence(clean(f.fact)))}`)
  if (left) knows.push(leftOutLine(left))
  const profile = level >= 2 ? coreProfile(e, level === 2 ? 'core' : 'least') : formatProfile(e, null, undefined, level === 1)
  // An empty profile still says who it is, so the block (and the Context tab's entry) is there.
  const parts = [profile || `${e.name}.`, happenedText(e, [undefined, 5, 3, 2][level])]
  if (knows.length) parts.push(`What ${e.name} knows:\n${knows.join('\n')}`)
  return parts.filter(Boolean).join('\n\n')
}

/**
 * The facts to give when space is tight: at most `cap`, those naming someone or something in this
 * briefing first, then the most recent, kept in their usual order; and how many were left out.
 */
function someFacts<T extends { fact: string }>(facts: T[], sel: Selection, cap: number): { kept: T[]; left: number } {
  if (facts.length <= cap) return { kept: facts, left: 0 }
  const names = [...sel.chosen.values()].flatMap(({ entry }) => [entry.name, ...(entry.aliases ?? [])])
  const keep = new Set<T>()
  const latestFirst = [...facts].reverse()
  for (const f of latestFirst) if (keep.size < cap && namedIn(haystack(f.fact), names)) keep.add(f)
  for (const f of latestFirst) if (keep.size < cap) keep.add(f)
  return { kept: facts.filter((f) => keep.has(f)), left: facts.length - keep.size }
}

const leftOutLine = (n: number): string => `(And ${n.toLocaleString('en-GB')} more, left out here to save space.)`

/**
 * Relationships among the people present, and the facts some of them know and others don't. The
 * short form, used only when there are many such facts (a long series), keeps the ones that matter here.
 */
function relationshipsText(input: ContextInput, sel: Selection): { text: string; short: string | null; entryIds: ID[] } {
  const people = [sel.pov, ...sel.present].filter((x): x is EntryState => !!x && x.kind === 'character')
  const ids = new Set(people.map((p) => p.id))
  const name = (id: ID): string => sel.known.get(id)?.name ?? 'Someone'
  const used = new Set<ID>()
  const rels = input.memory.relationships
    .filter((r) => ids.has(r.aId) && ids.has(r.bId) && r.aId !== r.bId)
    .map((r) => {
      used.add(r.aId)
      used.add(r.bId)
      return `- ${relationshipLine(r, name)}`
    })
  const facts: { fact: string; line: string }[] = []
  if (people.length > 1) {
    for (const f of input.memory.facts) {
      if (!clean(f.fact)) continue
      const knowers = people.filter((p) => f.knownBy.includes(p.id))
      if (!knowers.length || knowers.length === people.length) continue
      const not = people.filter((p) => !f.knownBy.includes(p.id))
      ;[...knowers, ...not].forEach((p) => used.add(p.id))
      const knowersText = knowers.length === 1 ? `${knowers[0].name} knows it` : `${joinAnd(knowers.map((p) => p.name))} know it`
      facts.push({
        fact: f.fact,
        line: `- ${joinAnd(not.map((p) => p.name))} ${not.length === 1 ? 'does' : 'do'} not know: ${sentence(clean(f.fact))} (${knowersText}.)`
      })
    }
  }
  const write = (list: string[]): string => {
    const parts: string[] = []
    if (rels.length) parts.push(rels.join('\n'))
    if (list.length) parts.push(`Facts some of them know and others don't:\n${list.join('\n')}`)
    return parts.join('\n\n')
  }
  const { kept, left } = someFacts(facts, sel, RELATIONSHIP_FACTS_SHORT)
  return {
    text: write(facts.map((f) => f.line)),
    short: left ? write([...kept.map((f) => f.line), leftOutLine(left)]) : null,
    entryIds: people.map((p) => p.id).filter((id) => used.has(id))
  }
}

/** Facts some of those present don't know, kept in block 6's short form. */
const RELATIONSHIP_FACTS_SHORT = 10

/** How a tie stands: the relationship, and in full how each of them feels ("Brother, estranged. Mara feels: Guilt."). */
function tieStanding(t: Tie, person: EntryState, short: boolean): string {
  const type = clean(t.rel.type) || 'linked'
  if (short) return type
  const feels = (id: ID): string => clean(id === t.rel.aId ? t.rel.aFeels : t.rel.bFeels)
  const parts = [sentence(type.charAt(0).toLocaleUpperCase() + type.slice(1))]
  for (const who of [person, t.other]) if (feels(who.id)) parts.push(`${who.name} feels: ${sentence(feels(who.id))}`)
  return parts.join(' ')
}

/**
 * Block 11: for each character present, the people they're tied to who aren't in the scene. 0 (full) each
 * tie's one line, where it stands and what has happened between them, newest first; 1 (short) names and
 * relationship only; 2 the closest few, names and relationship only.
 */
function tiesText(sel: Selection, level: 0 | 1 | 2): string {
  return sel.ties
    .map(({ person, ties }) => {
      const list = ties.slice(0, level === 2 ? TIES_FEWEST : level === 0 ? TIES_FULL.ties : undefined)
      if (level > 0) return `${person.name}: ${list.map((t) => `${t.other.name} (${tieStanding(t, person, true)})`).join('; ')}`
      const lines = list.map((t) => {
        const head = `- ${indentMore(`${sentence(oneLine(t.other))} ${tieStanding(t, person, false)}`)}`
        const history = t.history.slice(0, TIES_FULL.history).map((h) => `  - ${indentMore(sentence(h.text), '    ')}`)
        return history.length ? `${head}\n  Between them, newest first:\n${history.join('\n')}` : head
      })
      return `### ${person.name}\n${lines.join('\n')}`
    })
    .join(level > 0 ? '\n' : '\n\n')
}

/**
 * The order of this story's chapters, from the scene summaries and the finished chapters' summaries
 * (both oldest first). A chapter with no summary of its own (the one this scene is in, or one whose
 * summary isn't written yet) goes after the summarised chapters before it; a summarised chapter none
 * of whose scenes has a summary is taken to come before it.
 */
function chapterOrder(s: StorySoFar): ID[] {
  const out: ID[] = []
  const seen = new Set<ID>()
  const add = (id: ID): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  const told = s.chapters.map((c) => c.chapterId)
  const withScenes = new Set(s.scenes.map((x) => x.chapterId))
  let i = 0
  for (const sc of s.scenes) {
    const k = told.indexOf(sc.chapterId, i)
    if (k >= 0) {
      while (i <= k) add(told[i++])
    } else if (!seen.has(sc.chapterId)) {
      while (i < told.length && !withScenes.has(told[i])) add(told[i++])
      add(sc.chapterId)
    }
  }
  while (i < told.length) add(told[i++])
  return out
}

/**
 * How much of the story so far block 8 gives. 0 is the full form; 1 the short form (fewer scenes,
 * chapter level, series roll-ups); 2 to 4 keep only the most recent parts, so a model with little
 * room still learns what happened just before this scene rather than nothing at all.
 */
export const STORY_LEVELS = 5
/** At each level: how many of the most recent parts (a story, a chapter or a scene) are kept. */
const RECENT_PARTS = [Infinity, Infinity, 6, 2, 1]

/**
 * Block 8, oldest first. Summaries go in word for word, so the Context tab can find each one to edit it.
 * - Earlier stories on the line, one paragraph each ("Meanwhile" for side stories; a story the line
 *   cuts short says so). From level 1 a series roll-up stands in for the stories it covers.
 * - This story: each chapter by its summary, or by its scenes' summaries while it has none (the
 *   chapter this scene is in, say), so no earlier scene is skipped; then the last 5 scenes in detail
 *   (2 from level 1).
 * - The "Leads into" target, up to level 2.
 */
export function storySoFarText(s: StorySoFar, storyTitle: string, level: number | boolean = 0): string {
  const lv = typeof level === 'boolean' ? (level ? 1 : 0) : Math.max(0, Math.min(STORY_LEVELS - 1, level))
  const short = lv > 0
  type Part = { heading: string; text: string }
  const parts: Part[] = []
  const rolled = new Set<ID>()
  for (const st of s.stories) {
    if (!clean(st.text) || rolled.has(st.storyId)) continue
    // When space is tight, a series roll-up stands in for the stories it covers.
    const rollup = short ? s.series.find((r) => clean(r.text) && r.storyIds.includes(st.storyId)) : undefined
    if (rollup) {
      rollup.storyIds.forEach((id) => rolled.add(id))
      parts.push({ heading: rollup.name, text: clean(rollup.text) })
      continue
    }
    const heading = st.meanwhile ? `Meanwhile: ${st.title}` : st.cut ? `${st.title}, up to where this story starts` : st.title
    parts.push({ heading, text: clean(st.text) })
  }

  const scenes = s.scenes.filter((x) => clean(x.text))
  const recent = scenes.slice(-(short ? 2 : 5))
  const shown = new Set(recent.map((x) => x.sceneId))
  const told = new Map(s.chapters.filter((c) => clean(c.text)).map((c) => [c.chapterId, c]))
  const earlier = `Earlier in ${storyTitle || 'this story'}`
  for (const chapterId of chapterOrder(s)) {
    const own = scenes.filter((x) => x.chapterId === chapterId)
    const chapter = told.get(chapterId)
    if (chapter) {
      // A chapter is told by its own summary unless every one of its summarised scenes is shown.
      if (!own.length || own.some((x) => !shown.has(x.sceneId)))
        parts.push({ heading: earlier, text: `${chapter.label}: ${clean(chapter.text)}` })
    } else {
      for (const x of own) if (!shown.has(x.sceneId)) parts.push({ heading: earlier, text: `${x.label}: ${clean(x.text)}` })
    }
  }
  for (const x of recent) parts.push({ heading: 'Most recently', text: `${x.label}: ${clean(x.text)}` })

  const keep = RECENT_PARTS[lv]
  const kept = parts.slice(-keep)
  const out: string[] = []
  if (kept.length < parts.length) out.push('Only the most recent part of the story so far is given here, to save space.')
  // Parts under the same heading in a row go together.
  let i = 0
  while (i < kept.length) {
    const heading = kept[i].heading
    const texts: string[] = []
    while (i < kept.length && kept[i].heading === heading) texts.push(kept[i++].text)
    out.push(`### ${heading}\n${texts.join('\n\n')}`)
  }

  if (s.leadsInto && clean(s.leadsInto.text) && lv < 3) {
    const t = s.leadsInto.title
    out.push(
      `### Leads into ${t}\nThis story leads into ${t}. Below is how ${t} begins: a target to steer towards over the story, not events to mention or bring about in this scene.\n${clean(s.leadsInto.text)}`
    )
  }
  return out.join('\n\n')
}

function themesText(input: ContextInput): string {
  const lines: string[] = []
  const add = (label: string, v: string | undefined): void => {
    if (clean(v)) lines.push(`${label}: ${indentMore(v ?? '')}`)
  }
  add('Story premise', input.story.premise)
  add('Story themes', input.story.themes)
  add('Story tone', input.story.tone)
  add('Series themes', input.series?.themes)
  add('Series tone', input.series?.tone)
  add('World themes', input.world.themes)
  add('World tone', input.world.tone)
  return lines.join('\n')
}

/** The first sentence (or line) of a text. */
const firstSentence = (s: string): string => {
  const line = clean(s).split(/\r?\n/)[0] ?? ''
  const m = line.match(/^.*?[.!?…](?=\s|$)/)
  return (m ? m[0] : line).trim()
}

/** Block 10's short form: one line with the closest themes and tone (the story's, else the series', else the world's). */
function themesLine(input: ContextInput): string {
  const pick = (...vs: (string | undefined)[]): string => firstSentence(vs.find((v) => clean(v)) ?? '')
  const themes = pick(input.story.themes, input.series?.themes, input.world.themes)
  const tone = pick(input.story.tone, input.series?.tone, input.world.tone)
  const bits = [themes ? `Themes: ${sentence(themes)}` : '', tone ? `Tone: ${sentence(tone)}` : ''].filter(Boolean)
  return bits.length ? bits.join(' ') : sentence(firstSentence(input.story.premise))
}

const kindWord = (e: Entry): string => KIND_LABELS[e.kind]?.one.toLowerCase() ?? 'entry'

/** Builds every block that has something in it, in the order they are sent. */
export function buildBlocks(input: ContextInput, sel: Selection = selectEntries(input)): BlockDraft[] {
  const blocks: BlockDraft[] = []
  const label = (e: Entry): string | null => sel.chosen.get(e.id)?.label ?? null
  const add = (
    id: string,
    priority: number,
    title: string,
    text: string,
    short: string | null,
    entryIds: ID[],
    smaller: string[] = []
  ): void => {
    if (!text.trim()) return
    // Each form kept only when it is actually shorter than the one before.
    const forms = [text]
    for (const f of [short, ...smaller]) {
      if (f != null && f.trim() && f.length < forms[forms.length - 1].length) forms.push(f)
    }
    blocks.push({ id, priority, title, text, short: forms[1] ?? null, smaller: forms.slice(2), entryIds })
  }

  // 1 Instructions and style guide (short: the sample passage trimmed, one genre, the rules without the phrase
  // list). `add` keeps the short form only when it is actually shorter.
  add('instructions', 1, 'Instructions and style guide', instructionsText(input.style), instructionsText(input.style, { trimSample: true }), [])

  // 2 Scene card and direction (no short form).
  add('scene-card', 2, 'Scene card', sceneCardText(input, sel), null, [])

  // 3 The end of the previous scene (short: the last 200 words). From another story (this story's
  // first scene): titled and introduced as how that story ended, with this story's time gap.
  const prev = clean(input.memory.previous?.text)
  const other = previousStory(input)
  if (prev && other) {
    const what = other.ended
      ? `how ${other.title} ended. This story comes after it`
      : `where ${other.title} had got to when this story starts`
    const gap = other.timeGap ? ` Time since then: ${other.timeGap.replace(/\.$/, '')}.` : ''
    const lead = `This is ${what}.${gap}`
    const title = other.ended ? `How ${other.title} ended` : `Where ${other.title} had got to`
    add('previous-scene', 3, title, `${lead}\n\n${sceneTail(prev)}`, `${lead}\n\n${sceneTail(prev, SHORT_TAIL)}`, [])
  } else if (prev) add('previous-scene', 3, 'End of the previous scene', sceneTail(prev), sceneTail(prev, SHORT_TAIL), [])

  // 4 Point-of-view character (short: without backstory; smaller: the core of the profile, then the least of it).
  const pov = sel.pov
  if (pov) {
    add(
      'pov',
      4,
      `Point-of-view character: ${withLabel(pov.name, label(pov))}`,
      povText(pov, input, sel, 0),
      povText(pov, input, sel, 1),
      [pov.id],
      [povText(pov, input, sel, 2), povText(pov, input, sel, 3)]
    )
  }

  // 5 Other characters present (short: summary plus voice).
  const present = sel.present
  if (present.length) {
    const heading = (e: EntryState): string => `### ${withLabel(e.name, label(e))}`
    add(
      'present',
      5,
      present.length === 1 ? 'Also in the scene' : 'Others in the scene',
      present.map((e) => [formatProfile(e, heading(e)), happenedText(e)].filter(Boolean).join('\n\n')).join('\n\n'),
      present
        .map((e) => {
          const head = [heading(e), clean(e.summary) ? `In short: ${clean(e.summary)}` : ''].filter(Boolean).join('\n')
          return [head, ...fieldSections(e, ['voice'])].join('\n\n')
        })
        .join('\n\n'),
      present.map((e) => e.id)
    )
  }

  // 6 Relationships and who knows what. The spec gives it no short form ("these are short"); in a long
  //   series who-knows-what can run to many lines, so then a short form keeps the facts that matter
  //   here rather than the whole block, relationships included, being left out.
  const rel = relationshipsText(input, sel)
  add('relationships', 6, 'Relationships and who knows what', rel.text, rel.short, rel.entryIds)

  // 7 Where the scene happens, the places around it and the groups of those present.
  const where = sel.location
  if (where || sel.groups.length) {
    const full: string[] = []
    const short: string[] = []
    if (where) {
      const head = `### Where: ${withLabel(where.name, label(where))}`
      full.push([formatProfile(where, head), happenedText(where)].filter(Boolean).join('\n\n'))
      short.push([head, clean(where.summary) ? `In short: ${clean(where.summary)}` : ''].filter(Boolean).join('\n'))
    }
    if (sel.around.length) {
      const within = `It lies within:\n${sel.around.map((p) => `- ${oneLine(p)}`).join('\n')}`
      full.push(within)
      short.push(within)
    }
    if (sel.groups.length) {
      const name = (id: ID): string => sel.known.get(id)?.name ?? 'Someone'
      const list = sel.groups.map(({ group, ties }) => {
        const how = ties.map((t) => (t.type ? `${name(t.memberId)}: ${t.type}` : name(t.memberId))).join('; ')
        return `- ${oneLine(group, label(group) ?? '')}${how ? ` (${how})` : ''}`
      })
      const text = `Groups the people here belong to:\n${list.join('\n')}`
      full.push(text)
      short.push(text)
    }
    add('setting', 7, where ? 'Setting' : 'Groups', full.join('\n\n'), short.join('\n\n'), [
      ...(where ? [where.id] : []),
      ...sel.around.map((p) => p.id),
      ...sel.groups.map((g) => g.group.id)
    ])
  }

  // 7 The world's hard rules (short: one line each).
  if (sel.rules.length) {
    add(
      'world-rules',
      7,
      'World rules (never break these)',
      sel.rules
        .map((r) => [formatProfile(r, `### World rule: ${withLabel(r.name, label(r))}`), happenedText(r)].filter(Boolean).join('\n\n'))
        .join('\n\n'),
      sel.rules.map((r) => `- ${oneLine(r, label(r) ?? '')}`).join('\n'),
      sel.rules.map((r) => r.id)
    )
  }

  // 7 Plot threads on the card that are still open here (short: one line each).
  if (sel.threads.length) {
    const role = (t: Selection['threads'][number]): string =>
      [t.role === 'sets up' ? 'this scene sets it up' : 'this scene pays it off', label(t.entry)].filter(Boolean).join('; ')
    add(
      'threads',
      7,
      'Plot threads in this scene',
      sel.threads
        .map((t) => {
          const setUp = t.role === 'pays off' && clean(t.state?.setUp) ? `Set up in ${clean(t.state?.setUp)}.` : ''
          return [formatProfile(t.entry, `### ${t.entry.name} (${role(t)})`), setUp, happenedText(t.entry)].filter(Boolean).join('\n\n')
        })
        .join('\n\n'),
      sel.threads.map((t) => `- ${oneLine(t.entry, role(t))}`).join('\n'),
      sel.threads.map((t) => t.entry.id)
    )
  }

  // 8 The story so far (short: fewer scenes, chapter summaries, series roll-ups; smaller: only the most recent parts).
  const sofar = input.memory.storySoFar
  if (sofar) {
    const level = (n: number): string => storySoFarText(sofar, input.story.title, n)
    add(
      'story-so-far',
      8,
      'The story so far',
      level(0),
      level(1),
      [],
      Array.from({ length: STORY_LEVELS - 2 }, (_, i) => level(i + 2))
    )
  }

  // 9 Anything else named in the beats, notes or direction, and pins (short: one line each).
  if (sel.others.length) {
    const mentionedOnly = sel.others.every((e) => {
      const why = sel.chosen.get(e.id)?.why
      return why === WHY.beats || why === WHY.notes || why === WHY.direction
    })
    // A plot thread already paid off by this point says so, so the model doesn't write it as still open.
    const paidOff = (e: Entry): string => {
      const t = e.kind === 'thread' ? input.memory.threads.find((x) => x.entryId === e.id) : undefined
      return t?.status === 'resolved' ? `already paid off${clean(t.paidOff) ? ` in ${clean(t.paidOff)}` : ''}` : ''
    }
    const note = (e: Entry): string => [kindWord(e), paidOff(e), label(e)].filter(Boolean).join('; ')
    add(
      'mentioned',
      9,
      mentionedOnly ? 'Also mentioned' : 'Also relevant',
      sel.others
        .map((e) => {
          const head = `### ${e.name} (${note(e)})`
          // Lore and places are short, and their fields are the facts: send them whole.
          // Characters who aren't in the scene: who they are and how they look, not their whole inner life.
          const profile = e.kind === 'character' ? formatProfile(e, head, ['basics', 'looks']) : formatProfile(e, head)
          return [profile, happenedText(e, 3)].filter(Boolean).join('\n\n')
        })
        .join('\n\n'),
      sel.others.map((e) => `- ${oneLine(e, note(e))}`).join('\n'),
      sel.others.map((e) => e.id)
    )
  }

  // 10 Themes, tone and premise (short: one line).
  const themes = themesText(input)
  if (themes) add('themes', 10, 'Themes and tone', themes, themesLine(input), [])

  // 11 Ties to people not in this scene (short: names and relationship only; smaller: the closest few).
  if (sel.ties.length) {
    add(
      'ties',
      TIES_PRIORITY,
      'Ties to people not in this scene',
      tiesText(sel, 0),
      tiesText(sel, 1),
      [...new Set(sel.ties.flatMap((p) => p.ties.slice(0, TIES_FULL.ties).map((t) => t.other.id)))],
      [tiesText(sel, 2)]
    )
  }

  return blocks.sort((a, b) => sendRank(a) - sendRank(b))
}

/**
 * The order blocks are sent in. What stays the same across a story comes first,
 * so a provider can reuse it from one draft to the next; the story so far, the
 * end of the previous scene and the scene card (with Adam's direction) come
 * last, right above the closing instruction, where the model attends to them most.
 */
export const SEND_ORDER = [
  'instructions',
  'world-rules',
  'themes',
  'setting',
  'pov',
  'present',
  'relationships',
  'ties',
  'mentioned',
  'threads',
  'story-so-far',
  'previous-scene',
  'scene-card'
]
const sendRank = (b: Pick<BlockDraft, 'id'>): number => {
  const i = SEND_ORDER.indexOf(b.id)
  return i < 0 ? SEND_ORDER.length : i
}

/** Among blocks of the same priority, the later ones here are kept longest (shortened and dropped last). */
const KEEP_ORDER = ['threads', 'setting', 'world-rules']
const keepRank = (id: string): number => Math.max(0, KEEP_ORDER.indexOf(id))

/** How a block appears in the messages: block 1 as the system message, the others under a heading. */
export const blockAsSent = (b: Pick<BlockDraft, 'priority' | 'title' | 'text'>, text: string = b.text): string =>
  b.priority === 1 ? text : `## ${b.title}\n\n${text}`

/** Every entry in the briefing with why, for the Context tab, then the ones Adam kept out. */
function contextEntries(sel: Selection, blocks: BlockDraft[]): ContextEntry[] {
  const blockOf = new Map<ID, string>()
  for (const b of [...blocks].sort((x, y) => x.priority - y.priority)) {
    for (const id of b.entryIds) if (sel.chosen.has(id) && !blockOf.has(id)) blockOf.set(id, b.id)
  }
  const out: ContextEntry[] = [...blockOf].map(([id, blockId]) => {
    const c = sel.chosen.get(id)!
    return { entryId: id, name: c.entry.name, kind: c.entry.kind, blockId, why: c.why, pinned: c.pinned, hidden: false, label: c.label }
  })
  for (const h of sel.hidden) {
    out.push({
      entryId: h.entry.id,
      name: h.entry.name,
      kind: h.entry.kind,
      blockId: null,
      why: h.why,
      pinned: null,
      hidden: true,
      label: sel.label(h.entry.id)
    })
  }
  return out
}

/**
 * Milestone 4's additions to a draft's briefing. Variants and Beat by beat send the same briefing as
 * Generate, with their own closing instruction and, for a beat, the scene so far.
 */
export interface ContextExtras {
  /** Takes the place of the closing instruction ("Write the scene now..."); given what the usual one is made from. */
  final?: (o: FinalOptions) => string
  /**
   * Blocks sent after the scene card, right above the closing instruction, never shortened or dropped
   * (so keep them to a sensible size, such as the end of the scene so far).
   */
  extraBlocks?: { id: string; title: string; text: string }[]
}

export function prepareContext(input: ContextInput, extras: ContextExtras = {}): PreparedContext {
  const sel = selectEntries(input)
  const blocks = buildBlocks(input, sel)
  for (const b of extras.extraBlocks ?? []) {
    if (b.text.trim()) blocks.push({ id: b.id, priority: 2, title: b.title, text: b.text, short: null, smaller: [], entryIds: [] })
  }
  const targetWords = input.options.targetWords
  // Auto: room is kept for the longest scene Auto allows this model (finishContext may lower it).
  const autoMax = targetWords == null ? autoCeiling(input.maxOutput) : undefined
  const card = input.scene.card
  const base = {
    targetWords,
    autoMax,
    style: input.style,
    hasBeats: card.beats.some((b) => b.trim()),
    hasGoal: !!clean(card.goal),
    hasOutcome: !!clean(card.outcome),
    hasNotes: !!clean(card.notes),
    hasDirection: !!clean(input.options.direction),
    hasBringAbout: bringAboutLines(input, sel).length > 0,
    previousStory: previousStory(input),
    tone: [input.story.tone, input.series?.tone, input.world.tone].map((t) => clean(t)).find(Boolean) ?? ''
  }
  const final = extras.final ?? finalInstruction
  const finalsFor = (max: number | undefined): PreparedContext['finals'] => ({
    withPrevious: final({ ...base, autoMax: max, hasPrevious: true }),
    withoutPrevious: final({ ...base, autoMax: max, hasPrevious: false })
  })
  const finals = finalsFor(autoMax)
  return {
    blocks,
    modes: input.blockModes ?? {},
    finals,
    texts: [...blocks.flatMap((b) => formsOf(b).map((t) => blockAsSent(b, t))), finals.withPrevious, finals.withoutPrevious],
    contextLength: computeBudget(input.contextLength, targetWords).contextLength,
    targetWords,
    ...(autoMax != null ? { autoMax, autoFinals: (max: number) => finalsFor(max) } : {}),
    knows: input.memory.knows ?? '',
    entries: contextEntries(sel, blocks)
  }
}

const asMode = (m: unknown): BlockMode => (m === 'full' || m === 'short' ? m : 'auto')

/**
 * Measures and fits the briefing (see the top of this file), then builds the messages.
 * `rawCounts` are plain token counts for `prepared.texts`, in order.
 */
export function finishContext(prepared: PreparedContext, rawCounts: number[]): ContextPreview {
  let at = 0
  const state = prepared.blocks.map((b) => {
    const mode = asMode(prepared.modes[b.id])
    const forms = formsOf(b)
    const tokensAt = forms.map(() => withAllowance(rawCounts[at++] ?? 0))
    const hasShort = forms.length > 1
    // Levels of shortening: 0 is the full form, 1 the short form, then any smaller ones.
    const min = hasShort && mode === 'short' ? 1 : 0
    const max = mode === 'full' ? 0 : forms.length - 1
    return { b, mode, forms, tokensAt, hasShort, min, max, level: min, dropped: false }
  })
  type State = (typeof state)[number]
  const tokens = (s: State): number => s.tokensAt[s.level]
  const finalTokens = {
    withPrevious: withAllowance(rawCounts[at] ?? 0),
    withoutPrevious: withAllowance(rawCounts[at + 1] ?? 0)
  }
  // With Auto, room is kept for the longest scene Auto allows (autoMax).
  let budget = computeBudget(prepared.contextLength, prepared.targetWords ?? prepared.autoMax ?? null)
  const fits = (): boolean => measure() <= budget.available
  const auto = prepared.targetWords == null && prepared.autoMax != null
  let ceiling = prepared.autoMax ?? AUTO_LENGTH.max

  function measure(): number {
    const hasPrev = state.some((s) => s.b.id === 'previous-scene' && !s.dropped)
    const sent = state.filter((s) => !s.dropped).reduce((sum, s) => sum + tokens(s), 0)
    return sent + (hasPrev ? finalTokens.withPrevious : finalTokens.withoutPrevious) + MESSAGE_OVERHEAD * 2
  }

  // Least important first; within a priority, hard rules go last.
  const leastFirst = [...state].sort((a, b) => b.b.priority - a.b.priority || keepRank(a.b.id) - keepRank(b.b.id))
  const droppable = leastFirst.filter((s) => s.b.priority >= 3)
  const shortenable = [...droppable, ...state.filter((x) => x.b.priority === 1)]

  /** Fits the briefing to the budget, starting again from every block as Adam set it. */
  function fit(): void {
    for (const s of state) {
      s.level = s.min
      s.dropped = false
    }
    // 1. Short forms, from the bottom up (10 to 3, then block 1). Blocks Adam wants in full stay full.
    for (const s of shortenable) {
      if (fits()) break
      if (s.level === 0 && s.max >= 1) s.level = 1
    }
    // 1b. Still too long: the ties to people not in the scene (block 11) go before any block is made smaller
    //     than its short form, so a small model keeps what happened just before rather than a list of names.
    const lowest = (s: State): boolean => s.b.priority >= TIES_PRIORITY && s.mode !== 'full'
    for (const s of droppable) {
      if (fits()) break
      if (lowest(s)) s.dropped = true
    }
    // 2. Still too long with everything short: the smaller forms some blocks have (the story so far
    //    down to its most recent parts, the point-of-view character down to the core of the profile),
    //    a step at a time, from the bottom up.
    for (let more = true; more && !fits(); ) {
      more = false
      for (const s of shortenable) {
        if (fits()) break
        if (s.level >= 1 && s.level < s.max) {
          s.level++
          more = true
        }
      }
    }
    // 3. Then whole blocks, from 10 up to 3. Blocks Adam wants in full go only as a last resort.
    for (const s of [...droppable.filter((x) => x.mode !== 'full'), ...droppable.filter((x) => x.mode === 'full')]) {
      if (fits()) break
      s.dropped = true
    }
    // 4. Dropping one big block (often the previous scene) can free room for smaller, less
    //    important ones dropped before it. Put those back, most important first, while it fits.
    for (const s of [...droppable].reverse()) {
      if (!s.dropped || lowest(s)) continue
      s.dropped = false
      if (!fits()) s.dropped = true
    }
    // 5. Then give back the longest form that fits again to each block, most important first.
    for (const s of [...leastFirst].reverse()) {
      if (s.dropped) continue
      const was = s.level
      for (let l = s.min; l < was; l++) {
        s.level = l
        if (fits()) break
        s.level = was
      }
    }

    // 6. Block 11 back, if it fits once everything more important has its room.
    for (const s of droppable) {
      if (!s.dropped || !lowest(s)) continue
      s.dropped = false
      if (fits()) continue
      const was = s.level
      for (s.level = Math.max(was, 1); s.level <= s.max && !fits(); s.level++);
      if (s.level > s.max || !fits()) {
        s.level = was
        s.dropped = true
      }
    }
  }
  // Auto, when the briefing as Adam set it leaves too little room for autoMax words: the briefing comes
  // first, so Auto's ceiling comes down to what fits beside it (to no less than a typical scene) before
  // any block is shortened.
  if (auto) {
    const over = lengthTooLong({ ...budget, used: measure() })
    if (over) {
      ceiling = Math.max(Math.min(AUTO_LENGTH.typical, ceiling), Math.min(ceiling, over.maxWords))
      budget = computeBudget(prepared.contextLength, ceiling)
    }
  }
  fit()

  // Auto, when even the shortest briefing leaves too little room for autoMax words: Auto's ceiling comes
  // down to what fits (never under AUTO_LENGTH.min; below that the draft says "too long", as for a set
  // length), and the briefing is fitted again to the smaller reply room. The closing instruction says the
  // new ceiling; its tokens were counted with the old one (the same number of digits, near enough).
  let finals = prepared.finals
  if (auto) {
    const over = lengthTooLong({ ...budget, used: measure() })
    if (over) {
      ceiling = Math.max(AUTO_LENGTH.min, Math.min(ceiling, over.maxWords))
      budget = computeBudget(prepared.contextLength, ceiling)
      fit()
    }
    if (ceiling !== prepared.autoMax && prepared.autoFinals) finals = prepared.autoFinals(ceiling)
  }

  const blocks: ContextBlock[] = state.map((s) => ({
    id: s.b.id,
    priority: s.b.priority,
    title: s.b.title,
    text: s.forms[s.level],
    tokens: tokens(s),
    entryIds: s.b.entryIds,
    dropped: s.dropped,
    short: s.level > 0,
    hasShort: s.hasShort,
    mode: s.mode
  }))
  const sent = blocks.filter((b) => !b.dropped)
  const hasPrev = sent.some((b) => b.id === 'previous-scene')
  const system = sent.find((b) => b.priority === 1)?.text ?? ''
  const user = [
    ...sent.filter((b) => b.priority > 1).map((b) => blockAsSent(b)),
    hasPrev ? finals.withPrevious : finals.withoutPrevious
  ].join('\n\n')
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
  return { blocks, budget: { ...budget, used: measure() }, messages, knows: prepared.knows, entries: prepared.entries }
}

/** The whole assembly with a synchronous token counter (used by tests and as a fallback). */
export function assembleContext(input: ContextInput, countRaw: (text: string) => number): ContextPreview {
  const prepared = prepareContext(input)
  return finishContext(prepared, prepared.texts.map(countRaw))
}

/** Entry ids actually sent (blocks not dropped), first appearance first. */
export function sentEntryIds(blocks: ContextBlock[]): ID[] {
  const out: ID[] = []
  const seen = new Set<ID>()
  for (const b of blocks) {
    if (b.dropped) continue
    for (const id of b.entryIds) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** The version (updatedAt) of each entry actually sent, for the draft's record. */
export function sentEntryVersions(memory: Pick<SceneMemory, 'entries' | 'elsewhere'>, blocks: ContextBlock[]): Map<ID, string> {
  const all = new Map<ID, Entry>([
    ...memory.elsewhere.map((x) => [x.entry.id, x.entry] as const),
    ...memory.entries.map((e) => [e.id, e] as const)
  ])
  const out = new Map<ID, string>()
  for (const id of sentEntryIds(blocks)) {
    const e = all.get(id)
    if (e) out.set(id, e.updatedAt)
  }
  return out
}
