// Turning what the AI suggested into suggestions Adam can keep: each page matched to what the world has (a page it
// has already is offered only for its empty parts, or not at all when it has them), the parts in his own words marked
// his; each link matched to two live pages, and left out when the world has it already, when it can't be made (a place
// already inside another, a part already written) or when it names a page that isn't there. Reads the database.

import type Database from 'better-sqlite3'
import type { Entry, EntryKind, ID } from '@shared/types'
import type { TopicEntry, TopicLink } from '@shared/contracts/worldInterviews'
import * as repo from '../db/repo'
import { entryNames } from '../db/worldBuilder'
import { hisWordsIn } from '../builder/profile'
import { bareName, findMatch } from '../worldBuilder/names'
import type { RawEntry, RawLink } from './parse'
import { CONNECT_KINDS, linkedPairs } from './context'
import { fieldKeysOf, TOPIC_FIELDS } from './prompts'

type DB = Database.Database

/** The most suggestions shown from one reply. */
export const ENTRIES_MOST = 12
export const LINKS_MOST = 16

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The pages suggested for a topic, settled against the world. `answers`: Adam's answers, to tell his words. */
export function settleEntries(db: DB, kind: EntryKind, raw: RawEntry[], answers: string): TopicEntry[] {
  const names = entryNames(db)
  const his = hisWordsIn(answers)
  const allowed = new Set(TOPIC_FIELDS[kind] ?? fieldKeysOf(kind))
  const seen = new Set<string>()
  const out: TopicEntry[] = []
  for (const r of raw) {
    const name = oneLine(r.name)
    const bare = bareName(name)
    if (!bare || seen.has(bare)) continue
    seen.add(bare)
    let fields = Object.fromEntries(Object.entries(r.fields).filter(([k, v]) => allowed.has(k) && v.trim()))
    let summary = oneLine(r.summary)
    const hit = findMatch({ kind, name, aliases: r.aliases }, names)
    let existing: TopicEntry['existing'] = null
    if (hit && hit.kind === kind) {
      // A page the world has: only what it is missing.
      const page = repo.getEntries(db, [hit.id])[0]
      if (!page) continue
      existing = { entryId: page.id, name: page.name }
      fields = Object.fromEntries(Object.entries(fields).filter(([k]) => !(page.fields[k] ?? '').trim()))
      if (page.summary.trim()) summary = ''
      const inside = kind === 'place' && r.in && !page.parentId
      if (!summary && !Object.keys(fields).length && !inside) continue
    }
    const values: Record<string, string> = { name, summary, ...fields }
    out.push({
      key: `e${out.length + 1}-${bare.replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
      kind,
      name: existing?.name ?? name,
      aliases: existing ? [] : r.aliases,
      summary,
      fields,
      in: kind === 'place' ? oneLine(r.in) : '',
      rule: kind === 'lore' && r.rule,
      existing,
      his: Object.entries(values)
        .filter(([, v]) => v && his(v))
        .map(([k]) => k)
    })
    if (out.length >= ENTRIES_MOST) break
  }
  return out
}

/** True when `place` is `inside` itself, or one of the places inside it (putting it there would make a loop). */
function wouldLoop(byId: Map<ID, Entry>, place: ID, inside: ID): boolean {
  let at: ID | null = inside
  for (let i = 0; at && i < 64; i++) {
    if (at === place) return true
    at = byId.get(at)?.parentId ?? null
  }
  return false
}

/** The links suggested by the connections interview, settled against the world. */
export function settleLinks(db: DB, raw: RawLink[]): TopicLink[] {
  const pages = repo.listEntries(db).filter((e) => e.name.trim())
  const byId = new Map(pages.map((e) => [e.id, e]))
  const names = entryNames(db).filter((n) => byId.has(n.id))
  const find = (name: string): Entry | null => {
    const want = oneLine(name)
    if (!want) return null
    for (const kind of CONNECT_KINDS) {
      const hit = findMatch({ kind, name: want, aliases: [] }, names)
      if (hit && bareName(hit.name) === bareName(want)) return byId.get(hit.id) ?? null
    }
    for (const kind of CONNECT_KINDS) {
      const hit = findMatch({ kind, name: want, aliases: [] }, names)
      if (hit) return byId.get(hit.id) ?? null
    }
    return null
  }
  const pairs = linkedPairs(db)
  const parentsSet = new Map<ID, ID>()
  const filled = new Set<string>()
  const out: TopicLink[] = []
  const ref = (e: Entry) => ({ entryId: e.id, name: e.name, kind: e.kind })
  for (const r of raw) {
    const from = find(r.from)
    if (!from) continue
    const base = { key: `l${out.length + 1}`, from: ref(from), type: '', feels: '', otherFeels: '', field: '', text: '', why: oneLine(r.why) }
    if (r.link === 'detail') {
      const keys = fieldKeysOf(from.kind)
      const field = keys.find((k) => k.toLowerCase() === r.field.toLowerCase().replace(/[\s_-]/g, ''))
      const text = r.text.trim()
      const at = `${from.id}|${field}`
      if (!field || !text || (from.fields[field] ?? '').trim() || filled.has(at)) continue
      filled.add(at)
      out.push({ ...base, link: 'detail', to: null, field, text })
    } else {
      const to = find(r.to)
      if (!to || to.id === from.id) continue
      if (r.link === 'inside') {
        if (from.kind !== 'place' || to.kind !== 'place' || from.parentId || parentsSet.has(from.id) || wouldLoop(byId, from.id, to.id)) continue
        parentsSet.set(from.id, to.id)
        out.push({ ...base, link: 'inside', to: ref(to), type: 'inside' })
      } else {
        const pair = [from.id, to.id].sort().join('|')
        if (pairs.has(pair) || !r.type.trim()) continue
        pairs.add(pair)
        const people = from.kind === 'character' && to.kind === 'character'
        out.push({ ...base, link: 'relationship', to: ref(to), type: oneLine(r.type), feels: people ? r.feels : '', otherFeels: people ? r.otherFeels : '' })
      }
    }
    if (out.length >= LINKS_MOST) break
  }
  return out.map((l, i) => ({ ...l, key: `l${i + 1}-${l.link}` }))
}
