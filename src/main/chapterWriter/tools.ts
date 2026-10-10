// The chapter writer's agent at work in one session: its look-ups (the editor chat's own, ask/agent.ts, seen from the
// scene being worked on) and its own tools, which act straight away (revise, rewrite_scene), set a finding aside
// (not_a_problem), read again (check_again), and end the session (write_brief, done). Each change is saved through the
// caller's `save`, which keeps the page before in History and tells the window. Never throws from a tool: a mistake
// goes back to the model as the tool's answer. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterWriterFix, ChapterWriterSetAside } from '@shared/contracts/chapterWriter'
import type { ChatMessage, ID, ToolCall, ToolSpec, WritingPrefs, AgentStep } from '@shared/types'
import * as cdb from '../db/checks'
import * as repo from '../db/repo'
import { EditorAgent, markedSlice, numberedBody, sceneWords, type SceneWords } from '../ask/agent'
import type { SnapshotSource } from '../ask/extraTools'
import { findWords, paraAt, type Found } from '../ask/anchor'
import { sceneMemory } from '../memory/scene'
import { timelineFrom } from '../ai/context'
import { timelineText } from '../ai/timeline'
import { pageFrom, type Page } from './page'
import { MAX_REVISE_WORDS, ownTools, type ChapterJob } from './prompts'

type DB = Database.Database

/** The look-ups offered (the editor chat's, by name; those its switches leave out simply aren't there). */
export const LOOKUPS = new Set([
  'read_scene',
  'outline',
  'search',
  'get_entry',
  'style_guide',
  'scene_state',
  'story_so_far',
  'chapter_card',
  'list_threads',
  'find_mentions'
])

/** A scene of the chapter, as the agent names it. */
export interface SceneRef {
  id: ID
  /** Its number in the chapter, from 1. */
  n: number
  title: string
  /** "Sc 2 “The ferry”". */
  label: string
}

/** Something a check, the critic or the AI phrase list found, for the agent to deal with. */
export interface Finding {
  /** "F1", "F2"... in the order given to the agent this run. */
  id: string
  sceneId: ID | null
  from: 'check' | 'critic' | 'phrase'
  /** The issue row it is (checks only). */
  issueId: ID | null
  /** What it is: "must fix · timeline", "critic · pacing · high". */
  kind: string
  what: string
  quote: string
  /** A suggested fix, rewrite or advice. */
  advice: string
  status: 'open' | 'fixed' | 'set-aside'
}

