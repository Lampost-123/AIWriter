// Merging a card read again (a chat's change applied, its Undo, a chapter card change) with the panel's copy, field by
// field (chat truth R7): the fields Adam typed in and hasn't had written keep his values, every other field takes the
// card read again, so neither his typing nor the change made elsewhere is lost. Pure; tested in cardMerge.test.ts.
import type { SceneCard } from '@shared/types'
import { beatsToStore } from './beats'

/** A card's parts by the names on screen. Plot threads aren't named: a link the memory made is kept by the save too. */
const FIELD_NAMES: Record<string, string> = {
  povId: 'Point of view',
  presentIds: 'Characters present',
  locationId: 'Location',
  when: 'When',
  beats: 'Beats',
  goal: 'Goal',
  conflict: 'Conflict',
  outcome: 'Outcome',
  mood: 'Mood or tone',
  targetWords: 'Length',
  lengthSet: 'Length',
  totalWords: 'Length of the chapter',
  notes: 'Notes for the AI'
}

const listWords = (words: string[]): string => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)

/** The toast when a change made elsewhere gave way to Adam's typing in the same part; null when none did. */
export function keptTypingNote(fields: readonly PropertyKey[]): string | null {
  const names = [...new Set(fields.map((k) => FIELD_NAMES[String(k)]).filter((n): n is string => !!n))]
  return names.length ? `${listWords(names)} changed somewhere else while you were typing there. What you typed was kept.` : null
}

/** Whether two values of one field say the same thing. */
export type SameField<T> = (key: keyof T, a: unknown, b: unknown) => boolean

const sameJson = (_key: unknown, a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/** A scene card's fields compared as the card is stored: beats tidied, blank ones left out. */
export const sameCardField: SameField<SceneCard> = (key, a, b) =>
  key === 'beats' && Array.isArray(a) && Array.isArray(b) ? sameJson(key, beatsToStore(a), beatsToStore(b)) : sameJson(key, a, b)

const keysOf = <T extends object>(...cards: T[]): (keyof T)[] => [...new Set(cards.flatMap((c) => Object.keys(c) as (keyof T)[]))]

/** The fields where two copies of a card differ. */
export function changedFields<T extends object>(a: T, b: T, same: SameField<T> = sameJson): (keyof T)[] {
  return keysOf(a, b).filter((k) => !same(k, a[k], b[k]))
}

/**
 * The card to show (and write): `fresh` (the newest read) with the `touched` fields taken from `mine`. A field that
 * already says the same in both keeps `mine`'s value, and when nothing differs `mine` itself comes back, so the panel
 * neither redraws nor saves for a re-read of what it holds.
 */
export function mergeCard<T extends object>(fresh: T, mine: T, touched: ReadonlySet<keyof T>, same: SameField<T> = sameJson): T {
  let out: T | null = null
  for (const k of keysOf(fresh, mine)) {
    if (touched.has(k) || same(k, fresh[k], mine[k])) continue
    out ??= { ...mine }
    if (k in fresh) out[k] = fresh[k]
    else delete out[k]
  }
  return out ?? mine
}

/** The fields changed elsewhere (`prev` to `fresh`) that gave way to what Adam is typing there. */
export function lostToTyping<T extends object>(prev: T, fresh: T, mine: T, touched: ReadonlySet<keyof T>, same: SameField<T> = sameJson): (keyof T)[] {
  return [...touched].filter((k) => !same(k, prev[k], fresh[k]) && !same(k, fresh[k], mine[k]))
}

/**
 * What a card form knows about its card between reads and writes: the newest copy read from disk (or written), and the
 * fields Adam changed that aren't written yet. The scene card panel keeps one; it never writes a field Adam didn't touch
 * from a copy older than the newest read.
 */
export class CardSync<T extends object> {
  private fresh: T | null = null
  private touched = new Set<keyof T>()

  constructor(private readonly same: SameField<T> = sameJson) {}

  /** True once the first read is in (start). */
  get started(): boolean {
    return this.fresh !== null
  }

  /** Changes of Adam's not written yet. */
  get typing(): boolean {
    return this.touched.size > 0
  }

  /** The first read. `draft` is a copy kept from before that wasn't confirmed written: where it differs, it is Adam's. */
  start(fresh: T, draft: T | null): T {
    this.fresh = fresh
    this.touched = new Set(draft ? changedFields(fresh, draft, this.same) : [])
    return draft ?? fresh
  }

  /** Adam changed the card on screen. */
  edited(before: T, after: T): void {
    for (const k of changedFields(before, after, this.same)) this.touched.add(k)
  }

  /** The card read again: what to show (`mine` itself when nothing differs) and the changes that gave way to typing. */
  read(fresh: T, mine: T): { card: T; lost: (keyof T)[] } {
    const prev = this.fresh
    this.fresh = fresh
    return {
      card: mergeCard(fresh, mine, this.touched, this.same),
      lost: prev ? lostToTyping(prev, fresh, mine, this.touched, this.same) : []
    }
  }

  /** What to write for the copy `c`: Adam's fields from it, every other one from the newest read. */
  toWrite(c: T): T {
    return this.fresh ? mergeCard(this.fresh, c, this.touched, this.same) : c
  }

  /** A write landed and `saved` is on disk; `all` when it held every change of Adam's so far. */
  written(saved: T, all: boolean): void {
    this.fresh = saved
    if (all) this.touched = new Set()
  }
}
