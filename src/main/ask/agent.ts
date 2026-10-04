// The editor chat's tools (Adam, 2026-10-03): what Ask the world's model may use on the way to its answer. Looking
// things up (a scene's words, the outline, search, an entry, the style guide, a scene's issues) is answered here at
// once. Changes are only ever proposed: each becomes a Proposal Adam applies, or not, from the chat (the window
// applies it through the usual calls, so it can be undone); nothing here writes to the world, and nothing deletes.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { CardProposal, EntryProposal, Proposal } from '@shared/contracts/ask'
import { effectiveStyle } from '@shared/style'
import { ENTRY_KINDS, FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import type { AgentStep, ChatMessage, Entry, EntryKind, ID, Outline, ToolCall, ToolSpec, WritingPrefs } from '@shared/types'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { sceneText } from '../db/memory'
import { searchIndex } from '../search'

type DB = Database.Database

/**
 * How many requests one answer may take (each look-up is one more): enough to look around and propose a page of
 * corrections, never a runaway bill.
 */
export const MAX_STEPS = 12
/** The most of one scene's words sent back at once. */
const SCENE_CHARS = 24_000
/** The most of any other answer sent back at once. */
const RESULT_CHARS = 8_000

const str = { type: 'string' } as const
const optionalScene = {
  type: 'string',
  description: 'Which scene: "Ch 2, Sc 1", or its title. Leave it out for the scene the writer has open.'
} as const

/** The tools offered to the model. */
export const EDITOR_TOOLS: ToolSpec[] = [
  {
    name: 'read_scene',
    description: 'Read the full text of a scene in this story (the open scene when none is named), with its scene card.',
    parameters: { type: 'object', properties: { scene: optionalScene } }
  },
  {
    name: 'outline',
    description: "List this story's chapters and scenes in order, with each scene's status, length and goal.",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'search',
    description: 'Search the scenes, entries, summaries and notes of this world for words or a name.',
    parameters: { type: 'object', properties: { query: str }, required: ['query'] }
  },
  {
    name: 'get_entry',
    description: 'Read a character, place, group, item, lore, event, plot thread or glossary entry in full, by its name.',
    parameters: { type: 'object', properties: { name: str }, required: ['name'] }
  },
  {
    name: 'style_guide',
    description: "Read the style guide in effect for this story (point of view, tense, prose style, phrases to avoid, limits).",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'scene_issues',
    description: 'List the open consistency issues found in a scene (the open scene when none is named).',
    parameters: { type: 'object', properties: { scene: optionalScene } }
  },
  {
    name: 'propose_edit',
    description:
      "Propose replacing some words in a scene. `find` must be copied exactly from the scene's current text (read it first), within one paragraph and long enough to occur only once; `replace` is the new words ('' to cut). The writer sees it and decides; nothing changes unless they apply it. One change per call; for several, make several calls at once. Changes must not overlap: all the fixes in one sentence go in one change. To revise a change you already proposed, give its number as `revises`.",
    parameters: {
      type: 'object',
      properties: {
        scene: optionalScene,
        find: str,
        replace: str,
        why: { type: 'string', description: 'A short reason, in plain words.' },
        revises: { type: 'string', description: 'The number of an earlier change in this answer that this one takes the place of.' }
      },
      required: ['find', 'replace', 'why']
    }
  },
  {
    name: 'propose_rewrite',
    description:
      "Propose rewriting a passage of a scene that runs over several paragraphs (a beat pushed harder, a stretch tightened, a scene's opening redone). `start` is the passage's first few words and `end` its last few words, each copied exactly from the scene's current text (read it first; `start` must occur once, `end` after it); `replace` is the whole new passage, with a blank line between paragraphs and *asterisks* for italics. Keep the writer's voice and change only what was asked. The writer sees the old and new passage and decides; nothing changes unless they apply it. For a change inside one paragraph, use propose_edit.",
    parameters: {
      type: 'object',
      properties: {
        scene: optionalScene,
        start: { type: 'string', description: 'The first few words of the passage, exactly as in the scene.' },
        end: { type: 'string', description: 'The last few words of the passage, exactly as in the scene.' },
        replace: { type: 'string', description: 'The new passage; a blank line between paragraphs.' },
        why: { type: 'string', description: 'A short reason, in plain words.' }
      },
      required: ['start', 'end', 'replace', 'why']
    }
  },
  {
    name: 'propose_scene_card',
    description: "Propose new values for parts of a scene's card (only the parts given change). The writer decides.",
    parameters: {
      type: 'object',
      properties: {
        scene: optionalScene,
        goal: str,
        conflict: str,
        outcome: str,
        mood: str,
        when: str,
        notes: str,
        beats: { type: 'array', items: str, description: 'The whole list of beats, in order (it replaces the card’s).' },
        why: str
      },
      required: ['why']
    }
  },
  {
    name: 'propose_entry_change',
    description:
      "Propose new values for parts of an existing entry (summary, description, aliases, or its own fields by the keys get_entry shows). Only the parts given change. The writer decides.",
    parameters: {
      type: 'object',
      properties: {
        name: str,
        summary: str,
        description: str,
        aliases: { type: 'array', items: str },
        fields: { type: 'object', additionalProperties: str, description: 'Field key to new value.' },
        why: str
      },
      required: ['name', 'why']
    }
  },
  {
    name: 'propose_new_entry',
    description: 'Propose a new entry in the memory. The writer decides.',
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: [...ENTRY_KINDS] }, name: str, summary: str, description: str, why: str },
      required: ['kind', 'name', 'why']
    }
  },
  {
    name: 'propose_new_scene',
    description: 'Propose a new scene at the end of a chapter ("Ch 2" or its title), with a goal and beats if you have them. The writer decides.',
    parameters: {
      type: 'object',
      properties: { chapter: str, title: str, goal: str, beats: { type: 'array', items: str }, why: str },
      required: ['chapter', 'title', 'why']
    }
  },
  {
    name: 'propose_new_chapter',
    description: 'Propose a new chapter at the end of this story. The writer decides.',
    parameters: { type: 'object', properties: { title: str, why: str }, required: ['title', 'why'] }
  },
  {
    name: 'propose_rename',
    description: 'Propose a new title for a scene or a chapter (name one of them). The writer decides.',
    parameters: {
      type: 'object',
      properties: { scene: str, chapter: str, to: str, why: str },
      required: ['to', 'why']
    }
  }
]

