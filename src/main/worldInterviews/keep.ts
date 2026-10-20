// Keep, for the interviews by topic: one suggested page made (or, for a page the world has, only its empty parts
// filled), or one link made (a relationship, a place put inside another, words for an empty part of a page). Saved as
// the World builder saves (worldBuilder/save.ts): the parts in Adam's words his, the rest drafted by AI, true from the
// beginning of the world or the story's start, one line in What changed in a run of its own, marked as from an
// interview. Undo is undoWorldBuild(runId). Also what each topic has kept, read back from those lines, so the topics
// show which are done after a restart. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import type { InterviewProgress, InterviewTopic, TopicEntry, TopicKept, TopicKeepRequest, TopicLink } from '@shared/contracts/worldInterviews'
import { INTERVIEW_TOPICS } from '@shared/contracts/worldInterviews'
import type { BuilderValues } from '@shared/contracts/builder'
import * as repo from '../db/repo'
import { entryNames, entryState, interviewLines } from '../db/worldBuilder'
import { UserError } from '../util'
import { bareName, findMatch } from '../worldBuilder/names'
import { fillField, finishWriter, newWriter, saveEntry, saveInside, saveInto, saveRelationship, type Source, type Writer } from '../worldBuilder/save'
import { cleanEntry, cleanLink } from './clean'
import { topicOf } from './jobs'
import { storyOf } from './context'
import { fieldKeysOf } from './prompts'

type DB = Database.Database

const NO_TOTALS = { providerId: null, modelId: null, promptTokens: null, completionTokens: null, cost: null, generationIds: [] }

const source = (topic: InterviewTopic, what: string): Source => ({ fingerprint: `interview:${topic}:${bareName(what)}`, words: what, quote: '' })

/** A live page, or a plain-words error when it is gone. */
function live(db: DB, id: ID, name: string): Entry {
  const e = entryState(db, id) === 'live' ? repo.getEntries(db, [id])[0] : null
  if (!e) throw new UserError(`“${name}” isn’t in your world any more, so this can’t be kept.`, 'gone')
  return e
}

/** Runs one Keep in a writer of its own; its run ends with it. */
function keeping<T>(db: DB, storyId: ID | null, topic: InterviewTopic, f: (w: Writer) => T): { w: Writer; out: T } {
  const w = newWriter(db, storyId)
  w.via = { topic, where: storyId ?? '' }
  try {
    const out = f(w)
    finishWriter(w, 'done', null, NO_TOTALS)
    return { w, out }
  } catch (e) {
    finishWriter(w, 'failed', e instanceof Error ? e.message : String(e), NO_TOTALS)
    throw e
  }
}

function keepEntry(db: DB, storyId: ID | null, topic: InterviewTopic, s: TopicEntry): TopicKept {
  const values: BuilderValues = { name: s.name, summary: s.summary, ...s.fields }
  if (s.aliases.length && !s.existing) values.aliases = s.aliases.join(', ')
  const profile = { values, his: s.his.filter((k) => k in values) }
  const src = source(topic, s.name)
  const parent = s.kind === 'place' && s.in ? findMatch({ kind: 'place', name: s.in, aliases: [] }, entryNames(db)) : null
  const parentId = parent && parent.kind === 'place' ? parent.id : null
  // The page the suggestion was for, else one of the same name made meanwhile (kept twice, or by hand): filled in, never made twice.
  const into =
    s.existing && entryState(db, s.existing.entryId) === 'live'
      ? s.existing.entryId
      : (() => {
          const hit = findMatch({ kind: s.kind, name: s.name, aliases: s.aliases }, entryNames(db))
          return hit && hit.kind === s.kind ? hit.id : null
        })()
  const { w, out } = keeping(db, storyId, topic, (w) => {
    if (into) {
      const done = saveInto(w, { entryId: into, kind: s.kind, planned: s.name, profile, parentId: parentId !== into ? parentId : null, source: src })
      if (!done) throw new UserError(`“${s.name}” already has all of that, so nothing was changed.`, 'nothing-new')
      return done.entry
    }
    const made = saveEntry(w, { kind: s.kind, planned: s.name, profile, parentId, hardRule: s.rule, involved: [], source: src })
    if (!made) throw new UserError('Give it a name first.', 'no-name')
    return made.entry
  })
  return { runId: w.runId!, entryId: out.id, name: out.name }
}

function keepLink(db: DB, storyId: ID | null, topic: InterviewTopic, l: TopicLink): TopicKept {
  const from = live(db, l.from.entryId, l.from.name)
  const to = l.to ? live(db, l.to.entryId, l.to.name) : null
  const src = source(topic, `${from.name} ${l.link} ${to?.name ?? l.field}`)
  const { w } = keeping(db, storyId, topic, (w) => {
    if (l.link === 'inside') {
      if (!to || from.kind !== 'place' || to.kind !== 'place') throw new UserError('Only a place can be put inside another place.')
      if (!saveInside(w, from, to, src)) {
        const now = from.parentId ? repo.getEntries(db, [from.parentId])[0]?.name : null
        throw new UserError(now ? `“${from.name}” is already inside ${now}.` : `“${from.name}” can’t go inside itself.`, 'nothing-new')
      }
    } else if (l.link === 'detail') {
      if (!fieldKeysOf(from.kind).includes(l.field)) throw new UserError('Something went wrong. Please try again.')
      if (!fillField(w, from.id, l.field, l.text, src)) throw new UserError(`“${from.name}” already has words there, so nothing was changed.`, 'nothing-new')
    } else {
      if (!to) throw new UserError('Something went wrong. Please try again.')
      saveRelationship(w, { from, to, type: l.type, feels: l.feels, otherFeels: l.otherFeels, source: src })
    }
  })
  return { runId: w.runId!, entryId: from.id, name: from.name }
}

/** Keeps one suggestion (contracts/worldInterviews.ts keepTopicSuggestion), in one transaction. */
export function keepSuggestion(db: DB, input: TopicKeepRequest): TopicKept {
  const topic = topicOf(input?.topic)
  const storyId = typeof input?.storyId === 'string' && input.storyId && storyOf(db, input.storyId) ? input.storyId : null
  const entry = input?.entry ? cleanEntry(input.entry) : null
  const link = input?.link ? cleanLink(input.link) : null
  if (!entry && !link) throw new UserError('Give it a name first.', 'no-name')
  return db.transaction(() => (entry ? keepEntry(db, storyId, topic, entry) : keepLink(db, storyId, topic, link!)))()
}

/** How many pages and links each topic has kept here, still there (not undone, the page not deleted). */
export function interviewProgress(db: DB, storyId: ID | null): InterviewProgress {
  const out = Object.fromEntries(INTERVIEW_TOPICS.map((t) => [t, 0])) as InterviewProgress
  const where = storyId ?? ''
  for (const l of interviewLines(db)) {
    const u = l.undo as { topic?: string; where?: string; entryId?: ID; did?: string } | null
    if (!u || u.where !== where || !(INTERVIEW_TOPICS as string[]).includes(u.topic ?? '')) continue
    if (u.entryId && entryState(db, u.entryId) !== 'live') continue
    out[u.topic as InterviewTopic] += 1
  }
  return out
}
