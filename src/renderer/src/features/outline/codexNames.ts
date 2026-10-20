// A suggestion's names (2026-10-19: its point of view, characters, location and plot threads, edited in its Edit form)
// as the codex pickers show them. The AI names people, places and threads in words; a name the codex has is shown as its
// page (picked from the same list as on a scene card), and any other stands for itself, to be made when the suggestion is
// kept (outline/chapterCard.ts addMissing, outline/structure.ts withThreads). Picking gives names back, as the suggestion
// holds them. No React, so it is unit-tested.

import type { Entry, EntryKind, ID } from '@shared/types'
import { normalizeName } from '@/features/world/entryLogic'

/** The id a name the codex doesn't have goes by in a picker. */
const NEW = 'new:'

/** A picker's stand-in for a name the codex doesn't have. */
function standIn(kind: EntryKind, name: string): Entry {
  return {
    id: `${NEW}${name}`,
    kind,
    name,
    aliases: [],
    summary: '',
    description: '',
    tags: [],
    notes: '',
    fields: {},
    parentId: null,
    hardRule: false,
    origin: 'ai',
    fieldOrigins: {},
    originStoryId: null,
    originSceneId: null,
    originStart: false,
    byHand: false,
    image: null,
    createdAt: '',
    updatedAt: ''
  }
}

export const standInFor = standIn

/** A place's name with the place it is in, as the AI writes a room ("Kitchen, Venn House"). */
const within = (p: Entry, byId: Map<ID, Entry>): string | null => {
  const parent = p.parentId ? byId.get(p.parentId) : null
  return parent ? `${p.name.trim()}, ${parent.name.trim()}` : null
}

/** The codex's pages of this kind, for a picker: a place in another place shows where it is under its name. */
export function codexOf(kind: EntryKind, entries: Entry[]): Entry[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  return entries
    .filter((e) => e.kind === kind && e.name.trim())
    .map((e) => {
      const path = kind === 'place' ? within(e, byId) : null
      return path ? { ...e, summary: `In ${byId.get(e.parentId!)!.name.trim()}${e.summary ? `. ${e.summary}` : ''}` } : e
    })
}

/** The codex page a name means: by its name or another name (a room also by "Kitchen, Venn House"); null for none. */
export function pageFor(name: string, codex: Entry[], all: Entry[] = codex): Entry | null {
  const n = normalizeName(name)
  if (!n) return null
  const byId = new Map(all.map((e) => [e.id, e]))
  return (
    codex.find((e) => normalizeName(e.name) === n || e.aliases.some((a) => normalizeName(a) === n)) ??
    codex.find((e) => {
      const path = within(e, byId)
      return !!path && normalizeName(path) === n
    }) ??
    null
  )
}

/**
 * What a picker shows for these names: the ids picked (a page's, else a stand-in's) and the list to pick from (the
 * codex's pages, then a stand-in for each name it doesn't have).
 */
export function picksFor(kind: EntryKind, names: string[], codex: Entry[], all: Entry[] = codex): { ids: ID[]; options: Entry[] } {
  const ids: ID[] = []
  const extra: Entry[] = []
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim()
    if (!name) continue
    const page = pageFor(name, codex, all)
    const id = page ? page.id : `${NEW}${name}`
    if (ids.includes(id)) continue
    ids.push(id)
    if (!page) extra.push(standIn(kind, name))
  }
  return { ids, options: [...codex, ...extra] }
}

/**
 * The names picked, as the suggestion holds them: a page's name (a place's as "Kitchen, Venn House" when another place
 * has its name, so it is found again), else the stand-in's own words.
 */
export function namesFor(ids: ID[], codex: Entry[], all: Entry[] = codex): string[] {
  const byId = new Map(all.map((e) => [e.id, e]))
  const out: string[] = []
  for (const id of ids) {
    let name: string
    if (id.startsWith(NEW)) name = id.slice(NEW.length)
    else {
      const e = codex.find((x) => x.id === id) ?? byId.get(id)
      if (!e) continue
      const twin = e.kind === 'place' && codex.some((x) => x.id !== e.id && normalizeName(x.name) === normalizeName(e.name))
      name = (twin && within(e, byId)) || e.name.trim()
    }
    if (name && !out.some((n) => normalizeName(n) === normalizeName(name))) out.push(name)
  }
  return out
}
