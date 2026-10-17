// The Story builder's codex list (contracts/storyBuilder.ts CodexItem): read from the AI's JSON (the World builder's
// first-look shape, with a cast role on characters), with Adam's own entries kept first and exactly as he wrote them,
// and what the world has already marked, so the build adds to those pages. Also the list as the AI is told it when it
// is talked over, and as the World builder is given it. No Electron imports.

import type { BriefEntry, CodexItem } from '@shared/contracts/storyBuilder'
import type { WorldPlanItem } from '@shared/contracts/worldBuilder'
import type { EntryKind } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { parseLenient, str } from '../keeper/json'
import { BUILD_KINDS, hasOverviewLists, overviewItems } from '../worldBuilder/parse'
import { bareName, findMatch, sharesName, type Named } from '../worldBuilder/names'
import { cleanCodexItem } from './brief'

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The JSON object in a reply (whole, or after a line of answer), or null. */
export function replyObject(text: string): unknown {
  const whole = parseLenient(text)
  if (whole.ok) return whole.value
  const at = text.indexOf('{')
  if (at < 0) return null
  const rest = parseLenient(text.slice(at))
  return rest.ok ? rest.value : null
}

/** Each character's cast role, by bare name, from a reply's "characters" list. */
function rolesOf(value: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!isObject(value)) return out
  const key = Object.keys(value).find((k) => /^(characters?|people|cast)$/i.test(k))
  const list = key ? value[key] : null
  if (!Array.isArray(list)) return out
  for (const c of list) {
    if (!isObject(c)) continue
    const role = str(c.role ?? c.castRole ?? c.recipeRole, 160).trim()
    const name = str(c.name, 120)
    if (role && name && !/^(none|n\/a|-)$/i.test(role)) out.set(bareName(name), role)
  }
  return out
}

/** One list with each thing once (the same name and kind twice is one; the first wins, gaining the other's names). */
function dedupe(items: CodexItem[]): CodexItem[] {
  const out: CodexItem[] = []
  for (const it of items) {
    const same = out.find((x) => x.kind === it.kind && sharesName(x, it))
    if (!same) {
      out.push(it)
      continue
    }
    for (const a of [it.name, ...it.aliases]) {
      if (bareName(a) !== bareName(same.name) && !same.aliases.some((y) => bareName(y) === bareName(a))) same.aliases.push(a)
    }
    same.about ||= it.about
    same.role ||= it.role
    same.mine ||= it.mine
  }
  return out
}

/** Gives every item a key no other has, keeping those it has. */
export function withKeys(items: CodexItem[]): CodexItem[] {
  const seen = new Set<string>()
  let n = 0
  return items.map((it) => {
    let key = it.key && !seen.has(it.key) ? it.key : ''
    while (!key || seen.has(key)) key = `c${Date.now().toString(36)}${n++}`
    seen.add(key)
    return { ...it, key }
  })
}

/**
 * The list made whole: Adam's own entries (from the brief) are on it, marked `mine`, with his names and words (one the
 * AI left out goes first); each item already in the world is marked with that page.
 */
export function settleList(items: CodexItem[], mine: BriefEntry[], world: Named[]): CodexItem[] {
  const own = mine.filter((e) => e.name.trim())
  let list = dedupe(items)
  const missing: CodexItem[] = []
  for (const e of own) {
    const want = { kind: e.kind, name: e.name.trim(), aliases: [] as string[] }
    const hit = list.find((x) => x.kind === e.kind && sharesName(x, want))
    if (hit) {
      hit.mine = true
      hit.name = want.name
      if (e.about.trim() && !hit.about.includes(e.about.trim())) hit.about = hit.about ? `${e.about.trim()} ${hit.about}` : e.about.trim()
    } else {
      missing.push({ key: '', kind: e.kind, name: want.name, aliases: [], about: e.about.trim(), in: '', rule: false, when: '', role: '', mine: true, on: true, existing: null })
    }
  }
  list = [...missing, ...list]
  const ids = new Set<string>()
  list = list.map((it) => {
    const hit = findMatch(it, world, ids)
    if (hit) ids.add(hit.id)
    return { ...it, existing: hit && hit.kind === it.kind ? { entryId: hit.id, name: hit.name } : null }
  })
  // Kinds in the order a build lays them out, Adam's own first in each.
  const order = (k: EntryKind): number => BUILD_KINDS.indexOf(k)
  list.sort((a, b) => order(a.kind) - order(b.kind) || Number(b.mine) - Number(a.mine))
  return withKeys(list)
}

