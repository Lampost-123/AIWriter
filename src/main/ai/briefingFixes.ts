// What the writer is told, put right where the memory as kept says more than holds now (the writer lab's bridge reviews,
// 2026-10-08: each found in a real writer request). Small pure helpers: nothing here touches the memory or the stage as
// kept, only what the writer, the plan and the check are told.
//   a. How someone is placed, after they move (clearStalePlacing): the stage keeps each field until a reading gives it
//      again, so a move that says nothing of posture leaves the old one ("riding, hands in his armpits" in the parlour).
//   b. Usual looks that no longer hold (freshLooks, pastProfile): a profile's "typical clothing" and "how they move" are
//      set once ("bandage round his head", gone since Ch 3), and its relative times read wrong later ("swore this day").
//   i. People and places off the scene (offScene, linkedPlaces; after Adam's Holodeck): a person the scene's own words
//      don't name gets one line, not a card; a place not linked to where the scene happens is left out.

import type { Entry, EntryState, ID } from '@shared/types'
import { clothesOf, sourceKey, type CharacterState, type StateSources } from '@shared/continuity'
import { isOff } from '@shared/stageItems'

const plain = (s: string | null | undefined): string =>
  (s ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

// ---------- a. How someone is placed, after they move ----------

/**
 * Where a value's words are in the scene's own words: their place, -1 for words from an older scene (before anything
 * here), null when that can't be told (no words kept, or words not found).
 */
function placeOf(from: { quote?: string; sceneId?: string } | undefined, sceneId: ID, words: string): number | null {
  if (!from) return null
  if (from.sceneId && from.sceneId !== sceneId) return -1
  const q = plain(from.quote)
  if (!q) return null
  const at = words.indexOf(q.length > 60 ? q.slice(0, 60) : q)
  return at >= 0 ? at : null
}

/**
 * A person on the stage with how they are placed, who they touch and who they see or hear cleared when where they are
 * changed after those were last said (Ash "riding, hands in his armpits" in the inn's parlour, and "sitting on the
 * settle... looking at Wren" once he had gone out to the stable). Told by the words each value comes from: `where` from
 * this scene's words (found in `words`, the scene so far), and a value whose words are from an older scene, or come
 * before where's in this one, no longer holds. Values whose words can't be placed are kept.
 */
export function clearStalePlacing(c: CharacterState, said: StateSources | undefined, sceneId: ID, words: string): CharacterState {
  if (!said) return c
  const text = plain(words)
  const whereFrom = said[sourceKey(c.name, 'where')]
  const w = placeOf(whereFrom, sceneId, text)
  if (w == null || w < 0) return c
  const out: CharacterState = { ...c }
  for (const f of ['posture', 'touching', 'sees'] as const) {
    if (!out[f]) continue
    const from = said[sourceKey(c.name, f)]
    if (from?.quote && plain(from.quote) === plain(whereFrom?.quote)) continue
    const p = placeOf(from, sceneId, text)
    if (p === -1 || (p != null && p < w)) out[f] = ''
  }
  return out
}

// ---------- b. A profile's usual looks that no longer hold ----------

/** Things worn or bound on that a profile's usual looks may name. */
const GEAR = /\b(boots?|shoes?|coat|cloak|oilskin|hat|hood|gloves?|stockings?|shawl|scarf|apron|belt|bandages?|sling|dressing|splint|jumper|shirt|jacket|cap|bonnet|veil|mask|spectacles)\b/gi
/** Looks fields that name what someone has on, and how they go about. */
export const LOOK_KEYS = ['clothing', 'movement'] as const

const single = (w: string): string => w.toLowerCase().replace(/s$/, '')

/** True when a note says the thing came off or is gone ("bandage gone; wound closed", "took his hat off"). */
function saysGone(note: string, noun: string): boolean {
  const n = `${noun}s?`
  return (
    new RegExp(`\\b${n}\\b[^.;:]{0,12}?\\b(?:gone|off|removed|lost|taken off|came off|cut away|unwound)\\b(?!\\s+(?:from|to|grey|yellow|down|up|over|tight|dry))`, 'i').test(note) ||
    new RegExp(`\\b(?:took|takes|taken|pulled|unwound|removed|lost|threw|cut)\\b[^.;:]{0,25}\\b${n}\\b[^.;:]{0,10}\\b(?:off|away)\\b`, 'i').test(note) ||
    new RegExp(`\\b(?:no longer|without)\\b[^.;:]{0,15}\\b${n}\\b`, 'i').test(note)
  )
}

/**
 * The pieces of a usual-looks value ("coat mended in several colours; hat back; bandage round his head") that no longer
 * hold: each names something worn that the stage now has off ("boots off, on the hearthstone"), or that the last thing
 * that happened to them naming it says is gone ("bandage gone; wound closed", after the value was set).
 */
export function staleLookPieces(value: string, stage: CharacterState | null, happened: EntryState['happened'], setWhere?: string): string[] {
  // What the stage has off, by its main word ("left boot" is a boot), and any gear its name names.
  const off = new Set(
    clothesOf(stage)
      .filter((p) => isOff(p.state))
      .flatMap((p) => [single(p.name.trim().split(/\s+/).pop() ?? ''), ...[...p.name.matchAll(GEAR)].map((m) => single(m[1]))])
      .filter((w) => w.length >= 3)
  )
  const setAt = setWhere ? happened.map((h) => h.where).lastIndexOf(setWhere) : -1
  const wordsOf = (s: string): string[] => (s.toLowerCase().match(/[a-z]+/g) ?? []).map(single)
  return value
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter(
      (piece) =>
        wordsOf(piece).some((w) => off.has(w)) ||
        [...piece.matchAll(GEAR)].some((m) => {
          const noun = single(m[1])
          const last = happened.map((h, i) => ({ h, i })).filter(({ h }) => new RegExp(`\\b${noun}s?\\b`, 'i').test(h.note)).pop()
          return !!last && last.i > setAt && saysGone(last.h.note, noun)
        })
    )
}

/**
 * An entry with its usual looks put right for this moment (Ash's "bandage round his head", gone since Ch 3; Wren's
 * "boots squelching" while her boots dry on the hearth): a stale piece of what they usually wear is left out; how they
 * move, when it names anything stale, is left out whole. The entry as kept is unchanged.
 */
export function freshLooks<E extends EntryState>(e: E, stage: CharacterState | null): E {
  if (e.kind !== 'character' || !e.fields) return e
  let fields: Record<string, string> | null = null
  for (const k of LOOK_KEYS) {
    const v = (e.fields[k] ?? '').trim()
    if (!v) continue
    const stale = staleLookPieces(v, stage, e.happened ?? [], e.changedWhere?.[k])
    if (!stale.length) continue
    fields ??= { ...e.fields }
    fields[k] =
      k === 'movement'
        ? ''
        : v
            .split(/;\s*/)
            .map((p) => p.trim())
            .filter((p) => p && !stale.includes(p))
            .join('; ')
  }
  return fields ? { ...e, fields } : e
}

/**
 * Relative times in a profile's lines, told later, made past ("swore this day before Magistrate Ide", days on): "this
 * day" becomes "that day", "tomorrow" "the next day", and so on. Not the voice fields.
 */
export function pastTimes(text: string): string {
  return text
    .replace(/\bthis (day|morning|afternoon|evening|night)\b/gi, (_m, w: string) => `that ${w}`)
    .replace(/\btoday\b/gi, 'that day')
    .replace(/\btonight\b/gi, 'that night')
    .replace(/\btomorrow\b/gi, 'the next day')
    .replace(/\byesterday\b/gi, 'the day before')
}

const TIME_KEYS = ['habits', 'origin', 'pastEvents', 'secrets', 'motivation', 'wants', 'needs']

/** An entry with the relative times in its profile's own lines made past (pastTimes). */
export function pastProfile<E extends EntryState>(e: E): E {
  if (e.kind !== 'character' || !e.fields) return e
  let fields: Record<string, string> | null = null
  for (const k of TIME_KEYS) {
    const v = e.fields[k]
    if (!v) continue
    const now = pastTimes(v)
    if (now === v) continue
    fields ??= { ...e.fields }
    fields[k] = now
  }
  return fields ? { ...e, fields } : e
}

// ---------- i. Who and what is off the scene ----------

/**
 * The entries named for a draft (Also relevant, Also in mind) sorted as Adam's Holodeck does: a person gets a whole card
 * only when the scene's own words name them (the card, the direction, the scene so far), else one line; a place only
 * when it is linked to the scene (where it happens, a place it lies within, a place within it) or the scene's own words
 * name it, else it is left out. Everything else as it was.
 */
export function offScene<E extends Pick<Entry, 'id' | 'kind'>>(
  list: E[],
  o: { named: (e: E) => boolean; linked: ReadonlySet<ID> }
): { full: E[]; offstage: E[]; dropped: E[] } {
  const out = { full: [] as E[], offstage: [] as E[], dropped: [] as E[] }
  for (const e of list) {
    if (e.kind === 'character') (o.named(e) ? out.full : out.offstage).push(e)
    else if (e.kind === 'place') (o.linked.has(e.id) || o.named(e) ? out.full : out.dropped).push(e)
    else out.full.push(e)
  }
  return out
}

/** The places linked to where a scene happens: the place, those it lies within, and those within it. */
export function linkedPlaces(locationId: ID | null | undefined, entries: Pick<Entry, 'id' | 'kind' | 'parentId'>[]): Set<ID> {
  const out = new Set<ID>()
  if (!locationId) return out
  const byId = new Map(entries.map((e) => [e.id, e]))
  let at: ID | null | undefined = locationId
  while (at && !out.has(at)) {
    out.add(at)
    at = byId.get(at)?.parentId
  }
  for (const e of entries) if (e.kind === 'place' && e.parentId === locationId) out.add(e.id)
  return out
}

/** What heads the one-line people off the scene. */
export const OFFSTAGE_LEAD = 'Not in this scene (one line each; if the direction brings one in, keep to this):'
