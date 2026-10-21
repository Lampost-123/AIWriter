// How the look-ups (index.ts) word what they find: compact plain text, short unless more is asked for. Pure.

import type { EntryState, FactState, ID, RelationshipState } from '@shared/types'
import { FIELD_GROUPS, KIND_LABELS } from '@shared/fields'

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** A line kept to `most` characters, cut at a word with an ellipsis. */
export function clip(line: string, most: number): string {
  const l = clean(line)
  if (l.length <= most) return l
  const cut = l.slice(0, most - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > most / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}…`
}

/**
 * A text as one line in whole sentences, up to `most` characters (2026-10-19: what_happened gave each scene's gist cut
 * part-way): as many whole sentences as fit; a first sentence longer than that cut at a word, with "…". Words after the
 * last full stop are left out when a whole sentence comes before them (a summary that stops part-way through one).
 */
export function wholeSentences(text: string, most: number): string {
  const t = clean(text)
  if (!t) return ''
  const sentences = t.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [t]
  const ends = (s: string): boolean => /[.!?…]["'”’)\]]*$/.test(s)
  const whole = sentences.filter(ends)
  const list = whole.length ? sentences.slice(0, sentences.findLastIndex(ends) + 1) : sentences
  let out = ''
  for (const s of list) {
    const next = out ? `${out} ${s}` : s
    if (next.length > most) break
    out = next
  }
  if (out) return !whole.length && !ends(out) ? `${out.replace(/[\s,;:]+$/, '')}…` : out
  return clip(list[0], most)
}

/** The first `most` lines, with a note of how many more there are. */
export function firstLines(lines: readonly string[], most: number, more = 'more'): string[] {
  if (lines.length <= most) return [...lines]
  return [...lines.slice(0, most), `(${lines.length - most} ${more} not shown: ask again with "full": true for all of them)`]
}

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/**
 * About `most` words of a scene's text, whole paragraphs where it can: around the first place `near` is found (its words,
 * whatever their case or punctuation), else the start or the end. Null when `near` isn't in the text.
 */
export function passageOf(text: string, o: { near?: string; part?: 'start' | 'end'; most: number }): string | null {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!paras.length) return ''
  const fold = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  let at: number
  if (clean(o.near)) {
    const want = fold(o.near!)
    at = paras.findIndex((p) => fold(p).includes(want))
    if (at < 0) return null
  } else at = o.part === 'start' ? 0 : paras.length - 1
  // Whole paragraphs out from the one found, the nearest first, while they fit. Each side stops at the first that
  // doesn't, so the passage never runs on across a paragraph left out.
  const take = new Set([at])
  let count = words(paras[at]).length
  const sides = o.near ? [-1, 1] : o.part === 'start' ? [1] : [-1]
  const stopped = new Set<number>()
  for (let d = 1; d < paras.length; d++) {
    for (const side of sides) {
      const i = at + side * d
      if (stopped.has(side) || i < 0 || i >= paras.length) continue
      const n = words(paras[i]).length
      if (count + n > o.most) {
        stopped.add(side)
        continue
      }
      take.add(i)
      count += n
    }
  }
  const out = [...take].sort((a, b) => a - b).map((i) => paras[i])
  // One paragraph longer than the room: its words around what was found (or its start or end).
  if (out.length === 1 && count > o.most) {
    const w = words(out[0])
    if (o.near) {
      const first = fold(o.near).split(' ')[0]
      const hit = Math.max(0, w.findIndex((x) => fold(x) === first))
      const from = Math.max(0, Math.min(w.length - o.most, hit - Math.floor(o.most / 3)))
      return `${from > 0 ? '… ' : ''}${w.slice(from, from + o.most).join(' ')}${from + o.most < w.length ? ' …' : ''}`
    }
    return o.part === 'start' ? `${w.slice(0, o.most).join(' ')} …` : `… ${w.slice(-o.most).join(' ')}`
  }
  return out.join('\n\n')
}

/** What get_entry needs besides the entry: who knows what and the ties at this scene, and everyone's names. */
export interface EntryAbout {
  facts: readonly FactState[]
  relationships: readonly RelationshipState[]
  names: ReadonlyMap<ID, string>
}

/**
 * An entry as it stands at this scene: its kind and other names, its summary, the fields it has, what has happened to it
 * (the latest few), what it knows and its ties. Short: the summary, a handful of fields, the last 3 changes, 3 facts
 * known, 3 ties; full: all of it, with the description.
 */
export function entryText(e: EntryState, about: EntryAbout, full: boolean): string {
  const lines: string[] = [`${e.name} (${KIND_LABELS[e.kind]?.one.toLowerCase() ?? e.kind}), as things stand at this scene`]
  const aka = (e.aliases ?? []).map(clean).filter(Boolean)
  if (aka.length) lines.push(`Also called: ${aka.join(', ')}`)
  if (clean(e.summary)) lines.push(`In short: ${clean(e.summary)}`)
  if (full && clean(e.description)) lines.push(`Description: ${clip(e.description, 1200)}`)
  const fields = (FIELD_GROUPS[e.kind] ?? [])
    .flatMap((g) => g.fields)
    .filter((f) => clean(e.fields?.[f.key]))
    .map((f) => `${f.label}: ${clip(e.fields[f.key], full ? 400 : 160)}`)
  lines.push(...(full ? fields : fields.slice(0, 6)))
  const happened = (e.happened ?? []).filter((h) => clean(h.note))
  const recent = full ? happened : happened.slice(-3)
  if (recent.length) {
    lines.push(
      `What has happened to ${e.kind === 'character' ? 'them' : 'it'}${recent.length < happened.length ? ' lately' : ''}:`,
      ...recent.map((h) => `- ${clip(h.note, 200)}${clean(h.where) ? ` (${clean(h.where)})` : ''}`)
    )
  }
  const knows = about.facts.filter((f) => f.knownBy.includes(e.id) && clean(f.fact)).map((f) => `- ${clip(f.fact, 200)}`)
  if (knows.length) lines.push(`What ${e.name} knows:`, ...(full ? knows : firstLines(knows, 3)))
  const ties = about.relationships
    .filter((r) => r.aId === e.id || r.bId === e.id)
    .map((r) => {
      const other = about.names.get(r.aId === e.id ? r.bId : r.aId)
      if (!other) return ''
      const feels = clean(r.aId === e.id ? r.aFeels : r.bFeels)
      return `- ${other}: ${clean(r.type) || 'linked'}${feels ? `; feels ${feels}` : ''}`
    })
    .filter(Boolean)
  if (ties.length) lines.push('Ties:', ...(full ? ties : firstLines(ties, 3)))
  return lines.join('\n')
}
