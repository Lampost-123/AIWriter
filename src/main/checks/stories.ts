// Checking across stories (milestone 5, AI checks; spec: "The checker also compares each side story with
// the story it runs alongside, and the end of a prequel with the book it leads into"). When a story is
// checked:
// - a side story is compared with its host over the stretch they share (the host's scenes from where the
//   side story starts to where it ends, as the line has them: memory/line.ts hostSpans);
// - a prequel (or the story that carries a prequel on to the book: memory/scene.ts leadsIntoBook) has its
//   ending compared with how the book it leads into begins.
// A mismatch is an issue of kind 'story' linking to the other story. Where a side story and its host both
// change the same thing, the memory already asks "Which happened last?" in What changed: such a clash is
// left out here, so it is never asked twice. One request per comparison. No Electron imports.

import type Database from 'better-sqlite3'
import type { IssueSource } from '@shared/contracts/checks'
import type { ChatMessage, EntryState, ID } from '@shared/types'
import type { WorldShape } from '../memory/types'
import { hostSpans, labeler } from '../memory/line'
import { leadsIntoBook, loadMemoryData, loadShape } from '../memory/scene'
import { memoryAt } from '../memory/asOf'
import { sideClashes } from '../memory/state'
import { runTask, type Emit } from '../ai/tasks'
import { mentions, sceneTail, SHORT_TAIL } from '../ai/context'
import * as kdb from '../db/keeper'
import * as cdb from '../db/checks'
import { estimateTokens, firstWords, plain } from '../keeper/text'
import { str } from '../keeper/json'
import { newId, UserError } from '../util'
import { entryOf, fieldOf, readCheckReply, severityOf } from './parse'
import { issueKey, sceneQuote } from './quote'
import { retryMessage, storySystem } from './prompts'
import { CHECK_TEMPERATURE, type CheckOptions } from './run'

type DB = Database.Database

/** What a story is compared with when it is checked. */
export type StoryComparison =
  /** A side story and its host, over the host's scenes the side story runs alongside. */
  | { kind: 'side'; storyId: ID; otherId: ID; sceneIds: ID[]; otherSceneIds: ID[] }
  /** A prequel's ending and the opening of the book it leads into. */
  | { kind: 'prequel'; storyId: ID; otherId: ID; sceneIds: ID[]; otherSceneIds: ID[] }

const scenesOf = (shape: WorldShape, storyId: ID): ID[] =>
  shape.stories.find((s) => s.id === storyId)?.chapters.flatMap((c) => c.scenes.map((s) => s.id)) ?? []

/** The comparisons checking this story makes (none for a story that is neither a side story nor leads into a book). Pure. */
export function storyComparisons(shape: WorldShape, storyId: ID): StoryComparison[] {
  const story = shape.stories.find((s) => s.id === storyId)
  if (!story) return []
  const own = scenesOf(shape, storyId)
  if (!own.length) return []
  const out: StoryComparison[] = []
  if (story.kind === 'side') {
    const span = hostSpans(shape)(storyId)
    if (span && span.sceneIds.length) out.push({ kind: 'side', storyId, otherId: span.hostId, sceneIds: own, otherSceneIds: span.sceneIds })
  }
  const book = leadsIntoBook(shape, storyId)
  if (book && book !== storyId) {
    const first = shape.stories.find((s) => s.id === book)?.chapters[0]?.scenes.map((s) => s.id) ?? []
    if (first.length) out.push({ kind: 'prequel', storyId, otherId: book, sceneIds: own, otherSceneIds: first })
  }
  return out
}

/** A scene in a few words: its summary, else the opening of its text. */
function sceneGist(db: DB, sceneId: ID): { text: string; scene: string } {
  const r = db.prepare('SELECT title, text FROM scenes WHERE id = ?').get(sceneId) as { title: string; text: string } | undefined
  const summary = kdb.summaryRow(db, 'scene', sceneId)?.text.trim()
  return { text: summary || firstWords(r?.text ?? '', 120), scene: r?.text ?? '' }
}

const listScenes = (db: DB, label: (id: ID) => string, ids: ID[]): string =>
  ids
    .map((id) => {
      const g = sceneGist(db, id)
      return g.text.trim() ? `${label(id)}: ${g.text.trim()}` : ''
    })
    .filter(Boolean)
    .join('\n')

const quiet: Emit = () => undefined

/**
 * Compares a story with another (see the top of this file) and saves what was found, replacing what the
 * same comparison found before. Returns how many new issues were raised; throws nothing once started.
 */