/** A proposal before it has its number and status. */
type NewProposal = Proposal extends infer P ? (P extends Proposal ? Omit<P, 'id' | 'status'> : never) : never

/** Where the chat was asked: the story and the scene open then. */
export interface AgentPlace {
  storyId: ID | null
  sceneId: ID | null
  prefs: WritingPrefs
}

/** Something the model got wrong that it can put right (a scene it named that isn't there, words that aren't in it). */
class Mistake extends Error {}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}\n[… cut short: ${s.length - max} more characters]` : s)
const lower = (s: string): string => s.trim().toLocaleLowerCase()
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** "Ch 2, Sc 1" for a scene of the outline. */
function sceneLabelIn(o: Outline, sceneId: ID): string {
  const s = o.scenes.find((x) => x.id === sceneId)
  if (!s) return 'a scene'
  const ch = o.chapters.findIndex((c) => c.id === s.chapterId)
  const n = o.scenes.filter((x) => x.chapterId === s.chapterId).findIndex((x) => x.id === sceneId)
  const title = s.title.trim() ? ` “${s.title.trim()}”` : ''
  return `Ch ${ch + 1}, Sc ${n + 1}${title}`
}

/** The editor chat's tools at work for one question: answers look-ups, notes proposals. */
export class EditorAgent {
  readonly proposals: Proposal[] = []
  private outlineCache: Outline | null = null

  constructor(
    private readonly db: DB,
    private readonly place: AgentPlace,
    /** Told of each step and each new proposal as they happen. */
    private readonly onStep: (label: string) => void,
    private readonly onProposals: (all: Proposal[]) => void
  ) {}

  private outline(): Outline {
    if (!this.place.storyId) throw new Mistake('No story is open, so there are no scenes or chapters to look at.')
    this.outlineCache ??= repo.getOutline(this.db, this.place.storyId)
    return this.outlineCache
  }

  /** A scene of this story by "Ch 2, Sc 1", its number, or its title; the open scene when none is named. */
  private scene(name: unknown): ID {
    const asked = typeof name === 'string' ? name.trim() : ''
    if (!asked) {
      if (this.place.sceneId) return this.place.sceneId
      throw new Mistake('No scene is open. Name one, as "Ch 2, Sc 1" or by its title.')
    }
    const o = this.outline()
    const m = /ch(?:apter)?\.?\s*(\d+)\D+?sc(?:ene)?\.?\s*(\d+)/i.exec(asked)
    if (m) {
      const ch = o.chapters[Number(m[1]) - 1]
      const sc = ch ? o.scenes.filter((x) => x.chapterId === ch.id)[Number(m[2]) - 1] : undefined
      if (sc) return sc.id
    }
    const want = lower(asked.replace(/^[“"]|[”"]$/g, ''))
    const exact = o.scenes.find((x) => lower(x.title) === want)
    const near = exact ?? o.scenes.find((x) => x.title.trim() && lower(x.title).includes(want))
    if (near) return near.id
    throw new Mistake(`There is no scene “${asked}” in this story. Use the outline tool to see the scenes.`)
  }

  /** A chapter of this story by "Ch 2" or its title. */
  private chapter(name: unknown): ID {
    const asked = typeof name === 'string' ? name.trim() : ''
    const o = this.outline()
    const m = /^ch(?:apter)?\.?\s*(\d+)$/i.exec(asked)
    if (m && o.chapters[Number(m[1]) - 1]) return o.chapters[Number(m[1]) - 1].id
    const want = lower(asked)
    const found = o.chapters.find((c) => lower(c.title) === want) ?? o.chapters.find((c) => c.title.trim() && lower(c.title).includes(want))
    if (found) return found.id
    throw new Mistake(`There is no chapter “${asked}” in this story. Use the outline tool to see the chapters.`)
  }

  /** An entry by its name or one of its aliases. */
  private entry(name: unknown): Entry {
    const want = lower(typeof name === 'string' ? name : '')
    if (!want) throw new Mistake('Name the entry.')
    const all = repo.listEntries(this.db)
    const found =
      all.find((e) => lower(e.name) === want) ??
      all.find((e) => e.aliases.some((a) => lower(a) === want)) ??
      all.find((e) => lower(e.name).includes(want))
    if (!found) throw new Mistake(`There is no entry called “${String(name)}”. Search for it, or propose a new entry.`)
    return found
  }

  private propose(p: NewProposal, revises?: Proposal): string {
    const why = squash(p.why).slice(0, 300)
    if (revises) {
      const i = this.proposals.indexOf(revises)
      this.proposals[i] = { ...p, id: revises.id, status: 'pending', why } as Proposal
      this.onProposals([...this.proposals])
      return `Change ${revises.id} now proposes this instead. Nothing has changed yet: it happens only if the writer applies it.`
    }
    const proposal = { ...p, id: String(this.proposals.length + 1), status: 'pending', why } as Proposal
    this.proposals.push(proposal)
    this.onProposals([...this.proposals])
    return `Proposed to the writer as change ${proposal.id}. Nothing has changed yet: it happens only if they apply it. Tell them briefly what you proposed and why.`
  }

  /**
   * Said to the model before its last request, which has no tools: the changes it has proposed, so its answer never
   * tells the writer to apply something that isn't there.
   */
  lastWords(): string {
    const list = this.proposals.map((p) => `change ${p.id}`).join(', ')
    return this.proposals.length
      ? `[AI Write, not the writer] No more tools can be used for this answer. Proposed so far: ${list}. Answer the writer now, mentioning only these; if you meant to propose more, say what they would be and that the writer can ask for them.`
      : "[AI Write, not the writer] No more tools can be used for this answer, and no changes were proposed, so there is nothing for the writer to apply: don't tell them to apply or accept anything. Answer now; if you meant to propose changes, say what they would be and that the writer can ask again."
  }

  /** Answers one call: what it found, or a plain line on what went wrong. Never throws. */
  run(call: ToolCall): { result: string; step: AgentStep } {
    let args: Record<string, unknown> = {}
    try {
      args = call.arguments.trim() ? (JSON.parse(call.arguments) as Record<string, unknown>) : {}
    } catch {
      return this.done(call, 'Something went wrong', 'The arguments were not valid JSON. Call the tool again with valid JSON.')
    }
    try {
      const [label, result] = this.answer(call.name, args)
      return this.done(call, label, result)
    } catch (e) {
      const message = e instanceof Mistake ? e.message : `That didn't work: ${(e as Error)?.message ?? e}`
      // A proposal that didn't go through says so, so the model doesn't tell the writer it is waiting for them.
      if (call.name.startsWith('propose_')) return this.done(call, 'A change that didn’t fit', `Not proposed: nothing is waiting for the writer. ${message}`)
      return this.done(call, 'Looking something up', message)
    }
  }

  private done(call: ToolCall, label: string, result: string): { result: string; step: AgentStep } {
    this.onStep(label)
    return { result, step: { label, tool: call.name, arguments: call.arguments.slice(0, 2000), result: clip(result, 1500) } }
  }

  private answer(name: string, a: Record<string, unknown>): [string, string] {
    const text = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '')
    const list = (k: string): string[] | undefined =>
      Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : undefined
    switch (name) {
      case 'read_scene': {
        const id = this.scene(a.scene)
        const s = sceneText(this.db, id)
        if (!s) throw new Mistake('That scene no longer exists.')
        const label = this.place.storyId ? sceneLabelIn(this.outline(), id) : `“${s.title}”`
        const card = repo.getScene(this.db, id).card
        const cardText = [
          card.goal && `Goal: ${card.goal}`,
          card.conflict && `Conflict: ${card.conflict}`,
          card.outcome && `Outcome: ${card.outcome}`,
          card.mood && `Mood: ${card.mood}`,
          card.when && `When: ${card.when}`,
          card.beats.filter((b) => b.trim()).length && `Beats:\n${card.beats.filter((b) => b.trim()).map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
          card.notes && `Notes: ${card.notes}`
        ]
          .filter(Boolean)
          .join('\n')
        return [
          `Reading ${label}`,
          `${label}\n\nScene card:\n${cardText || '(empty)'}\n\nText:\n${clip(s.text.trim() || '(The scene has no words yet.)', SCENE_CHARS)}`
        ]
      }
      case 'outline': {
        const o = this.outline()
        const lines = o.chapters.map((c, ci) => {
          const scenes = o.scenes
            .filter((s) => s.chapterId === c.id)
            .map((s, si) => {
              const goal = repo.getScene(this.db, s.id).card.goal.trim()
              return `  Sc ${si + 1}: ${s.title.trim() || 'Untitled'} (${s.status}, ${s.wordCount} words)${goal ? ` — goal: ${goal}` : ''}`
            })
          return [`Ch ${ci + 1}: ${c.title.trim() || 'Untitled'}`, ...(scenes.length ? scenes : ['  (no scenes)'])].join('\n')
        })
        return ['Looking at the outline', clip(`${o.story.title}\n${lines.join('\n') || '(No chapters yet.)'}`, RESULT_CHARS)]
      }
      case 'search': {
        const q = text('query').trim()
        if (!q) throw new Mistake('Give the words to search for.')
        const hits = searchIndex(this.db)
          .search(q, {})
          .groups.flatMap((g) => g.hits)
          .slice(0, 12)
        const flat = (parts: { text: string }[]): string => parts.map((p) => p.text).join('')
        const out = hits.map((h) => `- ${flat(h.title)} (${h.detail})${h.snippet.length ? `: ${flat(h.snippet)}` : ''}`).join('\n')
        return [`Searching for “${q}”`, out || 'Nothing found.']
      }
      case 'get_entry': {
        const e = this.entry(a.name)
        const defs = (FIELD_GROUPS[e.kind] ?? []).flatMap((g) => g.fields)
        const fields = defs.filter((f) => (e.fields[f.key] ?? '').trim()).map((f) => `${f.label} [${f.key}]: ${e.fields[f.key]}`)
        const empty = defs.filter((f) => !(e.fields[f.key] ?? '').trim()).map((f) => `${f.label} [${f.key}]`)
        return [
          `Looking up ${e.name}`,
          clip(
            [
              `${KIND_LABELS[e.kind].one}: ${e.name}`,
              e.aliases.length && `Also called: ${e.aliases.join(', ')}`,
              e.summary && `Summary: ${e.summary}`,
              e.description && `Description: ${e.description}`,
              ...fields,
              empty.length && `Empty fields: ${empty.join(', ')}`
            ]
              .filter(Boolean)
              .join('\n'),
            RESULT_CHARS
          )
        ]
      }
      case 'style_guide': {
        const story = this.place.storyId ? repo.getStory(this.db, this.place.storyId).style : {}
        const s = effectiveStyle(this.place.prefs, repo.getWorldStyle(this.db), story)
        const out = [
          s.pov && `Point of view: ${s.pov}`,
          s.tense && `Tense: ${s.tense}`,
          s.spelling && `Spelling: ${s.spelling}`,
          s.proseStyle && `Prose style: ${s.proseStyle}`,
          s.avoidPhrases.length && `Phrases to avoid: ${s.avoidPhrases.join('; ')}`,
          s.contentLimits && `Limits: ${s.contentLimits}`,
          s.notes && `Notes: ${s.notes}`
        ]
          .filter(Boolean)
          .join('\n')
        return ['Reading the style guide', out || 'The style guide is empty.']
      }
      case 'scene_issues': {
        const id = this.scene(a.scene)
        const rows = cdb.sceneIssueRows(this.db, id).filter((r) => r.status === 'open')
        const out = rows.map((r) => `- ${r.message as string}${r.quote ? ` (“${r.quote as string}”)` : ''}`).join('\n')
        return ['Checking the scene’s issues', out || 'No open issues in this scene.']
      }
      case 'propose_edit': {
        const id = this.scene(a.scene)
        const s = sceneText(this.db, id)
        if (!s) throw new Mistake('That scene no longer exists.')
        const find = text('find')
        if (!find.trim()) throw new Mistake('`find` is empty. Copy the words to change from the scene.')
        if (find.includes('\n') || text('replace').includes('\n')) {
          throw new Mistake('Keep each propose_edit inside one paragraph. To rewrite a passage across paragraphs, use propose_rewrite.')
        }
        const hay = s.text
        const count = hay.split(find).length - 1
        if (count === 0) throw new Mistake('Those words are not in the scene as written. Read the scene and copy the words exactly.')
        if (count > 1) throw new Mistake('Those words occur more than once. Include more of the sentence so they occur only once.')
        if (find === text('replace')) throw new Mistake('The new words are the same as the old.')
        const revisesId = text('revises').replace(/\D/g, '')
        const revises = revisesId ? this.proposals.find((p) => p.id === revisesId) : undefined
        if (revisesId && revises?.kind !== 'text') throw new Mistake(`There is no change ${revisesId} to words to revise.`)
        // Applying one change mustn't lose the words another looks for: overlapping changes become one.
        const at = hay.indexOf(find)
        const clash = this.proposals.find((p): p is Extract<Proposal, { kind: 'text' }> => {
          if (p === revises || p.kind !== 'text' || p.sceneId !== id || p.status !== 'pending') return false
          const from = hay.indexOf(p.find)
          return from >= 0 && from < at + find.length && at < from + p.find.length
        })
        if (clash) {
          throw new Mistake(
            `Those words overlap change ${clash.id} (“${clip(clash.find, 120)}”): once one is applied, the other's words are gone. Make one change covering both, with \`revises\`: "${clash.id}".`
          )
        }
        const label = sceneLabelIn(this.outline(), id)
        return [
          revises ? `Revising change ${revises.id}` : `Proposing an edit to ${label}`,
          this.propose({ kind: 'text', sceneId: id, sceneLabel: label, find, replace: text('replace'), why: text('why') }, revises)
        ]
      }
      case 'propose_rewrite': {
        const id = this.scene(a.scene)
        const s = sceneText(this.db, id)
        if (!s) throw new Mistake('That scene no longer exists.')
        const start = text('start').trim()
        const end = text('end').trim()
        const replace = text('replace').trim()
        if (!start || !end) throw new Mistake('Give the passage\'s first words as `start` and its last words as `end`, copied from the scene.')
        if (!replace) throw new Mistake('Give the new passage as `replace`. To cut words, use propose_edit with an empty `replace`.')
        const hay = s.text
        const count = hay.split(start).length - 1
        if (count === 0) throw new Mistake('The `start` words are not in the scene as written. Read the scene and copy them exactly.')
        if (count > 1) throw new Mistake('The `start` words occur more than once. Give a few more of them so they occur only once.')
        const from = hay.indexOf(start)
        const endAt = hay.indexOf(end, from)
        if (endAt < 0) throw new Mistake('The `end` words are not in the scene after the `start` words. Copy the passage\'s last words exactly.')
        const to = endAt + end.length
        const original = hay.slice(from, to)
        if (original.replace(/\s+/g, ' ') === replace.replace(/\s+/g, ' ')) throw new Mistake('The new passage is the same as the old.')
        const clash = this.proposals.find((p) => {
          if (p.status !== 'pending' || (p.kind !== 'text' && p.kind !== 'passage') || p.sceneId !== id) return false
          const [a0, a1] = p.kind === 'text' ? [hay.indexOf(p.find), hay.indexOf(p.find) + p.find.length] : [hay.indexOf(p.start), hay.indexOf(p.end, hay.indexOf(p.start)) + p.end.length]
          return a0 >= 0 && a0 < to && from < a1
        })
        if (clash) throw new Mistake(`That passage overlaps change ${clash.id}. Make one change covering both instead.`)
        const label = sceneLabelIn(this.outline(), id)
        return [`Proposing a rewrite of ${label}`, this.propose({ kind: 'passage', sceneId: id, sceneLabel: label, start, end, original, replace, why: text('why') })]
      }
      case 'propose_scene_card': {
        const id = this.scene(a.scene)
        const patch: CardProposal = {}
        for (const k of ['goal', 'conflict', 'outcome', 'mood', 'when', 'notes'] as const) if (typeof a[k] === 'string') patch[k] = text(k).trim()
        const beats = list('beats')
        if (beats) patch.beats = beats
        if (!Object.keys(patch).length) throw new Mistake('Give at least one part of the card to change.')
        const label = sceneLabelIn(this.outline(), id)
        return [`Proposing a change to the card of ${label}`, this.propose({ kind: 'card', sceneId: id, sceneLabel: label, patch, why: text('why') })]
      }
      case 'propose_entry_change': {
        const e = this.entry(a.name)
        const patch: EntryProposal = {}
        if (typeof a.summary === 'string') patch.summary = text('summary').trim()
        if (typeof a.description === 'string') patch.description = text('description').trim()
        const aliases = list('aliases')
        if (aliases) patch.aliases = aliases
        if (a.fields && typeof a.fields === 'object') {
          const keys = new Set((FIELD_GROUPS[e.kind] ?? []).flatMap((g) => g.fields.map((f) => f.key)))
          const fields: Record<string, string> = {}
          for (const [k, v] of Object.entries(a.fields as Record<string, unknown>)) {
            if (!keys.has(k)) throw new Mistake(`“${k}” isn't one of ${e.name}'s fields. get_entry shows the field keys.`)
            if (typeof v === 'string') fields[k] = v.trim()
          }
          if (Object.keys(fields).length) patch.fields = fields
        }
        if (!Object.keys(patch).length) throw new Mistake('Give at least one part of the entry to change.')
        return [`Proposing a change to ${e.name}`, this.propose({ kind: 'entry', entryId: e.id, entryKind: e.kind, name: e.name, patch, why: text('why') })]
      }
      case 'propose_new_entry': {
        const kind = text('kind') as EntryKind
        if (!ENTRY_KINDS.includes(kind)) throw new Mistake(`Kind must be one of: ${ENTRY_KINDS.join(', ')}.`)
        const name = squash(text('name'))
        if (!name) throw new Mistake('Give the new entry a name.')
        if (repo.listEntries(this.db).some((e) => lower(e.name) === lower(name))) {
          throw new Mistake(`There is already an entry called “${name}”. Propose a change to it instead.`)
        }
        return [
          `Proposing a new ${KIND_LABELS[kind].one.toLowerCase()}`,
          this.propose({ kind: 'newEntry', entryKind: kind, name, summary: text('summary').trim(), description: text('description').trim(), why: text('why') })
        ]
      }
      case 'propose_new_scene': {
        const chapterId = this.chapter(a.chapter)
        const o = this.outline()
        const ci = o.chapters.findIndex((c) => c.id === chapterId)
        const title = squash(text('title'))
        if (!title) throw new Mistake('Give the new scene a title.')
        const card: CardProposal = {}
        if (text('goal').trim()) card.goal = text('goal').trim()
        const beats = list('beats')
        if (beats?.length) card.beats = beats
        const chapterLabel = `Ch ${ci + 1}${o.chapters[ci].title.trim() ? ` “${o.chapters[ci].title.trim()}”` : ''}`
        return [`Proposing a new scene in ${chapterLabel}`, this.propose({ kind: 'newScene', chapterId, chapterLabel, title, card, why: text('why') })]
      }
      case 'propose_new_chapter': {
        if (!this.place.storyId) throw new Mistake('No story is open.')
        const title = squash(text('title'))
        if (!title) throw new Mistake('Give the new chapter a title.')
        return ['Proposing a new chapter', this.propose({ kind: 'newChapter', storyId: this.place.storyId, title, why: text('why') })]
      }
      case 'propose_rename': {
        const to = squash(text('to'))
        if (!to) throw new Mistake('Give the new title.')
        if (text('chapter').trim()) {
          const id = this.chapter(a.chapter)
          const from = this.outline().chapters.find((c) => c.id === id)!.title
          return ['Proposing a new title', this.propose({ kind: 'rename', target: 'chapter', targetId: id, from, to, why: text('why') })]
        }
        const id = this.scene(a.scene)
        const from = this.outline().scenes.find((s) => s.id === id)?.title ?? ''
        return ['Proposing a new title', this.propose({ kind: 'rename', target: 'scene', targetId: id, from, to, why: text('why') })]
      }
      default:
        throw new Mistake(`There is no tool called “${name}”.`)
    }
  }

  /** Answers a model turn's calls, in order: the tool messages to send back, and the steps for "What the AI saw". */
  async runAll(calls: ToolCall[]): Promise<{ results: ChatMessage[]; steps: AgentStep[] }> {
    const results: ChatMessage[] = []
    const steps: AgentStep[] = []
    for (const c of calls) {
      const { result, step } = this.run(c)
      results.push({ role: 'tool', toolCallId: c.id, content: result })
      steps.push(step)
    }
    return { results, steps }
  }
}
