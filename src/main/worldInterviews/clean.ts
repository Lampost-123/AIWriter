// A suggestion as the window sends it back to be kept (with Adam's changes), checked and tidied before anything is
// saved: known kinds and parts only, text of a sensible size. Pure.

import type { EntryKind } from '@shared/types'
import type { TopicEntry, TopicLink } from '@shared/contracts/worldInterviews'
import { fieldKeysOf } from './prompts'

const KINDS: EntryKind[] = ['character', 'place', 'group', 'item', 'lore', 'event']

const line = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const ref = (v: unknown): { entryId: string; name: string; kind: EntryKind } | null => {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  const entryId = line(o?.entryId, 80)
  return o && entryId ? { entryId, name: line(o.name, 200), kind: (KINDS.includes(o.kind as EntryKind) ? o.kind : 'character') as EntryKind } : null
}

/** A page to keep, or null when it has no name or no kind AI Write knows. */
export function cleanEntry(v: unknown): TopicEntry | null {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  if (!o || !KINDS.includes(o.kind as EntryKind)) return null
  const kind = o.kind as EntryKind
  const name = line(o.name, 120)
  if (!name) return null
  const keys = new Set(fieldKeysOf(kind))
  const raw = o.fields && typeof o.fields === 'object' ? (o.fields as Record<string, unknown>) : {}
  const fields = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => keys.has(k))
      .map(([k, x]) => [k, text(x, 6000)] as const)
      .filter(([, x]) => x)
  )
  const ex = o.existing && typeof o.existing === 'object' ? (o.existing as Record<string, unknown>) : null
  const existingId = line(ex?.entryId, 80)
  return {
    key: line(o.key, 80),
    kind,
    name,
    aliases: (Array.isArray(o.aliases) ? o.aliases : []).map((a) => line(a, 80)).filter(Boolean).slice(0, 8),
    summary: line(o.summary, 600),
    fields,
    in: kind === 'place' ? line(o.in, 120) : '',
    rule: kind === 'lore' && o.rule === true,
    existing: existingId ? { entryId: existingId, name: line(ex?.name, 200) || name } : null,
    his: (Array.isArray(o.his) ? o.his : []).filter((k): k is string => typeof k === 'string').slice(0, 40)
  }
}

/** A link to keep, or null when it doesn't say what it links. */
export function cleanLink(v: unknown): TopicLink | null {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  const link = o?.link === 'inside' || o?.link === 'detail' || o?.link === 'relationship' ? o.link : null
  const from = ref(o?.from)
  if (!o || !link || !from) return null
  const to = ref(o.to)
  if (link !== 'detail' && !to) return null
  const field = line(o.field, 60)
  const words = text(o.text, 6000)
  if (link === 'detail' && (!fieldKeysOf(from.kind).includes(field) || !words)) return null
  const type = line(o.type, 80)
  if (link === 'relationship' && !type) return null
  return {
    key: line(o.key, 80),
    link,
    from,
    to: link === 'detail' ? null : to,
    type,
    feels: line(o.feels, 300),
    otherFeels: line(o.otherFeels, 300),
    field: link === 'detail' ? field : '',
    text: link === 'detail' ? words : '',
    why: line(o.why, 300)
  }
}