export async function compareStories(
  o: CheckOptions,
  c: StoryComparison
): Promise<{ status: 'done' | 'stopped' | 'error'; found: number; error: string | null }> {
  const db = o.db
  const shape = loadShape(db)
  const data = loadMemoryData(db)
  const story = shape.stories.find((s) => s.id === c.storyId)
  const other = shape.stories.find((s) => s.id === c.otherId)
  if (!story || !other) return { status: 'done', found: 0, error: null }
  const labelOf = labeler(shape)
  const storyOfScene = new Map<ID, ID>()
  for (const s of shape.stories) for (const ch of s.chapters) for (const sc of ch.scenes) storyOfScene.set(sc.id, s.id)
  const label = (id: ID): string => labelOf({ storyId: storyOfScene.get(id) ?? null, sceneId: id })

  // The two sides, in a few words each, and (for a prequel) the very end of it, word for word.
  let mine: string
  let theirs: string
  let quoteFrom = ''
  let quoteScene: ID | null = null
  if (c.kind === 'side') {
    mine = `## ${story.title} (the side story)\n${listScenes(db, label, c.sceneIds)}`
    theirs = `## ${other.title} over the same stretch\n${listScenes(db, label, c.otherSceneIds)}`
  } else {
    const chapters = shape.stories.find((s) => s.id === c.storyId)?.chapters ?? []
    const last = chapters[chapters.length - 1]?.scenes.map((s) => s.id) ?? []
    quoteScene = last[last.length - 1] ?? null
    quoteFrom = quoteScene ? sceneGist(db, quoteScene).scene : ''
    mine = [
      `## How ${story.title} ends`,
      listScenes(db, label, last),
      quoteFrom.trim() ? `\nIts last words (${label(quoteScene!)}):\n${sceneTail(quoteFrom, SHORT_TAIL)}` : ''
    ].join('\n')
    const firstScene = sceneGist(db, c.otherSceneIds[0]).scene
    theirs = [
      `## How ${other.title} begins`,
      listScenes(db, label, c.otherSceneIds),
      firstScene.trim() ? `\nIts first words:\n${firstWords(firstScene, 300)}` : ''
    ].join('\n')
  }

  // The characters and places either names, as each story has them where they meet.
  const atMine = memoryAt(db, { kind: 'end', storyId: c.storyId }, shape, data).state.entries
  const atTheirs =
    c.kind === 'prequel'
      ? memoryAt(db, { kind: 'start', storyId: c.otherId }, shape, data).state.entries
      : memoryAt(db, { kind: 'end', storyId: c.storyId, seenIn: c.otherId }, shape, data).state.entries
  const both = `${mine}\n${theirs}`
  const entries: { code: string; e: EntryState; then: EntryState | undefined }[] = []
  for (const e of atMine.values()) {
    if (e.kind !== 'character' && e.kind !== 'place' && e.kind !== 'item') continue
    if (![e.name, ...(e.aliases ?? [])].some((n) => mentions(both, n))) continue
    entries.push({ code: `E${entries.length + 1}`, e, then: atTheirs.get(e.id) })
    if (entries.length >= 30) break
  }
  const happened = (x: EntryState | undefined): string =>
    x?.happened
      .slice(-3)
      .map((h) => h.note.trim())
      .filter(Boolean)
      .join('; ') ?? ''
  const memoryLines = entries.map(({ code, e, then }) =>
    [
      `- ${code} ${e.name}${e.summary.trim() ? `: ${e.summary.trim()}` : ''}`,
      happened(e) ? `  In ${story.title}: ${happened(e)}.` : '',
      then && happened(then) ? `  In ${other.title}: ${happened(then)}.` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )

  // What the memory already asks "Which happened last?" about: left out of the reply.
  const asked = c.kind === 'side' ? sideClashes(data, shape, c.storyId) : []
  const nameOf = new Map(data.entries.map((e) => [e.id, e.name]))
  const askedLines = asked.map((a) => `- ${nameOf.get(a.entryId) ?? ''}: ${a.aspect.startsWith('rel:') ? `how things stand with ${nameOf.get(a.aspect.slice(4)) ?? 'someone'}` : a.aspect}`)

  const user = [
    mine,
    theirs,
    entries.length ? `## Who and what they name\n${memoryLines.join('\n')}` : '',
    askedLines.length ? `## Already asked\n${askedLines.join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  const system = storySystem(c.kind)
  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
  let items: Record<string, unknown>[] | null = null
  for (let attempt = 0; attempt < 2 && !items; attempt++) {
    if (o.stopped()) return { status: 'stopped', found: 0, error: null }
    const taskId = newId()
    o.onTask?.(taskId)
    let done
    try {
      done = await runTask({
        db,
        taskId,
        job: 'check',
        sceneId: null,
        model: o.model,
        messages,
        reply: Math.min(2000, Math.max(600, estimateTokens(user) / 3)),
        temperature: CHECK_TEMPERATURE,
        topP: 1,
        blocks: [
          { id: 'mine', priority: 1, title: story.title, text: mine, tokens: estimateTokens(mine), entryIds: [], dropped: false },
          { id: 'theirs', priority: 2, title: other.title, text: theirs, tokens: estimateTokens(theirs), entryIds: [], dropped: false },
          {
            id: 'memory',
            priority: 3,
            title: 'Who and what they name',
            text: memoryLines.join('\n'),
            tokens: estimateTokens(memoryLines.join('\n')),
            entryIds: entries.map((x) => x.e.id),
            dropped: false
          }
        ],
        entries: entries.map((x) => ({ entryId: x.e.id, version: x.e.updatedAt })),
        emit: quiet,
        onKeyRejected: o.onKeyRejected,
        fetchImpl: o.fetchImpl,
        retryDelays: o.retryDelays
      })
    } catch (e) {
      return { status: 'error', found: 0, error: e instanceof UserError ? e.message : 'Something went wrong while comparing the stories. Try again.' }
    } finally {
      o.onTask?.(null)
    }
    if (done.status === 'stopped' || o.stopped()) return { status: 'stopped', found: 0, error: null }
    if (done.status === 'error') return { status: 'error', found: 0, error: done.error }
    const reply = readCheckReply(done.text)
    if (reply.ok) items = reply.items
    else messages = [...messages, { role: 'assistant', content: done.text }, { role: 'user', content: retryMessage(reply.why) }]
  }
  if (!items) {
    return {
      status: 'error',
      found: 0,
      error: "The consistency check model's reply wasn't in the right format. Try again, or pick another consistency check model in Settings › Models."
    }
  }
  if (!db.open || o.closed?.()) return { status: 'stopped', found: 0, error: null }

  const byCode = new Map(entries.map((x) => [x.code, x.e]))
  const found = storyIssues(items, {
    storyId: c.storyId,
    other: { id: other.id, title: other.title },
    entries: byCode,
    quoteFrom,
    quoteScene,
    asked
  })
  const existing = cdb.storyKindRows(db, c.storyId).filter((r) => cdb.payloadOf(r).otherStoryId === c.otherId)
  const raised = cdb.saveFound(db, existing, found, (p) => p.otherStoryId === c.otherId)
  return { status: 'done', found: raised, error: null }
}

/** The issues of a comparison's reply that can be trusted: a message, an entry it names, and never one "Which happened last?" already asks. Pure. */
export function storyIssues(
  items: Record<string, unknown>[],
  ctx: {
    storyId: ID
    other: { id: ID; title: string }
    entries: Map<string, EntryState>
    /** The text quotes may come from (the prequel's last scene), and that scene. */
    quoteFrom: string
    quoteScene: ID | null
    asked: { entryId: ID; aspect: string }[]
  }
): cdb.FoundIssue[] {
  const out = new Map<string, cdb.FoundIssue>()
  for (const item of items) {
    const message = str(item.message, 400)
    if (!message) continue
    const entry = entryOf(ctx, item.entry)
    const field = entry ? fieldOf(entry, item.field) : null
    // Already asked as "Which happened last?": the same entry and aspect (or the entry, when the reply names no aspect).
    if (entry && ctx.asked.some((a) => a.entryId === entry.id && (!field || a.aspect === field))) continue
    const quote = ctx.quoteFrom ? (sceneQuote(ctx.quoteFrom, item.quote) ?? '') : ''
    const sources: IssueSource[] = [{ kind: 'story', storyId: ctx.other.id, title: ctx.other.title }]
    if (entry) sources.push({ kind: 'entry', entryId: entry.id, name: entry.name, field })
    const key = issueKey('story', `${ctx.other.id}:${entry?.id ?? ''}`, quote || plain(message))
    if (out.has(key)) continue
    out.set(key, {
      sceneId: quote ? ctx.quoteScene : null,
      storyId: ctx.storyId,
      kind: 'story',
      severity: severityOf(item.severity),
      quote,
      message: message.replace(/\b(E\d+)\b/g, (m, code: string) => ctx.entries.get(code)?.name ?? m),
      key,
      payload: { by: 'check', check: 'story', sources, fix: null, memoryFix: null, entryId: entry?.id, field, otherStoryId: ctx.other.id }
    })
  }
  return [...out.values()]
}
