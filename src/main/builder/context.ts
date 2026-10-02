// Reads what the builder's model is told about the world from the open world's database: the style
// guide in effect (Adam's preferences, the world's guide and the story's), the world's themes and
// tone, its lore (rules never to break first), groups, characters and, for a place or an item, the
// others of its kind. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID, WritingPrefs } from '@shared/types'
import type { BuilderKind } from '@shared/contracts/builder'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import type { BriefEntry, WorldBrief } from './prompts'

type DB = Database.Database

/** The most of each list the model is told about (the prompt is fitted to the model as well). */
const MAX_LIST = 120

const brief = (e: Entry): BriefEntry => ({
  id: e.id,
  name: e.name,
  aliases: e.aliases,
  summary: e.summary,
  hardRule: e.kind === 'lore' && e.hardRule,
  rule: e.kind === 'lore' && e.hardRule ? (e.fields.rules ?? '') : undefined,
  updatedAt: e.updatedAt
})

export function gatherWorld(db: DB, o: { kind: BuilderKind; excludeId: ID | null; storyId?: ID | null; prefs: WritingPrefs }): WorldBrief {
  const all = repo.listEntries(db).filter((e) => e.id !== o.excludeId)
  const of = (kind: Entry['kind']): BriefEntry[] =>
    all
      .filter((e) => e.kind === kind)
      .slice(0, MAX_LIST)
      .map(brief)
  let story: Awaited<ReturnType<typeof repo.getStory>> | null = null
  if (o.storyId) {
    try {
      story = repo.getStory(db, o.storyId)
    } catch {
      // Deleted meanwhile: the world's own style guide applies.
    }
  }
  const lore = all
    .filter((e) => e.kind === 'lore')
    .sort((a, b) => Number(b.hardRule) - Number(a.hardRule))
    .slice(0, MAX_LIST)
    .map(brief)
  return {
    world: { themes: repo.getMeta(db, 'themes') ?? '', tone: repo.getMeta(db, 'tone') ?? '' },
    story: story ? { title: story.title, premise: story.premise } : null,
    style: effectiveStyle(o.prefs, repo.getWorldStyle(db), story?.style ?? {}),
    lore,
    groups: of('group'),
    characters: of('character'),
    same: o.kind === 'place' || o.kind === 'item' ? of(o.kind) : []
  }
}
