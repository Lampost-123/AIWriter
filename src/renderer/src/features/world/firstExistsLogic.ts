// Pure helpers for where an entry first appears, as its page shows and changes it (milestone 3):
// the line in plain words, the places Adam can add, and the points to send after adding or removing
// one. Tested in firstExistsLogic.test.ts.

import type { ExistsKind, ID } from '@shared/types'
import type { FirstExists, FirstExistsInput } from '@shared/contracts/entryViews'
import { normalizeName } from './entryLogic'

type Point = Pick<FirstExistsInput, 'kind' | 'storyId' | 'sceneId'>

/** "a", "a and b", "a, b and c". */
function joinAnd(list: string[]): string {
  if (list.length < 2) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/**
 * "First appears: the start of Book 1"; with several, "First appears: the start of Mara's Youth and
 * Book 3, Ch 1, Sc 2". Null with none.
 */
export function firstAppearsText(points: Pick<FirstExists, 'label'>[]): string | null {
  const labels = points.map((p) => p.label).filter((l, i, all) => l && all.indexOf(l) === i)
  return labels.length ? `First appears: ${joinAnd(labels)}` : null
}

/** One place, whatever kind of story start it is: a story's start counts once, before or after its start-of-story changes. */
export function pointKey(p: Point): string {
  if (p.kind === 'world') return 'world'
  if (p.kind === 'scene') return `scene:${p.sceneId}`
  return `start:${p.storyId}`
}

/** The points to send, each as Adam's: once he changes where it first appears, none is worked out again for him. */
export const asAdams = (points: Point[]): FirstExistsInput[] =>
  points.map((p) => ({ kind: p.kind, storyId: p.storyId ?? null, sceneId: p.sceneId ?? null, byHand: true }))

/** The points with one more (nothing changes when it is already there). */
export function withPoint(points: Point[], add: Point): FirstExistsInput[] | null {
  if (points.some((p) => pointKey(p) === pointKey(add))) return null
  return asAdams([...points, add])
}

/** The points without one; null when it is the only one left (somewhere it first appears is always kept). */
export function withoutPoint(points: (Point & { id: ID })[], id: ID): FirstExistsInput[] | null {
  const rest = points.filter((p) => p.id !== id)
  if (!rest.length || rest.length === points.length) return null
  return asAdams(rest)
}

/** The points as they were, for Undo: exactly as they were, Adam's or not. */
export const asTheyWere = (points: FirstExists[]): FirstExistsInput[] =>
  points.map((p) => ({ kind: p.kind, storyId: p.storyId, sceneId: p.sceneId, byHand: p.byHand }))

export interface PlaceChoice {
  key: string
  label: string
  /** A quieter second part (a scene's title). */
  sub?: string
  point: Point
}

export interface SceneChoice {
  id: ID
  storyId: ID
  /** "Book 1, Ch 2, Sc 3". */
  label: string
  title?: string
}

const START: ExistsKind = 'story-pre'

/**
 * The places Adam can add, for what he has typed: the beginning of the world, each story's start,
 * then scenes in reading order. Places already chosen are left out. At most `limit`, with how many more match.
 */
export function placeChoices(
  stories: { id: ID; title: string }[],
  scenes: SceneChoice[],
  chosen: Point[],
  query: string,
  limit = 30
): { list: PlaceChoice[]; more: number } {
  const have = new Set(chosen.map(pointKey))
  const all: PlaceChoice[] = [
    { key: 'world', label: 'The beginning of the world', point: { kind: 'world' as const, storyId: null, sceneId: null } },
    ...stories.map((s) => ({
      key: `start:${s.id}`,
      label: `The start of ${s.title.trim() || 'Untitled story'}`,
      point: { kind: START, storyId: s.id, sceneId: null }
    })),
    ...scenes.map((s) => ({
      key: `scene:${s.id}`,
      label: s.label,
      sub: s.title?.trim() || undefined,
      point: { kind: 'scene' as const, storyId: s.storyId, sceneId: s.id }
    }))
  ].filter((c) => !have.has(c.key))
  // Matched as a phrase, commas aside, so "ch 1 sc 2" finds that scene and not Ch 2, Sc 1.
  const flat = (t: string): string => normalizeName(t.replace(/,/g, ' '))
  const q = flat(query)
  const matches = q ? all.filter((c) => flat(`${c.label} ${c.sub ?? ''}`).includes(q)) : all
  return { list: matches.slice(0, limit), more: Math.max(0, matches.length - limit) }
}

/** "at the start of Book 2", "at the beginning of the world", "in Book 1, Ch 2, Sc 3". */
const placed = (label: string): string => (/^the /.test(label) ? `at ${label}` : `in ${label}`)

/** What a change of first-exists points did, for its toast: "Mara now first appears at the start of Book 2." */
export function changedText(name: string, after: Pick<FirstExists, 'label'>[]): string {
  const labels = after.map((p) => p.label).filter((l, i, all) => l && all.indexOf(l) === i)
  const who = name.trim() || 'It'
  if (!labels.length) return `Changed where ${who} first appears.`
  return `${who} now first appears ${joinAnd(labels.map(placed))}.`
}