/** The codex list from a reply (null when the reply has none of the lists). Each item ticked, with no key yet. */
export function readCodex(text: string): CodexItem[] | null {
  const value = replyObject(text)
  if (!hasOverviewLists(value)) return null
  const roles = rolesOf(value)
  return overviewItems(value).map((p) => ({
    key: '',
    kind: p.kind,
    name: p.name,
    aliases: p.aliases,
    about: p.about,
    in: p.in,
    rule: p.rule,
    when: p.when,
    role: p.kind === 'character' ? (roles.get(bareName(p.name)) ?? '') : '',
    mine: false,
    on: true,
    existing: null
  }))
}

/** A revised list keeps each unchanged item's key, tick and marks (the same name and kind is the same item). */
export function carryOver(revised: CodexItem[], before: CodexItem[]): CodexItem[] {
  return revised.map((it) => {
    const was = before.find((x) => x.kind === it.kind && sharesName(x, it))
    return was ? { ...it, key: was.key, mine: was.mine, on: was.on || it.on, existing: was.existing } : it
  })
}

/** One item from a redo's reply, keeping the item's key, kind and marks. Null when the reply has no usable item. */
export function readRedo(text: string, item: CodexItem): CodexItem | null {
  const value = replyObject(text)
  if (!isObject(value)) return null
  const next = cleanCodexItem({ ...value, kind: item.kind, key: item.key, mine: item.mine, on: item.on, existing: item.existing })
  if (!next) return null
  // Adam's own keep their name.
  return item.mine ? { ...next, name: item.name } : next
}

const LIST_KEYS: Record<EntryKind, string> = {
  character: 'characters',
  place: 'places',
  group: 'groups',
  item: 'items',
  lore: 'lore',
  event: 'events',
  thread: 'threads',
  glossary: 'glossary'
}

/** The list as the AI is told it: one JSON object of lists, with each item's marks. */
export function codexJson(items: CodexItem[]): string {
  const out: Record<string, unknown[]> = {}
  for (const kind of BUILD_KINDS) out[LIST_KEYS[kind]] = []
  for (const it of items) {
    const o: Record<string, unknown> = { name: it.name }
    if (it.aliases.length) o.aliases = it.aliases
    o.about = it.about
    if (it.kind === 'place') o.in = it.in
    if (it.kind === 'lore') o.rule = it.rule
    if (it.kind === 'event') o.when = it.when
    if (it.kind === 'character' && it.role) o.role = it.role
    if (it.mine) o.mine = true
    if (!it.on) o.off = true
    if (it.existing) o.inWorld = true
    out[LIST_KEYS[it.kind]].push(o)
  }
  return JSON.stringify(out, null, 1)
}

/** One item as the redo is told it. */
export const itemJson = (it: CodexItem): string =>
  JSON.stringify({ kind: it.kind, name: it.name, aliases: it.aliases, about: it.about, in: it.in, rule: it.rule, when: it.when, role: it.role })

/** The ticked items as the World builder's plan. */
export const planOf = (items: CodexItem[]): WorldPlanItem[] =>
  items
    .filter((it) => it.on)
    .map((it) => ({ kind: it.kind, name: it.name, aliases: it.aliases, about: it.about, in: it.in, rule: it.rule, when: it.when, scene: '' }))

/**
 * The summary the World builder lays the list out from: the idea and style first, then every ticked item in a line of
 * its own that starts with its name (so each profile finds what is said about it).
 */
export function buildSummary(idea: string, style: string, recipeCast: string, items: CodexItem[]): string {
  const lines = [idea.trim()]
  if (style.trim()) lines.push(`The story's style:\n${style.trim()}`)
  if (recipeCast.trim()) lines.push(`Cast roles from the recipe the story follows:\n${recipeCast.trim()}`)
  const byKind = BUILD_KINDS.map((kind) => {
    const list = items.filter((it) => it.on && it.kind === kind)
    if (!list.length) return ''
    const rows = list.map((it) => {
      const extra = [
        it.aliases.length ? `also called ${it.aliases.join(', ')}` : '',
        it.in ? `inside ${it.in}` : '',
        it.when ? `when: ${it.when}` : '',
        it.role ? `plays the recipe's ${it.role}` : '',
        it.mine ? "the author's own" : ''
      ].filter(Boolean)
      const about = it.about.trim().replace(/\s+/g, ' ')
      return `${it.name}${extra.length ? ` (${extra.join('; ')})` : ''}: ${about || KIND_LABELS[kind].one}${/[.!?]$/.test(about) ? '' : '.'}`
    })
    return `${KIND_LABELS[kind].many}:\n${rows.join('\n')}`
  }).filter(Boolean)
  if (byKind.length) lines.push(`Everything planned for the story:\n\n${byKind.join('\n\n')}`)
  return lines.join('\n\n')
}
