// Write the whole chapter, step 4 (spec "Write the chapter, reworked", 2026-10-19): fix only what was flagged, one
// problem at a time. The words a finding points at are found in the scene (tolerantly, ask/anchor.ts) and widened to the
// whole paragraphs they are in; the writer model rewrites only that passage, with the writer's own instructions, style
// guide and sample passage, at the writer's temperature (before, the agent's revise wrote at 0.3 without the style
// guide), given the scene card, the scene's part of the chapter plan, the words just before and after, and the problem.
// The new passage takes the old one's place (whole paragraphs rebuilt, so italics stay whole) and the rest of the scene
// stays as it was. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ID, StyleGuide } from '@shared/types'
import { countWords } from '@shared/defaults'
import * as repo from '../db/repo'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { markedSlice, sceneWords, type SceneWords } from '../ask/agent'
import { findWords, paraAt } from '../ask/anchor'
import { sceneTail } from '../ai/context'
import { cardLines } from '../outline/context'
import { newId } from '../util'
import { cleanProse, pageFrom, type Page } from './page'
import { FIX_ASK, MAX_FIX_WORDS, fixReply, fixSystem } from './prompts'
import type { Finding, SceneRef } from './tools'

type DB = Database.Database

/** About how many words of the scene go before and after the passage. */
export const AROUND_WORDS = { before: 160, after: 90 }

/** Where a passage is in a scene's plain words (whole paragraphs), and its words with *italics*. */
export interface Passage {
  from: number
  to: number
  marked: string
  words: number
}

/**
 * The whole paragraphs the words are in, or null when they can't be found in the scene. Words found more than once are
 * taken where they first are. A passage longer than MAX_FIX_WORDS, or across a scene break, is cut to the paragraph the
 * words start in.
 */
export function passageFor(s: SceneWords, quote: string): Passage | null {
  if (!quote.trim()) return null
  const f = findWords(s, s.paras, quote)
  let from: number
  let to: number
  if (f.ok) [from, to] = [f.from, f.to]
  else if (f.why === 'spans') [from, to] = [f.from, f.to]
  else if (f.why === 'many' && f.places.length) [from, to] = [f.places[0].from, f.places[0].to]
  else return null
  const first = paraAt(s.paras, from)
  const last = paraAt(s.paras, Math.max(from, to - 1)) ?? first
  if (!first || !last || first.n === 0) return null
  let end = last.to
  const across = s.paras.some((p) => p.n === 0 && p.from >= first.from && p.to <= end)
  if (across || countWords(s.plain.slice(first.from, end)) > MAX_FIX_WORDS) end = first.to
  const marked = markedSlice(s, first.from, end)
  return { from: first.from, to: end, marked, words: countWords(marked) }
}