/** What a session needs from the run. */
export interface SessionDeps {
  db: DB
  job: ChapterJob
  storyId: ID
  chapterId: ID
  /** The scene being worked on (null: the whole chapter, seen from its last scene). */
  sceneId: ID | null
  scenes: SceneRef[]
  prefs: WritingPrefs
  history?: SnapshotSource | null
  /** The findings this session deals with; check_again adds to them. Shared with the run. */
  findings: Finding[]
  /** The next finding number (shared across the run, so ids never repeat). */
  nextFinding: () => string
  /** The brief, as text (empty while studying). */
  brief: () => string
  /** Saves a scene's new page (keeping the one before in History and telling the window). */
  save: (sceneId: ID, page: Page, label: string) => void
  /** Writes a scene again from its card, with a direction; resolves with its words, or an error in plain words. */
  rewrite: (sceneId: ID, direction: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  /** The checks and the critic read a scene again: the new findings (not yet numbered). */
  checkAgain: (sceneId: ID) => Promise<Omit<Finding, 'id'>[]>
  /** A critic note set aside: never raised again this run. */
  setAsideNote: (f: Finding) => void
  /** Told of each change, set-aside and rewrite, for the report. */
  noted: {
    fix: (sceneId: ID, fix: ChapterWriterFix) => void
    setAside: (sceneId: ID | null, s: ChapterWriterSetAside) => void
    rewritten: (sceneId: ID, why: string) => void
  }
}

/** What study ends with. */
export interface Brief {
  overview: string
  scenes: { sceneId: ID; notes: string }[]
  questions: string[]
}

class Mistake extends Error {}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
const wordsIn = (s: string): number => (s.match(/[\p{L}\p{N}’']+/gu) ?? []).length

/** A finding as the agent reads it, one line. */
export function findingLine(f: Finding, scenes: SceneRef[]): string {
  const where = f.sceneId ? (scenes.find((s) => s.id === f.sceneId)?.label ?? 'a scene') : 'the whole chapter'
  return `${f.id} [${where} · ${f.kind}] ${squash(f.what)}${f.quote ? ` Words: “${clip(squash(f.quote), 300)}”.` : ''}${f.advice ? ` Suggested: ${clip(squash(f.advice), 400)}` : ''}`
}

export class ChapterSession {
  readonly tools: ToolSpec[]
  private readonly look: EditorAgent | null
  brief: Brief | null = null
  summary = ''
  private closing: string | null = null
  private doneRefused = 0
  /** Scenes this session changed. */
  readonly changed = new Set<ID>()
  private hay: string | null = null

  constructor(private readonly d: SessionDeps) {
    const focus = d.sceneId ?? d.scenes[d.scenes.length - 1]?.id ?? null
    // Study sees the memory as the chapter starts; review as of its scene (or the chapter's end); proofread needs none.
    const at = d.job === 'study' ? (d.scenes[0]?.id ?? null) : focus
    this.look =
      d.job === 'proofread'
        ? null
        : new EditorAgent(d.db, { storyId: d.storyId, sceneId: at, prefs: d.prefs, history: d.history ?? null }, () => undefined, () => undefined)
    const looks = this.look ? this.look.tools.filter((t) => LOOKUPS.has(t.name)) : []
    this.tools = [...looks, ...ownTools(d.job)]
  }

  /** Once the session has ended itself (the brief written, or done accepted): its last words; null while it goes on. */
  ended(): string | null {
    return this.closing
  }

  /** Answers a request's calls, in order. */
  async runAll(calls: ToolCall[]): Promise<{ results: ChatMessage[]; steps: AgentStep[] }> {
    const results: ChatMessage[] = []
    const steps: AgentStep[] = []
    for (const c of calls) {
      let label = c.name
      let result: string
      if (this.closing) {
        result = 'The session has ended: nothing more is done.'
      } else if (LOOKUPS.has(c.name) && this.look) {
        const r = this.look.run(c)
        label = r.step.label || c.name
        result = r.result
      } else {
        let args: Record<string, unknown> = {}
        try {
          args = c.arguments.trim() ? (JSON.parse(c.arguments) as Record<string, unknown>) : {}
        } catch {
          args = { __bad: true }
        }
        try {
          if (args.__bad) throw new Mistake('The arguments were not valid JSON (or were cut off). Call the tool again with valid JSON; split a long change into smaller ones.')
          ;[label, result] = await this.own(c.name, args)
        } catch (e) {
          result = e instanceof Mistake ? e.message : `That didn't work: ${(e as Error)?.message ?? e}`
        }
      }
      results.push({ role: 'tool', toolCallId: c.id, content: result })
      steps.push({ label, tool: c.name, arguments: c.arguments.slice(0, 2000), result: clip(result, 1500) })
    }
    return { results, steps }
  }

  // ---------- Its own tools ----------

  private async own(name: string, a: Record<string, unknown>): Promise<[string, string]> {
    const text = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '')
    const ids = (k: string): string[] =>
      Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.trim().toUpperCase()) : []
    if (!ownTools(this.d.job).some((t) => t.name === name)) throw new Mistake(`There is no tool called “${name}” here.`)
    switch (name) {
      case 'write_brief':
        return this.writeBrief(a)
      case 'timeline': {
        const id = text('scene').trim() ? this.sceneOf(text('scene')) : (this.d.sceneId ?? this.d.scenes[0]?.id)
        if (!id) throw new Mistake('There is no scene to read the timeline before.')
        return [`Reading the timeline before ${this.labelOf(id)}`, this.timeline(id)]
      }
      case 'chapter_brief':
        return ['Reading the brief', this.d.brief() || 'There is no brief for this chapter.']
      case 'revise':
        return this.revise(this.sceneOf(text('scene')), text('start'), text('end'), text('new_words'), ids('fixes'), text('why'))
      case 'rewrite_scene': {
        const id = this.sceneOf(text('scene'))
        const direction = text('direction').trim()
        if (!direction) throw new Mistake('Give a `direction`: what must be different in the new version, and why.')
        const r = await this.d.rewrite(id, direction)
        if (!r.ok) throw new Mistake(`The scene couldn't be written again: ${r.error}`)
        this.changed.add(id)
        this.markFixed(ids('fixes'), id)
        this.d.noted.rewritten(id, direction)
        return [`Writing ${this.labelOf(id)} again`, `${this.labelOf(id)} was written again (${wordsIn(r.text)} words). Read it with read_scene before changing anything in it.`]
      }
      case 'not_a_problem':
        return this.notAProblem(text('finding'), text('why'))
      case 'check_again': {
        const id = text('scene').trim() ? this.sceneOf(text('scene')) : this.d.sceneId
        if (!id) throw new Mistake('Say which scene to check again.')
        const found = await this.d.checkAgain(id)
        // What was open for this scene is now whatever the checks still find; anything new is added.
        const fresh: Finding[] = []
        for (const f of found) {
          const same = this.d.findings.find(
            (x) => x.status === 'open' && x.sceneId === f.sceneId && ((f.issueId && x.issueId === f.issueId) || (x.from === f.from && fold(x.what) === fold(f.what)))
          )
          if (same) continue
          const nf: Finding = { ...f, id: this.d.nextFinding() }
          this.d.findings.push(nf)
          fresh.push(nf)
        }
        const open = this.d.findings.filter((x) => x.sceneId === id && x.status === 'open')
        const lines = open.map((f) => findingLine(f, this.d.scenes))
        return [
          `Checking ${this.labelOf(id)} again`,
          open.length
            ? `Still open in ${this.labelOf(id)}${fresh.length ? ` (${fresh.length} new)` : ''}:\n${lines.join('\n')}`
            : `The checks and the critic found nothing more in ${this.labelOf(id)}.`
        ]
      }
      case 'done':
        return this.done(text('summary'))
      default:
        throw new Mistake(`There is no tool called “${name}”.`)
    }
  }

  private writeBrief(a: Record<string, unknown>): [string, string] {
    const overview = typeof a.overview === 'string' ? a.overview.trim() : ''
    const items = Array.isArray(a.scenes) ? (a.scenes as unknown[]) : []
    const scenes: Brief['scenes'] = []
    const unknown: string[] = []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const r = it as Record<string, unknown>
      const notes = typeof r.notes === 'string' ? r.notes.trim() : ''
      if (!notes) continue
      try {
        const id = this.sceneOf(typeof r.scene === 'string' ? r.scene : '')
        const had = scenes.find((s) => s.sceneId === id)
        if (had) had.notes = `${had.notes}\n${notes}`
        else scenes.push({ sceneId: id, notes })
      } catch {
        unknown.push(String(r.scene ?? ''))
      }
    }
    if (!scenes.length && !overview) throw new Mistake('The brief is empty. Give `overview` and, for each scene, its `notes`.')
    const missing = this.d.scenes.filter((s) => !scenes.some((x) => x.sceneId === s.id))
    if (missing.length && !this.brief) {
      // Asked once to cover every scene; a second brief is kept as it is.
      this.brief = { overview, scenes, questions: [] }
      throw new Mistake(
        `Kept, but these scenes have no notes yet: ${missing.map((s) => s.label).join(', ')}${unknown.length ? ` (and “${unknown.join('”, “')}” isn't a scene of this chapter)` : ''}. Call write_brief again with every scene.`
      )
    }
    const questions = Array.isArray(a.questions) ? (a.questions as unknown[]).filter((q): q is string => typeof q === 'string' && !!q.trim()).map((q) => q.trim()) : []
    this.brief = { overview, scenes: this.mergeBrief(scenes), questions }
    this.closing = 'The brief is written.'
    return ['Writing the brief', 'The brief is kept. The scenes will be written to it now.']
  }

  /** A second brief keeps the first's notes for any scene it leaves out. */
  private mergeBrief(scenes: Brief['scenes']): Brief['scenes'] {
    const before = this.brief?.scenes ?? []
    return this.d.scenes.flatMap((s) => {
      const now = scenes.find((x) => x.sceneId === s.id) ?? before.find((x) => x.sceneId === s.id)
      return now ? [now] : []
    })
  }

  private timeline(sceneId: ID): string {
    const memory = sceneMemory(this.d.db, sceneId)
    const story = repo.getStory(this.d.db, this.d.storyId)
    const t = memory.storySoFar ? timelineText(memory.storySoFar, timelineFrom({ memory, story })) : ''
    return t || 'Nothing has happened before this scene: it opens the story.'
  }

  private revise(sceneId: ID, start: string, end: string, newWords: string, fixes: string[], why: string): [string, string] {
    const s = sceneWords(this.d.db, sceneId)
    if (!s || !s.plain.trim()) throw new Mistake(`${this.labelOf(sceneId)} has no words to change.`)
    if (!start.trim() || !end.trim()) throw new Mistake('Give the passage’s first words as `start` and its last words as `end`, copied from read_scene.')
    const replace = newWords.replace(/\r\n?/g, '\n').replace(/\n[ \t]*\n?(?=\S)/g, '\n\n').trim()
    if (!replace) throw new Mistake('Give the new passage as `new_words`.')
    const n = wordsIn(replace)
    if (n > MAX_REVISE_WORDS + 50) throw new Mistake(`That is about ${n} words: keep each change under about ${MAX_REVISE_WORDS}. Split it into several, one passage each.`)
    const [from, to] = this.passage(s, start, end)
    const first = paraAt(s.paras, from)
    const last = paraAt(s.paras, to)
    if (!first || !last) throw new Mistake('Those words could not be placed in the scene. Read it again and copy them exactly.')
    if (s.paras.some((p) => p.n === 0 && p.from >= from && p.to <= to)) {
      throw new Mistake('That passage runs across a scene break (* * *). Change each side separately.')
    }
    // Whole paragraphs are rebuilt (their italics kept), so a change never leaves an italic run half open.
    const head = markedSlice(s, 0, first.from)
    const paras = `${markedSlice(s, first.from, from)}${replace}${markedSlice(s, to, last.to)}`
    const tail = markedSlice(s, last.to, s.plain.length)
    const old = repo.getScene(this.d.db, sceneId).doc
    const page = pageFrom(`${head}${paras}${tail}`, old)
    if (page.text === s.plain) throw new Mistake('The new words are the same as the old.')
    if (!page.text.trim()) throw new Mistake('That would leave the scene empty.')
    const reason = why.trim() || 'A change'
    this.d.save(sceneId, page, `Before the chapter writer’s change: ${clip(reason, 80)}`)
    this.changed.add(sceneId)
    this.markFixed(fixes, sceneId)
    this.d.noted.fix(sceneId, { why: reason, words: clip(squash(replace), 240) })
    return [
      `Changing ${this.labelOf(sceneId)}`,
      `Changed in ${this.labelOf(sceneId)}${fixes.length ? ` (for ${fixes.join(', ')})` : ''}. The paragraph numbers may have moved: read_scene again before another change to this scene.`
    ]
  }

  /** Where the passage from `start` to `end` is, tolerantly (ask/anchor.ts), or a Mistake saying what to do. */
  private passage(s: SceneWords, start: string, end: string): [number, number] {
    const fs = findWords(s, s.paras, start)
    let from: number
    let startTo: number
    if (fs.ok) [from, startTo] = [fs.from, fs.to]
    else if (fs.why === 'spans') [from, startTo] = [fs.from, fs.first.to]
    else throw new Mistake(notFound(fs, s, 'The `start` words'))
    let fe = findWords(s, s.paras, end, { after: startTo, first: true })
    if (!fe.ok && fe.why !== 'spans') {
      const within = findWords(s, s.paras, end, { after: from, first: true })
      if (within.ok && within.to >= startTo) fe = within
    }
    let to: number
    if (fe.ok) to = fe.to
    else if (fe.why === 'spans') to = fe.to
    else throw new Mistake(notFound(fe, s, 'The `end` words (after the `start` words)'))
    if (to <= from) throw new Mistake('The `end` words come before the `start` words. Copy the passage’s first and last words again.')
    return [from, to]
  }

  private notAProblem(id: string, why: string): [string, string] {
    const f = this.d.findings.find((x) => x.id === id.trim().toUpperCase())
    if (!f) throw new Mistake(`There is no finding ${JSON.stringify(id)}. The findings are ${this.d.findings.map((x) => x.id).join(', ') || 'none'}.`)
    if (f.status !== 'open') throw new Mistake(`${f.id} is already ${f.status === 'fixed' ? 'fixed' : 'set aside'}.`)
    const quotes = [...why.matchAll(/["“]([^"”]{6,})["”]/g)].map((m) => m[1]).filter((q) => wordsIn(q) >= 2)
    if (!quotes.length) {
      throw new Mistake('Not set aside: quote, in "double quotes", the words of the scene or the memory that show it is wrong. If you can’t, it is real: fix it with revise.')
    }
    const hay = this.haystack()
    const shown = quotes.find((q) => hay.includes(fold(q).replace(/[.,;:!?…]+$/, '')))
    if (!shown) {
      throw new Mistake(
        'Not set aside: the words you quoted aren’t in the story or the memory as written. Look them up (read_scene, get_entry, timeline) and quote them exactly, or fix the finding with revise.'
      )
    }
    f.status = 'set-aside'
    if (f.issueId) {
      try {
        cdb.setIssueStatus(this.d.db, f.issueId, 'ignored')
      } catch (e) {
        console.warn('Could not set an issue aside', e)
      }
    } else this.d.setAsideNote(f)
    this.d.noted.setAside(f.sceneId, { finding: clip(squash(f.what), 300), why: clip(squash(why), 500), issueId: f.issueId })
    return [`Setting ${f.id} aside`, `${f.id} is set aside. The author will see it, with your reason.`]
  }

  /** Everything a set-aside may quote: the story's words, and the memory's (entries and what happened to them). */
  private haystack(): string {
    if (this.hay !== null) return this.hay
    const db = this.d.db
    const scenes = (db.prepare("SELECT s.text AS t FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL").all() as {
      t: string | null
    }[]).map((r) => r.t ?? '')
    const entries = (db.prepare('SELECT name, summary, description, fields_json FROM entries WHERE deleted_at IS NULL').all() as Record<string, unknown>[]).map(
      (r) => [r.name, r.summary, r.description, r.fields_json].map((x) => (typeof x === 'string' ? x : '')).join('\n')
    )
    const changes = (db.prepare('SELECT payload_json FROM changes').all() as { payload_json: string | null }[]).map((r) => r.payload_json ?? '')
    let timeline = ''
    try {
      timeline = this.timeline(this.d.sceneId ?? this.d.scenes[this.d.scenes.length - 1].id)
    } catch {
      timeline = ''
    }
    this.hay = fold([...scenes, ...entries, ...changes, timeline].join('\n'))
    return this.hay
  }

  private done(summary: string): [string, string] {
    const mine = this.d.findings.filter((f) => f.status === 'open' && (this.d.sceneId == null || f.sceneId === this.d.sceneId))
    // Asked twice to deal with what is left; the third time it ends anyway (the app checks again itself).
    if (mine.length && this.doneRefused < 2) {
      this.doneRefused++
      return [
        'Not done yet',
        `Not done: still open: ${mine.map((f) => f.id).join(', ')}. Fix each with revise (naming it in \`fixes\`), or set it aside with not_a_problem and your reason. If you fixed one without naming it, call check_again to have it read again.\n${mine.map((f) => findingLine(f, this.d.scenes)).join('\n')}`
      ]
    }
    this.summary = summary.trim()
    this.closing = summary.trim() || 'Done.'
    return ['Finishing', 'Done. The app will check the chapter again.']
  }

  private markFixed(ids: string[], sceneId: ID): void {
    for (const id of ids) {
      const f = this.d.findings.find((x) => x.id === id)
      if (!f || f.status !== 'open') continue
      if (f.sceneId && f.sceneId !== sceneId) continue
      f.status = 'fixed'
      if (f.issueId) {
        try {
          cdb.setIssueStatus(this.d.db, f.issueId, 'fixed')
        } catch (e) {
          console.warn('Could not mark an issue fixed', e)
        }
      }
    }
  }

  // ---------- Scenes by name ----------

  /** A scene of this chapter from what the model called it: "Sc 2", "Ch 3, Sc 2", "2", its title or its id. */
  sceneOf(raw: string): ID {
    const v = raw.trim()
    if (!v) {
      if (this.d.sceneId) return this.d.sceneId
      throw new Mistake(`Say which scene: ${this.d.scenes.map((s) => `“Sc ${s.n}”`).join(', ')}.`)
    }
    const byId = this.d.scenes.find((s) => s.id === v)
    if (byId) return byId.id
    const num = /(?:^|\bsc(?:ene)?\.?\s*)(\d+)\s*$/i.exec(v.replace(/[“”"]/g, '').replace(/\s*[“"].*$/, '').trim())
    if (num) {
      const s = this.d.scenes.find((x) => x.n === Number(num[1]))
      if (s) return s.id
    }
    const title = fold(v.replace(/^.*?sc(?:ene)?\s*\d+[,:]?\s*/i, '').replace(/["“”]/g, ''))
    const byTitle = this.d.scenes.find((s) => s.title && (fold(s.title) === title || fold(s.title) === fold(v)))
    if (byTitle) return byTitle.id
    throw new Mistake(`“${v}” isn't a scene of this chapter. Its scenes: ${this.d.scenes.map((s) => s.label).join(', ')}.`)
  }

  labelOf(id: ID): string {
    return this.d.scenes.find((s) => s.id === id)?.label ?? 'that scene'
  }
}

/** What to tell the model when its words weren't found. */
function notFound(f: Exclude<Found, { ok: true }>, s: SceneWords, what: string): string {
  switch (f.why) {
    case 'empty':
      return `${what} are empty. Copy a few words from the scene.`
    case 'no-paragraph':
      return `${what}: there is no such paragraph; the scene has ${f.count}.`
    case 'many':
      return `${what} are in the scene more than once (${f.count} times). Give a few more words so they are found once.`
    case 'none':
      return f.near
        ? `${what} are not in the scene as written. The nearest words are: “${s.plain.slice(f.near.from, f.near.to)}”. Copy them exactly.`
        : `${what} are not in the scene as written. Read it with read_scene and copy them exactly.`
    case 'spans':
      return `${what} run across paragraphs. Copy words from one paragraph.`
  }
}

/** The numbered words of a scene, as read_scene shows them (for the session's opening message). */
export function numberedScene(db: DB, sceneId: ID): string {
  const s = sceneWords(db, sceneId)
  if (!s || !s.marked.trim()) return '(The scene has no words.)'
  return numberedBody(s, undefined).text
}