/** The first `words` words of a text, at a sentence's end where one is near. */
function opening(text: string, words: number): string {
  const all = [...text.trim().matchAll(/\S+/g)]
  if (all.length <= words) return text.trim()
  const cut = text.trim().slice(0, (all[words - 1].index ?? 0) + all[words - 1][0].length)
  let best = -1
  for (const m of cut.matchAll(/[.!?…]["'”’)\]*]*(?=\s|$)/g)) best = (m.index ?? 0) + m[0].length
  return best > cut.length / 2 ? cut.slice(0, best) : `${cut}…`
}

const fence = (t: string): string => `"""\n${t.trim()}\n"""`

/** The problem, as the writer reads it. */
export function problemText(f: Finding): string {
  const who =
    f.from === 'critic' ? 'A note from the critic, who read the chapter for craft' : f.from === 'phrase' ? 'A stock phrase that reads as written by an AI' : 'A slip the consistency check found'
  const lines = [`${who}: ${f.what.trim()}`]
  if (f.quote.trim()) lines.push(`The words it is about: “${f.quote.replace(/\s+/g, ' ').trim()}”`)
  if (f.advice.trim()) lines.push(`Suggested: ${f.advice.replace(/\s+/g, ' ').trim()}`)
  return lines.join('\n')
}

/** What the writer is asked: the scene, its part of the plan, the words around, the passage, the problem. */
export function fixMessages(o: {
  style: StyleGuide
  scene: SceneRef
  card: string
  part: string
  before: string
  passage: string
  after: string
  problem: string
}): ChatMessage[] {
  const part = (title: string, body: string): string => (body.trim() ? `## ${title}\n${body.trim()}` : '')
  const user = [
    part(`The scene: ${o.scene.label}`, o.card || '(No card.)'),
    part('This scene’s part of the chapter plan', o.part),
    o.before.trim() ? part('The text just before the passage', fence(o.before)) : '## The text just before the passage\n(The passage opens the scene.)',
    part('The passage to rewrite (your reply takes its place)', fence(o.passage)),
    o.after.trim() ? part('The text just after the passage', fence(o.after)) : '## The text just after the passage\n(The passage ends the scene.)',
    part('The problem', o.problem),
    FIX_ASK
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    { role: 'system', content: fixSystem(o.style) },
    { role: 'user', content: user }
  ]
}

/** The writer's reply as a passage: the words alone, or '' when it isn't one. */
export function replyPassage(reply: string): string {
  let t = cleanProse(reply)
  const fenced = /^"""\s*\n?([\s\S]*?)\n?\s*"""$/.exec(t)
  if (fenced) t = fenced[1].trim()
  // A heading or a note before the words ("## The new passage", "Here is the passage:").
  t = t.replace(/^(?:#+[^\n]*\n+|(?:here is|here's)[^\n]*:\s*\n+)/i, '').trim()
  return t
}

export interface FixDeps {
  db: DB
  /** The writer model, with its Thinking. */
  model: JobModel
  /** The writer's sampling (writerTemperature and the creativity preset's top_p and min_p). */
  temperature: number
  topP: number
  minP?: number | null
  style: StyleGuide
  signal: AbortSignal
  onTask: (taskId: ID | null) => void
  taskEmit: Emit
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export type FixOutcome =
  | { status: 'fixed'; page: Page; words: string }
  /** The words can't be found in the scene (changed since, or never there). */
  | { status: 'unplaced' }
  /** The writer sent back nothing usable: no words, the same words, or far longer or shorter. */
  | { status: 'unusable' }
  | { status: 'stopped' }
  | { status: 'error'; error: string | null }

/** Rewrites the passage a finding points at, in the writer's voice. Never throws once started. */
export async function fixPassage(d: FixDeps, scene: SceneRef, f: Finding, planPart: string): Promise<FixOutcome> {
  const s = sceneWords(d.db, scene.id)
  if (!s || !s.plain.trim()) return { status: 'unplaced' }
  const p = passageFor(s, f.quote)
  if (!p) return { status: 'unplaced' }
  const card = repo.sceneCards(d.db, [scene.id]).get(scene.id)
  const names = new Map(repo.listEntries(d.db).map((e) => [e.id, e.name]))
  const messages = fixMessages({
    style: d.style,
    scene,
    card: card ? cardLines(card, (id) => names.get(id) ?? '') : '',
    part: planPart,
    before: sceneTail(markedSlice(s, 0, p.from), { min: AROUND_WORDS.before / 2, target: AROUND_WORDS.before, max: AROUND_WORDS.before + 60 }),
    passage: p.marked,
    after: opening(markedSlice(s, p.to, s.plain.length), AROUND_WORDS.after),
    problem: problemText(f)
  })
  const taskId = newId()
  d.onTask(taskId)
  let done: Awaited<ReturnType<typeof runTask>>
  try {
    done = await runTask({
      background: true,
      db: d.db,
      taskId,
      job: 'chapter',
      sceneId: scene.id,
      model: d.model,
      messages,
      reply: fixReply(p.words),
      temperature: d.temperature,
      topP: d.topP,
      ...(d.minP != null ? { minP: d.minP } : {}),
      direction: `Fixing ${scene.label}: ${f.what.replace(/\s+/g, ' ').trim().slice(0, 200)}`,
      emit: d.taskEmit,
      fetchImpl: d.fetchImpl,
      retryDelays: d.retryDelays
    })
  } finally {
    d.onTask(null)
  }
  if (done.status === 'stopped' || d.signal.aborted) return { status: 'stopped' }
  if (done.status === 'error') return { status: 'error', error: done.error ?? null }
  const words = replyPassage(done.text)
  const n = countWords(words)
  if (!words || done.cutOff || n < Math.max(1, p.words * 0.35) || n > p.words * 2.6 + 40) return { status: 'unusable' }
  // The scene as it is now (nothing else writes into it while the run holds it), with the passage in place.
  const now = sceneWords(d.db, scene.id)
  if (!now || now.plain !== s.plain) return { status: 'unplaced' }
  const replaced = words.replace(/\r\n?/g, '\n').replace(/\n[ \t]*\n?(?=\S)/g, '\n\n').trim()
  const text = `${markedSlice(s, 0, p.from)}${replaced}${markedSlice(s, p.to, s.plain.length)}`
  const page = pageFrom(text, repo.getScene(d.db, scene.id).doc)
  if (page.text === s.plain || !page.text.trim()) return { status: 'unusable' }
  return { status: 'fixed', page, words: replaced }
}
